import type {
  BrowserWindowSessionSnapshot,
  PersistedBrowserTab,
} from './browserSessionSnapshot.ts'

export const BROWSER_WINDOW_PREFIX = 'nebula-window-'
export const BROWSER_TAB_PREFIX = 'nebula-tab-'
export const BROWSER_CHROME_PREFIX = 'nebula-chrome-'
export const PRIMARY_BROWSER_WINDOW_ID = 'main'

export function browserWindowIdFromRuntime(): string {
  if (typeof window === 'undefined') return PRIMARY_BROWSER_WINDOW_ID
  return new URLSearchParams(window.location.search).get('nebulaWindowId') ??
    PRIMARY_BROWSER_WINDOW_ID
}

export interface BrowserWorkspace {
  windows: BrowserWindowSessionSnapshot[]
  mostRecentlyActiveWindowId: string | null
}

export interface BrowserTabTransfer {
  id: string
  sourceWindowId: string
  targetWindowId: string
  tab: PersistedBrowserTab
  webviewLabel: string
  createdAt: number
  state: 'pending' | 'target-ready' | 'ready' | 'claimed' | 'cancelled'
}

export function browserWindowLabel(windowId: string): string {
  return windowId === PRIMARY_BROWSER_WINDOW_ID
    ? PRIMARY_BROWSER_WINDOW_ID
    : windowId.startsWith(BROWSER_WINDOW_PREFIX)
      ? windowId
      : `${BROWSER_WINDOW_PREFIX}${windowId}`
}

export function browserChromeLabel(windowId: string): string {
  return windowId === PRIMARY_BROWSER_WINDOW_ID
    ? 'nebula-chrome'
    : `${BROWSER_CHROME_PREFIX}${windowId}`
}

export function browserTabWebviewLabel(
  windowId: string,
  tabId: string,
): string {
  return `${BROWSER_TAB_PREFIX}${windowId}-${tabId}`
}

export function createBrowserWorkspace(
  windows: BrowserWindowSessionSnapshot[] = [],
  mostRecentlyActiveWindowId: string | null = null,
): BrowserWorkspace {
  const uniqueWindows = new Map<string, BrowserWindowSessionSnapshot>()
  for (const window of windows) uniqueWindows.set(window.windowId, window)
  const normalizedWindows = [...uniqueWindows.values()]
  const recent = normalizedWindows.some(
    (window) => window.windowId === mostRecentlyActiveWindowId,
  )
    ? mostRecentlyActiveWindowId
    : normalizedWindows[0]?.windowId ?? null

  return {
    windows: normalizedWindows,
    mostRecentlyActiveWindowId: recent,
  }
}

export function upsertWorkspaceWindow(
  workspace: BrowserWorkspace,
  nextWindow: BrowserWindowSessionSnapshot,
): BrowserWorkspace {
  const index = workspace.windows.findIndex(
    (window) => window.windowId === nextWindow.windowId,
  )
  const windows = [...workspace.windows]
  if (index === -1) windows.push(nextWindow)
  else windows[index] = nextWindow
  return {
    windows,
    mostRecentlyActiveWindowId: nextWindow.windowId,
  }
}

export function removeWorkspaceWindow(
  workspace: BrowserWorkspace,
  windowId: string,
): BrowserWorkspace {
  const windows = workspace.windows.filter(
    (window) => window.windowId !== windowId,
  )
  return {
    windows,
    mostRecentlyActiveWindowId:
      workspace.mostRecentlyActiveWindowId === windowId
        ? windows.at(-1)?.windowId ?? null
        : workspace.mostRecentlyActiveWindowId,
  }
}

export function resolveTransferredShortcutId(
  tab: PersistedBrowserTab,
  target: BrowserWindowSessionSnapshot,
): string {
  const occupied = new Set(target.tabs.map((entry) => entry.shortcutId))
  if (!occupied.has(tab.shortcutId)) return tab.shortcutId

  const base = `moved-${tab.tabId}`
  if (!occupied.has(base)) return base
  let suffix = 2
  while (occupied.has(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}

export function transferWorkspaceTab(
  workspace: BrowserWorkspace,
  sourceWindowId: string,
  targetWindowId: string,
  tabId: string,
): BrowserWorkspace {
  if (sourceWindowId === targetWindowId) return workspace
  const source = workspace.windows.find(
    (window) => window.windowId === sourceWindowId,
  )
  const target = workspace.windows.find(
    (window) => window.windowId === targetWindowId,
  )
  const tab = source?.tabs.find((entry) => entry.tabId === tabId)
  if (!source || !target || !tab) return workspace

  const movedTab = {
    ...tab,
    shortcutId: resolveTransferredShortcutId(tab, target),
  }
  const sourceTabs = source.tabs.filter((entry) => entry.tabId !== tabId)
  const nextSource = {
    ...source,
    tabs: sourceTabs,
    activeTabId:
      source.activeTabId === tabId
        ? sourceTabs[0]?.tabId ?? null
        : source.activeTabId,
  }
  const nextTarget = {
    ...target,
    tabs: [...target.tabs, movedTab],
    activeTabId: movedTab.tabId,
  }

  return {
    windows: workspace.windows.map((window) => {
      if (window.windowId === sourceWindowId) return nextSource
      if (window.windowId === targetWindowId) return nextTarget
      return window
    }),
    mostRecentlyActiveWindowId: targetWindowId,
  }
}

export function browserTransferStorageKey(transferId: string): string {
  return `nebula-browser-tab-transfer-v1:${transferId}`
}
