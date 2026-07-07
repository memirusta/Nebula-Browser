import { createPortal } from 'react-dom'
import {
  formatRelativeVisitTime,
  formatSessionPath,
  hostsMatch,
  type BrowseSession,
} from '../../core/browseSession'
import type { Shortcut } from '../../core/types'
import styles from './ShortcutPreviewOverlay.module.css'

interface ShortcutPreviewOverlayProps {
  shortcut: Shortcut | null
  visible: boolean
  activeUrl?: string | null
  session?: BrowseSession | null
}

export function ShortcutPreviewOverlay({
  shortcut,
  visible,
  activeUrl = null,
  session = null,
}: ShortcutPreviewOverlayProps) {
  if (!visible || !shortcut) return null

  const isLive =
    Boolean(activeUrl) && hostsMatch(activeUrl!, shortcut.url)
  const resumeSession =
    isLive && activeUrl
      ? { url: activeUrl, label: shortcut.label, updatedAt: Date.now() }
      : session

  return createPortal(
    <div
      className={[styles.overlay, isLive ? styles.overlayLive : ''].filter(Boolean).join(' ')}
      aria-hidden="true"
    >
      <div className={styles.dim} />

      {isLive ? (
        <div className={styles.liveBadge}>
          <span className={styles.liveDot} />
          Kaldığınız yer
        </div>
      ) : (
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <div className={styles.iconWrap}>
              {shortcut.favicon ? (
                <img src={shortcut.favicon} alt="" className={styles.icon} draggable={false} />
              ) : (
                <span className={styles.iconFallback}>{shortcut.label[0]}</span>
              )}
            </div>
            <div className={styles.cardTitles}>
              <p className={styles.siteName}>{shortcut.label}</p>
              <p className={styles.siteHost}>{formatSessionPath(shortcut.url)}</p>
            </div>
          </div>

          {resumeSession ? (
            <div className={styles.sessionBlock}>
              <p className={styles.sessionLabel}>Son kaldığınız yer</p>
              <p className={styles.sessionPath}>{formatSessionPath(resumeSession.url)}</p>
              <p className={styles.sessionMeta}>
                {formatRelativeVisitTime(resumeSession.updatedAt)}
              </p>
            </div>
          ) : (
            <p className={styles.sessionEmpty}>
              Bu site için henüz kayıtlı bir oturum yok. Tıklayınca açılır.
            </p>
          )}

          <p className={styles.hint}>
            Siteler güvenlik nedeniyle küçük önizleme penceresinde açılamaz; son
            konumunuz burada gösterilir.
          </p>
        </div>
      )}
    </div>,
    document.body,
  )
}
