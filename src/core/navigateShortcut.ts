import { getSessionForUrl, resolveShortcutNavigateUrl, type BrowseSession } from './browseSession'
import {
  findShortcutByHost,
  hostKeyForShortcut,
  isSearchShortcutId,
  shortcutFromUrl,
  visitShortcutIdFromUrl,
} from './shortcutFromUrl'
import type { Shortcut } from './types'

function isSearchEngineUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase()
    if (host.includes('google.') && parsed.pathname === '/search' && parsed.searchParams.has('q')) {
      return true
    }
    if (
      host.includes('bing.') &&
      (parsed.pathname === '/search' || parsed.pathname.startsWith('/search')) &&
      parsed.searchParams.has('q')
    ) {
      return true
    }
    if (host.includes('duckduckgo.') && parsed.searchParams.has('q')) return true
    return false
  } catch {
    return false
  }
}

export function shouldForceLoadUrl(targetUrl: string, forceTargetUrl?: boolean): boolean {
  if (forceTargetUrl) return true
  return isSearchEngineUrl(targetUrl)
}

export function resolveShortcutForOpen(
  targetUrl: string,
  allShortcuts: Shortcut[],
  sessions: Record<string, BrowseSession>,
  options?: { forceTargetUrl?: boolean },
): { shortcut: Shortcut; forceLoad: boolean } {
  const forceLoad = shouldForceLoadUrl(targetUrl, options?.forceTargetUrl)

  const exact = allShortcuts.find((shortcut) => shortcut.url === targetUrl)
  if (exact) {
    return {
      shortcut: {
        ...exact,
        url: forceLoad
          ? targetUrl
          : resolveShortcutNavigateUrl(targetUrl, getSessionForUrl(sessions, targetUrl)),
      },
      forceLoad,
    }
  }

  const fromUrl = shortcutFromUrl(targetUrl)
  if (fromUrl) {
    const existing = allShortcuts.find((shortcut) => shortcut.id === fromUrl.id)
    const base = existing ?? fromUrl
    const session = getSessionForUrl(sessions, targetUrl)
    return {
      shortcut: {
        ...base,
        label: fromUrl.label,
        favicon: fromUrl.favicon,
        url: forceLoad
          ? targetUrl
          : resolveShortcutNavigateUrl(fromUrl.url, session),
      },
      forceLoad,
    }
  }

  const byHost = findShortcutByHost(allShortcuts, hostKeyForShortcut(targetUrl))
  if (byHost && !isSearchShortcutId(byHost.id)) {
    return {
      shortcut: {
        ...byHost,
        url: forceLoad
          ? targetUrl
          : resolveShortcutNavigateUrl(targetUrl, getSessionForUrl(sessions, targetUrl)),
      },
      forceLoad,
    }
  }

  const visitId = visitShortcutIdFromUrl(targetUrl)

  return {
    shortcut: {
      id: visitId,
      label: targetUrl,
      url: targetUrl,
    },
    forceLoad,
  }
}
