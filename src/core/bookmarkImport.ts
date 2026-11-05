import { visitShortcutIdFromUrl } from './shortcutFromUrl.ts'
import { faviconForUrl } from './browserTab.ts'
import type { Shortcut } from './types'

export interface ImportedBookmark {
  title: string
  url: string
  /** The browser it was read from (`chrome`, `firefox`, ...). */
  browser?: string
  /** When it was added and when it was last used, as Unix milliseconds. */
  dateAddedMs?: number | null
  lastUsedMs?: number | null
}

/** How many home-screen shortcuts an import makes: Nebula has shortcut tiles, not a bookmark manager. */
export const IMPORTED_SHORTCUT_LIMIT = 40

export interface BookmarkShortcutPlan {
  shortcuts: Shortcut[]
  /** Different sites among the bookmarks that could be used. */
  total: number
  /** Sites that were left out because of the limit. */
  extra: number
}

function recency(bookmark: ImportedBookmark): number {
  return bookmark.lastUsedMs ?? bookmark.dateAddedMs ?? 0
}

/**
 * The shortcuts an import makes: one per site, the most recently used (or added) bookmarks first, at most
 * `limit` of them. Bookmarks from several browsers are ranked together.
 */
export function planBookmarkShortcuts(
  bookmarks: readonly ImportedBookmark[],
  limit = IMPORTED_SHORTCUT_LIMIT,
): BookmarkShortcutPlan {
  // Stable on ties: bookmarks without a date keep the order they were read in.
  const ranked = bookmarks
    .map((bookmark, index) => ({ bookmark, index }))
    .sort((a, b) => recency(b.bookmark) - recency(a.bookmark) || a.index - b.index)

  const seenHosts = new Set<string>()
  const all: Shortcut[] = []

  for (const { bookmark } of ranked) {
    try {
      const parsed = new URL(bookmark.url)
      if (!['http:', 'https:'].includes(parsed.protocol)) continue

      const host = parsed.hostname.replace(/^www\./, '')
      const hostKey = host.toLowerCase()
      if (!host || seenHosts.has(hostKey)) continue

      seenHosts.add(hostKey)
      const favicon = faviconForUrl(parsed.href)
      all.push({
        id: visitShortcutIdFromUrl(parsed.href),
        label: bookmark.title.trim() || host,
        url: parsed.href,
        favicon: favicon.startsWith('/') ? favicon : faviconForUrl(`https://${host}/`),
      })
    } catch {
      /* skip invalid bookmark */
    }
  }

  const shortcuts = all.slice(0, Math.max(0, limit))
  return { shortcuts, total: all.length, extra: all.length - shortcuts.length }
}

/** One shortcut per site, no limit (the list is in recency order when the bookmarks carry dates). */
export function shortcutsFromImportedBookmarks(bookmarks: ImportedBookmark[]): Shortcut[] {
  return planBookmarkShortcuts(bookmarks, Number.POSITIVE_INFINITY).shortcuts
}
