import type { Shortcut } from './types'
import {
  createTabNavigationState,
  type TabNavigationState,
} from './tabNavigation.ts'
import {
  browserTabWebviewLabel,
  browserWindowIdFromRuntime,
} from './browserWorkspace.ts'
import { isLowResolutionInlineFavicon } from './pageFavicon.ts'
import { isLocalNetworkHostname } from './addressNavigation.ts'

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
  isPrivate?: boolean
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
    const pageUrl = new URL(url)
    const hostname = pageUrl.hostname.replace(/\.$/, '')
    if (
      (pageUrl.protocol !== 'http:' && pageUrl.protocol !== 'https:') ||
      isLocalNetworkHostname(hostname) ||
      !hostname.includes('.')
    ) {
      return '/nebula-app-logo.png'
    }
    return `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(`${pageUrl.origin}/`)}&sz=128`
  } catch {
    return '/nebula-app-logo.png'
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
    isPrivate?: boolean
  },
): BrowserTab {
  const shortcutFavicon = shortcut.favicon?.trim()
  const favicon = shortcutFavicon && !isLowResolutionInlineFavicon(shortcutFavicon)
    ? shortcutFavicon
    : faviconForUrl(shortcut.url)
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
    isPrivate: options?.isPrivate === true,
    isLoading: true,
    isMuted: false,
  }
}

export function truncateTabTitle(title: string, max = 48): string {
  const trimmed = title.trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max - 1)}…`
}
