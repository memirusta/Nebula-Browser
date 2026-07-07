import { useCallback, useState } from 'react'
import type { Update } from '@tauri-apps/plugin-updater'
import { APP_VERSION } from '../../core/appVersion'
import {
  checkForAppUpdate,
  installAppUpdate,
  isAppUpdaterAvailable,
  type AppUpdateStatus,
} from '../../core/appUpdater'
import { tf } from '../../core/locale'
import { useLocale } from '../../hooks/useLocale'
import styles from './SettingsPanel.module.css'

export function AboutUpdateSection() {
  const { locale, t } = useLocale()
  const [status, setStatus] = useState<AppUpdateStatus>({ phase: 'idle' })
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null)
  const busy = status.phase === 'checking' || status.phase === 'downloading'

  const handleCheck = useCallback(async () => {
    setPendingUpdate(null)
    setStatus({ phase: 'checking' })

    const result = await checkForAppUpdate()
    setStatus(result.status)
    setPendingUpdate(result.update)
  }, [])

  const handleInstall = useCallback(async () => {
    if (!pendingUpdate) return

    setStatus({ phase: 'downloading', progress: 0 })
    const result = await installAppUpdate(pendingUpdate, (progress) => {
      setStatus({ phase: 'downloading', progress })
    })
    setStatus(result)
  }, [pendingUpdate])

  return (
    <>
      <div className={styles.placeholder}>
        <strong>{t('updateProduct')}</strong>
        <div className={styles.version}>
          {t('updateVersion')} {APP_VERSION}
        </div>
        <p style={{ marginTop: 16 }}>{t('updateBlurb')}</p>
      </div>

      {isAppUpdaterAvailable() && (
        <div className={styles.row}>
          <div className={styles.rowText}>
            <div className={styles.rowLabel}>{t('updateSection')}</div>
            <div className={styles.rowHint}>
              {status.phase === 'uptodate' && t('updateUptodate')}
              {status.phase === 'available' &&
                `${tf(locale, 'updateAvailable', { version: status.version ?? '' })}${status.notes ? ` — ${status.notes}` : ''}`}
              {status.phase === 'downloading' &&
                tf(locale, 'updateDownloading', { progress: status.progress ?? 0 })}
              {status.phase === 'checking' && t('updateChecking')}
              {status.phase === 'error' && (status.message ?? t('updateErrorCheck'))}
              {status.phase === 'idle' && t('updateIdle')}
            </div>
          </div>
          <div className={styles.rowActions}>
            {status.phase === 'available' ? (
              <button
                type="button"
                className={styles.actionBtn}
                onClick={() => void handleInstall()}
                disabled={busy}
              >
                {t('updateInstall')}
              </button>
            ) : (
              <button
                type="button"
                className={styles.actionBtn}
                onClick={() => void handleCheck()}
                disabled={busy}
              >
                {status.phase === 'checking' ? t('updateChecking') : t('updateCheck')}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  )
}
