import { useCallback, useEffect, useState } from 'react'
import GridLayout, { type Layout } from 'react-grid-layout/legacy'
import 'react-grid-layout/css/styles.css'
import { GRID_COLS, GRID_ROW_HEIGHT } from '../../core/spatial'
import type { GridPane } from '../../core/spatial'
import type { SystemStats } from '../../core/types'
import { GridCell } from './GridCell'
import styles from './SpatialGrid.module.css'

interface SpatialGridProps {
  panes: GridPane[]
  layout: Layout
  activePaneId: string
  stats: SystemStats
  onLayoutChange: (layout: Layout) => void
  onFocusPane: (id: string) => void
  onClosePane: (id: string) => void
}

export function SpatialGrid({
  panes,
  layout,
  activePaneId,
  stats,
  onLayoutChange,
  onFocusPane,
  onClosePane,
}: SpatialGridProps) {
  const [width, setWidth] = useState(window.innerWidth)

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const handleLayoutChange = useCallback(
    (newLayout: Layout) => onLayoutChange(newLayout),
    [onLayoutChange],
  )

  return (
    <div className={styles.gridWrapper}>
      <GridLayout
        className={styles.grid}
        layout={layout}
        cols={GRID_COLS}
        rowHeight={GRID_ROW_HEIGHT}
        width={width}
        margin={[12, 12]}
        containerPadding={[16, 48]}
        onLayoutChange={handleLayoutChange}
        draggableHandle=".chrome"
        compactType="vertical"
        useCSSTransforms
      >
        {panes.map((pane) => (
          <div key={pane.id} className={styles.gridItem}>
            <GridCell
              pane={pane}
              isActive={pane.id === activePaneId}
              stats={stats}
              onFocus={() => onFocusPane(pane.id)}
              onClose={() => onClosePane(pane.id)}
            />
          </div>
        ))}
      </GridLayout>
    </div>
  )
}
