import { listen, emit } from '@tauri-apps/api/event'
import type { Window } from '@tauri-apps/api/window'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { invoke } from '@tauri-apps/api/core'
import { tabWebviewLabel } from '../core/browserTab'
import { isTauri } from './runtime'
import {
  setSiteFullscreenBoundsMode,
  syncTabWebviewFullscreenBounds,
  forceSyncActiveTabBounds,
} from './tauriBrowser'
import { hideMainWebview, showMainWebview } from './tauriMainWebview'
import {
  cancelScheduledStack,
  setBrowsingChromeExpected,
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

function shortcutIdFromLabel(label: string): string | null {
  if (!label.startsWith('nebula-tab-')) return null
  return label.slice('nebula-tab-'.length)
}

function enqueueFullscreenTransition(task: () => Promise<void>): Promise<void> {
  const run = transitionChain.then(task, task)
  transitionChain = run.catch(() => {})
  return run
}

export function isSiteFullscreenActive(): boolean {
  return siteFullscreenActive
}

async function waitForWindowLayoutSettle(appWindow: Window): Promise<void> {
  await new Promise<void>((resolve) => {
    let unlisten: (() => void) | undefined
    const timeout = setTimeout(() => {
      unlisten?.()
      resolve()
    }, 400)

    void appWindow.onResized(() => {
      clearTimeout(timeout)
      unlisten?.()
      resolve()
    }).then((dispose) => {
      unlisten = dispose
    })
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
      await invoke('webview_set_shell_hit_region', {
        logicalTop: null,
        logicalHeight: null,
        logicalLeft: null,
        logicalWidth: null,
      })
    } catch {
      // ignore
    }

    try {
      await invoke('window_enter_site_fullscreen')
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('[nebula] window_enter_site_fullscreen failed', error)
      }
    }

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

  setBrowsingChromeExpected(true)
  await forceSyncActiveTabBounds()
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

  void listen<TabFullscreenPayload>('nebula-tab-fullscreen', (event) => {
    void enqueueFullscreenTransition(() => handleTabFullscreenPayload(event.payload))
  }).then((dispose) => {
    if (cancelled) {
      dispose()
      return
    }
    unlisten = dispose
  })

  return () => {
    cancelled = true
    unlisten?.()
    listenerStarted = false
    clearFullscreenResizeListener()
  }
}

/** Force-exit when leaving browsing mode (home, tab close, tab switch, etc.). */
export function forceExitSiteFullscreen(): Promise<void> {
  return enqueueFullscreenTransition(async () => {
    if (!siteFullscreenActive) return
    await exitSiteFullscreen()
  })
}

export function tabLabelForShortcut(shortcutId: string): string {
  return tabWebviewLabel(shortcutId)
}
