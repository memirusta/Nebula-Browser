import type { Shortcut } from './types'
import {
  createTabNavigationState,
  type TabNavigationState,
} from './tabNavigation.ts'
import {
  browserTabWebviewLabel,
  browserWindowIdFromRuntime,
} from './browserWorkspace.ts'

export const TAB_WEBVIEW_PREFIX = 'nebula-tab-'

const assignedWebviewLabels = new Map<string, string>()
const assignedShortcutIds = new Map<string, string>()

export interface BrowserTab {
  id: string
  shortcutId: string
  initialUrl: string
  url: string
  title: string
  favicon: string
  navigation: TabNavigationState
  isLoading?: boolean
  isMuted?: boolean
}

export function shortcutFromTab(tab: BrowserTab): Shortcut {
  return {
    id: tab.shortcutId,
    label: tab.title,
    url: tab.url,
    favicon: tab.favicon,
  }
}

export function tabWebviewLabel(shortcutId: string): string {
  return assignedWebviewLabels.get(shortcutId) ??
    browserTabWebviewLabel(browserWindowIdFromRuntime(), shortcutId)
}

export function assignTabWebviewLabel(shortcutId: string, label: string): void {
  const previous = assignedWebviewLabels.get(shortcutId)
  if (previous) assignedShortcutIds.delete(previous)
  assignedWebviewLabels.set(shortcutId, label)
  assignedShortcutIds.set(label, shortcutId)
}

export function releaseTabWebviewLabel(shortcutId: string): void {
  const label = assignedWebviewLabels.get(shortcutId)
  if (label) assignedShortcutIds.delete(label)
  assignedWebviewLabels.delete(shortcutId)
}

export function shortcutIdForTabWebviewLabel(label: string): string | null {
  const assigned = assignedShortcutIds.get(label)
  if (assigned) return assigned
  const currentPrefix = `${TAB_WEBVIEW_PREFIX}${browserWindowIdFromRuntime()}-`
  if (!label.startsWith(currentPrefix)) return null
  return label.slice(currentPrefix.length)
}

export function faviconForUrl(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    return `https://www.google.com/s2/favicons?domain=${host}&sz=64`
  } catch {
    return 'https://www.google.com/s2/favicons?domain=google.com&sz=64'
  }
}

export function titleFromUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function createBrowserTab(
  shortcut: Shortcut,
  options?: {
    tabId?: string
    navigation?: TabNavigationState
  },
): BrowserTab {
  const favicon = shortcut.favicon ?? faviconForUrl(shortcut.url)
  return {
    id: options?.tabId ?? shortcut.id,
    shortcutId: shortcut.id,
    initialUrl: shortcut.url,
    url: shortcut.url,
    title: shortcut.label,
    favicon,
    navigation:
      options?.navigation ??
      createTabNavigationState(shortcut.url, shortcut.label, favicon),
    isLoading: true,
    isMuted: false,
  }
}

export function truncateTabTitle(title: string, max = 48): string {
  const trimmed = title.trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max - 1)}…`
}
