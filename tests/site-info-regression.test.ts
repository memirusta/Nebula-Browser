import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { chromeOverlayMinimumHeight } from '../src/core/chromeOverlayLayout.ts'
import {
  addSiteException,
  removeSiteException,
} from '../src/core/siteCompatibility.ts'

function read(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('site protection changes preserve unrelated exceptions', () => {
  assert.equal(
    addSiteException('one.test', 'two.test'),
    'one.test, two.test',
  )
  assert.equal(
    removeSiteException('one.test, two.test', 'one.test'),
    'two.test',
  )
})

test('site information actions are checked against the active tab and origin', () => {
  const shell = read('src/components/BrowserShell/BrowserShell.tsx')
  const bridge = read('src/core/nebulaBridge.ts')
  const privacy = read('src-tauri/src/webview_privacy.rs')
  const permissions = read('src-tauri/permissions/webview-commands.toml')

  assert.match(bridge, /type: 'reset-site-permissions'; shortcutId: string; origin: string/)
  assert.match(bridge, /type: 'clear-site-data'; shortcutId: string; origin: string/)
  assert.match(shell, /site\.shortcutId !== action\.shortcutId[\s\S]*?site\.origin !== action\.origin/)
  assert.match(shell, /Storage\.clearDataForOrigin/)
  assert.match(privacy, /pub async fn clear_site_permissions/)
  assert.match(privacy, /matches!\(parsed\.scheme\(\), "http" \| "https"\)/)
  assert.match(permissions, /webview_clear_site_permissions/)
})

test('site panel exposes real controls and destructive clearing is two-step', () => {
  const panel = read('src/components/SiteInfoPanel/SiteInfoPanel.tsx')
  const chrome = read('src/ChromeApp.tsx')
  const lunar = read('src/components/SemiLunarMenu/SemiLunarMenu.tsx')
  const bridge = read('src/core/nebulaBridge.ts')
  assert.match(panel, /state\.permissions\.camera/)
  assert.match(panel, /onToggleProtection/)
  assert.match(panel, /onSetNotificationPermission/)
  assert.match(panel, /onResetPermissions/)
  assert.match(panel, /if \(!confirmClear\)/)
  assert.doesNotMatch(panel, /window\.confirm|window\.alert/)
  assert.match(chrome, /effectiveSiteInfoState/)
  assert.match(chrome, /siteCompatibilityTarget\(activeUrl\)/)
  assert.match(lunar, /siteSecurityBtn/)
  assert.match(lunar, /activeSiteSecure[\s\S]*?siteSecurityWarning/)
  assert.doesNotMatch(lunar, /siteInfoChip/)
  assert.match(
    bridge,
    /type: 'raise-chrome-overlay'/,
  )
  assert.match(chrome, /setChromeOverlayMinimumLogicalHeight[\s\S]*?raise-chrome-overlay/)
  assert.match(chrome, /chromeOverlayMinimumHeight\(\{/)
})

test('native chrome reserves room for each panel and releases it after closing', () => {
  const closed = {
    siteInfoOpen: false, privateInfoOpen: false, tabSearchOpen: false,
    isBrowsing: true, hasZoom: false, hasSensitiveUsage: false,
  }
  for (const panel of ['siteInfoOpen', 'privateInfoOpen', 'extensionsOpen', 'tabSearchOpen'] as const) {
    assert.equal(chromeOverlayMinimumHeight({ ...closed, [panel]: true }), 650)
  }
  assert.equal(chromeOverlayMinimumHeight(closed), 0)
  assert.equal(chromeOverlayMinimumHeight({ ...closed, hasZoom: true }), 78)
  assert.equal(chromeOverlayMinimumHeight({ ...closed, hasSensitiveUsage: true }), 78)
  assert.equal(chromeOverlayMinimumHeight({ ...closed, hasZoom: true, hasSensitiveUsage: true }), 138)
  assert.equal(chromeOverlayMinimumHeight({ ...closed, isBrowsing: false, hasZoom: true }), 0)
})

test('Semi-Lunar context menu identifies its tab and supports keyboard navigation', () => {
  const menu = read('src/components/SemiLunarMenu/ShortcutContextMenu.tsx')
  assert.match(menu, /shortcut\.favicon/)
  assert.match(menu, /new URL\(shortcut\.url\)\.hostname/)
  assert.match(menu, /ArrowDown.*ArrowUp.*Home.*End/)
  assert.match(menu, /isTabOpen \? t\('ctxClose'\) : t\('removeShortcut'\)/)
})
