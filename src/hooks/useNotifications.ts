import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DownloadItem } from '../core/download'
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
  replaySiteNotifications,
  type NativeSiteNotification,
  type NebulaNotification,
  type SiteNotificationPermission,
} from '../core/notification'
import { persistLocalStorage, useStorageSync } from '../core/storageSync'
import { useLocale } from './useLocale'

export function useNotifications(
  downloads: DownloadItem[],
  siteNotificationsEnabled: boolean,
  downloadNotificationsEnabled: boolean,
) {
  const { t } = useLocale()
  const [items, setItems] = useState<NebulaNotification[]>(loadNotifications)
  const [sitePermissions, setSitePermissions] = useState(loadSiteNotificationPermissions)
  const siteNotificationsEnabledRef = useRef(siteNotificationsEnabled)
  const translateRef = useRef(t)
  const latestBrokerSequenceRef = useRef(0)
  const nativeDownloadToastIdsRef = useRef(new Set<string>())

  useEffect(() => {
    siteNotificationsEnabledRef.current = siteNotificationsEnabled
  }, [siteNotificationsEnabled])

  useEffect(() => {
    translateRef.current = t
  }, [t])

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
    const receive = (payload: NativeSiteNotification) => {
      if (disposed || !siteNotificationsEnabledRef.current) return
      const origin = normalizeNotificationOrigin(payload.origin)
      if (!origin) return
      const timestampMs = payload.timestampMs || Date.now()
      if (Number.isFinite(payload.sequence)) {
        latestBrokerSequenceRef.current = Math.max(
          latestBrokerSequenceRef.current,
          payload.sequence,
        )
      }
      const title = payload.title || notificationHost(origin)
      const body = payload.body || translateRef.current('notificationSocialActivityBody')
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
    }
    void (async () => {
      const dispose = await listenSiteNotifications(receive)
      if (disposed) {
        dispose()
        return
      }
      unlisten = dispose
      const replay = await replaySiteNotifications(
        latestBrokerSequenceRef.current || null,
      )
      if (disposed) return
      replay.forEach(receive)
    })()
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [add])

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
