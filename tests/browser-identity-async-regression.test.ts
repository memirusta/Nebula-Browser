import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const branding = readFileSync(
  new URL('../src-tauri/src/webview_branding.rs', import.meta.url),
  'utf8',
)
const lib = readFileSync(
  new URL('../src-tauri/src/lib.rs', import.meta.url),
  'utf8',
)
const browser = readFileSync(
  new URL('../src/platform/tauriBrowser.ts', import.meta.url),
  'utf8',
)
const permissions = readFileSync(
  new URL('../src-tauri/permissions/webview-commands.toml', import.meta.url),
  'utf8',
)

test('browser identity never blocks the WebView UI thread with wait_with_pump', () => {
  assert.doesNotMatch(branding, /wait_with_pump/)
  assert.match(branding, /recv_timeout\(Duration::from_secs\(3\)\)/)
  assert.match(lib, /spawn_blocking\(move \|\|/)
  assert.match(lib, /webview_branding::apply_browser_identity/)
})

test('tab identity completes before external navigation is allowed', () => {
  const configure = browser.indexOf('browser.webview.configure-integrations')
  const identity = browser.indexOf('browser.webview.apply-browser-identity')
  const navigate = browser.indexOf('browser.webview.navigate')
  assert.ok(configure >= 0)
  assert.ok(identity > configure)
  assert.ok(navigate > identity)
})

test('popup identity completes before NewWindowRequested is attached', () => {
  const popupConfig = browser.indexOf('export async function configurePopupBrowseWebview')
  const identity = browser.indexOf(
    "invoke('webview_apply_browser_identity', { label })",
    popupConfig,
  )
  assert.ok(popupConfig >= 0)
  assert.ok(identity > popupConfig)
})

test('identity command is permissioned', () => {
  assert.match(permissions, /"webview_apply_browser_identity"/)
  assert.match(lib, /webview_apply_browser_identity,/)
})
