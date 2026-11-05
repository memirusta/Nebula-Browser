import { useCallback, useMemo, useRef, useState } from 'react'
import { describeImportResult } from '../../core/browserImportResult'
import { tf } from '../../core/locale'
import { mergeImportedPasswords, parsePasswordCsv } from '../../core/passwordImport'
import { planImport, resolveImport } from '../../core/passwordImportCompare'
import type { Shortcut } from '../../core/types'
import { useBrowserImport } from '../../hooks/useBrowserImport'
import { useLocale } from '../../hooks/useLocale'
import { usePasswordVault } from '../../hooks/usePasswordVault'
import { isTauri } from '../../platform/runtime'
import { BrowserSourceList } from '../BrowserImport/BrowserSourceList'
import { PasswordConflictList } from '../BrowserImport/PasswordConflictList'
import importStyles from '../BrowserImport/BrowserImport.module.css'
import styles from './OnboardingWizard.module.css'

// What this step offers, and what is ticked for the default browser: bookmarks are what this step was always
// for; passwords are the user's choice. Constants, so the import hook sees the same objects on every render.
const OFFER = { bookmarks: true, passwords: true } as const
const DEFAULTS = { bookmarks: true, passwords: false } as const

interface OnboardingImportStepProps {
  /** The shortcuts made from the imported bookmarks (called once per import). */
  onShortcuts: (shortcuts: Shortcut[]) => void
  /** How many passwords were just saved to the vault. */
  onPasswordsAdded: (count: number) => void
}

/**
 * First-run step: bring bookmarks (and, if wanted, saved passwords) over from the browsers found on this computer.
 * Only the browsers the user ticks are read.
 */
export function OnboardingImportStep({ onShortcuts, onPasswordsAdded }: OnboardingImportStepProps) {
  const { locale, t } = useLocale()
  const { entries: vaultEntries } = usePasswordVault()
  const csvInput = useRef<HTMLInputElement>(null)
  const [csvMessage, setCsvMessage] = useState<{ text: string; error: boolean } | null>(null)

  const imp = useBrowserImport({
    offer: OFFER,
    defaults: DEFAULTS,
    load: true,
    existingPasswords: vaultEntries,
    onBookmarkShortcuts: onShortcuts,
    onPasswords: async (entries) => {
      await mergeImportedPasswords(entries)
      onPasswordsAdded(entries.length)
    },
    nebulaName: t('gsConflictNebula'),
  })

  const translate = useMemo(
    () => ({ t, tf: (key: Parameters<typeof tf>[1], vars: Record<string, string | number>) => tf(locale, key, vars) }),
    [locale, t],
  )
  const description = imp.result ? describeImportResult(imp.result, imp.names, translate) : null

  const handleCsv = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file) return
      const rows = parsePasswordCsv(await file.text())
      if (rows.length === 0) {
        setCsvMessage({ text: t('accountCsvEmpty'), error: true })
        return
      }
      const entries = resolveImport(planImport(rows, vaultEntries))
      await mergeImportedPasswords(entries)
      onPasswordsAdded(entries.length)
      setCsvMessage({ text: tf(locale, 'gsImportDone', { count: entries.length }), error: false })
    },
    [locale, onPasswordsAdded, t, vaultEntries],
  )

  const intro = (
    <div className={styles.bookmarkIntro}>
      <h2 className={styles.title}>{t('importStepTitle')}</h2>
      <p className={styles.lead}>{isTauri ? t('importStepLead') : t('importWebOnly')}</p>
    </div>
  )

  if (!isTauri) {
    return <div className={styles.bookmarkStep}>{intro}</div>
  }

  if (imp.phase === 'conflicts' && imp.plan) {
    return (
      <div className={styles.bookmarkStep}>
        <div>
          <PasswordConflictList
            plan={imp.plan}
            picks={imp.picks}
            onPick={imp.pick}
            names={imp.names}
            disabled={imp.working}
          />
        </div>
        <div className={importStyles.actions}>
          <button type="button" className={importStyles.csvButton} onClick={imp.backFromConflicts} disabled={imp.working}>
            {t('gsConflictBack')}
          </button>
          <button
            type="button"
            className={styles.bookmarkImportButton}
            onClick={() => void imp.confirmConflicts()}
            disabled={imp.working}
          >
            {imp.working ? t('importRunning') : t('gsConflictApply')}
          </button>
        </div>
      </div>
    )
  }

  const found = imp.sources !== null && imp.sources.length > 0

  return (
    <div className={styles.bookmarkStep}>
      {intro}

      {imp.sourcesError ? (
        <div className={importStyles.resultError}>
          <p className={importStyles.resultLine}>{t('importListFailed')}</p>
          <p className={importStyles.resultLine}>{imp.sourcesError}</p>
          <button type="button" className={importStyles.csvButton} onClick={imp.retryLoad}>
            {t('importRetry')}
          </button>
        </div>
      ) : imp.sources === null ? (
        <p className={importStyles.hint}>{t('importSearching')}</p>
      ) : (
        <>
          <BrowserSourceList
            sources={imp.sources}
            choices={imp.choices}
            offer={OFFER}
            onChoice={imp.setChoice}
            onToggleBrowser={imp.toggleBrowser}
            disabled={imp.working}
            onRequestCsvImport={() => csvInput.current?.click()}
          />
        </>
      )}

      <input
        ref={csvInput}
        type="file"
        accept=".csv,text/csv"
        className={importStyles.hiddenFile}
        onChange={(event) => void handleCsv(event)}
      />

      {found && (
        <div className={importStyles.actions}>
          <button
            type="button"
            className={styles.bookmarkImportButton}
            onClick={() => void imp.run()}
            disabled={imp.working}
          >
            {imp.working ? t('importRunning') : t('importRun')}
          </button>
        </div>
      )}

      {imp.problem && <p className={styles.bookmarkError}>{t('importNothingChosen')}</p>}

      {description && description.lines.length > 0 && (
        <div className={description.error ? importStyles.resultError : styles.bookmarkSuccessCard}>
          {!description.error && (
            <div className={styles.bookmarkSuccessIcon} aria-hidden="true">
              ✓
            </div>
          )}
          <div className={importStyles.resultText}>
            {!description.error && <strong>{t('importDone')}</strong>}
            {description.lines.map((line) => (
              <p key={line} className={importStyles.resultLine}>
                {line}
              </p>
            ))}
          </div>
        </div>
      )}

      {csvMessage && (
        <p className={csvMessage.error ? styles.bookmarkError : importStyles.hint}>{csvMessage.text}</p>
      )}
    </div>
  )
}
