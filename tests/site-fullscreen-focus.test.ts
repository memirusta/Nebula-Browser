import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('HTML5 fullscreen loss is reconciled against the native foreground window', () => {
  const bridge = readFileSync('src/platform/tauriSiteFullscreen.ts', 'utf8')
  const nativeWindow = readFileSync(
    'src-tauri/src/site_fullscreen_window.rs',
    'utf8',
  )
  const tabFullscreen = readFileSync(
    'src-tauri/src/tab_fullscreen.rs',
    'utf8',
  )

  // Focus regain may repair geometry, but neither JS focus nor blur decides
  // whether fullscreen should be preserved.
  assert.doesNotMatch(
    bridge,
    /onFocusChanged[\s\S]{0,300}forceExitSiteFullscreen/,
  )
  assert.match(bridge, /if \(!focused \|\| !siteFullscreenActive\) return/)
  assert.match(bridge, /reconcileSiteFullscreenAfterFocus/)
  assert.doesNotMatch(bridge, /requestPersistentFullscreenEnter/)

  const payloadHandler = bridge.slice(
    bridge.indexOf('async function handleTabFullscreenPayload'),
    bridge.indexOf('async function reconcileSiteFullscreenAfterFocus'),
  )
  assert.doesNotMatch(payloadHandler, /isFocused\(\)/)
  assert.match(payloadHandler, /await exitSiteFullscreen\(\)/)

  assert.match(tabFullscreen, /GetForegroundWindow/)
  assert.match(tabFullscreen, /GetAncestor\(hwnd, GA_ROOT\)/)
  assert.match(tabFullscreen, /root_hwnd\(foreground\) == root_hwnd\(parent\)/)
  assert.doesNotMatch(tabFullscreen, /\.is_focused\(\)/)

  // False edges are debounced by generation, then WebView2 is re-read after
  // a short native settle window before any fallback decision is made.
  assert.match(tabFullscreen, /FULLSCREEN_LOSS_GENERATIONS/)
  assert.match(
    tabFullscreen,
    /FULLSCREEN_LOSS_SETTLE: Duration = Duration::from_millis\(120\)/,
  )
  assert.match(
    tabFullscreen,
    /tokio::time::sleep\(FULLSCREEN_LOSS_SETTLE\)\.await/,
  )
  assert.match(tabFullscreen, /fullscreen_loss_generation_is_current/)
  assert.match(tabFullscreen, /webview_contains_fullscreen/)
  assert.match(
    tabFullscreen,
    /if is_fullscreen \{[\s\S]{0,180}advance_fullscreen_loss_generation\(label\)/,
  )
  assert.match(
    tabFullscreen,
    /else if was_fullscreen \{[\s\S]{0,120}schedule_native_fullscreen_loss/,
  )

  const foregroundDecision = tabFullscreen.slice(
    tabFullscreen.indexOf('match nebula_foreground'),
    tabFullscreen.indexOf('fn schedule_native_fullscreen_loss'),
  )
  const appSwitchBranch = foregroundDecision.slice(
    foregroundDecision.indexOf('Some(false) =>'),
    foregroundDecision.indexOf('Some(true) =>'),
  )
  const sameAppStart = foregroundDecision.indexOf('Some(true) =>')
  const sameAppBranch = foregroundDecision.slice(
    sameAppStart,
    foregroundDecision.indexOf('None =>', sameAppStart),
  )
  assert.match(
    appSwitchBranch,
    /__nebulaEnterPersistentFullscreenFromHost/,
  )
  assert.doesNotMatch(
    sameAppBranch,
    /__nebulaEnterPersistentFullscreenFromHost/,
  )
  assert.match(sameAppBranch, /confirm_site_fullscreen_exit/)

  const confirmedExit = tabFullscreen.slice(
    tabFullscreen.indexOf('fn confirm_site_fullscreen_exit'),
    tabFullscreen.indexOf('fn reconcile_native_fullscreen_loss'),
  )
  assert.match(confirmedExit, /commit_fullscreen_state\(app, label, false\)/)

  // Iframe focus transfer may still emit window.blur. It can retain the last
  // element for native fallback, but cannot activate or schedule fallback.
  const blurHandler = tabFullscreen.slice(
    tabFullscreen.indexOf("window.addEventListener('blur'"),
    tabFullscreen.indexOf(
      "document.addEventListener('fullscreenchange'",
    ),
  )
  assert.match(blurHandler, /lastFullscreenElement = current/)
  assert.doesNotMatch(
    blurHandler,
    /activatePersistentFullscreen|scheduleFullscreenLossReconcile/,
  )
  assert.doesNotMatch(tabFullscreen, /windowBlurred/)
  assert.doesNotMatch(tabFullscreen, /native exit signal deferred to page bridge/)

  // Persistent fallback and all supported exit paths remain intact.
  assert.match(tabFullscreen, /data-nebula-persistent-fullscreen/)
  assert.match(tabFullscreen, /data-nebula-persistent-fullscreen-active/)
  assert.match(tabFullscreen, /reconcilePageAfterPersistentExit/)
  assert.match(tabFullscreen, /nebula-persistent-fullscreen-enter/)
  assert.match(tabFullscreen, /nebula-persistent-fullscreen-exit/)
  assert.match(tabFullscreen, /webkitExitFullscreen/)
  assert.match(tabFullscreen, /webkitCancelFullScreen/)
  assert.match(tabFullscreen, /COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN/)

  assert.match(
    nativeWindow,
    /cover_monitor\(hwnd, &SITE_SAVED_PLACEMENT, window_label, false\)/,
  )
  assert.match(nativeWindow, /capture_window_state\(hwnd, true\)/)
  assert.match(nativeWindow, /restore_fallback_geometry/)
  assert.doesNotMatch(nativeWindow, /HWND_TOPMOST/)
})
