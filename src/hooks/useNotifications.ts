import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DownloadItem } from '../core/download'
import { faviconForUrl } from '../core/browserTab'
import {
  loadNotifications,
  loadSiteNotificationPermissions,
  MAX_STORED_NOTIFICATIONS,
  NOTIFICATION_PERMISSIONS_KEY,
  NOTIFICATION_STORE_KEY,
  normalizeNotificationOrigin,
  notificationHost,
  showNativeNotification,
  listenSiteNotifications,
  type NebulaNotification,
  type SiteNotificationPermission,
} from '../core/notification'
import { persistLocalStorage, useStorageSync } from '../core/storageSync'
import { useLocale } from './useLocale'

export function useNotifications(
  downloads: DownloadItem[],
  siteNotificationsEnabled: boolean,
  showNotificationContent: boolean,
  downloadNotificationsEnabled: boolean,
) {
  const { t } = useLocale()
  const [items, setItems] = useState<NebulaNotification[]>(loadNotifications)
  const [sitePermissions, setSitePermissions] = useState(loadSiteNotificationPermissions)
  const siteNotificationsEnabledRef = useRef(siteNotificationsEnabled)
  const showNotificationContentRef = useRef(showNotificationContent)
  const recentSiteNotificationsRef = useRef(new Map<string, number>())
  const nativeDownloadToastIdsRef = useRef(new Set<string>())

  useEffect(() => {
    siteNotificationsEnabledRef.current = siteNotificationsEnabled
  }, [siteNotificationsEnabled])

  useEffect(() => {
    showNotificationContentRef.current = showNotificationContent
  }, [showNotificationContent])

  const reloadItems = useCallback(() => setItems(loadNotifications()), [])
  const reloadPermissions = useCallback(
    () => setSitePermissions(loadSiteNotificationPermissions()),
    [],
  )
  useStorageSync(NOTIFICATION_STORE_KEY, reloadItems)
  useStorageSync(NOTIFICATION_PERMISSIONS_KEY, reloadPermissions)

  useEffect(() => {
    persistLocalStorage(NOTIFICATION_STORE_KEY, JSON.stringify(items))
  }, [items])

  useEffect(() => {
    persistLocalStorage(NOTIFICATION_PERMISSIONS_KEY, JSON.stringify(sitePermissions))
  }, [sitePermissions])

  const add = useCallback((notification: NebulaNotification) => {
    setItems((current) => {
      if (current.some((item) => item.id === notification.id)) return current
      return [notification, ...current].slice(0, MAX_STORED_NOTIFICATIONS)
    })
  }, [])

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    void listenSiteNotifications((payload) => {
      if (disposed || !siteNotificationsEnabledRef.current) return
      const origin = normalizeNotificationOrigin(payload.origin)
      if (!origin) return
      if (sitePermissions[origin] === 'block') return
      const timestampMs = payload.timestampMs || Date.now()
      const fingerprint = [origin, payload.title.trim(), payload.body.trim()].join('\u0000')
      const previousTimestamp = recentSiteNotificationsRef.current.get(fingerprint)
      if (previousTimestamp !== undefined && timestampMs - previousTimestamp < 2_500) return
      recentSiteNotificationsRef.current.set(fingerprint, timestampMs)
      for (const [key, seenAt] of recentSiteNotificationsRef.current) {
        if (timestampMs - seenAt > 10_000) recentSiteNotificationsRef.current.delete(key)
      }
      const title = showNotificationContentRef.current
        ? payload.title || notificationHost(origin)
        : notificationHost(origin)
      const body = showNotificationContentRef.current
        ? payload.body || t('notificationSocialActivityBody')
        : t('notificationSocialActivityBody')
      add({
        id: payload.id,
        kind: 'site',
        title,
        body,
        origin,
        iconUrl: payload.iconUrl || null,
        tabLabel: payload.tabLabel || null,
        downloadId: null,
        createdAtMs: timestampMs,
        read: false,
      })
      if (payload.requiresNativeToast) {
        const isWhatsApp = new URL(origin).hostname.toLowerCase() === 'web.whatsapp.com'
        const nativeTitle = isWhatsApp ? 'WhatsApp' : title
        const nativeBody = isWhatsApp && showNotificationContentRef.current
          ? [title, body].filter(Boolean).join('\n')
          : body
        void showNativeNotification(
          nativeTitle,
          nativeBody,
          payload.tabLabel,
          origin,
          null,
          faviconForUrl(origin),
        ).catch(() => undefined)
      }
    }).then((dispose) => {
      if (disposed) dispose()
      else unlisten = dispose
    })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [add, sitePermissions, t])

  useEffect(() => {
    for (const download of downloads) {
      if (download.state !== 'completed' || download.requiresConfirmation) continue
      const notificationId = `download-${download.id}`
      add({
        id: notificationId,
        kind: 'download',
        title: download.fileName,
        body: t('notificationDownloadCompleteBody'),
        origin: null,
        iconUrl: null,
        tabLabel: download.tabLabel,
        downloadId: download.id,
        createdAtMs: Date.now(),
        read: false,
      })
      if (
        downloadNotificationsEnabled &&
        !nativeDownloadToastIdsRef.current.has(download.id)
      ) {
        nativeDownloadToastIdsRef.current.add(download.id)
        void showNativeNotification(
          download.fileName,
          t('notificationDownloadCompleteBody'),
          download.tabLabel,
          null,
          download.id,
        ).catch(() => undefined)
      }
    }
  }, [add, downloadNotificationsEnabled, downloads, t])

  const unreadCount = useMemo(() => items.filter((item) => !item.read).length, [items])

  const markRead = useCallback((id: string, read = true) => {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, read } : item)),
    )
  }, [])

  const markAllRead = useCallback(() => {
    setItems((current) => current.map((item) => (item.read ? item : { ...item, read: true })))
  }, [])

  const remove = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id))
  }, [])

  const clear = useCallback(() => setItems([]), [])

  const setSitePermission = useCallback(
    (originValue: string, permission: SiteNotificationPermission | null) => {
      const origin = normalizeNotificationOrigin(originValue)
      if (!origin) return
      setSitePermissions((current) => {
        const next = { ...current }
        if (permission === null) delete next[origin]
        else next[origin] = permission
        return next
      })
    },
    [],
  )

  const clearSitePermissions = useCallback(() => {
    setSitePermissions({})
  }, [])

  const sites = useMemo(() => {
    const origins = new Set(Object.keys(sitePermissions))
    for (const item of items) {
      if (item.origin) origins.add(item.origin)
    }
    return [...origins].sort((a, b) => notificationHost(a).localeCompare(notificationHost(b)))
  }, [items, sitePermissions])

  const allowedSites = useMemo(
    () =>
      Object.entries(sitePermissions)
        .filter(([, permission]) => permission === 'allow')
        .map(([origin]) => origin),
    [sitePermissions],
  )
  const blockedSites = useMemo(
    () =>
      Object.entries(sitePermissions)
        .filter(([, permission]) => permission === 'block')
        .map(([origin]) => origin),
    [sitePermissions],
  )

  return {
    items,
    unreadCount,
    sitePermissions,
    sites,
    allowedSites,
    blockedSites,
    markRead,
    markAllRead,
    remove,
    clear,
    setSitePermission,
    clearSitePermissions,
  }
}
