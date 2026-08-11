import type { HistoryEntry } from './browsingHistory'
import type { Shortcut } from './types'

export type HomeHistorySuggestion = {
  kind: 'site' | 'history'
  key: string
  url: string
  host: string
  title: string
  subtitle: string
  visitedAt: number
  visitCount: number
}

const DAY_MS = 24 * 60 * 60 * 1_000

function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function hostForUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

function isRootPage(url: string): boolean {
  try {
    const parsed = new URL(url)
    return (
      (parsed.pathname === '' || parsed.pathname === '/') &&
      !parsed.search &&
      !parsed.hash
    )
  } catch {
    return false
  }
}

function canonicalSiteUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}/`
  } catch {
    return url
  }
}

function prettifyHost(host: string): string {
  const firstLabel = host.replace(/^www\./, '').split('.')[0] || host

  return firstLabel
    .replace(/[-_]+/g, ' ')
    .replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase())
}

function isSearchResultPage(entry: HistoryEntry): boolean {
  try {
    const parsed = new URL(entry.url)
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase()
    const path = parsed.pathname.toLowerCase()

    if (
      host.startsWith('google.') &&
      path === '/search' &&
      parsed.searchParams.has('q')
    ) {
      return true
    }

    if (
      (host === 'bing.com' || host.endsWith('.bing.com')) &&
      path.startsWith('/search') &&
      parsed.searchParams.has('q')
    ) {
      return true
    }

    if (
      (host === 'duckduckgo.com' || host.endsWith('.duckduckgo.com')) &&
      parsed.searchParams.has('q')
    ) {
      return true
    }

    return false
  } catch {
    return false
  }
}
function isTechnicalHistoryEntry(entry: HistoryEntry): boolean {
  try {
    const parsed = new URL(entry.url)
    const host = parsed.hostname.toLowerCase()

    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1'
    ) {
      return true
    }

    const path = parsed.pathname.toLowerCase()
    const callbackLike =
      path.includes('/oauth/callback') ||
      path.includes('/oauth2/callback') ||
      path.includes('/auth/callback') ||
      path.includes('/signin-oidc') ||
      /\/callback\/?$/.test(path)

    const carriesAuthCode =
      parsed.searchParams.has('code') &&
      parsed.searchParams.has('state')

    return callbackLike || (carriesAuthCode && /oauth|auth|signin|callback/.test(path))
  } catch {
    return true
  }
}

function siteMatchRank(
  needle: string,
  host: string,
  title: string,
): number {
  const normalizedHost = normalizeText(host)
  const normalizedTitle = normalizeText(title)

  if (
    normalizedHost.startsWith(needle) ||
    normalizedTitle.startsWith(needle)
  ) {
    return 0
  }

  if (
    normalizedHost.includes(needle) ||
    normalizedTitle.includes(needle)
  ) {
    return 1
  }

  return Number.POSITIVE_INFINITY
}

function pageMatchRank(
  needle: string,
  entry: HistoryEntry,
): number {
  const title = normalizeText(entry.title)
  const host = normalizeText(entry.host)
  const url = normalizeText(entry.url)

  if (title.startsWith(needle)) return 0
  if (host.startsWith(needle)) return 1
  if (title.includes(needle)) return 2
  if (host.includes(needle)) return 3
  if (url.includes(needle)) return 4

  return Number.POSITIVE_INFINITY
}

function recencyWeight(visitedAt: number, now: number): number {
  const age = Math.max(0, now - visitedAt)
  return Math.exp(-age / (7 * DAY_MS))
}

function frequencyWeight(visitCount: number): number {
  return Math.min(1, Math.log2(visitCount + 1) / 6)
}

export function buildHomeHistorySuggestions(
  historyEntries: HistoryEntry[],
  pinnedShortcuts: Shortcut[],
  rawQuery: string,
): HomeHistorySuggestion[] {
  const needle = normalizeText(rawQuery)
  if (!needle) return []

  const usable = historyEntries.filter(
    (entry) => !isTechnicalHistoryEntry(entry),
  )

  const now = Date.now()

  const pinnedByHost = new Map<string, Shortcut>()

  for (const shortcut of pinnedShortcuts) {
    const host = hostForUrl(shortcut.url)

    if (host && !pinnedByHost.has(host)) {
      pinnedByHost.set(host, shortcut)
    }
  }

  const groups = new Map<
    string,
    {
      entries: HistoryEntry[]
      latest: HistoryEntry
      visitCount: number
    }
  >()

  for (const entry of usable) {
    const current = groups.get(entry.host)

    if (!current) {
      groups.set(entry.host, {
        entries: [entry],
        latest: entry,
        visitCount: 1,
      })
      continue
    }

    current.entries.push(entry)
    current.visitCount += 1

    if (entry.visitedAt > current.latest.visitedAt) {
      current.latest = entry
    }
  }

  const siteSuggestions = Array.from(groups.entries())
    .flatMap(([host, group]) => {
      const pinned = pinnedByHost.get(host)

      const rootEntry = group.entries
        .filter((entry) => isRootPage(entry.url))
        .sort((a, b) => b.visitedAt - a.visitedAt)[0]

      const title =
        pinned?.label?.trim() ||
        rootEntry?.title?.trim() ||
        prettifyHost(host)

      const matchRank = siteMatchRank(needle, host, title)
      if (!Number.isFinite(matchRank)) return []

      const score =
        matchRank * 100 -
        recencyWeight(group.latest.visitedAt, now) * 25 -
        frequencyWeight(group.visitCount) * 15

      return [{
        suggestion: {
          kind: 'site' as const,
          key: `site:${host}`,
          url: canonicalSiteUrl(
            pinned?.url ||
            rootEntry?.url ||
            group.latest.url,
          ),
          host,
          title,
          subtitle: host,
          visitedAt: group.latest.visitedAt,
          visitCount: group.visitCount,
        },
        score,
      }]
    })
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score
      return b.suggestion.visitedAt - a.suggestion.visitedAt
    })
    .slice(0, 2)
    .map(({ suggestion }) => suggestion)

  const displayedSiteHosts = new Set(
    siteSuggestions.map((suggestion) => suggestion.host),
  )

  const exactUrls = new Set<string>()

  const pageCandidates = usable
    .filter((entry) => !isSearchResultPage(entry))
    .flatMap((entry) => {
      const matchRank = pageMatchRank(needle, entry)
      if (!Number.isFinite(matchRank)) return []

      const score =
        matchRank * 100 -
        recencyWeight(entry.visitedAt, now) * 25

      return [{ entry, score }]
    })
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score
      return b.entry.visitedAt - a.entry.visitedAt
    })
    .filter(({ entry }) => {
      if (exactUrls.has(entry.url)) return false

      exactUrls.add(entry.url)
      return true
    })

  const pagesPerHost = new Map<string, number>()
  const pageSuggestions: HomeHistorySuggestion[] = []

  for (const { entry } of pageCandidates) {
    if (pageSuggestions.length >= 3) break

    if (
      displayedSiteHosts.has(entry.host) &&
      isRootPage(entry.url)
    ) {
      continue
    }

    const usedForHost = pagesPerHost.get(entry.host) ?? 0
    const hostLimit = displayedSiteHosts.has(entry.host) ? 1 : 2

    if (usedForHost >= hostLimit) continue

    pagesPerHost.set(entry.host, usedForHost + 1)

    pageSuggestions.push({
      kind: 'history',
      key: `history:${entry.id}`,
      url: entry.url,
      host: entry.host,
      title: entry.title,
      subtitle: entry.url,
      visitedAt: entry.visitedAt,
      visitCount: groups.get(entry.host)?.visitCount ?? 1,
    })
  }

  return [
    ...siteSuggestions,
    ...pageSuggestions,
  ]
}

export function filterHomeWebSuggestions(
  webSuggestions: string[],
  localSuggestions: HomeHistorySuggestion[],
  rawQuery: string,
  limit = 5,
): string[] {
  const blocked = new Set<string>()

  const query = normalizeText(rawQuery)
  if (query) blocked.add(query)

  for (const suggestion of localSuggestions) {
    if (suggestion.kind !== 'site') continue

    blocked.add(normalizeText(suggestion.title))
    blocked.add(normalizeText(suggestion.host))
    blocked.add(normalizeText(suggestion.host.replace(/\.[^.]+$/, '')))
  }

  const seen = new Set<string>()
  const result: string[] = []

  for (const suggestion of webSuggestions) {
    const normalized = normalizeText(suggestion)

    if (
      !normalized ||
      blocked.has(normalized) ||
      seen.has(normalized)
    ) {
      continue
    }

    seen.add(normalized)
    result.push(suggestion)

    if (result.length >= limit) break
  }

  return result
}