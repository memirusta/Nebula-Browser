import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const script = readFileSync(
  new URL('../src-tauri/src/site_scripts/youtube_player_recovery.js', import.meta.url),
  'utf8',
)

interface Page {
  host?: string
  path?: string
  search?: string
  video?: { readyState: number } | null
  visible?: boolean
  storage?: 'works' | 'throws'
  top?: boolean
}

/** Runs the real script in a fake page whose clock and timers the test controls. */
function open(page: Page = {}) {
  let now = 1_000_000
  let nextId = 1
  const timers = new Map<number, { at: number; run: () => void }>()
  const listeners = new Map<string, Array<() => void>>()
  const add = (type: string, fn: () => void) => listeners.set(type, [...(listeners.get(type) ?? []), fn])
  const stored = new Map<string, string>()
  const state = {
    host: page.host ?? 'www.youtube.com',
    path: page.path ?? '/watch',
    search: page.search ?? '?v=abc123',
    video: page.video === undefined ? null : page.video,
    visible: page.visible ?? true,
    reloads: 0,
  }
  const sandbox: Record<string, unknown> = {}
  sandbox.window = sandbox
  sandbox.top = page.top === false ? {} : sandbox
  sandbox.addEventListener = add
  sandbox.URLSearchParams = URLSearchParams
  sandbox.JSON = JSON
  sandbox.Date = { now: () => now }
  sandbox.setTimeout = (run: () => void, ms: number) => {
    const id = nextId++
    timers.set(id, { at: now + ms, run })
    return id
  }
  sandbox.clearTimeout = (id: number) => timers.delete(id)
  sandbox.sessionStorage = {
    getItem: (key: string) => {
      if (page.storage === 'throws') throw new Error('blocked')
      return stored.get(key) ?? null
    },
    setItem: (key: string, value: string) => {
      if (page.storage === 'throws') throw new Error('blocked')
      stored.set(key, value)
    },
  }
  sandbox.location = {
    get hostname() {
      return state.host
    },
    get pathname() {
      return state.path
    },
    get search() {
      return state.search
    },
    reload: () => {
      state.reloads += 1
    },
  }
  sandbox.document = {
    readyState: 'complete',
    get visibilityState() {
      return state.visible ? 'visible' : 'hidden'
    },
    querySelector: () => state.video,
    addEventListener: add,
    removeEventListener: (type: string, fn: () => void) =>
      listeners.set(type, (listeners.get(type) ?? []).filter((item) => item !== fn)),
  }
  vm.runInNewContext(script, sandbox)
  return {
    state,
    /** Moves the clock and runs the timers that fall due. */
    advance(ms: number) {
      now += ms
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(id)
          timer.run()
        }
      }
    },
    emit(type: string) {
      for (const fn of listeners.get(type) ?? []) fn()
    },
    navigate(path: string, search: string) {
      state.path = path
      state.search = search
    },
    pendingTimers: () => timers.size,
  }
}

test('a watch page whose player loaded nothing is reloaded once, after three seconds', () => {
  const tab = open()
  tab.advance(2_900)
  assert.equal(tab.state.reloads, 0, 'not before three seconds')
  tab.advance(200)
  assert.equal(tab.state.reloads, 1)
})

test('a player that has data is left alone', () => {
  const tab = open({ video: { readyState: 4 } })
  tab.advance(10_000)
  assert.equal(tab.state.reloads, 0)
})

test('the same video is not reloaded again within a minute, but may be after it', () => {
  const tab = open()
  tab.advance(3_100)
  assert.equal(tab.state.reloads, 1)
  // The reloaded page runs the script again; YouTube's own navigation event arms it a second time.
  tab.emit('yt-navigate-finish')
  tab.advance(3_100)
  assert.equal(tab.state.reloads, 1, 'a loop is not possible')
  tab.advance(60_000)
  tab.emit('yt-navigate-finish')
  tab.advance(3_100)
  assert.equal(tab.state.reloads, 2)
})

test('only YouTube watch pages in the top frame are touched', () => {
  for (const page of [
    { host: 'www.example.com' },
    { host: 'm.youtube.com' },
    { path: '/feed/subscriptions', search: '' },
    { path: '/', search: '' },
    { top: false },
  ]) {
    const tab = open(page)
    assert.equal(tab.pendingTimers(), 0, JSON.stringify(page))
    tab.advance(30_000)
    assert.equal(tab.state.reloads, 0, JSON.stringify(page))
  }
})

test('clicking a video inside YouTube (in-page navigation) is checked too, and leaving cancels it', () => {
  const tab = open({ path: '/', search: '' })
  assert.equal(tab.pendingTimers(), 0)
  tab.navigate('/watch', '?v=next1')
  tab.emit('yt-navigate-finish')
  tab.advance(3_100)
  assert.equal(tab.state.reloads, 1)

  const leaving = open()
  leaving.emit('yt-navigate-start')
  leaving.navigate('/', '')
  leaving.advance(20_000)
  assert.equal(leaving.state.reloads, 0, 'a page the user already left is not reloaded')
})

test('a player that starts loading in time is not reloaded', () => {
  const tab = open()
  tab.advance(1_500)
  tab.state.video = { readyState: 1 }
  tab.advance(3_000)
  assert.equal(tab.state.reloads, 0)
})

test('a background tab is checked when it is shown, not before', () => {
  const tab = open({ visible: false })
  tab.advance(6_000)
  assert.equal(tab.state.reloads, 0)
  tab.state.visible = true
  tab.emit('visibilitychange')
  tab.advance(3_100)
  assert.equal(tab.state.reloads, 1)
})

test('without session storage nothing is reloaded: a loop could not be ruled out', () => {
  const tab = open({ storage: 'throws' })
  tab.advance(10_000)
  assert.equal(tab.state.reloads, 0)
})
