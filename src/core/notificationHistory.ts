import { invoke } from '@tauri-apps/api/core'
import { emit } from '@tauri-apps/api/event'
import { isTauri } from '../platform/runtime'
import { persistLocalStorage, removeLocalStorage } from './storageSync'
import { loadNotifications, MAX_STORED_NOTIFICATIONS, NOTIFICATION_STORE_KEY, type NebulaNotification } from './notification'

const HISTORY_LOCK = 'nebula-notification-history'
const webDeletedIds = new Set<string>()
let localQueue: Promise<unknown> = Promise.resolve()

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  if (navigator.locks) return navigator.locks.request(HISTORY_LOCK, operation)
  // Native windows must share a lock; never fall back to unsafe competing writes.
  if (isTauri) return Promise.reject(new Error('Notification history lock unavailable'))
  const result = localQueue.then(operation, operation)
  localQueue = result.catch(() => undefined)
  return result
}

async function permitted(items: NebulaNotification[]): Promise<NebulaNotification[]> {
  if (!isTauri) return items.filter((item) => !webDeletedIds.has(item.id))
  const ids = await invoke<string[]>('notification_history_allowed_ids', {
    items: items.map(({ id, tabLabel }) => ({ id, tabLabel })),
  })
  const allowed = new Set(ids)
  return items.filter((item) => allowed.has(item.id))
}

export type NotificationHistoryChange =
  | { type: 'add'; items: NebulaNotification[] }
  | { type: 'read'; id?: string; read: boolean }
  | { type: 'remove'; id?: string }
  | { type: 'reload' }

export function changeNotificationHistory(change: NotificationHistoryChange): Promise<void> {
  return serialize(async () => {
    // Read inside the shared lock. A delayed replay or another window can never
    // write an old React snapshot over a completed deletion.
    const stored = loadNotifications()
    let next = stored
    if (change.type === 'remove') {
      const ids = change.id === undefined ? stored.map((item) => item.id) : [change.id]
      if (isTauri) await invoke('notification_history_forget', { ids, all: change.id === undefined })
      else ids.forEach((id) => webDeletedIds.add(id))
      const removed = new Set(ids)
      next = stored.filter((item) => !removed.has(item.id))
    } else if (change.type === 'add') {
      const seen = new Set(stored.map((item) => item.id))
      const additions = change.items.filter((item) => {
        if (seen.has(item.id)) return false
        seen.add(item.id)
        return true
      })
      next = [...additions, ...stored]
    } else if (change.type === 'read') {
      next = stored.map((item) => change.id === undefined || change.id === item.id
        ? { ...item, read: change.read } : item)
    }
    next = (await permitted(next)).slice(0, MAX_STORED_NOTIFICATIONS)
    const serialized = next.length ? JSON.stringify(next) : null
    if (serialized !== localStorage.getItem(NOTIFICATION_STORE_KEY)) {
      if (serialized === null) removeLocalStorage(NOTIFICATION_STORE_KEY)
      else persistLocalStorage(NOTIFICATION_STORE_KEY, serialized)
      window.dispatchEvent(new Event(HISTORY_LOCK))
      if (isTauri) await emit(HISTORY_LOCK)
    }
  })
}

export const NOTIFICATION_HISTORY_CHANGED = HISTORY_LOCK
