import { useCallback, useEffect, useState } from 'react'
import { syncPasswordsFromBrowser } from '../../core/googleAccountSetup'
import {
  buildGoogleBrowserSignInUrl,
  markGoogleBrowserSessionLinked,
} from '../../core/googleBrowserSession'
import type { SavedPassword } from '../../core/passwordVault'
import { tf } from '../../core/locale'
import { useLocale } from '../../hooks/useLocale'
import { isTauri } from '../../platform/runtime'
import styles from './GoogleAccountSetupModal.module.css'

interface GoogleAccountSetupPanelProps {
  email: string
  onOpenBrowseUrl: (url: string) => void
  onMergePasswords: (entries: Array<Omit<SavedPassword, 'id' | 'updatedAt'>>) => void
  onRequestCsvImport?: () => void
  onApplied?: () => void
  showSkip?: boolean
  onSkip?: () => void
}

export function GoogleAccountSetupPanel({
  email,
  onOpenBrowseUrl,
  onMergePasswords,
  onRequestCsvImport,
  onApplied,
  showSkip = false,
  onSkip,
}: GoogleAccountSetupPanelProps) {
  const { locale, t } = useLocale()
  const [importPasswords, setImportPasswords] = useState(true)
  const [linkBrowserSession, setLinkBrowserSession] = useState(true)
  const [working, setWorking] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [statusError, setStatusError] = useState(false)
  const [needsCsv, setNeedsCsv] = useState(false)

  useEffect(() => {
    setImportPasswords(true)
    setLinkBrowserSession(true)
    setWorking(false)
    setStatusMessage(null)
    setStatusError(false)
    setNeedsCsv(false)
  }, [email])

  const handleApply = useCallback(async () => {
    setWorking(true)
    setStatusMessage(null)
    setStatusError(false)
    setNeedsCsv(false)

    const messages: string[] = []
    let csvNeeded = false

    if (importPasswords) {
      const result = await syncPasswordsFromBrowser('chrome')
      if (result.ok) {
        onMergePasswords(
          result.imported.map((item) => ({
            label: item.label,
            url: item.url,
            username: item.username,
            password: item.password,
          })),
        )
        messages.push(result.message)
      } else {
        messages.push(result.message)
        setStatusError(true)
        csvNeeded = result.needsCsv
        setNeedsCsv(result.needsCsv)
      }
    }

    if (linkBrowserSession && isTauri) {
      markGoogleBrowserSessionLinked(email)
      onOpenBrowseUrl(buildGoogleBrowserSignInUrl(email))
      messages.push(t('gsSessionBackground'))
    } else if (linkBrowserSession) {
      messages.push(t('gsWebUnsupported'))
    }

    setStatusMessage(messages.join(' '))
    setWorking(false)

    if (!csvNeeded) {
      window.setTimeout(() => onApplied?.(), 400)
    }
  }, [email, importPasswords, linkBrowserSession, onApplied, onMergePasswords, onOpenBrowseUrl, t])

  return (
    <div className={styles.inlinePanel}>
      <p className={styles.lead}>{tf(locale, 'gsLead', { email })}</p>

      <div className={styles.body}>
        <label className={styles.option}>
          <input
            type="checkbox"
            checked={importPasswords}
            onChange={(event) => setImportPasswords(event.target.checked)}
            disabled={working}
          />
          <span className={styles.optionText}>
            {t('gsImportPasswords')}
            <span className={styles.optionHint}>{t('gsImportPasswordsHint')}</span>
          </span>
        </label>

        <label className={styles.option}>
          <input
            type="checkbox"
            checked={linkBrowserSession}
            onChange={(event) => setLinkBrowserSession(event.target.checked)}
            disabled={working || !isTauri}
          />
          <span className={styles.optionText}>
            {t('gsLinkSession')}
            <span className={styles.optionHint}>{t('gsLinkSessionHint')}</span>
          </span>
        </label>

        {statusMessage && (
          <p
            className={[styles.status, statusError ? styles.statusError : styles.statusSuccess]
              .filter(Boolean)
              .join(' ')}
          >
            {statusMessage}
          </p>
        )}

        {needsCsv && onRequestCsvImport && (
          <button type="button" className={styles.ghostBtn} onClick={onRequestCsvImport}>
            {t('gsCsvPick')}
          </button>
        )}
      </div>

      <div className={styles.inlineActions}>
        {showSkip && onSkip && (
          <button type="button" className={styles.ghostBtn} onClick={onSkip} disabled={working}>
            {t('gsSkip')}
          </button>
        )}
        <button type="button" className={styles.primaryBtn} onClick={() => void handleApply()} disabled={working}>
          {working ? t('gsApplying') : t('gsApply')}
        </button>
      </div>
    </div>
  )
}
