import { useSyncExternalStore } from 'react'
import {
  FAVICON_CACHE_KEY,
  faviconVersion,
  reloadFavicons,
  subscribeFavicons,
} from '../core/faviconCache'
import { STORAGE_SYNC_EVENT, storageSyncSource } from '../core/storageSync'
import { isTauri } from '../platform/runtime'

let installed = false

/** One listener for the whole window: another window kept an icon, so the cache is read again. */
function installSync(): void {
  if (installed) return
  installed = true
  window.addEventListener('storage', (event) => {
    if (event.key === FAVICON_CACHE_KEY) reloadFavicons()
  })
  if (!isTauri) return
  void import('@tauri-apps/api/event')
    .then(({ listen }) =>
      listen<{ key: string; source: string }>(STORAGE_SYNC_EVENT, (event) => {
        if (event.payload.key === FAVICON_CACHE_KEY && event.payload.source !== storageSyncSource()) {
          reloadFavicons()
        }
      }),
    )
    .catch(() => undefined)
}

/**
 * Call it in a component that shows site icons (`siteIconSource`): the component draws again when an icon is kept,
 * here or in another window, so the icon that was a stand-in becomes the kept one.
 */
export function useFaviconRefresh(): number {
  installSync()
  return useSyncExternalStore(subscribeFavicons, faviconVersion)
}
