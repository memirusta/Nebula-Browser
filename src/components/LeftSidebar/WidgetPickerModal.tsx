import { useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  ADDABLE_WIDGET_TYPES,
  getWidgetLabel,
  isWidgetTypeEnabled,
  type WidgetType,
} from '../../core/widgets'
import { useLocale } from '../../hooks/useLocale'
import { useDialogFocusTrap } from '../../hooks/useDialogFocusTrap'
import styles from './WidgetPickerModal.module.css'

interface HomeWidgetSettings {
  showRamWidget: boolean
  showCpuWidget: boolean
}

interface WidgetPickerModalProps {
  open: boolean
  onClose: () => void
  onAdd: (type: WidgetType) => void
  activeTypes: Set<WidgetType>
  settings: HomeWidgetSettings
  onExport: () => void
  onImport: () => void
}

const WIDGET_ICONS: Record<WidgetType, string> = {
  ram: '◫',
  cpu: '◎',
  clock: '◷',
  blank: '▢',
  notes: '✎',
  weather: '☼',
  calendar: '▦',
  quickLinks: '↗',
  network: '⇅',
}

export function WidgetPickerModal({
  open,
  onClose,
  onAdd,
  activeTypes,
  settings,
  onExport,
  onImport,
}: WidgetPickerModalProps) {
  const { t, tf, locale } = useLocale()
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useDialogFocusTrap({ active: open, containerRef: panelRef, initialFocusRef: closeRef, onEscape: onClose })

  if (!open) return null

  return createPortal(
    <>
      <div className={styles.backdrop} onClick={onClose} aria-hidden="true" />
      <div ref={panelRef} className={styles.panel} role="dialog" aria-modal="true" aria-label={t('widgetPickerAria')} tabIndex={-1}>
        <header className={styles.header}>
          <h2 className={styles.title}>{t('widgetPickerTitle')}</h2>
          <div className={styles.headerActions}>
            <button type="button" className={styles.backupBtn} onClick={onImport}>{t('widgetImport')}</button>
            <button type="button" className={styles.backupBtn} onClick={onExport}>{t('widgetExport')}</button>
            <button ref={closeRef} type="button" className={styles.closeBtn} onClick={onClose} aria-label={t('titleClose')}>
              ✕
            </button>
          </div>
        </header>
        <ul className={styles.list}>
          {ADDABLE_WIDGET_TYPES.map((type) => {
            const label = getWidgetLabel(locale, type)
            const enabled = isWidgetTypeEnabled(type, settings)
            const singleton = ['ram', 'cpu', 'calendar', 'network'].includes(type)
            const alreadyAdded = singleton && activeTypes.has(type)
            const disabled = !enabled || alreadyAdded

            return (
              <li key={type}>
                <button
                  type="button"
                  className={styles.option}
                  disabled={disabled}
                  onClick={() => {
                    onAdd(type)
                    onClose()
                  }}
                  title={
                    !enabled
                      ? t('widgetDisabledSettings')
                      : alreadyAdded
                        ? t('widgetAlreadyAdded')
                        : tf('widgetAddTitle', { name: label })
                  }
                >
                  <span className={styles.optionIcon} aria-hidden="true">
                    {WIDGET_ICONS[type]}
                  </span>
                  <span className={styles.optionLabel}>{label}</span>
                  {alreadyAdded && <span className={styles.optionBadge}>{t('widgetAddedBadge')}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </>,
    document.body,
  )
}
