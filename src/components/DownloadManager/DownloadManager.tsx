import { useEffect, useRef, useState, type DragEvent } from 'react'
import { downloadProgress, isDownloadActive, startDownloadDrag, type DownloadAction, type DownloadItem } from '../../core/download'
import { useLocale } from '../../hooks/useLocale'
import styles from './DownloadManager.module.css'


interface DownloadTelemetry {
  speedBps: number
  etaSeconds: number | null
}

interface DownloadSample {
  bytes: number
  sampledAtMs: number
  smoothedSpeedBps: number
}

const TELEMETRY_SAMPLE_MS = 180
const TELEMETRY_NEW_SAMPLE_WEIGHT = 0.35

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

function formatTransferRate(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`
}

function formatEta(
  seconds: number,
  tf: (
    key: 'downloadEtaSeconds' | 'downloadEtaMinutes' | 'downloadEtaHours',
    vars: Record<string, string | number>,
  ) => string,
): string {
  const rounded = Math.max(1, Math.round(seconds))
  if (rounded < 60) {
    return tf('downloadEtaSeconds', { seconds: rounded })
  }
  if (rounded < 3600) {
    return tf('downloadEtaMinutes', {
      minutes: Math.floor(rounded / 60),
      seconds: rounded % 60,
    })
  }
  return tf('downloadEtaHours', {
    hours: Math.floor(rounded / 3600),
    minutes: Math.floor((rounded % 3600) / 60),
  })
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
    retry: 'M18.5 8A7 7 0 1 0 19 15m-.5-7V3m0 5h-5',
    keep: 'm6.5 12.5 3.2 3.2 7.8-8',
    delete: 'M6.5 6.5l11 11m0-11-11 11',
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
  const { t, tf } = useLocale()
  const [actionError, setActionError] = useState<string | null>(null)
  const [keepConfirmationId, setKeepConfirmationId] = useState<string | null>(null)
  const [telemetryById, setTelemetryById] = useState<Record<string, DownloadTelemetry>>({})
  const telemetrySamplesRef = useRef<Map<string, DownloadSample>>(new Map())
  const hasFinished = items.some((item) => !isDownloadActive(item))

  useEffect(() => {
    const now = Date.now()
    const activeIds = new Set<string>()
    const nextTelemetry: Record<string, DownloadTelemetry> = {}

    for (const item of items) {
      if (item.state !== 'in_progress') {
        telemetrySamplesRef.current.delete(item.id)
        continue
      }

      activeIds.add(item.id)
      const previous = telemetrySamplesRef.current.get(item.id)
      if (!previous || item.receivedBytes < previous.bytes) {
        telemetrySamplesRef.current.set(item.id, {
          bytes: item.receivedBytes,
          sampledAtMs: now,
          smoothedSpeedBps: 0,
        })
        continue
      }

      const elapsedMs = now - previous.sampledAtMs
      if (elapsedMs < TELEMETRY_SAMPLE_MS) {
        const existing = telemetryById[item.id]
        if (existing) nextTelemetry[item.id] = existing
        continue
      }

      const transferred = Math.max(0, item.receivedBytes - previous.bytes)
      const instantaneousSpeed = transferred * 1000 / elapsedMs
      const smoothedSpeed = previous.smoothedSpeedBps > 0
        ? previous.smoothedSpeedBps * (1 - TELEMETRY_NEW_SAMPLE_WEIGHT)
          + instantaneousSpeed * TELEMETRY_NEW_SAMPLE_WEIGHT
        : instantaneousSpeed

      telemetrySamplesRef.current.set(item.id, {
        bytes: item.receivedBytes,
        sampledAtMs: now,
        smoothedSpeedBps: smoothedSpeed,
      })

      if (smoothedSpeed > 1) {
        const remainingBytes = item.totalBytes > 0
          ? Math.max(0, item.totalBytes - item.receivedBytes)
          : 0
        const etaSeconds = remainingBytes > 0
          ? remainingBytes / smoothedSpeed
          : null
        nextTelemetry[item.id] = {
          speedBps: smoothedSpeed,
          etaSeconds: etaSeconds !== null && Number.isFinite(etaSeconds) ? etaSeconds : null,
        }
      }
    }

    for (const id of telemetrySamplesRef.current.keys()) {
      if (!activeIds.has(id)) telemetrySamplesRef.current.delete(id)
    }

    setTelemetryById(nextTelemetry)
  // telemetryById is intentionally sampled from the previous render when an update
  // arrives too quickly to form a stable speed sample.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, variant])

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

  const keepDangerousDownload = async (item: DownloadItem) => {
    if (keepConfirmationId !== item.id) {
      setKeepConfirmationId(item.id)
      return
    }
    setKeepConfirmationId(null)
    await runAction(item.id, 'keep')
  }

  const beginNativeDrag = (event: DragEvent<HTMLElement>, item: DownloadItem) => {
    if (item.state !== 'completed') {
      event.preventDefault()
      return
    }

    // Cancel Chromium's HTML drag loop and hand the same mouse gesture to the
    // native Windows Shell. The native command resolves the local path from the
    // completed download id, so the webview never gets an arbitrary file-drag API.
    event.preventDefault()
    setActionError(null)
    void startDownloadDrag(item.id).catch(() => {
      setActionError(t('downloadActionFailed'))
    })
  }

  return (
    <section
      data-nebula-download-panel="true"
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
            const status = item.requiresConfirmation
              ? t('downloadNeedsReview')
              : item.state === 'paused'
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
            const telemetry = item.state === 'in_progress'
              ? telemetryById[item.id]
              : undefined
            const showSize = variant === 'home' || item.state !== 'in_progress'

            return (
              <article key={item.id} className={styles.item}>
                <div
                  className={[
                    styles.fileGlyph,
                    completed ? styles.fileGlyphCompleted : '',
                    !active && !completed ? styles.fileGlyphFailed : '',
                    completed ? styles.fileDragSource : '',
                  ].filter(Boolean).join(' ')}
                  draggable={completed}
                  onDragStart={(event) => beginNativeDrag(event, item)}
                >
                  <DownloadGlyph state={item.state} />
                </div>
                <div className={styles.itemBody}>
                  <button
                    type="button"
                    className={[styles.fileName, completed ? styles.fileDragSource : ''].filter(Boolean).join(' ')}
                    disabled={!completed}
                    draggable={completed}
                    onDragStart={(event) => beginNativeDrag(event, item)}
                    onClick={() => void runAction(item.id, 'open')}
                    title={item.fileName}
                  >
                    {item.fileName}
                  </button>
                  <div className={styles.meta}>
                    <span>{status}</span>
                    {showSize && (
                      <>
                        <span className={styles.metaDot}>•</span>
                        <span>{size}</span>
                      </>
                    )}
                  </div>
                  {item.requiresConfirmation && (
                    <p className={styles.riskMessage}>{t('downloadRiskyFileHint')}</p>
                  )}
                  {telemetry && (
                    <div
                      className={[
                        styles.transferMeta,
                        variant === 'browsing' ? styles.transferMetaCompact : '',
                      ].filter(Boolean).join(' ')}
                      aria-live="polite"
                    >
                      <span>{formatTransferRate(telemetry.speedBps)}</span>
                      {telemetry.etaSeconds !== null && (
                        <>
                          <span className={styles.metaDot}>•</span>
                          <span>{formatEta(telemetry.etaSeconds, tf)}</span>
                        </>
                      )}
                    </div>
                  )}
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
                  {item.requiresConfirmation ? (
                    <>
                      <button
                        type="button"
                        className={styles.actionText}
                        onClick={() => void keepDangerousDownload(item)}
                      >
                        {keepConfirmationId === item.id
                          ? t('downloadKeepAnyway')
                          : t('downloadKeep')}
                      </button>
                      <button
                        type="button"
                        className={[styles.actionText, styles.actionDanger].join(' ')}
                        onClick={() => void runAction(item.id, 'delete')}
                      >
                        {t('downloadDelete')}
                      </button>
                    </>
                  ) : item.state === 'in_progress' && (
                    <button type="button" onClick={() => void runAction(item.id, 'pause')} title={t('downloadPause')} aria-label={t('downloadPause')}>
                      <ActionIcon action="pause" />
                    </button>
                  )}
                  {!item.requiresConfirmation && item.state === 'paused' && (
                    <button type="button" onClick={() => void runAction(item.id, 'resume')} title={t('downloadResume')} aria-label={t('downloadResume')}>
                      <ActionIcon action="resume" />
                    </button>
                  )}
                  {!item.requiresConfirmation && active && (
                    <button type="button" onClick={() => void runAction(item.id, 'cancel')} title={t('downloadCancel')} aria-label={t('downloadCancel')}>
                      <ActionIcon action="cancel" />
                    </button>
                  )}
                  {item.state === 'interrupted' && (
                    <button
                      type="button"
                      className={styles.actionText}
                      onClick={() => void runAction(item.id, 'retry')}
                    >
                      {t('downloadRetry')}
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
