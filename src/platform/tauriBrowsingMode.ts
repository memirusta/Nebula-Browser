import { invoke } from '@tauri-apps/api/core'
import { SEMI_LUNAR_HIT_ZONE_HEIGHT } from '../core/windowChrome'
import { isTauri } from './runtime'
import {
  activateBrowseTab,
  hideAllBrowseTabs,
  syncTauriBrowserBounds,
} from './tauriBrowser'
import { hideChromeWebview, showChromeWebview } from './tauriChromeWebview'
import { showMainWebview } from './tauriMainWebview'
import {
  forceExitSiteFullscreen,
  isSiteFullscreenActive,
} from './tauriSiteFullscreen'
import {
  traceTransitionCall,
  transitionErrorDetails,
  writeTransitionLog,
} from './tauriTransitionLog'
import {
  cancelScheduledStack,
  setBrowsingChromeExpected,
  setOverlayModeActive,
  stackBrowsingChromeAboveBrowser,
} from './tauriWebviewStack'

export type TauriViewMode =
  | 'home'
  | 'browsing'
  | 'overlay'

export interface BrowsingTabTarget {
  tabId: string
  url: string
  forceNavigate?: boolean
}

let activeTauriMode: TauriViewMode | null = null
let transitionChain: Promise<void> = Promise.resolve()
let transitionSequence = 0
let latestTransitionRequest = 0

export const NATIVE_TAB_FAILED_EVENT =
  'nebula:native-tab-failed'

export const NATIVE_TAB_READY_EVENT =
  'nebula:native-tab-ready'

function isCurrentTransition(
  requestId: number,
): boolean {
  return (
    requestId ===
    latestTransitionRequest
  )
}

async function applyHomeMode(
  traceId: string,
  requestId: number,
): Promise<void> {
  await writeTransitionLog('mode.home', 'start', {
    traceId,
    requestId,
    previousMode: activeTauriMode,
  })

  setOverlayModeActive(false)
  setBrowsingChromeExpected(true)
  cancelScheduledStack()

  await traceTransitionCall(
    traceId,
    'mode.home.exit-site-fullscreen',
    {},
    forceExitSiteFullscreen,
  )

  if (!isCurrentTransition(requestId)) return

  await traceTransitionCall(
    traceId,
    'mode.home.show-main',
    {},
    showMainWebview,
  )

  if (!isCurrentTransition(requestId)) return

  // Browser tabs simply disappear and reveal the already-mounted Home underneath.
  try {
    await traceTransitionCall(
      traceId,
      'mode.home.hide-tabs',
      {},
      hideAllBrowseTabs,
    )
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[nebula] hide browse tabs on home failed', error)
    }
  }

  if (!isCurrentTransition(requestId)) return

  // Dedicated chrome owns Semi-Lunar in every ordinary mode. ChromeApp will
  // resize this initial strip to its exact expanded/collapsed bounds.
  await traceTransitionCall(
    traceId,
    'mode.home.show-chrome',
    {},
    () => showChromeWebview(SEMI_LUNAR_HIT_ZONE_HEIGHT),
  )

  if (!isCurrentTransition(requestId)) return

  await stackBrowsingChromeAboveBrowser(null)

  await writeTransitionLog('mode.home', 'ok', { traceId, requestId })
}

async function applyBrowsingMode(
  tab: BrowsingTabTarget,
  traceId: string,
  requestId: number,
): Promise<void> {
  await writeTransitionLog('mode.browsing', 'start', {
    traceId,
    requestId,
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

  if (!isCurrentTransition(requestId)) return

  // Keep Home/main full-screen and opaque underneath the site. The dedicated
  // chrome surface is independent and never changes browser bounds.
  await traceTransitionCall(
    traceId,
    'mode.browsing.show-main-backdrop',
    { tabId: tab.tabId },
    showMainWebview,
  )

  if (!isCurrentTransition(requestId)) return

  await traceTransitionCall(
    traceId,
    'mode.browsing.show-chrome',
    { tabId: tab.tabId },
    () => showChromeWebview(SEMI_LUNAR_HIT_ZONE_HEIGHT),
  )

  if (!isCurrentTransition(requestId)) return

  await traceTransitionCall(
    traceId,
    'mode.browsing.activate-tab',
    { tabId: tab.tabId, url: tab.url },
    () =>
      activateBrowseTab(tab.tabId, tab.url, {
        forceNavigate: tab.forceNavigate,
        traceId,
        shouldContinue: () => isCurrentTransition(requestId),
        // From Home there is no outgoing site, so establish Home < tab < chrome
        // while the incoming tab is still hidden. Tab-to-tab keeps the old tab
        // visible until the incoming one has been shown.
        stageBelowShellBeforeShow: activeTauriMode === 'home',
      }),
  )

  if (!isCurrentTransition(requestId)) return

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

  if (!isCurrentTransition(requestId)) return

  cancelScheduledStack()
  await traceTransitionCall(
    traceId,
    'mode.browsing.stack-separated-surfaces',
    { tabId: tab.tabId },
    () => stackBrowsingChromeAboveBrowser(tab.tabId),
  )

  if (!isCurrentTransition(requestId)) return

  await writeTransitionLog('mode.browsing.ready-event', 'info', {
    traceId,
    requestId,
    tabId: tab.tabId,
  })

  window.dispatchEvent(
    new CustomEvent(NATIVE_TAB_READY_EVENT, {
      detail: { traceId, requestId, tabId: tab.tabId },
    }),
  )

  await writeTransitionLog('mode.browsing', 'ok', {
    traceId,
    requestId,
    tabId: tab.tabId,
  })
}

async function applyOverlayMode(
  requestId: number,
): Promise<void> {
  setOverlayModeActive(true)
  setBrowsingChromeExpected(false)
  cancelScheduledStack()

  // Overlay UI lives on main and must sit above the browser. Hide the separate
  // Semi-Lunar surface temporarily so it cannot cover overlay controls.
  try {
    await hideChromeWebview()
  } catch {
    // chrome may not exist yet
  }

  await showMainWebview()

  if (!isCurrentTransition(requestId)) return

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
  requestId: number,
): Promise<void> {
  const previous =
    activeTauriMode

  await writeTransitionLog(
    'mode.apply',
    'start',
    {
      traceId,
      requestId,
      mode,
      previousMode:
        previous,
      tabId:
        tab?.tabId,
    },
  )

  if (
    !isCurrentTransition(
      requestId,
    )
  ) {
    await writeTransitionLog(
      'mode.apply.stale',
      'info',
      {
        traceId,
        requestId,
        latestTransitionRequest,
        mode,
        tabId:
          tab?.tabId,
      },
    )

    return
  }

  /*
   * Overlay -> overlay and browsing -> overlay do not need
   * the full Home/Browsing transition machinery.
   */
  if (
    mode === 'overlay' &&
    (
      previous ===
        'browsing' ||
      previous ===
        'overlay'
    )
  ) {
    await applyOverlayMode(
      requestId,
    )

    if (
      isCurrentTransition(
        requestId,
      )
    ) {
      activeTauriMode =
        mode
    }

    return
  }

  switch (mode) {
    case 'home':
      await applyHomeMode(
        traceId,
        requestId,
      )
      break

    case 'browsing':
      if (!tab) {
        return
      }

      await applyBrowsingMode(
        tab,
        traceId,
        requestId,
      )
      break

    case 'overlay':
      await applyOverlayMode(
        requestId,
      )
      break
  }

  if (
    !isCurrentTransition(
      requestId,
    )
  ) {
    await writeTransitionLog(
      'mode.apply.stale-after-run',
      'info',
      {
        traceId,
        requestId,
        latestTransitionRequest,
        mode,
        tabId:
          tab?.tabId,
      },
    )

    return
  }

  activeTauriMode =
    mode

  await writeTransitionLog(
    'mode.apply',
    'ok',
    {
      traceId,
      requestId,
      mode,
      previousMode:
        previous,
    },
  )
}

function enqueueViewMode(
  mode: TauriViewMode,
  tab: BrowsingTabTarget | null,
): Promise<void> {
  const requestId =
    ++transitionSequence

  latestTransitionRequest =
    requestId

  const traceId =
    `${mode}-${Date.now()}-${requestId}`

  void writeTransitionLog(
    'mode.enqueue',
    'info',
    {
      traceId,
      requestId,
      mode,
      activeMode:
        activeTauriMode,
      tabId:
        tab?.tabId,
      url:
        tab?.url,
    },
  )

  const run =
    transitionChain.then(
      () =>
        applyViewMode(
          mode,
          tab,
          traceId,
          requestId,
        ),
    )

  const guardedRun =
    run.catch(
      async (
        error,
      ) => {
        const stale =
          !isCurrentTransition(
            requestId,
          )

        await writeTransitionLog(
          'mode.transition',
          stale
            ? 'info'
            : 'error',
          {
            traceId,
            requestId,
            latestTransitionRequest,
            stale,
            mode,
            tabId:
              tab?.tabId,
            ...transitionErrorDetails(
              error,
            ),
          },
        )

        /*
         * A superseded transition must never recover Home or
         * emit FAILED for the currently requested tab.
         */
        if (stale) {
          return
        }

        if (
          import.meta.env.DEV
        ) {
          console.warn(
            '[nebula] tauri view mode transition failed',
            error,
          )
        }

        if (
          mode ===
          'browsing'
        ) {
          try {
            await applyHomeMode(
              `${traceId}:recovery`,
              requestId,
            )

            if (
              isCurrentTransition(
                requestId,
              )
            ) {
              activeTauriMode =
                'home'
            }
          } catch {
            if (
              !isCurrentTransition(
                requestId,
              )
            ) {
              return
            }

            try {
              await showMainWebview()
            } catch {
              /*
               * Last resort.
               */
            }
          }

          if (
            !isCurrentTransition(
              requestId,
            )
          ) {
            return
          }

          await writeTransitionLog(
            'mode.browsing.failed-event',
            'info',
            {
              traceId,
              requestId,
              tabId:
                tab?.tabId,
              ...transitionErrorDetails(
                error,
              ),
            },
          )

          window.dispatchEvent(
            new CustomEvent(
              NATIVE_TAB_FAILED_EVENT,
              {
                detail: {
                  traceId,
                  requestId,
                  tabId:
                    tab?.tabId,
                  ...transitionErrorDetails(
                    error,
                  ),
                },
              },
            ),
          )

          return
        }

        try {
          await showMainWebview()
        } catch {
          /*
           * Last resort.
           */
        }
      },
    )

  transitionChain =
    guardedRun

  return guardedRun
}

export function syncTauriViewMode(
  mode: TauriViewMode,
  tab: BrowsingTabTarget | null,
): void {
  if (!isTauri) {
    return
  }

  setOverlayModeActive(
    mode === 'overlay',
  )

  void enqueueViewMode(
    mode,
    tab,
  ).catch(
    () => undefined,
  )
}

/**
 * Await platform transition.
 *
 * Used for cases such as closing the last tab and returning Home,
 * where callers need to know that the native transition completed.
 */
export async function applyTauriViewModeNow(
  mode: TauriViewMode,
  tab: BrowsingTabTarget | null,
): Promise<void> {
  if (!isTauri) {
    return
  }

  setOverlayModeActive(
    mode === 'overlay',
  )

  try {
    await enqueueViewMode(
      mode,
      tab,
    )
  } catch (error) {
    if (
      import.meta.env.DEV
    ) {
      console.warn(
        '[nebula] tauri view mode transition failed',
        error,
      )
    }

    try {
      await showMainWebview()
    } catch {
      /*
       * Last resort.
       */
    }
  }
}

/**
 * @deprecated
 * Use syncTauriViewMode.
 */
export async function enterTauriBrowsingMode(
  tabId: string,
  url: string,
): Promise<void> {
  syncTauriViewMode(
    'browsing',
    {
      tabId,
      url,
    },
  )
}

/**
 * @deprecated
 * Use syncTauriViewMode.
 */
export async function enterTauriOverlayMode(): Promise<void> {
  syncTauriViewMode(
    'overlay',
    null,
  )
}

/**
 * @deprecated
 * Use syncTauriViewMode.
 */
export async function enterTauriHomeMode(): Promise<void> {
  syncTauriViewMode(
    'home',
    null,
  )
}