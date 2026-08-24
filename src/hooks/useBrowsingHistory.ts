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
  persistBrowsingHistory,
  persistClosedTabs,
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

  const recordVisit = useCallback((url: string, title?: string | null) => {
    setEntries((previous) => {
      const next = addHistoryEntry(previous, url, title)
      if (next !== previous) persistBrowsingHistory(next)
      return next
    })
  }, [])

  const removeEntry = useCallback((id: string) => {
    setEntries((previous) => {
      const next = previous.filter((entry) => entry.id !== id)
      if (next.length !== previous.length) persistBrowsingHistory(next)
      return next
    })
  }, [])

  const clearAll = useCallback(() => {
    persistBrowsingHistory([])
    setEntries([])
  }, [])

  const clearFiltered = useCallback((filters: { query?: string; host?: string; time?: HistoryTimeFilter }) => {
    setEntries((previous) => {
      const next = previous.filter((entry) => !entryMatchesHistoryFilters(entry, filters))
      if (next.length !== previous.length) persistBrowsingHistory(next)
      return next
    })
  }, [])

  const recordClosedTab = useCallback((tab: BrowserTab) => {
    const entry = closedTabFromBrowserTab(tab)
    if (!entry) return
    setClosedTabs((previous) => {
      const next = [entry, ...previous].slice(0, 50)
      persistClosedTabs(next)
      return next
    })
  }, [])

  const removeClosedTab = useCallback((id: string) => {
    setClosedTabs((previous) => {
      const next = previous.filter((entry) => entry.id !== id)
      if (next.length !== previous.length) persistClosedTabs(next)
      return next
    })
  }, [])

  const clearClosedTabs = useCallback(() => {
    persistClosedTabs([])
    setClosedTabs([])
  }, [])

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
