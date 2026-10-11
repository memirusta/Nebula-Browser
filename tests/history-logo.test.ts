import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))

test('every history row and recently closed tab shows the logo of its site from the local cache', () => {
  const panel = read('src/components/HistoryPanel/HistoryPanel.tsx')
  // A row of the history list: time, logo, then the title.
  const row = panel.slice(panel.indexOf('<article key={entry.id} className={styles.historyItem}>'))
  const time = row.indexOf('styles.time')
  const logo = row.indexOf('<SiteLogo url={entry.url}')
  const body = row.indexOf('styles.itemBody')
  assert.ok(time > 0 && time < logo && logo < body, 'time, then logo, then text')
  // The recently closed tabs use it too, so a tab without a stored icon is not a bare letter forever.
  assert.ok(panel.includes('<SiteLogo url={entry.url} stored={entry.favicon}'))
  // The panel redraws when an icon is kept.
  assert.ok(panel.includes('useFaviconRefresh()'))
  assert.match(read('src/components/HistoryPanel/HistoryPanel.module.css'), /grid-template-columns: 48px 22px minmax\(0, 1fr\)/)
})

test('the logo asks for a missing icon only once its row is on screen, and never shows a service address for a row nobody saw', () => {
  const logo = read('src/components/HistoryPanel/SiteLogo.tsx')
  assert.ok(logo.includes('IntersectionObserver'))
  assert.ok(logo.includes('cachedFaviconForUrl(url)'))
  assert.ok(logo.includes('ensureFavicon(url)'))
  // Only an icon that is already data is taken from the entry; an address is not loaded into the image.
  assert.ok(logo.includes("stored?.startsWith('data:image/')"))
  assert.doesNotMatch(logo, /faviconForUrl|gstatic|google\.com/)
})
