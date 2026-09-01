import { hostKeyForShortcut } from './shortcutFromUrl.ts'
import { isFolderDockId, parseFolderDockId } from './types.ts'
import type { Shortcut, ShortcutFolder } from './types.ts'

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

/**
 * Build the same dock-to-tab resolution as `openTabIdForDockId` once for a
 * complete render. Exact runtime ids always win; persistent shortcuts fall
 * back to the first open tab for the same host.
 */
export function buildOpenTabIdByDockId(
  openTabIds: string[],
  shortcutMap: Map<string, Shortcut>,
): Map<string, string> {
  const result = new Map<string, string>()
  const firstOpenTabByHost = new Map<string, string>()

  for (const tabId of openTabIds) {
    result.set(tabId, tabId)

    const shortcut = shortcutMap.get(tabId)
    if (!shortcut) continue

    const host = hostKeyForShortcut(shortcut.url)
    if (!firstOpenTabByHost.has(host)) {
      firstOpenTabByHost.set(host, tabId)
    }
  }

  for (const [dockId, shortcut] of shortcutMap) {
    if (result.has(dockId)) continue

    const tabId = firstOpenTabByHost.get(hostKeyForShortcut(shortcut.url))
    if (tabId) result.set(dockId, tabId)
  }

  return result
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
  const dockItemIdSet = new Set(dockItemIds)

  const tabsPerHost = new Map<string, number>()
  const tabHostById = new Map<string, string>()
  for (const tabId of openTabIds) {
    const shortcut = shortcutMap.get(tabId)
    const host = shortcut ? hostKeyForShortcut(shortcut.url) : tabId
    tabHostById.set(tabId, host)
    tabsPerHost.set(host, (tabsPerHost.get(host) ?? 0) + 1)
  }

  const firstDockIdByHost = new Map<string, string>()
  for (const dockId of dockItemIds) {
    if (isFolderDockId(dockId)) continue

    const shortcut = shortcutMap.get(dockId)
    if (!shortcut) continue

    const host = hostKeyForShortcut(shortcut.url)
    if (!firstDockIdByHost.has(host)) firstDockIdByHost.set(host, dockId)
  }

  for (const dockId of dockItemIds) {
    if (!isFolderDockId(dockId)) continue

    const folder = folderMap.get(parseFolderDockId(dockId))
    if (!folder) continue

    const memberIds = new Set(folder.members)
    const memberHosts = new Set<string>()
    for (const memberId of folder.members) {
      const memberShortcut = shortcutMap.get(memberId)
      if (memberShortcut) memberHosts.add(hostKeyForShortcut(memberShortcut.url))
    }

    const matchingOpenTabIds = openTabIds.filter((tabId) => {
      if (assignedTabIds.has(tabId)) return false

      // Exact id match.
      if (memberIds.has(tabId)) return true

      // Tabs can have runtime ids such as visit-* while the folder stores the
      // persistent shortcut id. When there is only one open tab for this host,
      // treat the two ids as aliases of the same shortcut.
      const tabHost = tabHostById.get(tabId)
      if (!tabHost || !shortcutMap.has(tabId)) return false

      // Do not collapse multiple tabs from the same host into one folder member.
      if ((tabsPerHost.get(tabHost) ?? 0) !== 1) return false

      return memberHosts.has(tabHost)
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

    const host = tabHostById.get(tabId) ?? tabId
    const dockId =
      (tabsPerHost.get(host) ?? 0) > 1
        ? tabId
        : dockItemIdSet.has(tabId)
          ? tabId
          : (firstDockIdByHost.get(host) ?? tabId)

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
