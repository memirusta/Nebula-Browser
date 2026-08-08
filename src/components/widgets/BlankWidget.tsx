import type { CSSProperties } from 'react'
import { useLocale } from '../../hooks/useLocale'
import styles from './widgets.module.css'

interface BlankValue {
  heading: string
  body: string
  accent: string
}

const DEFAULT_VALUE: BlankValue = { heading: '', body: '', accent: '#7ec8e3' }

export function BlankWidget({
  value = DEFAULT_VALUE,
  onChange = () => {},
}: {
  value?: BlankValue
  onChange?: (value: BlankValue) => void
}) {
  const { t } = useLocale()

  return (
    <div className={styles.blank} style={{ '--widget-accent': value.accent } as CSSProperties}>
      <div className={styles.blankHeader}>
        <input
          value={value.heading}
          maxLength={60}
          placeholder={t('blankHeadingPlaceholder')}
          onChange={(event) => onChange({ ...value, heading: event.target.value })}
          aria-label={t('blankHeadingPlaceholder')}
        />
        <input
          type="color"
          value={value.accent}
          onChange={(event) => onChange({ ...value, accent: event.target.value })}
          aria-label={t('blankAccent')}
        />
      </div>
      <textarea
        value={value.body}
        maxLength={2_000}
        placeholder={t('blankBodyPlaceholder')}
        onChange={(event) => onChange({ ...value, body: event.target.value })}
        aria-label={t('blankBodyPlaceholder')}
      />
    </div>
  )
}
