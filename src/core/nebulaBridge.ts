import { emit, listen } from '@tauri-apps/api/event'
import type { BrowserTab } from './browserTab'
import type { DownloadItem } from './download'
import { isTauri } from '../platform/runtime'

export type ChromeShellAction =
  | { type: 'request-state' }
  | { type: 'open-tab'; shortcutId: string; url: string }
  | { type: 'close-tab'; shortcutId: string }
  | { type: 'switch-tab'; shortcutId: string }
  | { type: 'set-tab-muted'; shortcutId: string; muted: boolean }
  | { type: 'open-overlay' }
  | { type: 'go-back' }
  | { type: 'go-home' }
  | { type: 'toggle-download-panel' }
  | { type: 'close-download-panel' }
  | { type: 'remove-download'; id: string }
  | { type: 'clear-finished-downloads' }

export interface TabCatalogPayload {
  tabs: BrowserTab[]
  activeTabId: string | null
}

export interface DownloadUiStatePayload {
  items: DownloadItem[]
  activeCount: number
  aggregateProgress: number | null
  panelOpen: boolean
}

export type ShellViewMode = 'home' | 'browsing' | 'overlay'

const CHROME_ACTION_EVENT = 'nebula-chrome-action'
const ACTIVE_URL_EVENT = 'nebula-active-url'
const TAB_CATALOG_EVENT = 'nebula-tab-catalog'
const VIEW_MODE_EVENT = 'nebula-view-mode'
const DOWNLOAD_UI_STATE_EVENT = 'nebula-download-ui-state'
const ZOOM_INDICATOR_EVENT = 'nebula-zoom-indicator'
const TAB_SEARCH_REQUEST_EVENT = 'nebula-tab-search-request'

export function isChromeShell(): boolean {
  return window.location.hash === '#chrome'
}

export async function emitChromeAction(action: ChromeShellAction): Promise<void> {
  if (!isTauri) return
  await emit(CHROME_ACTION_EVENT, action)
}

export function listenChromeActions(
  handler: (action: ChromeShellAction) => void,
): Promise<() => void> {
  if (!isTauri) {
    return Promise.resolve(() => {})
  }

  return listen<ChromeShellAction>(CHROME_ACTION_EVENT, (event) => {
    handler(event.payload)
  })
}

export async function emitActiveUrl(url: string | null): Promise<void> {
  if (!isTauri) return
  await emit(ACTIVE_URL_EVENT, { url })
}

export function listenActiveUrl(
  handler: (url: string | null) => void,
): Promise<() => void> {
  if (!isTauri) {
    return Promise.resolve(() => {})
  }

  return listen<{ url: string | null }>(ACTIVE_URL_EVENT, (event) => {
    handler(event.payload.url)
  })
}

export async function emitTabCatalog(catalog: TabCatalogPayload): Promise<void> {
  if (!isTauri) return
  await emit(TAB_CATALOG_EVENT, catalog)
}

export function listenTabCatalog(
  handler: (catalog: TabCatalogPayload) => void,
): Promise<() => void> {
  if (!isTauri) {
    return Promise.resolve(() => {})
  }

  return listen<TabCatalogPayload>(TAB_CATALOG_EVENT, (event) => {
    handler(event.payload)
  })
}

export async function emitViewMode(mode: ShellViewMode): Promise<void> {
  if (!isTauri) return
  await emit(VIEW_MODE_EVENT, { mode })
}

export function listenViewMode(
  handler: (mode: ShellViewMode) => void,
): Promise<() => void> {
  if (!isTauri) {
    return Promise.resolve(() => {})
  }

  return listen<{ mode: ShellViewMode }>(VIEW_MODE_EVENT, (event) => {
    handler(event.payload.mode)
  })
}

export async function emitDownloadUiState(
  state: DownloadUiStatePayload,
): Promise<void> {
  if (!isTauri) return
  await emit(DOWNLOAD_UI_STATE_EVENT, state)
}

export function listenDownloadUiState(
  handler: (state: DownloadUiStatePayload) => void,
): Promise<() => void> {
  if (!isTauri) {
    return Promise.resolve(() => {})
  }

  return listen<DownloadUiStatePayload>(DOWNLOAD_UI_STATE_EVENT, (event) => {
    handler(event.payload)
  })
}

export async function emitZoomIndicator(percent: number): Promise<void> {
  if (!isTauri) return
  await emit(ZOOM_INDICATOR_EVENT, { percent })
}

export function listenZoomIndicator(
  handler: (percent: number) => void,
): Promise<() => void> {
  if (!isTauri) {
    return Promise.resolve(() => {})
  }

  return listen<{ percent: number }>(ZOOM_INDICATOR_EVENT, (event) => {
    handler(event.payload.percent)
  })
}

export async function emitTabSearchRequest(): Promise<void> {
  if (!isTauri) return
  await emit(TAB_SEARCH_REQUEST_EVENT)
}

export function listenTabSearchRequests(handler: () => void): Promise<() => void> {
  if (!isTauri) return Promise.resolve(() => {})
  return listen(TAB_SEARCH_REQUEST_EVENT, handler)
}
