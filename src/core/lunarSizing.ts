/** Grow the lunar strip slightly when many shortcuts need room on the arc. */
export function computeAdaptiveLunarSize(
  shortcutCount: number,
  baseWidth: number,
  baseHeight: number,
): { width: number; height: number } {
  if (shortcutCount <= 10) {
    return { width: baseWidth, height: baseHeight }
  }
  if (shortcutCount <= 17) {
    return {
      width: Math.min(1280, baseWidth + 100),
      height: Math.min(188, baseHeight + 22),
    }
  }
  return {
    width: Math.min(1380, baseWidth + 160),
    height: Math.min(212, baseHeight + 48),
  }
}
