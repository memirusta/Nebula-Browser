import { useMemo } from 'react'
import { useLocale } from '../../hooks/useLocale'
import styles from './widgets.module.css'

export function CalendarWidget() {
  const { locale } = useLocale()
  const now = new Date()
  const { days, leading, monthLabel, weekdayLabels } = useMemo(() => {
    const year = now.getFullYear()
    const month = now.getMonth()
    const first = new Date(year, month, 1)
    const count = new Date(year, month + 1, 0).getDate()
    const mondayFirst = (first.getDay() + 6) % 7
    const labels = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(2024, 0, 1 + i)
      return new Intl.DateTimeFormat(locale === 'tr' ? 'tr-TR' : 'en-US', { weekday: 'short' }).format(d)
    })
    return {
      days: Array.from({ length: count }, (_, i) => i + 1),
      leading: mondayFirst,
      monthLabel: new Intl.DateTimeFormat(locale === 'tr' ? 'tr-TR' : 'en-US', {
        month: 'long',
        year: 'numeric',
      }).format(now),
      weekdayLabels: labels,
    }
  }, [locale, now.getFullYear(), now.getMonth()])

  return (
    <div className={styles.calendar}>
      <div className={styles.calendarMonth}>{monthLabel}</div>
      <div className={styles.calendarGrid}>
        {weekdayLabels.map((label) => <span key={label} className={styles.calendarWeekday}>{label}</span>)}
        {Array.from({ length: leading }, (_, i) => <span key={`blank-${i}`} />)}
        {days.map((day) => (
          <span key={day} className={`${styles.calendarDay} ${day === now.getDate() ? styles.calendarToday : ''}`}>
            {day}
          </span>
        ))}
      </div>
    </div>
  )
}
