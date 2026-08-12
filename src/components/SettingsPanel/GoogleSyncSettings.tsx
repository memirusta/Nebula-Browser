import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  applyGoogleSyncStorage,
  buildGoogleSyncBundle,
  decryptSyncedPasswords,
  DEFAULT_GOOGLE_SYNC_PREFERENCES,
  loadGoogleSyncLastSuccess,
  loadGoogleSyncPreferences,
  mergeGoogleSyncBackupBundle,
  mergeSyncedPasswords,
  parseGoogleSyncBundle,
  saveGoogleSyncLastSuccess,
  saveGoogleSyncPreferences,
  type GoogleSyncPreferences,
} from '../../core/googleSync'
import {
  createGooglePkceRequest,
  getGoogleClientId,
} from '../../core/googleSignIn'
import { showAppConfirmation } from '../../core/appDialog'
import { loadPasswordVault, savePasswordVault } from '../../core/passwordVault'
import { useLocale } from '../../hooks/useLocale'
import {
  enableGoogleSyncLoopback,
  forgetGoogleSync,
  getGoogleSyncStatus,
  pullGoogleSyncData,
  pushGoogleSyncData,
  type GoogleSyncStatus,
} from '../../platform/googleSync'
import { isTauri } from '../../platform/runtime'
import styles from './SettingsPanel.module.css'

interface GoogleSyncSettingsProps {
  email: string
}

type WorkingAction = 'enable' | 'backup' | 'restore' | 'disable' | null

export function GoogleSyncSettings({ email }: GoogleSyncSettingsProps) {
  const { locale, t } = useLocale()
  const [status, setStatus] = useState<GoogleSyncStatus>({ enabled: false, email: null })
  const [preferences, setPreferences] = useState<GoogleSyncPreferences>(loadGoogleSyncPreferences)
  const [syncPassword, setSyncPassword] = useState('')
  const [working, setWorking] = useState<WorkingAction>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastSuccess, setLastSuccess] = useState<number | null>(loadGoogleSyncLastSuccess)

  const currentAccountEnabled = useMemo(
    () => status.enabled && status.email?.trim().toLowerCase() === email.trim().toLowerCase(),
    [email, status.email, status.enabled],
  )

  const refreshStatus = useCallback(async () => {
    if (!isTauri) return
    try {
      setStatus(await getGoogleSyncStatus())
    } catch {
      setStatus({ enabled: false, email: null })
    }
  }, [])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  const updatePreference = useCallback(
    (key: keyof GoogleSyncPreferences, value: boolean) => {
      setPreferences((previous) => {
        const next = { ...previous, [key]: value }
        saveGoogleSyncPreferences(next)
        return next
      })
      setMessage(null)
      setError(null)
    },
    [],
  )

  const handleEnable = useCallback(async () => {
    if (!isTauri) return
    const clientId = getGoogleClientId()
    if (!clientId) {
      setError(t('syncGoogleClientMissing'))
      return
    }
    setWorking('enable')
    setError(null)
    setMessage(null)
    try {
      const { verifier, challenge, state } = await createGooglePkceRequest()
      await enableGoogleSyncLoopback({
        clientId,
        codeVerifier: verifier,
        codeChallenge: challenge,
        state,
        expectedEmail: email,
      })
      await refreshStatus()
      setMessage(t('syncEnabled'))
    } catch (reason) {
      if (import.meta.env.DEV) console.warn('[nebula] Google sync enable failed', reason)
      setError(t('syncEnableFailed'))
    } finally {
      setWorking(null)
    }
  }, [email, refreshStatus, t])

  const handleBackup = useCallback(async () => {
    const clientId = getGoogleClientId()
    if (!clientId || !currentAccountEnabled) return
    if (preferences.passwords && syncPassword.length < 8) {
      setError(t('syncPasswordTooShort'))
      return
    }
    setWorking('backup')
    setError(null)
    setMessage(null)
    try {
      const entries = await loadPasswordVault()
      const localBundle = await buildGoogleSyncBundle(preferences, entries, syncPassword)
      const cloud = await pullGoogleSyncData(clientId)
      const remoteBundle = cloud ? parseGoogleSyncBundle(cloud.content) : null
      const bundle = mergeGoogleSyncBackupBundle(localBundle, remoteBundle)
      await pushGoogleSyncData(clientId, JSON.stringify(bundle))
      const now = Date.now()
      saveGoogleSyncLastSuccess(now)
      setLastSuccess(now)
      setMessage(t('syncBackupDone'))
    } catch (reason) {
      if (import.meta.env.DEV) console.warn('[nebula] Google sync backup failed', reason)
      setError(t('syncBackupFailed'))
    } finally {
      setWorking(null)
    }
  }, [currentAccountEnabled, preferences, syncPassword, t])

  const handleRestore = useCallback(async () => {
    const clientId = getGoogleClientId()
    if (!clientId || !currentAccountEnabled) return
    const accepted = await showAppConfirmation(t('syncRestoreConfirm'), t('syncTitle'))
    if (!accepted) return

    setWorking('restore')
    setError(null)
    setMessage(null)
    try {
      const cloud = await pullGoogleSyncData(clientId)
      if (!cloud) {
        setError(t('syncNoCloudData'))
        return
      }
      const bundle = parseGoogleSyncBundle(cloud.content)
      if (preferences.passwords && bundle.categories.passwords && bundle.passwords) {
        if (syncPassword.length < 8) {
          setError(t('syncPasswordRequired'))
          return
        }
        const remotePasswords = await decryptSyncedPasswords(bundle.passwords, syncPassword)
        const localPasswords = await loadPasswordVault()
        await savePasswordVault(mergeSyncedPasswords(localPasswords, remotePasswords))
      }
      applyGoogleSyncStorage(bundle, preferences)
      const now = Date.now()
      saveGoogleSyncLastSuccess(now)
      setLastSuccess(now)
      setMessage(t('syncRestoreDone'))
      window.setTimeout(() => window.location.reload(), 450)
    } catch (reason) {
      if (import.meta.env.DEV) console.warn('[nebula] Google sync restore failed', reason)
      setError(t('syncRestoreFailed'))
    } finally {
      setWorking(null)
    }
  }, [currentAccountEnabled, preferences, syncPassword, t])

  const handleDisable = useCallback(async () => {
    setWorking('disable')
    setError(null)
    setMessage(null)
    try {
      await forgetGoogleSync()
      setStatus({ enabled: false, email: null })
      setSyncPassword('')
      setMessage(t('syncDisabled'))
    } catch {
      setError(t('syncDisableFailed'))
    } finally {
      setWorking(null)
    }
  }, [t])

  if (!isTauri) return null

  const lastSyncText = lastSuccess
    ? new Intl.DateTimeFormat(locale === 'tr' ? 'tr-TR' : 'en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(lastSuccess))
    : t('syncNever')

  return (
    <div className={styles.syncCard}>
      <div className={styles.syncHeader}>
        <div>
          <div className={styles.rowLabel}>{t('syncTitle')}</div>
          <div className={styles.rowHint}>{t('syncHint')}</div>
        </div>
        <span className={currentAccountEnabled ? styles.syncBadgeOn : styles.syncBadgeOff}>
          {currentAccountEnabled ? t('syncOn') : t('syncOff')}
        </span>
      </div>

      {!currentAccountEnabled ? (
        <>
          {status.enabled && status.email && (
            <p className={styles.accountNote}>{t('syncOtherAccount')}</p>
          )}
          <button
            type="button"
            className={styles.actionBtn}
            onClick={() => void handleEnable()}
            disabled={working !== null}
          >
            {working === 'enable' ? t('syncEnabling') : t('syncEnable')}
          </button>
        </>
      ) : (
        <>
          <div className={styles.syncOptions}>
            <label className={styles.syncOption}>
              <input
                type="checkbox"
                checked={preferences.bookmarks}
                onChange={(event) => updatePreference('bookmarks', event.target.checked)}
              />
              <span>
                <strong>{t('syncBookmarks')}</strong>
                <small>{t('syncBookmarksHint')}</small>
              </span>
            </label>
            <label className={styles.syncOption}>
              <input
                type="checkbox"
                checked={preferences.settings}
                onChange={(event) => updatePreference('settings', event.target.checked)}
              />
              <span>
                <strong>{t('syncSettings')}</strong>
                <small>{t('syncSettingsHint')}</small>
              </span>
            </label>
            <label className={styles.syncOption}>
              <input
                type="checkbox"
                checked={preferences.passwords}
                onChange={(event) => updatePreference('passwords', event.target.checked)}
              />
              <span>
                <strong>{t('syncPasswords')}</strong>
                <small>{t('syncPasswordsHint')}</small>
              </span>
            </label>
          </div>

          {preferences.passwords && (
            <label className={styles.fieldLabel}>
              {t('syncPasswordLabel')}
              <input
                className={styles.fieldInput}
                type="password"
                autoComplete="new-password"
                value={syncPassword}
                onChange={(event) => setSyncPassword(event.target.value)}
                placeholder={t('syncPasswordPlaceholder')}
              />
              <span className={styles.syncSecretHint}>{t('syncPasswordHint')}</span>
            </label>
          )}

          <div className={styles.syncActions}>
            <button
              type="button"
              className={styles.actionBtn}
              onClick={() => void handleBackup()}
              disabled={working !== null || (!preferences.settings && !preferences.bookmarks && !preferences.passwords)}
            >
              {working === 'backup' ? t('syncBackingUp') : t('syncBackupNow')}
            </button>
            <button
              type="button"
              className={styles.actionBtn}
              onClick={() => void handleRestore()}
              disabled={working !== null}
            >
              {working === 'restore' ? t('syncRestoring') : t('syncRestore')}
            </button>
            <button
              type="button"
              className={styles.dangerBtn}
              onClick={() => void handleDisable()}
              disabled={working !== null}
            >
              {working === 'disable' ? t('syncDisabling') : t('syncDisable')}
            </button>
          </div>
          <p className={styles.accountNote}>{t('syncLast')}: {lastSyncText}</p>
        </>
      )}

      {message && <p className={styles.accountNote}>{message}</p>}
      {error && <p className={styles.accountError}>{error}</p>}
    </div>
  )
}

export { DEFAULT_GOOGLE_SYNC_PREFERENCES }
