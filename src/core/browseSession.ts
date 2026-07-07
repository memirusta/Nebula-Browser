import { persistLocalStorage } from './storageSync'
import { loadLocale, tf, type NebulaLocale } from './locale'

export const BROWSE_SESSIONS_KEY = 'nebula-browse-sessions-v2'

export interface BrowseSession {
  url: string
  label: string
  updatedAt: number
}

export function hostKeyFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return url.toLowerCase()
  }
}

export function hostsMatch(urlA: string, urlB: string): boolean {
  return hostKeyFromUrl(urlA) === hostKeyFromUrl(urlB)
}

export function loadBrowseSessions(): Record<string, BrowseSession> {
  try {
    const raw = localStorage.getItem(BROWSE_SESSIONS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, BrowseSession>
      if (parsed && typeof parsed === 'object') return parsed
    }
  } catch {
    /* fall through */
  }

  try {
    const legacy = localStorage.getItem('nebula-browse-sessions-v1')
    if (legacy) {
      localStorage.removeItem('nebula-browse-sessions-v1')
    }
  } catch {
    /* ignore */
  }

  return {}
}

export function getSessionForUrl(
  sessions: Record<string, BrowseSession>,
  url: string,
): BrowseSession | null {
  return sessions[hostKeyFromUrl(url)] ?? null
}

export function upsertBrowseSession(
  sessions: Record<string, BrowseSession>,
  url: string,
  label: string,
): Record<string, BrowseSession> {
  const key = hostKeyFromUrl(url)
  return {
    ...sessions,
    [key]: {
      url,
      label,
      updatedAt: Date.now(),
    },
  }
}

export function persistBrowseSessions(sessions: Record<string, BrowseSession>): void {
  persistLocalStorage(BROWSE_SESSIONS_KEY, JSON.stringify(sessions))
}

export function formatSessionPath(url: string): string {
  try {
    const parsed = new URL(url)
    const path = `${parsed.pathname}${parsed.search}`
    if (!path || path === '/') return parsed.hostname
    return path.length > 72 ? `${path.slice(0, 69)}…` : path
  } catch {
    return url
  }
}

export function formatRelativeVisitTime(
  updatedAt: number,
  locale: NebulaLocale = loadLocale(),
): string {
  const diffMs = Date.now() - updatedAt
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return tf(locale, 'timeJustNow', {})
  if (minutes < 60) return tf(locale, 'timeMinutesAgo', { n: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return tf(locale, 'timeHoursAgo', { n: hours })
  const days = Math.floor(hours / 24)
  if (days < 7) return tf(locale, 'timeDaysAgo', { n: days })
  return new Date(updatedAt).toLocaleDateString(locale === 'tr' ? 'tr-TR' : 'en-US')
}

/** Open the last visited page for this host when returning via a shortcut. */
export function resolveShortcutNavigateUrl(
  shortcutUrl: string,
  session: BrowseSession | null | undefined,
): string {
  if (session && hostsMatch(session.url, shortcutUrl)) {
    return session.url
  }
  return shortcutUrl
}
