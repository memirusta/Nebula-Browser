import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  contentDigest,
  createShellStateMirror,
  isExcludedKey,
  type MirrorEnvironment,
  type MirrorOp,
} from '../src/platform/shellStateMirrorCore.ts'

const sha256 = async (data: Uint8Array) => new Uint8Array(createHash('sha256').update(data).digest())

// The same vectors are asserted in src-tauri/src/shell_state_store.rs (gate_tests).
test('the content digest matches the golden vectors shared with the Rust side', async () => {
  assert.equal(
    await contentDigest([], sha256),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  )
  assert.equal(
    await contentDigest([['a', '1'], ['ü', '\u{1F600}'], ['b', '']], sha256),
    '00f64d2628d1741c1fe96fdd42f26314b5b01110963e3c4d721b6a9d81769b06',
  )
  // UTF-8 byte order, not UTF-16 code unit order (U+FF5E and U+1F600 swap).
  assert.equal(
    await contentDigest([['～', 'x'], ['\u{1F600}', 'y']], sha256),
    '463860628de3947241b8c3d2f0c6d6ebfbd4b6d4ee134538850f1997c1746636',
  )
})

test('the digest does not depend on the order and tells key/value boundaries apart', async () => {
  assert.equal(
    await contentDigest([['a', '1'], ['b', '2']], sha256),
    await contentDigest([['b', '2'], ['a', '1']], sha256),
  )
  assert.notEqual(await contentDigest([['a', '12']], sha256), await contentDigest([['a1', '2']], sha256))
})

test('bookkeeping keys are excluded exactly like the Rust side excludes them', () => {
  assert.equal(isExcludedKey('nebula-browser-run-state-v1'), true)
  assert.equal(isExcludedKey('__nebula_hydration_id'), true)
  assert.equal(isExcludedKey('nebula-settings-v1'), false)
})

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

function setup(options: { rateLimitWithoutBarrier?: boolean; failSends?: number } = {}) {
  const storage = new FakeStorage()
  const store = new Map<string, string>()
  const calls: { ops: MirrorOp[]; barrierId?: string }[] = []
  const timers: { handle: number; at: number; callback: () => void }[] = []
  let clock = 1_000_000
  let nextHandle = 1
  let failuresLeft = options.failSends ?? 0
  const env: MirrorEnvironment = {
    storage: storage as unknown as Storage,
    async send(ops, barrierId) {
      calls.push({ ops, barrierId })
      if (failuresLeft > 0) {
        failuresLeft -= 1
        throw new Error('refused')
      }
      // Like the store: a rate limit that only a barrier id lifts.
      if (options.rateLimitWithoutBarrier && !barrierId) return { rateLimited: true }
      for (const op of ops) {
        if (op.op === 'set') store.set(op.key, op.value)
        else store.delete(op.key)
      }
    },
    sha256,
    async wipe() {},
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
    warn() {},
  }
  const mirror = createShellStateMirror(env)
  const advance = async (ms: number) => {
    clock += ms
    for (;;) {
      const due = timers.filter((timer) => timer.at <= clock).sort((a, b) => a.at - b.at)[0]
      if (!due) break
      timers.splice(timers.indexOf(due), 1)
      due.callback()
      for (let i = 0; i < 10; i += 1) await Promise.resolve()
    }
  }
  return { storage, store, mirror, calls, advance }
}

test('a barrier drains a rate-limited backlog with the barrier id and answers with the live digest', async () => {
  const { storage, store, mirror, calls, advance } = setup({ rateLimitWithoutBarrier: true })
  for (const [key, value] of [['one', '1'], ['two', 'ü']]) {
    storage.setItem(key, value)
    mirror.noteSet(key, value)
  }
  // Without a barrier the store answers "rate limited": nothing arrives.
  await advance(500)
  assert.equal(store.size, 0)

  const answer = await mirror.barrierDrain('gate-1')
  assert.equal(answer.error, undefined)
  assert.equal(answer.pendingEmpty, true)
  assert.deepEqual([...store.keys()].sort(), ['one', 'two'])
  assert.ok(calls.some((call) => call.barrierId === 'gate-1'))
  assert.equal(answer.digest, await contentDigest([['one', '1'], ['two', 'ü']], sha256))
  assert.equal(answer.keyCount, 2)
})

test('a barrier reconcile finds writes that never went through the hooks', async () => {
  const { storage, store, mirror } = setup()
  storage.setItem('hidden', 'written around the hooks')
  const answer = await mirror.barrierDrain('gate-2')
  assert.equal(store.get('hidden'), 'written around the hooks')
  assert.equal(answer.pendingEmpty, true)
})

test('the commit question counts the writes made after the drain answer, not before', async () => {
  const { storage, mirror } = setup()
  storage.setItem('a', '1')
  mirror.noteSet('a', '1')
  await mirror.barrierDrain('gate-3')
  assert.equal(mirror.barrierCommit('gate-3').writesSince, 0)
  mirror.noteSet('late', 'x')
  assert.equal(mirror.barrierCommit('gate-3').writesSince, 1)
  // The excluded crash marker and bookkeeping are not user state: they do not count.
  mirror.noteSet('nebula-browser-run-state-v1', '{}')
  mirror.noteSet('__nebula_hydration_id', 'x')
  assert.equal(mirror.barrierCommit('gate-3').writesSince, 1)
  // A commit for another barrier is refused.
  assert.ok(mirror.barrierCommit('other').error)
})

test('a barrier reports values that cannot be carried over, by name', async () => {
  const { storage, mirror } = setup()
  storage.setItem('fine', 'x')
  mirror.noteSet('lone', 'a' + String.fromCharCode(0xd800) + 'b')
  const answer = await mirror.barrierDrain('gate-4')
  assert.deepEqual(answer.unmirrorable, ['lone'])
})

test('a barrier says so when the store refuses, instead of claiming a drain', async () => {
  const { storage, mirror } = setup({ failSends: 100 })
  storage.setItem('a', '1')
  mirror.noteSet('a', '1')
  const answer = await mirror.barrierDrain('gate-5')
  assert.ok(answer.error)
  assert.equal(answer.pendingEmpty, false)
})

test('barrierEnd resumes normal mirroring without the barrier id', async () => {
  const { storage, mirror, calls, advance } = setup()
  await mirror.barrierDrain('gate-6')
  mirror.barrierEnd('gate-6')
  storage.setItem('later', '1')
  mirror.noteSet('later', '1')
  await advance(500)
  const last = calls.at(-1)
  assert.equal(last?.barrierId, undefined)
  assert.equal(last?.ops[0].key, 'later')
})

test('the shell wiring answers the gate and reports hydration, and the Rust commands exist for it', () => {
  const wiring = readFileSync(new URL('../src/platform/shellStateMirror.ts', import.meta.url), 'utf8')
  assert.match(wiring, /nebula-shell-barrier/)
  assert.match(wiring, /shell_isolation_barrier_ack/)
  assert.match(wiring, /shell_isolation_hydrated/)
  assert.match(wiring, /markBrowserRunClean/)
  const lib = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8')
  const permissions = readFileSync(new URL('../src-tauri/permissions/webview-commands.toml', import.meta.url), 'utf8')
  for (const name of [
    'shell_isolation_status',
    'shell_isolation_ack_notice',
    'shell_isolation_hydrated',
    'shell_isolation_barrier_ack',
    'shell_isolation_switch',
  ]) {
    assert.ok(lib.includes(`shell_isolation::${name},`), `${name} registered`)
    assert.ok(permissions.includes(`"${name}"`), `${name} has a permission entry`)
  }
  const capability = JSON.parse(
    readFileSync(new URL('../src-tauri/capabilities/shell-state-store.json', import.meta.url), 'utf8'),
  ) as { webviews: string[] }
  for (const label of capability.webviews) assert.doesNotMatch(label, /tab|popup|oauth|extension/)
})

test('the spike driver is not part of a product build', () => {
  const cargo = readFileSync(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8')
  assert.match(cargo, /split-driver = \[\]/)
  const lib = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8')
  assert.match(lib, /#\[cfg\(all\(target_os = "windows", feature = "split-driver"\)\)\]\s*mod spike_driver;/)
  assert.match(lib, /#\[cfg\(all\(target_os = "windows", feature = "split-driver"\)\)\]\s*spike_driver::start/)
})
