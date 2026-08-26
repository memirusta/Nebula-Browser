import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  BROWSER_SESSION_SCHEMA_VERSION,
  CURRENT_SESSION_KEY,
  loadBrowserSessionSnapshot,
  serializeBrowserSessionSnapshot,
  upsertBrowserSessionWindow,
  type BrowserWindowSessionSnapshot,
  type PersistedBrowserTab,
} from '../src/core/browserSessionSnapshot.ts'
import {
  browserTabWebviewLabel,
  createBrowserWorkspace,
  transferWorkspaceTab,
} from '../src/core/browserWorkspace.ts'
import { createTabNavigationState } from '../src/core/tabNavigation.ts'
import {
  LUNAR_CHROME_SAFE_BOTTOM,
  clampBelowLunarChrome,
  createLunarMetrics,
} from '../src/core/shortcutLayout.ts'
import { isIconDiscInsideLunarDome } from '../src/core/lunarShape.ts'

class MemoryStorage {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

function tab(id: string, shortcutId = id): PersistedBrowserTab {
  const url = `https://${id}.example/path`
  return {
    tabId: id,
    shortcutId,
    url,
    title: id,
    favicon: `https://${id}.example/favicon.ico`,
    navigation: createTabNavigationState(url, id),
  }
}

function browserWindow(
  windowId: string,
  tabs: PersistedBrowserTab[],
): BrowserWindowSessionSnapshot {
  return {
    windowId,
    tabs,
    activeTabId: tabs[0]?.tabId ?? null,
  }
}

test('Ctrl+N is the default new-window browser shortcut', () => {
  const shortcuts = readFileSync('src/core/browserShortcuts.ts', 'utf8')
  assert.match(shortcuts, /'new-window': \['Ctrl\+N'\]/)
})

test('browser shortcut events are isolated to their owning window', () => {
  const bridge = readFileSync('src/core/nebulaBridge.ts', 'utf8')
  const chrome = readFileSync('src/ChromeApp.tsx', 'utf8')
  const shellHook = readFileSync('src/hooks/useBrowserShortcuts.ts', 'utf8')
  const native = readFileSync('src-tauri/src/tab_shortcuts.rs', 'utf8')

  assert.match(
    bridge,
    /emit\(scoped\(BROWSER_SHORTCUT_EVENT\), action\)/,
  )
  assert.match(
    bridge,
    /listen<BrowserShortcutId>\(\s*scoped\(BROWSER_SHORTCUT_EVENT\)/,
  )
  assert.match(chrome, /emitBrowserShortcut\(action\)/)
  assert.doesNotMatch(chrome, /emit\(['"]nebula-browser-shortcut['"]/)
  assert.match(shellHook, /listenBrowserShortcutActions\(dispatch\)/)
  assert.match(
    native,
    /format!\("nebula-browser-shortcut:\{target\}"\)/,
  )
})

test('browser workspace keeps independent tab collections and active tabs', () => {
  const first = browserWindow('main', [tab('alpha')])
  const second = browserWindow('nebula-window-two', [tab('beta')])
  const workspace = createBrowserWorkspace([first, second], second.windowId)

  assert.deepEqual(workspace.windows[0]?.tabs.map((entry) => entry.tabId), ['alpha'])
  assert.deepEqual(workspace.windows[1]?.tabs.map((entry) => entry.tabId), ['beta'])
  assert.equal(workspace.mostRecentlyActiveWindowId, second.windowId)
})

test('drag transfer moves one tab, activates it, and leaves the source empty', () => {
  const moved = tab('moved', 'duplicate')
  const workspace = createBrowserWorkspace([
    browserWindow('main', [moved]),
    browserWindow('nebula-window-target', [tab('existing', 'duplicate')]),
  ])
  const transferred = transferWorkspaceTab(
    workspace,
    'main',
    'nebula-window-target',
    moved.tabId,
  )

  assert.equal(transferred.windows[0]?.tabs.length, 0)
  assert.equal(transferred.windows[0]?.activeTabId, null)
  assert.equal(transferred.windows[1]?.tabs.length, 2)
  assert.equal(transferred.windows[1]?.activeTabId, moved.tabId)
  assert.equal(transferred.windows[1]?.tabs[1]?.shortcutId, 'moved-moved')
})

test('dropping onto the source window cancels without changing workspace state', () => {
  const workspace = createBrowserWorkspace([
    browserWindow('main', [tab('stay')]),
  ])
  assert.equal(
    transferWorkspaceTab(workspace, 'main', 'main', 'stay'),
    workspace,
  )
})

test('saved tab positions migrate below native window controls', () => {
  const metrics = createLunarMetrics(1100, 152)
  const iconSize = 44
  const safe = clampBelowLunarChrome(1016.82, 23, iconSize, metrics)

  assert.ok(safe.y - iconSize / 2 >= LUNAR_CHROME_SAFE_BOTTOM)
  assert.ok(safe.x < 1016.82)
  assert.equal(
    isIconDiscInsideLunarDome(safe.x, safe.y, iconSize / 2, metrics),
    true,
  )
})

test('window-scoped WebView labels cannot collide for equal tab ids', () => {
  const first = browserTabWebviewLabel('main', 'same-tab')
  const second = browserTabWebviewLabel('nebula-window-two', 'same-tab')
  assert.equal(first, 'nebula-tab-main-same-tab')
  assert.notEqual(first, second)
})

test('session merge restores multiple windows without overwriting siblings', () => {
  const first = browserWindow('main', [tab('alpha')])
  const second = browserWindow('nebula-window-two', [tab('beta')])
  const one = upsertBrowserSessionWindow(null, first)
  const two = upsertBrowserSessionWindow(one, second)
  const storage = new MemoryStorage()
  storage.setItem(CURRENT_SESSION_KEY, serializeBrowserSessionSnapshot(two))

  const restored = loadBrowserSessionSnapshot(storage)
  assert.equal(restored?.schemaVersion, BROWSER_SESSION_SCHEMA_VERSION)
  assert.deepEqual(restored?.windows.map((window) => window.windowId), [
    'main',
    'nebula-window-two',
  ])
})

test('native transfer uses Tauri reparent and drag cancellation has no teardown path', () => {
  const native = readFileSync('src-tauri/src/browser_workspace.rs', 'utf8')
  const shell = readFileSync('src/components/BrowserShell/BrowserShell.tsx', 'utf8')
  const browser = readFileSync('src/platform/tauriBrowser.ts', 'utf8')
  const workspace = readFileSync('src/platform/tauriBrowserWorkspace.ts', 'utf8')
  assert.match(native, /tab\.reparent\(&target\)/)
  assert.match(native, /parent_window_label = tab\.window\(\)\.label\(\)/)
  assert.match(workspace, /confirmedParentLabel !== targetWindowLabel/)
  assert.doesNotMatch(browser, /Transferred webview.*webview\.window\.label/)
  assert.match(shell, /windowAtPoint === currentBrowserWindowLabel\(\)/)
  assert.match(shell, /relinquishBrowseTabOwnership\(shortcutId\)/)
})
