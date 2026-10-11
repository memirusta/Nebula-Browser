import type { HistoryEntry } from './browsingHistory'
import type { Shortcut } from './types'

/**
 * What the address field offers while the user types.
 *
 * - `site`:    a site the user visits (its front page), matched on its name or address;
 * - `history`: a page the user visited, matched on every word typed (title, address, path);
 * - `query`:   something the user searched for before, from the search pages in their history.
 *
 * Ranking is relevance times frecency: how well the words match (an address that starts with the
 * text beats a word start in a title beats a match somewhere inside), scaled by how much and how
 * recently the user went there. A page visited every day outranks one that matches slightly better
 * but was seen once a year ago; an exact start of an address still beats a loose match.
 */
export type HomeHistorySuggestion = {
  kind: 'site' | 'history' | 'query'
  key: string
  url: string
  host: string
  title: string
  subtitle: string
  visitedAt: number
  visitCount: number
}

const DAY_MS = 24 * 60 * 60 * 1_000

// ---- text -------------------------------------------------------------------------------------

/**
 * Lower case, without accents, with Turkish dotted and dotless i treated as one letter, so that
 * "sicak" finds "sıcak" and "Instagram" finds "instagram" whatever the system language is.
 */
function foldChar(character: string): string {
  return character
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/ı/g, 'i')
}

function normalizeText(value: string): string {
  let result = ''
  for (const character of value.normalize('NFKC')) result += foldChar(character)
  return result.replace(/\s+/g, ' ').trim()
}

/** The words of a typed query, folded. Every one of them has to match. */
export function queryTerms(rawQuery: string): string[] {
  const normalized = normalizeText(rawQuery)
  return normalized ? normalized.split(' ') : []
}

function isWordCharacter(character: string | undefined): boolean {
  return character !== undefined && /[\p{L}\p{N}]/u.test(character)
}

/** Whether `term` begins a word of `text` (the start of the text, or right after a non-letter). */
function startsAWord(text: string, term: string): boolean {
  let from = 0
  for (;;) {
    const at = text.indexOf(term, from)
    if (at < 0) return false
    if (at === 0 || !isWordCharacter(text[at - 1])) return true
    from = at + 1
  }
}

// ---- addresses ----------------------------------------------------------------------------------

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

/** An address as a person reads it: no scheme, no leading www. */
function displayAddress(url: string): string {
  return url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^www\./i, '')
}

/** What a search page on a known engine was asked, if it is one. */
function searchedQuery(url: string): string | null {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase()
    const path = parsed.pathname.toLowerCase()
    const q = parsed.searchParams.get('q')?.trim()
    if (!q) return null

    if (host.startsWith('google.') && path === '/search') return q
    if ((host === 'bing.com' || host.endsWith('.bing.com')) && path.startsWith('/search')) return q
    if (host === 'duckduckgo.com' || host.endsWith('.duckduckgo.com')) return q
    return null
  } catch {
    return null
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

// ---- frecency -----------------------------------------------------------------------------------

/** How much one visit counts, by how long ago it was (the shape Firefox uses for its address bar). */
function visitWeight(ageMs: number): number {
  const days = Math.max(0, ageMs) / DAY_MS
  if (days <= 4) return 100
  if (days <= 14) return 70
  if (days <= 31) return 50
  if (days <= 90) return 30
  return 10
}

/** 0 to 1: a sum of visit weights on a log scale (about 1 at a few dozen recent visits). */
function frecencyScore(frecency: number): number {
  return Math.min(1, Math.log1p(frecency) / Math.log1p(1_500))
}

// ---- the index of the history ----------------------------------------------------------------------

interface PageRecord {
  id: string
  url: string
  host: string
  title: string
  foldedTitle: string
  foldedHost: string
  foldedAddress: string
  latestAt: number
  visits: number
  frecency: number
  root: boolean
  searched: string | null
}

interface HostRecord {
  host: string
  visits: number
  frecency: number
  latestAt: number
  latestUrl: string
  rootUrl?: string
  rootTitle?: string
  rootAt: number
}

interface HistoryIndex {
  builtAt: number
  pages: PageRecord[]
  hosts: Map<string, HostRecord>
}

/** The index is rebuilt when the history changes or when its ages have gone stale. */
const INDEX_LIFETIME_MS = 60_000
const indexCache = new WeakMap<HistoryEntry[], HistoryIndex>()

function indexFor(historyEntries: HistoryEntry[], now: number): HistoryIndex {
  const cached = indexCache.get(historyEntries)
  if (cached && now - cached.builtAt < INDEX_LIFETIME_MS) return cached

  const pages = new Map<string, PageRecord>()
  const hosts = new Map<string, HostRecord>()

  for (const entry of historyEntries) {
    if (isTechnicalHistoryEntry(entry)) continue
    const weight = visitWeight(now - entry.visitedAt)
    const host = entry.host

    const page = pages.get(entry.url)
    if (!page) {
      pages.set(entry.url, {
        id: entry.id,
        url: entry.url,
        host,
        title: entry.title,
        foldedTitle: normalizeText(entry.title),
        foldedHost: normalizeText(host),
        foldedAddress: normalizeText(displayAddress(entry.url)),
        latestAt: entry.visitedAt,
        visits: 1,
        frecency: weight,
        root: isRootPage(entry.url),
        searched: searchedQuery(entry.url),
      })
    } else {
      page.visits += 1
      page.frecency += weight
      if (entry.visitedAt > page.latestAt) {
        page.latestAt = entry.visitedAt
        page.title = entry.title
        page.foldedTitle = normalizeText(entry.title)
        page.id = entry.id
      }
    }

    const record = hosts.get(host) ?? {
      host,
      visits: 0,
      frecency: 0,
      latestAt: 0,
      latestUrl: entry.url,
      rootAt: 0,
    }
    record.visits += 1
    record.frecency += weight
    if (entry.visitedAt > record.latestAt) {
      record.latestAt = entry.visitedAt
      record.latestUrl = entry.url
    }
    if (isRootPage(entry.url) && entry.visitedAt >= record.rootAt) {
      record.rootAt = entry.visitedAt
      record.rootUrl = entry.url
      record.rootTitle = entry.title
    }
    hosts.set(host, record)
  }

  const index: HistoryIndex = { builtAt: now, pages: [...pages.values()], hosts }
  indexCache.set(historyEntries, index)
  return index
}

// ---- matching -----------------------------------------------------------------------------------------

interface Fields {
  host: string
  title: string
  address: string
}

/** How well one typed word matches: 0 for not at all, up to 1 for the start of the address. */
function termScore(term: string, fields: Fields): number {
  const { host, title, address } = fields
  if (host.startsWith(term)) return 1
  if (startsAWord(title, term)) return 0.9
  if (host.split(/[.-]/).some((label) => label.startsWith(term))) return 0.85
  if (startsAWord(address, term)) return 0.6
  if (host.includes(term) || title.includes(term)) return 0.5
  if (address.includes(term)) return 0.35
  return 0
}

/** Every word must match somewhere; the average of how well they do. 0 if one does not. */
function relevance(terms: string[], fields: Fields): number {
  if (terms.length === 0) return 0
  let sum = 0
  for (const term of terms) {
    const score = termScore(term, fields)
    if (score === 0) return 0
    sum += score
  }
  return sum / terms.length
}

/** Relevance scaled by how much the user goes there. A near-zero frecency still counts a little. */
function combinedScore(match: number, frecency: number, bonus = 0): number {
  return match * (0.55 + 0.45 * frecencyScore(frecency)) + bonus
}

/**
 * A page whose title says it is an error ("Page not found", "404", "Access denied", "Oops"): the user
 * visited it, but it is rarely what they are looking for. It still matches; it just ranks well below
 * real pages.
 */
export function looksLikeErrorPage(title: string): boolean {
  return /\b(?:404|403|500|502|503)\b|not found|page not found|access denied|forbidden|bad gateway|service unavailable|internal server error|\boops\b|bulunamad|erişim engellendi|hata oluştu/i.test(
    title,
  )
}

const ERROR_PAGE_FACTOR = 0.4

const MAX_SITES = 2
const MAX_PAGES = 3
const MAX_QUERIES = 2

/** Second-level labels that belong to a country's suffix (co.uk, com.tr, ...). */
const SECOND_LEVEL_SUFFIXES = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac', 'or', 'ne'])

/**
 * The site a host belongs to, so that studio.youtube.com and www.youtube.com count as one family:
 * the last two labels, or three under a country suffix like com.tr. Addresses of machines stay whole.
 */
export function siteFamily(host: string): string {
  if (/^[\d.]+$/.test(host) || host.includes(':')) return host
  const labels = host.split('.')
  if (labels.length <= 2) return host
  const last = labels[labels.length - 1]
  const secondLast = labels[labels.length - 2]
  const keep = last.length === 2 && SECOND_LEVEL_SUFFIXES.has(secondLast) ? 3 : 2
  return labels.slice(-keep).join('.')
}

export function buildHomeHistorySuggestions(
  historyEntries: HistoryEntry[],
  pinnedShortcuts: Shortcut[],
  rawQuery: string,
): HomeHistorySuggestion[] {
  const terms = queryTerms(rawQuery)
  if (terms.length === 0) return []

  const now = Date.now()
  const index = indexFor(historyEntries, now)

  const pinnedByHost = new Map<string, Shortcut>()
  for (const shortcut of pinnedShortcuts) {
    const host = hostForUrl(shortcut.url)
    if (host && !pinnedByHost.has(host)) pinnedByHost.set(host, shortcut)
  }

  // Sites: only the first word can be a site's name; more words mean a page, not a site.
  const sites = terms.length > 1
    ? []
    : [...index.hosts.values()]
      .flatMap((record) => {
        const pinned = pinnedByHost.get(record.host)
        const title =
          pinned?.label?.trim() ||
          record.rootTitle?.trim() ||
          prettifyHost(record.host)
        const match = relevance(terms, {
          host: normalizeText(record.host),
          title: normalizeText(title),
          address: normalizeText(record.host),
        })
        if (match === 0) return []
        // Typing the start of a site's address is the strongest signal there is.
        const bonus = normalizeText(record.host).startsWith(terms[0]) ? 0.15 : 0
        const score = combinedScore(match, record.frecency, bonus + (pinned ? 0.1 : 0))
        const suggestion: HomeHistorySuggestion = {
          kind: 'site',
          key: `site:${record.host}`,
          url: canonicalSiteUrl(pinned?.url || record.rootUrl || record.latestUrl),
          host: record.host,
          title,
          subtitle: record.host,
          visitedAt: record.latestAt,
          visitCount: record.visits,
        }
        return [{ suggestion, score }]
      })
      .sort((a, b) => b.score - a.score || b.suggestion.visitedAt - a.suggestion.visitedAt)
      .map(({ suggestion }) => suggestion)
      // One site per family: the best of www.youtube.com, studio.youtube.com, music.youtube.com.
      .filter((suggestion, position, all) =>
        all.findIndex((other) => siteFamily(other.host) === siteFamily(suggestion.host)) === position,
      )
      .slice(0, MAX_SITES)

  const shownSites = new Set(sites.map((site) => site.host))
  const shownFamilies = new Set(sites.map((site) => siteFamily(site.host)))

  const pageCandidates = index.pages
    .filter((page) => !page.searched)
    .flatMap((page) => {
      const match = relevance(terms, {
        host: page.foldedHost,
        title: page.foldedTitle,
        address: page.foldedAddress,
      })
      if (match === 0) return []
      const score = combinedScore(match, page.frecency)
      return [{ page, score: looksLikeErrorPage(page.title) ? score * ERROR_PAGE_FACTOR : score }]
    })
    .sort((a, b) => b.score - a.score || b.page.latestAt - a.page.latestAt)

  const pagesPerFamily = new Map<string, number>()
  const pages: HomeHistorySuggestion[] = []
  for (const { page } of pageCandidates) {
    if (pages.length >= MAX_PAGES) break
    // A site already offered stands for its front page.
    if (shownSites.has(page.host) && page.root) continue

    // A site's family gets one more row when the site itself is offered, two otherwise.
    const family = siteFamily(page.host)
    const used = pagesPerFamily.get(family) ?? 0
    if (used >= (shownFamilies.has(family) ? 1 : 2)) continue
    pagesPerFamily.set(family, used + 1)

    pages.push({
      kind: 'history',
      key: `history:${page.id}`,
      url: page.url,
      host: page.host,
      title: page.title,
      subtitle: displayAddress(page.url),
      visitedAt: page.latestAt,
      visitCount: index.hosts.get(page.host)?.visits ?? page.visits,
    })
  }

  // What the user searched for before: the most used form of each query.
  const queries = new Map<string, { page: PageRecord; query: string; frecency: number }>()
  for (const page of index.pages) {
    if (!page.searched) continue
    const folded = normalizeText(page.searched)
    const known = queries.get(folded)
    if (known) {
      known.frecency += page.frecency
      if (page.latestAt > known.page.latestAt) known.page = page
    } else {
      queries.set(folded, { page, query: page.searched, frecency: page.frecency })
    }
  }
  const searches = [...queries.entries()]
    .flatMap(([folded, entry]) => {
      // Only searches the typed text begins, as Chrome offers them, not any that merely contain it
      // somewhere, and not the query itself.
      const typed = terms.join(' ')
      if (!folded.startsWith(typed) || folded === typed) return []
      return [{ entry, score: combinedScore(0.9, entry.frecency) }]
    })
    .sort((a, b) => b.score - a.score || b.entry.page.latestAt - a.entry.page.latestAt)
    .slice(0, MAX_QUERIES)
    .map(({ entry }): HomeHistorySuggestion => ({
      kind: 'query',
      key: `query:${entry.page.id}`,
      url: entry.page.url,
      host: entry.page.host,
      title: entry.query,
      subtitle: entry.page.host,
      visitedAt: entry.page.latestAt,
      visitCount: entry.page.visits,
    }))

  return [...sites, ...pages, ...searches]
}

/**
 * The letter that stands in for an icon: the first letter of the first text that has one (a title like
 * "(4) Video" gives V, not "("), a digit if there is no letter anywhere.
 */
export function suggestionInitial(...texts: string[]): string {
  for (const text of texts) {
    const letter = text.match(/\p{L}/u)?.[0]
    if (letter) return letter.toLocaleUpperCase()
  }
  for (const text of texts) {
    const digit = text.match(/\p{N}/u)?.[0]
    if (digit) return digit
  }
  return '•'
}

// ---- completing the text in the field --------------------------------------------------------------------

export interface InlineCompletion {
  /** What follows the typed text, to be shown selected after it. */
  completion: string
  /** Where Enter goes when it is accepted. */
  url: string
}

/** A site has to have been visited this often before its address is completed for the user. */
const MIN_VISITS_TO_COMPLETE = 2

/**
 * The rest of an address the user is typing, as Chrome and Brave complete it: the address of the site
 * (or, once a slash is typed, of the page) that user goes to most. Nothing for text with spaces, for
 * text that already is a whole address, or for sites seen only once.
 */
export function inlineCompletion(
  historyEntries: HistoryEntry[],
  pinnedShortcuts: Shortcut[],
  typed: string,
): InlineCompletion | null {
  const text = typed.replace(/^\s+/, '')
  if (!text || /\s/.test(text)) return null

  const stripped = text.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^www\./i, '')
  if (!stripped) return null
  const needle = normalizeText(stripped)
  if (!needle) return null

  const now = Date.now()
  const index = indexFor(historyEntries, now)

  if (stripped.includes('/')) {
    let best: PageRecord | null = null
    for (const page of index.pages) {
      if (page.searched) continue
      if (page.foldedAddress.length <= needle.length) continue
      if (!page.foldedAddress.startsWith(needle)) continue
      if (page.visits < MIN_VISITS_TO_COMPLETE) continue
      if (!best || page.frecency > best.frecency) best = page
    }
    if (!best) return null
    const address = displayAddress(best.url)
    // Folding can change lengths (an accent); complete only when the shown text is a plain prefix.
    if (normalizeText(address.slice(0, stripped.length)) !== needle) return null
    return { completion: address.slice(stripped.length), url: best.url }
  }

  const pinnedHosts = new Set(
    pinnedShortcuts.map((shortcut) => hostForUrl(shortcut.url)).filter(Boolean),
  )
  let best: HostRecord | null = null
  for (const record of index.hosts.values()) {
    const folded = normalizeText(record.host)
    if (folded.length <= needle.length || !folded.startsWith(needle)) continue
    if (record.visits < MIN_VISITS_TO_COMPLETE && !pinnedHosts.has(record.host)) continue
    if (!best || record.frecency > best.frecency) best = record
  }
  if (!best) return null
  if (normalizeText(best.host.slice(0, stripped.length)) !== needle) return null
  return {
    completion: best.host.slice(stripped.length),
    url: canonicalSiteUrl(best.rootUrl || best.latestUrl),
  }
}

// ---- showing why something matched -----------------------------------------------------------------------

export interface HighlightSegment {
  text: string
  match: boolean
}

/**
 * `text` cut into pieces, the ones that match a typed word marked, so the rows can show them bold.
 * Matching ignores case and accents; the pieces always add up to the original text.
 */
export function highlightSegments(text: string, terms: string[]): HighlightSegment[] {
  if (!text || terms.length === 0) return [{ text, match: false }]

  // Fold character by character so a position in the folded text maps back to the original.
  let folded = ''
  const origin: number[] = []
  let offset = 0
  for (const character of text) {
    const piece = foldChar(character.normalize('NFKC'))
    for (let i = 0; i < piece.length; i += 1) origin.push(offset)
    folded += piece
    offset += character.length
  }
  origin.push(text.length)

  const marked = new Array<boolean>(text.length).fill(false)
  for (const term of terms) {
    if (!term) continue
    let from = 0
    for (;;) {
      const at = folded.indexOf(term, from)
      if (at < 0) break
      const startsAt = origin[at]
      const endsAt = origin[at + term.length] ?? text.length
      for (let i = startsAt; i < endsAt; i += 1) marked[i] = true
      from = at + term.length
    }
  }

  const segments: HighlightSegment[] = []
  for (let i = 0; i < text.length; i += 1) {
    const last = segments[segments.length - 1]
    if (last && last.match === marked[i]) last.text += text[i]
    else segments.push({ text: text[i], match: marked[i] })
  }
  return segments
}

// ---- web suggestions ---------------------------------------------------------------------------------------

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
    // A search the user made before is already on the list as that.
    if (suggestion.kind === 'query') blocked.add(normalizeText(suggestion.title))
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
