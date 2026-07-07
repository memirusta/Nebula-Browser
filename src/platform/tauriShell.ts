import { invoke } from '@tauri-apps/api/core'
import { TITLE_BAR_HEIGHT, browsingChromeBelowTitlePx } from '../core/windowChrome'
import { isTauri } from './runtime'
import { getActiveBrowseTabId, syncTauriBrowserBounds } from './tauriBrowser'
import { setChromeWebviewHeight, syncChromeWebviewBounds } from './tauriChromeWebview'
import { setBrowsingChromeLogicalHeight } from './browsingLayout'
import { stackBrowsingChromeAboveBrowser } from './tauriWebviewStack'

export type ShellHitRegion =
  | null
  | { logicalTop?: number; logicalHeight: number }

/** Limit main shell webview hit-testing to a screen strip. */
export async function setShellHitRegion(region: ShellHitRegion): Promise<void> {
  if (!isTauri) return

  if (region === null) {
    await invoke('webview_set_shell_hit_region', {
      logicalTop: null,
      logicalHeight: null,
    })
    return
  }

  await invoke('webview_set_shell_hit_region', {
    logicalTop: region.logicalTop ?? 0,
    logicalHeight: region.logicalHeight,
  })
}

/** Title bar chrome + semi-lunar on main shell (web-like overlay). */
export async function syncChromeShellLayout(
  isExpanded: boolean,
  lunarHeightPx: number,
  folderOpen: boolean,
  _previewActive = false,
): Promise<void> {
  if (!isTauri) return

  const lunarStrip = browsingChromeBelowTitlePx(
    isExpanded,
    lunarHeightPx,
    folderOpen,
  )

  setBrowsingChromeLogicalHeight(TITLE_BAR_HEIGHT)
  setChromeWebviewHeight(TITLE_BAR_HEIGHT)
  await syncChromeWebviewBounds()
  await invoke('webview_set_chrome_hit_region', { logicalHeight: TITLE_BAR_HEIGHT })

  await syncTauriBrowserBounds()

  await setShellHitRegion({
    logicalTop: TITLE_BAR_HEIGHT,
    logicalHeight: lunarStrip,
  })
  await stackBrowsingChromeAboveBrowser(getActiveBrowseTabId())
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
): Promise<void> {
  if (!isTauri) return

  const baseStrip = browsingChromeBelowTitlePx(
    isExpanded,
    lunarHeightPx,
    folderOpen,
  )
  const needed = Math.max(baseStrip, bottomLogicalPx - TITLE_BAR_HEIGHT + 8)
  await setShellHitRegion({ logicalTop: TITLE_BAR_HEIGHT, logicalHeight: needed })
}
