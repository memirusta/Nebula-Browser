export const SITE_ZOOM_STORE_KEY = 'nebula-site-zoom-v1'

const MIN_ZOOM = 0.25
const MAX_ZOOM = 5
const MAX_SITES = 300

type SiteZoomMap = Record<string, number>

export function siteZoomOrigin(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.origin
  } catch {
    return null
  }
}

function loadSiteZoomMap(): SiteZoomMap {
  try {
    const parsed = JSON.parse(localStorage.getItem(SITE_ZOOM_STORE_KEY) ?? '{}') as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const normalized: SiteZoomMap = {}
    for (const [origin, factor] of Object.entries(parsed)) {
      if (
        siteZoomOrigin(origin) !== origin ||
        typeof factor !== 'number' ||
        !Number.isFinite(factor) ||
        factor < MIN_ZOOM ||
        factor > MAX_ZOOM
      ) {
        continue
      }
      normalized[origin] = factor
    }
    return normalized
  } catch {
    return {}
  }
}

export function siteZoomFactor(url: string): number {
  const origin = siteZoomOrigin(url)
  if (!origin) return 1
  return loadSiteZoomMap()[origin] ?? 1
}

export function rememberSiteZoom(url: string, factor: number): void {
  const origin = siteZoomOrigin(url)
  if (!origin || !Number.isFinite(factor)) return
  const zooms = loadSiteZoomMap()
  if (Math.abs(factor - 1) < 0.001) {
    delete zooms[origin]
  } else {
    delete zooms[origin]
    zooms[origin] = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, factor))
  }
  const entries = Object.entries(zooms).slice(-MAX_SITES)
  localStorage.setItem(SITE_ZOOM_STORE_KEY, JSON.stringify(Object.fromEntries(entries)))
}
