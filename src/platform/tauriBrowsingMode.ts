import { invoke } from '@tauri-apps/api/core'
import { SEMI_LUNAR_HIT_ZONE_HEIGHT } from '../core/windowChrome'
import { isTauri } from './runtime'
import { activateBrowseTab, hideAllBrowseTabs, syncTauriBrowserBounds } from './tauriBrowser'
import { hideChromeWebview } from './tauriChromeWebview'
import { showMainWebview } from './tauriMainWebview'
import { forceExitSiteFullscreen, isSiteFullscreenActive } from './tauriSiteFullscreen'
import { setShellHitRegion, resetBrowsingChromeLayout } from './tauriShell'
import {
  traceTransitionCall,
  transitionErrorDetails,
  writeTransitionLog,
} from './tauriTransitionLog'
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
let transitionSequence = 0

export const NATIVE_TAB_FAILED_EVENT = 'nebula:native-tab-failed'
export const NATIVE_TAB_READY_EVENT = 'nebula:native-tab-ready'

async function applyHomeMode(traceId = `home-${Date.now()}-${++transitionSequence}`): Promise<void> {
  await writeTransitionLog('mode.home', 'start', { traceId, previousMode: activeTauriMode })
  setOverlayModeActive(false)
  setBrowsingChromeExpected(false)
  cancelScheduledStack()

  try {
    await traceTransitionCall(traceId, 'mode.home.exit-site-fullscreen', {}, forceExitSiteFullscreen)
    try {
      await traceTransitionCall(traceId, 'mode.home.hide-tabs', {}, hideAllBrowseTabs)
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('[nebula] hide browse tabs on home failed', error)
      }
    }

    try {
      await traceTransitionCall(traceId, 'mode.home.hide-chrome', {}, hideChromeWebview)
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('[nebula] hide chrome on home failed', error)
      }
    }

    try {
      await traceTransitionCall(traceId, 'mode.home.clear-hit-region', {}, () =>
        setShellHitRegion(null),
      )
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('[nebula] clear shell hit region failed', error)
      }
    }

    try {
      await traceTransitionCall(
        traceId,
        'mode.home.reset-chrome-layout',
        {},
        resetBrowsingChromeLayout,
      )
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('[nebula] reset browsing chrome layout failed', error)
      }
    }
  } finally {
    try {
      await traceTransitionCall(traceId, 'mode.home.show-main', {}, showMainWebview)
      await writeTransitionLog('mode.home', 'ok', { traceId })
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('[nebula] show main on home failed', error)
      }
    }
  }
}

async function applyBrowsingMode(tab: BrowsingTabTarget, traceId: string): Promise<void> {
  await writeTransitionLog('mode.browsing', 'start', {
    traceId,
    previousMode: activeTauriMode,
    tabId: tab.tabId,
    url: tab.url,
    forceNavigate: tab.forceNavigate ?? false,
  })
  setOverlayModeActive(false)
  setBrowsingChromeExpected(true)

  if (isSiteFullscreenActive()) {
    await traceTransitionCall(
      traceId,
      'mode.browsing.exit-site-fullscreen',
      { tabId: tab.tabId },
      forceExitSiteFullscreen,
    )
  }

  try {
    await traceTransitionCall(
      traceId,
      'mode.browsing.hide-legacy-chrome',
      { tabId: tab.tabId },
      hideChromeWebview,
    )
  } catch (error) {
    // legacy chrome webview may not exist
    await writeTransitionLog('mode.browsing.hide-legacy-chrome.ignored', 'info', {
      traceId,
      tabId: tab.tabId,
      ...transitionErrorDetails(error),
    })
  }

  // Only creation/navigation/show failures make the native tab unusable.
  // Layout and z-order repairs are best-effort and must never throw the user
  // back to Home after the site webview is already visible.
  await traceTransitionCall(
    traceId,
    'mode.browsing.activate-tab',
    { tabId: tab.tabId, url: tab.url },
    () => activateBrowseTab(tab.tabId, tab.url, {
      forceNavigate: tab.forceNavigate,
      traceId,
    }),
  )
  await writeTransitionLog('mode.browsing.ready-event', 'info', { traceId, tabId: tab.tabId })
  window.dispatchEvent(new CustomEvent(NATIVE_TAB_READY_EVENT, { detail: { traceId } }))

  try {
    await traceTransitionCall(
      traceId,
      'mode.browsing.post-sync-bounds',
      { tabId: tab.tabId },
      syncTauriBrowserBounds,
    )
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[nebula] post-activation bounds sync failed', error)
    }
  }

  try {
    await traceTransitionCall(
      traceId,
      'mode.browsing.post-hit-region',
      { tabId: tab.tabId },
      () => setShellHitRegion({
        logicalTop: 0,
        logicalHeight: SEMI_LUNAR_HIT_ZONE_HEIGHT,
      }),
    )
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[nebula] post-activation hit region failed', error)
    }
  }
  cancelScheduledStack()
  try {
    await traceTransitionCall(
      traceId,
      'mode.browsing.post-raise-ui',
      { tabId: tab.tabId },
      () => invoke('webview_raise_ui'),
    )
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[nebula] webview_raise_ui failed', error)
    }
  }
  await writeTransitionLog('mode.browsing', 'ok', { traceId, tabId: tab.tabId })
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

async function applyViewMode(
  mode: TauriViewMode,
  tab: BrowsingTabTarget | null,
  traceId: string,
): Promise<void> {
  const previous = activeTauriMode
  await writeTransitionLog('mode.apply', 'start', {
    traceId,
    mode,
    previousMode: previous,
    tabId: tab?.tabId,
  })

  if (mode === 'overlay' && (previous === 'browsing' || previous === 'overlay')) {
    await applyOverlayMode()
    activeTauriMode = mode
    return
  }

  switch (mode) {
    case 'home':
      await applyHomeMode(traceId)
      break
    case 'browsing':
      if (!tab) return
      await applyBrowsingMode(tab, traceId)
      break
    case 'overlay':
      await applyOverlayMode()
      break
  }
  activeTauriMode = mode
  await writeTransitionLog('mode.apply', 'ok', { traceId, mode, previousMode: previous })
}

function enqueueViewMode(mode: TauriViewMode, tab: BrowsingTabTarget | null): Promise<void> {
  const traceId = `${mode}-${Date.now()}-${++transitionSequence}`
  void writeTransitionLog('mode.enqueue', 'info', {
    traceId,
    mode,
    activeMode: activeTauriMode,
    tabId: tab?.tabId,
    url: tab?.url,
  })
  const run = transitionChain.then(() => applyViewMode(mode, tab, traceId))
  transitionChain = run.catch(async (error) => {
    await writeTransitionLog('mode.transition', 'error', {
      traceId,
      mode,
      tabId: tab?.tabId,
      ...transitionErrorDetails(error),
    })
    if (import.meta.env.DEV) {
      console.warn('[nebula] tauri view mode transition failed', error)
    }
    if (mode === 'browsing') {
      try {
        await applyHomeMode(`${traceId}:recovery`)
        activeTauriMode = 'home'
      } catch {
        try {
          await showMainWebview()
        } catch {
          // last resort
        }
      }
      await writeTransitionLog('mode.browsing.failed-event', 'info', {
        traceId,
        tabId: tab?.tabId,
        ...transitionErrorDetails(error),
      })
      window.dispatchEvent(new CustomEvent(NATIVE_TAB_FAILED_EVENT, {
        detail: { traceId, ...transitionErrorDetails(error) },
      }))
      return
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
