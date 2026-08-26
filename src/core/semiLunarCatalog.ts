import type { Shortcut } from './types'

interface SemiLunarTabLike {
  shortcutId: string
  title: string
  url: string
  favicon?: string
}

/**
 * Build the catalog rendered by Semi-Lunar without collapsing runtime tabs by
 * host. Persistent shortcuts provide stable defaults; an open tab with the
 * same id replaces only its live metadata.
 */
export function buildSemiLunarShortcutCatalog(
  visibleShortcuts: Shortcut[],
  tabs: SemiLunarTabLike[],
): Shortcut[] {
  const byId = new Map<string, Shortcut>(
    visibleShortcuts.map((shortcut) => [shortcut.id, shortcut]),
  )

  for (const tab of tabs) {
    const existing = byId.get(tab.shortcutId)
    byId.set(
      tab.shortcutId,
      existing
        ? {
            ...existing,
            label: tab.title,
            url: tab.url,
            favicon: tab.favicon,
          }
        : {
            id: tab.shortcutId,
            label: tab.title,
            url: tab.url,
            favicon: tab.favicon,
          },
    )
  }

  return [...byId.values()]
}

export function canCreateShortcutFolder(
  sourceId: string,
  targetId: string,
  folderableIds: ReadonlySet<string>,
  memberIds: ReadonlySet<string>,
): boolean {
  return (
    sourceId !== targetId &&
    folderableIds.has(sourceId) &&
    folderableIds.has(targetId) &&
    !memberIds.has(sourceId) &&
    !memberIds.has(targetId)
  )
}
