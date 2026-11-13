import type { CSSProperties, ReactNode } from 'react'
import { showAppConfirmation } from '../../core/appDialog'
import { useLocale } from '../../hooks/useLocale'
import styles from './SettingsPanel.module.css'

export function SettingToggleRow({
  label,
  hint,
  checked,
  disabled = false,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  disabled?: boolean
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
        aria-label={label}
        disabled={disabled}
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
          style={
            {
              '--fill': `${Math.round(((value - min) / (max - min || 1)) * 100)}%`,
            } as CSSProperties
          }
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

/** A box for several lines of text, under its label. What is typed is handed over when the box is left, not on every key. */
export function SettingTextAreaRow({
  label,
  hint,
  value,
  placeholder,
  onChange,
}: {
  label: string
  hint: string
  value: string
  placeholder?: string
  onChange: (value: string) => void
}) {
  return (
    <div className={`${styles.row} ${styles.rowStacked}`}>
      <div className={styles.rowText}>
        <div className={styles.rowLabel}>{label}</div>
        <div className={styles.rowHint}>{hint}</div>
      </div>
      {/* Uncontrolled, and remade when the saved value changes from elsewhere (a restore, a reset). */}
      <textarea
        key={value}
        className={styles.textArea}
        defaultValue={value}
        placeholder={placeholder}
        rows={5}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        onBlur={(event) => {
          if (event.target.value !== value) onChange(event.target.value)
        }}
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
          void showAppConfirmation(confirmMessage, label).then((accepted) => {
            if (accepted) onConfirm()
          })
        }}
      >
        {resolvedButtonLabel}
      </button>
    </div>
  )
}

/** A card of settings with a small heading above it. */
export function SettingGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className={styles.group}>
      {title && <h3 className={styles.groupTitle}>{title}</h3>}
      <div className={styles.groupBody}>{children}</div>
    </section>
  )
}

/** The Advanced sections that were opened, kept while the window lives so a page left and come back to stays as it was. */
const openedAdvanced = new Set<string>()

/** Settings most people never touch: closed until opened, so the page shows what matters first. */
export function SettingAdvanced({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details
      className={styles.advanced}
      open={openedAdvanced.has(title)}
      onToggle={(event) => {
        if (event.currentTarget.open) openedAdvanced.add(title)
        else openedAdvanced.delete(title)
      }}
    >
      <summary className={styles.advancedSummary}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 6l6 6-6 6" />
        </svg>
        {title}
      </summary>
      <div className={styles.advancedBody}>{children}</div>
    </details>
  )
}
