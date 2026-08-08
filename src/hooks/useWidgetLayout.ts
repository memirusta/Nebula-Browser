import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Layout } from 'react-grid-layout/legacy'
import {
  WIDGET_DEFAULT_SIZES,
  WIDGET_LAYOUT_KEY,
  filterLayoutForPanes,
  filterPanesBySettings,
  getWidgetLabel,
  loadWidgetLayout,
  normalizeWidgetLayout,
  type WidgetPane,
  type WidgetPaneData,
  type WidgetType,
} from '../core/widgets'
import { loadLocale } from '../core/locale'

interface HomeWidgetSettings {
  showRamWidget: boolean
  showCpuWidget: boolean
}

export function useWidgetLayout(homeSettings: HomeWidgetSettings) {
  const { showRamWidget, showCpuWidget } = homeSettings
  const [state, setState] = useState(loadWidgetLayout)
  const { panes, layout } = state

  useEffect(() => {
    localStorage.setItem(WIDGET_LAYOUT_KEY, JSON.stringify(state))
  }, [state])

  const visiblePanes = useMemo(
    () => filterPanesBySettings(panes, { showRamWidget, showCpuWidget }),
    [panes, showRamWidget, showCpuWidget],
  )

  const visibleLayout = useMemo(
    () => filterLayoutForPanes(layout, visiblePanes),
    [layout, visiblePanes],
  )

  const onLayoutChange = useCallback((newLayout: Layout) => {
    setState((prev) => {
      const nextById = new Map(newLayout.map((item) => [item.i, item]))
      let changed = false
      const merged = prev.layout.map((item) => {
        const updated = nextById.get(item.i)
        if (!updated) return item

        if (
          item.x === updated.x &&
          item.y === updated.y &&
          item.w === updated.w &&
          item.h === updated.h
        ) {
          return item
        }

        changed = true
        return {
          ...item,
          x: updated.x,
          y: updated.y,
          w: updated.w,
          h: updated.h,
        }
      })

      return changed ? { ...prev, layout: merged } : prev
    })
  }, [])

  const addWidget = useCallback(
    (type: WidgetType) => {
      if (type === 'ram' && !showRamWidget) return false
      if (type === 'cpu' && !showCpuWidget) return false
      if (type === 'clock') return false

      const singletonTypes: WidgetType[] = ['ram', 'cpu', 'calendar', 'network']

      let added = false
      setState((prev) => {
        if (singletonTypes.includes(type) && prev.panes.some((p) => p.widgetType === type)) {
          return prev
        }

        added = true
        const id = `widget-${crypto.randomUUID().slice(0, 8)}`
        const defaults = WIDGET_DEFAULT_SIZES[type]
        const bottomY = prev.layout.reduce((bottom, item) => {
          const itemBottom = Number.isFinite(item.y) ? item.y + item.h : bottom
          return Math.max(bottom, itemBottom)
        }, 0)
        const newPane: WidgetPane = {
          id,
          widgetType: type,
          title: getWidgetLabel(loadLocale(), type),
          active: false,
          data: {},
        }

        return {
          panes: [...prev.panes, newPane],
          layout: [
            ...prev.layout,
            {
              i: id,
              x: 0,
              y: bottomY,
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
    [showRamWidget, showCpuWidget],
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

  const updateWidgetData = useCallback((id: string, data: WidgetPaneData) => {
    setState((prev) => ({
      ...prev,
      panes: prev.panes.map((pane) => (pane.id === id ? { ...pane, data } : pane)),
    }))
  }, [])

  const exportBackup = useCallback(() => {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      state,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `nebula-widgets-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
  }, [state])

  const importBackup = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        const parsed = JSON.parse(await file.text()) as unknown
        const candidate =
          parsed && typeof parsed === 'object' && 'state' in parsed
            ? (parsed as { state?: Parameters<typeof normalizeWidgetLayout>[0] }).state
            : (parsed as Parameters<typeof normalizeWidgetLayout>[0])
        setState(normalizeWidgetLayout(candidate))
      } catch {
        window.alert('Widget yedeği okunamadı.')
      }
    }
    input.click()
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
    updateWidgetData,
    exportBackup,
    importBackup,
    resetLayout,
  }
}
