import { useCallback, useEffect, useMemo, useState } from 'react'
import { describeImportResult, type BrowserImportResult } from '../../core/browserImportResult'
import { buildGoogleBrowserSignInUrl } from '../../core/googleBrowserSession'
import { withWorkingState } from '../../core/workingState'
import type { SavedPassword } from '../../core/passwordVault'
import { tf } from '../../core/locale'
import { useBrowserImport } from '../../hooks/useBrowserImport'
import { useLocale } from '../../hooks/useLocale'
import { usePasswordVault } from '../../hooks/usePasswordVault'
import { isTauri } from '../../platform/runtime'
import { BrowserSourceList } from '../BrowserImport/BrowserSourceList'
import { PasswordConflictList } from '../BrowserImport/PasswordConflictList'
import styles from './GoogleAccountSetupModal.module.css'

interface GoogleAccountSetupPanelProps {
  email: string
  onOpenBrowseUrl: (url: string) => void
  onMergePasswords: (entries: Array<Omit<SavedPassword, 'id' | 'updatedAt'>>) => void | Promise<void>
  onRequestCsvImport?: () => void
  onApplied?: () => void
  showSkip?: boolean
  onSkip?: () => void
}

// Only passwords are offered here, and the default browser's are ticked once the user has asked for the import.
const OFFER = { bookmarks: false, passwords: true } as const
const DEFAULTS = { passwords: true } as const

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
  const { entries: vaultEntries } = usePasswordVault()
  const [linkBrowserSession, setLinkBrowserSession] = useState(false)
  const [working, setWorking] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [statusError, setStatusError] = useState(false)
  const [needsCsv, setNeedsCsv] = useState(false)
  // Reading other browsers' passwords is the user's choice: nothing is read until they ask for it.
  const [importPasswords, setImportPasswords] = useState(false)
  const imp = useBrowserImport({
    offer: OFFER,
    defaults: DEFAULTS,
    load: importPasswords,
    existingPasswords: vaultEntries,
    onPasswords: onMergePasswords,
    nebulaName: t('gsConflictNebula'),
  })
  const { reset: resetImport } = imp

  useEffect(() => {
    setImportPasswords(false)
    setLinkBrowserSession(false)
    setWorking(false)
    setStatusMessage(null)
    setStatusError(false)
    setNeedsCsv(false)
    resetImport()
  }, [email, resetImport])

  const translate = useMemo(
    () => ({ t, tf: (key: Parameters<typeof tf>[1], vars: Record<string, string | number>) => tf(locale, key, vars) }),
    [locale, t],
  )

  /** The last step: Google session linking, the status line, and closing the setup. */
  const finishApply = useCallback(
    (result: BrowserImportResult | null) => {
      const description = result
        ? describeImportResult(result, imp.names, translate)
        : { lines: [] as string[], error: false, needsCsv: false }
      const messages = [...description.lines]
      if (linkBrowserSession && isTauri) {
        onOpenBrowseUrl(buildGoogleBrowserSignInUrl(email))
        messages.push(t('gsSessionBackground'))
      } else if (linkBrowserSession) {
        messages.push(t('gsWebUnsupported'))
      }

      setStatusMessage(messages.join(' '))
      setStatusError(description.error)
      setNeedsCsv(description.needsCsv)
      if (!description.needsCsv) {
        window.setTimeout(() => onApplied?.(), 400)
      }
    },
    [email, imp.names, linkBrowserSession, onApplied, onOpenBrowseUrl, t, translate],
  )

  const handleApply = useCallback(async () => {
    setStatusMessage(null)
    setStatusError(false)
    setNeedsCsv(false)

    await withWorkingState(setWorking, async () => {
      let result: BrowserImportResult | null = null
      if (importPasswords) {
        if (!isTauri) {
          setStatusMessage(t('gsImportDesktopOnly'))
          setStatusError(true)
          return
        }
        const outcome = await imp.run()
        if (outcome.status === 'invalid') {
          setStatusMessage(t(imp.sources && imp.sources.length === 0 ? 'importNoBrowsers' : 'importNothingChosen'))
          setStatusError(true)
          return
        }
        // The decision screen is shown; the setup finishes when the user has chosen.
        if (outcome.status === 'conflicts') return
        result = outcome.result
      }
      finishApply(result)
    })
  }, [finishApply, imp, importPasswords, t])

  const handleConfirmConflicts = useCallback(async () => {
    await withWorkingState(setWorking, async () => {
      finishApply(await imp.confirmConflicts())
    })
  }, [finishApply, imp])

  const busy = working || imp.working

  if (imp.phase === 'conflicts' && imp.plan) {
    return (
      <div className={styles.inlinePanel}>
        <PasswordConflictList
          plan={imp.plan}
          picks={imp.picks}
          onPick={imp.pick}
          names={imp.names}
          disabled={busy}
        />
        <div className={styles.inlineActions}>
          <button type="button" className={styles.ghostBtn} onClick={imp.backFromConflicts} disabled={busy}>
            {t('gsConflictBack')}
          </button>
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={() => void handleConfirmConflicts()}
            disabled={busy}
          >
            {busy ? t('gsApplying') : t('gsConflictApply')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.inlinePanel}>
      <p className={styles.lead}>{tf(locale, 'gsLead', { email })}</p>

      <div className={styles.body}>
        <label className={styles.option}>
          <input
            type="checkbox"
            checked={importPasswords}
            onChange={(event) => setImportPasswords(event.target.checked)}
            disabled={busy}
          />
          <span className={styles.optionText}>
            {t('gsImportPasswords')}
            <span className={styles.optionHint}>{t('gsImportPasswordsHint')}</span>
          </span>
        </label>

        {importPasswords && isTauri && imp.sourcesError && (
          <div className={styles.browserList}>
            <p className={styles.optionHint}>{t('importListFailed')}</p>
            <p className={styles.optionHint}>{imp.sourcesError}</p>
            <button type="button" className={styles.ghostBtn} onClick={imp.retryLoad}>
              {t('importRetry')}
            </button>
          </div>
        )}

        {importPasswords && isTauri && imp.sources !== null && (
          <div className={styles.browserList}>
            <p className={styles.optionHint}>{t('gsBrowsersLead')}</p>
            <BrowserSourceList
              sources={imp.sources}
              choices={imp.choices}
              offer={OFFER}
              onChoice={imp.setChoice}
              onToggleBrowser={imp.toggleBrowser}
              disabled={busy}
              onRequestCsvImport={onRequestCsvImport}
            />
          </div>
        )}

        <label className={styles.option}>
          <input
            type="checkbox"
            checked={linkBrowserSession}
            onChange={(event) => setLinkBrowserSession(event.target.checked)}
            disabled={busy || !isTauri}
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
          <button type="button" className={styles.ghostBtn} onClick={onSkip} disabled={busy}>
            {t('gsSkip')}
          </button>
        )}
        <button type="button" className={styles.primaryBtn} onClick={() => void handleApply()} disabled={busy}>
          {busy ? t('gsApplying') : t('gsApply')}
        </button>
      </div>
    </div>
  )
}
