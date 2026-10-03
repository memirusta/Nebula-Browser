import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { shellIsolationCopy } from '../src/core/shellIsolationCopy.ts'

const LOCALES = ['tr', 'en', 'de', 'es', 'fr', 'id', 'ru', 'it', 'ja'] as const
const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))
// Everything before the unit-test module (single `#[cfg(test)]` items elsewhere stay in).
const production = (text: string) => text.split('#[cfg(test)]\nmod tests')[0]
/** Source with every run of whitespace collapsed, so rustfmt's layout does not matter. */
const flat = (text: string) => text.replace(/\s+/g, ' ')

test('registering extension code with the shared profile is refused until the split is final', () => {
  const install = production(read('src-tauri/src/extension_install.rs'))
  // The guard sits in `operate`, where every registration happens, before any WebView2 call.
  const operate = flat(install.slice(install.indexOf('pub(crate) fn operate(')))
  const guard = operate.indexOf('extension_activation::require_split(&action, &label)?')
  const firstWebView = operate.indexOf('.get_webview(&label)')
  assert.ok(guard > 0, 'operate calls require_split')
  assert.ok(firstWebView > guard, 'and does so before it touches a webview')

  const activation = flat(production(read('src-tauri/src/extension_activation.rs')))
  assert.match(activation, /crate::browser_profile::is_owner\(label\) \|\| label == "extension-catalog-host"/)
  assert.match(activation, /!crate::shell_isolation::split_committed\(\)/)
  // Only a verified split counts: not "split mode", but nothing pending and the digest matched.
  const isolation = flat(production(read('src-tauri/src/shell_isolation.rs')))
  const committed = isolation.slice(isolation.indexOf('pub fn split_committed()'))
  assert.match(committed.slice(0, 1800), /hydrating\(\)/)
  assert.match(committed.slice(0, 1800), /m\.mode == Mode::Split && m\.pending\.is_none\(\)/)
})

test('both install paths prepare the package first and decide about activation after', () => {
  const host = flat(production(read('src-tauri/src/extension_host.rs')))
  const install = flat(production(read('src-tauri/src/extension_install.rs')))
  for (const [name, source] of [['catalog', host], ['registry', install]] as const) {
    const prepared = source.search(/prepare_discovery_directory\(|prepare_directory\(package, &cache_root/)
    const decided = source.indexOf('activation::decide(&root, &action)')
    assert.ok(prepared > 0 && decided > prepared, `${name}: decide() comes after the package is prepared`)
    assert.match(source, /Activation::Waiting/)
    assert.match(source, /activation::pending_result\(&root\)/)
  }
  // The catalog path no longer creates the old catalog host for a new install.
  const manage = host.slice(host.indexOf('pub(crate) async fn manage_discovery('), host.indexOf('pub struct InstalledExtension'))
  assert.doesNotMatch(manage, /spawn_blocking\(move \|\| catalog_host\(&host_app\)\)\s*\.await/)
  assert.match(manage, /if legacy \{ catalog_host\(&host_app\)/)
})

test('activation and the move of legacy installs run only after the split is final', () => {
  const isolation = flat(production(read('src-tauri/src/shell_isolation.rs')))
  // After the hydration report is accepted, and at the start of a committed split.
  assert.match(isolation, /clear_browsing_residue\(&app\); run_after_commit\(&app\);/)
  const run = isolation.slice(isolation.indexOf('pub fn run_after_commit('))
  assert.match(run.slice(0, 400), /if !split_committed\(\) \{ return; \}/)
  assert.match(production(read('src-tauri/src/lib.rs')), /shell_isolation::run_after_commit\(app\.handle\(\)\)/)
})

test('a legacy install is moved from recorded metadata, never by copying profile files', () => {
  const activation = production(read('src-tauri/src/extension_activation.rs'))
  const migrate = flat(activation.slice(activation.indexOf('async fn migrate_one('), activation.indexOf('async fn migrate_legacy(')))
  // The recorded digest must still match the re-fetched package, else it waits for a new review.
  assert.match(migrate, /digest != recorded/)
  assert.match(migrate, /REVIEW/)
  assert.match(migrate, /probe_discovery_download/)
  assert.match(migrate, /"install"\.into\(\)/)
  // Nothing copies a profile: no file copy and no directory copy of the trial profile.
  assert.doesNotMatch(migrate, /std::fs::copy|copy_dir|fs_extra|catalog_profile_directory/)
  assert.match(flat(read('docs/EXTENSION_OPT_IN_SPLIT.md')), /Profile files are never copied/)
})

test('the built-in uBO Lite is not a third-party activation', () => {
  const ublock = production(read('src-tauri/src/ublock_extension.rs'))
  assert.doesNotMatch(ublock, /require_split|split_committed|extension_activation/)
  assert.doesNotMatch(read('src-tauri/src/shell_isolation.rs'), /ublock/i)
})

test('the harness-only fixture hooks exist only behind the split-driver feature', () => {
  const registry = read('src-tauri/src/extension_registry.rs')
  const at = registry.indexOf('NEBULA_FIXTURE_PACKAGES')
  assert.ok(at > 0)
  assert.match(registry.slice(Math.max(0, at - 250), at), /feature = "split-driver"/)
  const isolation = read('src-tauri/src/shell_isolation.rs')
  const escape = isolation.indexOf('NEBULA_FIXTURE_ALLOW_SHARED_PROFILE')
  assert.ok(escape > 0)
  assert.match(isolation.slice(Math.max(0, escape - 250), escape), /feature = "split-driver"/)
})

test('the new commands are registered and open to the shell only', () => {
  const lib = read('src-tauri/src/lib.rs')
  const permissions = read('src-tauri/permissions/webview-commands.toml')
  for (const name of ['extension_pending_activations', 'extension_legacy_installs']) {
    assert.ok(lib.includes(`extension_activation::${name},`), `${name} registered`)
    assert.ok(permissions.includes(`"${name}"`), `${name} has a permission entry`)
  }
})

test('the catalog offers the switch for a waiting extension instead of reporting a failure', () => {
  const controls = flat(read('src/components/SettingsPanel/ExtensionInstallControls.tsx'))
  assert.match(controls, /if \(value\.pendingActivation\) void offerIsolationForExtension\(\) else if \(action === 'install' && !value\.enabled\) setFailed\(true\)/)
  assert.match(controls, /data-extension-restart/)
  const section = read('src/components/SettingsPanel/ExtensionsSettingsSection.tsx')
  assert.match(section, /pendingActivations\(\)/)
  assert.match(section, /pendingActivation: item\.action !== ''/)
})

test('every language has the texts for the waiting extension and the legacy notice', () => {
  for (const locale of LOCALES) {
    const copy = shellIsolationCopy(locale)
    for (const key of ['extensionConfirm', 'extensionWaiting', 'extensionRestart', 'activationFailed', 'legacyNotice'] as const) {
      assert.ok(copy[key].length >= 6, `${locale}.${key}`)
    }
  }
})
