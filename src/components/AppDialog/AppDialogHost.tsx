import { useEffect, useRef, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import {
  getAppDialogsSnapshot,
  resolveAppDialog,
  subscribeAppDialogs,
} from '../../core/appDialog'
import { useLocale } from '../../hooks/useLocale'
import styles from '../SiteUiPrompt/SiteUiPrompt.module.css'

export function AppDialogHost() {
  const queue = useSyncExternalStore(
    subscribeAppDialogs,
    getAppDialogsSnapshot,
    getAppDialogsSnapshot,
  )
  const request = queue[0]
  const primaryRef = useRef<HTMLButtonElement>(null)
  const { locale, t } = useLocale()

  useEffect(() => {
    if (!request) return
    const timer = window.setTimeout(() => primaryRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [request])

  if (!request) return null

  const acceptLabel =
    request.kind === 'alert'
      ? locale === 'tr' ? 'Tamam' : 'OK'
      : locale === 'tr' ? 'Onayla' : 'Confirm'

  return createPortal(
    <div className={styles.backdrop} role="presentation">
      <section
        className={styles.card}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="nebula-app-dialog-title"
        aria-describedby="nebula-app-dialog-message"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && request.kind === 'confirm') {
            event.preventDefault()
            resolveAppDialog(request.id, false)
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            resolveAppDialog(request.id, true)
          }
        }}
      >
        <div className={styles.headerRow}>
          <div className={styles.siteMark}>N</div>
          <div className={styles.heading}>
            <span>{locale === 'tr' ? 'Uygulama mesajı' : 'App message'}</span>
            <h2 id="nebula-app-dialog-title">{request.title}</h2>
          </div>
          {queue.length > 1 && (
            <span className={styles.queueBadge}>+{queue.length - 1}</span>
          )}
        </div>

        <p id="nebula-app-dialog-message" className={styles.message}>
          {request.message}
        </p>

        <div className={styles.actions}>
          {request.kind === 'confirm' && (
            <button
              type="button"
              className={styles.secondary}
              onClick={() => resolveAppDialog(request.id, false)}
            >
              {t('cancel')}
            </button>
          )}
          <button
            ref={primaryRef}
            type="button"
            className={styles.primary}
            onClick={() => resolveAppDialog(request.id, true)}
          >
            {acceptLabel}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  )
}
