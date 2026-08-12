import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { SavedPassword } from '../../core/passwordVault'
import { useLocale } from '../../hooks/useLocale'
import { useModalFocusTrap } from '../../hooks/useModalFocusTrap'
import baseStyles from '../SiteUiPrompt/SiteUiPrompt.module.css'
import styles from './PasswordFillPrompt.module.css'

interface PasswordFillPromptProps {
  site: string
  pageUrl: string
  matches: SavedPassword[]
  onFill: (entry: SavedPassword) => void
  onDismiss: () => void
}

function originText(url: string, fallback: string): string {
  try {
    return new URL(url).origin
  } catch {
    return fallback
  }
}

function accountInitial(username: string): string {
  return username.trim().slice(0, 1).toUpperCase() || '?'
}

export function PasswordFillPrompt({
  site,
  pageUrl,
  matches,
  onFill,
  onDismiss,
}: PasswordFillPromptProps) {
  const { t, tf } = useLocale()
  const dialogRef = useRef<HTMLElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)
  useModalFocusTrap(dialogRef, true)

  const multipleAccounts = matches.length > 1
  const first = matches[0]

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (multipleAccounts) {
        dialogRef.current?.focus()
      } else {
        primaryRef.current?.focus()
      }
    }, 0)
    return () => window.clearTimeout(timer)
  }, [multipleAccounts])

  return createPortal(
    <div className={baseStyles.backdrop} role="presentation">
      <section
        ref={dialogRef}
        className={baseStyles.card}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="nebula-password-fill-title"
        aria-describedby="nebula-password-fill-message"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onDismiss()
          }
          if (event.key === 'Enter' && !multipleAccounts && first) {
            event.preventDefault()
            onFill(first)
          }
        }}
      >
        <div className={baseStyles.headerRow}>
          <div className={baseStyles.siteMark}>{site.slice(0, 1).toUpperCase() || 'N'}</div>
          <div className={baseStyles.heading}>
            <span>Nebula</span>
            <h2 id="nebula-password-fill-title">{t('pwdFillTitle')}</h2>
          </div>
        </div>

        <p id="nebula-password-fill-message" className={baseStyles.message}>
          {tf('pwdFillLead', { site })}
        </p>
        <div className={baseStyles.origin}>{originText(pageUrl, pageUrl)}</div>

        {multipleAccounts && (
          <div className={styles.accountPicker}>
            <div className={styles.accountPickerLabel}>{t('pwdChooseAccount')}</div>
            <div className={styles.accountList}>
              {matches.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={styles.accountRow}
                  onClick={() => onFill(entry)}
                  title={entry.username}
                >
                  <span className={styles.accountAvatar} aria-hidden="true">
                    {accountInitial(entry.username)}
                  </span>
                  <span className={styles.accountText}>
                    <strong>{entry.username}</strong>
                    <span>{t('pwdAccountFillHint')}</span>
                  </span>
                  <span className={styles.accountChevron} aria-hidden="true">›</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className={baseStyles.actions}>
          <button type="button" className={baseStyles.secondary} onClick={onDismiss}>
            {t('pwdDismiss')}
          </button>
          {!multipleAccounts && first && (
            <button
              ref={primaryRef}
              type="button"
              className={baseStyles.primary}
              onClick={() => onFill(first)}
              title={first.username}
            >
              {t('pwdFillBtn')}
            </button>
          )}
        </div>
      </section>
    </div>,
    document.body,
  )
}
