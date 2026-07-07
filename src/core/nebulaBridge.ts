import { emit, listen } from '@tauri-apps/api/event'
import type { BrowserTab } from './browserTab'
import { isTauri } from '../platform/runtime'

export type ChromeShellAction =
  | { type: 'open-tab'; shortcutId: string; url: string }
  | { type: 'close-tab'; shortcutId: string }
  | { type: 'switch-tab'; shortcutId: string }
  | { type: 'open-overlay' }
  | { type: 'open-quick-menu'; shortcutId?: string }
  | { type: 'close-quick-menu' }
  | { type: 'toggle-quick-menu' }
  | { type: 'go-back' }
  | { type: 'go-home' }

export interface TabCatalogPayload {
  tabs: BrowserTab[]
  activeTabId: string | null
}

export type ShellViewMode = 'home' | 'browsing' | 'overlay'

const CHROME_ACTION_EVENT = 'nebula-chrome-action'
const ACTIVE_URL_EVENT = 'nebula-active-url'
const TAB_CATALOG_EVENT = 'nebula-tab-catalog'
const VIEW_MODE_EVENT = 'nebula-view-mode'
const QUICK_MENU_STATE_EVENT = 'nebula-quick-menu-state'

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

export async function emitQuickMenuState(open: boolean): Promise<void> {
  if (!isTauri) return
  await emit(QUICK_MENU_STATE_EVENT, { open })
}

export function listenQuickMenuState(
  handler: (open: boolean) => void,
): Promise<() => void> {
  if (!isTauri) {
    return Promise.resolve(() => {})
  }

  return listen<{ open: boolean }>(QUICK_MENU_STATE_EVENT, (event) => {
    handler(event.payload.open)
  })
}
