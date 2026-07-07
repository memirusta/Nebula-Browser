import { useLocale } from '../../hooks/useLocale'
import styles from './SettingsPanel.module.css'

export function SettingToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  onChange: () => void
}) {
  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <div className={styles.rowLabel}>{label}</div>
        <div className={styles.rowHint}>{hint}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className={`${styles.toggle} ${checked ? styles.toggleOn : ''}`}
        onClick={onChange}
      >
        <span className={styles.toggleThumb} />
      </button>
    </div>
  )
}

export function SettingRangeRow({
  label,
  hint,
  value,
  min,
  max,
  step,
  unit,
  disabled = false,
  onChange,
}: {
  label: string
  hint: string
  value: number
  min: number
  max: number
  step: number
  unit: string
  disabled?: boolean
  onChange: (value: number) => void
}) {
  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <div className={styles.rowLabel}>{label}</div>
        <div className={styles.rowHint}>{hint}</div>
      </div>
      <div className={styles.rangeControl}>
        <input
          type="range"
          className={styles.rangeInput}
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={label}
        />
        <span className={styles.rangeValue}>
          {value}
          {unit}
        </span>
      </div>
    </div>
  )
}

export function SettingSelectRow({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string
  hint: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <div className={styles.rowLabel}>{label}</div>
        <div className={styles.rowHint}>{hint}</div>
      </div>
      <select
        className={styles.select}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
}

export function SettingTextRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string
  hint: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <div className={styles.rowLabel}>{label}</div>
        <div className={styles.rowHint}>{hint}</div>
      </div>
      <input
        type="text"
        className={styles.textInput}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
      />
    </div>
  )
}

export function SettingColorRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string
  hint: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <div className={styles.rowLabel}>{label}</div>
        <div className={styles.rowHint}>{hint}</div>
      </div>
      <input
        type="color"
        className={styles.colorInput}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
      />
    </div>
  )
}

export function SettingResetRow({
  label,
  hint,
  onReset,
}: {
  label: string
  hint: string
  onReset: () => void
}) {
  const { t } = useLocale()

  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <div className={styles.rowLabel}>{label}</div>
        <div className={styles.rowHint}>{hint}</div>
      </div>
      <button type="button" className={styles.actionBtn} onClick={onReset}>
        {t('reset')}
      </button>
    </div>
  )
}

export function SettingDangerRow({
  label,
  hint,
  confirmMessage,
  buttonLabel,
  onConfirm,
}: {
  label: string
  hint: string
  confirmMessage: string
  buttonLabel?: string
  onConfirm: () => void
}) {
  const { t } = useLocale()
  const resolvedButtonLabel = buttonLabel ?? t('reset')

  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <div className={styles.rowLabel}>{label}</div>
        <div className={styles.rowHint}>{hint}</div>
      </div>
      <button
        type="button"
        className={`${styles.actionBtn} ${styles.dangerBtn}`}
        onClick={() => {
          if (window.confirm(confirmMessage)) onConfirm()
        }}
      >
        {resolvedButtonLabel}
      </button>
    </div>
  )
}

export function SettingSoonRow({ label, hint }: { label: string; hint: string }) {
  const { t } = useLocale()

  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <div className={styles.rowLabel}>{label}</div>
        <div className={styles.rowHint}>{hint}</div>
      </div>
      <span className={styles.badgeSoon}>{t('geckoSoon')}</span>
    </div>
  )
}
