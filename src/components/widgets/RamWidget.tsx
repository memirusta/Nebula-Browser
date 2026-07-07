import type { SystemStats } from '../../core/types'
import { Sparkline } from '../PerformanceChart/Sparkline'
import styles from './widgets.module.css'

interface RamWidgetProps {
  stats: SystemStats
}

export function RamWidget({ stats }: RamWidgetProps) {
  return (
    <div className={styles.widget}>
      <div className={styles.header}>
        <span>RAM</span>
        <span className={styles.value}>
          {stats.ramUsedGb} GB · {stats.ramPercent}%
        </span>
      </div>
      <div className={styles.chart}>
        <Sparkline data={stats.ramHistory} width={200} height={40} />
      </div>
    </div>
  )
}
