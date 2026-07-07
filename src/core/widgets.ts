export type WidgetType = 'ram' | 'cpu' | 'clock' | 'blank' | 'notes'

export const WIDGET_TYPES: WidgetType[] = ['ram', 'cpu', 'clock', 'blank', 'notes']

/** Widget types offered in the add picker (clock is sidebar-only). */
export const ADDABLE_WIDGET_TYPES: WidgetType[] = ['ram', 'cpu', 'blank', 'notes']

export const WIDGET_LABELS: Record<WidgetType, string> = {
  ram: 'RAM',
  cpu: 'CPU',
  clock: 'Saat',
  blank: 'Boş Alan',
  notes: 'Notlar',
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
}

export const WIDGET_LAYOUT_KEY = 'nebula-widget-layout-v1'

export interface WidgetPane {
  id: string
  widgetType: WidgetType
  title: string
  active: boolean
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
      layout.push({
        i: pane.id,
        x: 0,
        y: Infinity,
        w: defaults.w,
        h: defaults.h,
        minW: defaults.minW,
        minH: defaults.minH,
      })
    }
  }

  return { panes, layout }
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
