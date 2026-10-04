/**
 * The icons of the sites the user has visited, kept on this machine, one per site.
 *
 * Browsers keep a favicon database that fills while pages are visited: the page offers its own icon,
 * the browser stores it, and the address bar reads it back. This is that for Nebula: the icon a tab
 * reports is scaled down and remembered by host, and the address field's suggestions show it.
 *
 * A site in the history that has no icon yet (visited before this existed, or never reported one) is
 * asked for once (`ensure`): the native side tries the site's own icon first and a favicon service
 * only if the site has none. The answer is kept, so a site is asked for at most once; a site with no
 * icon anywhere is not asked again for a few days. Until an icon is there a letter stands in.
 *
 * Private tabs are never remembered. The data is derived, so it is kept out of the shell state
 * mirror (the `__nebula_` prefix) and may be lost at a switch of environment without harm.
 */
import { isLocalNetworkHostname } from './addressNavigation.ts'

export const FAVICON_CACHE_KEY = '__nebula_favicon-cache-v1'

const MAX_HOSTS = 250
const MAX_MISSING = 400
const MAX_TOTAL_CHARS = 1_000_000
/** What the page gave: native icons are PNG data URLs (see normalizePageFavicon). */
const MAX_SOURCE_CHARS = 90_000
/** What is kept: a 64 px icon is a few kilobytes. */
const MAX_STORED_CHARS = 24_000
const REFRESH_AFTER_MS = 14 * 24 * 60 * 60 * 1_000
/** A site that had no icon anywhere is looked at again after this long. */
const RETRY_MISSING_AFTER_MS = 3 * 24 * 60 * 60 * 1_000
const ICON_SIZE = 64

export interface FaviconStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

interface Stored {
  version: 1
  icons: Record<string, { icon: string; at: number }>
  /** Sites that had no icon when asked, and when. */
  missing: Record<string, number>
}

/** The site an icon belongs to, or null for addresses that are not a site (local, no domain, not http). */
export function faviconHostKey(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    const host = parsed.hostname.replace(/\.$/, '').replace(/^www\./, '').toLowerCase()
    if (!host.includes('.') || isLocalNetworkHostname(host)) return null
    return host
  } catch {
    return null
  }
}

export function createFaviconCache(
  storage: FaviconStorage | null,
  scale: (icon: string) => Promise<string | null>,
  now: () => number = () => Date.now(),
  /** Asks the native side for the icon of a public site (a data URL), or nothing. */
  fetcher: ((host: string) => Promise<string | null>) | null = null,
) {
  let memory: Stored | null = null
  const running = new Map<string, Promise<string | null>>()

  const load = (): Stored => {
    if (memory) return memory
    memory = { version: 1, icons: {}, missing: {} }
    try {
      const raw = storage?.getItem(FAVICON_CACHE_KEY)
      const parsed = raw ? (JSON.parse(raw) as Partial<Stored>) : null
      if (parsed?.version === 1) {
        if (parsed.icons && typeof parsed.icons === 'object') {
          for (const [host, entry] of Object.entries(parsed.icons)) {
            if (
              entry &&
              typeof entry.icon === 'string' &&
              entry.icon.startsWith('data:image/') &&
              typeof entry.at === 'number'
            ) {
              memory.icons[host] = { icon: entry.icon, at: entry.at }
            }
          }
        }
        if (parsed.missing && typeof parsed.missing === 'object') {
          for (const [host, at] of Object.entries(parsed.missing)) {
            if (typeof at === 'number') memory.missing[host] = at
          }
        }
      }
    } catch {
      // A damaged cache is an empty one.
    }
    return memory
  }

  const save = () => {
    const stored = load()
    // The ones not refreshed for the longest go first.
    const hosts = Object.keys(stored.icons).sort((a, b) => stored.icons[a].at - stored.icons[b].at)
    let total = hosts.reduce((sum, host) => sum + stored.icons[host].icon.length, 0)
    let count = hosts.length
    for (const host of hosts) {
      if (count <= MAX_HOSTS && total <= MAX_TOTAL_CHARS) break
      total -= stored.icons[host].icon.length
      delete stored.icons[host]
      count -= 1
    }
    const missing = Object.keys(stored.missing).sort((a, b) => stored.missing[a] - stored.missing[b])
    for (const host of missing.slice(0, Math.max(0, missing.length - MAX_MISSING))) {
      delete stored.missing[host]
    }
    try {
      storage?.setItem(FAVICON_CACHE_KEY, JSON.stringify(stored))
    } catch {
      // Storage full or not available: the icons stay for this run only.
    }
  }

  const api = {
    /** The remembered icon of the site `url` is on, if any. */
    lookup(url: string): string | null {
      const host = faviconHostKey(url)
      return host ? load().icons[host]?.icon ?? null : null
    },

    /** Remembers the icon a page reported for itself. Never for a private tab. */
    async remember(url: string, icon: string, isPrivate: boolean): Promise<boolean> {
      if (isPrivate) return false
      const host = faviconHostKey(url)
      if (!host || !icon.startsWith('data:image/') || icon.length > MAX_SOURCE_CHARS) return false
      const known = load().icons[host]
      if (known && now() - known.at < REFRESH_AFTER_MS) return false
      const small = await scale(icon).catch(() => null)
      if (!small || small.length > MAX_STORED_CHARS) return false
      const stored = load()
      stored.icons[host] = { icon: small, at: now() }
      delete stored.missing[host]
      save()
      return true
    },

    /**
     * The icon of the site `url` is on, asking for it once if it is not known. At most one request
     * per site at a time, and none for a site that had no icon anywhere in the last few days.
     */
    async ensure(url: string): Promise<string | null> {
      const host = faviconHostKey(url)
      if (!host) return null
      const known = api.lookup(url)
      if (known) return known
      if (!fetcher) return null
      const missedAt = load().missing[host]
      if (missedAt !== undefined && now() - missedAt < RETRY_MISSING_AFTER_MS) return null
      const already = running.get(host)
      if (already) return already

      const job = (async () => {
        const found = await fetcher(host).catch(() => null)
        // The icon is handled like one a page gave: it is checked, scaled and stored the same way.
        if (found && (await api.remember(`https://${host}/`, found, false))) return api.lookup(url)
        const stored = load()
        stored.missing[host] = now()
        save()
        return null
      })().finally(() => running.delete(host))
      running.set(host, job)
      return job
    },

    size(): number {
      return Object.keys(load().icons).length
    },
  }
  return api
}

/** The page's icon as a 64 px PNG, using the browser's own image decoding. */
async function scaleWithCanvas(icon: string): Promise<string | null> {
  if (typeof Image === 'undefined' || typeof document === 'undefined') return null
  const image = new Image()
  image.src = icon
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = ICON_SIZE
  canvas.height = ICON_SIZE
  const context = canvas.getContext('2d')
  if (!context) return null
  context.drawImage(image, 0, 0, ICON_SIZE, ICON_SIZE)
  return canvas.toDataURL('image/png')
}

/** Asks the native side. Imported late so the cache itself needs no Tauri to be tested. */
async function fetchWithNative(host: string): Promise<string | null> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<string | null>('favicon_fetch', { host })
}

function browserStorage(): FaviconStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

let shared: ReturnType<typeof createFaviconCache> | null = null
const sharedCache = () =>
  (shared ??= createFaviconCache(browserStorage(), scaleWithCanvas, () => Date.now(), fetchWithNative))

export const cachedFaviconForUrl = (url: string): string | null => sharedCache().lookup(url)

export const rememberFavicon = (url: string, icon: string, isPrivate: boolean): Promise<boolean> =>
  sharedCache().remember(url, icon, isPrivate)

/** The icon of the site, asking the native side once if there is none yet. */
export const ensureFavicon = (url: string): Promise<string | null> => sharedCache().ensure(url)
