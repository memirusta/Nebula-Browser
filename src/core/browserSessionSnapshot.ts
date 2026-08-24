import type { BrowserTab } from './browserTab'
import {
  createTabNavigationState,
  sanitizeTabNavigationState,
  type TabNavigationState,
} from './tabNavigation.ts'

export const CURRENT_SESSION_KEY = 'nebula-current-browser-session-v2'
export const LEGACY_CURRENT_SESSION_KEYS = [
  'nebula-current-browser-session-v1',
] as const
export const BROWSER_SESSION_SCHEMA_VERSION = 2

export interface PersistedBrowserTab {
  tabId: string
  shortcutId: string
  url: string
  title: string
  favicon: string
  navigation: TabNavigationState
}

export interface BrowserWindowSessionSnapshot {
  windowId: string
  activeTabId: string | null
  tabs: PersistedBrowserTab[]
}

export interface BrowserSessionSnapshot {
  schemaVersion: typeof BROWSER_SESSION_SCHEMA_VERSION
  id: string
  savedAt: number
  windows: BrowserWindowSessionSnapshot[]
}

interface SessionStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function randomId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

function normalizeHttpUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.href
  } catch {
    return null
  }
}

function sanitizeTitle(value: unknown, url: string): string {
  if (typeof value === 'string' && value.trim()) return value.trim()
  try {
    return new URL(url).hostname.replace(/^www\./, '') || url
  } catch {
    return url
  }
}

function sanitizePersistedTab(value: unknown): PersistedBrowserTab | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Partial<PersistedBrowserTab> & { id?: unknown }
  if (typeof candidate.url !== 'string') return null
  const url = normalizeHttpUrl(candidate.url)
  if (!url) return null

  const legacyId = typeof candidate.id === 'string' ? candidate.id.trim() : ''
  const tabId = typeof candidate.tabId === 'string' && candidate.tabId.trim()
    ? candidate.tabId.trim()
    : legacyId || randomId('tab')
  const shortcutId = typeof candidate.shortcutId === 'string' && candidate.shortcutId.trim()
    ? candidate.shortcutId.trim()
    : legacyId || tabId
  const title = sanitizeTitle(candidate.title, url)
  const favicon = typeof candidate.favicon === 'string' ? candidate.favicon : ''
  const navigation = sanitizeTabNavigationState(
    candidate.navigation,
    url,
    title,
    favicon,
  )
  const current = navigation.entries[navigation.index]
  return {
    tabId,
    shortcutId,
    url: current?.url ?? url,
    title: current?.title ?? title,
    favicon: current?.favicon ?? favicon,
    navigation,
  }
}

function sanitizeWindow(value: unknown): BrowserWindowSessionSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Partial<BrowserWindowSessionSnapshot>
  if (!Array.isArray(candidate.tabs)) return null
  const tabs = candidate.tabs
    .map(sanitizePersistedTab)
    .filter((tab): tab is PersistedBrowserTab => tab !== null)
  if (tabs.length === 0) return null
  const tabIds = new Set(tabs.map((tab) => tab.tabId))
  const activeTabId = typeof candidate.activeTabId === 'string' && tabIds.has(candidate.activeTabId)
    ? candidate.activeTabId
    : tabs[0]?.tabId ?? null
  return {
    windowId: typeof candidate.windowId === 'string' && candidate.windowId.trim()
      ? candidate.windowId.trim()
      : randomId('window'),
    activeTabId,
    tabs,
  }
}

function parseV2(raw: string): BrowserSessionSnapshot | null {
  try {
    const candidate = JSON.parse(raw) as Partial<BrowserSessionSnapshot>
    if (
      candidate.schemaVersion !== BROWSER_SESSION_SCHEMA_VERSION ||
      !Array.isArray(candidate.windows)
    ) {
      return null
    }
    const windows = candidate.windows
      .map(sanitizeWindow)
      .filter((window): window is BrowserWindowSessionSnapshot => window !== null)
    if (windows.length === 0) return null
    return {
      schemaVersion: BROWSER_SESSION_SCHEMA_VERSION,
      id: typeof candidate.id === 'string' && candidate.id ? candidate.id : randomId('session'),
      savedAt: typeof candidate.savedAt === 'number' && Number.isFinite(candidate.savedAt)
        ? candidate.savedAt
        : Date.now(),
      windows,
    }
  } catch {
    return null
  }
}

function parseLegacyV1(raw: string): BrowserSessionSnapshot | null {
  try {
    const candidate = JSON.parse(raw) as {
      id?: unknown
      savedAt?: unknown
      activeTabId?: unknown
      tabs?: unknown
    }
    if (!Array.isArray(candidate.tabs)) return null
    const tabs = candidate.tabs
      .map(sanitizePersistedTab)
      .filter((tab): tab is PersistedBrowserTab => tab !== null)
    if (tabs.length === 0) return null
    const id = typeof candidate.id === 'string' && candidate.id
      ? candidate.id
      : randomId('session')
    const legacyActiveId = typeof candidate.activeTabId === 'string'
      ? candidate.activeTabId
      : null
    const activeTabId = tabs.find(
      (tab) => tab.tabId === legacyActiveId || tab.shortcutId === legacyActiveId,
    )?.tabId ?? tabs[0]?.tabId ?? null
    return {
      schemaVersion: BROWSER_SESSION_SCHEMA_VERSION,
      id,
      savedAt: typeof candidate.savedAt === 'number' && Number.isFinite(candidate.savedAt)
        ? candidate.savedAt
        : Date.now(),
      windows: [{
        windowId: `legacy-window-${id}`,
        activeTabId,
        tabs,
      }],
    }
  } catch {
    return null
  }
}

export function serializeBrowserSessionSnapshot(snapshot: BrowserSessionSnapshot): string {
  return JSON.stringify(snapshot)
}

export function loadBrowserSessionSnapshot(
  storage: SessionStorage = localStorage,
): BrowserSessionSnapshot | null {
  const currentRaw = storage.getItem(CURRENT_SESSION_KEY)
  if (currentRaw) {
    const current = parseV2(currentRaw)
    if (current) return current
  }

  for (const key of LEGACY_CURRENT_SESSION_KEYS) {
    const raw = storage.getItem(key)
    if (!raw) continue
    const migrated = parseLegacyV1(raw)
    if (!migrated) continue
    storage.setItem(CURRENT_SESSION_KEY, serializeBrowserSessionSnapshot(migrated))
    return migrated
  }
  return null
}

export function createBrowserSessionSnapshot(
  windowId: string,
  tabs: BrowserTab[],
  activeShortcutId: string | null,
): BrowserSessionSnapshot {
  const window = createBrowserWindowSessionSnapshot(
    windowId,
    tabs,
    activeShortcutId,
  )
  return {
    schemaVersion: BROWSER_SESSION_SCHEMA_VERSION,
    id: randomId('session'),
    savedAt: Date.now(),
    windows: [window],
  }
}

export function createBrowserWindowSessionSnapshot(
  windowId: string,
  tabs: BrowserTab[],
  activeShortcutId: string | null,
): BrowserWindowSessionSnapshot {
  const persistedTabs = tabs.flatMap((tab) => {
    const persisted = sanitizePersistedTab({
      tabId: tab.id,
      shortcutId: tab.shortcutId,
      url: tab.url,
      title: tab.title,
      favicon: tab.favicon,
      navigation: tab.navigation ?? createTabNavigationState(
        tab.url,
        tab.title,
        tab.favicon,
      ),
    })
    return persisted ? [persisted] : []
  })
  const activeTabId = persistedTabs.find(
    (tab) => tab.shortcutId === activeShortcutId,
  )?.tabId ?? persistedTabs[0]?.tabId ?? null
  return {
    windowId: windowId.trim() || randomId('window'),
    activeTabId,
    tabs: persistedTabs,
  }
}

export function persistedBrowserTabFromBrowserTab(
  tab: BrowserTab,
): PersistedBrowserTab | null {
  return sanitizePersistedTab({
    tabId: tab.id,
    shortcutId: tab.shortcutId,
    url: tab.url,
    title: tab.title,
    favicon: tab.favicon,
    navigation: tab.navigation,
  })
}

export function upsertBrowserSessionWindow(
  snapshot: BrowserSessionSnapshot | null,
  window: BrowserWindowSessionSnapshot,
): BrowserSessionSnapshot {
  const windows = snapshot ? [...snapshot.windows] : []
  const index = windows.findIndex((entry) => entry.windowId === window.windowId)
  if (index === -1) windows.push(window)
  else windows[index] = window
  return {
    schemaVersion: BROWSER_SESSION_SCHEMA_VERSION,
    id: snapshot?.id ?? randomId('session'),
    savedAt: Date.now(),
    windows,
  }
}

export function removeBrowserSessionWindow(
  snapshot: BrowserSessionSnapshot | null,
  windowId: string,
): BrowserSessionSnapshot | null {
  if (!snapshot) return null
  const windows = snapshot.windows.filter(
    (window) => window.windowId !== windowId,
  )
  if (windows.length === 0) return null
  return {
    ...snapshot,
    savedAt: Date.now(),
    windows,
  }
}

export function sessionWindowById(
  snapshot: BrowserSessionSnapshot,
  windowId: string,
): BrowserWindowSessionSnapshot | null {
  return snapshot.windows.find((window) => window.windowId === windowId) ?? null
}

export function sessionTabCount(snapshot: BrowserSessionSnapshot): number {
  return snapshot.windows.reduce((count, window) => count + window.tabs.length, 0)
}

export function primarySessionWindow(
  snapshot: BrowserSessionSnapshot,
): BrowserWindowSessionSnapshot | null {
  return snapshot.windows[0] ?? null
}
