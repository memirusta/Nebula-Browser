import {
  clampToLunarDome,
  createLunarMetrics,
  DEFAULT_LUNAR_METRICS,
  isIconDiscInsideLunarDome,
  pointOnLunarEllipse,
  type LunarMetrics,
} from './lunarShape.ts'

export const ICON_SIZE = 44
export const ICON_GAP = 10
export const DRAG_THRESHOLD = 4
export const SHORTCUT_POSITIONS_KEY = 'nebula-shortcut-positions-v10'
export const SHORTCUT_HOVER_SCALE = 1.12

const LUNAR_CONTROL_SIZE = 36
const LUNAR_CONTROL_GAP = 6
const LUNAR_CONTROL_EDGE_OFFSET = 62
const LUNAR_CONTROL_TOP = 14
const LUNAR_CONTROL_CLEARANCE = 3
const LUNAR_FILL_RADIUS_SCALE = 1.1

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

export function buildDefaultPositions(
  shortcutIds: string[],
  metrics: LunarMetrics = DEFAULT_LUNAR_METRICS,
  iconSizePx: number = ICON_SIZE,
): ShortcutPosition[] {
  const positions: ShortcutPosition[] = []
  for (const id of shortcutIds) {
    positions.push({
      id,
      ...findVacantAcrossLunarDome(positions, id, iconSizePx, metrics),
    })
  }
  return positions
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

interface LunarVacancyCandidate {
  x: number
  y: number
}

/** Build a centered hex grid containing only complete icon discs inside the dome. */
function lunarVacancyCandidates(
  iconSizePx: number,
  metrics: LunarMetrics,
): LunarVacancyCandidate[] {
  const radius = iconSizePx / 2
  const step = getMinCenterDist(iconSizePx)
  const rowStep = step * (Math.sqrt(3) / 2)
  const usableHeight = Math.max(0, metrics.h - radius * 2)
  const rowIntervals = Math.max(0, Math.floor(usableHeight / rowStep))
  const yRemainder = usableHeight - rowIntervals * rowStep
  const yStart = radius + yRemainder / 2
  const halfColumns = Math.ceil(metrics.w / (step * 2)) + 1
  const candidates: LunarVacancyCandidate[] = []

  for (let row = 0; row <= rowIntervals; row += 1) {
    const y = yStart + row * rowStep
    const rowOffset = row % 2 === 0 ? 0 : step / 2

    for (let column = -halfColumns; column <= halfColumns; column += 1) {
      const x = metrics.cx + rowOffset + column * step
      if (!isIconDiscInsideLunarDome(x, y, radius, metrics)) continue

      candidates.push({ x, y })
    }
  }

  return candidates
}

/** Fill outward from the center spawn while keeping every icon collision-free. */
function findVacantAcrossLunarDome(
  existing: ShortcutPosition[],
  id: string,
  iconSizePx: number,
  metrics: LunarMetrics,
): { x: number; y: number } {
  const spawn = centerSpawnPosition(metrics, iconSizePx)
  if (!collidesAt(spawn.x, spawn.y, existing, id, iconSizePx)) return spawn

  const minimumCenterDistance = getMinCenterDist(iconSizePx)
  const minimumSafeDistanceSq = (minimumCenterDistance - 1) ** 2
  const neighborCount = existing.filter((position) => position.id !== id).length
  const preferredSpawnDistance =
    minimumCenterDistance * Math.sqrt(neighborCount) * LUNAR_FILL_RADIUS_SCALE
  type ScoredCandidate = LunarVacancyCandidate & {
    nearestDistanceSq: number
    spawnDistanceSq: number
    preferredDistanceDelta: number
  }
  let bestFree: ScoredCandidate | null = null
  let bestFallback: ScoredCandidate | null = null

  for (const candidate of lunarVacancyCandidates(iconSizePx, metrics)) {
    let nearestDistanceSq = Number.POSITIVE_INFINITY
    for (const position of existing) {
      if (position.id === id) continue
      const distanceSq = (candidate.x - position.x) ** 2 + (candidate.y - position.y) ** 2
      nearestDistanceSq = Math.min(nearestDistanceSq, distanceSq)
    }

    const spawnDistanceSq =
      (candidate.x - spawn.x) ** 2 + (candidate.y - spawn.y) ** 2
    const preferredDistanceDelta = Math.abs(
      Math.sqrt(spawnDistanceSq) - preferredSpawnDistance,
    )
    const scored = {
      ...candidate,
      nearestDistanceSq,
      spawnDistanceSq,
      preferredDistanceDelta,
    }

    const isBetterFallback =
      !bestFallback ||
      nearestDistanceSq > bestFallback.nearestDistanceSq + 0.01 ||
      (Math.abs(nearestDistanceSq - bestFallback.nearestDistanceSq) <= 0.01 &&
        spawnDistanceSq < bestFallback.spawnDistanceSq)
    if (isBetterFallback) bestFallback = scored

    if (nearestDistanceSq >= minimumSafeDistanceSq) {
      const isBetterFree =
        !bestFree ||
        preferredDistanceDelta < bestFree.preferredDistanceDelta - 0.01 ||
        (Math.abs(preferredDistanceDelta - bestFree.preferredDistanceDelta) <= 0.01 &&
          (nearestDistanceSq > bestFree.nearestDistanceSq + 0.01 ||
            (Math.abs(nearestDistanceSq - bestFree.nearestDistanceSq) <= 0.01 &&
              spawnDistanceSq < bestFree.spawnDistanceSq)))
      if (isBetterFree) bestFree = scored
    }
  }

  const best = bestFree ?? bestFallback
  return best ? { x: best.x, y: best.y } : spawn
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

    const vacant = findVacantAcrossLunarDome(prior, current.id, iconSizePx, metrics)
    current.x = vacant.x
    current.y = vacant.y
  }

  return result
}

/** Keep stored positions and place new or overlapping items near the center cluster. */
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
    return buildDefaultPositions(shortcutIds, metrics, iconSizePx)
  }

  const placed: ShortcutPosition[] = []

  for (const id of shortcutIds) {
    const saved = storedById.get(id)
    if (saved) {
      placed.push({ id, ...clampToBounds(saved.x, saved.y, iconSizePx, metrics) })
      continue
    }
    const vacant = findVacantAcrossLunarDome(placed, id, iconSizePx, metrics)
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

export interface LunarChromeControlCounts {
  left: number
  right: number
}

export interface LunarChromeControlCenter {
  x: number
  y: number
}

export function lunarChromeControlCenters(
  metrics: LunarMetrics,
  counts: LunarChromeControlCounts,
): LunarChromeControlCenter[] {
  const radius = LUNAR_CONTROL_SIZE / 2
  const step = LUNAR_CONTROL_SIZE + LUNAR_CONTROL_GAP
  const centerY = LUNAR_CONTROL_TOP + radius
  const controls: LunarChromeControlCenter[] = []

  for (let index = 0; index < counts.left; index += 1) {
    controls.push({
      x: LUNAR_CONTROL_EDGE_OFFSET + radius + index * step,
      y: centerY,
    })
  }

  for (let index = 0; index < counts.right; index += 1) {
    controls.push({
      x:
        metrics.w -
        LUNAR_CONTROL_EDGE_OFFSET -
        radius -
        (counts.right - index - 1) * step,
      y: centerY,
    })
  }

  return controls
}

function overlapsLunarControl(
  point: { x: number; y: number },
  control: LunarChromeControlCenter,
  minimumDistance: number,
): boolean {
  return Math.hypot(point.x - control.x, point.y - control.y) < minimumDistance - 0.01
}

/**
 * Keep the complete visual shortcut disc inside the adaptive lunar ellipse.
 * Only the actual left/right Nebula controls are excluded; the middle no
 * longer inherits a fake full-width bottom edge.
 */
export function clampToLunarChromeSafeArea(
  x: number,
  y: number,
  iconSizePx: number = ICON_SIZE,
  metrics: LunarMetrics = DEFAULT_LUNAR_METRICS,
  controlCounts: LunarChromeControlCounts = { left: 0, right: 0 },
): { x: number; y: number } {
  const radius = iconSizePx / 2
  const controlRadius = LUNAR_CONTROL_SIZE / 2
  const minimumDistance = radius + controlRadius + LUNAR_CONTROL_CLEARANCE
  const controls = lunarChromeControlCenters(metrics, controlCounts)
  let point = clampToBounds(x, y, iconSizePx, metrics)

  for (let pass = 0; pass < 12; pass += 1) {
    const collision = controls.find((control) =>
      overlapsLunarControl(point, control, minimumDistance),
    )
    if (!collision) return point

    let dx = point.x - collision.x
    let dy = point.y - collision.y
    let distance = Math.hypot(dx, dy)
    if (distance < 0.01) {
      dx = collision.x < metrics.cx ? 1 : -1
      dy = 0
      distance = 1
    }

    const push = minimumDistance - distance + 0.05
    point = clampToBounds(
      point.x + (dx / distance) * push,
      point.y + (dy / distance) * push,
      iconSizePx,
      metrics,
    )
  }

  // The ellipse can redirect a push back into a button near a sharp edge.
  // Sample the small obstacle perimeter and choose the nearest valid point.
  let best: { x: number; y: number; score: number } | null = null
  for (const control of controls) {
    for (let sample = 0; sample < 48; sample += 1) {
      const angle = (Math.PI * 2 * sample) / 48
      const candidate = clampToBounds(
        control.x + Math.cos(angle) * minimumDistance,
        control.y + Math.sin(angle) * minimumDistance,
        iconSizePx,
        metrics,
      )
      if (
        controls.some((entry) =>
          overlapsLunarControl(candidate, entry, minimumDistance),
        )
      ) {
        continue
      }

      const score = (candidate.x - x) ** 2 + (candidate.y - y) ** 2
      if (!best || score < best.score) {
        best = { ...candidate, score }
      }
    }
  }

  return best ? { x: best.x, y: best.y } : point
}

export { createLunarMetrics, type LunarMetrics }
