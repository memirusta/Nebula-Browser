export interface TutorialRect {
  left: number
  top: number
  width: number
  height: number
  radius: number
}

export function tutorialStepIndex(step: number, count: number): number {
  return Number.isFinite(step) ? Math.max(0, Math.min(count - 1, Math.trunc(step))) : 0
}

/** Clip a real target to the viewport; fully hidden targets have no spotlight. */
export function clipTutorialTarget(rect: TutorialRect, width: number, height: number): TutorialRect | null {
  const left = Math.max(0, rect.left)
  const top = Math.max(0, rect.top)
  const right = Math.min(width, rect.left + rect.width)
  const bottom = Math.min(height, rect.top + rect.height)
  return right > left && bottom > top
    ? { ...rect, left, top, width: right - left, height: bottom - top }
    : null
}

export function tutorialCardPosition(
  target: TutorialRect | null,
  viewport: { width: number; height: number },
  measuredHeight: number,
  topClearance = 0,
) {
  const margin = 16
  const gap = 18
  // The native Semi-Lunar WebView sits above this DOM surface. Reserve its
  // actual height even when the guide needs to scroll in a short window.
  const minTop = Math.max(margin, topClearance > 0 ? topClearance + gap : margin)
  const width = Math.max(0, Math.min(440, viewport.width - margin * 2))
  const maxHeight = Math.max(0, viewport.height - minTop - margin)
  const height = Math.min(measuredHeight, maxHeight)
  const clampX = (left: number) => Math.max(margin, Math.min(left, viewport.width - width - margin))
  const clampY = (top: number) => Math.max(minTop, Math.min(top, viewport.height - height - margin))
  let left = (viewport.width - width) / 2
  let top = (viewport.height - height) / 2
  if (target) {
    left = clampX(target.left + target.width / 2 - width / 2)
    const below = Math.max(target.top + target.height, topClearance) + gap
    if (target.left >= width + gap + margin) {
      left = target.left - width - gap
      top = target.top + target.height / 2 - height / 2
    } else if (below + height <= viewport.height - margin) {
      top = below
    } else if (target.top - gap - height >= margin) {
      top = target.top - gap - height
    } else {
      // A short window has no non-overlapping placement. Keep navigation visible.
      top = viewport.height - height - margin
    }
  }
  return { left: clampX(left), top: clampY(top), width, maxHeight }
}
