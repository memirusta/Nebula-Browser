import { invoke } from '@tauri-apps/api/core'
import type { ImportedBookmark } from '../core/bookmarkImport'
import { isTauri } from './runtime'

export interface BrowserInfo {
  browser: string
  displayName: string
  bookmarksAvailable: boolean
}

const UNKNOWN_BROWSER: BrowserInfo = {
  browser: 'unknown',
  displayName: 'Tarayıcı',
  bookmarksAvailable: false,
}

export async function detectDefaultBrowser(): Promise<BrowserInfo> {
  if (!isTauri) return UNKNOWN_BROWSER

  try {
    return await invoke<BrowserInfo>('detect_default_browser')
  } catch {
    return UNKNOWN_BROWSER
  }
}

export async function importDefaultBrowserBookmarks(limit = 40): Promise<ImportedBookmark[]> {
  if (!isTauri) return []

  return invoke<ImportedBookmark[]>('import_default_browser_bookmarks', { limit })
}
