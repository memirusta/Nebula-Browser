import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const API_ROOT = 'https://api.crawlora.net/api/v1/datasets/chrome-extensions/search'
const OUTPUT = resolve('src/core/extensionDiscoveryCatalog.json')
const LIMIT = 200
const PAGE_SIZE = 100
const apiKey = process.env.CRAWLORA_API_KEY?.trim()

if (!apiKey) {
  throw new Error('CRAWLORA_API_KEY ortam değişkeni gerekli.')
}

const knownIds = new Map([
  ['nngceckbapebfimnlniiiahkandclblb', 'bitwarden'],
  ['eimadpbcbfnmbkopoojfekhnkhdbieeh', 'dark-reader'],
  ['mnjggcdmjocbbbhaepdhchncahnbgone', 'sponsorblock'],
  ['oldceeleldhonbafppcapldpdifcinji', 'languagetool'],
])
const palette = ['#6da9ff', '#e5b36b', '#79d7a2', '#bba0ff', '#ef8b9c', '#75d6d1']

function categoryOf(source = '') {
  if (source.includes('privacy')) return 'privacy'
  if (/(entertainment|fun|social)/.test(source)) return 'media'
  if (/(accessibility|art)/.test(source)) return 'appearance'
  return 'productivity'
}

function monogramOf(name) {
  const words = name.match(/[\p{L}\p{N}]+/gu) ?? []
  return words.slice(0, 2).map(word => word[0]).join('').toLocaleUpperCase('en-US') || '•'
}

async function fetchPage(page) {
  const query = new URLSearchParams({
    item_type: 'extension',
    status: 'active',
    manifest_version: '3',
    sort: 'users_desc',
    page_size: String(PAGE_SIZE),
    page: String(page),
  })
  const response = await fetch(`${API_ROOT}?${query}`, { headers: { 'x-api-key': apiKey } })
  if (!response.ok) throw new Error(`Crawlora katalog isteği başarısız: HTTP ${response.status}`)
  const payload = await response.json()
  if (!Array.isArray(payload?.data?.items)) throw new Error('Crawlora beklenmeyen bir yanıt döndürdü.')
  return payload.data.items
}

const rows = (await Promise.all([fetchPage(1), fetchPage(2)])).flat().slice(0, LIMIT)
if (rows.length !== LIMIT) throw new Error(`200 kayıt bekleniyordu, ${rows.length} kayıt geldi.`)
if (new Set(rows.map(row => row.id)).size !== LIMIT) throw new Error('Katalog yinelenen eklenti kimlikleri içeriyor.')
if (rows.some(row => row.status !== 'active' || row.item_type !== 'extension' || row.manifest_version !== 3)) {
  throw new Error('Katalog filtresine uymayan bir kayıt geldi.')
}

const entries = rows.map((row, index) => ({
  id: knownIds.get(row.id) ?? row.id,
  storeId: row.id,
  name: row.name,
  description: row.summary || row.name,
  category: categoryOf(row.category),
  sourceCategory: row.category,
  website: `https://chromewebstore.google.com/detail/${row.id}`,
  monogram: monogramOf(row.name),
  color: palette[index % palette.length],
  developer: row.developer || null,
  version: row.version,
  manifestVersion: row.manifest_version,
  minBrowserVersion: row.min_browser_version || '',
  users: row.users,
  rating: row.rating,
  ratingCount: row.rating_count,
  permissions: row.permissions ?? [],
  optionalPermissions: row.optional_permissions ?? [],
  hostPermissions: row.host_permissions ?? [],
  optionalHostPermissions: row.optional_host_permissions ?? [],
  hasBroadHostAccess: Boolean(row.has_broad_host_access),
  collectsData: Boolean(row.collects_data),
  updated: row.updated,
  lastCrawledAt: row.last_crawled_at,
}))

const snapshot = {
  source: 'Crawlora Chrome Web Store dataset',
  sourceUrl: 'https://crawlora.net/datasets/chrome-web-store',
  fetchedAt: new Date().toISOString(),
  filters: { itemType: 'extension', status: 'active', manifestVersion: 3, sort: 'users_desc', limit: LIMIT },
  entries,
}

await writeFile(OUTPUT, `${JSON.stringify(snapshot)}\n`, 'utf8')
console.log(`Katalog güncellendi: ${entries.length} eklenti.`)
