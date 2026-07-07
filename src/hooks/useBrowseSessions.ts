import { useCallback, useState } from 'react'
import {
  BROWSE_SESSIONS_KEY,
  getSessionForUrl,
  loadBrowseSessions,
  persistBrowseSessions,
  upsertBrowseSession,
  type BrowseSession,
} from '../core/browseSession'
import { useStorageSync } from '../core/storageSync'

export function useBrowseSessions() {
  const [sessions, setSessions] = useState<Record<string, BrowseSession>>(loadBrowseSessions)

  const reloadSessions = useCallback(() => {
    setSessions(loadBrowseSessions())
  }, [])

  useStorageSync(BROWSE_SESSIONS_KEY, reloadSessions)

  const recordVisit = useCallback((url: string, label?: string) => {
    setSessions((prev) => {
      let siteLabel = label
      if (!siteLabel) {
        try {
          siteLabel = new URL(url).hostname.replace(/^www\./, '')
        } catch {
          siteLabel = url
        }
      }
      const next = upsertBrowseSession(prev, url, siteLabel!)
      persistBrowseSessions(next)
      return next
    })
  }, [])

  const getSession = useCallback(
    (url: string): BrowseSession | null => getSessionForUrl(sessions, url),
    [sessions],
  )

  return { sessions, recordVisit, getSession }
}
