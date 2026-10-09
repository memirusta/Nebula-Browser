interface ChromeOverlayState {
  siteInfoOpen: boolean
  privateInfoOpen: boolean
  extensionsOpen?: boolean
  tabSearchOpen: boolean
  isBrowsing: boolean
  hasZoom: boolean
  hasSensitiveUsage: boolean
}

/** Reserve native WebView height for floating panels without resizing the page. */
export function chromeOverlayMinimumHeight(state: ChromeOverlayState): number {
  if (state.siteInfoOpen || state.privateInfoOpen || state.extensionsOpen || state.tabSearchOpen) return 650
  if (!state.isBrowsing) return 0
  // The bubble keeps this room in its small form too: it grows back to full size on hover, and an
  // overlay that shrank with it cut the bubble off while it animated. The clip region (not the height)
  // is what keeps the page below clickable.
  if (state.hasZoom && state.hasSensitiveUsage) return 138
  return state.hasZoom || state.hasSensitiveUsage ? 78 : 0
}

export interface ChromeClipRect {
  x: number
  y: number
  width: number
  height: number
}

/** Tall enough for any window, so the strip still spans the window after it is resized. */
const CHROME_CLIP_STRIP_WIDTH = 32_000
/** Above this the overlay is tall for something other than the bubbles (a panel), so it is not clipped. */
const CHROME_CLIP_MAX_BUBBLE_BAND = 160

/**
 * The part of the overlay that has to draw and take input while only the collapsed strip and some
 * floating bubbles are there, or null when the whole overlay is needed (menu open, preview, a panel)
 * or nothing needs room below the strip. Everything else is left to the page underneath.
 */
export function chromeClipRegion(
  state: {
    bubbles: ChromeClipRect[]
    fullHeight: boolean
    logicalHeight: number
    minimumLogicalHeight: number
    /** The height of the collapsed menu's strip (SEMI_LUNAR_HIT_ZONE_HEIGHT). */
    stripLogicalHeight: number
  },
  scaleFactor: number,
): ChromeClipRect[] | null {
  if (
    state.bubbles.length === 0 ||
    state.fullHeight ||
    state.logicalHeight > state.stripLogicalHeight + 0.5 ||
    state.minimumLogicalHeight > CHROME_CLIP_MAX_BUBBLE_BAND ||
    !Number.isFinite(scaleFactor) || scaleFactor <= 0
  ) {
    return null
  }
  const region: ChromeClipRect[] = [
    { x: 0, y: 0, width: CHROME_CLIP_STRIP_WIDTH, height: Math.max(1, Math.ceil(state.stripLogicalHeight * scaleFactor)) },
  ]
  for (const bubble of state.bubbles) {
    if (!(bubble.width > 0) || !(bubble.height > 0)) continue
    const x = Math.floor(bubble.x * scaleFactor)
    const y = Math.floor(bubble.y * scaleFactor)
    region.push({
      x,
      y,
      width: Math.max(1, Math.ceil((bubble.x + bubble.width) * scaleFactor) - x),
      height: Math.max(1, Math.ceil((bubble.y + bubble.height) * scaleFactor) - y),
    })
  }
  return region.length > 8 ? region.slice(0, 8) : region
}
