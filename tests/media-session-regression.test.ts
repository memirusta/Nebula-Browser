import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

test('Windows media identity is owned by Nebula and follows real Media Session metadata', () => {
  const media = read('../src-tauri/src/media_session.rs')
  const bindings = read('../src-tauri/src/media_session_bindings.rs')

  assert.match(bindings, /ISystemMediaTransportControlsInterop/)
  assert.match(bindings, /GetForWindow/)
  assert.match(media, /SetCurrentProcessExplicitAppUserModelID/)
  assert.match(media, /com\.nebula\.browser/)
  assert.match(media, /navigator\.mediaSession/)
  assert.match(media, /location\.protocol !== 'http:' && location\.protocol !== 'https:'/)
  assert.match(media, /metadata && metadata\.title/)
  assert.match(media, /metadata && metadata\.artist/)
  assert.match(media, /metadata && metadata\.album/)
  assert.match(media, /RandomAccessStreamReference::from_uri/)
  assert.doesNotMatch(media, /document\.title/)
})

test('media controls select one active tab and clean navigation or tab teardown', () => {
  const media = read('../src-tauri/src/media_session.rs')
  const native = read('../src-tauri/src/lib.rs')

  assert.match(media, /struct MediaCoordinator/)
  assert.match(media, /activity_sequence: u64/)
  assert.match(media, /fn reconcile_active/)
  assert.match(media, /best_playing/)
  assert.match(media, /selected_media\(\)/)
  assert.match(media, /execute_media_command\(&button_app, label, command\)/)
  assert.match(media, /NavigationStartingEventHandler/)
  assert.match(media, /coordinator\.remove\(&navigation_label\)/)
  assert.match(native, /media_session::setup\(&app, &label\)/)
  assert.match(native, /media_session::teardown\(&app, &label\)/)
  assert.match(native, /media_session::initialize_process_identity\(\)/)
})
