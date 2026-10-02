import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createCoalescedRestoreRepair, hasUsableWindowClientSize, restoreBrowsingSurfaces } from '../src/core/mainWebviewRestore.ts'

test('Home repairs must not poison Tauri proportional auto-resize metadata', () => {
  const frontend = readFileSync(new URL('../src/platform/tauriBrowser.ts', import.meta.url), 'utf8')
  const native = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8')
  assert.doesNotMatch(frontend, /main\.set(?:Size|Bounds)\(/)
  assert.doesNotMatch(native, /main\.set_(?:bounds|size)\(/)
  const layout = readFileSync(new URL('../src-tauri/src/main_webview_layout.rs', import.meta.url), 'utf8')
  assert.match(layout, /IsIconic\(hwnd\)/)
  assert.match(layout, /GetClientRect\(hwnd, &mut client\)/)
  assert.match(layout, /controller\s*\.SetBounds\(client\)/)
})

test('focus return restores a hidden site and Semi-Lunar without a resize event', async () => {
  const actions: string[] = []
  assert.equal(await restoreBrowsingSurfaces({
    canRestore: async () => true,
    restoreBounds: async () => { actions.push('bounds'); return true },
    showTab: async () => { actions.push('site') },
    showChrome: async () => { actions.push('chrome') },
    stack: async () => { actions.push('stack') },
  }), true)
  assert.deepEqual(actions, ['bounds', 'site', 'chrome', 'stack'])
})

test('restore stops when minimize, overlay, or tab replacement takes ownership', async () => {
  for (const stopAfter of ['before', 'bounds', 'site', 'chrome']) {
    const actions: string[] = []
    let current = stopAfter !== 'before'
    const step = (name: string) => {
      actions.push(name)
      if (name === stopAfter) current = false
    }
    assert.equal(await restoreBrowsingSurfaces({
      canRestore: async () => current,
      restoreBounds: async () => { step('bounds'); return true },
      showTab: async () => { step('site') },
      showChrome: async () => { step('chrome') },
      stack: async () => { step('stack') },
    }), false)
    const expected = ['bounds', 'site', 'chrome']
    assert.deepEqual(actions, expected.slice(0, expected.indexOf(stopAfter) + 1))
  }
})

test('transient site bounds cannot become usable restore geometry', async () => {
  for (const size of [{ width: 144, height: 90 }, { width: 144, height: 19 },
    { width: NaN, height: 800 }, { width: 1280, height: Infinity }]) {
    assert.equal(hasUsableWindowClientSize(size), false)
  }
  let shown = false
  assert.equal(await restoreBrowsingSurfaces({
    canRestore: async () => true,
    restoreBounds: async () => false,
    showTab: async () => { shown = true },
    showChrome: async () => { shown = true },
    stack: async () => { shown = true },
  }), false)
  assert.equal(shown, false)
})

test('restore bursts keep only the latest pending request and never overlap', async () => {
  const calls: string[] = []
  let release!: () => void
  const blocked = new Promise<void>((resolve) => { release = resolve })
  const queue = createCoalescedRestoreRepair(async (reason) => {
    calls.push(reason)
    if (reason === 'first') await blocked
  }, () => assert.fail('unexpected repair error'))
  queue.request('first')
  for (let index = 0; index < 1000; index++) queue.request(`resize-${index}`)
  assert.deepEqual(calls, ['first'])
  release()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(calls, ['first', 'resize-999'])
  queue.request('later')
  assert.deepEqual(calls, ['first', 'resize-999', 'later'])
})

test('failed restore work does not block the latest request', async () => {
  const calls: string[] = []
  const errors: string[] = []
  const queue = createCoalescedRestoreRepair(async (reason) => {
    calls.push(reason)
    if (reason === 'failed') throw new Error('failed')
  }, (reason) => { errors.push(reason) })
  queue.request('failed')
  queue.request('recovery')
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(calls, ['failed', 'recovery'])
  assert.deepEqual(errors, ['failed'])
})

test('cleanup drops pending repairs and rejects future requests', async () => {
  const calls: string[] = []
  let release!: () => void
  const blocked = new Promise<void>((resolve) => { release = resolve })
  const queue = createCoalescedRestoreRepair(async (reason) => {
    calls.push(reason)
    await blocked
  }, () => assert.fail('unexpected repair error'))
  queue.request('active')
  queue.request('pending')
  queue.dispose()
  queue.request('after-cleanup')
  release()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(calls, ['active'])
})

test('focus-return repair never lowers the visible site below Home', () => {
  const native = readFileSync('src-tauri/src/lib.rs', 'utf8')
  const browser = readFileSync('src/platform/tauriBrowser.ts', 'utf8')
  const start = native.indexOf('fn restore_browsing_webview_layout')
  const body = native.slice(start, start + 3000)
  // The active tab is laid out in place; only inactive tabs go to the bottom.
  assert.match(body, /active_tab_label == Some\(label\.as_str\(\)\)/)
  assert.match(body, /layout_webview_hwnd_in_place\(/)
  assert.match(native, /SWP_NOACTIVATE \| SWP_NOZORDER/)
  // Every repair that follows a focus or restore names the active tab.
  const calls = browser.match(/invoke\('webview_restore_browsing_layout', \{[\s\S]*?\}\)/g) ?? []
  assert.equal(calls.length, 2)
  for (const call of calls) assert.match(call, /activeTabLabel:/)
})
