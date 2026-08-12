import { getWidgetLabel, type WidgetPane, type WidgetPaneData } from '../../core/widgets'
import type { SystemStats } from '../../core/types'
import { useLocale } from '../../hooks/useLocale'
import { WidgetRenderer } from '../widgets/WidgetRenderer'
import styles from './GridCell.module.css'

interface GridCellProps {
  pane: WidgetPane
  isActive: boolean
  stats: SystemStats
  onFocus: () => void
  onClose: () => void
  onUpdate: (data: WidgetPaneData) => void
  onNavigate: (url: string) => void
}

export function GridCell({ pane, isActive, stats, onFocus, onClose, onUpdate, onNavigate }: GridCellProps) {
  const { locale, t } = useLocale()

  return (
    <div className={`${styles.cell} ${isActive ? styles.cellActive : ''}`}>
      <div className={`${styles.chrome} chrome`} data-widget-drag-handle>
        <div className={styles.tabInfo}>
          <span className={styles.tabDot} data-active={isActive} />
          <span className={styles.tabTitle}>{getWidgetLabel(locale, pane.widgetType)}</span>
        </div>
        <div className={styles.chromeActions}>
          <button
            type="button"
            className={styles.chromeBtn}
            onClick={(e) => {
              e.stopPropagation()
              onClose()
            }}
            aria-label={t('widgetRemove')}
          >
            ×
          </button>
        </div>
      </div>
      <div className={`${styles.content} widget-content`} onClick={onFocus} onFocusCapture={onFocus}>
        <WidgetRenderer pane={pane} stats={stats} onUpdate={onUpdate} onNavigate={onNavigate} />
      </div>
    </div>
  )
}
