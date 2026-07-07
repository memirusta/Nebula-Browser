import type { Shortcut } from './types'

const MAX_CUSTOM_SHORTCUTS = 32

function hostKey(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return url.toLowerCase()
  }
}

function isSearchResultUrl(url: URL): boolean {
  const host = url.hostname.replace(/^www\./, '').toLowerCase()
  if (host.includes('google.') && url.pathname === '/search' && url.searchParams.has('q')) {
    return true
  }
  if (
    host.includes('bing.') &&
    (url.pathname === '/search' || url.pathname.startsWith('/search')) &&
    url.searchParams.has('q')
  ) {
    return true
  }
  if (host.includes('duckduckgo.') && url.searchParams.has('q')) return true
  return false
}

function labelFromHost(host: string): string {
  const base = host.replace(/^www\./, '').split('.')[0] ?? host
  return base.charAt(0).toUpperCase() + base.slice(1)
}

function slugQuery(query: string): string {
  return query
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

function shortcutFromSearchUrl(url: URL): Shortcut | null {
  const query = (url.searchParams.get('q') ?? '').trim()
  if (!query) return null

  const host = url.hostname.replace(/^www\./, '').toLowerCase()
  let engine = 'google'
  let faviconDomain = 'google.com'
  if (host.includes('bing.')) {
    engine = 'bing'
    faviconDomain = 'bing.com'
  } else if (host.includes('duckduckgo.')) {
    engine = 'duckduckgo'
    faviconDomain = 'duckduckgo.com'
  }

  const slug = slugQuery(query) || 'query'
  const id = `search-${engine}-${slug}`
  const label = query.length > 36 ? `${query.slice(0, 36)}…` : query

  return {
    id,
    label,
    url: url.href,
    favicon: `https://www.google.com/s2/favicons?domain=${faviconDomain}&sz=64`,
  }
}

export function isSearchShortcutId(id: string): boolean {
  return id.startsWith('search-')
}

/** Stable tab/shortcut id for ad-hoc visit URLs (shared by semi-lunar + tab open). */
export function visitShortcutIdFromUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl)
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase()
    if (!host) return 'visit-unknown'

    const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1'
    if (isLoopback) {
      const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80')
      return `visit-localhost-${port}`
    }

    return `visit-${host.replace(/\./g, '-')}`
  } catch {
    const slug = rawUrl
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
    return `visit-${slug || 'unknown'}`
  }
}

export function shortcutFromUrl(rawUrl: string): Shortcut | null {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return null
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) return null

  if (isSearchResultUrl(parsed)) {
    return shortcutFromSearchUrl(parsed)
  }

  const host = parsed.hostname.replace(/^www\./, '')
  if (!host) return null

  const normalizedUrl = `${parsed.protocol}//${parsed.host}/`
  const id = visitShortcutIdFromUrl(parsed.href)

  return {
    id,
    label: labelFromHost(host),
    url: normalizedUrl,
    favicon: `https://www.google.com/s2/favicons?domain=${host}&sz=64`,
  }
}

export function mergeShortcutLists(
  defaults: Shortcut[],
  custom: Shortcut[],
): Shortcut[] {
  const seenHosts = new Set(defaults.map((s) => hostKey(s.url)))
  const seenSearchIds = new Set<string>()

  const extra = custom.filter((s) => {
    if (isSearchShortcutId(s.id)) {
      if (seenSearchIds.has(s.id)) return false
      seenSearchIds.add(s.id)
      return true
    }
    const key = hostKey(s.url)
    if (seenHosts.has(key)) return false
    seenHosts.add(key)
    return true
  })

  return [...defaults, ...extra]
}

export function hostKeyForShortcut(url: string): string {
  return hostKey(url)
}

export function trimCustomShortcuts(custom: Shortcut[]): Shortcut[] {
  return custom.slice(-MAX_CUSTOM_SHORTCUTS)
}

export function findShortcutByHost(shortcuts: Shortcut[], visitHost: string): Shortcut | undefined {
  return shortcuts.find((s) => !isSearchShortcutId(s.id) && hostKey(s.url) === visitHost)
}
