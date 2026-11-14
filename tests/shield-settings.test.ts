import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

// The settings module imports its neighbours without file extensions, which Node cannot load here, so (like the other tests of
// the settings) this reads the source.
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('the shield is on by default, with every kind of list on and no rules of the person; saved values of the wrong kind fall back', () => {
  const settings = read('src/core/nebulaSettings.ts')
  assert.match(settings, /shield: true,\s+shieldAds: true,\s+shieldTrackers: true,\s+shieldMalware: true,\s+shieldMalwareUpdates: false,\s+shieldFingerprint: true,\s+shieldCustomRules: '',/)
  for (const key of ['shieldAds', 'shieldTrackers', 'shieldMalware', 'shieldMalwareUpdates', 'shieldFingerprint']) {
    assert.ok(settings.includes(`${key}: typeof p?.${key} === 'boolean' ? p.${key} : d.privacy.${key}`), key)
  }
  assert.match(settings, /shieldCustomRules: typeof p\?\.shieldCustomRules === 'string' \? p\.shieldCustomRules\.slice\(0, 20000\)/, 'cut at a size the native side takes')
})

test('what the person chose reaches the native side, and the counts are registered, allowed commands', () => {
  const browser = read('src/platform/tauriBrowser.ts')
  for (const key of ['shieldAds', 'shieldTrackers', 'shieldMalware', 'shieldMalwareUpdates', 'shieldFingerprint', 'shieldCustomRules']) assert.match(browser, new RegExp(`${key}:`), key)
  assert.match(browser, /invoke<ShieldPageSummary>\('shield_page_summary'/)
  for (const command of ['shield_page_summary', 'shield_stats', 'shield_reset_stats']) {
    assert.match(read('src-tauri/src/lib.rs'), new RegExp(String.raw`^\s+${command},$`, 'm'), `${command} is registered with the handler`)
    assert.match(read('src-tauri/permissions/webview-commands.toml'), new RegExp(`"${command}"`), `${command} is allowed`)
  }
  const native = read('src-tauri/src/webview_privacy.rs')
  for (const field of ['shield_ads', 'shield_trackers', 'shield_malware', 'shield_malware_updates', 'shield_fingerprint', 'shield_custom_rules']) assert.match(native, new RegExp(`pub ${field}:`), field)
})

test('the site panel asks for a count only when the shield is on for the site, and shows it only then', () => {
  assert.match(read('src/components/BrowserShell/BrowserShell.tsx'), /snapshot\.shieldOn\s*\? readShieldPageSummary/)
  assert.match(read('src/components/SiteInfoPanel/SiteInfoPanel.tsx'), /state\.shieldOn && typeof state\.shieldBlocked === 'number'/)
})

test('the settings page has the shield, its kinds of lists (off while the shield is) and the box for the persons own rules', () => {
  const panel = read('src/components/SettingsPanel/ShieldSettings.tsx')
  assert.match(read('src/components/SettingsPanel/SettingsPanel.tsx'), /<ShieldSettings\s+privacy=\{privacy\}/, 'the privacy page uses it')
  assert.match(panel, /onChange\('shield', !privacy\.shield\)/)
  for (const key of ['shieldAds', 'shieldTrackers', 'shieldMalware']) {
    assert.match(panel, new RegExp(String.raw`checked=\{privacy\.${key}\}\s+disabled=\{!privacy\.shield\}`), key)
  }
  assert.match(panel, /<SettingTextAreaRow[\s\S]*?value=\{privacy\.shieldCustomRules\}/)
})

test('the list download is off by default, is the only use of the network by the shield, and stops when its setting does', () => {
  const panel = read('src/components/SettingsPanel/ShieldSettings.tsx')
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

test('"go back" on the page of a stopped site closes a tab that has no earlier page, through the window', () => {
  const privacy = read('src-tauri/src/webview_privacy.rs')
  const leave = privacy.indexOf('shield_block_page::leave_requested(&uri)')
  assert.ok(leave > 0)
  assert.match(privacy.slice(leave, leave + 500), /SetCancel\(true\)[\s\S]*"nebula-shield-leave"[\s\S]*"tabLabel": navigation_label/)
  const page = read('src-tauri/src/tab_error_page.rs')
  assert.match(page, /let can_go_back = !before\.is_empty\(\) && !before\.starts_with\("about:blank"\)/, 'decided from the page the tab showed before')
  assert.match(read('src/platform/tauriBrowser.ts'), /listen<ShieldLeaveRequest>\('nebula-shield-leave'/)
  const shell = read('src/components/BrowserShell/BrowserShell.tsx')
  assert.match(shell, /listenShieldLeaveRequests\(\(request\) => \{[\s\S]*shortcutIdForTabWebviewLabel\(request\.tabLabel\)[\s\S]*void handleCloseTab\(shortcutId\)/)
})

test('the shield\'s hiding style waits for a document element, because its script runs before the page has one', () => {
  const engine = read('src-tauri/src/shield.rs')
  assert.match(engine, /new MutationObserver/)
  assert.match(engine, /watch\.observe\(document, \{ childList: true \}\)/)
})

test('the fingerprint protection is off by default, runs only with the shield and not on a site the person excepted, and its script compiles', () => {
  const settings = read('src/core/nebulaSettings.ts')
  assert.match(settings, /shieldFingerprint: true,/)
  assert.match(read('src/components/SettingsPanel/ShieldSettings.tsx'), /checked=\{privacy\.shieldFingerprint\}\s+disabled=\{!privacy\.shield\}/)
  const privacy = read('src-tauri/src/webview_privacy.rs')
  // Put in the tab at the start of a navigation, inside the shield's own condition, and only for a site that is not excepted.
  const call = privacy.lastIndexOf('put_fingerprint_script(')
  assert.ok(call > 0)
  assert.match(privacy.slice(call - 600, call), /if current\.shield \{/)
  const put = privacy.slice(privacy.indexOf('unsafe fn put_fingerprint_script('))
  assert.match(put.slice(0, 600), /current\.shield_fingerprint && !is_excepted\(uri, &current\.site_exceptions\)/)
  // The script has one place for its number, runs once for a window, and never touches a challenge that decides who is a person.
  const script = read('src-tauri/resources/shield/fingerprint.js')
  assert.equal(script.split('__SEED__').length - 1, 1)
  assert.match(script, /Symbol\.for\('nebula\.fingerprint'\)/)
  for (const challenge of ['challenges.cloudflare.com', 'hcaptcha.com', 'recaptcha.net', 'arkoselabs.com']) assert.ok(script.includes(challenge), challenge)
  assert.doesNotThrow(() => new vm.Script(script.replace('__SEED__', '12345')), 'the script is valid JavaScript')
})

test('the engine is started as the app starts, unless the person left the shield off, so the first page is protected too', () => {
  assert.match(read('src-tauri/src/lib.rs'), /shield::start_at_launch\(app\.handle\(\)\);/)
  const engine = read('src-tauri/src/shield.rs')
  assert.match(engine, /pub fn start_at_launch[\s\S]*?off_marker\(app\)\.is_some_and\(\|marker\| marker\.exists\(\)\)[\s\S]*?configure\(&Config::default\(\)\)/)
  // What the window says is remembered for the next start, from the same place that sets the engine up.
  assert.match(read('src-tauri/src/webview_privacy.rs'), /crate::shield::remember_choice\(app, next\.shield\);/)
})

test('the page script is kept for a host, not made again for every address: a blank or app page leaves it alone, and a new engine replaces it', () => {
  const privacy = read('src-tauri/src/webview_privacy.rs')
  const put = privacy.slice(privacy.indexOf('unsafe fn put_page_script('), privacy.indexOf('unsafe fn put_fingerprint_script('))
  assert.match(put, /if !matches!\(parsed\.scheme\(\), "http" \| "https"\) \{\s*return 0;\s*\}/, 'not a web page: the tab is left as it is')
  assert.match(put, /let key = format!\("\{\}:\{host\}", crate::shield::epoch\(\)\);/, 'one script for a host, for as long as the engine is the same')
  assert.match(put, /PAGE_SCRIPTS\.begin\(core, label, None\)/, 'an excepted site, or no engine yet, has none')
  assert.match(read('src-tauri/src/shield.rs'), /EPOCH\.fetch_add\(1, Ordering::SeqCst\)/)
})

test('a navigation the shell starts waits until the scripts of the shield for the site are in the tab, so a page that is answered at once is not ahead of them', () => {
  const lib = read('src-tauri/src/lib.rs')
  const navigate = lib.slice(lib.indexOf('async fn webview_navigate('), lib.indexOf('async fn webview_close_tab('))
  assert.match(navigate, /webview_privacy::prepare_navigation\(&app, &label, parsed\.as_str\(\)\)\.await;[\s\S]*webview\.navigate\(parsed\)/, 'prepared first, then the navigation')
  assert.match(navigate, /matches!\(parsed\.scheme\(\), "http" \| "https"\)/, 'only for a web address')
  const privacy = read('src-tauri/src/webview_privacy.rs')
  const prepare = privacy.slice(privacy.indexOf('pub async fn prepare_navigation('))
  assert.match(prepare.slice(0, 600), /if !current\.shield \{\s*return;\s*\}/, 'nothing with the shield off')
  assert.match(prepare, /recv_timeout\(std::time::Duration::from_millis\(800\)\)/, 'bounded: a browser that does not answer does not hold a navigation back for long')
  // The navigation itself puts nothing in again for what is in place: the host is the key.
  assert.match(privacy, /put_page_script\(sender, &navigation_label, &uri, &current, None\)/)
})
