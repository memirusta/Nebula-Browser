import {
  createBrowserTab,
  faviconForUrl,
  titleFromUrl,
  type BrowserTab,
} from './browserTab.ts'
import type { Shortcut } from './types.ts'
import {
  applyTabHistoryTarget,
  recordTabNavigation,
  type TabNavigationState,
} from './tabNavigation.ts'

export interface BrowserTabsState {
  tabs: BrowserTab[]
  activeTabId: string | null
}

export type BrowserTabsAction =
  | {
      type: 'open-or-switch'
      shortcut: Shortcut
      reload: boolean
      activate: boolean
      tabId?: string
      navigation?: TabNavigationState
    }
  | { type: 'close'; shortcutId: string }
  | {
      type: 'update-meta'
      shortcutId: string
      patch: Partial<Pick<BrowserTab, 'url' | 'title' | 'favicon' | 'isLoading' | 'isMuted'>>
    }
  | {
      type: 'apply-snapshot'
      shortcutId: string
      url: string
      title: string | null
      historyTargetIndex?: number
    }
  | { type: 'navigate-history'; shortcutId: string; targetIndex: number }
  | { type: 'set-active'; shortcutId: string | null }

export const initialBrowserTabsState: BrowserTabsState = {
  tabs: [],
  activeTabId: null,
}

export function browserTabsReducer(
  state: BrowserTabsState,
  action: BrowserTabsAction,
): BrowserTabsState {
  switch (action.type) {
    case 'open-or-switch': {
      const existing = state.tabs.find(
        (tab) => tab.shortcutId === action.shortcut.id,
      )
      let tabs = state.tabs
      if (existing && action.reload) {
        tabs = state.tabs.map((tab) =>
          tab.shortcutId === action.shortcut.id
            ? {
                ...tab,
                url: action.shortcut.url,
                initialUrl: action.shortcut.url,
                title: action.shortcut.label,
                favicon: action.shortcut.favicon ?? tab.favicon,
                navigation:
                  action.navigation ??
                  recordTabNavigation(
                    tab.navigation,
                    action.shortcut.url,
                    action.shortcut.label,
                    action.shortcut.favicon ?? tab.favicon,
                  ),
                isLoading: true,
              }
            : tab,
        )
      } else if (!existing) {
        tabs = [
          ...state.tabs,
          createBrowserTab(action.shortcut, {
            tabId: action.tabId,
            navigation: action.navigation,
          }),
        ]
      }

      const activeTabId = action.activate ? action.shortcut.id : state.activeTabId
      if (tabs === state.tabs && activeTabId === state.activeTabId) return state
      return { tabs, activeTabId }
    }

    case 'close': {
      const tabs = state.tabs.filter((tab) => tab.shortcutId !== action.shortcutId)
      if (tabs.length === state.tabs.length) return state
      const activeTabId =
        state.activeTabId === action.shortcutId
          ? (tabs[tabs.length - 1]?.shortcutId ?? null)
          : state.activeTabId
      return { tabs, activeTabId }
    }

    case 'update-meta': {
      const tabs = state.tabs.map((tab) =>
        tab.shortcutId === action.shortcutId ? { ...tab, ...action.patch } : tab,
      )
      return { ...state, tabs }
    }

    case 'apply-snapshot': {
      const nextTitle = action.title?.trim() || titleFromUrl(action.url)
      const nextFavicon = faviconForUrl(action.url)
      const current = state.tabs.find((tab) => tab.shortcutId === action.shortcutId)
      if (!current) return state
      const navigation = action.historyTargetIndex === undefined
        ? recordTabNavigation(current.navigation, action.url, nextTitle, nextFavicon)
        : applyTabHistoryTarget(
            current.navigation,
            action.historyTargetIndex,
            { url: action.url, title: nextTitle, favicon: nextFavicon },
          )
      if (
        current.url === action.url &&
        current.title === nextTitle &&
        current.favicon === nextFavicon &&
        navigation === current.navigation
      ) return state
      return {
        ...state,
        tabs: state.tabs.map((tab) =>
          tab.shortcutId === action.shortcutId
            ? {
                ...tab,
                url: action.url,
                title: nextTitle,
                favicon: nextFavicon,
                navigation,
              }
            : tab,
        ),
      }
    }

    case 'navigate-history': {
      const current = state.tabs.find((tab) => tab.shortcutId === action.shortcutId)
      if (!current) return state
      const navigation = applyTabHistoryTarget(current.navigation, action.targetIndex)
      const entry = navigation.entries[navigation.index]
      if (!entry || navigation === current.navigation) return state
      return {
        ...state,
        tabs: state.tabs.map((tab) =>
          tab.shortcutId === action.shortcutId
            ? {
                ...tab,
                url: entry.url,
                title: entry.title,
                favicon: entry.favicon ?? faviconForUrl(entry.url),
                navigation,
                isLoading: true,
              }
            : tab,
        ),
      }
    }

    case 'set-active':
      return action.shortcutId === state.activeTabId
        ? state
        : { ...state, activeTabId: action.shortcutId }
  }
}
