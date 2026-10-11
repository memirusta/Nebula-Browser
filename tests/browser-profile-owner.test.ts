import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'

// Native code that works on the browsing profile (extensions, site permissions,
// clearing data, its folder) goes through the browser profile owner, never through the
// shell's `main` or through whatever webview label a caller passes. These guards fail
// when a new call site goes back to that shortcut.

const dir = 'src-tauri/src'
const files = readdirSync(dir)
  .filter((name) => name.endsWith('.rs') && !/native_test|_fixture\.rs|spike_driver/.test(name))
  .map((name) => ({ name, text: readFileSync(`${dir}/${name}`, 'utf8') }))
const source = (name: string) => files.find((file) => file.name === name)!.text
// Production code only: drop every `#[cfg(test)] mod tests { ... }` (matched braces, so
// code after a test module in the same file is kept).
function production(text: string): string {
  const start = /#\[cfg\(test\)\]\s*mod tests\s*\{/g
  let result = ''
  let cursor = 0
  for (let match = start.exec(text); match; match = start.exec(text)) {
    result += text.slice(cursor, match.index)
    let depth = 1
    let index = match.index + match[0].length
    while (index < text.length && depth > 0) {
      if (text[index] === '{') depth += 1
      else if (text[index] === '}') depth -= 1
      index += 1
    }
    cursor = index
    start.lastIndex = index
  }
  return result + text.slice(cursor)
}

test('the owner is hidden, has no IPC, shows only about:blank and never falls back', () => {
  const owner = source('browser_profile.rs')
  assert.match(owner, /OWNER_LABEL: &str = "extension-browse-host"/)
  assert.match(owner, /\.visible\(false\)/)
  assert.match(owner, /\.skip_taskbar\(true\)/)
  assert.match(owner, /\.decorations\(false\)/)
  assert.match(owner, /\.on_navigation\(\|url\| url\.as_str\(\) == "about:blank"\)/)
  assert.doesNotMatch(owner, /\.data_directory\(/, 'the owner lives in the default (browsing) folder')
  // A webview with this label must match no capability, or it would get Tauri IPC.
  for (const name of readdirSync('src-tauri/capabilities')) {
    assert.doesNotMatch(readFileSync(`src-tauri/capabilities/${name}`, 'utf8'), /extension-browse-host|"extension-\*"/, name)
  }
  // No path from the owner to the shell: the only `main` lookup is the explicit shell one.
  const lookups = production(owner).match(/get_webview\("main"\)/g) ?? []
  assert.equal(lookups.length, 1, 'only shell_webview may name main')
  assert.match(owner, /pub fn shell_webview/)
})

test('no module outside browser_profile names the main webview', () => {
  for (const file of files) {
    if (file.name === 'browser_profile.rs') continue
    assert.doesNotMatch(production(file.text), /get_webview(_window)?\("main"\)/, `${file.name} names main`)
  }
})

test('profile-level WebView2 calls only go through the owner', () => {
  const profileCalls = /AddBrowserExtension|GetBrowserExtensions|ClearBrowsingData|GetNonDefaultPermissionSettings|SetPermissionState/
  const allowed = new Set(['ublock_extension.rs', 'webview_privacy.rs', 'extension_install.rs'])
  for (const file of files) {
    if (!profileCalls.test(production(file.text))) continue
    assert.ok(allowed.has(file.name), `${file.name} makes profile calls`)
  }
  // The two that are not extension-install plumbing must obtain their webview from the owner.
  for (const name of ['ublock_extension.rs', 'webview_privacy.rs']) {
    const text = production(source(name))
    assert.match(text, /browser_profile::owner\(/, name)
    assert.doesNotMatch(text, /shell_split::profile_webview|profile_webview\(/, name)
  }
})

test('profile commands ignore the label callers still send', () => {
  const lib = source('lib.rs')
  assert.match(lib, /async fn webview_clear_browsing_data\(\s*app: tauri::AppHandle,\s*_label: String/)
  assert.match(lib, /async fn webview_clear_site_permissions\(\s*app: tauri::AppHandle,\s*_label: String/)
  const ublock = source('ublock_extension.rs')
  assert.match(ublock, /pub async fn ublock_extension_install\(\s*app: AppHandle,\s*_label: String/)
  assert.match(ublock, /pub async fn ublock_extension_status\(\s*app: AppHandle,\s*_label: String/)
  assert.doesNotMatch(production(source('webview_privacy.rs')), /async fn (clear_profile_data_and_wait|non_default_permission_settings|set_permission_default_and_wait|clear_non_default_permissions_and_wait)\([^)]*label/)
})

test('extension flows resolve the browser profile from the owner, not from the caller', () => {
  const host = production(source('extension_host.rs'))
  assert.doesNotMatch(host, /owner\.clone\(\)\s*\};/, 'a registered package must not use the shell window as its profile')
  assert.doesNotMatch(host, /fn profile_directory/, 'a folder read from a caller-chosen webview is gone')
  assert.match(host, /browser_profile::user_data_folder\(app\)/)
  assert.match(host, /browser_profile::owner_label\(&app\)/)
  const install = production(source('extension_install.rs'))
  assert.doesNotMatch(install, /webview\.window\(\)\.label\(\)\.to_string\(\)/)
  assert.doesNotMatch(install, /let label = webview\.label\(\)\.to_string\(\)/)
  assert.match(install, /browser_profile::owner_label\(&app\)/)
})

test('storage usage reads the browsing profile folder and process diagnostics list both environments', () => {
  const privacy = production(source('webview_privacy.rs'))
  assert.match(privacy, /browser_profile::user_data_folder\(app\)\?\.join\("EBWebView"\)/)
  const controls = production(source('webview_controls.rs'))
  assert.match(controls, /shell_webview\(&app\)/)
  assert.match(controls, /browser_profile::owner\(&app\)/)
})

test('per-webview privacy settings stay strict about their webview', () => {
  const privacy = production(source('webview_privacy.rs'))
  assert.match(privacy, /if !label\.starts_with\("nebula-tab-"\) && !label\.starts_with\("nebula-popup-content-"\)/)
})

test('uBO Lite readiness is read by the host from the profile, not signalled by a shell page', () => {
  const ublock = production(source('ublock_extension.rs'))
  assert.match(ublock, /pub async fn ublock_extension_ready\(app: AppHandle\)/)
  assert.match(ublock, /browser_profile::owner\(&app\)/)
  assert.match(ublock, /extension_worker::wait_for_condition/)
  const manifest = JSON.parse(readFileSync('src-tauri/resources/extensions/ubol/manifest.json', 'utf8'))
  assert.equal(manifest.content_scripts, undefined)
  const shell = readFileSync('src/platform/tauriBrowser.ts', 'utf8')
  assert.doesNotMatch(shell, /nebulaUblockReady|data-nebula-ublock-ready|MutationObserver/)
  assert.match(shell, /invoke<boolean>\('ublock_extension_ready'\)/)
  assert.match(readFileSync('src-tauri/src/lib.rs', 'utf8'), /ublock_extension::ublock_extension_ready,/)
  assert.match(readFileSync('src-tauri/permissions/webview-commands.toml', 'utf8'), /"ublock_extension_ready"/)
})
