import { useCallback, useRef, useState } from 'react'
import {
  createBrowserTab,
  faviconForUrl,
  titleFromUrl,
  type BrowserTab,
} from '../core/browserTab'
import type { Shortcut } from '../core/types'

export function useBrowserTabs() {
  const [tabs, setTabs] = useState<BrowserTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const tabsRef = useRef<BrowserTab[]>([])
  const activeTabIdRef = useRef<string | null>(null)

  tabsRef.current = tabs
  activeTabIdRef.current = activeTabId

  const openOrSwitchTab = useCallback(
    (shortcut: Shortcut, options?: { reload?: boolean }) => {
      setTabs((prev) => {
        const existing = prev.find((tab) => tab.shortcutId === shortcut.id)
        if (existing) {
          if (options?.reload) {
            return prev.map((tab) =>
              tab.shortcutId === shortcut.id
                ? {
                    ...tab,
                    url: shortcut.url,
                    initialUrl: shortcut.url,
                    title: shortcut.label,
                    favicon: shortcut.favicon ?? tab.favicon,
                    isLoading: true,
                  }
                : tab,
            )
          }
          return prev
        }
        return [...prev, createBrowserTab(shortcut)]
      })

      setActiveTabId(shortcut.id)
    },
    [],
  )

  const closeTab = useCallback((shortcutId: string) => {
    const remaining = tabsRef.current.filter((tab) => tab.shortcutId !== shortcutId)
    setTabs(remaining)
    setActiveTabId((current) => {
      if (current !== shortcutId) return current
      if (remaining.length === 0) return null
      return remaining[remaining.length - 1]!.shortcutId
    })
  }, [])

  const updateTabMeta = useCallback(
    (shortcutId: string, patch: Partial<Pick<BrowserTab, 'url' | 'title' | 'favicon' | 'isLoading'>>) => {
      setTabs((prev) =>
        prev.map((tab) => (tab.shortcutId === shortcutId ? { ...tab, ...patch } : tab)),
      )
    },
    [],
  )

  const applyTabSnapshot = useCallback(
    (shortcutId: string, url: string | null, title: string | null) => {
      if (!url) return

      const nextTitle = title?.trim() || titleFromUrl(url)
      const nextFavicon = faviconForUrl(url)

      setTabs((prev) => {
        const current = prev.find((tab) => tab.shortcutId === shortcutId)
        if (
          current &&
          current.url === url &&
          current.title === nextTitle &&
          current.favicon === nextFavicon &&
          !current.isLoading
        ) {
          return prev
        }

        return prev.map((tab) =>
          tab.shortcutId === shortcutId
            ? {
                ...tab,
                url,
                title: nextTitle,
                favicon: nextFavicon,
                isLoading: false,
              }
            : tab,
        )
      })
    },
    [],
  )

  const getTab = useCallback(
    (shortcutId: string): BrowserTab | null =>
      tabsRef.current.find((tab) => tab.shortcutId === shortcutId) ?? null,
    [],
  )

  const activeTab =
    tabs.find((tab) => tab.shortcutId === activeTabId) ?? null

  const openTabIds = tabs.map((tab) => tab.shortcutId)

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
