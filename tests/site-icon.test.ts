import assert from 'node:assert/strict'
import test from 'node:test'
import { siteIconSource } from '../src/core/siteIcon.ts'

const DATA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='

test('an icon the page itself gave is used as it is', () => {
  assert.equal(siteIconSource(DATA, 'https://example.com/'), DATA)
  assert.equal(siteIconSource(`  ${DATA}  `, 'https://example.com/'), DATA)
})

test('until an icon is kept, what was stored is shown, and the service address stands in when nothing was', () => {
  const service = 'https://www.google.com/s2/favicons?domain=example.com&sz=64'
  assert.equal(siteIconSource(service, 'https://example.com/'), service)
  assert.match(siteIconSource(undefined, 'https://example.com/page'), /google\.com\/s2\/favicons/)
})

test('a private tab never uses or fills the cache', () => {
  const stored = 'https://www.google.com/s2/favicons?domain=secret.example.com&sz=64'
  assert.equal(siteIconSource(stored, 'https://secret.example.com/', { isPrivate: true }), stored)
  assert.match(siteIconSource(undefined, 'https://secret.example.com/', { isPrivate: true }), /google\.com\/s2\/favicons/)
})

test('addresses that are not a site get Nebula\'s own logo, not a request to anyone', () => {
  for (const url of ['http://localhost:3000/', 'http://192.168.0.2/', 'https://intranet/']) {
    assert.equal(siteIconSource(undefined, url), '/nebula-app-logo.png', url)
  }
})

test('every place that shows a site icon goes through the selector and redraws when an icon is kept', async () => {
  const { readFileSync } = await import('node:fs')
  const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  const sites = [
    'src/components/HistoryPanel/HistoryPanel.tsx',
    'src/components/HomeCenter/PinnedShortcutEditor.tsx',
    'src/components/HomeCenter/PinnedStrip.tsx',
    'src/components/SemiLunarMenu/FolderExpandPanel.tsx',
    'src/components/SemiLunarMenu/SemiLunarMenu.tsx',
    'src/components/SemiLunarMenu/ShortcutContextMenu.tsx',
    'src/components/SemiLunarMenu/ShortcutFolderIcon.tsx',
    'src/components/SemiLunarMenu/ShortcutPreviewOverlay.tsx',
    'src/components/TabSearch/TabSearch.tsx',
  ]
  for (const path of sites) {
    const source = read(path)
    assert.match(source, /siteIconSource\(/, `${path} must pick icons with siteIconSource`)
    assert.match(source, /useFaviconRefresh\(\)/, `${path} must redraw when an icon is kept`)
    // A raw stored address would put the favicon service back on the page for every draw.
    assert.doesNotMatch(source, /<img[^>]*src=\{(?:[A-Za-z.]+)\.favicon\}/, `${path} still shows a raw stored icon`)
    assert.doesNotMatch(source, /^\s*src=\{[A-Za-z.]+\.favicon\}/m, `${path} still shows a raw stored icon`)
  }
  // Tabs of a private window never ask for or use the kept icons.
  assert.match(read('src/components/SemiLunarMenu/SemiLunarMenu.tsx'), /siteIconSource\(tab\.favicon, tab\.url, \{ isPrivate: tab\.isPrivate \}\)/)
  assert.match(read('src/components/TabSearch/TabSearch.tsx'), /isPrivate: tab\.isPrivate/)
})
