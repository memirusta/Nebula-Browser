import { useCallback, useEffect, useRef, useState } from 'react'
import type { NebulaAccount } from '../../core/nebulaAccount'
import {
  isGoogleSignInSupported,
  nebulaAccountFromGoogleClaims,
  signInWithGoogleProfile,
} from '../../core/googleSignIn'
import { GoogleAccountSetupModal } from '../GoogleAccountSetupModal/GoogleAccountSetupModal'
import {
  buildGoogleBrowserSignInUrl,
  loadGoogleBrowserSession,
  markGoogleBrowserSessionLinked,
} from '../../core/googleBrowserSession'
import { parsePasswordCsv } from '../../core/passwordImport'
import { getGoogleOAuthStatus } from '../../platform/googleOAuth'
import {
  importDefaultBrowserPasswords,
  listChromiumPasswordSources,
  type ChromiumPasswordSource,
} from '../../platform/browserPasswordImport'
import { isTauri } from '../../platform/runtime'
import { usePasswordVault } from '../../hooks/usePasswordVault'
import { tf } from '../../core/locale'
import { useLocale } from '../../hooks/useLocale'
import styles from './SettingsPanel.module.css'

interface AccountSettingsSectionProps {
  account: NebulaAccount | null
  userDisplayName: string
  onAccountChange: (account: NebulaAccount) => void
  onDisplayNameChange: (name: string) => void
  onSignOut: () => void
  onReopenOnboarding: () => void
  onOpenBrowseUrl?: (url: string) => void
  openBrowseInBackground?: boolean
}

export function AccountSettingsSection({
  account,
  userDisplayName,
  onAccountChange,
  onDisplayNameChange,
  onSignOut,
  onReopenOnboarding,
  onOpenBrowseUrl,
  openBrowseInBackground = true,
}: AccountSettingsSectionProps) {
  const { locale, t } = useLocale()
  const [localName, setLocalName] = useState(userDisplayName)
  const [googleStarting, setGoogleStarting] = useState(false)
  const [googleError, setGoogleError] = useState<string | null>(null)
  const [googleConfigHint, setGoogleConfigHint] = useState<string | null>(null)

  const { entries, addEntry, mergeEntries, removeEntry } = usePasswordVault()
  const [showAddPassword, setShowAddPassword] = useState(false)
  const [pwLabel, setPwLabel] = useState('')
  const [pwUrl, setPwUrl] = useState('')
  const [pwUsername, setPwUsername] = useState('')
  const [pwSecret, setPwSecret] = useState('')
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set())
  const [passwordSources, setPasswordSources] = useState<ChromiumPasswordSource[]>([])
  const [importingPasswords, setImportingPasswords] = useState(false)
  const [importMessage, setImportMessage] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [googleSetupEmail, setGoogleSetupEmail] = useState<string | null>(null)
  const [sessionLinkMessage, setSessionLinkMessage] = useState<string | null>(null)
  const csvInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setLocalName(userDisplayName)
  }, [userDisplayName])

  useEffect(() => {
    if (!isTauri) return
    void getGoogleOAuthStatus().then((status) => {
      if (!status || status.secretConfigured) {
        setGoogleConfigHint(null)
        return
      }
      setGoogleConfigHint(tf(locale, 'accountGoogleSecretMissing', { path: status.appdataEnvPath }))
    })
  }, [locale])

  const handleGoogleSignIn = useCallback(() => {
    setGoogleStarting(true)
    setGoogleError(null)
    const wasGoogle = account?.provider === 'google'
    void signInWithGoogleProfile().then(({ claims, error }) => {
      setGoogleStarting(false)
      if (!claims) {
        setGoogleError(error ?? t('accountGoogleFailed'))
        return
      }
      const next = nebulaAccountFromGoogleClaims(claims)
      onAccountChange(next)
      onDisplayNameChange(next.displayName)
      setLocalName(next.displayName)
      if (next.email && !wasGoogle) {
        setGoogleSetupEmail(next.email)
      }
    })
  }, [account?.provider, onAccountChange, onDisplayNameChange, t])

  const openGoogleBrowseUrl = useCallback(
    (url: string) => {
      onOpenBrowseUrl?.(url)
      if (openBrowseInBackground) {
        setSessionLinkMessage(t('accountSessionBackground'))
      }
    },
    [onOpenBrowseUrl, openBrowseInBackground, t],
  )

  const handleSignOut = useCallback(() => {
    setGoogleSetupEmail(null)
    setSessionLinkMessage(null)
    onSignOut()
  }, [onSignOut])

  const handleLinkGoogleSession = useCallback(() => {
    if (!account?.email || !onOpenBrowseUrl) return
    markGoogleBrowserSessionLinked(account.email)
    openGoogleBrowseUrl(buildGoogleBrowserSignInUrl(account.email))
  }, [account?.email, onOpenBrowseUrl, openGoogleBrowseUrl])

  const handleSaveLocalName = useCallback(() => {
    const trimmed = localName.trim()
    if (!trimmed) return
    onDisplayNameChange(trimmed)
    if (account?.provider !== 'google') {
      onAccountChange({ provider: 'local', displayName: trimmed })
    }
  }, [account?.provider, localName, onAccountChange, onDisplayNameChange])

  const handleAddPassword = useCallback(() => {
    const label = pwLabel.trim()
    const username = pwUsername.trim()
    if (!label || !username || !pwSecret) return
    addEntry({
      label,
      url: pwUrl.trim() || undefined,
      username,
      password: pwSecret,
    })
    setPwLabel('')
    setPwUrl('')
    setPwUsername('')
    setPwSecret('')
    setShowAddPassword(false)
  }, [addEntry, pwLabel, pwSecret, pwUrl, pwUsername])

  const toggleReveal = useCallback((id: string) => {
    setRevealedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const copyText = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    if (!isTauri) return
    void listChromiumPasswordSources().then(setPasswordSources)
  }, [])

  const handleImportBrowserPasswords = useCallback(
    (browser: string, displayName: string) => {
      setImportingPasswords(true)
      setImportError(null)
      setImportMessage(null)
      void importDefaultBrowserPasswords(200, browser)
        .then((imported) => {
          mergeEntries(
            imported.map((item) => ({
              label: item.label,
              url: item.url,
              username: item.username,
              password: item.password,
            })),
          )
          setImportMessage(
            tf(locale, 'accountImportBrowserDone', { count: imported.length, browser: displayName }),
          )
        })
        .catch((error: unknown) => {
          const message =
            error instanceof Error
              ? error.message
              : typeof error === 'string'
                ? error
                : t('accountImportFailed')
          setImportError(message)
        })
        .finally(() => {
          setImportingPasswords(false)
        })
    },
    [locale, mergeEntries, t],
  )

  const handleCsvSelected = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file) return

      setImportError(null)
      setImportMessage(null)
      try {
        const text = await file.text()
        const imported = parsePasswordCsv(text)
        if (imported.length === 0) {
          setImportError(t('accountCsvEmpty'))
          return
        }
        mergeEntries(
          imported.map((item) => ({
            label: item.label,
            url: item.url,
            username: item.username,
            password: item.password,
          })),
        )
        setImportMessage(tf(locale, 'accountCsvImported', { count: imported.length }))
      } catch {
        setImportError(t('accountCsvReadError'))
      }
    },
    [locale, mergeEntries, t],
  )

  const hasGoogle = isGoogleSignInSupported()
  const sessionLinked = loadGoogleBrowserSession()?.email === account?.email

  return (
    <>
      <div className={styles.accountCard}>
        {account?.avatarUrl ? (
          <img className={styles.accountAvatar} src={account.avatarUrl} alt="" />
        ) : (
          <div className={styles.accountAvatarPlaceholder} aria-hidden="true">
            {(account?.displayName ?? userDisplayName).charAt(0).toUpperCase()}
          </div>
        )}
        <div className={styles.accountMeta}>
          <div className={styles.accountName}>{account?.displayName ?? userDisplayName}</div>
          <div className={styles.accountHint}>
            {account?.provider === 'google'
              ? account.email ?? t('accountGoogleAccount')
              : t('accountLocalProfile')}
          </div>
        </div>
      </div>

      {hasGoogle && (
        <>
          <button
            type="button"
            className={styles.googleBtn}
            onClick={handleGoogleSignIn}
            disabled={googleStarting}
          >
            <span className={styles.googleMark} aria-hidden="true">G</span>
            {googleStarting
              ? t('accountGoogleSigningIn')
              : account?.provider === 'google'
                ? t('accountChangeGoogle')
                : t('accountGoogleSignIn')}
          </button>
          {isTauri && <p className={styles.accountNote}>{t('googleReturnHintTauri')}</p>}
          {googleConfigHint && <p className={styles.accountNote}>{googleConfigHint}</p>}
          {googleError && <p className={styles.accountError}>{googleError}</p>}
        </>
      )}

      <div className={styles.fieldGroup}>
        <label className={styles.fieldLabel}>
          {t('accountDisplayName')}
          <input
            className={styles.fieldInput}
            value={localName}
            onChange={(event) => setLocalName(event.target.value)}
            maxLength={48}
            placeholder={t('displayNamePlaceholder')}
          />
        </label>
        <button type="button" className={styles.actionBtn} onClick={handleSaveLocalName}>
          {t('accountSaveName')}
        </button>
      </div>

      {account?.provider === 'google' && onOpenBrowseUrl && (
        <div className={styles.row}>
          <div className={styles.rowText}>
            <div className={styles.rowLabel}>{t('accountSiteSession')}</div>
            <div className={styles.rowHint}>
              {sessionLinked ? t('accountLinked') : t('accountSiteSessionHint')}
            </div>
          </div>
          <button type="button" className={styles.actionBtn} onClick={handleLinkGoogleSession}>
            {sessionLinked ? t('accountRefresh') : t('accountLink')}
          </button>
        </div>
      )}
      {sessionLinkMessage && <p className={styles.accountNote}>{sessionLinkMessage}</p>}

      {account?.provider === 'google' && (
        <div className={styles.row}>
          <div className={styles.rowText}>
            <div className={styles.rowLabel}>{t('accountSignOutTitle')}</div>
            <div className={styles.rowHint}>{t('accountSignOutHint')}</div>
          </div>
          <button type="button" className={styles.dangerBtn} onClick={handleSignOut}>
            {t('accountSignOut')}
          </button>
        </div>
      )}

      <div className={styles.row}>
        <div className={styles.rowText}>
          <div className={styles.rowLabel}>{t('accountReopenSetup')}</div>
          <div className={styles.rowHint}>{t('accountReopenSetupHint')}</div>
        </div>
        <button type="button" className={styles.actionBtn} onClick={onReopenOnboarding}>
          {t('accountOpen')}
        </button>
      </div>

      <div className={styles.sectionDivider} />

      <h3 className={styles.subsectionTitle}>{t('accountPasswords')}</h3>
      <p className={styles.accountNote}>{t('accountPasswordsHint')}</p>

      <div className={styles.vaultImportRow}>
        {isTauri &&
          passwordSources.map((source) => (
            <button
              key={source.browser}
              type="button"
              className={styles.actionBtn}
              onClick={() => handleImportBrowserPasswords(source.browser, source.displayName)}
              disabled={importingPasswords}
            >
              {importingPasswords
                ? t('accountImporting')
                : tf(locale, 'accountImportChrome', { browser: source.displayName })}
            </button>
          ))}
        <button
          type="button"
          className={styles.actionBtn}
          onClick={() => csvInputRef.current?.click()}
        >
          {t('accountImportCsv')}
        </button>
        <input
          ref={csvInputRef}
          type="file"
          accept=".csv,text/csv"
          className={styles.hiddenFileInput}
          onChange={(event) => void handleCsvSelected(event)}
        />
      </div>
      {importMessage && <p className={styles.accountSuccess}>{importMessage}</p>}
      {importError && <p className={styles.accountError}>{importError}</p>}
      {isTauri && passwordSources.length > 0 && (
        <p className={styles.accountNote}>{t('accountChromeVaultNote')}</p>
      )}

      {entries.length === 0 && !showAddPassword && (
        <p className={styles.accountNote}>{t('accountNoPasswords')}</p>
      )}

      {entries.map((entry) => (
        <div key={entry.id} className={styles.vaultItem}>
          <div className={styles.vaultItemMain}>
            <div className={styles.vaultItemTitle}>{entry.label}</div>
            <div className={styles.vaultItemMeta}>
              {entry.username}
              {entry.url ? ` · ${entry.url}` : ''}
            </div>
            <div className={styles.vaultItemSecret}>
              {revealedIds.has(entry.id) ? entry.password : '••••••••'}
            </div>
          </div>
          <div className={styles.vaultItemActions}>
            <button type="button" className={styles.actionBtn} onClick={() => toggleReveal(entry.id)}>
              {revealedIds.has(entry.id) ? t('accountHide') : t('accountShow')}
            </button>
            <button type="button" className={styles.actionBtn} onClick={() => void copyText(entry.password)}>
              {t('accountCopy')}
            </button>
            <button type="button" className={styles.dangerBtn} onClick={() => removeEntry(entry.id)}>
              {t('accountDelete')}
            </button>
          </div>
        </div>
      ))}

      {showAddPassword ? (
        <div className={styles.vaultForm}>
          <label className={styles.fieldLabel}>
            {t('accountLabel')}
            <input
              className={styles.fieldInput}
              value={pwLabel}
              onChange={(e) => setPwLabel(e.target.value)}
              placeholder={t('accountLabelPlaceholder')}
            />
          </label>
          <label className={styles.fieldLabel}>
            {t('accountUrl')}
            <input
              className={styles.fieldInput}
              value={pwUrl}
              onChange={(e) => setPwUrl(e.target.value)}
              placeholder="https://..."
            />
          </label>
          <label className={styles.fieldLabel}>
            {t('accountUsername')}
            <input className={styles.fieldInput} value={pwUsername} onChange={(e) => setPwUsername(e.target.value)} />
          </label>
          <label className={styles.fieldLabel}>
            {t('accountPassword')}
            <input className={styles.fieldInput} type="password" value={pwSecret} onChange={(e) => setPwSecret(e.target.value)} />
          </label>
          <div className={styles.vaultFormActions}>
            <button type="button" className={styles.actionBtn} onClick={() => setShowAddPassword(false)}>
              {t('cancel')}
            </button>
            <button type="button" className={styles.actionBtn} onClick={handleAddPassword}>
              {t('save')}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className={styles.actionBtn} onClick={() => setShowAddPassword(true)}>
          {t('accountAddPassword')}
        </button>
      )}

      <GoogleAccountSetupModal
        open={Boolean(googleSetupEmail)}
        email={googleSetupEmail ?? ''}
        onClose={() => setGoogleSetupEmail(null)}
        onOpenBrowseUrl={(url) => {
          setGoogleSetupEmail(null)
          openGoogleBrowseUrl(url)
        }}
        onMergePasswords={(entries) => mergeEntries(entries)}
        onRequestCsvImport={() => csvInputRef.current?.click()}
      />
    </>
  )
}
