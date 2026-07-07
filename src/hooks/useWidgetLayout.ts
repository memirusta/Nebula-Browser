import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Layout } from 'react-grid-layout/legacy'
import {
  WIDGET_DEFAULT_SIZES,
  WIDGET_LABELS,
  WIDGET_LAYOUT_KEY,
  filterLayoutForPanes,
  filterPanesBySettings,
  loadWidgetLayout,
  normalizeWidgetLayout,
  type WidgetPane,
  type WidgetType,
} from '../core/widgets'

interface HomeWidgetSettings {
  showRamWidget: boolean
  showCpuWidget: boolean
}

export function useWidgetLayout(homeSettings: HomeWidgetSettings) {
  const [state, setState] = useState(loadWidgetLayout)
  const { panes, layout } = state

  useEffect(() => {
    localStorage.setItem(WIDGET_LAYOUT_KEY, JSON.stringify(state))
  }, [state])

  const visiblePanes = useMemo(
    () => filterPanesBySettings(panes, homeSettings),
    [panes, homeSettings],
  )

  const visibleLayout = useMemo(
    () => filterLayoutForPanes(layout, visiblePanes),
    [layout, visiblePanes],
  )

  const onLayoutChange = useCallback((newLayout: Layout) => {
    setState((prev) => {
      const nextById = new Map(newLayout.map((item) => [item.i, item]))
      const merged = prev.layout.map((item) => {
        const updated = nextById.get(item.i)
        if (!updated) return item
        return {
          ...item,
          x: updated.x,
          y: updated.y,
          w: updated.w,
          h: updated.h,
        }
      })
      return { ...prev, layout: merged }
    })
  }, [])

  const addWidget = useCallback(
    (type: WidgetType) => {
      const settings = homeSettings
      if (type === 'ram' && !settings.showRamWidget) return false
      if (type === 'cpu' && !settings.showCpuWidget) return false
      if (type === 'clock') return false

      const singletonTypes: WidgetType[] = ['ram', 'cpu']

      let added = false
      setState((prev) => {
        if (singletonTypes.includes(type) && prev.panes.some((p) => p.widgetType === type)) {
          return prev
        }

        added = true
        const id = `widget-${crypto.randomUUID().slice(0, 8)}`
        const defaults = WIDGET_DEFAULT_SIZES[type]
        const newPane: WidgetPane = {
          id,
          widgetType: type,
          title: WIDGET_LABELS[type],
          active: false,
        }

        return {
          panes: [...prev.panes, newPane],
          layout: [
            ...prev.layout,
            {
              i: id,
              x: 0,
              y: Infinity,
              w: defaults.w,
              h: defaults.h,
              minW: defaults.minW,
              minH: defaults.minH,
            },
          ],
        }
      })
      return added
    },
    [homeSettings],
  )

  const removeWidget = useCallback((id: string) => {
    setState((prev) => ({
      panes: prev.panes.filter((p) => p.id !== id),
      layout: prev.layout.filter((l) => l.i !== id),
    }))
  }, [])

  const focusWidget = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      panes: prev.panes.map((p) => ({ ...p, active: p.id === id })),
    }))
  }, [])

  const resetLayout = useCallback(() => {
    setState(normalizeWidgetLayout(null))
  }, [])

  const activeTypes = useMemo(
    () => new Set(panes.map((p) => p.widgetType)),
    [panes],
  )

  return {
    panes,
    layout,
    visiblePanes,
    visibleLayout,
    activeTypes,
    onLayoutChange,
    addWidget,
    removeWidget,
    focusWidget,
    resetLayout,
  }
}
