import { useCallback, useEffect, useRef, useState } from 'react'
import GridLayout, { type Layout } from 'react-grid-layout/legacy'
import 'react-grid-layout/css/styles.css'
import { HOME_GRID_COLS, HOME_GRID_ROW_HEIGHT } from '../../core/widgets'
import type { WidgetPane } from '../../core/widgets'
import type { SystemStats } from '../../core/types'
import { useLocale } from '../../hooks/useLocale'
import { GridCell } from './GridCell'
import styles from './HomeWidgetGrid.module.css'

interface HomeWidgetGridProps {
  panes: WidgetPane[]
  layout: Layout
  stats: SystemStats
  onLayoutChange: (layout: Layout) => void
  onFocusPane: (id: string) => void
  onClosePane: (id: string) => void
}

export function HomeWidgetGrid({
  panes,
  layout,
  stats,
  onLayoutChange,
  onFocusPane,
  onClosePane,
}: HomeWidgetGridProps) {
  const { t } = useLocale()
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [localLayout, setLocalLayout] = useState(layout)
  const [isDragging, setIsDragging] = useState(false)

  useEffect(() => {
    if (!isDragging) setLocalLayout(layout)
  }, [layout, isDragging])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const measure = () => setWidth(el.clientWidth)
    measure()

    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const handleLayoutChange = useCallback((newLayout: Layout) => {
    setLocalLayout(newLayout)
  }, [])

  const handleDragStart = useCallback(() => {
    setIsDragging(true)
  }, [])

  const handleDragStop = useCallback(
    (newLayout: Layout) => {
      setIsDragging(false)
      setLocalLayout(newLayout)
      onLayoutChange(newLayout)
    },
    [onLayoutChange],
  )

  if (panes.length === 0) {
    return (
      <div className={styles.emptyArea} ref={containerRef}>
        <p className={styles.emptyText}>{t('widgetsEmpty')}</p>
        <p className={styles.emptyHint}>{t('widgetsEmptyHint')}</p>
      </div>
    )
  }

  return (
    <div
      className={`${styles.gridArea} ${isDragging ? styles.gridAreaDragging : ''}`}
      ref={containerRef}
    >
      {width > 0 && (
        <GridLayout
          className={styles.grid}
          layout={localLayout}
          cols={HOME_GRID_COLS}
          rowHeight={HOME_GRID_ROW_HEIGHT}
          width={width}
          margin={[8, 8]}
          containerPadding={[0, 0]}
          onLayoutChange={handleLayoutChange}
          onDragStart={handleDragStart}
          onDragStop={handleDragStop}
          draggableHandle="[data-widget-drag-handle]"
          draggableCancel="button, input, textarea, a, select, .widget-content"
          isDraggable
          isResizable={false}
          compactType="vertical"
          useCSSTransforms
        >
          {panes.map((pane) => (
            <div key={pane.id} className={styles.gridItem}>
              <GridCell
                pane={pane}
                isActive={pane.active}
                stats={stats}
                onFocus={() => onFocusPane(pane.id)}
                onClose={() => onClosePane(pane.id)}
              />
            </div>
          ))}
        </GridLayout>
      )}
    </div>
  )
}
