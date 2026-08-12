import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useLocale } from '../../hooks/useLocale'
import { useModalFocusTrap } from '../../hooks/useModalFocusTrap'
import styles from '../SiteUiPrompt/SiteUiPrompt.module.css'

interface PasswordSavePromptProps {
  site: string
  pageUrl: string
  username: string
  onSave: () => void
  onDismiss: () => void
}

function originText(url: string, fallback: string): string {
  try {
    return new URL(url).origin
  } catch {
    return fallback
  }
}

export function PasswordSavePrompt({
  site,
  pageUrl,
  username,
  onSave,
  onDismiss,
}: PasswordSavePromptProps) {
  const { t, tf } = useLocale()
  const dialogRef = useRef<HTMLElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)
  useModalFocusTrap(dialogRef, true)

  useEffect(() => {
    const timer = window.setTimeout(() => primaryRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [])

  return createPortal(
    <div className={styles.backdrop} role="presentation">
      <section
        ref={dialogRef}
        className={styles.card}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="nebula-password-save-title"
        aria-describedby="nebula-password-save-message"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onDismiss()
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            onSave()
          }
        }}
      >
        <div className={styles.headerRow}>
          <div className={styles.siteMark}>{site.slice(0, 1).toUpperCase() || 'N'}</div>
          <div className={styles.heading}>
            <span>Nebula</span>
            <h2 id="nebula-password-save-title">{t('pwdSaveTitle')}</h2>
          </div>
        </div>

        <p id="nebula-password-save-message" className={styles.message}>
          {tf('pwdSaveLead', { site, user: username })}
        </p>
        <div className={styles.origin}>{originText(pageUrl, pageUrl)}</div>

        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={onDismiss}>
            {t('pwdDismiss')}
          </button>
          <button
            ref={primaryRef}
            type="button"
            className={styles.primary}
            onClick={onSave}
          >
            {t('pwdSaveBtn')}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  )
}
