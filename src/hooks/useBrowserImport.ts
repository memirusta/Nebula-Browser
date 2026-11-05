import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { planBookmarkShortcuts, type ImportedBookmark } from '../core/bookmarkImport'
import type { BrowserImportFailure, BrowserImportResult } from '../core/browserImportResult'
import { readPasswordsFromBrowsers } from '../core/googleAccountSetup'
import type { ImportedPassword } from '../core/passwordCsv'
import {
  NEBULA_SOURCE,
  planImport,
  resolveImport,
  type ExistingPassword,
  type ImportPicks,
  type ImportPlan,
} from '../core/passwordImportCompare'
import {
  anyChosen,
  choiceForWholeBrowser,
  initialBrowserChoices,
  offeredKinds,
  type BrowserChoices,
  type ImportKind,
  type ImportOffer,
} from '../core/passwordImportSources'
import type { Shortcut } from '../core/types'
import {
  importBrowserBookmarks,
  listBrowserImportSources,
  type BrowserImportSource,
} from '../platform/browserImport'
import { isTauri } from '../platform/runtime'

interface UseBrowserImportOptions {
  /** Which kinds of things the host screen offers. */
  offer: ImportOffer
  /** What is ticked at first for the default (or only) browser. */
  defaults?: Partial<ImportOffer>
  /** The list of browsers is read when this becomes true (once). */
  load: boolean
  /** The passwords Nebula already has: a browser copy that differs from one of them is a decision, not a replacement. */
  existingPasswords: readonly ExistingPassword[]
  /** Called once with the shortcuts made from the bookmarks. */
  onBookmarkShortcuts?: (shortcuts: Shortcut[]) => void
  /** Called once with the passwords to save, after any conflicts were decided. */
  onPasswords?: (entries: ImportedPassword[]) => void | Promise<void>
  /** The name Nebula's own vault is shown under in a conflict. */
  nebulaName: string
}

type Phase = 'choose' | 'conflicts'

/** Why a run could not start: nothing is ticked. */
export type ImportProblem = 'nothingChosen'

/** What a run came to: nothing to do (see `problem`), a decision the user still has to make, or finished. */
export type ImportOutcome =
  | { status: 'invalid'; problem: ImportProblem }
  | { status: 'conflicts' }
  | { status: 'done'; result: BrowserImportResult }

interface FirstPart {
  attempted: Record<ImportKind, boolean>
  bookmarkShortcuts: number
  extraBookmarks: number
  failures: BrowserImportFailure[]
}

export function useBrowserImport({
  offer,
  defaults,
  load,
  existingPasswords,
  onBookmarkShortcuts,
  onPasswords,
  nebulaName,
}: UseBrowserImportOptions) {
  const [sources, setSources] = useState<BrowserImportSource[] | null>(null)
  // Why the list could not be made, when the native lookup itself failed.
  const [sourcesError, setSourcesError] = useState<string | null>(null)
  const [choices, setChoices] = useState<BrowserChoices>({})
  const [working, setWorking] = useState(false)
  const [phase, setPhase] = useState<Phase>('choose')
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [picks, setPicks] = useState<ImportPicks>({})
  const [result, setResult] = useState<BrowserImportResult | null>(null)
  const [problem, setProblem] = useState<ImportProblem | null>(null)
  // What the first part of the run found, kept while the user decides the password conflicts.
  const partial = useRef<FirstPart | null>(null)

  const loadSources = useCallback(() => {
    setSourcesError(null)
    if (!isTauri) {
      setSources([])
      return
    }
    listBrowserImportSources()
      .then((found) => {
        setSources(found)
        setChoices(initialBrowserChoices(found, offer, defaults ?? {}))
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        console.warn('[nebula] listing the browsers to import from failed', error)
        setSources(null)
        setSourcesError(message)
      })
  }, [defaults, offer])

  // The list is read when the screen first needs it.
  const loadRequested = useRef(false)
  useEffect(() => {
    if (loadRequested.current || !load) return
    loadRequested.current = true
    loadSources()
  }, [load, loadSources])

  const names = useMemo(() => {
    const map = new Map<string, string>()
    for (const source of sources ?? []) map.set(source.browser, source.displayName)
    map.set(NEBULA_SOURCE, nebulaName)
    return map
  }, [nebulaName, sources])

  /** Ticks or unticks one kind of one browser. */
  const setChoice = useCallback((browser: string, kind: ImportKind, checked: boolean) => {
    setChoices((current) => ({
      ...current,
      [browser]: { ...(current[browser] ?? { bookmarks: false, passwords: false }), [kind]: checked },
    }))
    setProblem(null)
  }, [])

  /** Ticks everything a browser can give, or nothing (the checkbox next to its name). */
  const toggleBrowser = useCallback(
    (browser: string, checked: boolean) => {
      const source = sources?.find((item) => item.browser === browser)
      if (!source) return
      setChoices((current) => ({ ...current, [browser]: choiceForWholeBrowser(source, offer, checked) }))
      setProblem(null)
    },
    [offer, sources],
  )

  const finish = useCallback((firstPart: FirstPart, passwordCount: number): BrowserImportResult => {
    const finished: BrowserImportResult = {
      attempted: firstPart.attempted,
      bookmarkShortcuts: firstPart.bookmarkShortcuts,
      extraBookmarks: firstPart.extraBookmarks,
      passwordCount,
      failures: firstPart.failures,
    }
    setResult(finished)
    return finished
  }, [])

  const run = useCallback(async (): Promise<ImportOutcome> => {
    setResult(null)
    if (!anyChosen(choices) || !sources) {
      setProblem('nothingChosen')
      return { status: 'invalid', problem: 'nothingChosen' }
    }

    // Only what is ticked, and only from the browsers that have it, is read.
    const chosenFrom = (kind: ImportKind) =>
      sources
        .filter((source) => choices[source.browser]?.[kind] && offeredKinds(source, offer)[kind])
        .map((source) => source.browser)
    const bookmarkBrowsers = chosenFrom('bookmarks')
    const passwordBrowsers = chosenFrom('passwords')
    if (bookmarkBrowsers.length + passwordBrowsers.length === 0) {
      setProblem('nothingChosen')
      return { status: 'invalid', problem: 'nothingChosen' }
    }

    setProblem(null)
    setWorking(true)
    try {
      const failures: BrowserImportFailure[] = []
      let bookmarkShortcuts = 0
      let extraBookmarks = 0

      if (bookmarkBrowsers.length > 0) {
        const bookmarks: ImportedBookmark[] = []
        for (const browser of bookmarkBrowsers) {
          try {
            bookmarks.push(...(await importBrowserBookmarks(browser)))
          } catch {
            failures.push({ browser, kind: 'bookmarks', needsCsv: false })
          }
        }
        // Bookmarks need no decision: they are applied right away.
        const shortcutPlan = planBookmarkShortcuts(bookmarks)
        bookmarkShortcuts = shortcutPlan.shortcuts.length
        extraBookmarks = shortcutPlan.extra
        if (shortcutPlan.shortcuts.length > 0) onBookmarkShortcuts?.(shortcutPlan.shortcuts)
      }

      let passwordPlan: ImportPlan | null = null
      if (passwordBrowsers.length > 0) {
        const read = await readPasswordsFromBrowsers(passwordBrowsers)
        for (const failure of read.failures) {
          failures.push({ browser: failure.browser, kind: 'passwords', needsCsv: failure.needsCsv })
        }
        passwordPlan = planImport(read.imported, existingPasswords)
      }

      const firstPart: FirstPart = {
        attempted: { bookmarks: bookmarkBrowsers.length > 0, passwords: passwordBrowsers.length > 0 },
        bookmarkShortcuts,
        extraBookmarks,
        failures,
      }
      if (passwordPlan && passwordPlan.conflicts.length > 0) {
        partial.current = firstPart
        setPlan(passwordPlan)
        setPicks({})
        setPhase('conflicts')
        return { status: 'conflicts' }
      }

      let passwordCount = 0
      if (passwordPlan) {
        const entries = resolveImport(passwordPlan)
        if (entries.length > 0) await onPasswords?.(entries)
        passwordCount = entries.length
      }
      return { status: 'done', result: finish(firstPart, passwordCount) }
    } finally {
      setWorking(false)
    }
  }, [choices, existingPasswords, finish, offer, onBookmarkShortcuts, onPasswords, sources])

  const confirmConflicts = useCallback(async (): Promise<BrowserImportResult | null> => {
    if (!plan || !partial.current) return null
    setWorking(true)
    try {
      const entries = resolveImport(plan, picks)
      if (entries.length > 0) await onPasswords?.(entries)
      const finished = finish(partial.current, entries.length)
      setPlan(null)
      setPhase('choose')
      return finished
    } finally {
      setWorking(false)
    }
  }, [finish, onPasswords, picks, plan])

  const backFromConflicts = useCallback(() => {
    setPlan(null)
    setPhase('choose')
  }, [])

  const pick = useCallback((key: string, index: number) => {
    setPicks((current) => ({ ...current, [key]: index }))
  }, [])

  /** Back to the start (for a host screen that is reused for another account). */
  const reset = useCallback(() => {
    setWorking(false)
    setPhase('choose')
    setPlan(null)
    setPicks({})
    setResult(null)
    setProblem(null)
    partial.current = null
  }, [])

  return {
    sources,
    sourcesError,
    retryLoad: loadSources,
    choices,
    working,
    phase,
    plan,
    picks,
    result,
    problem,
    names,
    setChoice,
    toggleBrowser,
    run,
    confirmConflicts,
    backFromConflicts,
    pick,
    reset,
  }
}
