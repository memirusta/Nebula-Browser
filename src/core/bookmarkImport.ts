import { visitShortcutIdFromUrl } from './shortcutFromUrl.ts'
import { faviconForUrl } from './browserTab.ts'
import type { Shortcut } from './types'

export interface ImportedBookmark {
  title: string
  url: string
}

export function shortcutsFromImportedBookmarks(bookmarks: ImportedBookmark[]): Shortcut[] {
  const seenHosts = new Set<string>()
  const shortcuts: Shortcut[] = []

  for (const bookmark of bookmarks) {
    try {
      const parsed = new URL(bookmark.url)
      if (!['http:', 'https:'].includes(parsed.protocol)) continue

      const host = parsed.hostname.replace(/^www\./, '')
      const hostKey = host.toLowerCase()
      if (!host || seenHosts.has(hostKey)) continue

      seenHosts.add(hostKey)
      const favicon = faviconForUrl(parsed.href)
      shortcuts.push({
        id: visitShortcutIdFromUrl(parsed.href),
        label: bookmark.title.trim() || host,
        url: parsed.href,
        favicon: favicon.startsWith('/') ? favicon : faviconForUrl(`https://${host}/`),
      })
    } catch {
      /* skip invalid bookmark */
    }
  }

  return shortcuts
}
