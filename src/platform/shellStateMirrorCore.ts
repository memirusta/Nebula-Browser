// Mirrors the shell's localStorage changes to the Rust-owned state store
// (src-tauri/src/shell_state_store.rs). No imports: the transport, the clock and the
// timers are passed in, so the behavior can be tested against a fake Storage.

export type MirrorOp =
  | { op: 'set'; key: string; value: string; seq: number }
  | { op: 'remove'; key: string; seq: number }

export interface MirrorResult {
  skipped?: string[]
  /** Nothing was applied: the store is receiving changes too fast. Try again later. */
  rateLimited?: boolean
}

export interface MirrorEnvironment {
  storage: Storage
  send(ops: MirrorOp[], barrierId?: string): Promise<MirrorResult | void>
  /** SHA-256 of the bytes. Needed for the migration gate only. */
  sha256?(data: Uint8Array): Promise<Uint8Array>
  wipe(): Promise<void>
  now(): number
  setTimer(callback: () => void, ms: number): unknown
  clearTimer(handle: unknown): void
  warn(message: string): void
}

/** What a shell webview answers to the migration gate (docs/EXTENSION_OPT_IN_SPLIT.md, 2a). */
export interface BarrierAnswer {
  digest: string
  keyCount: number
  pendingEmpty: boolean
  writesSince: number
  unmirrorable: string[]
  error?: string
}

export interface ShellStateMirror {
  /** Drain, reconcile, and answer with the digest of the live storage. */
  barrierDrain(id: string): Promise<BarrierAnswer>
  /** The second question of the gate: did anything change since the drain answer? */
  barrierCommit(id: string): BarrierAnswer
  /** The gate ended (aborted); resume normal mirroring. */
  barrierEnd(id: string): void
  noteSet(key: string, value: string): void
  noteRemove(key: string): void
  /** Sends what is pending now. */
  flush(): Promise<void>
  /** Compares localStorage with what was last sent and sends the difference. */
  reconcile(): Promise<void>
  /** Starts the timers: the first reconcile soon, then one every RECONCILE_MS. */
  start(): void
  /** Stops mirroring for good; returns after pending sends settle. */
  stop(): void
  /** Factory reset: forget what is pending, stop mirroring, empty the store. */
  wipe(): Promise<void>
  readonly disabled: boolean
  /** Keys whose current value cannot be mirrored, with the reason. A migration that
   * restores from the store would lose them (see docs/EXTENSION_OPT_IN_SPLIT.md, 2a). */
  unmirrorable(): ReadonlyMap<string, string>
}

/** Same list as EXCLUDED_KEYS in the Rust module: the crash marker of this run. */
export const MIRROR_EXCLUDED_KEYS: readonly string[] = ['nebula-browser-run-state-v1']
/** Same as EXCLUDED_PREFIX in Rust: the app's own bookkeeping (the hydration marker). */
export const MIRROR_EXCLUDED_PREFIX = '__nebula_'

export function isExcludedKey(key: string): boolean {
  return MIRROR_EXCLUDED_KEYS.includes(key) || key.startsWith(MIRROR_EXCLUDED_PREFIX)
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const length = Math.min(a.length, b.length)
  for (let index = 0; index < length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index]
  }
  return a.length - b.length
}

/**
 * SHA-256 over `key -> value`, sorted by the UTF-8 bytes of the key, each as
 * `len(key) key len(value) value` with 4-byte big-endian lengths. The same function as
 * content_digest in src-tauri/src/shell_state_store.rs; golden vectors pin both.
 */
export async function contentDigest(
  entries: Iterable<readonly [string, string]>,
  sha256: (data: Uint8Array) => Promise<Uint8Array>,
): Promise<string> {
  const encoder = new TextEncoder()
  const list = [...entries].map(([key, value]) => [encoder.encode(key), encoder.encode(value)] as const)
  list.sort((a, b) => compareBytes(a[0], b[0]))
  let total = 0
  for (const [key, value] of list) total += 8 + key.length + value.length
  const buffer = new Uint8Array(total)
  const view = new DataView(buffer.buffer)
  let offset = 0
  for (const [key, value] of list) {
    view.setUint32(offset, key.length)
    buffer.set(key, offset + 4)
    offset += 4 + key.length
    view.setUint32(offset, value.length)
    buffer.set(value, offset + 4)
    offset += 4 + value.length
  }
  const digest = await sha256(buffer)
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export const DEBOUNCE_MS = 400
export const FIRST_RECONCILE_MS = 3_000
export const RECONCILE_MS = 60_000
const MAX_BATCH_OPS = 400
const MAX_BATCH_BYTES = 3 * 1024 * 1024
const MAX_VALUE_BYTES = 2 * 1024 * 1024
const MAX_CONSECUTIVE_FAILURES = 5
const RATE_LIMIT_RETRY_MS = 3_000

/** A lone surrogate cannot cross the IPC (JSON on the Rust side rejects it, and the whole
 * batch with it), so such a key or value is not mirrored instead of poisoning the batch. */
export function isWellFormed(text: string): boolean {
  const native = (text as unknown as { isWellFormed?: () => boolean }).isWellFormed
  if (typeof native === 'function') return native.call(text)
  return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text)
}

function byteLength(text: string): number {
  // The limits are in UTF-8 bytes; length * 3 is the worst case per UTF-16 unit and
  // is cheap, so exact counting is only done when it could matter.
  if (text.length * 3 <= MAX_VALUE_BYTES) return text.length * 3
  return new TextEncoder().encode(text).length
}

export function createShellStateMirror(env: MirrorEnvironment): ShellStateMirror {
  const pending = new Map<string, MirrorOp>()
  // What the store is known to hold, per key. Only updated after a successful send.
  const lastSent = new Map<string, string>()
  let lastSeq = 0
  let failures = 0
  let disabled = false
  let debounceTimer: unknown = null
  let retryTimer: unknown = null
  let reconcileTimer: unknown = null
  let sending: Promise<void> = Promise.resolve()
  const unmirrorable = new Map<string, string>()

  const excluded = isExcludedKey
  // The migration gate: while a barrier is open batches carry its id (the store lifts its
  // rate limit for them), and writes are counted so the commit question can be answered.
  let barrierId: string | null = null
  let barrierWrites = 0
  let inFlight = 0

  function nextSeq(): number {
    lastSeq = Math.max(lastSeq + 1, env.now() * 1000)
    return lastSeq
  }

  function schedule(ms: number): void {
    if (disabled || debounceTimer !== null) return
    debounceTimer = env.setTimer(() => {
      debounceTimer = null
      void flush()
    }, ms)
  }

  function enqueue(op: MirrorOp): void {
    if (disabled || excluded(op.key)) return
    if (barrierId !== null) barrierWrites += 1
    let reason: string | null = null
    if (!isWellFormed(op.key)) reason = 'the key is not well-formed text'
    else if (op.op === 'set' && !isWellFormed(op.value)) reason = 'the value is not well-formed text'
    else if (op.op === 'set' && byteLength(op.value) > MAX_VALUE_BYTES) reason = 'the value is too large'
    if (reason) {
      if (!unmirrorable.has(op.key)) {
        env.warn(`shell state mirror: ${op.key.slice(0, 80)} is not mirrored: ${reason}`)
      }
      unmirrorable.set(op.key, reason)
      // The store keeps the last value it accepted; a removal must still go through.
      pending.delete(op.key)
      return
    }
    unmirrorable.delete(op.key)
    pending.set(op.key, op)
    schedule(DEBOUNCE_MS)
  }

  function chunks(ops: MirrorOp[]): MirrorOp[][] {
    const result: MirrorOp[][] = []
    let current: MirrorOp[] = []
    let bytes = 0
    for (const op of ops) {
      const size = op.op === 'set' ? byteLength(op.value) + op.key.length * 3 : op.key.length * 3
      if (current.length > 0 && (current.length >= MAX_BATCH_OPS || bytes + size > MAX_BATCH_BYTES)) {
        result.push(current)
        current = []
        bytes = 0
      }
      current.push(op)
      bytes += size
    }
    if (current.length > 0) result.push(current)
    return result
  }

  function noteSent(ops: MirrorOp[]): void {
    for (const op of ops) {
      if (op.op === 'set') lastSent.set(op.key, op.value)
      else lastSent.delete(op.key)
    }
  }

  function requeue(ops: MirrorOp[]): void {
    for (const op of ops) {
      // A newer change to the same key, made while this send was in flight, wins.
      if (!pending.has(op.key)) pending.set(op.key, op)
    }
  }

  function backOff(): void {
    failures += 1
    if (failures >= MAX_CONSECUTIVE_FAILURES) {
      disabled = true
      env.warn('shell state mirror: giving up after repeated failures')
      return
    }
    scheduleRetry(2_000 * failures)
  }

  function scheduleRetry(ms: number): void {
    if (disabled || retryTimer !== null) return
    retryTimer = env.setTimer(() => {
      retryTimer = null
      void flush()
    }, ms)
  }

  async function sendPending(): Promise<void> {
    if (disabled || pending.size === 0) return
    const ops = [...pending.values()]
    pending.clear()
    const batches = chunks(ops)
    for (let index = 0; index < batches.length; index += 1) {
      // stop() or a wipe may land between two batches of the same flush.
      if (disabled) return
      const batch = batches[index]
      try {
        inFlight += 1
        let result: MirrorResult | void
        try {
          result = await env.send(batch, barrierId ?? undefined)
        } finally {
          inFlight -= 1
        }
        if (result?.rateLimited) {
          // Busy, not broken: keep the batch, wait, and do not count it as a failure.
          requeue(batch)
          for (const rest of batches.slice(index + 1)) requeue(rest)
          scheduleRetry(RATE_LIMIT_RETRY_MS)
          return
        }
        failures = 0
        noteSent(batch)
        if (result?.skipped?.length) {
          env.warn(`shell state mirror: store skipped ${result.skipped.length} change(s)`)
        }
      } catch {
        requeue(batch)
        for (const rest of batches.slice(index + 1)) requeue(rest)
        backOff()
        return
      }
    }
  }

  function flush(): Promise<void> {
    if (debounceTimer !== null) {
      env.clearTimer(debounceTimer)
      debounceTimer = null
    }
    // One send at a time keeps the order of this window's batches.
    sending = sending.then(sendPending, sendPending)
    return sending
  }

  function liveEntries(): Map<string, string> {
    const live = new Map<string, string>()
    for (let index = 0; index < env.storage.length; index += 1) {
      const key = env.storage.key(index)
      if (key === null || excluded(key)) continue
      const value = env.storage.getItem(key)
      if (value !== null) live.set(key, value)
    }
    return live
  }

  async function reconcile(): Promise<void> {
    if (disabled) return
    const live = liveEntries()
    for (const [key, value] of live) {
      if (lastSent.get(key) !== value) enqueue({ op: 'set', key, value, seq: nextSeq() })
    }
    for (const key of lastSent.keys()) {
      if (!live.has(key)) enqueue({ op: 'remove', key, seq: nextSeq() })
    }
    await flush()
  }

  function armReconcile(ms: number): void {
    if (disabled) return
    reconcileTimer = env.setTimer(() => {
      reconcileTimer = null
      void reconcile().finally(() => armReconcile(RECONCILE_MS))
    }, ms)
  }

  function stop(): void {
    disabled = true
    for (const handle of [debounceTimer, retryTimer, reconcileTimer]) {
      if (handle !== null) env.clearTimer(handle)
    }
    debounceTimer = null
    retryTimer = null
    reconcileTimer = null
    pending.clear()
  }

  async function liveDigest(): Promise<string> {
    if (!env.sha256) throw new Error('no SHA-256 available')
    return contentDigest(liveEntries(), env.sha256)
  }

  function answer(digest: string, error?: string): BarrierAnswer {
    return {
      digest,
      keyCount: liveEntries().size,
      pendingEmpty: pending.size === 0 && inFlight === 0 && retryTimer === null,
      writesSince: barrierWrites,
      unmirrorable: [...unmirrorable.keys()],
      ...(error ? { error } : {}),
    }
  }

  async function barrierDrain(id: string): Promise<BarrierAnswer> {
    barrierId = id
    barrierWrites = 0
    // The drain takes over from a backed-off retry: it sends everything itself, now.
    if (retryTimer !== null) {
      env.clearTimer(retryTimer)
      retryTimer = null
    }
    try {
      if (disabled) return answer('', 'the mirror gave up earlier')
      // Several rounds: a write that lands while one is being sent is sent by the next.
      for (let round = 0; round < 5; round += 1) {
        await reconcile()
        if (failures > 0) return answer('', 'the store did not accept the changes')
        if (pending.size === 0 && inFlight === 0) break
      }
      // Writes made from here on are what the commit question asks about.
      barrierWrites = 0
      const digest = await liveDigest()
      return answer(digest)
    } catch (error) {
      return answer('', String(error))
    }
  }

  function barrierCommit(id: string): BarrierAnswer {
    if (barrierId !== id) return answer('', 'not the open barrier')
    return answer('')
  }

  function barrierEnd(id: string): void {
    if (barrierId === id) {
      barrierId = null
      barrierWrites = 0
    }
  }

  return {
    barrierDrain,
    barrierCommit,
    barrierEnd,
    noteSet(key, value) {
      enqueue({ op: 'set', key, value, seq: nextSeq() })
    },
    noteRemove(key) {
      enqueue({ op: 'remove', key, seq: nextSeq() })
    },
    flush,
    reconcile,
    start() {
      armReconcile(FIRST_RECONCILE_MS)
    },
    stop,
    async wipe() {
      stop()
      // Anything still in flight finishes first, so it cannot land after the wipe.
      await sending.catch(() => undefined)
      await env.wipe()
    },
    get disabled() {
      return disabled
    },
    unmirrorable() {
      return unmirrorable
    },
  }
}

type StorageMethods = Pick<Storage, 'setItem' | 'removeItem' | 'clear'>

/**
 * Reports writes to `storage` to `mirror`. The methods live on Storage.prototype (an
 * own property assigned on a Storage object would be stored as a key). Returns a function
 * that restores them.
 */
export function hookStorage(
  prototype: StorageMethods,
  storage: Storage,
  mirror: Pick<ShellStateMirror, 'noteSet' | 'noteRemove'>,
): () => void {
  const { setItem, removeItem, clear } = prototype

  prototype.setItem = function (this: Storage, key: string, value: string) {
    setItem.call(this, key, value)
    if (this === storage) mirror.noteSet(String(key), String(value))
  }
  prototype.removeItem = function (this: Storage, key: string) {
    removeItem.call(this, key)
    if (this === storage) mirror.noteRemove(String(key))
  }
  prototype.clear = function (this: Storage) {
    const keys: string[] = []
    if (this === storage) {
      for (let index = 0; index < this.length; index += 1) {
        const key = this.key(index)
        if (key !== null) keys.push(key)
      }
    }
    clear.call(this)
    // Per-key removals: the store has no "clear" over IPC.
    for (const key of keys) mirror.noteRemove(key)
  }

  return () => {
    prototype.setItem = setItem
    prototype.removeItem = removeItem
    prototype.clear = clear
  }
}
