// Mirrors the shell's localStorage changes to the Rust-owned state store
// (src-tauri/src/shell_state_store.rs). No imports: the transport, the clock and the
// timers are passed in, so the behavior can be tested against a fake Storage.

export type MirrorOp =
  | { op: 'set'; key: string; value: string; seq: number }
  | { op: 'remove'; key: string; seq: number }

export interface MirrorResult {
  skipped?: string[]
}

export interface MirrorEnvironment {
  storage: Storage
  send(ops: MirrorOp[]): Promise<MirrorResult | void>
  wipe(): Promise<void>
  now(): number
  setTimer(callback: () => void, ms: number): unknown
  clearTimer(handle: unknown): void
  warn(message: string): void
}

export interface ShellStateMirror {
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
}

/** Same list as EXCLUDED_KEYS in the Rust module: the crash marker of this run. */
export const MIRROR_EXCLUDED_KEYS: readonly string[] = ['nebula-browser-run-state-v1']

export const DEBOUNCE_MS = 400
export const FIRST_RECONCILE_MS = 3_000
export const RECONCILE_MS = 60_000
const MAX_BATCH_OPS = 400
const MAX_BATCH_BYTES = 3 * 1024 * 1024
const MAX_VALUE_BYTES = 2 * 1024 * 1024
const MAX_CONSECUTIVE_FAILURES = 5

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
  const oversize = new Set<string>()

  const excluded = (key: string) => MIRROR_EXCLUDED_KEYS.includes(key)

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
    if (op.op === 'set' && byteLength(op.value) > MAX_VALUE_BYTES) {
      if (!oversize.has(op.key)) {
        oversize.add(op.key)
        env.warn(`shell state mirror: ${op.key} is too large to mirror`)
      }
      // The store keeps the last value it accepted; a removal must still go through.
      pending.delete(op.key)
      return
    }
    oversize.delete(op.key)
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
    if (retryTimer === null) {
      retryTimer = env.setTimer(() => {
        retryTimer = null
        void flush()
      }, 2_000 * failures)
    }
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
        const result = await env.send(batch)
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

  return {
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
