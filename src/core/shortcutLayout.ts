import {
  clampToLunarDome,
  createLunarMetrics,
  DEFAULT_LUNAR_METRICS,
  pointOnLunarEllipse,
  type LunarMetrics,
} from './lunarShape'

export const ICON_SIZE = 44
export const ICON_GAP = 10
export const MIN_CENTER_DIST = ICON_SIZE + ICON_GAP
export const DRAG_THRESHOLD = 4
export const SHORTCUT_POSITIONS_KEY = 'nebula-shortcut-positions-v10'

export interface ShortcutPosition {
  id: string
  x: number
  y: number
}

export interface ShortcutPositionsSnapshot {
  lunarWidth: number
  lunarHeight: number
  positions: ShortcutPosition[]
}

export function createShortcutPositionsSnapshot(
  positions: ShortcutPosition[],
  metrics: LunarMetrics,
): ShortcutPositionsSnapshot {
  return { lunarWidth: metrics.w, lunarHeight: metrics.h, positions }
}

export function parseShortcutPositionsSnapshot(
  raw: unknown,
  fallbackMetrics: LunarMetrics,
): { positions: ShortcutPosition[]; lunarWidth: number; lunarHeight: number } {
  if (!raw) {
    return { positions: [], lunarWidth: fallbackMetrics.w, lunarHeight: fallbackMetrics.h }
  }
  if (Array.isArray(raw)) {
    return {
      positions: raw as ShortcutPosition[],
      lunarWidth: fallbackMetrics.w,
      lunarHeight: fallbackMetrics.h,
    }
  }
  const snap = raw as ShortcutPositionsSnapshot
  return {
    positions: snap.positions ?? [],
    lunarWidth: snap.lunarWidth ?? fallbackMetrics.w,
    lunarHeight: snap.lunarHeight ?? fallbackMetrics.h,
  }
}

/** Rescale stored px coordinates when the lunar strip grows or shrinks. */
export function scalePositionsToMetrics(
  positions: ShortcutPosition[],
  fromWidth: number,
  fromHeight: number,
  toMetrics: LunarMetrics,
): ShortcutPosition[] {
  if (positions.length === 0) return positions
  const from = createLunarMetrics(fromWidth, fromHeight)
  if (from.w === toMetrics.w && from.h === toMetrics.h) return positions

  const sx = toMetrics.w / from.w
  const sy = toMetrics.h / from.h
  return positions.map((p) => ({
    id: p.id,
    x: toMetrics.cx + (p.x - from.cx) * sx,
    y: toMetrics.cy + (p.y - from.cy) * sy,
  }))
}

type RowSpec = { count: number; inset: number; yBias: number }

function layoutRow(
  shortcutIds: string[],
  startIdx: number,
  row: RowSpec,
  metrics: LunarMetrics,
): ShortcutPosition[] {
  const positions: ShortcutPosition[] = []
  for (let i = 0; i < row.count; i++) {
    const t = row.count <= 1 ? 0.5 : 0.04 + (0.92 * i) / (row.count - 1)
    const p = pointOnLunarEllipse(t, row.inset, metrics)
    positions.push({
      id: shortcutIds[startIdx + i],
      x: p.x,
      y: p.y + row.yBias,
    })
  }
  return positions
}

export function buildDefaultPositions(
  shortcutIds: string[],
  metrics: LunarMetrics = DEFAULT_LUNAR_METRICS,
  iconSizePx: number = ICON_SIZE,
): ShortcutPosition[] {
  const n = shortcutIds.length
  const row1Count = Math.min(7, n)
  const row2Count = Math.min(8, Math.max(0, n - row1Count))
  const row3Count = Math.max(0, n - row1Count - row2Count)

  const rows: RowSpec[] = [
    { count: row1Count, inset: 1, yBias: 4 },
    { count: row2Count, inset: 0.9, yBias: 12 },
    { count: row3Count, inset: 0.78, yBias: 22 },
  ]

  let idx = 0
  const positions: ShortcutPosition[] = []
  for (const row of rows) {
    if (row.count === 0) continue
    positions.push(...layoutRow(shortcutIds, idx, row, metrics))
    idx += row.count
  }

  return positions.map((p) => {
    const c = clampToBounds(p.x, p.y, iconSizePx, metrics)
    return { ...p, ...c }
  })
}

function centerSpawnPosition(
  metrics: LunarMetrics,
  iconSizePx: number = ICON_SIZE,
): { x: number; y: number } {
  const p = pointOnLunarEllipse(0.5, 1, metrics)
  return clampToBounds(p.x, p.y + 4, iconSizePx, metrics)
}

function collidesAt(
  x: number,
  y: number,
  existing: ShortcutPosition[],
  excludeId: string,
  iconSizePx: number,
): boolean {
  const minDist = getMinCenterDist(iconSizePx)
  return existing.some((o) => {
    if (o.id === excludeId) return false
    return Math.hypot(x - o.x, y - o.y) < minDist - 1
  })
}

/** Find the center spawn, or the nearest free slot alternating right / left. */
function findVacantNearCenter(
  existing: ShortcutPosition[],
  id: string,
  iconSizePx: number,
  metrics: LunarMetrics,
): { x: number; y: number } {
  const spawn = centerSpawnPosition(metrics, iconSizePx)

  const tryAt = (x: number, y: number) => {
    const c = clampToBounds(x, y, iconSizePx, metrics)
    return collidesAt(c.x, c.y, existing, id, iconSizePx) ? null : c
  }

  const atCenter = tryAt(spawn.x, spawn.y)
  if (atCenter) return atCenter

  const step = getMinCenterDist(iconSizePx)
  for (let ring = 1; ring <= 24; ring++) {
    const offset = ring * step
    const right = tryAt(spawn.x + offset, spawn.y)
    if (right) return right
    const left = tryAt(spawn.x - offset, spawn.y)
    if (left) return left
  }

  return spawn
}

function fixOverlappingPositions(
  positions: ShortcutPosition[],
  iconSizePx: number,
  metrics: LunarMetrics,
): ShortcutPosition[] {
  const result = positions.map((p) => ({ ...p }))
  const minDist = getMinCenterDist(iconSizePx)

  for (let i = 0; i < result.length; i++) {
    const current = result[i]
    const prior = result.slice(0, i)
    const overlaps = prior.some(
      (o) => Math.hypot(current.x - o.x, current.y - o.y) < minDist - 1,
    )
    if (!overlaps) continue

    const vacant = findVacantNearCenter(prior, current.id, iconSizePx, metrics)
    current.x = vacant.x
    current.y = vacant.y
  }

  return result
}

/** Place shortcuts: keep stored positions; new items spawn at center then shift aside if taken. */
export function mergeShortcutPositions(
  shortcutIds: string[],
  stored: ShortcutPosition[],
  iconSizePx: number = ICON_SIZE,
  metrics: LunarMetrics = DEFAULT_LUNAR_METRICS,
): ShortcutPosition[] {
  if (shortcutIds.length === 0) return []

  const storedById = new Map(stored.map((p) => [p.id, p]))
  const newIds = shortcutIds.filter((id) => !storedById.has(id))

  if (newIds.length === 0) {
    const kept = shortcutIds.map((id) => {
      const saved = storedById.get(id)!
      return { id, ...clampToBounds(saved.x, saved.y, iconSizePx, metrics) }
    })
    return fixOverlappingPositions(kept, iconSizePx, metrics)
  }

  if (stored.length === 0) {
    return buildDefaultPositions(shortcutIds, metrics)
  }

  const placed: ShortcutPosition[] = []

  for (const id of shortcutIds) {
    const saved = storedById.get(id)
    if (saved) {
      placed.push({ id, ...clampToBounds(saved.x, saved.y, iconSizePx, metrics) })
      continue
    }
    const vacant = findVacantNearCenter(placed, id, iconSizePx, metrics)
    placed.push({ id, ...vacant })
  }

  return fixOverlappingPositions(placed, iconSizePx, metrics)
}

export function getMinCenterDist(iconSizePx: number = ICON_SIZE): number {
  return iconSizePx + ICON_GAP
}

export function resolveCollisions(
  positions: ShortcutPosition[],
  movedId: string,
  iconSizePx: number = ICON_SIZE,
  metrics: LunarMetrics = DEFAULT_LUNAR_METRICS,
): ShortcutPosition[] {
  const minDist = getMinCenterDist(iconSizePx)
  const iconInset = iconSizePx / 2
  const result = positions.map((p) => ({ ...p }))
  const moved = result.find((p) => p.id === movedId)
  if (!moved) return result

  for (let pass = 0; pass < 8; pass++) {
    let changed = false
    for (const other of result) {
      if (other.id === movedId) continue
      const dx = moved.x - other.x
      const dy = moved.y - other.y
      const dist = Math.hypot(dx, dy)
      if (dist < minDist) {
        const push = dist < 0.01 ? minDist : minDist - dist
        const nx = dist < 0.01 ? 1 : dx / dist
        const ny = dist < 0.01 ? 0 : dy / dist
        moved.x += nx * push
        moved.y += ny * push
        const clamped = clampToBounds(moved.x, moved.y, iconSizePx, metrics)
        moved.x = clamped.x
        moved.y = clamped.y
        changed = true
      }
    }
    if (!changed) break
  }

  const final = clampToLunarDome(moved.x, moved.y, iconInset, metrics)
  moved.x = final.x
  moved.y = final.y

  return result
}

export function clampToBounds(
  x: number,
  y: number,
  iconSizePx: number = ICON_SIZE,
  metrics: LunarMetrics = DEFAULT_LUNAR_METRICS,
): { x: number; y: number } {
  return clampToLunarDome(x, y, iconSizePx / 2, metrics)
}

export { createLunarMetrics, type LunarMetrics }
