import type { SystemStats } from '../../core/types'
import { Sparkline } from '../PerformanceChart/Sparkline'
import styles from './widgets.module.css'

interface CpuWidgetProps {
  stats: SystemStats
}

export function CpuWidget({ stats }: CpuWidgetProps) {
  return (
    <div className={styles.widget}>
      <div className={styles.header}>
        <span>CPU</span>
        <span className={styles.value}>{stats.cpuPercent}%</span>
      </div>
      <div className={styles.chart}>
        <Sparkline data={stats.cpuHistory} width={200} height={40} />
      </div>
    </div>
  )
}
