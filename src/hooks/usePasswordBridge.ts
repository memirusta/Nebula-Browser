import { useCallback, useEffect, useRef, useState } from 'react'
import {
  findExistingPassword,
  labelFromUrl,
  matchPasswordsForUrl,
  normalizePasswordOrigins,
  passwordEntryMatchesUrl,
  accountForPasswordChange,
  passwordOriginFromUrl,
} from '../core/passwordMatch'
import { settleSaveDraft } from '../core/passwordSaveSettle'
import { PasswordStepFlowTracker } from '../core/passwordStepFlow'
import {
  entryForPickedAccount,
  suggestionAccounts,
  type PasswordSaveLabels,
  type PasswordSuggestLabels,
} from '../core/passwordSuggest'
import type { SavedPassword } from '../core/passwordVault'
import { upsertPasswordEntry } from '../core/passwordVault'
import {
  fillPasswordOnTab,
  listenForPasswordStepEvents,
  listenForPasswordSuggestEvents,
  pushPasswordSaveBubble,
  pushPasswordSuggestions,
  tickPasswordBridge,
} from '../platform/tauriPasswordBridge'
import { isTauri } from '../platform/runtime'

const ACTIVE_POLL_MS = 2000
const IDLE_POLL_MS = 6000
const DISMISS_FILL_MS = 5 * 60_000
const STARTUP_DELAY_MS = 800

export type PasswordBridgeMode = 'fill' | 'save'

/** A dismissed fill offer is remembered per tab and site, not per address, so a page that changes its URL does not ask again. */
function dismissKey(tabId: string, pageUrl: string): string {
  return `${tabId}\0${passwordOriginFromUrl(pageUrl) ?? pageUrl}`
}

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
  /** False in a private tab: nothing typed there is offered for saving. */
  savingAllowed?: boolean
  activeTabId: string | null
  activeUrl: string | null
  entries: SavedPassword[]
  /** The words of the heading of the account list drawn under the sign-in field. */
  suggestLabels: PasswordSuggestLabels
  /** The words of the bubble that offers to save a new password, and of the one that offers to update one. */
  saveLabels: { save: PasswordSaveLabels; update: PasswordSaveLabels }
  onVaultChange: () => void | Promise<void>
}

/** What the page's account list was last given for a tab, so a pick in it can be matched to a saved login. */
interface TabSuggestions {
  pageUrl: string
  matches: SavedPassword[]
  fillTarget: 'username' | 'password' | 'both'
}

function isHttpUrl(url: string | null): url is string {
  if (!url) return false
  return url.startsWith('http://') || url.startsWith('https://')
}

export function usePasswordBridge({
  enabled,
  preserveStateWhenDisabled = false,
  savingAllowed = true,
  activeTabId,
  activeUrl,
  entries,
  suggestLabels,
  saveLabels,
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
    shortcutId: string
    pageUrl: string
    vaultUrl: string
    username: string
    password: string
    usernameOrigins?: string[]
    passwordOrigins?: string[]
    stagedAt: number
    /** Polls in a row that found no sign-in form on the page. */
    formGoneTicks: number
  } | null>(null)
  const savingAllowedRef = useRef(savingAllowed)
  // The page document a saved login was filled into, per tab: a reload is a new document and is offered again.
  const filledDocRef = useRef<Map<string, string>>(new Map())
  const docIdRef = useRef<string | null>(null)
  const filledUsernameRef = useRef<{
    docId: string | null
    tabId: string
    entryId: string
    pageUrl: string
    username: string
    at: number
  } | null>(null)
  const entriesRef = useRef(entries)
  const suggestLabelsRef = useRef(suggestLabels)
  // Per tab: the accounts the page's list holds, and what was last sent (so an unchanged list is not sent again).
  const suggestionsRef = useRef<Map<string, TabSuggestions>>(new Map())
  const suggestionKeyRef = useRef<Map<string, string>>(new Map())
  const wakeRef = useRef<(() => void) | null>(null)
  const saveLabelsRef = useRef(saveLabels)
  // Whether the save offer is shown as the page's own bubble (and for which document), not as the prompt over the page.
  const inlineSaveRef = useRef(false)
  const saveBubbleKeyRef = useRef<string | null>(null)
  const activeTabIdRef = useRef(activeTabId)
  const activeUrlRef = useRef(activeUrl)

  useEffect(() => {
    offerRef.current = offer
  }, [offer])

  useEffect(() => {
    savingAllowedRef.current = savingAllowed
    if (!savingAllowed) {
      saveDraftRef.current = null
      if (offerRef.current?.mode === 'save') {
        offerRef.current = null
        setOffer(null)
      }
    }
  }, [savingAllowed])

  useEffect(() => {
    entriesRef.current = entries
  }, [entries])

  useEffect(() => {
    suggestLabelsRef.current = suggestLabels
  }, [suggestLabels])

  useEffect(() => {
    saveLabelsRef.current = saveLabels
  }, [saveLabels])

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
    if (!savingAllowedRef.current) return false
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
      shortcutId,
      pageUrl,
      vaultUrl,
      username,
      password,
      usernameOrigins: mergedUsernameOrigins,
      passwordOrigins: mergedPasswordOrigins,
      stagedAt: Date.now(),
      formGoneTicks: 0,
    }
    // The offer itself waits for the next poll: it is shown once the sign-in form is gone.
    return true
  }, [onVaultChange])

  const clearOffer = useCallback((shortcutId?: string) => {
    if (inlineSaveRef.current) {
      // The bubble in the page goes with the offer.
      inlineSaveRef.current = false
      saveBubbleKeyRef.current = null
      const tabId = shortcutId ?? activeTabIdRef.current
      if (tabId) void pushPasswordSaveBubble(tabId, null)
    }
    saveDraftRef.current = null
    setOffer(null)
    offerRef.current = null
  }, [])

  /** Gives the page's account list its accounts. False when the page has no such list: the caller then asks with
   * its own prompt. An unchanged list is not sent again. */
  const showSuggestions = useCallback(async (
    tabId: string,
    docId: string | null,
    suggestions: TabSuggestions,
  ): Promise<boolean> => {
    const accounts = suggestionAccounts(suggestions.matches)
    const labels = suggestLabelsRef.current
    const key = JSON.stringify([docId, accounts, labels])
    suggestionsRef.current.set(tabId, suggestions)
    if (suggestionKeyRef.current.get(tabId) === key) return true
    const result = await pushPasswordSuggestions(tabId, { accounts, labels })
    if (result === 'missing') return false
    if (result === 'ok') suggestionKeyRef.current.set(tabId, key)
    return true
  }, [])

  /** The page has no sign-in form for these accounts (any more): its list is emptied and closed. With `announce`,
   * a sign-in form is there but no account is saved for it: the page still gets the words of its list once per
   * document, because it may fill the list with passkeys. */
  const clearSuggestions = useCallback(async (tabId: string, announce = false) => {
    suggestionsRef.current.delete(tabId)
    const key = suggestionKeyRef.current.get(tabId)
    const emptyKey = announce ? `empty:${docIdRef.current ?? ''}` : 'empty'
    if (announce ? key === emptyKey : !key || key === 'empty' || key.startsWith('empty:')) return
    const result = await pushPasswordSuggestions(tabId, {
      accounts: [],
      labels: suggestLabelsRef.current,
    })
    if (result === 'ok' || result === 'missing') suggestionKeyRef.current.set(tabId, emptyKey)
  }, [])

  /** Shows the save/update offer as a bubble in the page. False when the page cannot show one: the caller then asks
   * with its own prompt. The same document is not sent the bubble twice. */
  const showSaveBubble = useCallback(async (
    tabId: string,
    offer: PasswordBridgeOffer,
    docId: string | null,
  ): Promise<boolean> => {
    const update =
      findExistingPassword(entriesRef.current, offer.vaultUrl ?? offer.pageUrl, offer.username) !== null
    const key = JSON.stringify([docId, offer.username, update])
    if (saveBubbleKeyRef.current === key) return true
    const labels = update ? saveLabelsRef.current.update : saveLabelsRef.current.save
    const result = await pushPasswordSaveBubble(tabId, {
      site: offer.label,
      username: offer.username,
      labels,
    })
    if (result === 'missing') return false
    if (result === 'ok') saveBubbleKeyRef.current = key
    return true
  }, [])

  const dismissOffer = useCallback(() => {
    const current = offerRef.current
    if (current?.mode === 'fill' && current.pageUrl) {
      dismissedFillRef.current.set(dismissKey(current.shortcutId, current.pageUrl), Date.now())
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
        docId: docIdRef.current,
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
        docId: docIdRef.current,
        tabId: shortcutId,
        entryId: entry.id,
        pageUrl,
        username: entry.username,
        at: Date.now(),
      }
    } else {
      // Filled: not offered again on this document, but a reload brings the offer back. Only dismissing the
      // offer silences it for a while.
      filledUsernameRef.current = null
      if (docIdRef.current) filledDocRef.current.set(shortcutId, docIdRef.current)
      else dismissedFillRef.current.set(dismissKey(shortcutId, pageUrl), Date.now())
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
    handledPendingRef.current.clear()
    saveDraftRef.current = null
    filledUsernameRef.current = null
    offerRef.current = null
    pollDelayRef.current = IDLE_POLL_MS
    setOffer(null)
  }, [activeTabId])

  useEffect(() => {
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

        const poll = await tickPasswordBridge(tabId)
        if (cancelled || !poll) {
          pollDelayRef.current = IDLE_POLL_MS
          return
        }
        pollDelayRef.current = poll.hasPasswordField || poll.hasUsernameField || poll.hasForm || nextOffer || poll.pending || saveDraftRef.current
          ? ACTIVE_POLL_MS
          : IDLE_POLL_MS

        const pageUrl = poll.href && isHttpUrl(poll.href) ? poll.href : tabUrl
        docIdRef.current = poll.docId ?? null

        // A save offer shown as the page's own bubble: a new document (the login went on to another page) gets it again.
        const shownOffer = offerRef.current
        if (shownOffer?.mode === 'save' && inlineSaveRef.current) {
          await showSaveBubble(tabId, shownOffer, poll.docId ?? null)
          return
        }

        // A password change has no account field: it belongs to the site's one saved account.
        const pendingUsername = poll.pending?.password
          ? poll.pending.username || accountForPasswordChange(entriesRef.current, poll.pending.url || pageUrl)
          : null
        if (poll.pending && pendingUsername) {
          const pendingKey = `${pageUrl}\0${pendingUsername}\0${poll.pending.t}`
          if (!handledPendingRef.current.has(pendingKey)) {
            handledPendingRef.current.add(pendingKey)
            if (
              stageSaveCandidate(
                tabId,
                pageUrl,
                pendingUsername,
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

        // A submitted login becomes a save offer once the sign-in form has stayed away (the site accepted the
        // login). A form that is still there after the settle time means the login failed: nothing is offered.
        const draft = saveDraftRef.current
        if (draft && !offerRef.current) {
          const settled = settleSaveDraft(
            draft,
            poll.hasAnyPasswordField ?? poll.hasPasswordField ?? false,
            Date.now(),
          )
          draft.formGoneTicks = settled.formGoneTicks
          if (settled.action === 'drop') saveDraftRef.current = null
          if (settled.action !== 'show') return
          const saveOffer: PasswordBridgeOffer = {
            mode: 'save',
            shortcutId: draft.shortcutId,
            pageUrl: draft.pageUrl,
            vaultUrl: draft.vaultUrl,
            username: draft.username,
            password: draft.password,
            label: labelFromUrl(draft.pageUrl),
            usernameOrigins: draft.usernameOrigins,
            passwordOrigins: draft.passwordOrigins,
          }
          offerRef.current = saveOffer
          // The offer is made in the page itself; only a page that cannot show it gets the prompt over the page.
          if (await showSaveBubble(tabId, saveOffer, poll.docId ?? null)) {
            inlineSaveRef.current = true
            return
          }
          setOffer(saveOffer)
          return
        }

        const dismissKeyForPage = dismissKey(tabId, pageUrl)
        if (!poll.hasPasswordField && !poll.hasUsernameField) {
          if (nextOffer?.mode === 'fill') clearOffer(tabId)
          await clearSuggestions(tabId)
          return
        }

        if (poll.docId && filledDocRef.current.get(tabId) === poll.docId) return

        const dismissedAt = dismissedFillRef.current.get(dismissKeyForPage)
        if (dismissedAt && Date.now() - dismissedAt < DISMISS_FILL_MS) return

        const recentUsernameFill = filledUsernameRef.current
        if (
          poll.hasUsernameField &&
          !poll.hasPasswordField &&
          recentUsernameFill?.tabId === tabId &&
          recentUsernameFill.pageUrl === pageUrl &&
          recentUsernameFill.docId === (poll.docId ?? null) &&
          Date.now() - recentUsernameFill.at < DISMISS_FILL_MS
        ) {
          return
        }

        const matchRole = poll.hasPasswordField ? 'password' : 'username'
        let matches = matchPasswordsForUrl(pageUrl, entriesRef.current, matchRole)
        if (matches.length === 0) {
          await clearSuggestions(tabId, true)
          return
        }

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
            if (autoFilled) {
              await clearSuggestions(tabId)
              return
            }

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

        const fillTarget: 'username' | 'password' | 'both' = poll.hasPasswordField
          ? (poll.hasUsernameField ? 'both' : 'password')
          : 'username'

        // The accounts are listed under the sign-in field itself. Only a page that cannot show that list gets the
        // prompt over the page.
        if (await showSuggestions(tabId, poll.docId ?? null, { pageUrl, matches, fillTarget })) {
          if (nextOffer?.mode === 'fill') clearOffer(tabId)
          return
        }

        const fillOffer: PasswordBridgeOffer = {
          mode: 'fill',
          shortcutId: tabId,
          pageUrl,
          username: matches[0].username,
          password: matches[0].password,
          label: labelFromUrl(pageUrl),
          matches,
          fillTarget,
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
    // A field was focused before the page had its list: look at the page now instead of at the next poll.
    wakeRef.current = () => {
      if (pollTimer) window.clearTimeout(pollTimer)
      void run()
    }
    const onVisibility = () => {
      if (document.hidden) return
      if (pollTimer) window.clearTimeout(pollTimer)
      void run()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      wakeRef.current = null
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
    clearSuggestions,
    showSuggestions,
    showSaveBubble,
    stageSaveCandidate,
  ])

  // A pick in the account list under the sign-in field. The page only says which user name was chosen; the
  // login is taken from the accounts the shell offered for that tab, and the fill is done from here.
  useEffect(() => {
    if (!enabled || !isTauri) return

    let disposed = false
    let unlisten: (() => void) | undefined
    void listenForPasswordSuggestEvents((event) => {
      if (event.shortcutId !== activeTabIdRef.current) return

      // The answer to the save/update bubble: the login to save is the one the shell kept, never anything the
      // page sent.
      if (event.kind === 'save' || event.kind === 'dismiss') {
        const current = offerRef.current
        if (!current || current.mode !== 'save' || !inlineSaveRef.current) return
        if (current.shortcutId !== event.shortcutId) return
        if (event.kind === 'dismiss') {
          clearOffer(current.shortcutId)
          return
        }
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
        return
      }

      if (event.kind === 'wanted') {
        pollDelayRef.current = ACTIVE_POLL_MS
        wakeRef.current?.()
        return
      }

      const offered = suggestionsRef.current.get(event.shortcutId)
      if (!offered) return
      if (passwordOriginFromUrl(event.url) !== passwordOriginFromUrl(offered.pageUrl)) return
      const entry = entryForPickedAccount(offered.matches, event.username)
      if (!entry) return
      void acceptFill(entry, event.shortcutId, offered.pageUrl, offered.fillTarget, true).catch(
        (error) => {
          console.error('Password fill failed', error)
        },
      )
    })
      .then((dispose) => {
        if (disposed) dispose()
        else unlisten = dispose
      })
      .catch((error) => {
        if (import.meta.env.DEV) {
          console.warn('[nebula] password suggest listener failed', error)
        }
      })

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [enabled, acceptFill, acceptSave, clearOffer])

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
