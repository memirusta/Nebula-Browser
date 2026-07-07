import { useClock } from '../../hooks/useSystemStats'
import type { HomeSettings } from '../../core/nebulaSettings'
import { CLOCK_FONT_FAMILIES } from '../../core/nebulaSettings'
import styles from './LeftSidebar.module.css'

interface SidebarClockProps {
  settings: Pick<
    HomeSettings,
    'clockFontSize' | 'clockFontWeight' | 'clockShowDate' | 'clockFontFamily'
  >
}

export function SidebarClock({ settings }: SidebarClockProps) {
  const { time, date } = useClock()

  return (
    <div
      className={styles.clock}
      style={{
        fontFamily: CLOCK_FONT_FAMILIES[settings.clockFontFamily],
      }}
    >
      <span
        className={styles.clockTime}
        style={{
          fontSize: `${settings.clockFontSize}px`,
          fontWeight: settings.clockFontWeight,
        }}
      >
        {time}
      </span>
      {settings.clockShowDate && <span className={styles.clockDate}>{date}</span>}
    </div>
  )
}
