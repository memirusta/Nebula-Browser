import { useClock } from '../../hooks/useSystemStats'
import styles from './widgets.module.css'

export function ClockWidget() {
  const { time, date } = useClock()

  return (
    <div className={styles.clock}>
      <span className={styles.time}>{time}</span>
      <span className={styles.date}>{date}</span>
    </div>
  )
}
