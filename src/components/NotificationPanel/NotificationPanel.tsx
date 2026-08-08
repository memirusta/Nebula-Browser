import { useRef } from 'react'
import {
  notificationHost,
  type NebulaNotification,
  type SiteNotificationPermission,
  type SiteNotificationPermissions,
} from '../../core/notification'
import { useLocale } from '../../hooks/useLocale'
import { useDialogFocusTrap } from '../../hooks/useDialogFocusTrap'
import styles from './NotificationPanel.module.css'

interface NotificationPanelProps {
  items: NebulaNotification[]
  sites: string[]
  sitePermissions: SiteNotificationPermissions
  variant: 'home' | 'browsing'
  browsingTop?: number
  siteNotificationsEnabled: boolean
  onMarkRead: (id: string, read?: boolean) => void
  onMarkAllRead: () => void
  onRemove: (id: string) => void
  onClear: () => void
  onSetSitePermission: (
    origin: string,
    permission: SiteNotificationPermission | null,
  ) => void
  onOpenOrigin: (origin: string) => void
  onClose: () => void
}

function BellGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 22a2.3 2.3 0 0 0 2.2-1.7H9.8A2.3 2.3 0 0 0 12 22Zm7-5-1.7-2v-4.3A5.4 5.4 0 0 0 13.2 5V4a1.2 1.2 0 1 0-2.4 0v1a5.4 5.4 0 0 0-4.1 5.7V15L5 17v1h14v-1Z" />
    </svg>
  )
}

function DownloadGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 4v10m0 0 4-4m-4 4-4-4M5 19h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function NotificationPanel({
  items,
  sites,
  sitePermissions,
  variant,
  browsingTop = 220,
  siteNotificationsEnabled,
  onMarkRead,
  onMarkAllRead,
  onRemove,
  onClear,
  onSetSitePermission,
  onOpenOrigin,
  onClose,
}: NotificationPanelProps) {
  const { t, locale } = useLocale()
  const hasUnread = items.some((item) => !item.read)
  const timeFormatter = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: 'short',
  })

  const panelRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  useDialogFocusTrap({ active: true, containerRef: panelRef, initialFocusRef: closeRef, onEscape: onClose })

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} aria-hidden="true" />
      <section
        ref={panelRef}
        className={[styles.panel, variant === 'browsing' ? styles.panelBrowsing : styles.panelHome].join(' ')}
        style={variant === 'browsing' ? { top: browsingTop } : undefined}
        role="dialog"
        aria-modal="true"
        aria-label={t('notificationCenter')}
        tabIndex={-1}
      >
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>{t('notificationCenterEyebrow')}</span>
          <h2>{t('notificationCenter')}</h2>
        </div>
        <div className={styles.headerActions}>
          {hasUnread && (
            <button type="button" className={styles.textButton} onClick={onMarkAllRead}>
              {t('notificationMarkAllRead')}
            </button>
          )}
          {items.length > 0 && (
            <button type="button" className={styles.textButton} onClick={onClear}>
              {t('notificationClear')}
            </button>
          )}
          <button ref={closeRef} type="button" className={styles.closeButton} onClick={onClose} aria-label={t('close')}>
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="m7 7 10 10m0-10L7 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </header>

      <div className={styles.content}>
        <div className={styles.list}>
          {items.length === 0 ? (
            <div className={styles.empty}>
              <span className={styles.emptyGlyph}><BellGlyph /></span>
              <strong>{t('notificationEmpty')}</strong>
              <p>{t('notificationEmptyHint')}</p>
            </div>
          ) : (
            items.map((item) => (
              <article
                key={item.id}
                className={[styles.item, item.read ? styles.itemRead : styles.itemUnread].join(' ')}
              >
                <button
                  type="button"
                  className={styles.itemMain}
                  disabled={!item.origin}
                  onClick={() => {
                    onMarkRead(item.id)
                    if (item.origin) onOpenOrigin(item.origin)
                  }}
                >
                  <span className={[styles.glyph, item.kind === 'download' ? styles.downloadGlyph : ''].filter(Boolean).join(' ')}>
                    {item.kind === 'download' ? <DownloadGlyph /> : <BellGlyph />}
                  </span>
                  <span className={styles.itemBody}>
                    <span className={styles.itemTitle}>{item.title}</span>
                    {item.body && <span className={styles.itemMessage}>{item.body}</span>}
                    <span className={styles.meta}>
                      {item.origin ? notificationHost(item.origin) : t('notificationDownloadSource')}
                      <span>•</span>
                      {timeFormatter.format(item.createdAtMs)}
                    </span>
                  </span>
                </button>
                <div className={styles.itemActions}>
                  <button
                    type="button"
                    onClick={() => onMarkRead(item.id, !item.read)}
                    title={item.read ? t('notificationMarkUnread') : t('notificationMarkRead')}
                    aria-label={item.read ? t('notificationMarkUnread') : t('notificationMarkRead')}
                  >
                    <span className={item.read ? styles.readDot : styles.unreadDot} />
                  </button>
                  <button type="button" onClick={() => onRemove(item.id)} title={t('notificationRemove')} aria-label={t('notificationRemove')}>
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="m7 7 10 10m0-10L7 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              </article>
            ))
          )}
        </div>

        <section className={styles.permissions} aria-label={t('notificationSitePermissions')}>
          <div className={styles.permissionsHeader}>
            <div>
              <h3>{t('notificationSitePermissions')}</h3>
              <p>{siteNotificationsEnabled ? t('notificationSitePermissionsHint') : t('notificationSitesDisabled')}</p>
            </div>
          </div>
          {sites.length === 0 ? (
            <p className={styles.noSites}>{t('notificationNoSites')}</p>
          ) : (
            <div className={styles.siteList}>
              {sites.map((origin) => {
                const permission = sitePermissions[origin]
                return (
                  <div key={origin} className={styles.siteRow}>
                    <span title={origin}>{notificationHost(origin)}</span>
                    <div className={styles.permissionButtons}>
                      <button
                        type="button"
                        className={permission === 'allow' ? styles.allowActive : ''}
                        onClick={() => onSetSitePermission(origin, 'allow')}
                      >
                        {t('notificationAllow')}
                      </button>
                      <button
                        type="button"
                        className={permission === 'block' ? styles.blockActive : ''}
                        onClick={() => onSetSitePermission(origin, 'block')}
                      >
                        {t('notificationBlock')}
                      </button>
                      {permission && (
                        <button type="button" onClick={() => onSetSitePermission(origin, null)}>
                          {t('notificationDefault')}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>
      </section>
    </>
  )
}
