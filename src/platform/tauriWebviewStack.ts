import { invoke } from '@tauri-apps/api/core'
import { tabWebviewLabel } from '../core/browserTab'
import { isTauri } from './runtime'

let stackTimer: ReturnType<typeof setTimeout> | null = null
let browsingChromeExpected = false
let overlayModeActive = false

export function setOverlayModeActive(active: boolean): void {
  overlayModeActive = active
}

export function setBrowsingChromeExpected(expected: boolean): void {
  browsingChromeExpected = expected
}

/** Coalesce rapid z-order fixes so scroll/input is not interrupted. */
export function scheduleStackBrowsingChromeAboveBrowser(
  activeTabId?: string | null,
  delayMs = 250,
): void {
  if (!isTauri) return
  if (stackTimer) return

  stackTimer = setTimeout(() => {
    stackTimer = null
    void stackBrowsingChromeAboveBrowser(activeTabId)
  }, delayMs)
}

export function cancelScheduledStack(): void {
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
      await invoke('webview_raise_overlay')
      return
    }

    await invoke('webview_raise_chrome', {
      activeTabLabel: activeTabId ? tabWebviewLabel(activeTabId) : null,
    })
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[nebula] stackBrowsingChromeAboveBrowser failed', error)
    }
  }
}
