import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  ADDABLE_WIDGET_TYPES,
  WIDGET_LABELS,
  isWidgetTypeEnabled,
  type WidgetType,
} from '../../core/widgets'
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
}

const WIDGET_ICONS: Record<WidgetType, string> = {
  ram: '◫',
  cpu: '◎',
  clock: '◷',
  blank: '▢',
  notes: '✎',
}

export function WidgetPickerModal({
  open,
  onClose,
  onAdd,
  activeTypes,
  settings,
}: WidgetPickerModalProps) {
  useEffect(() => {
    if (!open) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <>
      <div className={styles.backdrop} onClick={onClose} aria-hidden="true" />
      <div className={styles.panel} role="dialog" aria-modal="true" aria-label="Widget ekle">
        <header className={styles.header}>
          <h2 className={styles.title}>Widget Ekle</h2>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Kapat">
            ✕
          </button>
        </header>
        <ul className={styles.list}>
          {ADDABLE_WIDGET_TYPES.map((type) => {
            const enabled = isWidgetTypeEnabled(type, settings)
            const singleton = type === 'ram' || type === 'cpu'
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
                      ? 'Ayarlardan kapalı'
                      : alreadyAdded
                        ? 'Zaten eklendi'
                        : `${WIDGET_LABELS[type]} ekle`
                  }
                >
                  <span className={styles.optionIcon} aria-hidden="true">
                    {WIDGET_ICONS[type]}
                  </span>
                  <span className={styles.optionLabel}>{WIDGET_LABELS[type]}</span>
                  {alreadyAdded && <span className={styles.optionBadge}>Eklendi</span>}
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
