import { useEffect, useState } from 'react'
import { downloadProgress, isDownloadActive, type DownloadAction, type DownloadItem } from '../../core/download'
import { useLocale } from '../../hooks/useLocale'
import styles from './DownloadManager.module.css'

interface DownloadManagerProps {
  items: DownloadItem[]
  variant: 'home' | 'browsing'
  browsingTop?: number
  onAction: (id: string, action: DownloadAction) => Promise<void>
  onRemove: (id: string) => void
  onClearFinished: () => void
  onClose: () => void
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = units[0]
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024
    unit = units[index]
  }
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${unit}`
}

function DownloadGlyph({ state }: { state: DownloadItem['state'] }) {
  if (state === 'completed') {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="m6.5 12.5 3.2 3.2 7.8-8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (state === 'interrupted' || state === 'cancelled') {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="m7.5 7.5 9 9m0-9-9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 4v10m0 0 4-4m-4 4-4-4M5 19h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ActionIcon({ action }: { action: DownloadAction | 'remove' }) {
  const paths: Record<typeof action, string> = {
    pause: 'M8 5h3v14H8V5zm5 0h3v14h-3V5z',
    resume: 'M8 5v14l11-7L8 5z',
    cancel: 'M6.5 6.5l11 11m0-11-11 11',
    open: 'M7 4h7l4 4v12H7V4zm7 0v5h5M10 14h5m-5 3h5',
    reveal: 'M3.5 7.5h6l2-2h9v13h-17v-11z',
    remove: 'M6.5 6.5l11 11m0-11-11 11',
  }
  return (
    <svg viewBox="0 0 24 24" fill={action === 'pause' || action === 'resume' ? 'currentColor' : 'none'} aria-hidden="true">
      <path d={paths[action]} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function DownloadManager({
  items,
  variant,
  browsingTop = 220,
  onAction,
  onRemove,
  onClearFinished,
  onClose,
}: DownloadManagerProps) {
  const { t } = useLocale()
  const [actionError, setActionError] = useState<string | null>(null)
  const hasFinished = items.some((item) => !isDownloadActive(item))

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const runAction = async (id: string, action: DownloadAction) => {
    setActionError(null)
    try {
      await onAction(id, action)
    } catch {
      setActionError(t('downloadActionFailed'))
    }
  }

  return (
    <section
      className={[styles.panel, variant === 'browsing' ? styles.panelBrowsing : styles.panelHome].join(' ')}
      style={variant === 'browsing' ? { top: browsingTop } : undefined}
      role="dialog"
      aria-label={t('downloads')}
    >
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>{t('downloadSession')}</span>
          <h2>{t('downloads')}</h2>
        </div>
        <div className={styles.headerActions}>
          {hasFinished && (
            <button type="button" className={styles.textButton} onClick={onClearFinished}>
              {t('downloadClearFinished')}
            </button>
          )}
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label={t('close')}>
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="m7 7 10 10m0-10L7 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </header>

      {actionError && <div className={styles.error} role="alert">{actionError}</div>}

      <div className={styles.list}>
        {items.length === 0 ? (
          <div className={styles.empty}>
            <span className={styles.emptyGlyph}>
              <DownloadGlyph state="in_progress" />
            </span>
            <strong>{t('downloadEmpty')}</strong>
            <p>{t('downloadEmptyHint')}</p>
          </div>
        ) : (
          items.map((item) => {
            const progress = downloadProgress(item)
            const active = isDownloadActive(item)
            const completed = item.state === 'completed'
            const status = item.state === 'paused'
              ? t('downloadPaused')
              : completed
                ? t('downloadCompleted')
                : item.state === 'cancelled'
                  ? t('downloadCancelled')
                  : item.state === 'interrupted'
                    ? t('downloadFailed')
                    : progress === null
                      ? t('downloadStarting')
                      : `${Math.round(progress)}%`
            const size = item.totalBytes > 0
              ? `${formatBytes(item.receivedBytes)} / ${formatBytes(item.totalBytes)}`
              : formatBytes(item.receivedBytes)

            return (
              <article key={item.id} className={styles.item}>
                <div className={[styles.fileGlyph, completed ? styles.fileGlyphCompleted : '', !active && !completed ? styles.fileGlyphFailed : ''].filter(Boolean).join(' ')}>
                  <DownloadGlyph state={item.state} />
                </div>
                <div className={styles.itemBody}>
                  <button
                    type="button"
                    className={styles.fileName}
                    disabled={!completed}
                    onClick={() => void runAction(item.id, 'open')}
                    title={item.fileName}
                  >
                    {item.fileName}
                  </button>
                  <div className={styles.meta}>
                    <span>{status}</span>
                    <span className={styles.metaDot}>•</span>
                    <span>{size}</span>
                  </div>
                  {active && (
                    <div className={styles.progressTrack} aria-label={status}>
                      <span
                        className={[styles.progressFill, progress === null ? styles.progressUnknown : ''].filter(Boolean).join(' ')}
                        style={progress === null ? undefined : { width: `${progress}%` }}
                      />
                    </div>
                  )}
                </div>
                <div className={styles.itemActions}>
                  {item.state === 'in_progress' && (
                    <button type="button" onClick={() => void runAction(item.id, 'pause')} title={t('downloadPause')} aria-label={t('downloadPause')}>
                      <ActionIcon action="pause" />
                    </button>
                  )}
                  {item.state === 'paused' && (
                    <button type="button" onClick={() => void runAction(item.id, 'resume')} title={t('downloadResume')} aria-label={t('downloadResume')}>
                      <ActionIcon action="resume" />
                    </button>
                  )}
                  {active && (
                    <button type="button" onClick={() => void runAction(item.id, 'cancel')} title={t('downloadCancel')} aria-label={t('downloadCancel')}>
                      <ActionIcon action="cancel" />
                    </button>
                  )}
                  {completed && (
                    <button type="button" onClick={() => void runAction(item.id, 'reveal')} title={t('downloadReveal')} aria-label={t('downloadReveal')}>
                      <ActionIcon action="reveal" />
                    </button>
                  )}
                  {!active && (
                    <button type="button" onClick={() => onRemove(item.id)} title={t('downloadRemove')} aria-label={t('downloadRemove')}>
                      <ActionIcon action="remove" />
                    </button>
                  )}
                </div>
              </article>
            )
          })
        )}
      </div>
      <footer>{t('downloadSessionHint')}</footer>
    </section>
  )
}
