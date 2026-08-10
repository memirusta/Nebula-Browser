import { isChromeShell } from '../core/nebulaBridge'
import { browsingChromeBelowTitlePx } from '../core/windowChrome'
import { isTauri } from './runtime'
import { setChromeOverlayLogicalBounds } from './tauriChromeWebview'

/** Keep Semi-Lunar's dedicated native overlay sized to its current content. */
export async function syncChromeShellLayout(
  isExpanded: boolean,
  lunarHeightPx: number,
  folderOpen: boolean,
  _previewActive = false,
  lunarWidthPx?: number,
): Promise<void> {
  if (!isTauri || !isChromeShell()) return

  const lunarStrip = browsingChromeBelowTitlePx(isExpanded, lunarHeightPx, folderOpen)
  await setChromeOverlayLogicalBounds(lunarStrip, lunarWidthPx)
}

/** Grow only the chrome overlay so floating UI is not cut off. */
export async function expandShellHitRegionToFitBottom(
  bottomLogicalPx: number,
  isExpanded: boolean,
  lunarHeightPx: number,
  folderOpen: boolean,
  lunarWidthPx?: number,
): Promise<void> {
  if (!isTauri || !isChromeShell()) return

  const baseStrip = browsingChromeBelowTitlePx(isExpanded, lunarHeightPx, folderOpen)
  const needed = Math.max(baseStrip, bottomLogicalPx + 8)
  await setChromeOverlayLogicalBounds(needed, lunarWidthPx)
}
