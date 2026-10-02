import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BROWSING_HISTORY_KEY,
  CLOSED_TABS_KEY,
  addHistoryEntry,
  closedTabFromBrowserTab,
  entryMatchesHistoryFilters,
  loadBrowsingHistory,
  loadClosedTabs,
  initializeBrowserRunState,
  loadCurrentSessionSnapshot,
  clearCurrentSessionSnapshot,
  markBrowserRunClean,
  persistCurrentSessionSnapshot,
  type BrowserSessionSnapshot,
  type ClosedTabEntry,
  type HistoryEntry,
  type HistoryTimeFilter,
} from '../core/browsingHistory'
import type { BrowserTab } from '../core/browserTab'
import { useStorageSync } from '../core/storageSync'
import { currentBrowserWindowId } from '../platform/browserWindowScope'
import { updateBrowsingHistory, updateClosedTabs } from '../core/browsingHistoryMutations'

export function useBrowsingHistory() {
  const [entries, setEntries] = useState<HistoryEntry[]>(loadBrowsingHistory)
  const [closedTabs, setClosedTabs] = useState<ClosedTabEntry[]>(loadClosedTabs)
  const [previousSession, setPreviousSession] = useState<BrowserSessionSnapshot | null>(
    loadCurrentSessionSnapshot,
  )
  const [primaryWindow] = useState(() => currentBrowserWindowId() === 'main')
  const [previousRunUnclean] = useState(() =>
    primaryWindow
      ? initializeBrowserRunState().previousRunUnclean
      : false,
  )
  const entriesRef = useRef(entries)
  const closedTabsRef = useRef(closedTabs)
  entriesRef.current = entries
  closedTabsRef.current = closedTabs

  const reloadHistory = useCallback(() => setEntries(loadBrowsingHistory()), [])
  const reloadClosedTabs = useCallback(() => setClosedTabs(loadClosedTabs()), [])
  useStorageSync(BROWSING_HISTORY_KEY, reloadHistory)
  useStorageSync(CLOSED_TABS_KEY, reloadClosedTabs)

  useEffect(() => {
    if (!primaryWindow) return
    const markClean = () => markBrowserRunClean()
    window.addEventListener('beforeunload', markClean)
    window.addEventListener('pagehide', markClean)
    return () => {
      window.removeEventListener('beforeunload', markClean)
      window.removeEventListener('pagehide', markClean)
    }
  }, [primaryWindow])

  const recordVisit = useCallback(async (url: string, title?: string | null, isPrivate = false) => {
    if (isPrivate) return
    await updateBrowsingHistory((current) => addHistoryEntry(current, url, title, isPrivate))
    reloadHistory()
  }, [reloadHistory])

  const removeEntry = useCallback(async (id: string) => {
    await updateBrowsingHistory((current) => current.filter((entry) => entry.id !== id))
    reloadHistory()
  }, [reloadHistory])

  const clearAll = useCallback(async () => {
    await updateBrowsingHistory(() => [])
    reloadHistory()
  }, [reloadHistory])

  const clearFiltered = useCallback(async (filters: { query?: string; host?: string; time?: HistoryTimeFilter }) => {
    await updateBrowsingHistory((current) => current.filter((entry) => !entryMatchesHistoryFilters(entry, filters)))
    reloadHistory()
  }, [reloadHistory])

  const recordClosedTab = useCallback(async (tab: BrowserTab) => {
    const entry = closedTabFromBrowserTab(tab)
    if (!entry) return
    await updateClosedTabs((current) => [entry, ...current].slice(0, 50))
    reloadClosedTabs()
  }, [reloadClosedTabs])

  const removeClosedTab = useCallback(async (id: string) => {
    await updateClosedTabs((current) => current.filter((entry) => entry.id !== id))
    reloadClosedTabs()
  }, [reloadClosedTabs])

  const clearClosedTabs = useCallback(async () => {
    await updateClosedTabs(() => [])
    reloadClosedTabs()
  }, [reloadClosedTabs])

  const saveCurrentSession = useCallback((
    windowId: string,
    tabs: BrowserTab[],
    activeTabId: string | null,
  ) => {
    persistCurrentSessionSnapshot(windowId, tabs, activeTabId)
  }, [])

  const clearCurrentSession = useCallback(() => {
    clearCurrentSessionSnapshot()
    setPreviousSession(null)
  }, [])

  const hosts = useMemo(
    () => [...new Set(entries.map((entry) => entry.host))].sort((a, b) => a.localeCompare(b)),
    [entries],
  )

  return {
    entries,
    entriesRef,
    hosts,
    closedTabs,
    closedTabsRef,
    previousSession,
    previousRunUnclean,
    recordVisit,
    removeEntry,
    clearAll,
    clearFiltered,
    recordClosedTab,
    removeClosedTab,
    clearClosedTabs,
    saveCurrentSession,
    clearCurrentSession,
  }
}
