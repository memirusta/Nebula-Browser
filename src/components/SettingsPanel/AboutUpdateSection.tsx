import { useCallback, useState } from 'react'
import type { Update } from '@tauri-apps/plugin-updater'
import { APP_VERSION } from '../../core/appVersion'
import {
  checkForAppUpdate,
  installAppUpdate,
  isAppUpdaterAvailable,
  type AppUpdateStatus,
} from '../../core/appUpdater'
import styles from './SettingsPanel.module.css'

export function AboutUpdateSection() {
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
        <strong>Nebula Browser</strong>
        <div className={styles.version}>Sürüm {APP_VERSION}</div>
        <p style={{ marginTop: 16 }}>
          Dikkat dağıtmayan, gizlilik odaklı tarayıcı kabuğu. Tauri native shell + React arayüz.
        </p>
      </div>

      {isAppUpdaterAvailable() && (
        <div className={styles.row}>
          <div className={styles.rowText}>
            <div className={styles.rowLabel}>Güncellemeler</div>
            <div className={styles.rowHint}>
              {status.phase === 'uptodate' && 'En güncel sürümü kullanıyorsun.'}
              {status.phase === 'available' &&
                `Yeni sürüm: v${status.version ?? ''}${status.notes ? ` — ${status.notes}` : ''}`}
              {status.phase === 'downloading' &&
                `İndiriliyor… %${status.progress ?? 0}`}
              {status.phase === 'checking' && 'Kontrol ediliyor…'}
              {status.phase === 'error' && (status.message ?? 'Bir hata oluştu.')}
              {status.phase === 'idle' && 'GitHub üzerinden yeni sürüm kontrolü.'}
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
                Yükle ve yeniden başlat
              </button>
            ) : (
              <button
                type="button"
                className={styles.actionBtn}
                onClick={() => void handleCheck()}
                disabled={busy}
              >
                {status.phase === 'checking' ? 'Kontrol…' : 'Kontrol et'}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  )
}
