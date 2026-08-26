import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('custom fullscreen state is owned natively and guards Semi-Lunar window interactions', () => {
  const native = readFileSync('src-tauri/src/site_fullscreen_window.rs', 'utf8')
  const lib = readFileSync('src-tauri/src/lib.rs', 'utf8')
  const permissions = readFileSync('src-tauri/permissions/webview-commands.toml', 'utf8')
  const maximize = readFileSync('src/platform/windowMaximize.ts', 'utf8')
  const drag = readFileSync('src/components/WindowChrome/LunarWindowDrag.tsx', 'utf8')
  const controls = readFileSync('src/components/WindowChrome/WindowControls.tsx', 'utf8')

  assert.match(native, /struct WindowPresentationState/)
  assert.match(native, /browser_fullscreen: bool/)
  assert.match(native, /site_fullscreen: bool/)
  assert.match(native, /maximized: bool/)
  assert.match(native, /BROWSER_SAVED_PLACEMENT/)
  assert.match(native, /SITE_SAVED_PLACEMENT/)
  assert.match(native, /struct SavedWindowState/)
  assert.match(native, /outer_rect: RECT/)
  assert.match(native, /restore_on_exit: bool/)
  assert.match(native, /GetWindowRect\(hwnd, &mut outer_rect\)/)

  const restoreStart = native.indexOf('fn uncover_monitor')
  const restoreEnd = native.indexOf('pub fn window_presentation_state')
  const restore = native.slice(restoreStart, restoreEnd)
  assert.match(restore, /SetWindowPlacement\(hwnd, placement\)/)
  assert.match(
    restore,
    /if placement\.showCmd != SW_SHOWMAXIMIZED\.0 as u32[\s\S]{0,500}saved_state\.outer_rect[\s\S]{0,500}SetWindowPos/,
  )

  const siteExitStart = native.indexOf('pub fn exit_site_fullscreen_window')
  const siteExitEnd = native.indexOf('pub fn toggle_browser_fullscreen_window')
  const siteExit = native.slice(siteExitStart, siteExitEnd)
  assert.match(siteExit, /restore_fallback_geometry/)
  assert.match(siteExit, /rects_match\(&client, &monitor\)/)
  assert.match(siteExit, /state\.restore_on_exit/)
  assert.match(
    siteExit,
    /uncover_monitor\([\s\S]{0,180}restore_fallback_geometry/,
  )

  assert.match(lib, /fn window_presentation_state\(/)
  assert.match(lib, /window_presentation_state,/)
  assert.match(permissions, /"window_presentation_state"/)
  assert.match(permissions, /"window_reassert_site_fullscreen"/)

  assert.match(maximize, /invoke<WindowPresentationState>\('window_presentation_state'/)
  assert.match(
    maximize,
    /before\.browserFullscreen \|\| before\.siteFullscreen/,
  )
  assert.doesNotMatch(maximize, /syncTauriBrowserBounds/)
  assert.match(
    maximize,
    /return state\.browserFullscreen \|\| state\.siteFullscreen/,
  )
  assert.doesNotMatch(
    maximize,
    /state\.browserFullscreen \|\| state\.siteFullscreen \|\| state\.maximized/,
  )

  assert.match(drag, /isWindowInteractionLocked\(\)/)
  assert.match(drag, /await appWindow\.startDragging\(\)/)
  assert.doesNotMatch(drag, /currentMonitor/)
  assert.doesNotMatch(drag, /outerPosition/)
  assert.doesNotMatch(drag, /outerSize/)

  assert.match(
    controls,
    /presentation\.browserFullscreen \|\| presentation\.siteFullscreen/,
  )
  assert.match(controls, /aria-disabled=\{maximizeLocked\}/)
})

test('Chrome WebView resize owns only Chrome bounds, not browser geometry or z-order', () => {
  const chrome = readFileSync('src/platform/tauriChromeWebview.ts', 'utf8')

  assert.doesNotMatch(chrome, /syncTauriBrowserBounds/)
  assert.doesNotMatch(chrome, /scheduleStackBrowsingChromeAboveBrowser/)
  assert.match(
    chrome,
    /const onLayoutChange = debounce\(\(\) => \{[\s\S]{0,320}syncChromeBounds\(webview\)/,
  )
})


test('F11 keeps Semi-Lunar expanded only on Home while ChromeApp owns its bounds', () => {
  const fullscreen = readFileSync('src/platform/tauriSiteFullscreen.ts', 'utf8')
  const menu = readFileSync(
    'src/components/SemiLunarMenu/SemiLunarMenu.tsx',
    'utf8',
  )

  assert.match(fullscreen, /BROWSER_FULLSCREEN_CHANGED_EVENT/)
  assert.match(fullscreen, /browserFullscreenChangedEvent\(\)/)
  assert.match(
    fullscreen,
    /const browserFullscreenActive =[\s\S]{0,180}window_toggle_browser_fullscreen/,
  )
  assert.match(
    fullscreen,
    /emit\(browserFullscreenChangedEvent\(\), \{[\s\S]{0,120}active: browserFullscreenActive/,
  )

  const toggleStart = fullscreen.indexOf('export function toggleBrowserWindowFullscreen')
  const toggleBody = fullscreen.slice(toggleStart)
  assert.doesNotMatch(toggleBody, /forceChromeWebviewCompactBounds\(\)/)

  assert.match(menu, /browserFullscreenChangedEvent/)
  assert.match(menu, /browserFullscreenActive/)
  assert.doesNotMatch(menu, /const isExpanded = browserFullscreenActive/)
  assert.match(
    menu,
    /const isExpanded =[\s\S]{0,120}forceOpen[\s\S]{0,120}stage === 'expanded'[\s\S]{0,120}isHome && homeAlwaysOpen/,
  )
  assert.match(menu, /const nextExpanded = isHome && homeAlwaysOpen/)
  assert.doesNotMatch(menu, /const nextExpanded = !active/)
  assert.match(
    menu,
    /if \(active\) \{[\s\S]{0,320}window\.location\.reload\(\)/,
  )

  const closeImmediately = menu.slice(
    menu.indexOf('const closeMenuImmediately'),
    menu.indexOf('const handleNavigate'),
  )
  const scheduleClose = menu.slice(
    menu.indexOf('const scheduleClose'),
    menu.indexOf('const handleContextMenuOpen'),
  )
  assert.doesNotMatch(closeImmediately, /browserFullscreenActive/)
  assert.doesNotMatch(scheduleClose, /if \(browserFullscreenActive\) return/)
  assert.match(
    menu,
    /syncChromeShellLayout\([\s\S]{0,100}nextExpanded/,
  )
})
