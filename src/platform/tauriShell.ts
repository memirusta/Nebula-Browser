import { invoke } from '@tauri-apps/api/core'
import { browsingChromeBelowTitlePx } from '../core/windowChrome'
import { isTauri } from './runtime'
import { syncTauriBrowserBounds } from './tauriBrowser'
import { setBrowsingChromeLogicalHeight } from './browsingLayout'

export type ShellHitRegion =
  | null
  | {
      logicalTop?: number
      logicalHeight: number
      /** When set, limits horizontal hit-testing (expanded semi-lunar width). */
      logicalLeft?: number
      logicalWidth?: number
    }

/** Limit main shell webview hit-testing to a screen strip. */
export async function setShellHitRegion(region: ShellHitRegion): Promise<void> {
  if (!isTauri) return

  if (region === null) {
    await invoke('webview_set_shell_hit_region', {
      logicalTop: null,
      logicalHeight: null,
      logicalLeft: null,
      logicalWidth: null,
    })
    return
  }

  await invoke('webview_set_shell_hit_region', {
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

/** Semi-lunar chrome on main shell — frameless, no separate title-bar webview. */
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
  await syncTauriBrowserBounds()

  const horizontal =
    isExpanded && lunarWidthPx
      ? centeredLunarStrip(lunarWidthPx)
      : { logicalLeft: undefined, logicalWidth: undefined }

  await setShellHitRegion({
    logicalTop: 0,
    logicalHeight: lunarStrip,
    ...horizontal,
  })

  try {
    await invoke('webview_raise_ui')
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[nebula] webview_raise_ui failed', error)
    }
  }
}

export async function resetBrowsingChromeLayout(): Promise<void> {
  if (!isTauri) return
  await setShellHitRegion(null)
  await syncTauriBrowserBounds()
}

/** Grow the main shell clip strip so floating UI (context menus) is not cut off. */
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

  await setShellHitRegion({
    logicalTop: 0,
    logicalHeight: needed,
    ...horizontal,
  })
}
