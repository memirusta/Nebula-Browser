import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// The settings module imports its neighbours without file extensions, which Node cannot load here, so (like the other tests of
// the settings) this reads the source.
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('the shield is on by default, with every kind of list on and no rules of the person; saved values of the wrong kind fall back', () => {
  const settings = read('src/core/nebulaSettings.ts')
  assert.match(settings, /shield: true,\s+shieldAds: true,\s+shieldTrackers: true,\s+shieldMalware: true,\s+shieldMalwareUpdates: false,\s+shieldCustomRules: '',/)
  for (const key of ['shieldAds', 'shieldTrackers', 'shieldMalware', 'shieldMalwareUpdates']) {
    assert.ok(settings.includes(`${key}: typeof p?.${key} === 'boolean' ? p.${key} : d.privacy.${key}`), key)
  }
  assert.match(settings, /shieldCustomRules: typeof p\?\.shieldCustomRules === 'string' \? p\.shieldCustomRules\.slice\(0, 20000\)/, 'cut at a size the native side takes')
})

test('what the person chose reaches the native side, and the count is a registered, allowed command', () => {
  const browser = read('src/platform/tauriBrowser.ts')
  for (const key of ['shieldAds', 'shieldTrackers', 'shieldMalware', 'shieldMalwareUpdates', 'shieldCustomRules']) assert.match(browser, new RegExp(`${key}:`), key)
  assert.match(browser, /invoke<number>\('shield_blocked_count'/)
  assert.match(read('src-tauri/src/lib.rs'), /^\s+shield_blocked_count,$/m, 'registered with the handler')
  assert.match(read('src-tauri/permissions/webview-commands.toml'), /"shield_blocked_count"/, 'and allowed')
  const native = read('src-tauri/src/webview_privacy.rs')
  for (const field of ['shield_ads', 'shield_trackers', 'shield_malware', 'shield_malware_updates', 'shield_custom_rules']) assert.match(native, new RegExp(`pub ${field}:`), field)
})

test('the site panel asks for a count only when the shield is on for the site, and shows it only then', () => {
  assert.match(read('src/components/BrowserShell/BrowserShell.tsx'), /snapshot\.shieldOn\s*\? readShieldBlockedCount/)
  assert.match(read('src/components/SiteInfoPanel/SiteInfoPanel.tsx'), /state\.shieldOn && typeof state\.shieldBlocked === 'number'/)
})

test('the settings page has the shield, its kinds of lists (off while the shield is) and the box for the persons own rules', () => {
  const panel = read('src/components/SettingsPanel/SettingsPanel.tsx')
  assert.match(panel, /onUpdate\('privacy', 'shield', !privacy\.shield\)/)
  for (const key of ['shieldAds', 'shieldTrackers', 'shieldMalware']) {
    assert.match(panel, new RegExp(String.raw`checked=\{privacy\.${key}\}\s+disabled=\{!privacy\.shield\}`), key)
  }
  assert.match(panel, /<SettingTextAreaRow[\s\S]*?value=\{privacy\.shieldCustomRules\}/)
})

test('the list download is off by default, is the only use of the network by the shield, and stops when its setting does', () => {
  const panel = read('src/components/SettingsPanel/SettingsPanel.tsx')
  assert.match(panel, /checked=\{privacy\.shieldMalwareUpdates\}\s+disabled=\{!privacy\.shield \|\| !privacy\.shieldMalware\}/)
  // The engine, the page script and the block page make no request of their own.
  for (const file of ['shield.rs', 'shield_block_page.rs']) assert.doesNotMatch(read(`src-tauri/src/${file}`), /reqwest::(Client|get)|\.send\(\)/, file)
  const updates = read('src-tauri/src/shield_updates.rs')
  assert.equal(updates.match(/const LIST_URL: &str =/g)?.length, 1, 'one fixed address')
  assert.match(updates, /const LIST_URL: &str =\s+"https:\/\/malware-filter\.gitlab\.io\//)
  assert.match(updates, /\.https_only\(true\)/)
  assert.match(updates, /user_agent\("Nebula"\)/, 'a generic user agent')
  assert.doesNotMatch(updates, /cookie_store|\.header\(/, 'no cookies and no identifier')
  // Turning the setting off (or the shield, or the malware lists) deletes what was downloaded; and that happens before the engine is
  // made again, so the engine is made without it.
  const privacy = read('src-tauri/src/webview_privacy.rs')
  assert.match(privacy, /let keeps_malware_list = next\.shield && next\.shield_malware && next\.shield_malware_updates;[\s\S]*set_enabled\(app, keeps_malware_list\);[\s\S]*shield::configure/)
  assert.match(updates, /remove_file\(&path\)/)
})

test('a page of a site on the malware lists is stopped before the page script and the upgrade to https, and only for an http(s) address', () => {
  const privacy = read('src-tauri/src/webview_privacy.rs')
  const guard = privacy.indexOf('guard_document(&uri)')
  assert.ok(guard > 0)
  assert.ok(guard < privacy.indexOf('put_page_script(sender, &navigation_label'), 'before the page script')
  assert.ok(guard < privacy.indexOf('https_upgrade(&uri)'), 'and before the upgrade')
  const before = privacy.slice(guard - 700, guard)
  assert.match(before, /uri\.starts_with\("http:\/\/"\) \|\| uri\.starts_with\("https:\/\/"\)/)
  assert.match(before, /is_excepted\(&uri, &current\.site_exceptions\)/, 'a site excepted from protection is not stopped')
  assert.match(before, /site_is_allowed\(&navigation_label, &uri\)/, 'nor one the person chose to open')
  // "Continue anyway" is a navigation to an address that cannot exist, with a code, seen and cancelled at the start of the
  // navigation: a page of a site has no message channel to the app (window.chrome.webview is masked from every page).
  const continueAt = privacy.indexOf('shield_block_page::continue_target(&uri)')
  assert.ok(continueAt > 0 && continueAt < guard, 'the continue address is recognised before the check that would stop the site again')
  assert.match(privacy.slice(continueAt, continueAt + 500), /SetCancel\(true\)[\s\S]*allow_site\(&navigation_label, &site\)[\s\S]*Navigate/)
  const template = read('src-tauri/src/shield_block_page.rs').match(/r#"(<!DOCTYPE[\s\S]*?)"#/)?.[1] ?? ''
  assert.ok(template.length > 500, 'the page template was found')
  assert.doesNotMatch(template, /postMessage|chrome\.webview/, 'the page does not try the channel it does not have')
})
