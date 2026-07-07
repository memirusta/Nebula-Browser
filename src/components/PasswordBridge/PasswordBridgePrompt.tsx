import { createPortal } from 'react-dom'
import type { SavedPassword } from '../../core/passwordVault'
import { useLocale } from '../../hooks/useLocale'
import type { PasswordBridgeOffer } from '../../hooks/usePasswordBridge'
import styles from './PasswordBridgePrompt.module.css'

interface PasswordBridgePromptProps {
  offer: PasswordBridgeOffer | null
  onDismiss: () => void
  onFill: (entry: SavedPassword) => void
  onSave: () => void
}

export function PasswordBridgePrompt({
  offer,
  onDismiss,
  onFill,
  onSave,
}: PasswordBridgePromptProps) {
  const { t, tf } = useLocale()

  if (!offer) return null

  const siteLabel = offer.label

  return createPortal(
    <div className={styles.wrap} role="presentation">
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="password-bridge-title"
      >
        <header className={styles.header}>
          <h2 id="password-bridge-title" className={styles.title}>
            {offer.mode === 'fill' ? t('pwdFillTitle') : t('pwdSaveTitle')}
          </h2>
          <p className={styles.lead}>
            {offer.mode === 'fill'
              ? tf('pwdFillLead', { site: siteLabel })
              : tf('pwdSaveLead', { site: siteLabel, user: offer.username })}
          </p>
        </header>

        {offer.mode === 'fill' && offer.matches && offer.matches.length > 1 ? (
          <ul className={styles.accountList}>
            {offer.matches.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  className={styles.accountBtn}
                  onClick={() => onFill(entry)}
                >
                  <span className={styles.accountUser}>{entry.username}</span>
                  {entry.label ? <span className={styles.accountMeta}>{entry.label}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <footer className={styles.footer}>
          <button type="button" className={styles.ghostBtn} onClick={onDismiss}>
            {t('pwdDismiss')}
          </button>
          {offer.mode === 'fill' ? (
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() => {
                const entry = offer.matches?.[0]
                if (entry) onFill(entry)
              }}
            >
              {t('pwdFillBtn')}
            </button>
          ) : (
            <button type="button" className={styles.primaryBtn} onClick={onSave}>
              {t('pwdSaveBtn')}
            </button>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  )
}
