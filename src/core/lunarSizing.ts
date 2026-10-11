const ADAPTIVE_LUNAR_BASE_CAPACITY = 10
const ADAPTIVE_LUNAR_WIDTH_PER_SHORTCUT = 8
const ADAPTIVE_LUNAR_HEIGHT_PER_SHORTCUT = 6
const ADAPTIVE_LUNAR_MAX_WIDTH = 1780
const ADAPTIVE_LUNAR_MAX_HEIGHT = 720
const MAX_VIEWPORT_LUNAR_HEIGHT_RATIO = 0.72
/** A client area smaller than this is a window being minimized or restored, not one to size the dome for. */
const MIN_USABLE_VIEWPORT_WIDTH = 256
const MIN_USABLE_VIEWPORT_HEIGHT = 160

/**
 * Whether a client size can be used to fit the dome. A minimized window reports 0x0 and a window being
 * restored passes through small sizes; fitting the dome to those leaves it tiny until another size arrives.
 */
export function isUsableLunarViewport(width: number, height: number): boolean {
  return (
    Number.isFinite(width) && Number.isFinite(height) &&
    width >= MIN_USABLE_VIEWPORT_WIDTH && height >= MIN_USABLE_VIEWPORT_HEIGHT
  )
}

/**
 * Fit the configured/adaptive Semi-Lunar into the current client area.
 *
 * On a wide window the requested dimensions stay unchanged. Narrow windows
 * shrink the dome proportionally, while very short windows cap its height so
 * the controls remain reachable.
 */
export function computeViewportLunarSize(
  viewportWidth: number,
  viewportHeight: number,
  preferredWidth: number,
  preferredHeight: number,
): { width: number; height: number } {
  const safeViewportWidth = Number.isFinite(viewportWidth)
    ? Math.max(1, Math.floor(viewportWidth))
    : Math.max(1, Math.floor(preferredWidth))
  const safeViewportHeight = Number.isFinite(viewportHeight)
    ? Math.max(1, Math.floor(viewportHeight))
    : Math.max(1, Math.floor(preferredHeight))
  const safePreferredWidth = Math.max(1, preferredWidth)
  const safePreferredHeight = Math.max(1, preferredHeight)
  const width = Math.min(safeViewportWidth, safePreferredWidth)
  const scaledHeight = Math.round(
    width * (safePreferredHeight / safePreferredWidth),
  )
  const maxHeight = Math.max(1, Math.floor(safeViewportHeight * MAX_VIEWPORT_LUNAR_HEIGHT_RATIO))

  return {
    width,
    height: Math.min(maxHeight, Math.max(1, scaledHeight)),
  }
}

/**
 * Grow the lunar strip continuously once the first compact row is full.
 * Height grows more aggressively than before so large tab sessions gain real
 * placement area instead of piling every extra shortcut onto the same arc.
 */
export function computeAdaptiveLunarSize(
  shortcutCount: number,
  baseWidth: number,
  baseHeight: number,
): { width: number; height: number } {
  const normalizedCount = Number.isFinite(shortcutCount)
    ? Math.max(0, Math.floor(shortcutCount))
    : 0
  const overflow = Math.max(0, normalizedCount - ADAPTIVE_LUNAR_BASE_CAPACITY)

  if (overflow === 0) {
    return { width: baseWidth, height: baseHeight }
  }

  return {
    width: Math.min(
      Math.max(ADAPTIVE_LUNAR_MAX_WIDTH, baseWidth),
      baseWidth + overflow * ADAPTIVE_LUNAR_WIDTH_PER_SHORTCUT,
    ),
    height: Math.min(
      ADAPTIVE_LUNAR_MAX_HEIGHT,
      baseHeight + overflow * ADAPTIVE_LUNAR_HEIGHT_PER_SHORTCUT,
    ),
  }
}
