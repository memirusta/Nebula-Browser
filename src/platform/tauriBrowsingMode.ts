import { invoke } from '@tauri-apps/api/core'
import { SEMI_LUNAR_HIT_ZONE_HEIGHT } from '../core/windowChrome'
import { isTauri } from './runtime'
import { activateBrowseTab, hideAllBrowseTabs, syncTauriBrowserBounds } from './tauriBrowser'
import { hideChromeWebview } from './tauriChromeWebview'
import { showMainWebview } from './tauriMainWebview'
import { forceExitSiteFullscreen, isSiteFullscreenActive } from './tauriSiteFullscreen'
import { setShellHitRegion, resetBrowsingChromeLayout } from './tauriShell'
import {
  cancelScheduledStack,
  setBrowsingChromeExpected,
  setOverlayModeActive,
} from './tauriWebviewStack'

export type TauriViewMode = 'home' | 'browsing' | 'overlay'

export interface BrowsingTabTarget {
  tabId: string
  url: string
  forceNavigate?: boolean
}

let activeTauriMode: TauriViewMode | null = null
let transitionChain: Promise<void> = Promise.resolve()

async function applyHomeMode(): Promise<void> {
  setOverlayModeActive(false)
  setBrowsingChromeExpected(false)
  cancelScheduledStack()

  try {
    await forceExitSiteFullscreen()
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

  if (isSiteFullscreenActive()) {
    await forceExitSiteFullscreen()
  }

  try {
    await hideChromeWebview()
  } catch {
    // legacy chrome webview may not exist
  }

  await activateBrowseTab(tab.tabId, tab.url, { forceNavigate: tab.forceNavigate })
  await syncTauriBrowserBounds()
  await setShellHitRegion({
    logicalTop: 0,
    logicalHeight: SEMI_LUNAR_HIT_ZONE_HEIGHT,
  })
  cancelScheduledStack()
  try {
    await invoke('webview_raise_ui')
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[nebula] webview_raise_ui failed', error)
    }
  }
}

async function applyOverlayMode(): Promise<void> {
  setOverlayModeActive(true)
  setBrowsingChromeExpected(true)
  cancelScheduledStack()

  await showMainWebview()
  await setShellHitRegion({ logicalTop: 0, logicalHeight: window.innerHeight })

  try {
    await invoke('webview_raise_overlay', { chromeLogicalHeight: null })
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[nebula] webview_raise_overlay failed', error)
    }
  }
}

async function applyViewMode(mode: TauriViewMode, tab: BrowsingTabTarget | null): Promise<void> {
  const previous = activeTauriMode

  if (mode === 'overlay' && (previous === 'browsing' || previous === 'overlay')) {
    await applyOverlayMode()
    activeTauriMode = mode
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
  activeTauriMode = mode
}

function enqueueViewMode(mode: TauriViewMode, tab: BrowsingTabTarget | null): Promise<void> {
  const run = transitionChain.then(() => applyViewMode(mode, tab))
  transitionChain = run.catch(async (error) => {
    if (import.meta.env.DEV) {
      console.warn('[nebula] tauri view mode transition failed', error)
    }
    try {
      await showMainWebview()
    } catch {
      // last resort
    }
  })
  return run
}

export function syncTauriViewMode(mode: TauriViewMode, tab: BrowsingTabTarget | null): void {
  if (!isTauri) return

  setOverlayModeActive(mode === 'overlay')

  void enqueueViewMode(mode, tab).catch(() => undefined)
}

/** Await platform transition (e.g. last tab close → home). */
export async function applyTauriViewModeNow(
  mode: TauriViewMode,
  tab: BrowsingTabTarget | null,
): Promise<void> {
  if (!isTauri) return

  setOverlayModeActive(mode === 'overlay')
  try {
    await enqueueViewMode(mode, tab)
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
