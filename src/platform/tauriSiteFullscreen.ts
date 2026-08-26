import { listen, emit } from '@tauri-apps/api/event'
import type { Window } from '@tauri-apps/api/window'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { invoke } from '@tauri-apps/api/core'
import {
  shortcutIdForTabWebviewLabel,
  tabWebviewLabel,
} from '../core/browserTab'
import { registerListenerGroup } from '../core/listenerGroup'
import { isTauri } from './runtime'
import { debounce } from './debounce'
import {
  setSiteFullscreenBoundsMode,
  syncTabWebviewFullscreenBounds,
  forceSyncActiveTabBounds,
  getActiveBrowseTabId,
} from './tauriBrowser'
import { hideMainWebview, showMainWebview } from './tauriMainWebview'
import {
  ensureChromeWebviewVisible,
  forceChromeWebviewCompactBounds,
  getChromeWebview,
} from './tauriChromeWebview'
import {
  cancelScheduledStack,
  setBrowsingChromeExpected,
  stackBrowsingChromeAboveBrowser,
} from './tauriWebviewStack'
import {
  currentBrowserWindowLabel,
  scopedBrowserEvent,
} from './browserWindowScope'
import {
  transitionErrorDetails,
  writeTransitionLog,
} from './tauriTransitionLog'

export const SITE_FULLSCREEN_EXIT_EVENT = 'nebula-site-fullscreen-exit'
export const BROWSER_FULLSCREEN_CHANGED_EVENT = 'nebula-browser-fullscreen-changed'
const TAB_FULLSCREEN_EVENT = 'nebula-tab-fullscreen'

export function siteFullscreenExitEvent(): string {
  return scopedBrowserEvent(SITE_FULLSCREEN_EXIT_EVENT)
}

export function browserFullscreenChangedEvent(): string {
  return scopedBrowserEvent(BROWSER_FULLSCREEN_CHANGED_EVENT)
}

interface TabFullscreenPayload {
  label: string
  is_fullscreen: boolean
}

let siteFullscreenActive = false
let fullscreenTabId: string | null = null
let listenerStarted = false
let fullscreenResizeUnlisten: (() => void) | undefined
let fullscreenScaleUnlisten: (() => void) | undefined
let transitionChain: Promise<void> = Promise.resolve()
let tabSwitchHandoffPending = false

function shortcutIdFromLabel(label: string): string | null {
  return shortcutIdForTabWebviewLabel(label)
}

function requestDocumentFullscreenExit(
  shortcutId: string,
): void {
  const script = `(() => {
    try {
      if (window.__nebulaExitPersistentFullscreen?.()) {
        return true;
      }
      if (document.fullscreenElement && document.exitFullscreen) {
        void document.exitFullscreen().catch(() => {});
        return true;
      }

      const webkitDocument = document;
      if (
        webkitDocument.webkitFullscreenElement &&
        webkitDocument.webkitExitFullscreen
      ) {
        webkitDocument.webkitExitFullscreen();
        return true;
      }
    } catch (_) {}

    return false;
  })()`

  /*
   * Do not await the generic script bridge. Its native implementation waits
   * for a WebView2 ExecuteScript callback and is appropriate for reads, but a
   * keyboard fullscreen handoff must not stall behind that synchronous wait.
   */
  void invoke<string>(
    'webview_execute_script',
    {
      label:
        tabWebviewLabel(
          shortcutId,
        ),
      script,
    },
  ).catch((error) => {
    if (import.meta.env.DEV) {
      console.warn(
        '[nebula] document fullscreen exit request failed',
        error,
      )
    }
  })
}

function enqueueFullscreenTransition<T>(task: () => Promise<T>): Promise<T> {
  const run = transitionChain.then(
    () => task(),
    () => task(),
  )

  // Keep the shared serialization chain Promise<void>, while callers may
  // receive a typed result such as the fullscreen handoff boolean.
  transitionChain = run.then(
    () => undefined,
    () => undefined,
  )

  return run
}

export function isSiteFullscreenActive(): boolean {
  return siteFullscreenActive
}

async function waitForWindowLayoutSettle(appWindow: Window): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false
    let unlisten: (() => void) | undefined
    let timeout: ReturnType<typeof setTimeout>
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      unlisten?.()
      resolve()
    }
    timeout = setTimeout(finish, 120)

    void appWindow
      .onResized(finish)
      .then((dispose) => {
        if (settled) {
          dispose()
          return
        }
        unlisten = dispose
      })
      .catch(finish)
  })
}

function clearFullscreenResizeListener(): void {
  fullscreenResizeUnlisten?.()
  fullscreenResizeUnlisten = undefined
  fullscreenScaleUnlisten?.()
  fullscreenScaleUnlisten = undefined
}

function resetSiteFullscreenState(): void {
  siteFullscreenActive = false
  fullscreenTabId = null
  setSiteFullscreenBoundsMode(false)
  clearFullscreenResizeListener()
}

async function reassertSiteFullscreenGeometry(
  shortcutId: string,
  reason: 'focus' | 'resize' | 'duplicate-enter' = 'focus',
): Promise<void> {
  if (
    !siteFullscreenActive ||
    fullscreenTabId !== shortcutId
  ) {
    return
  }

  const appWindow = getCurrentWindow()
  const traceId = `site-fullscreen-reassert-${Date.now()}`

  await writeTransitionLog(
    'site-fullscreen.geometry-reassert',
    'start',
    { traceId, shortcutId, reason },
  )

  try {
    // Rust owns the authoritative site-fullscreen state and only repairs the
    // parent HWND while this Nebula top-level window is actually foreground.
    // This prevents Alt+Tab repair from raising Nebula over another app.
    const repaired = await invoke<boolean>(
      'window_reassert_site_fullscreen',
      {
        windowLabel: currentBrowserWindowLabel(),
      },
    )

    if (!repaired) {
      await writeTransitionLog(
        'site-fullscreen.geometry-reassert',
        'info',
        { traceId, shortcutId, reason, repaired: false },
      )
      return
    }

    await waitForWindowLayoutSettle(appWindow)

    if (
      !siteFullscreenActive ||
      fullscreenTabId !== shortcutId
    ) {
      return
    }

    await syncTabWebviewFullscreenBounds(shortcutId)

    await writeTransitionLog(
      'site-fullscreen.geometry-reassert',
      'ok',
      { traceId, shortcutId, reason, repaired: true },
    )
  } catch (error) {
    await writeTransitionLog(
      'site-fullscreen.geometry-reassert',
      'error',
      {
        traceId,
        shortcutId,
        reason,
        ...transitionErrorDetails(error),
      },
    )
  }
}

function bindSiteFullscreenLayoutRepair(
  appWindow: Window,
  shortcutId: string,
): void {
  clearFullscreenResizeListener()

  const onLayoutChange = debounce(() => {
    if (
      !siteFullscreenActive ||
      fullscreenTabId !== shortcutId
    ) {
      return
    }

    void enqueueFullscreenTransition(() =>
      reassertSiteFullscreenGeometry(shortcutId, 'resize'),
    )
  }, 80)

  void appWindow.onResized(onLayoutChange).then((unlisten) => {
    if (
      !siteFullscreenActive ||
      fullscreenTabId !== shortcutId
    ) {
      unlisten()
      return
    }
    fullscreenResizeUnlisten = unlisten
  })

  void appWindow.onScaleChanged(onLayoutChange).then((unlisten) => {
    if (
      !siteFullscreenActive ||
      fullscreenTabId !== shortcutId
    ) {
      unlisten()
      return
    }
    fullscreenScaleUnlisten = unlisten
  })
}

async function enterSiteFullscreen(shortcutId: string): Promise<void> {
  if (siteFullscreenActive) {
    if (fullscreenTabId === shortcutId) {
      await reassertSiteFullscreenGeometry(shortcutId, 'duplicate-enter')
    }
    return
  }

  siteFullscreenActive = true
  fullscreenTabId = shortcutId

  try {
    setBrowsingChromeExpected(false)
    cancelScheduledStack()
    setSiteFullscreenBoundsMode(true)
    clearFullscreenResizeListener()

    const appWindow = getCurrentWindow()

    await hideMainWebview()
    try {
      const chrome = await getChromeWebview()
      await chrome?.hide()
    } catch {
      // chrome may not exist yet
    }
    await invoke('window_enter_site_fullscreen', {
      windowLabel: currentBrowserWindowLabel(),
    })

    await waitForWindowLayoutSettle(appWindow)
    await syncTabWebviewFullscreenBounds(shortcutId)
    bindSiteFullscreenLayoutRepair(appWindow, shortcutId)
  } catch (error) {
    resetSiteFullscreenState()
    setBrowsingChromeExpected(true)
    try {
      await invoke('window_exit_site_fullscreen', {
        windowLabel: currentBrowserWindowLabel(),
      })
    } catch {
      // ignore
    }
    try {
      await showMainWebview()
    } catch {
      // ignore
    }
    throw error
  }
}

async function exitSiteFullscreen(): Promise<void> {
  if (!siteFullscreenActive) return

  const returningTabId = fullscreenTabId
  const appWindow = getCurrentWindow()
  const traceId = `site-fullscreen-exit-${Date.now()}`
  await writeTransitionLog('site-fullscreen.exit', 'start', {
    traceId,
    returningTabId,
    windowLabel: currentBrowserWindowLabel(),
  })
  clearFullscreenResizeListener()

  siteFullscreenActive = false
  fullscreenTabId = null

  try {
    await invoke('window_exit_site_fullscreen', {
      windowLabel: currentBrowserWindowLabel(),
    })
    await writeTransitionLog('site-fullscreen.exit.window', 'ok', {
      traceId,
      returningTabId,
    })
  } catch (error) {
    await writeTransitionLog('site-fullscreen.exit.window', 'error', {
      traceId,
      returningTabId,
      ...transitionErrorDetails(error),
    })
    if (import.meta.env.DEV) {
      console.warn('[nebula] window_exit_site_fullscreen failed', error)
    }
  }

  await waitForWindowLayoutSettle(appWindow)
  await writeTransitionLog('site-fullscreen.exit.window-settled', 'ok', {
    traceId,
    returningTabId,
  })

  // Transfer geometry ownership back to the ordinary browser layout only after
  // the parent HWND has finished restoring from monitor fullscreen.
  setSiteFullscreenBoundsMode(false)

  try {
    await invoke('webview_restore_browsing_layout', {
      windowLabel: currentBrowserWindowLabel(),
    })
    await writeTransitionLog('site-fullscreen.exit.restore-layout', 'ok', {
      traceId,
      returningTabId,
    })
  } catch (error) {
    await writeTransitionLog('site-fullscreen.exit.restore-layout', 'error', {
      traceId,
      returningTabId,
      ...transitionErrorDetails(error),
    })
    if (import.meta.env.DEV) {
      console.warn('[nebula] webview_restore_browsing_layout failed', error)
    }
  }

  try {
    await showMainWebview()
    await writeTransitionLog('site-fullscreen.exit.show-main', 'ok', {
      traceId,
      returningTabId,
    })
  } catch (error) {
    await writeTransitionLog('site-fullscreen.exit.show-main', 'error', {
      traceId,
      returningTabId,
      ...transitionErrorDetails(error),
    })
    if (import.meta.env.DEV) {
      console.warn('[nebula] showMainWebview after site fullscreen failed', error)
    }
  }

  try {
    await ensureChromeWebviewVisible()
    await writeTransitionLog('site-fullscreen.exit.show-chrome', 'ok', {
      traceId,
      returningTabId,
    })
    await forceChromeWebviewCompactBounds()
    await writeTransitionLog('site-fullscreen.exit.compact-chrome', 'ok', {
      traceId,
      returningTabId,
    })
  } catch (error) {
    await writeTransitionLog('site-fullscreen.exit.restore-chrome', 'error', {
      traceId,
      returningTabId,
      ...transitionErrorDetails(error),
    })
    if (import.meta.env.DEV) {
      console.warn('[nebula] restore chrome after site fullscreen failed', error)
    }
  }

  setBrowsingChromeExpected(true)
  await forceSyncActiveTabBounds()
  await writeTransitionLog('site-fullscreen.exit.sync-active-tab', 'ok', {
    traceId,
    returningTabId,
  })
  await stackBrowsingChromeAboveBrowser(returningTabId)
  await writeTransitionLog('site-fullscreen.exit.stack-chrome', 'ok', {
    traceId,
    returningTabId,
  })
  await emit(siteFullscreenExitEvent())
  // ChromeApp owns the final Semi-Lunar geometry in a separate WebView and
  // resynchronizes it from the exit event above. Reassert visibility, compact
  // hit bounds, and sibling z-order after that asynchronous resync so a stale
  // fullscreen surface cannot cover the hover target.
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 120)
  })
  try {
    await ensureChromeWebviewVisible()
    await forceChromeWebviewCompactBounds()
    await forceSyncActiveTabBounds()
    await stackBrowsingChromeAboveBrowser(returningTabId)
    await writeTransitionLog('site-fullscreen.exit.post-repair', 'ok', {
      traceId,
      returningTabId,
    })
  } catch (error) {
    await writeTransitionLog('site-fullscreen.exit.post-repair', 'error', {
      traceId,
      returningTabId,
      ...transitionErrorDetails(error),
    })
    if (import.meta.env.DEV) {
      console.warn('[nebula] post-fullscreen surface repair failed', error)
    }
  }
  await writeTransitionLog('site-fullscreen.exit', 'ok', {
    traceId,
    returningTabId,
  })
}

async function handleTabFullscreenPayload(payload: TabFullscreenPayload): Promise<void> {
  const shortcutId = shortcutIdFromLabel(payload.label)
  if (!shortcutId) return

  await writeTransitionLog('site-fullscreen.tab-payload', 'info', {
    reason: 'received',
    shortcutId,
    isFullscreen: payload.is_fullscreen,
    siteFullscreenActive,
  })

  if (payload.is_fullscreen) {
    await enterSiteFullscreen(shortcutId)
    return
  }

  if (fullscreenTabId && fullscreenTabId !== shortcutId) return
  await exitSiteFullscreen()
}

async function reconcileSiteFullscreenAfterFocus(): Promise<void> {
  await writeTransitionLog('site-fullscreen.focus-reconcile', 'start', {
    siteFullscreenActive,
    fullscreenTabId,
  })
  if (!siteFullscreenActive || !fullscreenTabId) return

  const expectedTabId = fullscreenTabId
  let active = false
  try {
    const raw = await invoke<string>('webview_execute_script', {
      label: tabWebviewLabel(expectedTabId),
      script: `Boolean(
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.querySelector('[data-nebula-persistent-fullscreen]')
      )`,
    })
    active = JSON.parse(raw) === true
  } catch {
    active = false
  }

  await writeTransitionLog('site-fullscreen.focus-reconcile', 'info', {
    reason: 'checked',
    expectedTabId,
    active,
  })

  if (!siteFullscreenActive || fullscreenTabId !== expectedTabId) return
  if (!active) {
    await exitSiteFullscreen()
    return
  }

  await reassertSiteFullscreenGeometry(expectedTabId, 'focus')
}

export function initSiteFullscreenBridge(): () => void {
  if (!isTauri || listenerStarted) {
    return () => {}
  }

  listenerStarted = true
  let disposeListeners: (() => void) | undefined
  let cancelled = false

  void registerListenerGroup([
    () => listen<TabFullscreenPayload>(scopedBrowserEvent(TAB_FULLSCREEN_EVENT), (event) => {
      void enqueueFullscreenTransition(() => handleTabFullscreenPayload(event.payload))
    }),
    () => getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (!focused || !siteFullscreenActive) return
      void enqueueFullscreenTransition(reconcileSiteFullscreenAfterFocus)
    }),
  ])
    .then((dispose) => {
      if (cancelled) {
        dispose()
        return
      }
      disposeListeners = dispose
    })
    .catch((error) => {
      listenerStarted = false
      if (import.meta.env.DEV) {
        console.warn('[nebula] fullscreen listeners failed to register', error)
      }
    })
  return () => {
    cancelled = true
    disposeListeners?.()
    listenerStarted = false
    clearFullscreenResizeListener()
  }
}

/**
 * Consume the one-shot fast-handoff flag in the next browsing transition.
 * tauriSiteFullscreen and tauriBrowsingMode share this state in BrowserShell.
 */
export function consumeSiteFullscreenTabSwitchHandoff(): boolean {
  const pending =
    tabSwitchHandoffPending

  tabSwitchHandoffPending =
    false

  return pending
}

/**
 * Fast HTML5-fullscreen -> different-tab handoff.
 *
 * Do not restore/re-stack the outgoing fullscreen tab. The incoming browsing
 * transition will show main/chrome, activate the target, and establish the
 * final stack once.
 */
export function exitSiteFullscreenForTabSwitch(
  shortcutId?: string,
): Promise<boolean> {
  return enqueueFullscreenTransition(async () => {
    if (!siteFullscreenActive) {
      return false
    }

    const documentTabId =
      fullscreenTabId ??
      shortcutId ??
      null

    if (documentTabId) {
      requestDocumentFullscreenExit(
        documentTabId,
      )
    }

    clearFullscreenResizeListener()

    siteFullscreenActive = false
    fullscreenTabId = null

    try {
      await invoke(
        'window_exit_site_fullscreen',
        {
          windowLabel: currentBrowserWindowLabel(),
        },
      )
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn(
          '[nebula] fast window_exit_site_fullscreen failed',
          error,
        )
      }
    } finally {
      // Do not let the ordinary resize owner observe the intermediate native
      // fullscreen-exit geometry. The incoming browsing transition takes over
      // only after the native command has completed.
      setSiteFullscreenBoundsMode(false)
    }

    /*
     * During site fullscreen the native chrome child covers the full client.
     * Reset its physical bounds directly before it can intercept the incoming
     * page. This does not rely on ChromeApp's separate React/module state.
     */
    try {
      await forceChromeWebviewCompactBounds()
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn(
          '[nebula] compact chrome after fullscreen handoff failed',
          error,
        )
      }
    }

    setBrowsingChromeExpected(
      true,
    )

    tabSwitchHandoffPending =
      true

    /*
     * Let ChromeApp clear any preview/menu state, but do not block the tab
     * switch on a listener running in another JS context.
     */
    void emit(
      siteFullscreenExitEvent(),
    ).catch(
      () => undefined,
    )

    return true
  })
}

/** Force-exit when leaving browsing mode (home, tab close, tab switch, etc.). */
export function forceExitSiteFullscreen(
  shortcutId?: string,
): Promise<void> {
  return enqueueFullscreenTransition(async () => {
    const documentTabId =
      fullscreenTabId ??
      shortcutId ??
      null

    if (documentTabId) {
      try {
        requestDocumentFullscreenExit(
          documentTabId,
        )
      } catch (error) {
        if (import.meta.env.DEV) {
          console.warn(
            '[nebula] document fullscreen exit failed',
            error,
          )
        }
      }
    }

    if (!siteFullscreenActive) return

    await exitSiteFullscreen()
  })
}

/** Toggle Nebula's browser-window fullscreen (F11), separate from HTML5 site fullscreen. */
export function toggleBrowserWindowFullscreen(): Promise<void> {
  if (!isTauri) return Promise.resolve()

  // Serialize F11 with HTML5 fullscreen transitions. Rapid F11 -> F11 presses
  // must observe the state left by the previous transition.
  return enqueueFullscreenTransition(async () => {
    // If a page currently owns HTML5 fullscreen, the first F11 only returns
    // from document fullscreen. A second F11 toggles Nebula fullscreen.
    if (siteFullscreenActive) {
      const documentTabId = fullscreenTabId
      if (documentTabId) {
        requestDocumentFullscreenExit(documentTabId)
      }

      await exitSiteFullscreen()
      return
    }

    const appWindow = getCurrentWindow()

    // Tauri setFullscreen() leaves the taskbar visible on Nebula's
    // transparent frameless Windows window. The native command covers the
    // monitor rect and informs Explorer about fullscreen state.
    const browserFullscreenActive =
  await invoke<boolean>('window_toggle_browser_fullscreen', {
    windowLabel: currentBrowserWindowLabel(),
  })

// Native HWND geometry must settle before ChromeApp receives the F11 state.
// Otherwise Semi-Lunar can size itself against the previous client bounds
// and remain clipped until a later focus/resize resync.
await waitForWindowLayoutSettle(appWindow)

await emit(browserFullscreenChangedEvent(), {
  active: browserFullscreenActive,
})

    // Site WebViews are independent child HWNDs and must be resized after the
    // parent client area changes.
    await forceSyncActiveTabBounds()

    try {
      await ensureChromeWebviewVisible()
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn(
          '[nebula] restore chrome after browser fullscreen failed',
          error,
        )
      }
    }

    setBrowsingChromeExpected(true)

    await stackBrowsingChromeAboveBrowser(
      getActiveBrowseTabId(),
    )
  })
}
