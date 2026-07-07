import type { WidgetPane } from '../../core/widgets'
import type { SystemStats } from '../../core/types'
import { WidgetRenderer } from '../widgets/WidgetRenderer'
import styles from './GridCell.module.css'

interface GridCellProps {
  pane: WidgetPane
  isActive: boolean
  stats: SystemStats
  onFocus: () => void
  onClose: () => void
}

export function GridCell({ pane, isActive, stats, onFocus, onClose }: GridCellProps) {
  return (
    <div className={`${styles.cell} ${isActive ? styles.cellActive : ''}`}>
      <div className={`${styles.chrome} chrome`} data-widget-drag-handle>
        <div className={styles.tabInfo}>
          <span className={styles.tabDot} data-active={isActive} />
          <span className={styles.tabTitle}>{pane.title}</span>
        </div>
        <div className={styles.chromeActions}>
          <button
            type="button"
            className={styles.chromeBtn}
            onClick={(e) => {
              e.stopPropagation()
              onClose()
            }}
            aria-label="Widget'ı kaldır"
          >
            ×
          </button>
        </div>
      </div>
      <div className={`${styles.content} widget-content`} onClick={onFocus}>
        <WidgetRenderer type={pane.widgetType} stats={stats} />
      </div>
    </div>
  )
}
