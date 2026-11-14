import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

import { chromeOverlayMinimumHeight, TALL_PANEL_OVERLAY_HEIGHT } from '../src/core/chromeOverlayLayout.ts'
import { EMPTY_SHIELD_PAGE_SUMMARY, sameShieldSummary, shieldBadgeText } from '../src/core/shieldSummary.ts'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('the count on the shields button is cut at 99+, and a summary is told again only when it changed', () => {
  assert.equal(shieldBadgeText(0), '0')
  assert.equal(shieldBadgeText(7), '7')
  assert.equal(shieldBadgeText(99), '99')
  assert.equal(shieldBadgeText(100), '99+')
  assert.equal(shieldBadgeText(-4), '0')
  const a = { total: 3, ads: 2, trackers: 1, top: [{ host: 'a.example', count: 3 }] }
  assert.equal(sameShieldSummary(a, { ...a, top: [{ host: 'a.example', count: 3 }] }), true)
  assert.equal(sameShieldSummary(a, { ...a, total: 4 }), false)
  assert.equal(sameShieldSummary(a, { ...a, top: [{ host: 'b.example', count: 3 }] }), false)
  assert.equal(sameShieldSummary(a, { ...a, top: [] }), false)
  assert.equal(sameShieldSummary(undefined, a), false)
  assert.equal(sameShieldSummary(undefined, undefined), true)
  assert.equal(sameShieldSummary(EMPTY_SHIELD_PAGE_SUMMARY, { total: 0, ads: 0, trackers: 0, top: [] }), true)
})

test('the overlay is as tall as a panel needs while the shield and site panel is open', () => {
  const closed = { siteInfoOpen: false, privateInfoOpen: false, tabSearchOpen: false, isBrowsing: true, hasZoom: false, hasSensitiveUsage: false }
  assert.equal(chromeOverlayMinimumHeight({ ...closed, siteInfoOpen: true }), TALL_PANEL_OVERLAY_HEIGHT)
  assert.equal(chromeOverlayMinimumHeight(closed), 0)
})

/** The COPY object of the panel, read from its source (the component imports its neighbours without extensions, which Node cannot load). */
function panelCopy(): Record<string, Record<string, string>> {
  const source = read('src/components/ShieldPanel/ShieldPanel.tsx')
  const start = source.indexOf('const COPY = {')
  const end = source.indexOf('} as const', start)
  assert.ok(start > 0 && end > start, 'the copy is found')
  return vm.runInNewContext(`(${source.slice(start + 'const COPY = '.length, end + 1)})`)
}

test('the shield panel speaks every language, with the same words in each', () => {
  const copy = panelCopy()
  assert.deepEqual(Object.keys(copy), ['tr', 'en', 'es', 'de', 'fr', 'id', 'ru', 'it', 'ja'])
  const keys = Object.keys(copy.en).sort()
  assert.ok(keys.length >= 15)
  for (const [locale, words] of Object.entries(copy)) {
    assert.deepEqual(Object.keys(words).sort(), keys, locale)
    for (const [key, value] of Object.entries(words)) assert.ok(value.trim().length > 0, `${locale}.${key} is empty`)
  }
})

test('the strings of the button and of the settings cards exist in all nine languages', () => {
  const keys = ['shieldButton', 'shieldButtonAria', 'shieldButtonInsecure', 'shieldStatsAds', 'shieldStatsTrackers', 'shieldStatsMalware', 'shieldStatsSince', 'shieldStatsReset', 'shieldGroupBlocking', 'shieldGroupMalware', 'shieldGroupRules', 'shieldGroupLists', 'shieldListsHint', 'shieldListRules', 'shieldListOwn']
  for (const file of ['localeMessages.ts', 'localeMessages.es.ts', 'localeMessages.de.ts', 'localeMessages.additional.ts', 'localeMessages.it-ja.ts']) {
    const text = read(`src/core/${file}`)
    for (const key of keys) assert.match(text, new RegExp(`["']?${key}["']?: `), `${file} has ${key}`)
  }
  // The words that carry a value keep their place in every language.
  const main = read('src/core/localeMessages.ts')
  assert.match(main, /shieldButtonAria: \{[^}]*\{host\}[^}]*\{count\}/)
  assert.match(main, /shieldStatsSince: \{[^}]*\{date\}/)
  assert.match(main, /shieldListRules: \{[^}]*\{count\}/)
})

test('one button of the menu is the shield and the lock, its panel has a Shield tab and a Site tab, and there is a way into the settings', () => {
  const menu = read('src/components/SemiLunarMenu/SemiLunarMenu.tsx')
  // The lock is gone: the button that opens the site panel is the shield, with the count and, when the connection is not secure, the lock's warning.
  assert.match(menu, /isBrowsing && activeSiteHost && onSiteInfoClick/)
  assert.match(menu, /<ShieldIcon off=\{shieldState !== 'on'\} \/>/)
  assert.match(menu, /shieldBadgeText\(shieldBlocked\)/)
  assert.match(menu, /!activeSiteSecure && <span className=\{styles\.siteSecurityWarning\}/)
  assert.match(menu, /shieldButtonInsecure/)
  assert.doesNotMatch(menu, /onShieldClick|shieldOpen/, 'no second button')
  assert.doesNotMatch(menu, /M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5z/, 'no lock icon')
  const chrome = read('src/ChromeApp.tsx')
  assert.equal(chrome.match(/<ShieldPanel/g)?.length, 1, 'one panel')
  assert.doesNotMatch(chrome, /<SiteInfoPanel|shieldOpen/, 'the site panel is the shield panel')
  assert.match(chrome, /siteInfoOpen && effectiveSiteInfoState\.hostname[\s\S]*?<ShieldPanel[\s\S]*?type: 'set-site-protection'/, 'the switch of the site is the site exception')
  assert.match(chrome, /type: 'open-shield-settings'/)
  for (const action of ['set-site-darkening', 'set-site-notification-permission', 'reset-site-permissions', 'clear-site-data']) assert.match(chrome, new RegExp(`type: '${action}'`), `${action} is still told`)
  const panel = read('src/components/ShieldPanel/ShieldPanel.tsx')
  assert.match(panel, /role="tablist"/)
  assert.match(panel, /role="tab"/)
  assert.match(panel, /<SiteInfoPanel\s+embedded/, 'the Site tab is the site panel')
  assert.match(panel, /ArrowLeft/, 'arrow keys move between the tabs')
  const site = read('src/components/SiteInfoPanel/SiteInfoPanel.tsx')
  assert.match(site, /active: !embedded/, 'inside another panel it takes no focus trap of its own')
  assert.match(site, /\{!embedded && \(\s+<>\s+<div className=\{styles\.sectionHeader\}>\s+<span>\{copy\.protection\}/, 'the switch of the site is on the other tab')
  const shell = read('src/components/BrowserShell/BrowserShell.tsx')
  assert.match(shell, /case 'open-shield-settings':[\s\S]*?setShieldSettingsRequest/)
  assert.match(shell, /shieldSettingsRequest=\{shieldSettingsRequest\}/)
  assert.match(read('src/components/SettingsPanel/SettingsPanel.tsx'), /setActiveId\('privacy'\)[\s\S]{0,400}nebula-shield-settings/)
})

test('the count is asked for only while the shield works on the page, and told only when it changed', () => {
  const shell = read('src/components/BrowserShell/BrowserShell.tsx')
  assert.match(shell, /const shieldPollOn = activeSiteInfoState\.shieldOn === true/)
  assert.match(shell, /if \(!isTauri \|\| !shieldPollOn \|\| !shieldPollTab\) return/)
  assert.match(shell, /sameShieldSummary\(lastShieldSummaryRef\.current, summary\)/)
  assert.match(shell, /window\.clearInterval\(timer\)/, 'the poll stops with the page')
})

test('the totals stay on the device: nothing is sent, and the person can start the count again', () => {
  const rust = read('src-tauri/src/shield.rs')
  assert.match(rust, /goes nowhere/)
  assert.match(rust, /fn stats_file\(/)
  // Written aside and put in place whole, and not more often than every twenty seconds.
  assert.match(rust, /with_extension\("json\.tmp"\)/)
  assert.match(rust, /Duration::from_secs\(20\)/)
  const settings = read('src/components/SettingsPanel/ShieldSettings.tsx')
  assert.match(settings, /resetShieldStats\(\)/)
  assert.doesNotMatch(read('src-tauri/src/shield.rs'), /reqwest::(Client|get)|\.send\(\)/)
})
