import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

test('Windows exposes one Nebula-owned media producer and suppresses WebView2 SMTC', () => {
  const media = read('../src-tauri/src/media_session.rs')
  const bindings = read('../src-tauri/src/media_session_bindings.rs')
  const native = read('../src-tauri/src/lib.rs')

  assert.equal(existsSync(new URL('../src-tauri/src/media_session.rs', import.meta.url)), true)
  assert.equal(existsSync(new URL('../src-tauri/src/media_session_bindings.rs', import.meta.url)), true)
  assert.match(bindings, /ISystemMediaTransportControlsInterop/)
  assert.match(bindings, /GetForWindow/)
  assert.match(media, /SetCurrentProcessExplicitAppUserModelID/)
  assert.match(media, /com\.nebula\.browser/)
  assert.match(media, /WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS/)
  assert.match(media, /--disable-features=HardwareMediaKeyHandling/)
  assert.match(native, /mod media_session;/)
  assert.match(native, /media_session::setup\(&app, &label\)/)
  assert.match(
    native,
    /fn teardown_tab_webview_integrations[\s\S]*?media_session::teardown\(app, label\)[\s\S]*?async fn webview_close_tab[\s\S]*?teardown_tab_webview_integrations\(&app, &label\)[\s\S]*?webview\.close\(\)/,
  )
  assert.match(
    native,
    /media_session::configure_webview_environment\(\)[\s\S]*?tauri::Builder::default\(\)/,
  )
  assert.match(native, /media_session::initialize_process_identity\(\)/)
})

test('Nebula media controls follow one active tab and real Media Session metadata', () => {
  const media = read('../src-tauri/src/media_session.rs')

  assert.match(media, /navigator\.mediaSession/)
  assert.match(media, /metadata && metadata\.title/)
  assert.match(media, /metadata && metadata\.artist/)
  assert.match(media, /metadata && metadata\.album/)
  assert.match(media, /RandomAccessStreamReference::from_uri/)
  assert.match(media, /struct MediaCoordinator/)
  assert.match(media, /fn reconcile_active/)
  assert.match(media, /selected_media\(\)/)
  assert.doesNotMatch(media, /document\.title/)
})
