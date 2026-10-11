import assert from 'node:assert/strict'
import test from 'node:test'
import { assessExtensionCompatibility, assessExtensionManifest, compareBrowserVersions, isKnownGap } from '../src/core/extensionCompatibility.ts'
import { extensionCompatibilityCopy } from '../src/core/extensionCompatibilityCopy.ts'
import catalog from '../src/core/extensionDiscoveryCatalog.json' with { type: 'json' }

const base = { manifestVersion: 3, permissions: [], hostPermissions: [] }
test('even a clean preflight cannot certify runtime or functionality', () => {
  const report = assessExtensionCompatibility(base)
  assert.equal(report.status, 'candidate')
  assert.equal(report.runtimeTest, 'not-run')
  assert.equal(report.functionalityTest, 'not-run')
})
test('missing metadata and unknown permissions cannot silently pass', () => {
  assert.equal(assessExtensionCompatibility({}).status, 'review')
  assert.equal(assessExtensionCompatibility({ ...base, permissions: ['futureAPI'] }).status, 'review')
  assert.equal(assessExtensionCompatibility({ ...base, manifestVersion: 2 }).status, 'blocked')
})
test('minimum engine comparison is numeric and unknown is not passed', () => {
  assert.equal(compareBrowserVersions('99.10', '100.0'), -1)
  assert.equal(compareBrowserVersions('150.0.123.2', '150.0.123.1'), 1)
  assert.equal(compareBrowserVersions('150', '150.0.0.0'), 0)
  assert.equal(compareBrowserVersions('bad', '150'), null)
  const entry = { ...base, minBrowserVersion: '151.0' }
  assert.equal(assessExtensionCompatibility(entry).status, 'review')
  assert.equal(assessExtensionCompatibility(entry, '150.0').status, 'blocked')
  assert.equal(assessExtensionCompatibility(entry, '151.0').status, 'candidate')
})
test('optional dependencies and broad access are not treated as incompatibility', () => {
  const report = assessExtensionCompatibility({ ...base, optionalPermissions: ['nativeMessaging', 'futureAPI'], hostPermissions: ['<all_urls>'] })
  assert.equal(report.status, 'candidate')
  assert.ok(report.issues.some(i => i.code === 'nativeMessaging' && i.optional))
  assert.ok(report.issues.some(i => i.code === 'broadAccess' && i.severity === 'info'))
  assert.equal(assessExtensionCompatibility({ ...base, permissions: ['nativeMessaging'] }).status, 'review')
})
test('a real manifest exposes popup, account, side panel and browser integration limitations', () => {
  const report = assessExtensionManifest({ manifest_version: 3, name: 'Fixture', version: '1.0',
    action: { default_popup: 'popup.html' }, permissions: ['tabs', 'identity', 'sidePanel'],
    devtools_page: 'devtools.html', chrome_url_overrides: { newtab: 'newtab.html' } })
  assert.equal(report.scope, 'manifest')
  assert.equal(report.status, 'review')
  for (const code of ['identity', 'sidePanel', 'browserIntegration', 'devtools', 'browserOverride']) {
    assert.ok(report.issues.some(issue => issue.code === code), code)
  }
})
test('malformed manifests and legacy backgrounds fail closed', () => {
  for (const manifest of [null, [], {}, {manifest_version: 3, name:'Fixture', version:'1', permissions:'tabs'},
    {manifest_version: 3, name:'Fixture', version:'1', background:{scripts:['old.js']}}]) {
    assert.equal(assessExtensionManifest(manifest).status, 'blocked')
  }
  for (const version of ['0', '01.0', '1.65536', '1.2.3.4.5']) {
    assert.equal(assessExtensionManifest({manifest_version: 3, name: 'Fixture', version}).status, 'blocked')
  }
  assert.equal(assessExtensionManifest({manifest_version: 3, name: 'Fixture', version:'1', background: []}).status, 'blocked')
})
test('all catalog entries have individual metadata and no hard-coded verification', () => {
  for (const entry of catalog.entries) {
    assert.equal(entry.manifestVersion, 3)
    assert.ok(Array.isArray(entry.optionalPermissions))
    assert.equal('compatibility' in entry, false)
    const report = assessExtensionCompatibility(entry)
    assert.equal(report.runtimeTest, 'not-run')
  }
})
test('every report reason is available in every application language', () => {
  for (const locale of ['tr','en','de','es','fr','id','ru','it','ja'] as const) {
    const copy = extensionCompatibilityCopy(locale)
    for (const code of ['manifest','missingMetadata','minimumVersion','runtimeUnknown','nativeMessaging','identity',
      'browserIntegration','unknownPermission','broadAccess','popup','sidePanel','devtools','browserOverride','legacyBackground',
      'keyboardShortcuts','notifications','contextMenus','userScripts','omnibox','toolbarClick','googleSignIn'] as const) {
      assert.ok(copy.issue(code)?.trim(), `${locale}: ${code}`)
    }
  }
})

const manifestBase = { manifest_version: 3, name: 'Fixture', version: '1.0' }
const codes = (manifest: Record<string, unknown>) => assessExtensionManifest({ ...manifestBase, ...manifest }).issues.map(issue => issue.code)

test('features Nebula does not provide yet are named when the manifest declares them', () => {
  const found = codes({
    permissions: ['notifications', 'contextMenus', 'userScripts', 'identity', 'activeTab'],
    commands: { toggle: { suggested_key: { default: 'Ctrl+E' } } },
    omnibox: { keyword: 'x' }, oauth2: { client_id: 'abc', scopes: [] },
    action: { default_title: 'Open' },
  })
  for (const code of ['notifications', 'contextMenus', 'userScripts', 'keyboardShortcuts', 'omnibox', 'googleSignIn', 'toolbarClick']) {
    assert.ok(found.includes(code as never), code)
  }
})

test('the toolbar click note says what the emulated click cannot grant', () => {
  const issue = assessExtensionManifest({ ...manifestBase, permissions: ['activeTab'], action: {} }).issues.find(i => i.code === 'toolbarClick')
  assert.deepEqual(issue?.details, ['activeTab'])
  assert.deepEqual(assessExtensionManifest({ ...manifestBase, action: {} }).issues.find(i => i.code === 'toolbarClick')?.details, [])
})

test('an extension that declares none of these gaps is not warned about them', () => {
  const found = codes({ permissions: ['storage'], action: { default_popup: 'popup.html' }, commands: { _execute_action: { description: 'open' } } })
  for (const code of ['notifications', 'contextMenus', 'userScripts', 'keyboardShortcuts', 'omnibox', 'googleSignIn', 'toolbarClick']) {
    assert.ok(!found.includes(code as never), `${code} reported without being declared`)
  }
})

test('a gap that is only an optional permission is information, not a warning', () => {
  const report = assessExtensionCompatibility({ manifestVersion: 3, permissions: [], hostPermissions: [], optionalPermissions: ['notifications', 'userScripts'] })
  assert.equal(report.status, 'candidate')
  assert.ok(report.issues.some(i => i.code === 'notifications' && i.optional && i.severity === 'info'))
  assert.ok(report.issues.some(i => i.code === 'userScripts' && i.optional))
})

test('right-click menus are reported by their own message, not as generic browser integration', () => {
  const issues = assessExtensionManifest({ ...manifestBase, permissions: ['contextMenus', 'tabs'] }).issues
  assert.ok(issues.some(i => i.code === 'contextMenus'))
  assert.ok(!issues.find(i => i.code === 'browserIntegration')?.details.includes('contextMenus'))
})

test('only declared, non-optional gaps count as features that will not work', () => {
  const issues = assessExtensionManifest({ ...manifestBase, permissions: ['notifications', 'tabs'], action: { default_popup: 'p.html' } }).issues
  assert.deepEqual(issues.filter(isKnownGap).map(issue => issue.code), ['notifications'])
  const optional = assessExtensionCompatibility({ manifestVersion: 3, permissions: [], hostPermissions: [], optionalPermissions: ['notifications'] })
  assert.equal(optional.issues.filter(isKnownGap).length, 0)
})

test('the heading for unsupported features exists in every application language', () => {
  for (const locale of ['tr','en','de','es','fr','id','ru','it','ja'] as const) {
    assert.ok(extensionCompatibilityCopy(locale).gapsHeading.trim(), locale)
  }
})

test('the emulated toolbar click is a limitation, not a feature that does not work', () => {
  const issues = assessExtensionManifest({ ...manifestBase, action: {} }).issues
  const click = issues.find(issue => issue.code === 'toolbarClick')
  assert.ok(click, 'still reported')
  assert.equal(isKnownGap(click!), false)
})

test('an extension with a toolbar popup is not told its popup entry point is missing', () => {
  // Nebula opens popups from the extensions box, so this used to be a false warning.
  const found = codes({ action: { default_popup: 'popup.html' } })
  assert.ok(!found.includes('popup' as never))
  assert.ok(!found.includes('toolbarClick' as never))
})
