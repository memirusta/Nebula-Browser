const ADAPTIVE_LUNAR_BASE_CAPACITY = 10
const ADAPTIVE_LUNAR_WIDTH_PER_SHORTCUT = 8
const ADAPTIVE_LUNAR_HEIGHT_PER_SHORTCUT = 6
const ADAPTIVE_LUNAR_MAX_WIDTH = 1780
const ADAPTIVE_LUNAR_MAX_HEIGHT = 720

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
      ADAPTIVE_LUNAR_MAX_WIDTH,
      baseWidth + overflow * ADAPTIVE_LUNAR_WIDTH_PER_SHORTCUT,
    ),
    height: Math.min(
      ADAPTIVE_LUNAR_MAX_HEIGHT,
      baseHeight + overflow * ADAPTIVE_LUNAR_HEIGHT_PER_SHORTCUT,
    ),
  }
}
