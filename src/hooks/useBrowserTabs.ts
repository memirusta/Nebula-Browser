import { useCallback, useMemo, useReducer, useRef } from 'react'
import {
  type BrowserTab,
} from '../core/browserTab'
import {
  browserTabsReducer,
  initialBrowserTabsState,
} from '../core/browserTabsReducer'
import type { Shortcut } from '../core/types'
import type { TabNavigationState } from '../core/tabNavigation'

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
    (
      shortcut: Shortcut,
      options?: {
        reload?: boolean
        activate?: boolean
        tabId?: string
        navigation?: TabNavigationState
      },
    ) => {
      dispatch({
        type: 'open-or-switch',
        shortcut,
        reload: options?.reload ?? false,
        activate: options?.activate !== false,
        tabId: options?.tabId,
        navigation: options?.navigation,
      })
    },
    [],
  )

  const closeTab = useCallback((shortcutId: string) => {
    dispatch({ type: 'close', shortcutId })
  }, [])

  const detachTab = useCallback((shortcutId: string) => {
    dispatch({ type: 'close', shortcutId })
  }, [])

  const updateTabMeta = useCallback(
    (shortcutId: string, patch: Partial<Pick<BrowserTab, 'url' | 'title' | 'favicon' | 'isLoading' | 'isMuted'>>) => {
      dispatch({ type: 'update-meta', shortcutId, patch })
    },
    [],
  )

  const applyTabSnapshot = useCallback(
    (
      shortcutId: string,
      url: string | null,
      title: string | null,
      options?: {
        favicon?: string | null
        historyTargetIndex?: number
      },
    ) => {
      if (url) {
        dispatch({
          type: 'apply-snapshot',
          shortcutId,
          url,
          title,
          favicon: options?.favicon,
          historyTargetIndex: options?.historyTargetIndex,
        })
      }
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
  const navigateTabHistory = useCallback((shortcutId: string, targetIndex: number) => {
    dispatch({ type: 'navigate-history', shortcutId, targetIndex })
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
    detachTab,
    updateTabMeta,
    applyTabSnapshot,
    getTab,
    setActiveTabId,
    navigateTabHistory,
  }
}
