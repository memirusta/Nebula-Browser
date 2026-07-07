import type { Shortcut } from './types'

export const TAB_WEBVIEW_PREFIX = 'nebula-tab-'

export interface BrowserTab {
  id: string
  shortcutId: string
  initialUrl: string
  url: string
  title: string
  favicon: string
  isLoading?: boolean
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
  return `${TAB_WEBVIEW_PREFIX}${shortcutId}`
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

export function createBrowserTab(shortcut: Shortcut): BrowserTab {
  const favicon = shortcut.favicon ?? faviconForUrl(shortcut.url)
  return {
    id: shortcut.id,
    shortcutId: shortcut.id,
    initialUrl: shortcut.url,
    url: shortcut.url,
    title: shortcut.label,
    favicon,
    isLoading: true,
  }
}

export function truncateTabTitle(title: string, max = 48): string {
  const trimmed = title.trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max - 1)}…`
}
