export type LunarMetrics = {
  w: number
  h: number
  cx: number
  cy: number
  rx: number
  ry: number
}

export function createLunarMetrics(w: number, h: number): LunarMetrics {
  return {
    w,
    h,
    cx: w / 2,
    cy: -h * 0.16,
    rx: w / 2,
    ry: h * 1.12,
  }
}

export const DEFAULT_LUNAR_METRICS = createLunarMetrics(1100, 152)

/** @deprecated use metrics.w */
export const LUNAR_W = DEFAULT_LUNAR_METRICS.w
/** @deprecated use metrics.h */
export const LUNAR_H = DEFAULT_LUNAR_METRICS.h
export const LUNAR_CX = DEFAULT_LUNAR_METRICS.cx
export const LUNAR_CY = DEFAULT_LUNAR_METRICS.cy
export const LUNAR_RX = DEFAULT_LUNAR_METRICS.rx
export const LUNAR_RY = DEFAULT_LUNAR_METRICS.ry

export const LUNAR_CLIP_CSS = `ellipse(50% 112% at 50% -16%)`

/** Only show the lower outer rim band of the ellipse stroke */
export const LUNAR_RIM_CLIP_Y = 100

export function pointOnLunarEllipse(
  t: number,
  inset = 1,
  metrics: LunarMetrics = DEFAULT_LUNAR_METRICS,
) {
  const start = Math.PI * 0.88
  const end = Math.PI * 0.12
  const theta = start + (end - start) * t
  const rx = (metrics.rx - 8) * inset
  const ry = (metrics.ry - 6) * inset
  return {
    x: metrics.cx + rx * Math.cos(theta),
    y: metrics.cy + ry * Math.sin(theta),
  }
}

export function buildParallelRimPath(
  offset: number,
  segments = 48,
  clipY = LUNAR_RIM_CLIP_Y,
  metrics: LunarMetrics = DEFAULT_LUNAR_METRICS,
): string {
  const sinThreshold = Math.min(1, Math.max(-1, (clipY - metrics.cy) / metrics.ry))
  const thetaMin = Math.asin(sinThreshold)
  const thetaMax = Math.PI - thetaMin

  const commands: string[] = []
  for (let i = 0; i <= segments; i++) {
    const theta = thetaMin + ((thetaMax - thetaMin) * i) / segments
    const cosT = Math.cos(theta)
    const sinT = Math.sin(theta)

    const x = metrics.cx + metrics.rx * cosT
    const y = metrics.cy + metrics.ry * sinT

    const nx = cosT / metrics.rx
    const ny = sinT / metrics.ry
    const nlen = Math.hypot(nx, ny) || 1

    const ox = x - (offset * nx) / nlen
    const oy = y - (offset * ny) / nlen

    commands.push(`${i === 0 ? 'M' : 'L'} ${ox.toFixed(2)} ${oy.toFixed(2)}`)
  }
  return commands.join(' ')
}

export const LUNAR_INNER_RIM_OFFSET = 8
export const LUNAR_INNER_RIM_PATH = buildParallelRimPath(LUNAR_INNER_RIM_OFFSET, 48, 2)

export function isInsideLunarDome(
  x: number,
  y: number,
  inset = 0,
  metrics: LunarMetrics = DEFAULT_LUNAR_METRICS,
): boolean {
  const rx = Math.max(1, metrics.rx - inset)
  const ry = Math.max(1, metrics.ry - inset)
  const nx = (x - metrics.cx) / rx
  const ny = (y - metrics.cy) / ry
  return nx * nx + ny * ny <= 1 && y >= inset
}

/** True when every sampled point on the icon circle lies inside the outer lunar ellipse. */
export function isIconDiscInsideLunarDome(
  x: number,
  y: number,
  radius: number,
  metrics: LunarMetrics = DEFAULT_LUNAR_METRICS,
): boolean {
  if (radius <= 0) {
    const nx = (x - metrics.cx) / metrics.rx
    const ny = (y - metrics.cy) / metrics.ry
    return nx * nx + ny * ny <= 1 && y >= 0
  }

  for (let i = 0; i < 8; i++) {
    const angle = (Math.PI * i) / 4
    const sx = x + radius * Math.cos(angle)
    const sy = y + radius * Math.sin(angle)
    if (sy < 0) return false
    const ex = (sx - metrics.cx) / metrics.rx
    const ey = (sy - metrics.cy) / metrics.ry
    if (ex * ex + ey * ey > 1) return false
  }
  return true
}

function nudgeIconDiscInside(
  x: number,
  y: number,
  radius: number,
  metrics: LunarMetrics,
): { x: number; y: number } {
  let px = x
  let py = Math.max(y, radius)

  if (isIconDiscInsideLunarDome(px, py, radius, metrics)) {
    return { x: px, y: py }
  }

  for (let i = 0; i < 24; i++) {
    px = metrics.cx + (px - metrics.cx) * 0.94
    py = metrics.cy + (py - metrics.cy) * 0.94
    if (py < radius) py = radius
    if (isIconDiscInsideLunarDome(px, py, radius, metrics)) {
      return { x: px, y: py }
    }
  }

  const safeY = metrics.cy + metrics.ry - radius
  return { x: metrics.cx, y: Math.max(radius, safeY) }
}

export function clampToLunarDome(
  x: number,
  y: number,
  inset = 0,
  metrics: LunarMetrics = DEFAULT_LUNAR_METRICS,
): { x: number; y: number } {
  const rx = Math.max(1, metrics.rx - inset)
  const ry = Math.max(1, metrics.ry - inset)

  let dx = x - metrics.cx
  let dy = y - metrics.cy
  const distSq = (dx / rx) ** 2 + (dy / ry) ** 2

  if (distSq > 1) {
    const scale = 1 / Math.sqrt(distSq)
    dx *= scale
    dy *= scale
  }

  let px = metrics.cx + dx
  let py = metrics.cy + dy

  if (py < inset) {
    py = inset
    const yTerm = ((py - metrics.cy) / ry) ** 2
    if (yTerm >= 1) {
      px = metrics.cx
    } else {
      const xExtent = rx * Math.sqrt(1 - yTerm)
      px = Math.max(metrics.cx - xExtent, Math.min(metrics.cx + xExtent, px))
    }
  }

  if (inset > 0) {
    return nudgeIconDiscInside(px, py, inset, metrics)
  }

  return { x: px, y: py }
}
