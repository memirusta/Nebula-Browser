import { visitShortcutIdFromUrl } from './shortcutFromUrl'
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
      shortcuts.push({
        id: visitShortcutIdFromUrl(parsed.href),
        label: bookmark.title.trim() || host,
        url: parsed.href,
        favicon: `https://www.google.com/s2/favicons?domain=${host}&sz=64`,
      })
    } catch {
      /* skip invalid bookmark */
    }
  }

  return shortcuts
}
