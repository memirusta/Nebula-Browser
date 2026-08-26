import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function read(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('tab mute changes the real WebView2 audio state and returns through the tab catalog', () => {
  const controls = read('src-tauri/src/webview_controls.rs')
  const native = read('src-tauri/src/lib.rs')
  const permissions = read('src-tauri/permissions/webview-commands.toml')
  const platform = read('src/platform/tauriBrowser.ts')
  const shell = read('src/components/BrowserShell/BrowserShell.tsx')
  const chrome = read('src/ChromeApp.tsx')
  const semiLunar = read('src/components/SemiLunarMenu/SemiLunarMenu.tsx')

  assert.match(controls, /pub fn webview_set_muted/)
  assert.match(controls, /ICoreWebView2_8/)
  assert.match(controls, /SetIsMuted\(muted\)/)
  assert.match(native, /webview_controls::webview_set_muted/)
  assert.match(permissions, /"webview_set_muted"/)
  assert.match(platform, /invoke\('webview_set_muted'/)
  assert.match(shell, /case 'set-tab-muted'/)
  assert.match(shell, /updateTabMeta\(action\.shortcutId, \{ isMuted: action\.muted \}\)/)
  assert.match(chrome, /type: 'set-tab-muted'/)
  assert.match(semiLunar, /onToggleMute\?\.\([\s\S]*resolveCloseTabId\(contextMenu\.shortcut\.id\)/)
  assert.match(semiLunar, /muted=\{isMuted\(openTabId \?\? item\.id\)\}/)
})

test('tab search is reachable from site WebViews and supports switch, close, and mute', () => {
  const shortcuts = read('src/core/browserShortcuts.ts')
  const nativeShortcuts = read('src-tauri/src/tab_shortcuts.rs')
  const bridge = read('src/core/nebulaBridge.ts')
  const chrome = read('src/ChromeApp.tsx')
  const tabSearch = read('src/components/TabSearch/TabSearch.tsx')

  assert.match(shortcuts, /'open-tab-search': \['Ctrl\+Shift\+A'\]/)
  assert.match(nativeShortcuts, /"open-tab-search"\.into\(\), vec!\["Ctrl\+Shift\+A"\.into\(\)\]/)
  assert.match(bridge, /nebula-tab-search-request/)
  assert.match(chrome, /listenTabSearchRequests/)
  assert.match(tabSearch, /Search title or address/)
  assert.match(tabSearch, /onToggleMute\(tab\.shortcutId\)/)
  assert.match(tabSearch, /onCloseTab\(tab\.shortcutId\)/)
})

test('Ctrl+H opens history through the overlay and widgets keep a compact scrollbar', () => {
  const shortcuts = read('src/core/browserShortcuts.ts')
  const nativeShortcuts = read('src-tauri/src/tab_shortcuts.rs')
  const shell = read('src/components/BrowserShell/BrowserShell.tsx')
  const widgetGrid = read('src/components/SpatialGrid/HomeWidgetGrid.module.css')

  assert.match(shortcuts, /'open-history': \['Ctrl\+H'\]/)
  assert.match(nativeShortcuts, /"open-history"\.into\(\), vec!\["Ctrl\+H"\.into\(\)\]/)
  assert.match(
    shell,
    /viewModeRef\.current ===\s*'browsing'[\s\S]{0,500}setOverlayModeActive\([\s\S]{0,120}true[\s\S]{0,300}setViewMode\([\s\S]{0,120}'overlay'[\s\S]{0,300}setHistoryPanelOpen\([\s\S]{0,120}true/,
  )
  assert.match(shell, /case 'open-history':[\s\S]{0,120}toggleHistoryPanel\(\)/)
  assert.match(widgetGrid, /\.gridArea::\-webkit-scrollbar\s*\{\s*width:\s*3px/)
  assert.match(widgetGrid, /scrollbar-color:\s*rgba\(255, 255, 255, 0\.18\) transparent/)
})

test('every widget header dot follows the selected accent color', () => {
  const widgetChrome = read('src/components/SpatialGrid/GridCell.module.css')

  assert.match(
    widgetChrome,
    /\.tabDot\s*\{[\s\S]*?background:\s*var\(--nebula-accent\)/,
  )
  assert.doesNotMatch(
    widgetChrome,
    /\.tabDot\s*\{[\s\S]*?background:\s*var\(--nebula-text-muted\)/,
  )
  assert.match(
    widgetChrome,
    /\.tabDot\[data-active='true'\]\s*\{[\s\S]*?box-shadow:\s*0 0 8px var\(--nebula-accent-glow\)/,
  )
})

test('network connectivity dot is green online and red offline', () => {
  const tokens = read('src/styles/tokens.css')
  const widgets = read('src/components/widgets/widgets.module.css')

  assert.match(tokens, /--nebula-success:\s*#4ade80/)
  assert.match(
    widgets,
    /\.networkDot\s*\{[\s\S]*?background:\s*var\(--nebula-danger\)/,
  )
  assert.match(
    widgets,
    /\.networkStatus\[data-online='true'\] \.networkDot\s*\{[\s\S]*?background:\s*var\(--nebula-success\)/,
  )
})

test('settings search indexes every settings surface and notifications are grouped by site', () => {
  const settings = read('src/components/SettingsPanel/SettingsPanel.tsx')
  const notifications = read('src/components/NotificationPanel/NotificationPanel.tsx')

  assert.match(settings, /SETTINGS_SEARCH_KEYS/)
  assert.match(settings, /localizedSettingsSearchEntry/)
  assert.match(settings, /SHORTCUT_REFERENCE\.flatMap/)
  assert.match(settings, /normalizeSettingsSearchText/)
  assert.match(settings, /tokens\.every\(\(token\) => searchable\.includes\(token\)\)/)
  assert.match(settings, /Ayarlarda ara/)
  assert.match(settings, /'privateMode'/)
  assert.match(settings, /settingsSearchResults/)
  assert.match(notifications, /const notificationGroups = useMemo/)
  assert.match(notifications, /const key = item\.origin \?\? `kind:\$\{item\.kind\}`/)
  assert.match(notifications, /group\.items\.map/)
  assert.match(notifications, /group\.unreadCount/)
})

test('tab performance housekeeping releases lifecycle keys and idle memory polling', () => {
  const queue = read('src/core/keyedLifecycleQueue.ts')
  const browser = read('src/platform/tauriBrowser.ts')
  const shell = read('src/components/BrowserShell/BrowserShell.tsx')

  assert.match(queue, /async releaseWhenIdle\(key: K\)/)
  assert.match(queue, /state\.tail !== observedTail/)
  assert.match(browser, /await tabLifecycleQueue\.releaseWhenIdle\(shortcutId\)/)
  assert.match(browser, /function stopMemoryPressureMonitorIfIdle/)
  assert.match(browser, /window\.clearInterval\(memoryPressurePollTimer\)/)
  assert.match(browser, /tabUnloadInFlight\.delete[\s\S]*stopMemoryPressureMonitorIfIdle\(\)/)
  assert.match(shell, /showSystemWidgets &&\s+isHome &&/)
})
