import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  createShellStateMirror,
  DEBOUNCE_MS,
  hookStorage,
  MIRROR_EXCLUDED_KEYS,
  RECONCILE_MS,
  type MirrorEnvironment,
  type MirrorOp,
} from '../src/platform/shellStateMirrorCore.ts'

class FakeStorage {
  private data = new Map<string, string>()
  get length() {
    return this.data.size
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null
  }
  getItem(key: string) {
    return this.data.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.data.set(key, value)
  }
  removeItem(key: string) {
    this.data.delete(key)
  }
  clear() {
    this.data.clear()
  }
}

function setup(options: { failSends?: number; rateLimited?: number } = {}) {
  const storage = new FakeStorage()
  const sent: MirrorOp[][] = []
  const warnings: string[] = []
  const timers: { handle: number; at: number; callback: () => void }[] = []
  let clock = 1_000_000
  let nextHandle = 1
  let failuresLeft = options.failSends ?? 0
  let limitedLeft = options.rateLimited ?? 0
  let wiped = 0
  const env: MirrorEnvironment = {
    storage: storage as unknown as Storage,
    async send(ops) {
      if (failuresLeft > 0) {
        failuresLeft -= 1
        throw new Error('not allowed')
      }
      if (limitedLeft > 0) {
        limitedLeft -= 1
        return { rateLimited: true }
      }
      sent.push(ops)
    },
    async wipe() {
      wiped += 1
    },
    now: () => clock,
    setTimer(callback, ms) {
      const handle = nextHandle++
      timers.push({ handle, at: clock + ms, callback })
      return handle
    },
    clearTimer(handle) {
      const index = timers.findIndex((timer) => timer.handle === handle)
      if (index >= 0) timers.splice(index, 1)
    },
    warn: (message) => warnings.push(message),
  }
  const mirror = createShellStateMirror(env)
  const advance = async (ms: number) => {
    clock += ms
    for (;;) {
      const due = timers.filter((timer) => timer.at <= clock).sort((a, b) => a.at - b.at)[0]
      if (!due) break
      timers.splice(timers.indexOf(due), 1)
      due.callback()
      // Let the send chain settle.
      for (let i = 0; i < 10; i += 1) await Promise.resolve()
    }
  }
  return { storage, mirror, sent, warnings, advance, timers, wiped: () => wiped, tick: (ms: number) => { clock += ms } }
}

const flatten = (batches: MirrorOp[][]) => batches.flat()

test('writes are coalesced per key and sent once after the debounce', async () => {
  const { mirror, sent, advance } = setup()
  mirror.noteSet('a', '1')
  mirror.noteSet('a', '2')
  mirror.noteSet('b', 'x')
  mirror.noteRemove('b')
  await advance(DEBOUNCE_MS - 1)
  assert.equal(sent.length, 0)
  await advance(2)
  assert.equal(sent.length, 1)
  const byKey = new Map(sent[0].map((op) => [op.key, op]))
  assert.equal(byKey.size, 2)
  assert.deepEqual(byKey.get('a'), { op: 'set', key: 'a', value: '2', seq: (byKey.get('a') as { seq: number }).seq })
  assert.equal(byKey.get('b')?.op, 'remove')
})

test('seq is strictly increasing even when the clock does not move', () => {
  const { mirror, sent } = setup()
  mirror.noteSet('a', '1')
  void mirror.flush()
  mirror.noteSet('a', '2')
  mirror.noteSet('b', '3')
  void mirror.flush()
  return Promise.resolve().then(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve()
    const seqs = flatten(sent).map((op) => op.seq)
    assert.equal(new Set(seqs).size, seqs.length)
    assert.deepEqual([...seqs], [...seqs].sort((a, b) => a - b))
  })
})

test('the crash marker of the current run is never sent', async () => {
  const { mirror, sent, advance } = setup()
  for (const key of MIRROR_EXCLUDED_KEYS) mirror.noteSet(key, '{}')
  mirror.noteSet('nebula-settings-v1', '{}')
  await advance(DEBOUNCE_MS + 1)
  assert.deepEqual(flatten(sent).map((op) => op.key), ['nebula-settings-v1'])
})

test('the first reconcile sends everything that is already in storage, later ones only differences', async () => {
  const { storage, mirror, sent, advance } = setup()
  storage.setItem('one', '1')
  storage.setItem('two', '2')
  storage.setItem('nebula-browser-run-state-v1', 'x')
  mirror.start()
  await advance(3_001)
  assert.deepEqual(flatten(sent).map((op) => op.key).sort(), ['one', 'two'])

  sent.length = 0
  await advance(RECONCILE_MS)
  assert.equal(sent.length, 0, 'nothing changed, nothing is sent')

  // A write that never went through the hooks (and a removal) is found by the reconcile.
  storage.setItem('one', '1b')
  storage.removeItem('two')
  storage.setItem('three', '3')
  await advance(RECONCILE_MS)
  const ops = flatten(sent)
  assert.deepEqual(
    ops.map((op) => `${op.op}:${op.key}`).sort(),
    ['remove:two', 'set:one', 'set:three'],
  )
})

test('a failed send is retried with the newest value and gives up after repeated failures', async () => {
  const { mirror, sent, advance, warnings } = setup({ failSends: 1 })
  mirror.noteSet('a', '1')
  await advance(DEBOUNCE_MS + 1)
  assert.equal(sent.length, 0)
  // A newer value arrives while the retry is waiting: it must win over the failed one.
  mirror.noteSet('a', '2')
  await advance(2_000 + DEBOUNCE_MS)
  const ops = flatten(sent)
  assert.equal(ops.length, 1)
  assert.equal(ops[0].op === 'set' && ops[0].value, '2')
  assert.equal(mirror.disabled, false)

  const failing = setup({ failSends: 100 })
  failing.mirror.noteSet('a', '1')
  for (let i = 0; i < 8; i += 1) await failing.advance(10_000)
  assert.equal(failing.mirror.disabled, true)
  assert.ok(failing.warnings.some((message) => /giving up/.test(message)))
  assert.equal(warnings.length, 0)
})

test('a rate-limited answer keeps the batch and is not counted as a failure', async () => {
  const { mirror, sent, advance, warnings } = setup({ rateLimited: 12 })
  mirror.noteSet('a', '1')
  for (let i = 0; i < 20; i += 1) await advance(3_001)
  assert.equal(mirror.disabled, false)
  assert.equal(warnings.length, 0)
  assert.deepEqual(flatten(sent).map((op) => op.key), ['a'])
})

test('large batches are split and values over the store limit are not sent', async () => {
  const { mirror, sent, advance, warnings } = setup()
  for (let i = 0; i < 1000; i += 1) mirror.noteSet(`k${i}`, 'v')
  mirror.noteSet('huge', 'x'.repeat(2 * 1024 * 1024 + 1))
  await advance(DEBOUNCE_MS + 1)
  assert.ok(sent.length >= 3)
  assert.ok(sent.every((batch) => batch.length <= 400))
  assert.equal(flatten(sent).length, 1000)
  assert.ok(warnings.some((message) => /huge/.test(message)))
})

test('storage hooks report writes of the mirrored storage only, and clear becomes removals', async () => {
  const mirrored = new FakeStorage()
  const other = new FakeStorage()
  const calls: string[] = []
  const restore = hookStorage(
    FakeStorage.prototype as unknown as Storage,
    mirrored as unknown as Storage,
    {
      noteSet: (key, value) => calls.push(`set:${key}=${value}`),
      noteRemove: (key) => calls.push(`remove:${key}`),
    },
  )
  try {
    mirrored.setItem('a', '1')
    other.setItem('b', '2')
    mirrored.setItem('c', '3')
    mirrored.removeItem('a')
    other.removeItem('b')
    mirrored.clear()
    other.clear()
    assert.deepEqual(calls, ['set:a=1', 'set:c=3', 'remove:a', 'remove:c'])
    assert.equal(mirrored.length, 0)
  } finally {
    restore()
  }
  mirrored.setItem('z', '9')
  assert.equal(calls.length, 4, 'restored methods no longer report')
})

test('a write that throws is not reported', () => {
  class Full extends FakeStorage {
    setItem(): void {
      throw new Error('quota')
    }
  }
  const storage = new Full()
  const calls: string[] = []
  const restore = hookStorage(Full.prototype as unknown as Storage, storage as unknown as Storage, {
    noteSet: (key) => calls.push(key),
    noteRemove: (key) => calls.push(key),
  })
  try {
    // The hook wraps the prototype's own method, which throws before reporting.
    assert.throws(() => storage.setItem())
    assert.deepEqual(calls, [])
  } finally {
    restore()
  }
})

test('wipe stops the mirror, forgets pending changes and empties the store', async () => {
  const { mirror, sent, advance, wiped } = setup()
  mirror.noteSet('a', '1')
  await mirror.wipe()
  assert.equal(wiped(), 1)
  assert.equal(mirror.disabled, true)
  mirror.noteSet('b', '2')
  await advance(DEBOUNCE_MS + 1)
  assert.equal(sent.length, 0)
})

test('the shell entry point starts the mirror first and the reset flow wipes it', () => {
  const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8')
  const imports = main.match(/^import .*$/gm) ?? []
  assert.equal(imports[0], "import './platform/shellStateMirror'")
  const reset = readFileSync(new URL('../src/core/appReset.ts', import.meta.url), 'utf8')
  assert.match(reset, /clearShellStateMirror: wipeShellStateMirror/)
})

test('the Rust side keeps the same exclusion list and registers its commands for shell webviews only', () => {
  const rust = readFileSync(new URL('../src-tauri/src/shell_state_store.rs', import.meta.url), 'utf8')
  for (const key of MIRROR_EXCLUDED_KEYS) assert.ok(rust.includes(`"${key}"`), key)
  const lib = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8')
  for (const name of ['shell_store_apply', 'shell_store_status', 'shell_store_wipe']) {
    assert.ok(lib.includes(`shell_state_store::${name},`), `${name} registered`)
  }
  const permissions = readFileSync(new URL('../src-tauri/permissions/webview-commands.toml', import.meta.url), 'utf8')
  const capability = JSON.parse(
    readFileSync(new URL('../src-tauri/capabilities/shell-state-store.json', import.meta.url), 'utf8'),
  ) as { webviews: string[]; permissions: string[] }
  for (const name of ['shell_store_apply', 'shell_store_status', 'shell_store_wipe']) {
    assert.ok(permissions.includes(`"${name}"`), `${name} has a permission entry`)
  }
  assert.deepEqual(capability.permissions, ['allow-shell-state-store-commands'])
  // Never a tab, popup, owner or sign-in window.
  for (const label of capability.webviews) {
    assert.doesNotMatch(label, /tab|popup|oauth|extension/)
  }
})
