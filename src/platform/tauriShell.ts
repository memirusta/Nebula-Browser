import { invoke } from '@tauri-apps/api/core'
import { isChromeShell } from '../core/nebulaBridge'
import { browsingChromeBelowTitlePx } from '../core/windowChrome'
import { isTauri } from './runtime'
import { syncTauriBrowserBounds } from './tauriBrowser'
import { setBrowsingChromeLogicalHeight } from './browsingLayout'
import { setChromeOverlayLogicalBounds } from './tauriChromeWebview'

export type ShellHitRegion =
  | null
  | {
      logicalTop?: number
      logicalHeight: number
      /** When set, limits horizontal hit-testing (expanded semi-lunar width). */
      logicalLeft?: number
      logicalWidth?: number
    }

/**
 * Route the interactive region to the surface that actually owns Semi-Lunar.
 * In the dedicated chrome architecture this clips only nebula-chrome, never
 * the full-screen Home/main WebView underneath the browser.
 */
export async function setShellHitRegion(region: ShellHitRegion): Promise<void> {
  if (!isTauri) return

  const command = isChromeShell()
    ? 'webview_set_chrome_hit_region'
    : 'webview_set_shell_hit_region'

  if (region === null) {
    await invoke(command, {
      logicalTop: null,
      logicalHeight: null,
      logicalLeft: null,
      logicalWidth: null,
    })
    return
  }

  await invoke(command, {
    logicalTop: region.logicalTop ?? 0,
    logicalHeight: region.logicalHeight,
    logicalLeft: region.logicalLeft ?? null,
    logicalWidth: region.logicalWidth ?? null,
  })
}

function centeredLunarStrip(
  lunarWidthPx: number,
): { logicalLeft: number; logicalWidth: number } {
  const logicalWidth = Math.min(lunarWidthPx, window.innerWidth * 0.98)
  const logicalLeft = Math.max(0, (window.innerWidth - logicalWidth) / 2)
  return { logicalLeft, logicalWidth }
}

/** Keep Semi-Lunar's dedicated native overlay sized to its current content. */
export async function syncChromeShellLayout(
  isExpanded: boolean,
  lunarHeightPx: number,
  folderOpen: boolean,
  _previewActive = false,
  lunarWidthPx?: number,
): Promise<void> {
  if (!isTauri) return

  const lunarStrip = browsingChromeBelowTitlePx(isExpanded, lunarHeightPx, folderOpen)
  setBrowsingChromeLogicalHeight(lunarStrip)

  const horizontal =
    isExpanded && lunarWidthPx
      ? centeredLunarStrip(lunarWidthPx)
      : { logicalLeft: undefined, logicalWidth: undefined }

  if (isChromeShell()) {
    // No native clipping and no click-through tricks: the dedicated Chrome
    // WebView is physically only as large as Semi-Lunar. Home/browser remain
    // full-client siblings underneath, so this overlay cannot push them down
    // and cannot swallow input outside its own bounds.
    await setChromeOverlayLogicalBounds(lunarStrip, lunarWidthPx)
    return
  }

  // Legacy/non-dedicated path retained for web/dev fallback.
  await syncTauriBrowserBounds()
  await setShellHitRegion({
    logicalTop: 0,
    logicalHeight: lunarStrip,
    ...horizontal,
  })
}

export async function resetBrowsingChromeLayout(): Promise<void> {
  if (!isTauri) return

  if (isChromeShell()) {
    return
  }

  await setShellHitRegion(null)
  await syncTauriBrowserBounds()
}

/** Grow only the chrome overlay so floating UI is not cut off. */
export async function expandShellHitRegionToFitBottom(
  bottomLogicalPx: number,
  isExpanded: boolean,
  lunarHeightPx: number,
  folderOpen: boolean,
  lunarWidthPx?: number,
): Promise<void> {
  if (!isTauri) return

  const baseStrip = browsingChromeBelowTitlePx(isExpanded, lunarHeightPx, folderOpen)
  const needed = Math.max(baseStrip, bottomLogicalPx + 8)
  const horizontal =
    isExpanded && lunarWidthPx
      ? centeredLunarStrip(lunarWidthPx)
      : { logicalLeft: undefined, logicalWidth: undefined }

  if (isChromeShell()) {
    await setChromeOverlayLogicalBounds(needed, lunarWidthPx)
    return
  }

  await setShellHitRegion({
    logicalTop: 0,
    logicalHeight: needed,
    ...horizontal,
  })
}
