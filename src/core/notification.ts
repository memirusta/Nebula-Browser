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
  iconUrl: string | null
  tabLabel: string | null
  downloadId: string | null
  createdAtMs: number
  read: boolean
}

export interface NativeSiteNotification {
  id: string
  tabLabel: string
  origin: string
  title: string
  body: string
  iconUrl: string
  timestampMs: number
  requiresNativeToast?: boolean
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
        return {
          id,
          kind,
          title: validString(value.title, 300),
          body: validString(value.body, 2_000),
          origin,
          iconUrl: validString(value.iconUrl, 2_000) || null,
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
  return listen<NativeSiteNotification>('nebula-site-notification', ({ payload }) => {
    onNotification(payload)
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
): Promise<void> {
  if (!isTauri) return
  await invoke('show_native_notification', { title, body, tabLabel, origin, downloadId })
}
