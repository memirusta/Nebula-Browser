import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '../platform/runtime'

export const NOTIFICATION_STORE_KEY = 'nebula-notifications-v1'
export const NOTIFICATION_PERMISSIONS_KEY = 'nebula-notification-permissions-v1'
export const MAX_STORED_NOTIFICATIONS = 200

export type NotificationKind = 'site' | 'download'
export type SiteNotificationPermission = 'allow' | 'block'

export interface NebulaNotification {
  id: string
  kind: NotificationKind
  title: string
  body: string
  origin: string | null
  siteName: string | null
  senderName: string | null
  eventKind: string | null
  iconUrl: string | null
  notificationTag: string | null
  notificationType: string | null
  targetUrl: string | null
  notificationData: unknown | null
  tabLabel: string | null
  downloadId: string | null
  createdAtMs: number
  read: boolean
}

export interface NativeSiteNotification {
  id: string
  sequence: number
  source: 'webview2' | 'content-adapter' | 'title-fallback'
  tabLabel: string
  origin: string
  title: string
  body: string
  siteName: string
  senderName: string
  eventKind: string
  iconUrl: string
  notificationTag: string
  notificationType: string
  targetUrl: string
  notificationData?: unknown
  timestampMs: number
}

export interface NativeNotificationActivation {
  tabLabel?: string | null
  origin?: string | null
  downloadId?: string | null
}

export type SiteNotificationPermissions = Record<string, SiteNotificationPermission>

function validString(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

export function normalizeNotificationOrigin(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.origin
  } catch {
    return null
  }
}

export function notificationHost(origin: string): string {
  try {
    return new URL(origin).hostname.toLocaleLowerCase()
  } catch {
    return origin
  }
}

export function notificationSiteName(origin: string): string {
  const host = notificationHost(origin)
  if (host === 'instagram.com' || host.endsWith('.instagram.com')) return 'Instagram'
  if (host === 'web.whatsapp.com' || host.endsWith('.whatsapp.com')) return 'WhatsApp'
  if (host === 'messenger.com' || host.endsWith('.messenger.com')) return 'Messenger'
  if (host === 'facebook.com' || host.endsWith('.facebook.com')) return 'Facebook'
  if (host === 'x.com' || host.endsWith('.x.com') || host.endsWith('.twitter.com')) return 'X'
  if (host === 'mail.google.com') return 'Gmail'
  if (host === 'youtube.com' || host.endsWith('.youtube.com')) return 'YouTube'
  if (host === 'discord.com' || host.endsWith('.discord.com')) return 'Discord'
  if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) return 'LinkedIn'
  if (host === 'reddit.com' || host.endsWith('.reddit.com')) return 'Reddit'
  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) return 'TikTok'
  return host.replace(/^www\./, '')
}

function normalizeEventKind(value: unknown): string | null {
  const kind = validString(value, 40)
  return [
    'message',
    'reply',
    'reaction',
    'mention',
    'live',
    'call',
    'post',
    'download',
    'notification',
  ].includes(kind) ? kind : null
}

function deriveEventKind(notificationType: unknown, body: string): string | null {
  const type = validString(notificationType, 120).toLocaleLowerCase()
  const text = body.toLocaleLowerCase()
  if (/repl(?:y|ied)|yan[ıi]t|cevap/.test(text)) return 'reply'
  if (type.includes('reaction') || type.endsWith('_like')) return 'reaction'
  if (type.includes('mention')) return 'mention'
  if (type === 'message' || type.startsWith('direct_v2')) return 'message'
  if (type.includes('live_broadcast')) return 'live'
  if (type.includes('rtc') || type.includes('call')) return 'call'
  if (type === 'post') return 'post'
  return null
}

function deriveSenderName(title: string, body: string, siteName: string): string | null {
  if (title && title.toLocaleLowerCase() !== siteName.toLocaleLowerCase()) return title
  const separator = body.indexOf(':')
  if (separator <= 0 || separator > 80) return null
  const prefix = body.slice(0, separator).trim()
  return prefix && /[a-zA-ZÀ-ž]/.test(prefix) && !prefix.includes('//') ? prefix : null
}

export function normalizeNotificationTargetUrl(value: unknown, origin: string): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const target = new URL(value)
    const source = new URL(origin)
    if (target.protocol !== 'https:') return null
    const sourceIsInstagram =
      source.hostname === 'instagram.com' || source.hostname.endsWith('.instagram.com')
    const targetIsInstagram =
      target.hostname === 'instagram.com' || target.hostname.endsWith('.instagram.com')
    if (target.origin !== source.origin && !(sourceIsInstagram && targetIsInstagram)) return null
    return target.href.slice(0, 2_048)
  } catch {
    return null
  }
}

function normalizeNotificationData(value: unknown): unknown | null {
  if (value == null) return null
  try {
    const serialized = JSON.stringify(value)
    return serialized.length <= 8_192 ? JSON.parse(serialized) : null
  } catch {
    return null
  }
}

export function loadNotifications(): NebulaNotification[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(NOTIFICATION_STORE_KEY) ?? '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item): NebulaNotification | null => {
        if (!item || typeof item !== 'object') return null
        const value = item as Partial<NebulaNotification>
        const id = validString(value.id, 180)
        const kind = value.kind === 'site' || value.kind === 'download' ? value.kind : null
        if (!id || !kind) return null
        const origin = value.origin ? normalizeNotificationOrigin(value.origin) : null
        const title = validString(value.title, 300)
        const body = validString(value.body, 2_000)
        const siteName = validString(value.siteName, 80) || (origin ? notificationSiteName(origin) : '')
        const notificationType = validString(value.notificationType, 120) || null
        return {
          id,
          kind,
          title,
          body,
          origin,
          siteName: siteName || null,
          senderName: validString(value.senderName, 120) || deriveSenderName(title, body, siteName),
          eventKind: normalizeEventKind(value.eventKind) || deriveEventKind(notificationType, body),
          iconUrl: validString(value.iconUrl, 2_000) || null,
          notificationTag: validString(value.notificationTag, 300) || null,
          notificationType,
          targetUrl: origin
            ? normalizeNotificationTargetUrl(value.targetUrl, origin)
            : null,
          notificationData: normalizeNotificationData(value.notificationData),
          tabLabel: validString(value.tabLabel, 180) || null,
          downloadId: validString(value.downloadId, 180) || null,
          createdAtMs:
            typeof value.createdAtMs === 'number' && Number.isFinite(value.createdAtMs)
              ? value.createdAtMs
              : Date.now(),
          read: value.read === true,
        }
      })
      .filter((item): item is NebulaNotification => item !== null)
      .slice(0, MAX_STORED_NOTIFICATIONS)
  } catch {
    return []
  }
}

export function loadSiteNotificationPermissions(): SiteNotificationPermissions {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(NOTIFICATION_PERMISSIONS_KEY) ?? '{}',
    ) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const permissions: SiteNotificationPermissions = {}
    for (const [rawOrigin, rawPermission] of Object.entries(parsed)) {
      const origin = normalizeNotificationOrigin(rawOrigin)
      if (!origin || (rawPermission !== 'allow' && rawPermission !== 'block')) continue
      permissions[origin] = rawPermission
    }
    return permissions
  } catch {
    return {}
  }
}

export function listenSiteNotifications(
  onNotification: (notification: NativeSiteNotification) => void,
): Promise<UnlistenFn> {
  if (!isTauri) return Promise.resolve(() => {})
  return listen<NativeSiteNotification>('nebula-notification-broker', ({ payload }) => {
    onNotification(payload)
  })
}

export async function replaySiteNotifications(
  afterSequence: number | null = null,
): Promise<NativeSiteNotification[]> {
  if (!isTauri) return []
  return invoke<NativeSiteNotification[]>('notification_broker_replay', {
    afterSequence,
  })
}

export function listenNativeNotificationActivations(
  onActivation: (activation: NativeNotificationActivation) => void,
): Promise<UnlistenFn> {
  if (!isTauri) return Promise.resolve(() => {})
  return listen<NativeNotificationActivation>(
    'nebula-native-notification-activated',
    ({ payload }) => onActivation(payload),
  )
}

export async function showNativeNotification(
  title: string,
  body: string,
  tabLabel?: string | null,
  origin?: string | null,
  downloadId?: string | null,
  iconUrl?: string | null,
  siteName?: string | null,
  senderName?: string | null,
  eventKind?: string | null,
): Promise<void> {
  if (!isTauri) return
  await invoke('show_native_notification', {
    title,
    body,
    tabLabel,
    origin,
    downloadId,
    iconUrl,
    siteName,
    senderName,
    eventKind,
  })
}
