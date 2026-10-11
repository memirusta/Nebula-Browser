import type { InstalledExtension } from '../platform/extensionDownload'

export type ExtensionTileAction = 'click' | 'popup' | 'side-panel' | 'options'

/**
 * What clicking an extension's icon does, as the toolbar icon does in Chrome:
 * its popup, else its side panel, else the emulated toolbar click, else its
 * options page. A disabled extension, or one with nothing to open, has no
 * primary action (its tile opens the details instead).
 */
export function primaryExtensionAction(
  item: Pick<InstalledExtension, 'enabled' | 'primaryView' | 'needsActionHost' | 'hasSidePanel' | 'hasOptions'>,
): ExtensionTileAction | null {
  if (!item.enabled) return null
  if (item.primaryView) return item.primaryView
  if (item.needsActionHost) return 'click'
  if (item.hasSidePanel) return 'side-panel'
  if (item.hasOptions) return 'options'
  return null
}

export const TILE_WIDTH = 36
export const TILE_GAP = 4
const PANEL_PADDING = 8
const MIN_PANEL_WIDTH = 150
const DETAILS_PANEL_WIDTH = 280
const MAX_COLUMNS = 6
const VIEWPORT_MARGIN = 12

/** One column per extension up to a limit; after that the box grows downward. */
export function panelColumns(count: number): number {
  return Math.min(MAX_COLUMNS, Math.max(1, count))
}

/**
 * A tiny box of logos that widens as extensions are added. It is never narrower
 * than its header buttons need, and is as wide as the text of the details while
 * those are open.
 */
export function panelWidth(count: number, detailsOpen = false): number {
  const columns = panelColumns(count)
  const logos = columns * TILE_WIDTH + (columns - 1) * TILE_GAP + PANEL_PADDING * 2
  return Math.max(MIN_PANEL_WIDTH, logos, detailsOpen ? DETAILS_PANEL_WIDTH : 0)
}

/**
 * Left edge of the box: under its button, kept inside the window. Without an
 * anchor (button not found) it is centred.
 */
export function panelLeft(anchorLeft: number | null, width: number, viewportWidth: number): number {
  const maximum = Math.max(VIEWPORT_MARGIN, viewportWidth - width - VIEWPORT_MARGIN)
  if (anchorLeft === null) return Math.round(Math.max(VIEWPORT_MARGIN, (viewportWidth - width) / 2))
  return Math.round(Math.min(Math.max(anchorLeft, VIEWPORT_MARGIN), maximum))
}
