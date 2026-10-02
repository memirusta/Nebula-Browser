import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { extensionHostCopy } from '../src/core/extensionHostCopy.ts'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('common extension host is permissioned and exposed from Semi-Lunar', () => {
  const commands = read('src-tauri/permissions/webview-commands.toml')
  const native = read('src-tauri/src/lib.rs')
  const lunar = read('src/components/SemiLunarMenu/SemiLunarMenu.tsx')
  const chrome = read('src/ChromeApp.tsx')
  for (const command of ['extension_host_list', 'extension_host_open', 'extension_host_browse']) {
    assert.match(commands, new RegExp(`"${command}"`))
    assert.match(native, new RegExp(`extension_host::${command}`))
  }
  assert.match(lunar, /data-nebula-extensions-toggle/)
  const leftControlsStart = lunar.indexOf('<div className={styles.evBtnColumn}>')
  const windowControlsStart = lunar.indexOf(
    '{isTauri && isExpanded && (',
    leftControlsStart,
  )
  const leftControls = lunar.slice(leftControlsStart, windowControlsStart)
  const windowControls = lunar.slice(
    windowControlsStart,
    lunar.indexOf('{isExpanded && (', windowControlsStart + 1),
  )
  assert.ok(
    leftControls.indexOf('data-nebula-extensions-toggle') >
      leftControls.indexOf('styles.siteSecurityBtn'),
    'extension control must sit immediately to the right of site security',
  )
  assert.doesNotMatch(windowControls, /data-nebula-extensions-toggle/)
  assert.match(chrome, /<ExtensionsPanel/)
  assert.match(chrome, /type: 'open-extensions'/)
})

test('generic installation is bound to reviewed bytes and an isolated profile', () => {
  const host = read('src-tauri/src/extension_host.rs')
  const controls = read('src/components/SettingsPanel/ExtensionInstallControls.tsx')
  assert.match(host, /extension-browsing-profile/)
  assert.match(host, /if digest != expected/)
  assert.match(host, /The store package changed/)
  assert.match(host, /profile_label = if crate::extension_registry::package\(&id\)\.is_err\(\)/)
  assert.match(controls, /data-extension-review/)
  assert.match(controls, /compatibility\.sha256/)
})

test('extension controls avoid catalog profile startup races and expose packaged side panels', () => {
  const host = read('src-tauri/src/extension_host.rs')
  const panel = read('src/components/ExtensionsPanel/ExtensionsPanel.tsx')
  assert.match(host, /fn catalog_profile_directory/)
  assert.match(host, /owners\.1 == "extension-catalog-host"/)
  // A Nebula browser window holds several WebViews under different labels, so
  // `get_webview_window` cannot find it; the panel's owner must come from
  // `get_window`, or the panel is unowned and unreachable with Alt+Tab.
  assert.match(host, /get_window\(owners\.0\)/)
  assert.match(host, /owner_raw\(hwnd\)/)
  assert.doesNotMatch(host, /get_webview_window\(owners\.0\)/)
  assert.match(host, /"side-panel" => manifest/)
  assert.match(host, /icon_data_url: icon_data_url/)
  assert.doesNotMatch(host, /EXTENSION_WINDOW_BRIDGE/)
  assert.match(host, /popup_windows::attach/)
  assert.match(panel, /item\.hasSidePanel/)
  assert.match(panel, /item\.iconDataUrl/)
  assert.match(panel, /item\.primaryView/)
  assert.match(panel, /item\.runsInProfile/)
  // Icon tiles whose click runs the toolbar action, with the details behind a button.
  assert.match(panel, /primaryExtensionAction\(item\)/)
  assert.match(panel, /data-extension-primary=\{item\.id\}/)
  assert.match(panel, /onContextMenu=/)
  assert.match(panel, /data-extensions-manage/)
})

test('extension-host limitations are available in all app languages', () => {
  for (const locale of ['tr', 'en', 'de', 'es', 'fr', 'id', 'ru', 'it', 'ja'] as const) {
    const copy = extensionHostCopy(locale)
    assert.ok(copy.title && copy.limited && copy.missingHost && copy.privateUnavailable)
    assert.ok(copy.openPanel && copy.experimentalPanel && copy.missingActionHost && copy.runsInProfile)
    assert.ok(copy.requiresNativeApp && copy.metadataUnavailable)
    assert.ok(copy.review && copy.permissions && copy.loadOnly && copy.separateSession)
    assert.ok(copy.clickLabel && copy.clickBeta && copy.clickNoResponse && copy.details)
    // The Beta note must carry the activeTab caveat in every language.
    assert.match(copy.clickBeta, /activeTab/)
  }
})

test('catalog installs fetch by catalog id, not store id', () => {
  const host = readFileSync('src-tauri/src/extension_host.rs', 'utf8')
  // Passing the store id breaks entries whose catalog id is a slug (bitwarden, languagetool).
  assert.match(host, /fetch_discovery_package\(&entry\.id\)/)
  assert.doesNotMatch(host, /fetch_discovery_package\(&entry\.store_id\)/)
})

test('the lab script depends on native tests that must stay in the file', () => {
  // scripts/extension-lab.ps1 runs these by name. A truncated edit once deleted the
  // setup test silently, so `setup` quietly ran zero tests.
  const native = readFileSync('src-tauri/src/extension_host_native_test.rs', 'utf8')
  // The audit has its own file; the lab script runs it by name too.
  const nativeAndAudit = native + readFileSync('src-tauri/src/extension_pages_audit_native_test.rs', 'utf8')
  const lab = readFileSync('scripts/extension-lab.ps1', 'utf8')
  for (const name of ['native_extension_lab_setup', 'native_extension_lab_diagnose', 'native_extension_api_surface', 'native_extension_pages_audit']) {
    assert.match(nativeAndAudit, new RegExp(`fn ${name}\\(\\)`), `${name} missing from the native tests`)
  }
  for (const name of ['native_extension_lab_setup', 'native_extension_lab_diagnose', 'native_extension_pages_audit']) {
    assert.ok(lab.includes(name), `${name} is not run by the lab script`)
  }
  assert.match(native, /const LAB_EXTENSIONS: &\[\(&str, &str\)\]/)
  // Catalog lookups by Chrome store id, downloads by catalog id.
  assert.match(native, /entry\.store_id == \*store_id/)
  assert.match(native, /fetch_discovery_package\(&entry\.id\)/)
  assert.doesNotMatch(native, /Secure Exam Proctor"\)/, 'lockdown software must stay out of the lab list')
})

test('the toolbar click is a fixed host operation, not a generic worker evaluator', () => {
  const panel = readFileSync('src/components/ExtensionsPanel/ExtensionsPanel.tsx', 'utf8')
  const platform = readFileSync('src/platform/extensionDownload.ts', 'utf8')
  const native = readFileSync('src-tauri/src/extension_worker.rs', 'utf8')
  const host = readFileSync('src-tauri/src/extension_host.rs', 'utf8')
  const permissions = readFileSync('src-tauri/permissions/webview-commands.toml', 'utf8')
  const lib = readFileSync('src-tauri/src/lib.rs', 'utf8')
  assert.match(panel, /data-extension-click=\{item\.id\}/)
  assert.match(platform, /invoke<ExtensionClickResult>\('extension_host_click', \{ id \}\)/)
  // Registered in both places (AGENTS.md: handler and permission).
  assert.match(permissions, /"extension_host_click"/)
  assert.match(lib, /extension_host::extension_host_click/)
  // The command takes an extension id only; no script, method or target comes from the caller.
  const command = host.slice(host.indexOf('pub async fn extension_host_click'))
  const signature = command.slice(0, command.indexOf(') ->'))
  assert.doesNotMatch(signature, /script|expression|method|params|target_id/i)
  assert.match(native, /pub\(crate\) const CLICK_SCRIPT: &str/)
  assert.doesNotMatch(native, /pub\(crate\) use imp::\{[^}]*\bcdp\b[^}]*\};\s*\n#\[cfg\(all\(test/)
})

test('hidden extension windows cannot keep the process alive after the last browser window closes', () => {
  const lib = read('src-tauri/src/lib.rs')
  const lifecycle = read('src-tauri/src/app_lifecycle.rs')
  assert.match(lib, /mod app_lifecycle;/)
  assert.match(lib, /app_lifecycle::on_window_event\(window, event\)/)
  // A second launch must end with a window even when the running process has none.
  assert.match(lib, /app_lifecycle::on_second_instance\(app\)/)
  assert.match(lifecycle, /BACKGROUND_PREFIX: &str = "extension-"/)
  assert.match(lifecycle, /app\.exit\(0\)/)
})
