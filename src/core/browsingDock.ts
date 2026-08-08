import { hostKeyForShortcut } from './shortcutFromUrl'
import { isFolderDockId, parseFolderDockId } from './types'
import type { Shortcut, ShortcutFolder } from './types'

/** Map a tab id to the dock shortcut id when a single tab shares the same host. */
export function resolveBrowsingDockId(
  tabId: string,
  dockItemIds: string[],
  shortcutMap: Map<string, Shortcut>,
): string {
  if (dockItemIds.includes(tabId)) return tabId

  const tabShortcut = shortcutMap.get(tabId)
  if (!tabShortcut) return tabId

  const tabHost = hostKeyForShortcut(tabShortcut.url)

  for (const dockId of dockItemIds) {
    if (isFolderDockId(dockId)) continue
    const dockShortcut = shortcutMap.get(dockId)
    if (dockShortcut && hostKeyForShortcut(dockShortcut.url) === tabHost) {
      return dockId
    }
  }

  return tabId
}

/** Resolve the open tab id backing a dock icon (handles visit-* vs pinned id). */
export function openTabIdForDockId(
  dockId: string,
  openTabIds: string[],
  shortcutMap: Map<string, Shortcut>,
): string | null {
  if (openTabIds.includes(dockId)) return dockId

  const dockShortcut = shortcutMap.get(dockId)
  if (!dockShortcut) return null

  const dockHost = hostKeyForShortcut(dockShortcut.url)
  return (
    openTabIds.find((tabId) => {
      const tabShortcut = shortcutMap.get(tabId)
      return tabShortcut && hostKeyForShortcut(tabShortcut.url) === dockHost
    }) ?? null
  )
}

export function buildBrowsingVisibleDockItemIds(
  dockItemIds: string[],
  openTabIds: string[],
  folders: ShortcutFolder[],
  shortcutMap: Map<string, Shortcut>,
): string[] {
  const folderMap = new Map(folders.map((folder) => [folder.id, folder]))
  const items: string[] = []
  const usedDockEntries = new Set<string>()
  const assignedTabIds = new Set<string>()

  const tabsPerHost = new Map<string, number>()
  for (const tabId of openTabIds) {
    const shortcut = shortcutMap.get(tabId)
    const host = shortcut ? hostKeyForShortcut(shortcut.url) : tabId
    tabsPerHost.set(host, (tabsPerHost.get(host) ?? 0) + 1)
  }

  for (const dockId of dockItemIds) {
  if (!isFolderDockId(dockId)) continue

  const folder = folderMap.get(parseFolderDockId(dockId))
  if (!folder) continue

  const matchingOpenTabIds = openTabIds.filter((tabId) => {
    if (assignedTabIds.has(tabId)) return false

    // Exact id match.
    if (folder.members.includes(tabId)) return true

    // Tabs can have runtime ids such as visit-* while the folder stores the
    // persistent shortcut id. When there is only one open tab for this host,
    // treat the two ids as aliases of the same shortcut.
    const tabShortcut = shortcutMap.get(tabId)
    if (!tabShortcut) return false

    const tabHost = hostKeyForShortcut(tabShortcut.url)

    // Do not collapse multiple tabs from the same host into one folder member.
    if ((tabsPerHost.get(tabHost) ?? 0) !== 1) return false

    return folder.members.some((memberId) => {
      const memberShortcut = shortcutMap.get(memberId)
      return (
        memberShortcut !== undefined &&
        hostKeyForShortcut(memberShortcut.url) === tabHost
      )
    })
  })

  if (matchingOpenTabIds.length === 0) continue

  items.push(dockId)
  usedDockEntries.add(dockId)

  matchingOpenTabIds.forEach((tabId) => {
    assignedTabIds.add(tabId)
  })
}

  for (const tabId of openTabIds) {
    if (assignedTabIds.has(tabId)) continue

    const shortcut = shortcutMap.get(tabId)
    const host = shortcut ? hostKeyForShortcut(shortcut.url) : tabId
    const dockId =
      (tabsPerHost.get(host) ?? 0) > 1
        ? tabId
        : resolveBrowsingDockId(tabId, dockItemIds, shortcutMap)

    if (usedDockEntries.has(dockId)) {
      assignedTabIds.add(tabId)
      continue
    }

    items.push(dockId)
    usedDockEntries.add(dockId)
    assignedTabIds.add(tabId)
  }

  return items
}
