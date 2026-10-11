import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  closesWhenEmptied,
  parseBrowserWindowDropTarget,
  resolveBrowserDropAction,
} from '../src/core/browserDropTarget.ts'
import { confirmCursorOutsideLunar } from '../src/core/lunarDrop.ts'

test('a tab released outside the dome but over its own window detaches to a new window', () => {
  assert.deepEqual(
    resolveBrowserDropAction({ kind: 'window', label: 'main' }, 'main'),
    { kind: 'new-window' },
  )
})

test('a drop on another Nebula window targets that existing window', () => {
  assert.deepEqual(
    resolveBrowserDropAction(
      { kind: 'window', label: 'nebula-window-2' },
      'main',
    ),
    { kind: 'existing-window', windowId: 'nebula-window-2' },
  )
})

test('only a positive outside measurement creates a new window', () => {
  assert.deepEqual(
    resolveBrowserDropAction({ kind: 'outside' }, 'main'),
    { kind: 'new-window' },
  )
  assert.deepEqual(
    resolveBrowserDropAction({ kind: 'unknown' }, 'main'),
    { kind: 'unresolved' },
  )
})

test('malformed native results are unknown, never outside', () => {
  for (const value of [
    null,
    undefined,
    'main',
    42,
    {},
    { kind: 'window' },
    { kind: 'window', label: '' },
    { kind: 'window', label: 7 },
    { kind: 'sideways' },
  ]) {
    assert.deepEqual(parseBrowserWindowDropTarget(value), { kind: 'unknown' })
  }
  assert.deepEqual(parseBrowserWindowDropTarget({ kind: 'outside' }), {
    kind: 'outside',
  })
  assert.deepEqual(
    parseBrowserWindowDropTarget({ kind: 'window', label: 'main' }),
    { kind: 'window', label: 'main' },
  )
})

test('tab drops keep the tab in place when the drop target is unresolved', () => {
  const shell = readFileSync('src/components/BrowserShell/BrowserShell.tsx', 'utf8')
  const workspace = readFileSync('src/platform/tauriBrowserWorkspace.ts', 'utf8')
  const start = shell.indexOf('const moveTabBetweenWindows')
  const body = shell.slice(start, start + 6000)
  assert.match(body, /resolveBrowserDropAction\(/)
  assert.match(
    body,
    /dropAction\.kind === 'unresolved'\)\s*\{[\s\S]*?return\s*\}/,
  )
  // The unresolved return must come before any transfer or window creation.
  assert.ok(
    body.indexOf("dropAction.kind === 'unresolved') {") <
      body.indexOf('createBrowserTabTransfer('),
  )
  // A geometry-only miss must not be reported as a positive outside result.
  assert.doesNotMatch(workspace, /kind: 'outside'/)
})

test('native window lookup enumerates real windows, not single-webview windows', () => {
  const native = readFileSync('src-tauri/src/browser_workspace.rs', 'utf8')
  // Tauri's webview_windows() omits every window that hosts a child WebView
  // with a different label, which is all Nebula windows (Chrome + tab WebViews).
  assert.doesNotMatch(native, /app\s*\.webview_windows\(\)/)
  assert.match(native, /for \(label, window\) in app\.windows\(\)/)
})

test('a secondary window closes when it loses its last tab, main never does', () => {
  assert.equal(closesWhenEmptied('nebula-window-5c29c157'), true)
  assert.equal(closesWhenEmptied('main'), false)
  assert.equal(closesWhenEmptied(''), false)
  assert.equal(closesWhenEmptied('extension-ui-1'), false)
})

test('a drop counts as outside the dome only after two definite misses', async () => {
  const run = async (readings: Array<boolean | null>) => {
    const queue = [...readings]
    let waits = 0
    const outside = await confirmCursorOutsideLunar(
      async () => queue.shift() ?? null,
      async () => { waits += 1 },
    )
    return { outside, waits }
  }
  assert.deepEqual(await run([false, false]), { outside: true, waits: 1 })
  // One stale miss while the WebView resizes must not detach the tab.
  assert.deepEqual(await run([false, true]), { outside: false, waits: 1 })
  assert.deepEqual(await run([true]), { outside: false, waits: 0 })
  // An unavailable hit-test is never proof of "outside".
  assert.deepEqual(await run([null]), { outside: false, waits: 0 })
  assert.deepEqual(await run([false, null]), { outside: false, waits: 1 })
})

test('Semi-Lunar only emits tab drops for releases confirmed outside the dome', () => {
  const menu = readFileSync('src/components/SemiLunarMenu/SemiLunarMenu.tsx', 'utf8')
  assert.match(menu, /confirmCursorOutsideLunar\(/)
  assert.match(menu, /void handleTabReleased\(openTabId, screenX, screenY\)/)
  assert.doesNotMatch(menu, /onTabDragDrop\?\.\(openTabId/)
})

test('an emptied secondary window closes only after the transfer is claimed', () => {
  const shell = readFileSync('src/components/BrowserShell/BrowserShell.tsx', 'utf8')
  const start = shell.indexOf('const moveTabBetweenWindows')
  const body = shell.slice(start, start + 12000)
  const claim = body.indexOf('await waitForBrowserTabTransferClaim(')
  const close = body.indexOf('await getCurrentWindow().close()')
  assert.ok(claim !== -1 && close !== -1 && claim < close)
  assert.match(body, /sourceWillBeEmpty && closesWhenEmptied\(sourceWindowId\)/)
})
