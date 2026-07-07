import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Update } from '@tauri-apps/plugin-updater'
import { APP_VERSION } from '../../core/appVersion'
import {
  checkForAppUpdate,
  dismissAppUpdateVersion,
  installAppUpdate,
  isAppUpdateDismissed,
  isAppUpdaterAvailable,
  type AppUpdateStatus,
} from '../../core/appUpdater'
import { tf } from '../../core/locale'
import { useLocale } from '../../hooks/useLocale'
import styles from './AppUpdatePrompt.module.css'

const STARTUP_CHECK_DELAY_MS = 2000

export function AppUpdatePrompt() {
  const { locale, t } = useLocale()
  const [open, setOpen] = useState(false)
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null)
  const [status, setStatus] = useState<AppUpdateStatus>({ phase: 'idle' })

  useEffect(() => {
    if (!isAppUpdaterAvailable() || !import.meta.env.PROD) return

    let cancelled = false
    const timer = window.setTimeout(() => {
      void checkForAppUpdate().then((result) => {
        if (cancelled || !result.update) return
        if (isAppUpdateDismissed(result.update.version)) return

        setPendingUpdate(result.update)
        setStatus(result.status)
        setOpen(true)
      })
    }, STARTUP_CHECK_DELAY_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [])

  const busy = status.phase === 'downloading'

  const handleDismiss = useCallback(() => {
    if (pendingUpdate) {
      dismissAppUpdateVersion(pendingUpdate.version)
    }
    setOpen(false)
  }, [pendingUpdate])

  const handleInstall = useCallback(async () => {
    if (!pendingUpdate) return

    setStatus({ phase: 'downloading', progress: 0 })
    const result = await installAppUpdate(pendingUpdate, (progress) => {
      setStatus({ phase: 'downloading', progress })
    })
    setStatus(result)
  }, [pendingUpdate])

  if (!open || !pendingUpdate) return null

  return createPortal(
    <div className={styles.backdrop} role="presentation">
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-update-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.header}>
          <h2 id="app-update-title" className={styles.title}>
            {t('updatePromptTitle')}
          </h2>
          <p className={styles.lead}>
            {tf(locale, 'updatePromptLead', {
              current: APP_VERSION,
              version: pendingUpdate.version,
            })}
          </p>
          {pendingUpdate.body?.trim() ? (
            <div className={styles.notes}>{pendingUpdate.body.trim()}</div>
          ) : null}
        </header>

        {status.phase === 'downloading' && (
          <p className={styles.status}>
            {tf(locale, 'updateDownloading', { progress: status.progress ?? 0 })}
          </p>
        )}
        {status.phase === 'error' && (
          <p className={`${styles.status} ${styles.statusError}`}>{status.message}</p>
        )}

        <footer className={styles.footer}>
          <button
            type="button"
            className={styles.ghostBtn}
            onClick={handleDismiss}
            disabled={busy}
          >
            {t('updateDismiss')}
          </button>
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={() => void handleInstall()}
            disabled={busy}
          >
            {busy ? t('updateInstalling') : t('updateInstall')}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
