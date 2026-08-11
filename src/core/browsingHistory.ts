import { persistLocalStorage } from './storageSync'
import type { BrowserTab } from './browserTab'

export const BROWSING_HISTORY_KEY = 'nebula-browsing-history-v1'
export const CLOSED_TABS_KEY = 'nebula-closed-tabs-v1'
export const CURRENT_SESSION_KEY = 'nebula-current-browser-session-v1'
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

export interface BrowserSessionSnapshot {
  id: string
  savedAt: number
  activeTabId: string | null
  tabs: Array<Pick<BrowserTab, 'id' | 'url' | 'title' | 'favicon'>>
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
  try {
    const raw = localStorage.getItem(CURRENT_SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<BrowserSessionSnapshot>
    if (!Array.isArray(parsed.tabs) || parsed.tabs.length === 0) return null
    const tabs = parsed.tabs.flatMap((tab) => {
      if (!tab || typeof tab !== 'object') return []
      const candidate = tab as Partial<BrowserSessionSnapshot['tabs'][number]>
      if (typeof candidate.url !== 'string') return []
      const url = normalizeHttpUrl(candidate.url)
      if (!url) return []
      const id = typeof candidate.id === 'string' && candidate.id ? candidate.id : `history-${crypto.randomUUID()}`
      return [{
        id,
        url,
        title: sanitizeTitle(candidate.title, url),
        favicon: typeof candidate.favicon === 'string' ? candidate.favicon : '',
      }]
    })
    if (tabs.length === 0) return null
    return {
      id: typeof parsed.id === 'string' && parsed.id ? parsed.id : crypto.randomUUID(),
      savedAt: typeof parsed.savedAt === 'number' && Number.isFinite(parsed.savedAt) ? parsed.savedAt : Date.now(),
      activeTabId: typeof parsed.activeTabId === 'string' ? parsed.activeTabId : null,
      tabs,
    }
  } catch {
    return null
  }
}

export function clearCurrentSessionSnapshot(): void {
  try {
    localStorage.removeItem(CURRENT_SESSION_KEY)
  } catch {
    // Storage can be unavailable in restricted web contexts.
  }
}

export function persistCurrentSessionSnapshot(tabs: BrowserTab[], activeTabId: string | null): void {
  const serializableTabs = tabs.flatMap((tab) => {
    const url = normalizeHttpUrl(tab.url)
    if (!url) return []
    return [{ id: tab.id, url, title: sanitizeTitle(tab.title, url), favicon: tab.favicon }]
  })

  const snapshot: BrowserSessionSnapshot = {
    id: crypto.randomUUID(),
    savedAt: Date.now(),
    activeTabId,
    tabs: serializableTabs,
  }
  persistLocalStorage(CURRENT_SESSION_KEY, JSON.stringify(snapshot))
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

export function entryMatchesHistoryFilters(
  entry: HistoryEntry,
  options: { query?: string; host?: string; time?: HistoryTimeFilter },
): boolean {
  const query = options.query?.trim().toLocaleLowerCase() ?? ''
  if (query) {
    const haystack = `${entry.title}\n${entry.url}\n${entry.host}`.toLocaleLowerCase()
    if (!haystack.includes(query)) return false
  }
  if (options.host && options.host !== 'all' && entry.host !== options.host) return false
  const cutoff = historyTimeCutoff(options.time ?? 'all')
  return cutoff === null || entry.visitedAt >= cutoff
}
