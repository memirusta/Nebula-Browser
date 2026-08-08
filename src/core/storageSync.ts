import { emit, listen } from '@tauri-apps/api/event'
import { useEffect } from 'react'
import { isChromeShell } from './nebulaBridge'
import { isTauri } from '../platform/runtime'

export const STORAGE_SYNC_EVENT = 'nebula-storage-sync'

export function storageSyncSource(): string {
  return isChromeShell() ? 'chrome' : 'shell'
}

/** Persist to localStorage and notify other Nebula webviews. */
export function persistLocalStorage(key: string, value: string): void {
  localStorage.setItem(key, value)

  if (isTauri) {
    void emit(STORAGE_SYNC_EVENT, {
      key,
      source: storageSyncSource(),
    })
  }
}

/** Remove from localStorage and notify the current + other Nebula webviews. */
export function removeLocalStorage(key: string): void {
  const oldValue = localStorage.getItem(key)

  localStorage.removeItem(key)

  // The browser normally does not fire "storage" in the same webview that
  // performed the mutation, so notify local React hooks manually.
  window.dispatchEvent(
    new StorageEvent('storage', {
      key,
      oldValue,
      newValue: null,
      storageArea: localStorage,
      url: window.location.href,
    }),
  )

  if (isTauri) {
    void emit(STORAGE_SYNC_EVENT, {
      key,
      source: storageSyncSource(),
    })
  }
}

/** Reload state when another webview updates the same storage key. */
export function useStorageSync(
  key: string,
  onSync: () => void,
): void {
  useEffect(() => {
    const self = storageSyncSource()

    const onStorage = (event: StorageEvent) => {
      if (event.key === key) {
        onSync()
      }
    }

    let unlisten: (() => void) | undefined
    let cancelled = false

    if (isTauri) {
      void listen<{
        key: string
        source: string
      }>(STORAGE_SYNC_EVENT, (event) => {
        if (
          event.payload.key === key &&
          event.payload.source !== self
        ) {
          onSync()
        }
      }).then((fn) => {
        if (cancelled) {
          fn()
          return
        }

        unlisten = fn
      })
    }

    window.addEventListener('storage', onStorage)

    return () => {
      cancelled = true
      window.removeEventListener('storage', onStorage)
      unlisten?.()
    }
  }, [key, onSync])
}