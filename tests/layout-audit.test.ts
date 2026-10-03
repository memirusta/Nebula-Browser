import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  createLayoutAuditor,
  findLayoutFaults,
  type HostRect,
  type LayoutAudit,
  type LayoutExpectation,
  type LayoutFault,
} from '../src/core/layoutAudit.ts'

const expectation: LayoutExpectation = {
  mainLabel: 'main',
  chromeLabel: 'nebula-chrome',
  activeTabLabel: 'nebula-tab-a',
}
const host = (label: string, x: number, y: number, width: number, height: number, visible = true): HostRect => ({
  label, x, y, width, height, visible,
})
const healthy = (overrides: Partial<LayoutAudit> = {}): LayoutAudit => ({
  clientWidth: 1920,
  clientHeight: 1032,
  minimized: false,
  hosts: [
    host('main', 0, 0, 1920, 1032),
    host('nebula-chrome', 0, 0, 1920, 10),
    host('nebula-tab-a', 0, 0, 1920, 1032),
    host('nebula-tab-parked', -8384, -8000, 1, 1, false),
  ],
  ...overrides,
})

test('a healthy browsing layout has no faults (the collapsed strip, a previewed overlay and parked tabs are fine)', () => {
  assert.deepEqual(findLayoutFaults(healthy(), expectation), [])
  const previewed = healthy()
  previewed.hosts[1] = host('nebula-chrome', 0, 0, 1920, 1032)
  assert.deepEqual(findLayoutFaults(previewed, expectation), [])
  // Two pixels of rounding are not a fault.
  const rounded = healthy()
  rounded.hosts[2] = host('nebula-tab-a', 0, 1, 1919, 1033)
  assert.deepEqual(findLayoutFaults(rounded, expectation), [])
})

test('a tab or overlay shifted up by a frame offset is a fault, with what Windows really has', () => {
  const shifted = healthy()
  shifted.hosts[1] = host('nebula-chrome', 0, -8, 1920, 10)
  shifted.hosts[2] = host('nebula-tab-a', 0, -8, 1920, 1032)
  const faults = findLayoutFaults(shifted, expectation)
  assert.deepEqual(faults.map((fault) => fault.label).sort(), ['nebula-chrome', 'nebula-tab-a'])
  assert.deepEqual(faults.find((fault) => fault.label === 'nebula-tab-a')?.actual, { x: 0, y: -8, width: 1920, height: 1032 })
})

test('a tab that is the wrong size, hidden, or missing, and an overlay that does not span the window, are faults; a hidden overlay is not', () => {
  const small = healthy()
  small.hosts[2] = host('nebula-tab-a', 0, 0, 1280, 800)
  assert.equal(findLayoutFaults(small, expectation)[0].reason, 'offset-or-size')

  const hidden = healthy()
  hidden.hosts[2] = host('nebula-tab-a', 0, 0, 1920, 1032, false)
  assert.equal(findLayoutFaults(hidden, expectation)[0].reason, 'hidden')

  const missing = healthy()
  missing.hosts = missing.hosts.filter((entry) => entry.label !== 'nebula-tab-a')
  assert.equal(findLayoutFaults(missing, expectation)[0].reason, 'missing')

  const narrow = healthy()
  narrow.hosts[1] = host('nebula-chrome', 0, 0, 1280, 10)
  assert.equal(findLayoutFaults(narrow, expectation)[0].label, 'nebula-chrome')

  // The overlay is legitimately hidden while a dialog owns the window, or not created yet.
  const suppressed = healthy()
  suppressed.hosts[1] = host('nebula-chrome', 0, -8, 1920, 10, false)
  assert.deepEqual(findLayoutFaults(suppressed, expectation), [])
  const absent = healthy()
  absent.hosts = absent.hosts.filter((entry) => entry.label !== 'nebula-chrome')
  assert.deepEqual(findLayoutFaults(absent, expectation), [])

  const shell = healthy()
  shell.hosts[0] = host('main', 0, -8, 1920, 1032)
  assert.equal(findLayoutFaults(shell, expectation)[0].label, 'main')
})

test('a minimized window or a transient tiny client size is not judged', () => {
  const broken = healthy({ minimized: true })
  broken.hosts[2] = host('nebula-tab-a', 190, 183, 1900, 1000)
  assert.deepEqual(findLayoutFaults(broken, expectation), [])
  assert.deepEqual(findLayoutFaults(healthy({ clientWidth: 160, clientHeight: 28 }), expectation), [])
})

function auditorHarness(script: (LayoutFault[] | null | Error)[], overrides: { cooldownMs?: number; confirmations?: number } = {}) {
  let clock = 0
  const timers: { id: number; at: number; callback: () => void }[] = []
  let nextId = 1
  let reads = 0
  const reported: LayoutFault[][] = []
  const auditor = createLayoutAuditor({
    intervalMs: 1000,
    confirmations: overrides.confirmations ?? 2,
    cooldownMs: overrides.cooldownMs ?? 5000,
    now: () => clock,
    setTimer(callback, ms) {
      const id = nextId++
      timers.push({ id, at: clock + ms, callback })
      return id
    },
    clearTimer(handle) {
      const index = timers.findIndex((timer) => timer.id === handle)
      if (index >= 0) timers.splice(index, 1)
    },
    async read() {
      const step = script[Math.min(reads, script.length - 1)]
      reads += 1
      if (step instanceof Error) throw step
      return step
    },
    onFault(faults) {
      reported.push(faults)
    },
  })
  // Time passes in small steps, so a timer set by a tick that fires inside the span fires too.
  const advance = async (ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 100) {
      clock += 100
      for (;;) {
        const due = timers.filter((timer) => timer.at <= clock).sort((a, b) => a.at - b.at)[0]
        if (!due) break
        timers.splice(timers.indexOf(due), 1)
        due.callback()
        for (let index = 0; index < 20; index += 1) await Promise.resolve()
      }
    }
  }
  return { auditor, advance, reported, reads: () => reads }
}

const fault = (y: number): LayoutFault => ({
  label: 'nebula-tab-a',
  reason: 'offset-or-size',
  expected: '0,0 1920x1032',
  actual: { x: 0, y, width: 1920, height: 1032 },
})

test('the same difference twice in a row is repaired once; a changing one (a drag, a restore) is not', async () => {
  const stable = auditorHarness([[fault(-8)]])
  stable.auditor.start()
  await stable.advance(1000)
  assert.equal(stable.reported.length, 0, 'one sighting is not enough')
  await stable.advance(1000)
  assert.equal(stable.reported.length, 1)
  assert.equal(stable.reported[0][0].actual?.y, -8)
  stable.auditor.stop()

  const moving = auditorHarness([[fault(-8)], [fault(-4)], [fault(-2)], [fault(-1)], []])
  moving.auditor.start()
  await moving.advance(5000)
  assert.equal(moving.reported.length, 0)
  moving.auditor.stop()
})

test('a healthy or unjudged audit resets the count, and a read that fails is not a fault', async () => {
  const flapping = auditorHarness([[fault(-8)], [], [fault(-8)], null, [fault(-8)]])
  flapping.auditor.start()
  await flapping.advance(5000)
  assert.equal(flapping.reported.length, 0)
  flapping.auditor.stop()

  const failing = auditorHarness([new Error('window is going away')])
  failing.auditor.start()
  await failing.advance(5000)
  assert.equal(failing.reported.length, 0)
  assert.ok(failing.reads() >= 4, 'it keeps looking')
  failing.auditor.stop()
})

test('a repair is requested at most once per cooldown, then again if the difference stays', async () => {
  const stuck = auditorHarness([[fault(-8)]], { cooldownMs: 5000 })
  stuck.auditor.start()
  await stuck.advance(2000)
  assert.equal(stuck.reported.length, 1)
  await stuck.advance(4000) // still inside the cooldown
  assert.equal(stuck.reported.length, 1)
  await stuck.advance(6000)
  assert.ok(stuck.reported.length >= 2, 'a repair that did not hold is tried again')
  stuck.auditor.stop()
  const before = stuck.reported.length
  await stuck.advance(20_000)
  assert.equal(stuck.reported.length, before, 'stop() ends the looking')
})

test('the native audit is registered and the shell wires it into the restore repair', () => {
  const read = (path: string) =>
    readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))
  assert.match(read('src-tauri/src/lib.rs'), /layout_audit::webview_layout_audit,/)
  assert.ok(read('src-tauri/permissions/webview-commands.toml').includes('"webview_layout_audit"'))
  const browser = read('src/platform/tauriBrowser.ts')
  const start = browser.indexOf('const layoutAuditor = createLayoutAuditor(')
  assert.ok(start > 0, 'the auditor exists')
  const body = browser.slice(start, browser.indexOf('layoutAuditor.start()', start))
  // It is only judged while a site is shown and nothing else owns the geometry.
  for (const condition of ['siteFullscreenBounds', '_restoreRepairInProgress', 'isBrowsingChromeExpected()', 'tabActivationRequests.size > 0', 'currentWindowIsMinimized()']) {
    assert.ok(body.includes(condition), condition)
  }
  assert.match(body, /requestBrowsingSurfaceRepair\('layout-audit'\)/)
  assert.match(browser, /layoutAuditor\.stop\(\)/)
})

test('leaving site fullscreen restores the layout WITH the rectangle the command requires', () => {
  const read = (path: string) =>
    readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))
  const fullscreen = read('src/platform/tauriSiteFullscreen.ts')
  const call = fullscreen.slice(fullscreen.indexOf("invoke('webview_restore_browsing_layout'"))
  const args = call.slice(0, call.indexOf('})'))
  for (const key of ['windowLabel', 'x:', 'y:', 'width:', 'height:', 'activeTabLabel']) {
    assert.ok(args.includes(key), `the call passes ${key}`)
  }
  // The native command takes exactly these (a missing key is refused before the code runs).
  const lib = read('src-tauri/src/lib.rs')
  const signature = lib.slice(lib.indexOf('fn webview_restore_browsing_layout('), lib.indexOf(') -> Result<(), String>', lib.indexOf('fn webview_restore_browsing_layout(')))
  for (const key of ['window_label', 'x: i32', 'y: i32', 'width: i32', 'height: i32', 'active_tab_label']) {
    assert.ok(signature.includes(key), `the command takes ${key}`)
  }
})

test('each fault carries the rectangle that fixes it, and the overlay keeps a valid height', () => {
  const shifted = healthy()
  shifted.hosts[1] = host('nebula-chrome', 0, -8, 1920, 10)
  shifted.hosts[2] = host('nebula-tab-a', 0, -8, 1920, 1032)
  const faults = findLayoutFaults(shifted, expectation)
  assert.deepEqual(faults.find((fault) => fault.label === 'nebula-tab-a')?.fix, { x: 0, y: 0, width: 1920, height: 1032 })
  assert.deepEqual(faults.find((fault) => fault.label === 'nebula-chrome')?.fix, { x: 0, y: 0, width: 1920, height: 10 })
  // A previewed overlay keeps its height; an impossible one falls back to the strip.
  const taller = healthy()
  taller.hosts[1] = host('nebula-chrome', 12, 0, 1920, 400)
  assert.equal(findLayoutFaults(taller, expectation)[0].fix.height, 400)
  const absurd = healthy()
  absurd.hosts[1] = host('nebula-chrome', 12, 0, 1920, 5000)
  assert.equal(findLayoutFaults(absurd, expectation)[0].fix.height, 10)
})
