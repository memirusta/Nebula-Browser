import { useRef } from 'react'
import { useLocale } from '../../hooks/useLocale'
import { useDialogFocusTrap } from '../../hooks/useDialogFocusTrap'
import styles from './CrashRecoveryPrompt.module.css'

interface CrashRecoveryPromptProps {
  tabCount: number
  onRestore: () => void
  onDismiss: () => void
}

function RestoreGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 8.5A8 8 0 1 1 4.4 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M5 4.5v4H9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function CrashRecoveryPrompt({ tabCount, onRestore, onDismiss }: CrashRecoveryPromptProps) {
  const { t, tf } = useLocale()
  const restoreRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLElement>(null)

  useDialogFocusTrap({
    active: true,
    containerRef: dialogRef,
    initialFocusRef: restoreRef,
    onEscape: onDismiss,
  })

  return (
    <div className={styles.backdrop} role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onDismiss()
    }}>
      <section ref={dialogRef} className={styles.card} role="alertdialog" aria-modal="true" aria-labelledby="crash-recovery-title" tabIndex={-1}>
        <div className={styles.icon}><RestoreGlyph /></div>
        <div className={styles.copy}>
          <span className={styles.eyebrow}>NEBULA</span>
          <h2 id="crash-recovery-title">{t('crashRecoveryTitle')}</h2>
          <p>{t('crashRecoveryBody')}</p>
          <span className={styles.meta}>{tf('crashRecoveryTabs', { n: tabCount })}</span>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={onDismiss}>
            {t('crashRecoveryDismiss')}
          </button>
          <button ref={restoreRef} type="button" className={styles.primary} onClick={onRestore}>
            <RestoreGlyph />
            {t('crashRecoveryRestore')}
          </button>
        </div>
      </section>
    </div>
  )
}
