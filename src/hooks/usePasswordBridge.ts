import { useCallback, useEffect, useRef, useState } from 'react'
import {
  findExistingPassword,
  labelFromUrl,
  matchPasswordsForUrl,
  normalizePasswordOrigins,
  passwordEntryMatchesUrl,
} from '../core/passwordMatch'
import { PasswordStepFlowTracker } from '../core/passwordStepFlow'
import type { SavedPassword } from '../core/passwordVault'
import { upsertPasswordEntry } from '../core/passwordVault'
import {
  fillPasswordOnTab,
  listenForPasswordStepEvents,
  tickPasswordBridge,
} from '../platform/tauriPasswordBridge'
import { isTauri } from '../platform/runtime'

const ACTIVE_POLL_MS = 2000
const IDLE_POLL_MS = 6000
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
  fillTarget?: 'username' | 'password' | 'both'
  vaultUrl?: string
  usernameOrigins?: string[]
  passwordOrigins?: string[]
}

interface UsePasswordBridgeOptions {
  enabled: boolean
  preserveStateWhenDisabled?: boolean
  activeTabId: string | null
  activeUrl: string | null
  entries: SavedPassword[]
  onVaultChange: () => void | Promise<void>
}

function isHttpUrl(url: string | null): url is string {
  if (!url) return false
  return url.startsWith('http://') || url.startsWith('https://')
}

export function usePasswordBridge({
  enabled,
  preserveStateWhenDisabled = false,
  activeTabId,
  activeUrl,
  entries,
  onVaultChange,
}: UsePasswordBridgeOptions) {
  const [offer, setOffer] = useState<PasswordBridgeOffer | null>(null)
  const offerRef = useRef<PasswordBridgeOffer | null>(null)
  const dismissedFillRef = useRef<Map<string, number>>(new Map())
  const handledPendingRef = useRef<Set<string>>(new Set())
  const passwordStepFlowRef = useRef(new PasswordStepFlowTracker())
  const tickInFlightRef = useRef(false)
  const pollDelayRef = useRef(IDLE_POLL_MS)
  const saveDraftRef = useRef<{
    pageUrl: string
    vaultUrl: string
    username: string
    password: string
    usernameOrigins?: string[]
    passwordOrigins?: string[]
  } | null>(null)
  const filledUsernameRef = useRef<{
    tabId: string
    entryId: string
    pageUrl: string
    username: string
    at: number
  } | null>(null)
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

  useEffect(() => {
    if (!enabled || !isTauri) {
      // Password prompts are rendered by the main app webview. Opening one
      // temporarily switches BrowserShell from `browsing` to `overlay`, which
      // intentionally disables site polling. Do not destroy the offer/flow
      // during that temporary overlay or the prompt immediately closes and
      // BrowserShell bounces back to browsing (visible as a home-screen flicker).
      if (!preserveStateWhenDisabled) {
        passwordStepFlowRef.current.clearAll()
        dismissedFillRef.current.clear()
        handledPendingRef.current.clear()
        saveDraftRef.current = null
        filledUsernameRef.current = null
        offerRef.current = null
        setOffer(null)
      }
      pollDelayRef.current = IDLE_POLL_MS
      return
    }

    let disposed = false
    let unlisten: (() => void) | undefined
    void listenForPasswordStepEvents((event) => {
      if (event.kind === 'identity') {
        passwordStepFlowRef.current.captureIdentity({
          shortcutId: event.shortcutId,
          origin: event.origin,
          username: event.username,
        })
        return
      }

      // Native submit capture is the navigation-safe source of truth. Keep it
      // even when the provider can recover the username on the password step;
      // the polling path remains as a fallback for ordinary single-page forms.
      passwordStepFlowRef.current.captureSubmission({
        shortcutId: event.shortcutId,
        origin: event.origin,
        url: event.url,
        username: event.username,
        password: event.password,
      })
    })
      .then((dispose) => {
        if (disposed) dispose()
        else unlisten = dispose
      })
      .catch((error) => {
        if (import.meta.env.DEV) {
          console.warn('[nebula] password step listener failed', error)
        }
      })

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [enabled, preserveStateWhenDisabled])

  const stageSaveCandidate = useCallback((
    shortcutId: string,
    pageUrl: string,
    username: string,
    password: string,
    observed?: {
      usernameOrigins?: string[]
      passwordOrigins?: string[]
    },
  ): boolean => {
    const normalizedUser = username.trim().toLowerCase()
    const usernameOrigins = normalizePasswordOrigins(observed?.usernameOrigins)
    const passwordOrigins = normalizePasswordOrigins(observed?.passwordOrigins)

    let existing = findExistingPassword(entriesRef.current, pageUrl, username)

    // A split-login credential may have been saved under the normal/username
    // origin before this password origin was learned. Reuse that same entry
    // instead of creating a duplicate.
    if (!existing && usernameOrigins.length > 0) {
      existing =
        entriesRef.current.find(
          (entry) =>
            entry.username.trim().toLowerCase() === normalizedUser &&
            usernameOrigins.some((origin) =>
              passwordEntryMatchesUrl(origin, entry, 'username'),
            ),
        ) ?? null
    }

    const vaultUrl = existing?.url ?? pageUrl
    const mergedUsernameOrigins = normalizePasswordOrigins([
      ...(existing?.usernameOrigins ?? []),
      ...usernameOrigins,
    ])
    const mergedPasswordOrigins = normalizePasswordOrigins([
      ...(existing?.passwordOrigins ?? []),
      ...passwordOrigins,
    ])

    if (existing?.password === password) {
      const usernameOriginsChanged =
        mergedUsernameOrigins.join('\0') !==
        normalizePasswordOrigins(existing.usernameOrigins).join('\0')
      const passwordOriginsChanged =
        mergedPasswordOrigins.join('\0') !==
        normalizePasswordOrigins(existing.passwordOrigins).join('\0')

      if (usernameOriginsChanged || passwordOriginsChanged) {
        void upsertPasswordEntry({
          label: existing.label || labelFromUrl(pageUrl),
          url: vaultUrl,
          username,
          password,
          usernameOrigins: mergedUsernameOrigins,
          passwordOrigins: mergedPasswordOrigins,
        })
          .then(() => onVaultChange())
          .catch((error) => {
            console.error('Password origin metadata update failed', error)
          })
      }
      return false
    }

    saveDraftRef.current = {
      pageUrl,
      vaultUrl,
      username,
      password,
      usernameOrigins: mergedUsernameOrigins,
      passwordOrigins: mergedPasswordOrigins,
    }
    const saveOffer: PasswordBridgeOffer = {
      mode: 'save',
      shortcutId,
      pageUrl,
      vaultUrl,
      username,
      password,
      label: existing?.label || labelFromUrl(pageUrl),
      usernameOrigins: mergedUsernameOrigins,
      passwordOrigins: mergedPasswordOrigins,
    }
    offerRef.current = saveOffer
    setOffer(saveOffer)
    return true
  }, [onVaultChange])

  const clearOffer = useCallback((_shortcutId?: string) => {
    saveDraftRef.current = null
    setOffer(null)
    offerRef.current = null
  }, [])

  const dismissOffer = useCallback(() => {
    const current = offerRef.current
    if (current?.mode === 'fill' && current.pageUrl) {
      dismissedFillRef.current.set(current.pageUrl, Date.now())
    }
    clearOffer(current?.shortcutId)
  }, [clearOffer])

  const acceptFill = useCallback(async (
    entry: SavedPassword,
    shortcutId: string,
    pageUrl: string,
    fillTarget?: 'username' | 'password' | 'both',
    rememberExplicitSelection = false,
  ): Promise<boolean> => {
    const target = fillTarget ?? 'both'
    const result = await fillPasswordOnTab(
      shortcutId,
      entry.username,
      entry.password,
      target,
    )
    if (!result) return false

    if (rememberExplicitSelection) {
      // The user explicitly chose this credential from Nebula's account picker.
      // Keep that exact choice for the next password step even if the provider
      // has a decoy/hidden password input and the fill script reports "both".
      filledUsernameRef.current = {
        tabId: shortcutId,
        entryId: entry.id,
        pageUrl,
        username: entry.username,
        at: Date.now(),
      }
    } else if (result === 'username' || fillTarget === 'username') {
      // Do not apply the normal 5-minute dismissal here: many split-login
      // providers keep the same URL when they swap the username step for the
      // password step. Suppress only the repeated username-stage offer.
      filledUsernameRef.current = {
        tabId: shortcutId,
        entryId: entry.id,
        pageUrl,
        username: entry.username,
        at: Date.now(),
      }
    } else {
      filledUsernameRef.current = null
      dismissedFillRef.current.set(pageUrl, Date.now())
    }
    clearOffer(shortcutId)
    return true
  }, [clearOffer])

  const acceptSave = useCallback(
    async (draft: {
      pageUrl: string
      vaultUrl?: string
      username: string
      password: string
      label: string
      usernameOrigins?: string[]
      passwordOrigins?: string[]
    }) => {
      await upsertPasswordEntry({
        label: draft.label,
        url: draft.vaultUrl ?? draft.pageUrl,
        username: draft.username,
        password: draft.password,
        usernameOrigins: normalizePasswordOrigins(draft.usernameOrigins),
        passwordOrigins: normalizePasswordOrigins(draft.passwordOrigins),
      })
      await onVaultChange()
      filledUsernameRef.current = null
      clearOffer(activeTabIdRef.current ?? undefined)
    },
    [clearOffer, onVaultChange],
  )

  useEffect(() => {
    dismissedFillRef.current.clear()
    handledPendingRef.current.clear()
    saveDraftRef.current = null
    filledUsernameRef.current = null
    offerRef.current = null
    pollDelayRef.current = IDLE_POLL_MS
    setOffer(null)
  }, [activeTabId])

  useEffect(() => {
    dismissedFillRef.current.clear()
    handledPendingRef.current.clear()
    pollDelayRef.current = IDLE_POLL_MS

    // A successful login may redirect immediately (including to another
    // origin). Keep a staged save candidate tied to the original tab/site;
    // only autofill offers are page-local and must be cleared on navigation.
    if (offerRef.current?.mode === 'fill') {
      offerRef.current = null
      setOffer(null)
    }
  }, [activeUrl])

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
        const steppedSubmission = passwordStepFlowRef.current.takeSubmission(tabId, tabUrl)
        if (steppedSubmission) {
          stageSaveCandidate(
            tabId,
            steppedSubmission.url,
            steppedSubmission.username,
            steppedSubmission.password,
            {
              usernameOrigins: steppedSubmission.usernameOrigins,
              passwordOrigins: steppedSubmission.passwordOrigins,
            },
          )
        }

        let nextOffer = offerRef.current

        if (!nextOffer && saveDraftRef.current) {
          const draft = saveDraftRef.current
          nextOffer = {
            mode: 'save',
            shortcutId: tabId,
            pageUrl: draft.pageUrl,
            vaultUrl: draft.vaultUrl,
            username: draft.username,
            password: draft.password,
            label: labelFromUrl(draft.pageUrl),
            usernameOrigins: draft.usernameOrigins,
            passwordOrigins: draft.passwordOrigins,
          }
        }

        const poll = await tickPasswordBridge(tabId)
        if (cancelled || !poll) {
          pollDelayRef.current = IDLE_POLL_MS
          return
        }
        pollDelayRef.current = poll.hasPasswordField || poll.hasUsernameField || poll.hasForm || nextOffer || poll.pending
          ? ACTIVE_POLL_MS
          : IDLE_POLL_MS

        const pageUrl = poll.href && isHttpUrl(poll.href) ? poll.href : tabUrl

        if (poll.pending?.username && poll.pending.password) {
          const pendingKey = `${pageUrl}\0${poll.pending.username}\0${poll.pending.t}`
          if (!handledPendingRef.current.has(pendingKey)) {
            handledPendingRef.current.add(pendingKey)
            if (
              stageSaveCandidate(
                tabId,
                pageUrl,
                poll.pending.username,
                poll.pending.password,
                {
                  usernameOrigins: [pageUrl],
                  passwordOrigins: [pageUrl],
                },
              )
            ) {
              return
            }
          }
        }

        if (!poll.hasPasswordField && !poll.hasUsernameField) {
          if (nextOffer?.mode === 'fill') clearOffer(tabId)
          return
        }

        const dismissedAt = dismissedFillRef.current.get(pageUrl)
        if (dismissedAt && Date.now() - dismissedAt < DISMISS_FILL_MS) return

        const recentUsernameFill = filledUsernameRef.current
        if (
          poll.hasUsernameField &&
          !poll.hasPasswordField &&
          recentUsernameFill?.tabId === tabId &&
          recentUsernameFill.pageUrl === pageUrl &&
          Date.now() - recentUsernameFill.at < DISMISS_FILL_MS
        ) {
          return
        }

        const matchRole = poll.hasPasswordField ? 'password' : 'username'
        let matches = matchPasswordsForUrl(pageUrl, entriesRef.current, matchRole)
        if (matches.length === 0) return

        // If the user chose an account on step 1, keep that credential selected
        // across navigation and prefer it on the password step, but only if the
        // current origin is already authorized for that credential's password.
        const filledUsername = filledUsernameRef.current
        if (
          poll.hasPasswordField &&
          filledUsername?.tabId === tabId &&
          Date.now() - filledUsername.at < DISMISS_FILL_MS
        ) {
          const selectedEntry = matches.find(
            (entry) => entry.id === filledUsername.entryId,
          )
          if (selectedEntry) {
            // The user already chose this account on the username step. Once
            // the password step appears, continue that same login flow without
            // asking them to choose the account a second time.
            const autoFilled = await acceptFill(
              selectedEntry,
              tabId,
              pageUrl,
              poll.hasUsernameField ? 'both' : 'password',
            )
            if (autoFilled) return

            // If the provider rejected the scripted fill, release the sticky
            // selection so the normal chooser can recover instead of looping.
            filledUsernameRef.current = null
          }
        }

        // On a two-step password page there may be no username input left in
        // the DOM. If step 1 gave us an identity in this same tab, prefer that
        // account among credentials already authorized for the current origin.
        const steppedUsername = passwordStepFlowRef.current.peekIdentityForUrl(tabId, pageUrl)
        if (steppedUsername) {
          const normalizedSteppedUsername = steppedUsername.trim().toLowerCase()
          const exactMatches = matches.filter(
            (entry) => entry.username.trim().toLowerCase() === normalizedSteppedUsername,
          )
          if (exactMatches.length > 0) matches = exactMatches
        }

        if (nextOffer?.mode === 'save') return

        const fillOffer: PasswordBridgeOffer = {
          mode: 'fill',
          shortcutId: tabId,
          pageUrl,
          username: matches[0].username,
          password: matches[0].password,
          label: labelFromUrl(pageUrl),
          matches,
          fillTarget: poll.hasPasswordField
            ? (poll.hasUsernameField ? 'both' : 'password')
            : 'username',
        }
        offerRef.current = fillOffer
        setOffer(fillOffer)
      } catch (error) {
        console.error('Password bridge polling failed', error)
      } finally {
        tickInFlightRef.current = false
      }
    }

    let pollTimer: number | undefined
    const run = async () => {
      if (cancelled) return
      if (!document.hidden) {
        await tick()
      }
      if (cancelled) return
      if (pollTimer) window.clearTimeout(pollTimer)
      pollTimer = window.setTimeout(() => void run(), pollDelayRef.current)
    }
    const startupTimer = window.setTimeout(() => void run(), STARTUP_DELAY_MS)
    const onVisibility = () => {
      if (document.hidden) return
      if (pollTimer) window.clearTimeout(pollTimer)
      void run()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      if (pollTimer) window.clearTimeout(pollTimer)
      window.clearTimeout(startupTimer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [
    enabled,
    activeTabId,
    activeUrl,
    acceptFill,
    clearOffer,
    stageSaveCandidate,
  ])

  return {
    offer,
    dismissOffer,
    acceptFill: (entry: SavedPassword) => {
      const current = offerRef.current
      if (!current) return
      void acceptFill(
        entry,
        current.shortcutId,
        current.pageUrl,
        current.fillTarget,
        true,
      ).catch((error) => {
        console.error('Password fill failed', error)
      })
    },
    acceptSave: () => {
      const current = offerRef.current
      if (!current || current.mode !== 'save') return
      void acceptSave({
        pageUrl: current.pageUrl,
        vaultUrl: current.vaultUrl,
        username: current.username,
        password: current.password,
        label: current.label,
        usernameOrigins: current.usernameOrigins,
        passwordOrigins: current.passwordOrigins,
      }).catch((error) => {
        console.error('Password save failed', error)
      })
    },
  }
}
