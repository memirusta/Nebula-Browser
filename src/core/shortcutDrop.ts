import { getMinCenterDist, type ShortcutPosition } from './shortcutLayout'

export function findDropTarget(
  positions: ShortcutPosition[],
  draggedId: string,
  x: number,
  y: number,
  iconSizePx?: number,
): string | null {
  const minDist = getMinCenterDist(iconSizePx)
  let best: { id: string; dist: number } | null = null

  for (const p of positions) {
    if (p.id === draggedId) continue
    const dist = Math.hypot(p.x - x, p.y - y)
    if (dist < minDist && (!best || dist < best.dist)) {
      best = { id: p.id, dist }
    }
  }

  return best?.id ?? null
}
