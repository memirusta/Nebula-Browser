export interface TutorialRect {
  left: number
  top: number
  width: number
  height: number
  radius: number
}

/** The width of a bubble of the tour: wide enough that the words of the longest step stay a few lines short. */
export const TUTORIAL_BUBBLE_WIDTH = 380

export type TutorialSide = 'below' | 'above' | 'left' | 'right' | 'free'

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
  maxWidth = 440,
  options: { prefer?: 'below' } = {},
) {
  const margin = 16
  const gap = 18
  // The native Semi-Lunar WebView sits above this DOM surface. Reserve its
  // actual height even when the guide needs to scroll in a short window.
  const minTop = Math.max(margin, topClearance > 0 ? topClearance + gap : margin)
  const width = Math.max(0, Math.min(maxWidth, viewport.width - margin * 2))
  const maxHeight = Math.max(0, viewport.height - minTop - margin)
  const height = Math.min(measuredHeight, maxHeight)
  const clampX = (left: number) => Math.max(margin, Math.min(left, viewport.width - width - margin))
  const clampY = (top: number) => Math.max(minTop, Math.min(top, viewport.height - height - margin))
  let left = (viewport.width - width) / 2
  let top = (viewport.height - height) / 2
  // Which side of the target the card sits on, so a bubble can point at it.
  let side: TutorialSide = 'free'
  if (target) {
    left = clampX(target.left + target.width / 2 - width / 2)
    const below = Math.max(target.top + target.height, topClearance) + gap
    // Beside the target only where nothing hangs from the top of the window: a bubble to the left of the menu would land on
    // the widgets there, and its pointer would aim under the menu, not at it.
    const inLeftThird = target.left + target.width / 2 < viewport.width / 3
    if (topClearance === 0 && inLeftThird && target.left + target.width + gap + width <= viewport.width - margin) {
      // Something at the left edge of the window (the widgets): the bubble sits to its right.
      left = target.left + target.width + gap
      top = target.top + target.height / 2 - height / 2
      side = 'right'
    } else if (topClearance === 0 && options.prefer !== 'below' && target.left >= width + gap + margin) {
      left = target.left - width - gap
      top = target.top + target.height / 2 - height / 2
      side = 'left'
    } else if (below + height <= viewport.height - margin) {
      top = below
      side = 'below'
    } else if (target.top - gap - height >= margin) {
      top = target.top - gap - height
      side = 'above'
    } else {
      // A short window has no non-overlapping placement. Keep navigation visible.
      top = viewport.height - height - margin
    }
  }
  const finalLeft = clampX(left)
  const finalTop = clampY(top)
  // Where the pointer of a bubble touches it: along its top or bottom edge, or down its right edge.
  const pointer = target
    ? side === 'left' || side === 'right'
      ? target.top + target.height / 2 - finalTop
      : target.left + target.width / 2 - finalLeft
    : 0
  const extent = side === 'left' || side === 'right' ? height : width
  const arrow = Math.max(22, Math.min(pointer, extent - 22))
  return { left: finalLeft, top: finalTop, width, maxHeight, side, arrow }
}

/**
 * A bubble that points at nothing (the statement about the shield): in the lower right corner, out of the way of the others. Its
 * top does not depend on how tall it is just now (a lit bubble is taller than a dimmed one), so that it does not move.
 */
export function tutorialStatementCard(
  card: ReturnType<typeof tutorialCardPosition>,
  viewport: { width: number; height: number },
  measuredHeight: number,
) {
  const height = Math.min(Math.max(measuredHeight, 300), card.maxHeight)
  return { ...card, side: 'free' as const, left: Math.max(16, viewport.width - card.width - 24), top: Math.max(16, viewport.height - height - 24) }
}

/**
 * What a bubble must keep off when it is another step's: the target itself, except that the menu is a dome whose lower corners
 * are round, so its corners are not counted (a bubble may stand beside them).
 */
export function tutorialAvoidArea(rect: TutorialRect, dome: boolean): TutorialRect {
  if (!dome) return rect
  const inset = rect.width * 0.12
  return { ...rect, left: rect.left + inset, width: rect.width - inset * 2 }
}

export interface TutorialCardBox {
  left: number
  top: number
  width: number
  height: number
  /** What the card must not cover: the places the other steps point at. */
  avoid?: { left: number; top: number; width: number; height: number }[]
}

/**
 * True when the cards can all be on the screen at once: none lands on another (with a small gap) and none covers what another
 * step points at (a few pixels may overlap, which is only the rounded corner of a menu or the margin of a ring).
 */
export function tutorialCardsFit(cards: TutorialCardBox[], gap = 8, tolerance = 32): boolean {
  for (let first = 0; first < cards.length; first++) {
    const a = cards[first]
    for (let second = first + 1; second < cards.length; second++) {
      const b = cards[second]
      const apart = a.left + a.width + gap <= b.left || b.left + b.width + gap <= a.left ||
        a.top + a.height + gap <= b.top || b.top + b.height + gap <= a.top
      if (!apart) return false
    }
    for (const area of a.avoid ?? []) {
      const across = Math.min(a.left + a.width, area.left + area.width) - Math.max(a.left, area.left)
      const down = Math.min(a.top + a.height, area.top + area.height) - Math.max(a.top, area.top)
      if (across > tolerance && down > tolerance) return false
    }
  }
  return true
}
