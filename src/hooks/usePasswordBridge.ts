import { useCallback, useEffect, useRef, useState } from 'react'
import type { BridgePromptConfig } from '../core/passwordBridgeScript'
import { findExistingPassword, labelFromUrl, matchPasswordsForUrl } from '../core/passwordMatch'
import type { SavedPassword } from '../core/passwordVault'
import { upsertPasswordEntry } from '../core/passwordVault'
import { useLocale } from './useLocale'
import {
  dismissInPagePasswordPrompt,
  fillPasswordOnTab,
  tickPasswordBridge,
} from '../platform/tauriPasswordBridge'
import { isTauri } from '../platform/runtime'

const POLL_MS = 2500
const DISMISS_FILL_MS = 5 * 60_000
const STARTUP_DELAY_MS = 800

export type PasswordBridgeMode = 'fill' | 'save'

export interface PasswordBridgeOffer {
  mode: PasswordBridgeMode
  shortcutId: string
  pageUrl: string
  username: string
  password: string
  label: string
  matches?: SavedPassword[]
}

interface UsePasswordBridgeOptions {
  enabled: boolean
  activeTabId: string | null
  activeUrl: string | null
  entries: SavedPassword[]
  onVaultChange: () => void
}

function isHttpUrl(url: string | null): url is string {
  if (!url) return false
  return url.startsWith('http://') || url.startsWith('https://')
}

export function usePasswordBridge({
  enabled,
  activeTabId,
  activeUrl,
  entries,
  onVaultChange,
}: UsePasswordBridgeOptions) {
  const { locale } = useLocale()
  const [offer, setOffer] = useState<PasswordBridgeOffer | null>(null)
  const offerRef = useRef<PasswordBridgeOffer | null>(null)
  const dismissedFillRef = useRef<Map<string, number>>(new Map())
  const handledPendingRef = useRef<Set<string>>(new Set())
  const tickInFlightRef = useRef(false)
  const saveDraftRef = useRef<{ pageUrl: string; username: string; password: string } | null>(null)
  const entriesRef = useRef(entries)
  const activeTabIdRef = useRef(activeTabId)
  const activeUrlRef = useRef(activeUrl)

  useEffect(() => {
    offerRef.current = offer
  }, [offer])

  useEffect(() => {
    entriesRef.current = entries
  }, [entries])

  useEffect(() => {
    activeTabIdRef.current = activeTabId
    activeUrlRef.current = activeUrl
  }, [activeTabId, activeUrl])

  const buildPrompt = useCallback((nextOffer: PasswordBridgeOffer | null): BridgePromptConfig | null => {
    if (!nextOffer) return null
    if (nextOffer.mode === 'fill') {
      return {
        mode: 'fill',
        site: nextOffer.label,
        accounts: (nextOffer.matches ?? []).map((entry) => entry.username),
      }
    }
    return {
      mode: 'save',
      site: nextOffer.label,
      user: nextOffer.username,
    }
  }, [])

  const clearOffer = useCallback((shortcutId?: string) => {
    saveDraftRef.current = null
    setOffer(null)
    offerRef.current = null
    if (shortcutId) {
      void dismissInPagePasswordPrompt(shortcutId)
    }
  }, [])

  const dismissOffer = useCallback(() => {
    const current = offerRef.current
    if (current?.mode === 'fill' && current.pageUrl) {
      dismissedFillRef.current.set(current.pageUrl, Date.now())
    }
    clearOffer(current?.shortcutId)
  }, [clearOffer])

  const acceptFill = useCallback(async (entry: SavedPassword, shortcutId: string, pageUrl: string) => {
    const ok = await fillPasswordOnTab(shortcutId, entry.username, entry.password)
    if (ok) {
      dismissedFillRef.current.set(pageUrl, Date.now())
      clearOffer(shortcutId)
    }
  }, [clearOffer])

  const acceptSave = useCallback(
    (draft: { pageUrl: string; username: string; password: string; label: string }) => {
      upsertPasswordEntry({
        label: draft.label,
        url: draft.pageUrl,
        username: draft.username,
        password: draft.password,
      })
      onVaultChange()
      clearOffer(activeTabIdRef.current ?? undefined)
    },
    [clearOffer, onVaultChange],
  )

  useEffect(() => {
    dismissedFillRef.current.clear()
    handledPendingRef.current.clear()
    saveDraftRef.current = null
    offerRef.current = null
    setOffer(null)
  }, [activeTabId, activeUrl])

  useEffect(() => {
    if (!enabled || !isTauri || !activeTabId || !isHttpUrl(activeUrl)) {
      return
    }

    let cancelled = false

    const tick = async () => {
      if (cancelled || tickInFlightRef.current) return
      const tabId = activeTabIdRef.current
      const tabUrl = activeUrlRef.current
      if (!tabId || !isHttpUrl(tabUrl)) return

      tickInFlightRef.current = true
      try {
        let nextOffer = offerRef.current

        if (!nextOffer && saveDraftRef.current) {
          const draft = saveDraftRef.current
          nextOffer = {
            mode: 'save',
            shortcutId: tabId,
            pageUrl: draft.pageUrl,
            username: draft.username,
            password: draft.password,
            label: labelFromUrl(draft.pageUrl),
          }
        }

        const poll = await tickPasswordBridge(tabId, locale, buildPrompt(nextOffer))
        if (cancelled || !poll) return

        const pageUrl = poll.href && isHttpUrl(poll.href) ? poll.href : tabUrl

        if (poll.action?.type === 'dismiss') {
          if (nextOffer?.mode === 'fill') {
            dismissedFillRef.current.set(pageUrl, Date.now())
          }
          clearOffer(tabId)
          return
        }

        if (poll.action?.type === 'fill') {
          const matches = matchPasswordsForUrl(pageUrl, entriesRef.current)
          const entry =
            matches.find((item) => item.username === poll.action?.username) ?? matches[0]
          if (entry) {
            await acceptFill(entry, tabId, pageUrl)
          }
          return
        }

        if (poll.action?.type === 'save' && saveDraftRef.current) {
          const draft = saveDraftRef.current
          acceptSave({
            pageUrl: draft.pageUrl,
            username: draft.username,
            password: draft.password,
            label: labelFromUrl(draft.pageUrl),
          })
          return
        }

        if (poll.pending?.username && poll.pending.password) {
          const pendingKey = `${pageUrl}\0${poll.pending.username}\0${poll.pending.t}`
          if (!handledPendingRef.current.has(pendingKey)) {
            handledPendingRef.current.add(pendingKey)
            const existing = findExistingPassword(
              entriesRef.current,
              pageUrl,
              poll.pending.username,
            )
            const samePassword = existing?.password === poll.pending.password
            if (!existing || !samePassword) {
              saveDraftRef.current = {
                pageUrl,
                username: poll.pending.username,
                password: poll.pending.password,
              }
              const saveOffer: PasswordBridgeOffer = {
                mode: 'save',
                shortcutId: tabId,
                pageUrl,
                username: poll.pending.username,
                password: poll.pending.password,
                label: labelFromUrl(pageUrl),
              }
              offerRef.current = saveOffer
              setOffer(saveOffer)
              return
            }
          }
        }

        if (!poll.hasForm) {
          if (nextOffer) clearOffer(tabId)
          return
        }

        const dismissedAt = dismissedFillRef.current.get(pageUrl)
        if (dismissedAt && Date.now() - dismissedAt < DISMISS_FILL_MS) return

        const matches = matchPasswordsForUrl(pageUrl, entriesRef.current)
        if (matches.length === 0) return

        if (nextOffer?.mode === 'save') return

        const fillOffer: PasswordBridgeOffer = {
          mode: 'fill',
          shortcutId: tabId,
          pageUrl,
          username: matches[0].username,
          password: matches[0].password,
          label: labelFromUrl(pageUrl),
          matches,
        }
        offerRef.current = fillOffer
        setOffer(fillOffer)
      } finally {
        tickInFlightRef.current = false
      }
    }

    const startupTimer = window.setTimeout(() => {
      void tick()
    }, STARTUP_DELAY_MS)

    const id = window.setInterval(() => void tick(), POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
      window.clearTimeout(startupTimer)
    }
  }, [enabled, activeTabId, activeUrl, locale, buildPrompt, acceptFill, acceptSave, clearOffer])

  return {
    offer,
    dismissOffer,
    acceptFill: (entry: SavedPassword) => {
      const current = offerRef.current
      if (!current) return
      void acceptFill(entry, current.shortcutId, current.pageUrl)
    },
    acceptSave: () => {
      const current = offerRef.current
      if (!current || current.mode !== 'save') return
      acceptSave({
        pageUrl: current.pageUrl,
        username: current.username,
        password: current.password,
        label: current.label,
      })
    },
  }
}
