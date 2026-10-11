import assert from 'node:assert/strict'
import test from 'node:test'
import { EXTENSION_CATALOG, EXTENSION_CATALOG_SOURCE, extensionPackage, searchExtensionCatalog } from '../src/core/extensionCatalog.ts'

test('discovery catalog contains 200 unique popular active MV3 listings', () => {
  assert.equal(EXTENSION_CATALOG.length, 200)
  assert.equal(new Set(EXTENSION_CATALOG.map(entry => entry.storeId)).size, 200)
  assert.ok(EXTENSION_CATALOG.every(entry => (entry.users ?? 0) >= 1_000_000))
  assert.ok(EXTENSION_CATALOG.every(entry => entry.storeId && /^[a-p]{32}$/.test(entry.storeId)))
  assert.ok(EXTENSION_CATALOG.every((entry, index) => index === 0 || (EXTENSION_CATALOG[index - 1].users ?? 0) >= (entry.users ?? 0)))
  assert.equal(EXTENSION_CATALOG_SOURCE.filters.status, 'active')
  assert.equal(EXTENSION_CATALOG_SOURCE.filters.manifestVersion, 3)
})

test('extension search matches Turkish characters and localized descriptions', () => {
  assert.deepEqual(searchExtensionCatalog('ŞİFRE', 'all', 'tr').map((entry) => entry.id), ['bitwarden'])
  assert.deepEqual(searchExtensionCatalog('sifre', 'all', 'tr').map((entry) => entry.id), ['bitwarden'])
})

test('only registered packages expose installation metadata and each uses its own source', () => {
  const installable = EXTENSION_CATALOG.filter(entry => extensionPackage(entry.id))
  assert.deepEqual(installable.map(entry => entry.id).sort(), ['dark-reader', 'sponsorblock'])
  assert.equal(extensionPackage('bitwarden'), undefined)
  assert.equal(extensionPackage('../sponsorblock'), undefined)
  const sponsor = extensionPackage('sponsorblock')!
  const dark = extensionPackage('dark-reader')!
  assert.notEqual(sponsor.url, dark.url)
  assert.notEqual(sponsor.sha256, dark.sha256)
  assert.deepEqual(dark.access, ['*://*/*'])
})

test('extension search combines all query terms with the selected category', () => {
  const appearanceMatches = searchExtensionCatalog('dark appearance', 'appearance', 'en')
  assert.ok(appearanceMatches.some(entry => entry.id === 'dark-reader'))
  assert.ok(appearanceMatches.every(entry => entry.category === 'appearance'))
  assert.equal(searchExtensionCatalog('dark', 'privacy', 'en').length, 0)
  assert.equal(searchExtensionCatalog('nonexistent', 'all', 'en').length, 0)
  assert.equal(searchExtensionCatalog('   ', 'all', 'en').length, 200)
})
