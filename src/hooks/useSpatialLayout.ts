import { useCallback, useState } from 'react'
import type { Layout } from 'react-grid-layout/legacy'
import { DEFAULT_LAYOUT, DEFAULT_PANES } from '../core/spatial'
import type { GridPane } from '../core/spatial'
import type { WidgetType } from '../core/widgets'
import { WIDGET_DEFAULT_SIZES, getWidgetLabel } from '../core/widgets'
import { loadLocale } from '../core/locale'

export function useSpatialLayout() {
  const [panes, setPanes] = useState<GridPane[]>(DEFAULT_PANES)
  const [layout, setLayout] = useState<Layout>(DEFAULT_LAYOUT)
  const [activePaneId, setActivePaneId] = useState(DEFAULT_PANES[0].id)

  const onLayoutChange = useCallback((newLayout: Layout) => {
    setLayout(newLayout)
  }, [])

  const addPane = useCallback((widgetType: WidgetType = 'blank') => {
    const id = `pane-${crypto.randomUUID().slice(0, 8)}`
    const defaults = WIDGET_DEFAULT_SIZES[widgetType]
    const newPane: GridPane = {
      id,
      widgetType,
      title: getWidgetLabel(loadLocale(), widgetType),
      active: false,
    }
    setPanes((prev) => [...prev, newPane])
    setLayout((prev) => [
      ...prev,
      { i: id, x: 0, y: Infinity, w: defaults.w, h: defaults.h, minW: defaults.minW, minH: defaults.minH },
    ])
    setActivePaneId(id)
  }, [])

  const closePane = useCallback(
    (id: string) => {
      setPanes((prev) => {
        const next = prev.filter((p) => p.id !== id)
        if (next.length === 0) return prev
        if (activePaneId === id) setActivePaneId(next[0].id)
        return next
      })
      setLayout((prev) => prev.filter((l) => l.i !== id))
    },
    [activePaneId],
  )

  const focusPane = useCallback((id: string) => {
    setActivePaneId(id)
    setPanes((prev) => prev.map((p) => ({ ...p, active: p.id === id })))
  }, [])

  return {
    panes,
    layout,
    activePaneId,
    onLayoutChange,
    addPane,
    closePane,
    focusPane,
  }
}
