import { useMemo, useRef } from 'react'
import {
  notificationHost,
  notificationSiteName,
  type NebulaNotification,
} from '../../core/notification'
import { getLocaleCopy, type NebulaLocale } from '../../core/locale'
import { useLocale } from '../../hooks/useLocale'
import { useDialogFocusTrap } from '../../hooks/useDialogFocusTrap'
import styles from './NotificationPanel.module.css'

interface NotificationPanelProps {
  items: NebulaNotification[]
  variant: 'home' | 'browsing'
  browsingTop?: number
  onMarkRead: (id: string, read?: boolean) => void
  onMarkAllRead: () => void
  onRemove: (id: string) => void
  onClear: () => void
  onOpenOrigin: (
    origin: string,
    tabLabel: string | null,
    targetUrl: string | null,
  ) => void
  onOpenDownload: (downloadId: string) => void
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

const NOTIFICATION_TYPE_COPY = {
  tr: {
    reply: 'Yanıt',
    reaction: 'Tepki',
    mention: 'Bahsetme',
    message: 'Mesaj',
    live: 'Canlı yayın',
    call: 'Arama',
    post: 'Gönderi',
    download: 'İndirme tamamlandı',
  },
  en: {
    reply: 'Reply',
    reaction: 'Reaction',
    mention: 'Mention',
    message: 'Message',
    live: 'Live',
    call: 'Call',
    post: 'Post',
    download: 'Download complete',
  },
  es: {
    reply: 'Respuesta',
    reaction: 'Reacción',
    mention: 'Mención',
    message: 'Mensaje',
    live: 'En directo',
    call: 'Llamada',
    post: 'Publicación',
    download: 'Descarga completada',
  },
  de: {
    reply: 'Antwort',
    reaction: 'Reaktion',
    mention: 'Erwähnung',
    message: 'Nachricht',
    live: 'Live',
    call: 'Anruf',
    post: 'Beitrag',
    download: 'Download abgeschlossen',
  },
  fr: {
    reply: 'Réponse',
    reaction: 'Réaction',
    mention: 'Mention',
    message: 'Message',
    live: 'En direct',
    call: 'Appel',
    post: 'Publication',
    download: 'Téléchargement terminé',
  },
  id: {
    reply: 'Balasan',
    reaction: 'Reaksi',
    mention: 'Sebutan',
    message: 'Pesan',
    live: 'Live',
    call: 'Panggilan',
    post: 'Postingan',
    download: 'Unduhan selesai',
  },
  ru: {
    reply: 'Ответ',
    reaction: 'Реакция',
    mention: 'Упоминание',
    message: 'Сообщение',
    live: 'Прямой эфир',
    call: 'Звонок',
    post: 'Публикация',
    download: 'Загрузка завершена',
  },
  it: {
    reply: 'Risposta',
    reaction: 'Reazione',
    mention: 'Menzione',
    message: 'Messaggio',
    live: 'Diretta',
    call: 'Chiamata',
    post: 'Post',
    download: 'Download completato',
  },
  ja: {
    reply: '返信',
    reaction: 'リアクション',
    mention: 'メンション',
    message: 'メッセージ',
    live: 'ライブ',
    call: '通話',
    post: '投稿',
    download: 'ダウンロード完了',
  },
} as const

function notificationTypeLabel(
  eventKind: string | null,
  type: string | null,
  locale: NebulaLocale,
): string | null {
  const normalized = (eventKind || type || '').toLocaleLowerCase()
  if (!normalized) return null
  const copy = getLocaleCopy(NOTIFICATION_TYPE_COPY, locale)
  if (normalized === 'reply') return copy.reply
  if (normalized === 'reaction' || normalized.includes('reaction') || normalized.endsWith('_like')) {
    return copy.reaction
  }
  if (normalized === 'mention' || normalized.includes('mention')) return copy.mention
  if (normalized === 'message' || normalized.startsWith('direct_v2')) return copy.message
  if (normalized === 'live' || normalized.includes('live_broadcast')) return copy.live
  if (normalized === 'call' || normalized.includes('rtc')) return copy.call
  if (normalized === 'post') return copy.post
  if (normalized === 'download') return copy.download
  return null
}

function siteGlyphClass(origin: string | null): string {
  const host = origin ? notificationHost(origin) : ''
  if (host === 'instagram.com' || host.endsWith('.instagram.com')) return styles.instagramGlyph
  if (host === 'web.whatsapp.com' || host.endsWith('.whatsapp.com')) return styles.whatsappGlyph
  return ''
}

export function NotificationPanel({
  items,
  variant,
  browsingTop = 220,
  onMarkRead,
  onMarkAllRead,
  onRemove,
  onClear,
  onOpenOrigin,
  onOpenDownload,
  onClose,
}: NotificationPanelProps) {
  const { t, tf, locale } = useLocale()
  const hasUnread = items.some((item) => !item.read)
  const timeFormatter = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: 'short',
  })
  const notificationGroups = useMemo(() => {
    const groups = new Map<string, {
      key: string
      title: string
      items: NebulaNotification[]
      unreadCount: number
    }>()
    for (const item of items) {
      const key = item.origin ?? `kind:${item.kind}`
      const title = item.origin
        ? item.siteName || notificationSiteName(item.origin)
        : t('notificationDownloads')
      const group = groups.get(key) ?? { key, title, items: [], unreadCount: 0 }
      group.items.push(item)
      if (!item.read) group.unreadCount += 1
      groups.set(key, group)
    }
    return [...groups.values()]
  }, [items, t])

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
            notificationGroups.map((group) => (
              <section key={group.key} className={styles.group}>
                <header className={styles.groupHeader}>
                  <span>{group.title}</span>
                  <span>
                    {group.items.length}
                    {group.unreadCount > 0 && (
                      <> · {tf('notificationUnreadCount', { n: group.unreadCount })}</>
                    )}
                  </span>
                </header>
                {group.items.map((item) => {
                  const siteName = item.siteName || (item.origin
                    ? notificationSiteName(item.origin)
                    : 'Nebula')
                  const typeLabel = notificationTypeLabel(
                    item.eventKind,
                    item.notificationType,
                    locale,
                  )
                  const headline = item.senderName || (
                    item.title && item.title.toLocaleLowerCase() !== siteName.toLocaleLowerCase()
                      ? item.title
                      : siteName
                  )
                  return (
                    <article
                      key={item.id}
                      className={[styles.item, item.read ? styles.itemRead : styles.itemUnread].join(' ')}
                    >
                      <button
                        type="button"
                        className={styles.itemMain}
                        disabled={!item.origin && !item.downloadId}
                        onClick={() => {
                          onMarkRead(item.id)
                          if (item.origin) onOpenOrigin(item.origin, item.tabLabel, item.targetUrl)
                          else if (item.downloadId) onOpenDownload(item.downloadId)
                        }}
                      >
                        <span
                          className={[
                            styles.glyph,
                            item.kind === 'download' ? styles.downloadGlyph : siteGlyphClass(item.origin),
                          ].filter(Boolean).join(' ')}
                        >
                          {item.kind === 'download'
                            ? <DownloadGlyph />
                            : <span className={styles.siteInitial}>{siteName.slice(0, 1)}</span>}
                          {item.iconUrl && (
                            <img
                              className={styles.avatar}
                              src={item.iconUrl}
                              alt=""
                              referrerPolicy="no-referrer"
                              onError={(event) => { event.currentTarget.style.display = 'none' }}
                            />
                          )}
                        </span>
                        <span className={styles.itemBody}>
                          <span className={styles.itemTopline}>
                            <span className={styles.siteName}>{siteName}</span>
                            {typeLabel && <span className={styles.kindBadge}>{typeLabel}</span>}
                            <span className={styles.itemTime}>{timeFormatter.format(item.createdAtMs)}</span>
                          </span>
                          <span className={styles.itemTitle}>{headline}</span>
                          {item.body && <span className={styles.itemMessage}>{item.body}</span>}
                          <span className={styles.meta}>
                            {item.origin ? notificationHost(item.origin) : t('notificationDownloadSource')}
                            {item.targetUrl && (
                              <><span>•</span>{t('notificationOpenRelated')}</>
                            )}
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
                  )
                })}
              </section>
            ))
          )}
        </div>

      </div>
      </section>
    </>
  )
}
