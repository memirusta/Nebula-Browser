import { t, type NebulaLocale } from './locale'

export type WidgetType =
  | 'ram'
  | 'cpu'
  | 'clock'
  | 'blank'
  | 'notes'
  | 'weather'
  | 'calendar'
  | 'quickLinks'
  | 'network'

export const WIDGET_TYPES: WidgetType[] = [
  'ram',
  'cpu',
  'clock',
  'blank',
  'notes',
  'weather',
  'calendar',
  'quickLinks',
  'network',
]

/** Widget types offered in the add picker (clock is sidebar-only). */
export const ADDABLE_WIDGET_TYPES: WidgetType[] = [
  'ram',
  'cpu',
  'notes',
  'blank',
  'weather',
  'calendar',
  'quickLinks',
  'network',
]

export function getWidgetLabel(locale: NebulaLocale, type: WidgetType): string {
  switch (type) {
    case 'ram':
      return 'RAM'
    case 'cpu':
      return 'CPU'
    case 'clock':
      return t(locale, 'widgetClock')
    case 'blank':
      return t(locale, 'widgetBlank')
    case 'notes':
      return t(locale, 'widgetNotes')
    case 'weather':
      return t(locale, 'widgetWeather')
    case 'calendar':
      return t(locale, 'widgetCalendar')
    case 'quickLinks':
      return t(locale, 'widgetQuickLinks')
    case 'network':
      return t(locale, 'widgetNetwork')
  }
}

/** Default Turkish labels retained for persisted/default pane metadata. */
const WIDGET_LABELS: Record<WidgetType, string> = {
  ram: 'RAM',
  cpu: 'CPU',
  clock: 'Saat',
  blank: 'Boş Alan',
  notes: 'Notlar',
  weather: 'Hava Durumu',
  calendar: 'Takvim',
  quickLinks: 'Hızlı Bağlantılar',
  network: 'Ağ Kullanımı',
}

export interface WidgetSize {
  w: number
  h: number
  minW: number
  minH: number
}

export const WIDGET_DEFAULT_SIZES: Record<WidgetType, WidgetSize> = {
  ram: { w: 4, h: 4, minW: 3, minH: 3 },
  cpu: { w: 4, h: 4, minW: 3, minH: 3 },
  clock: { w: 4, h: 3, minW: 3, minH: 2 },
  blank: { w: 4, h: 4, minW: 2, minH: 2 },
  notes: { w: 4, h: 5, minW: 3, minH: 3 },
  weather: { w: 4, h: 6, minW: 4, minH: 5 },
  calendar: { w: 4, h: 7, minW: 4, minH: 6 },
  quickLinks: { w: 4, h: 6, minW: 3, minH: 4 },
  network: { w: 4, h: 4, minW: 3, minH: 3 },
}

export const WIDGET_LAYOUT_KEY = 'nebula-widget-layout-v1'

export interface WidgetQuickLink {
  id: string
  label: string
  url: string
}

export interface WidgetPaneData {
  notes?: { text: string }
  blank?: { heading: string; body: string; accent: string }
  weather?: { location: string; latitude: number; longitude: number }
  quickLinks?: { links: WidgetQuickLink[] }
}

export interface WidgetPane {
  id: string
  widgetType: WidgetType
  title: string
  active: boolean
  data?: WidgetPaneData
}

export interface WidgetLayoutItem {
  i: string
  x: number
  y: number
  w: number
  h: number
  minW?: number
  minH?: number
}

export const HOME_GRID_COLS = 4
export const HOME_GRID_ROW_HEIGHT = 28

export const DEFAULT_WIDGET_PANES: WidgetPane[] = [
  { id: 'widget-ram', widgetType: 'ram', title: WIDGET_LABELS.ram, active: true },
  { id: 'widget-cpu', widgetType: 'cpu', title: WIDGET_LABELS.cpu, active: false },
]

export const DEFAULT_WIDGET_LAYOUT: WidgetLayoutItem[] = [
  { i: 'widget-ram', x: 0, y: 0, w: 4, h: 4, minW: 3, minH: 3 },
  { i: 'widget-cpu', x: 0, y: 4, w: 4, h: 4, minW: 3, minH: 3 },
]

export interface WidgetLayoutState {
  panes: WidgetPane[]
  layout: WidgetLayoutItem[]
}

export function isWidgetTypeEnabled(
  type: WidgetType,
  settings: { showRamWidget: boolean; showCpuWidget: boolean },
): boolean {
  switch (type) {
    case 'ram':
      return settings.showRamWidget
    case 'cpu':
      return settings.showCpuWidget
    default:
      return true
  }
}

export function filterPanesBySettings(
  panes: WidgetPane[],
  settings: { showRamWidget: boolean; showCpuWidget: boolean },
): WidgetPane[] {
  return panes.filter((p) => p.widgetType !== 'clock' && isWidgetTypeEnabled(p.widgetType, settings))
}

export function filterLayoutForPanes(
  layout: WidgetLayoutItem[],
  panes: WidgetPane[],
): WidgetLayoutItem[] {
  const ids = new Set(panes.map((p) => p.id))
  return layout.filter((l) => ids.has(l.i))
}

function isWidgetType(value: unknown): value is WidgetType {
  return typeof value === 'string' && WIDGET_TYPES.includes(value as WidgetType)
}

export function normalizeWidgetLayout(
  partial: Partial<WidgetLayoutState> | null | undefined,
): WidgetLayoutState {
  const panesRaw = partial?.panes
  const layoutRaw = partial?.layout

  if (!Array.isArray(panesRaw) || panesRaw.length === 0) {
    return { panes: [...DEFAULT_WIDGET_PANES], layout: [...DEFAULT_WIDGET_LAYOUT] }
  }

  const panes: WidgetPane[] = panesRaw
    .filter(
      (p) => p && typeof p.id === 'string' && isWidgetType(p.widgetType) && p.widgetType !== 'clock',
    )
    .map((p) => ({
      id: p.id,
      widgetType: p.widgetType,
      title:
        typeof p.title === 'string' && p.title.trim()
          ? p.title.trim().slice(0, 32)
          : WIDGET_LABELS[p.widgetType],
      active: Boolean(p.active),
      data: normalizeWidgetData(p.data),
    }))

  if (panes.length === 0) {
    return { panes: [...DEFAULT_WIDGET_PANES], layout: [...DEFAULT_WIDGET_LAYOUT] }
  }

  const paneIds = new Set(panes.map((p) => p.id))
  const layout: WidgetLayoutItem[] = Array.isArray(layoutRaw)
    ? layoutRaw
        .filter((l) => l && typeof l.i === 'string' && paneIds.has(l.i))
        .map((l) => {
          const pane = panes.find((p) => p.id === l.i)!
          const defaults = WIDGET_DEFAULT_SIZES[pane.widgetType]
          return {
            i: l.i,
            x: typeof l.x === 'number' ? l.x : 0,
            y: typeof l.y === 'number' ? l.y : 0,
            w: typeof l.w === 'number' ? l.w : defaults.w,
            h: typeof l.h === 'number' ? l.h : defaults.h,
            minW: defaults.minW,
            minH: defaults.minH,
          }
        })
    : []

  const layoutIds = new Set(layout.map((l) => l.i))
  for (const pane of panes) {
    if (!layoutIds.has(pane.id)) {
      const defaults = WIDGET_DEFAULT_SIZES[pane.widgetType]
      const bottomY = layout.reduce((bottom, item) => Math.max(bottom, item.y + item.h), 0)
      layout.push({
        i: pane.id,
        x: 0,
        y: bottomY,
        w: defaults.w,
        h: defaults.h,
        minW: defaults.minW,
        minH: defaults.minH,
      })
    }
  }

  return { panes, layout }
}

function normalizeWidgetData(value: unknown): WidgetPaneData {
  if (!value || typeof value !== 'object') return {}
  const data = value as WidgetPaneData
  const normalized: WidgetPaneData = {}
  if (data.notes && typeof data.notes.text === 'string') {
    normalized.notes = { text: data.notes.text.slice(0, 20_000) }
  }
  if (data.blank) {
    normalized.blank = {
      heading: typeof data.blank.heading === 'string' ? data.blank.heading.slice(0, 60) : '',
      body: typeof data.blank.body === 'string' ? data.blank.body.slice(0, 2_000) : '',
      accent:
        typeof data.blank.accent === 'string' && /^#[0-9a-f]{6}$/i.test(data.blank.accent)
          ? data.blank.accent
          : '#7ec8e3',
    }
  }
  if (
    data.weather &&
    typeof data.weather.location === 'string' &&
    typeof data.weather.latitude === 'number' &&
    typeof data.weather.longitude === 'number'
  ) {
    normalized.weather = {
      location: data.weather.location.slice(0, 100),
      latitude: Math.max(-90, Math.min(90, data.weather.latitude)),
      longitude: Math.max(-180, Math.min(180, data.weather.longitude)),
    }
  }
  if (data.quickLinks && Array.isArray(data.quickLinks.links)) {
    normalized.quickLinks = {
      links: data.quickLinks.links
        .filter((link) => link && typeof link.id === 'string' && typeof link.url === 'string')
        .slice(0, 12)
        .map((link) => ({
          id: link.id.slice(0, 100),
          label: typeof link.label === 'string' ? link.label.trim().slice(0, 40) : '',
          url: link.url.trim().slice(0, 2_000),
        })),
    }
  }
  return normalized
}

export function loadWidgetLayout(): WidgetLayoutState {
  try {
    const raw = localStorage.getItem(WIDGET_LAYOUT_KEY)
    if (raw) {
      return normalizeWidgetLayout(JSON.parse(raw) as Partial<WidgetLayoutState>)
    }
  } catch {
    /* ignore */
  }
  return normalizeWidgetLayout(null)
}
