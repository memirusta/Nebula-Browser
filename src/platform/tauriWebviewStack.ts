import { invoke } from '@tauri-apps/api/core'
import { tabWebviewLabel } from '../core/browserTab'
import { isTauri } from './runtime'
import { currentBrowserWindowLabel } from './browserWindowScope'

let stackTimer: ReturnType<typeof setTimeout> | null = null
let pendingStackActiveTabId: string | null = null
let browsingChromeExpected = false
let overlayModeActive = false

export function setOverlayModeActive(active: boolean): void {
  overlayModeActive = active
}

export function setBrowsingChromeExpected(expected: boolean): void {
  browsingChromeExpected = expected
}

/**
 * Coalesce rapid z-order fixes so scroll/input is not interrupted.
 *
 * Always retain the newest active-tab request. Keeping the first tab id while
 * a timer is pending is unsafe during a cross-window transfer: that tab may be
 * reparented before the timer fires, letting the old source window restack a
 * WebView that now belongs to another window.
 */
export function scheduleStackBrowsingChromeAboveBrowser(
  activeTabId?: string | null,
  delayMs = 250,
): void {
  if (!isTauri) return

  pendingStackActiveTabId = activeTabId ?? null
  if (stackTimer) return

  stackTimer = setTimeout(() => {
    stackTimer = null
    const latestActiveTabId = pendingStackActiveTabId
    pendingStackActiveTabId = null
    void stackBrowsingChromeAboveBrowser(latestActiveTabId)
  }, delayMs)
}

export function cancelScheduledStack(): void {
  pendingStackActiveTabId = null
  if (!stackTimer) return
  clearTimeout(stackTimer)
  stackTimer = null
}

/**
 * Dedicated browsing stack: Home/main at bottom, active browser in the middle,
 * nebula-chrome (Semi-Lunar) at the top.
 */
export async function stackBrowsingChromeAboveBrowser(
  activeTabId?: string | null,
): Promise<void> {
  if (!isTauri || !browsingChromeExpected) return

  try {
    if (overlayModeActive) {
      await invoke('webview_raise_overlay', {
        windowLabel: currentBrowserWindowLabel(),
      })
      return
    }

    await invoke('webview_raise_chrome', {
      windowLabel: currentBrowserWindowLabel(),
      activeTabLabel: activeTabId ? tabWebviewLabel(activeTabId) : null,
    })
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[nebula] stackBrowsingChromeAboveBrowser failed', error)
    }
  }
}
