import { persistLocalStorage } from './storageSync'
import type { BrowserTab } from './browserTab'
import {
  createBrowserWindowSessionSnapshot,
  CURRENT_SESSION_KEY,
  LEGACY_CURRENT_SESSION_KEYS,
  loadBrowserSessionSnapshot,
  removeBrowserSessionWindow,
  serializeBrowserSessionSnapshot,
  upsertBrowserSessionWindow,
  type BrowserSessionSnapshot,
} from './browserSessionSnapshot'

export {
  CURRENT_SESSION_KEY,
  LEGACY_CURRENT_SESSION_KEYS,
} from './browserSessionSnapshot'
export type { BrowserSessionSnapshot } from './browserSessionSnapshot'

export const BROWSING_HISTORY_KEY = 'nebula-browsing-history-v1'
export const CLOSED_TABS_KEY = 'nebula-closed-tabs-v1'
export const BROWSER_RUN_STATE_KEY = 'nebula-browser-run-state-v1'

const MAX_HISTORY_ENTRIES = 5_000
const MAX_CLOSED_TABS = 50
const HISTORY_VERSION = 1 as const
const ABANDONED_BOOKMARK_EXPERIMENT_KEY = 'nebula-bookmarks-v1'
let bookmarkExperimentCleaned = false

export interface HistoryEntry {
  id: string
  url: string
  title: string
  host: string
  visitedAt: number
}

export interface ClosedTabEntry {
  id: string
  url: string
  title: string
  favicon?: string
  closedAt: number
}

interface StoredHistory {
  version: typeof HISTORY_VERSION
  entries: HistoryEntry[]
}

interface BrowserRunState {
  version: 1
  launchId: string
  startedAt: number
  cleanExit: boolean
  cleanExitAt?: number
}

export interface BrowserRunStartupState {
  previousRunUnclean: boolean
}

let browserRunStartupState: BrowserRunStartupState | null = null
let currentLaunchId: string | null = null

function parseBrowserRunState(raw: string | null): BrowserRunState | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<BrowserRunState>
    if (parsed.version !== 1 || typeof parsed.launchId !== 'string') return null
    return {
      version: 1,
      launchId: parsed.launchId,
      startedAt: typeof parsed.startedAt === 'number' && Number.isFinite(parsed.startedAt)
        ? parsed.startedAt
        : Date.now(),
      cleanExit: parsed.cleanExit === true,
      cleanExitAt: typeof parsed.cleanExitAt === 'number' && Number.isFinite(parsed.cleanExitAt)
        ? parsed.cleanExitAt
        : undefined,
    }
  } catch {
    return null
  }
}

/**
 * Starts one browser-run marker for the current renderer lifetime. The in-memory
 * cache prevents React StrictMode's development remount from looking like a crash.
 */
export function initializeBrowserRunState(): BrowserRunStartupState {
  if (browserRunStartupState) return browserRunStartupState

  let previousRunUnclean = false
  try {
    const previous = parseBrowserRunState(localStorage.getItem(BROWSER_RUN_STATE_KEY))
    previousRunUnclean = Boolean(previous && !previous.cleanExit)

    currentLaunchId = crypto.randomUUID()
    const current: BrowserRunState = {
      version: 1,
      launchId: currentLaunchId,
      startedAt: Date.now(),
      cleanExit: false,
    }
    localStorage.setItem(BROWSER_RUN_STATE_KEY, JSON.stringify(current))
  } catch {
    // Storage can be unavailable in restricted contexts. Recovery simply stays off.
    currentLaunchId = null
    previousRunUnclean = false
  }

  browserRunStartupState = { previousRunUnclean }
  return browserRunStartupState
}

export function markBrowserRunClean(): void {
  if (!currentLaunchId) return
  try {
    const current = parseBrowserRunState(localStorage.getItem(BROWSER_RUN_STATE_KEY))
    if (!current || current.launchId !== currentLaunchId) return
    localStorage.setItem(
      BROWSER_RUN_STATE_KEY,
      JSON.stringify({ ...current, cleanExit: true, cleanExitAt: Date.now() } satisfies BrowserRunState),
    )
  } catch {
    // Best effort during window shutdown.
  }
}

function normalizeHttpUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    parsed.hostname = parsed.hostname.toLowerCase()
    return parsed.href
  } catch {
    return null
  }
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return url.toLowerCase()
  }
}

function fallbackTitle(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function sanitizeTitle(title: string | null | undefined, url: string): string {
  const trimmed = title?.trim()
  return (trimmed || fallbackTitle(url)).slice(0, 500)
}

function sanitizeHistoryEntry(value: unknown): HistoryEntry | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Partial<HistoryEntry>
  if (typeof item.url !== 'string') return null
  const url = normalizeHttpUrl(item.url)
  if (!url) return null
  const visitedAt = typeof item.visitedAt === 'number' && Number.isFinite(item.visitedAt)
    ? item.visitedAt
    : Date.now()

  return {
    id: typeof item.id === 'string' && item.id ? item.id : crypto.randomUUID(),
    url,
    title: sanitizeTitle(item.title, url),
    host: hostFromUrl(url),
    visitedAt,
  }
}

function sanitizeClosedTab(value: unknown): ClosedTabEntry | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Partial<ClosedTabEntry>
  if (typeof item.url !== 'string') return null
  const url = normalizeHttpUrl(item.url)
  if (!url) return null
  return {
    id: typeof item.id === 'string' && item.id ? item.id : crypto.randomUUID(),
    url,
    title: sanitizeTitle(item.title, url),
    favicon: typeof item.favicon === 'string' && item.favicon.trim() ? item.favicon.trim().slice(0, 2_000) : undefined,
    closedAt: typeof item.closedAt === 'number' && Number.isFinite(item.closedAt) ? item.closedAt : Date.now(),
  }
}

export function loadBrowsingHistory(): HistoryEntry[] {
  if (!bookmarkExperimentCleaned) {
    bookmarkExperimentCleaned = true
    try {
      localStorage.removeItem(ABANDONED_BOOKMARK_EXPERIMENT_KEY)
    } catch {
      // Storage can be unavailable in restricted web contexts.
    }
  }

  try {
    const raw = localStorage.getItem(BROWSING_HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Partial<StoredHistory>
    if (parsed.version !== HISTORY_VERSION || !Array.isArray(parsed.entries)) return []
    return parsed.entries
      .map(sanitizeHistoryEntry)
      .filter((entry): entry is HistoryEntry => entry !== null)
      .sort((a, b) => b.visitedAt - a.visitedAt)
      .slice(0, MAX_HISTORY_ENTRIES)
  } catch {
    return []
  }
}

export function persistBrowsingHistory(entries: HistoryEntry[]): void {
  const payload: StoredHistory = {
    version: HISTORY_VERSION,
    entries: entries.slice(0, MAX_HISTORY_ENTRIES),
  }
  persistLocalStorage(BROWSING_HISTORY_KEY, JSON.stringify(payload))
}

export function addHistoryEntry(
  entries: HistoryEntry[],
  urlInput: string,
  title?: string | null,
): HistoryEntry[] {
  const url = normalizeHttpUrl(urlInput)
  if (!url) return entries
  const now = Date.now()
  const next: HistoryEntry = {
    id: crypto.randomUUID(),
    url,
    title: sanitizeTitle(title, url),
    host: hostFromUrl(url),
    visitedAt: now,
  }

  // Snapshot/title events can arrive more than once for one navigation. Merge a
  // same-URL event that follows immediately instead of producing noisy duplicates.
  const head = entries[0]
  if (head && head.url === url && now - head.visitedAt < 2_500) {
    return [{ ...head, title: next.title, visitedAt: now }, ...entries.slice(1)]
  }

  return [next, ...entries].slice(0, MAX_HISTORY_ENTRIES)
}

export function loadClosedTabs(): ClosedTabEntry[] {
  try {
    const raw = localStorage.getItem(CLOSED_TABS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(sanitizeClosedTab)
      .filter((entry): entry is ClosedTabEntry => entry !== null)
      .sort((a, b) => b.closedAt - a.closedAt)
      .slice(0, MAX_CLOSED_TABS)
  } catch {
    return []
  }
}

export function persistClosedTabs(entries: ClosedTabEntry[]): void {
  persistLocalStorage(CLOSED_TABS_KEY, JSON.stringify(entries.slice(0, MAX_CLOSED_TABS)))
}

export function closedTabFromBrowserTab(tab: BrowserTab): ClosedTabEntry | null {
  const url = normalizeHttpUrl(tab.url)
  if (!url) return null
  return {
    id: crypto.randomUUID(),
    url,
    title: sanitizeTitle(tab.title, url),
    favicon: tab.favicon || undefined,
    closedAt: Date.now(),
  }
}

export function loadCurrentSessionSnapshot(): BrowserSessionSnapshot | null {
  return loadBrowserSessionSnapshot()
}

export function clearCurrentSessionSnapshot(): void {
  try {
    localStorage.removeItem(CURRENT_SESSION_KEY)
    for (const key of LEGACY_CURRENT_SESSION_KEYS) localStorage.removeItem(key)
  } catch {
    // Storage can be unavailable in restricted web contexts.
  }
}

export function persistCurrentSessionSnapshot(
  windowId: string,
  tabs: BrowserTab[],
  activeTabId: string | null,
): void {
  const current = loadBrowserSessionSnapshot()
  const window = createBrowserWindowSessionSnapshot(
    windowId,
    tabs,
    activeTabId,
  )
  const snapshot = upsertBrowserSessionWindow(current, window)
  persistLocalStorage(CURRENT_SESSION_KEY, serializeBrowserSessionSnapshot(snapshot))
}

export function removeCurrentSessionWindow(windowId: string): void {
  const snapshot = removeBrowserSessionWindow(
    loadBrowserSessionSnapshot(),
    windowId,
  )
  if (!snapshot) {
    localStorage.removeItem(CURRENT_SESSION_KEY)
    return
  }
  persistLocalStorage(CURRENT_SESSION_KEY, serializeBrowserSessionSnapshot(snapshot))
}

export type HistoryTimeFilter = 'all' | 'today' | '7d' | '30d'

export function historyTimeCutoff(filter: HistoryTimeFilter, now = Date.now()): number | null {
  if (filter === 'all') return null
  if (filter === 'today') {
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)
    return start.getTime()
  }
  const days = filter === '7d' ? 7 : 30
  return now - days * 24 * 60 * 60 * 1_000
}

function normalizeHistorySearchText(value: string): string {
  return value.toLocaleLowerCase()
}

function startsAtWordBoundary(
  value: string,
  query: string,
): boolean {
  const normalized =
    normalizeHistorySearchText(value)

  if (normalized.startsWith(query)) {
    return true
  }

  for (let index = 1; index < normalized.length; index += 1) {
    const previous =
      normalized[index - 1]

    const current =
      normalized[index]

    if (
      !/[a-z0-9ğüşöçıİ]/i.test(previous) &&
      current === query[0] &&
      normalized.startsWith(query, index)
    ) {
      return true
    }
  }

  return false
}

function historyEntryMatchesQuery(
  entry: HistoryEntry,
  rawQuery: string,
): boolean {
  const query =
    normalizeHistorySearchText(
      rawQuery.trim(),
    )

  if (!query) {
    return true
  }

  const title =
    normalizeHistorySearchText(
      entry.title,
    )

  const host =
    normalizeHistorySearchText(
      entry.host,
    )

  const url =
    normalizeHistorySearchText(
      entry.url,
    )

  if (
    startsAtWordBoundary(title, query) ||
    startsAtWordBoundary(host, query)
  ) {
    return true
  }

  try {
    const parsed =
      new URL(entry.url)

    const segments = [
      parsed.hostname,
      ...parsed.pathname
        .split('/')
        .filter(Boolean),
    ]

    if (
      segments.some((segment) =>
        normalizeHistorySearchText(
          segment,
        ).startsWith(query),
      )
    ) {
      return true
    }
  } catch {
    // Fall through to generic matching.
  }

  if (query.length <= 2) {
    return false
  }

  return (
    title.includes(query) ||
    host.includes(query) ||
    url.includes(query)
  )
}


export function entryMatchesHistoryFilters(
  entry: HistoryEntry,
  options: { query?: string; host?: string; time?: HistoryTimeFilter },
): boolean {
  const query =
  options.query?.trim() ?? ''

if (
  query &&
  !historyEntryMatchesQuery(
    entry,
    query,
  )
) {
  return false
}
  if (options.host && options.host !== 'all' && entry.host !== options.host) return false
  const cutoff = historyTimeCutoff(options.time ?? 'all')
  return cutoff === null || entry.visitedAt >= cutoff
}
