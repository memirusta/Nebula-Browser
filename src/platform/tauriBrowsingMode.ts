import { invoke } from '@tauri-apps/api/core'
import { TITLE_BAR_HEIGHT, SEMI_LUNAR_HIT_ZONE_HEIGHT } from '../core/windowChrome'
import { isTauri } from './runtime'
import { activateBrowseTab, hideAllBrowseTabs, syncTauriBrowserBounds } from './tauriBrowser'
import {
  hideChromeWebview,
  ensureChromeWebviewVisible,
  setChromeWebviewHeight,
  showChromeWebview,
  syncChromeWebviewBounds,
} from './tauriChromeWebview'
import { showMainWebview } from './tauriMainWebview'
import { setShellHitRegion, resetBrowsingChromeLayout } from './tauriShell'
import {
  cancelScheduledStack,
  setBrowsingChromeExpected,
  setOverlayModeActive,
  stackBrowsingChromeAboveBrowser,
} from './tauriWebviewStack'

export type TauriViewMode = 'home' | 'browsing' | 'overlay'

export interface BrowsingTabTarget {
  tabId: string
  url: string
  forceNavigate?: boolean
}

interface PendingViewMode {
  mode: TauriViewMode
  tab: BrowsingTabTarget | null
}

const queue: PendingViewMode[] = []
let draining = false
let activeTauriMode: TauriViewMode | null = null

async function applyHomeMode(): Promise<void> {
  setOverlayModeActive(false)
  setBrowsingChromeExpected(false)
  cancelScheduledStack()

  try {
    try {
      await hideAllBrowseTabs()
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('[nebula] hide browse tabs on home failed', error)
      }
    }

    try {
      await hideChromeWebview()
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('[nebula] hide chrome on home failed', error)
      }
    }

    try {
      await setShellHitRegion(null)
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('[nebula] clear shell hit region failed', error)
      }
    }

    try {
      await resetBrowsingChromeLayout()
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('[nebula] reset browsing chrome layout failed', error)
      }
    }
  } finally {
    try {
      await showMainWebview()
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('[nebula] show main on home failed', error)
      }
    }
  }
}

async function applyBrowsingMode(tab: BrowsingTabTarget): Promise<void> {
  setOverlayModeActive(false)

  setBrowsingChromeExpected(true)
  setChromeWebviewHeight(TITLE_BAR_HEIGHT)
  await activateBrowseTab(tab.tabId, tab.url, { forceNavigate: tab.forceNavigate })
  await syncTauriBrowserBounds()
  await showChromeWebview(TITLE_BAR_HEIGHT)
  await syncChromeWebviewBounds()
  await setShellHitRegion({
    logicalTop: TITLE_BAR_HEIGHT,
    logicalHeight: SEMI_LUNAR_HIT_ZONE_HEIGHT,
  })
  cancelScheduledStack()
  await stackBrowsingChromeAboveBrowser(tab.tabId)
}

async function applyOverlayMode(): Promise<void> {
  setOverlayModeActive(true)

  setBrowsingChromeExpected(true)
  cancelScheduledStack()
  setChromeWebviewHeight(TITLE_BAR_HEIGHT)

  await showMainWebview()
  await ensureChromeWebviewVisible()
  await syncChromeWebviewBounds()
  await setShellHitRegion({ logicalTop: 0, logicalHeight: window.innerHeight })

  try {
    await invoke('webview_raise_overlay', { chromeLogicalHeight: TITLE_BAR_HEIGHT })
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[nebula] webview_raise_overlay failed', error)
    }
  }
}

async function applyViewMode(mode: TauriViewMode, tab: BrowsingTabTarget | null): Promise<void> {
  const previous = activeTauriMode
  activeTauriMode = mode

  if (mode === 'overlay' && (previous === 'browsing' || previous === 'overlay')) {
    await applyOverlayMode()
    return
  }

  switch (mode) {
    case 'home':
      await applyHomeMode()
      break
    case 'browsing':
      if (!tab) return
      await applyBrowsingMode(tab)
      break
    case 'overlay':
      await applyOverlayMode()
      break
  }
}

async function drainViewModeQueue(): Promise<void> {
  if (draining) return
  draining = true

  try {
    while (queue.length > 0) {
      const next = queue[queue.length - 1]
      queue.length = 0
      try {
        await applyViewMode(next.mode, next.tab)
      } catch (error) {
        if (import.meta.env.DEV) {
          console.warn('[nebula] tauri view mode transition failed', error)
        }
        try {
          await showMainWebview()
        } catch {
          // last resort
        }
      }
    }
  } finally {
    draining = false
    if (queue.length > 0) {
      void drainViewModeQueue()
    }
  }
}

export function syncTauriViewMode(mode: TauriViewMode, tab: BrowsingTabTarget | null): void {
  if (!isTauri) return

  setOverlayModeActive(mode === 'overlay')

  const pending = { mode, tab }
  if (queue.length > 0) {
    queue[queue.length - 1] = pending
  } else {
    queue.push(pending)
  }

  void drainViewModeQueue()
}

/** Await platform transition (e.g. last tab close → home). */
export async function applyTauriViewModeNow(
  mode: TauriViewMode,
  tab: BrowsingTabTarget | null,
): Promise<void> {
  if (!isTauri) return

  setOverlayModeActive(mode === 'overlay')
  queue.length = 0
  draining = false

  try {
    await applyViewMode(mode, tab)
    activeTauriMode = mode
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[nebula] tauri view mode transition failed', error)
    }
    try {
      await showMainWebview()
    } catch {
      // last resort
    }
  }
}

/** @deprecated Use syncTauriViewMode */
export async function enterTauriBrowsingMode(tabId: string, url: string): Promise<void> {
  syncTauriViewMode('browsing', { tabId, url })
}

/** @deprecated Use syncTauriViewMode */
export async function enterTauriOverlayMode(): Promise<void> {
  syncTauriViewMode('overlay', null)
}

/** @deprecated Use syncTauriViewMode */
export async function enterTauriHomeMode(): Promise<void> {
  syncTauriViewMode('home', null)
}
