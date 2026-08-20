import { useCallback, useMemo, useReducer, useRef } from 'react'
import {
  type BrowserTab,
} from '../core/browserTab'
import {
  browserTabsReducer,
  initialBrowserTabsState,
} from '../core/browserTabsReducer'
import type { Shortcut } from '../core/types'

export function useBrowserTabs() {
  const [{ tabs, activeTabId }, dispatch] = useReducer(
    browserTabsReducer,
    initialBrowserTabsState,
  )
  const tabsRef = useRef<BrowserTab[]>([])
  const activeTabIdRef = useRef<string | null>(null)

  tabsRef.current = tabs
  activeTabIdRef.current = activeTabId

  const openOrSwitchTab = useCallback(
    (shortcut: Shortcut, options?: { reload?: boolean; activate?: boolean }) => {
      dispatch({
        type: 'open-or-switch',
        shortcut,
        reload: options?.reload ?? false,
        activate: options?.activate !== false,
      })
    },
    [],
  )

  const closeTab = useCallback((shortcutId: string) => {
    dispatch({ type: 'close', shortcutId })
  }, [])

  const updateTabMeta = useCallback(
    (shortcutId: string, patch: Partial<Pick<BrowserTab, 'url' | 'title' | 'favicon' | 'isLoading' | 'isMuted'>>) => {
      dispatch({ type: 'update-meta', shortcutId, patch })
    },
    [],
  )

  const applyTabSnapshot = useCallback(
    (shortcutId: string, url: string | null, title: string | null) => {
      if (url) dispatch({ type: 'apply-snapshot', shortcutId, url, title })
    },
    [],
  )

  const getTab = useCallback(
    (shortcutId: string): BrowserTab | null =>
      tabsRef.current.find((tab) => tab.shortcutId === shortcutId) ?? null,
    [],
  )

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.shortcutId === activeTabId) ?? null,
    [tabs, activeTabId],
  )
  const openTabIds = useMemo(() => tabs.map((tab) => tab.shortcutId), [tabs])
  const setActiveTabId = useCallback((shortcutId: string | null) => {
    dispatch({ type: 'set-active', shortcutId })
  }, [])

  return {
    tabs,
    activeTab,
    activeTabId,
    openTabIds,
    activeTabIdRef,
    tabsRef,
    openOrSwitchTab,
    closeTab,
    updateTabMeta,
    applyTabSnapshot,
    getTab,
    setActiveTabId,
  }
}
