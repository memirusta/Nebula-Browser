import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { isTauri } from '../platform/runtime'
import type { DownloadItem } from '../core/download'
import {
  loadNotifications,
  loadSiteNotificationPermissions,
  NOTIFICATION_PERMISSIONS_KEY,
  NOTIFICATION_STORE_KEY,
  normalizeNotificationOrigin,
  normalizeNotificationTargetUrl,
  notificationHost,
  notificationSiteName,
  showNativeNotification,
  listenSiteNotifications,
  replaySiteNotifications,
  type NativeSiteNotification,
  type NebulaNotification,
  type SiteNotificationPermission,
} from '../core/notification'
import { persistLocalStorage, useStorageSync } from '../core/storageSync'
import { useLocale } from './useLocale'
import { changeNotificationHistory, NOTIFICATION_HISTORY_CHANGED, type NotificationHistoryChange } from '../core/notificationHistory'

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
  const recordedDownloadIdsRef = useRef(new Set<string>())
  const [historyError, setHistoryError] = useState(false)

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

  const updateHistory = useCallback(async (change: NotificationHistoryChange) => {
    try {
      await changeNotificationHistory(change)
      setHistoryError(false)
      reloadItems()
      return true
    } catch {
      setHistoryError(true)
      return false
    }
  }, [reloadItems])

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    window.addEventListener(NOTIFICATION_HISTORY_CHANGED, reloadItems)
    if (isTauri) {
      void listen(NOTIFICATION_HISTORY_CHANGED, reloadItems).then((stop) => {
        if (disposed) stop()
        else unlisten = stop
      }).catch(() => setHistoryError(true))
    }
    void updateHistory({ type: 'reload' })
    return () => {
      disposed = true
      unlisten?.()
      window.removeEventListener(NOTIFICATION_HISTORY_CHANGED, reloadItems)
    }
  }, [reloadItems, updateHistory])

  useEffect(() => {
    persistLocalStorage(NOTIFICATION_PERMISSIONS_KEY, JSON.stringify(sitePermissions))
  }, [sitePermissions])

  const add = useCallback((notification: NebulaNotification) => {
    void updateHistory({ type: 'add', items: [notification] })
  }, [updateHistory])

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    const replayAfter = latestBrokerSequenceRef.current || null
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
        siteName: payload.siteName || notificationSiteName(origin),
        senderName: payload.senderName || null,
        eventKind: payload.eventKind || null,
        iconUrl: payload.iconUrl || null,
        notificationTag: payload.notificationTag || null,
        notificationType: payload.notificationType || null,
        targetUrl: normalizeNotificationTargetUrl(payload.targetUrl, origin),
        notificationData: payload.notificationData ?? null,
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
        replayAfter,
      )
      if (disposed) return
      replay.forEach(receive)
    })().catch(() => { if (!disposed) setHistoryError(true) })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [add])

  useEffect(() => {
    for (const download of downloads) {
      if (download.state !== 'completed' || download.requiresConfirmation) continue
      const notificationId = `download-${download.id}`
      if (!recordedDownloadIdsRef.current.has(download.id)) {
        recordedDownloadIdsRef.current.add(download.id)
        void updateHistory({ type: 'add', items: [{
          id: notificationId,
          kind: 'download',
          title: download.fileName,
          body: t('notificationDownloadCompleteBody'),
          origin: null,
          siteName: 'Nebula',
          senderName: null,
          eventKind: 'download',
          iconUrl: null,
          notificationTag: null,
          notificationType: null,
          targetUrl: null,
          notificationData: null,
          tabLabel: download.tabLabel,
          downloadId: download.id,
          createdAtMs: Date.now(),
          read: false,
        }] }).then((updated) => {
          if (!updated) recordedDownloadIdsRef.current.delete(download.id)
        })
      }
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
          null,
          'Nebula',
          null,
          'download',
        ).catch(() => undefined)
      }
    }
  }, [downloadNotificationsEnabled, downloads, t, updateHistory])

  const unreadCount = useMemo(() => items.filter((item) => !item.read).length, [items])

  const markRead = useCallback((id: string, read = true) => {
    void updateHistory({ type: 'read', id, read })
  }, [updateHistory])

  const markAllRead = useCallback(() => {
    void updateHistory({ type: 'read', read: true })
  }, [updateHistory])

  const remove = useCallback((id: string) => {
    void updateHistory({ type: 'remove', id })
  }, [updateHistory])

  const clear = useCallback(() => { void updateHistory({ type: 'remove' }) }, [updateHistory])

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
    historyError,
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
