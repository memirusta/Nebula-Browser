import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SavedPassword } from '../../core/passwordVault'
import type { NebulaAccount } from '../../core/nebulaAccount'
import {
  isGoogleSignInSupported,
  nebulaAccountFromGoogleClaims,
  signInWithGoogleProfile,
} from '../../core/googleSignIn'
import { GoogleAccountSetupModal } from '../GoogleAccountSetupModal/GoogleAccountSetupModal'
import { GoogleSyncSettings } from './GoogleSyncSettings'
import {
  buildGoogleBrowserSignInUrl,
  loadGoogleBrowserSession,
} from '../../core/googleBrowserSession'
import { parsePasswordCsv } from '../../core/passwordImport'
import { getGoogleOAuthStatus } from '../../platform/googleOAuth'
import { forgetGoogleSync } from '../../platform/googleSync'
import {
  importDefaultBrowserPasswords,
  listChromiumPasswordSources,
  type ChromiumPasswordSource,
} from '../../platform/browserPasswordImport'
import { isTauri } from '../../platform/runtime'
import { usePasswordReveal } from '../../hooks/usePasswordReveal'
import { usePasswordVault } from '../../hooks/usePasswordVault'
import { getIntlLocale, tf } from '../../core/locale'
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

function passwordDomain(entry: SavedPassword): string {
  const rawUrl = entry.url?.trim()
  if (rawUrl) {
    try {
      const url = new URL(rawUrl.includes('://') ? rawUrl : `https://${rawUrl}`)
      return url.hostname.replace(/^www\./i, '') || entry.label.trim()
    } catch {
      // Imported entries can contain a label instead of a parseable URL.
    }
  }
  return entry.label.trim() || '—'
}

function passwordSearchText(entry: SavedPassword): string {
  return [entry.label, entry.username, entry.url, passwordDomain(entry)]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase()
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

  const { entries, addEntry, mergeEntries, removeEntry, editEntry } = usePasswordVault()
  const [showAddPassword, setShowAddPassword] = useState(false)
  const [passwordQuery, setPasswordQuery] = useState('')
  const [pwLabel, setPwLabel] = useState('')
  const [pwUrl, setPwUrl] = useState('')
  const [pwUsername, setPwUsername] = useState('')
  const [pwSecret, setPwSecret] = useState('')
  const [editingPassword, setEditingPassword] = useState<SavedPassword | null>(null)
  const [passwordEditError, setPasswordEditError] = useState<'conflict' | 'failed' | 'required' | null>(null)
  const editOperation = useRef(0)
  const discardPasswordEdit = useCallback(() => {
    ++editOperation.current
    setEditingPassword(null)
  }, [])
  useEffect(() => () => { ++editOperation.current }, [])
  const { authorize, isRevealed, toggleReveal, copyPassword, pendingId, lock, error: revealError } =
    usePasswordReveal(entries, t('accountPasswordVerifyReason'), discardPasswordEdit)
  const [savingPasswordEdit, setSavingPasswordEdit] = useState(false)
  const [passwordSources, setPasswordSources] = useState<ChromiumPasswordSource[]>([])
  const [importingPasswords, setImportingPasswords] = useState(false)
  const [importMessage, setImportMessage] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [googleSetupEmail, setGoogleSetupEmail] = useState<string | null>(null)
  const [sessionLinkMessage, setSessionLinkMessage] = useState<string | null>(null)
  const csvInputRef = useRef<HTMLInputElement>(null)

  const passwordGroups = useMemo(() => {
    const query = passwordQuery.trim().toLocaleLowerCase()
    const groups = new Map<string, SavedPassword[]>()
    for (const entry of entries) {
      if (query && !passwordSearchText(entry).includes(query)) continue
      const domain = passwordDomain(entry)
      const group = groups.get(domain) ?? []
      group.push(entry)
      groups.set(domain, group)
    }
    return [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right, getIntlLocale(locale)))
      .map(([domain, groupedEntries]) => ({ domain, entries: groupedEntries }))
  }, [entries, locale, passwordQuery])

  const passwordDateFormat = useMemo(
    () => new Intl.DateTimeFormat(getIntlLocale(locale), { dateStyle: 'medium', timeStyle: 'short' }),
    [locale],
  )

  useEffect(() => {
    setLocalName(userDisplayName)
  }, [userDisplayName])

  useEffect(() => {
    if (!isTauri) return
    void getGoogleOAuthStatus().then((status) => {
      if (!status || status.clientIdConfigured) {
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
        if (import.meta.env.DEV && error) console.warn('[nebula] Google sign-in failed', error)
        setGoogleError(error || t('accountGoogleFailed'))
        return
      }
      const next = nebulaAccountFromGoogleClaims(claims, t('userFallback'))
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
    if (isTauri) {
      void forgetGoogleSync().catch(() => undefined)
    }
    onSignOut()
  }, [onSignOut])

  const handleLinkGoogleSession = useCallback(() => {
    if (!account?.email || !onOpenBrowseUrl) return
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

  const handleAddPassword = useCallback(async () => {
    const label = pwLabel.trim()
    const username = pwUsername.trim()
    if (!label || !username || !pwSecret) return
    await addEntry({
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


  const handleEditPassword = useCallback(async (entry: SavedPassword) => {
    setPasswordEditError(null)
    // Hello itself can blur the shell, so start the edit session after approval.
    if (await authorize(entry)) {
      ++editOperation.current
      setEditingPassword({ ...entry })
    }
  }, [authorize])

  const cancelPasswordEdit = useCallback(() => {
    // Discard the temporarily revealed value as soon as the edit form closes.
    lock()
    setPasswordEditError(null)
  }, [lock])

  const handleSavePasswordEdit = useCallback(async () => {
    if (!editingPassword || savingPasswordEdit) return
    const label = editingPassword.label.trim()
    const username = editingPassword.username.trim()
    if (!label || !username || !editingPassword.password) {
      setPasswordEditError('required')
      return
    }
    const operation = editOperation.current
    setPasswordEditError(null)
    setSavingPasswordEdit(true)
    try {
      const updated = await editEntry(editingPassword.id, editingPassword.updatedAt, {
        label,
        username,
        password: editingPassword.password,
        url: editingPassword.url?.trim() || undefined,
      })
      if (operation !== editOperation.current) return
      if (updated) lock()
      else setPasswordEditError('conflict')
    } catch {
      if (operation === editOperation.current) setPasswordEditError('failed')
    } finally {
      setSavingPasswordEdit(false)
    }
  }, [editEntry, editingPassword, savingPasswordEdit, lock])

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
        .then(async (imported) => {
          await mergeEntries(
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
          const nativeMessage =
            error instanceof Error ? error.message : typeof error === 'string' ? error : ''
          const message = locale === 'tr' && nativeMessage ? nativeMessage : t('accountImportFailed')
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
        await mergeEntries(
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

      {account?.provider === 'google' && account.email && (
        <GoogleSyncSettings email={account.email} />
      )}

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

      <h3 className={styles.subsectionTitle} data-password-settings tabIndex={-1}>{t('accountPasswords')}</h3>
      <p className={styles.accountNote}>{t('accountPasswordsHint')}</p>
      <p className={styles.accountNote}>{t('accountPasswordHelloHint')}</p>
      {pendingId && <p className={styles.accountNote} role="status">{t('accountPasswordVerifying')}</p>}
      {revealError && <p className={styles.accountError} role="alert">
        {t(revealError === 'unavailable' ? 'accountPasswordHelloUnavailable'
          : revealError === 'clipboard' ? 'accountPasswordCopyFailed' : 'accountPasswordVerifyFailed')}
      </p>}

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
      {passwordEditError && <p role="alert" className={styles.accountError}>
        {t(passwordEditError === 'conflict' ? 'accountPasswordEditConflict'
          : passwordEditError === 'required' ? 'accountPasswordEditRequired' : 'accountPasswordEditFailed')}
      </p>}
      {isTauri && passwordSources.length > 0 && (
        <p className={styles.accountNote}>{t('accountChromeVaultNote')}</p>
      )}

      {entries.length === 0 && !showAddPassword && (
        <p className={styles.accountNote}>{t('accountNoPasswords')}</p>
      )}

      {entries.length > 0 && (
        <label className={styles.vaultSearch}>
          <span>{t('accountPasswordSearch')}</span>
          <input
            className={styles.fieldInput}
            type="search"
            value={passwordQuery}
            onChange={(event) => setPasswordQuery(event.target.value)}
            placeholder={t('accountPasswordSearchPlaceholder')}
            aria-label={t('accountPasswordSearch')}
          />
        </label>
      )}

      {entries.length > 0 && passwordGroups.length === 0 && (
        <p className={styles.accountNote}>{t('accountPasswordNoMatch')}</p>
      )}

      {passwordGroups.map((group) => (
        <section key={group.domain} className={styles.vaultDomainGroup}>
          <div className={styles.vaultDomainHeader}>
            <span className={styles.vaultDomainIcon} aria-hidden="true">
              {group.domain.slice(0, 1).toLocaleUpperCase()}
            </span>
            <span>{group.domain}</span>
          </div>
          {group.entries.map((entry) => editingPassword?.id === entry.id ? (
        <div key={entry.id} className={styles.vaultForm}>
          <p className={styles.accountNote}>{t('accountPasswordAutoLock')}</p>
          <label className={styles.fieldLabel}>
            {t('accountLabel')}
            <input className={styles.fieldInput} value={editingPassword.label}
              onChange={(event) => setEditingPassword((current) => current && { ...current, label: event.target.value })} />
          </label>
          <label className={styles.fieldLabel}>
            {t('accountUrl')}
            <input className={styles.fieldInput} value={editingPassword.url ?? ''}
              onChange={(event) => setEditingPassword((current) => current && { ...current, url: event.target.value || undefined })} />
          </label>
          <label className={styles.fieldLabel}>
            {t('accountUsername')}
            <input className={styles.fieldInput} value={editingPassword.username}
              onChange={(event) => setEditingPassword((current) => current && { ...current, username: event.target.value })} />
          </label>
          <label className={styles.fieldLabel}>
            {t('accountPassword')}
            <input className={styles.fieldInput} type="text" value={editingPassword.password}
              onChange={(event) => setEditingPassword((current) => current && { ...current, password: event.target.value })} />
          </label>
          <div className={styles.vaultFormActions}>
            <button type="button" className={styles.actionBtn} disabled={savingPasswordEdit} onClick={cancelPasswordEdit}>
              {t('cancel')}
            </button>
            <button type="button" className={styles.actionBtn} disabled={savingPasswordEdit} onClick={() => void handleSavePasswordEdit()}>
              {t('save')}
            </button>
          </div>
        </div>
      ) : (
        <div key={entry.id} className={styles.vaultItem}>
          <div className={styles.vaultItemMain}>
            <div className={styles.vaultItemTitleRow}>
              <span className={styles.vaultItemTitle}>{entry.label}</span>
              <span className={styles.vaultUpdated}>
                {tf(locale, 'accountPasswordUpdated', {
                  time: passwordDateFormat.format(new Date(entry.updatedAt)),
                })}
              </span>
            </div>
            <div className={styles.vaultItemMeta}>
              {entry.username}
              {entry.url ? ` · ${passwordDomain(entry)}` : ''}
            </div>
            <div className={styles.vaultItemSecret}>
              {isRevealed(entry) ? entry.password : '••••••••'}
            </div>
          </div>
          <div className={styles.vaultItemActions}>
            <button type="button" className={styles.actionBtn} disabled={pendingId !== null} onClick={() => void toggleReveal(entry)}>
              {isRevealed(entry) ? t('accountHide') : t('accountShow')}
            </button>
            <button type="button" className={styles.actionBtn} disabled={pendingId !== null} onClick={() => void copyPassword(entry)}>
              {t('accountCopy')}
            </button>
            <button type="button" className={styles.actionBtn} disabled={pendingId !== null} onClick={() => void handleEditPassword(entry)}>
              {t('accountEdit')}
            </button>
            <button
              type="button"
              className={styles.dangerBtn}
              disabled={pendingId !== null}
              onClick={() => {
                void removeEntry(entry.id).catch((error) => {
                  console.error('Password removal failed', error)
                })
              }}
            >
              {t('accountDelete')}
            </button>
          </div>
        </div>
          ))}
        </section>
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
        onMergePasswords={async (entries) => {
          await mergeEntries(entries)
        }}
        onRequestCsvImport={() => csvInputRef.current?.click()}
      />
    </>
  )
}
