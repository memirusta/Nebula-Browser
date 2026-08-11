import { listen, emit } from '@tauri-apps/api/event'
import type { Window } from '@tauri-apps/api/window'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { invoke } from '@tauri-apps/api/core'
import {
  shortcutIdForTabWebviewLabel,
  tabWebviewLabel,
} from '../core/browserTab'
import { isTauri } from './runtime'
import {
  setSiteFullscreenBoundsMode,
  syncTabWebviewFullscreenBounds,
  forceSyncActiveTabBounds,
} from './tauriBrowser'
import { hideMainWebview, showMainWebview } from './tauriMainWebview'
import {
  ensureChromeWebviewVisible,
  forceChromeWebviewCompactBounds,
  getChromeWebview,
  syncChromeWebviewBounds,
} from './tauriChromeWebview'
import {
  cancelScheduledStack,
  setBrowsingChromeExpected,
  stackBrowsingChromeAboveBrowser,
} from './tauriWebviewStack'

export const SITE_FULLSCREEN_EXIT_EVENT = 'nebula-site-fullscreen-exit'

interface TabFullscreenPayload {
  label: string
  is_fullscreen: boolean
}

let siteFullscreenActive = false
let fullscreenTabId: string | null = null
let listenerStarted = false
let fullscreenResizeUnlisten: (() => void) | undefined
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
}

function resetSiteFullscreenState(): void {
  siteFullscreenActive = false
  fullscreenTabId = null
  setSiteFullscreenBoundsMode(false)
  clearFullscreenResizeListener()
}

async function enterSiteFullscreen(shortcutId: string): Promise<void> {
  if (siteFullscreenActive) {
    if (fullscreenTabId === shortcutId) {
      await syncTabWebviewFullscreenBounds(shortcutId)
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
    await invoke('window_enter_site_fullscreen')

    await waitForWindowLayoutSettle(appWindow)
    await syncTabWebviewFullscreenBounds(shortcutId)

    void appWindow.onResized(() => {
      if (!siteFullscreenActive || fullscreenTabId !== shortcutId) return
      void syncTabWebviewFullscreenBounds(shortcutId)
    }).then((unlisten) => {
      if (!siteFullscreenActive || fullscreenTabId !== shortcutId) {
        unlisten()
        return
      }
      fullscreenResizeUnlisten = unlisten
    })
  } catch (error) {
    resetSiteFullscreenState()
    setBrowsingChromeExpected(true)
    try {
      await invoke('window_exit_site_fullscreen')
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
  clearFullscreenResizeListener()

  siteFullscreenActive = false
  fullscreenTabId = null
  setSiteFullscreenBoundsMode(false)

  try {
    await invoke('window_exit_site_fullscreen')
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[nebula] window_exit_site_fullscreen failed', error)
    }
  }

  await waitForWindowLayoutSettle(appWindow)

  try {
    await invoke('webview_restore_browsing_layout')
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[nebula] webview_restore_browsing_layout failed', error)
    }
  }

  try {
    await showMainWebview()
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[nebula] showMainWebview after site fullscreen failed', error)
    }
  }

  try {
    await ensureChromeWebviewVisible()
    await syncChromeWebviewBounds()
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[nebula] restore chrome after site fullscreen failed', error)
    }
  }

  setBrowsingChromeExpected(true)
  await forceSyncActiveTabBounds()
  await stackBrowsingChromeAboveBrowser(returningTabId)
  await emit(SITE_FULLSCREEN_EXIT_EVENT)
}

async function handleTabFullscreenPayload(payload: TabFullscreenPayload): Promise<void> {
  const shortcutId = shortcutIdFromLabel(payload.label)
  if (!shortcutId) return

  if (payload.is_fullscreen) {
    await enterSiteFullscreen(shortcutId)
    return
  }

  if (fullscreenTabId && fullscreenTabId !== shortcutId) return
  await exitSiteFullscreen()
}

export function initSiteFullscreenBridge(): () => void {
  if (!isTauri || listenerStarted) {
    return () => {}
  }

  listenerStarted = true
  let unlisten: (() => void) | undefined
  let cancelled = false
  let focusUnlisten: (() => void) | undefined

  void listen<TabFullscreenPayload>('nebula-tab-fullscreen', (event) => {
    void enqueueFullscreenTransition(() => handleTabFullscreenPayload(event.payload))
  }).then((dispose) => {
    if (cancelled) {
      dispose()
      return
    }
    unlisten = dispose
  })

  /*
   * Leaving Nebula while a page owns HTML5 fullscreen should restore normal
   * browsing. This covers Windows Alt+Tab without installing a global key hook.
   */
  void getCurrentWindow()
    .onFocusChanged(
      ({
        payload:
          focused,
      }) => {
        if (
          focused ||
          !siteFullscreenActive
        ) {
          return
        }

        void forceExitSiteFullscreen()
          .catch(
            () => undefined,
          )
      },
    )
    .then(
      (dispose) => {
        if (cancelled) {
          dispose()
          return
        }

        focusUnlisten =
          dispose
      },
    )
  return () => {
    cancelled = true
    unlisten?.()
    focusUnlisten?.()
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

    siteFullscreenActive =
      false
    fullscreenTabId =
      null

    setSiteFullscreenBoundsMode(
      false,
    )

    try {
      await invoke(
        'window_exit_site_fullscreen',
      )
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn(
          '[nebula] fast window_exit_site_fullscreen failed',
          error,
        )
      }
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
      SITE_FULLSCREEN_EXIT_EVENT,
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
export async function toggleBrowserWindowFullscreen(): Promise<void> {
  if (!isTauri) return

  // If a page currently owns HTML5 fullscreen, F11 first returns to normal
  // browsing. A second F11 can then enter browser-window fullscreen.
  if (siteFullscreenActive) {
    await forceExitSiteFullscreen()
    return
  }

  const appWindow = getCurrentWindow()
  const fullscreen = await appWindow.isFullscreen()
  await appWindow.setFullscreen(!fullscreen)
  await waitForWindowLayoutSettle(appWindow)

  // Child webviews have their own physical bounds. Repair them after the host
  // window changes mode instead of relying on a compositor race.
  await forceSyncActiveTabBounds()

  try {
    await syncChromeWebviewBounds()
  } catch {
    // Chrome may not exist on first Home paint.
  }
}
