/** What the import step needs to know about a browser Nebula found (a subset of the native answer). */
export interface ImportSourceInfo {
  browser: string
  displayName: string
  /** The browser Windows opens links with. */
  isDefault?: boolean
  /** Saved logins that can be read (counted); null when the count could not be made. */
  loginCount?: number | null
  bookmarkCount?: number | null
  /** Whether its saved passwords can be read directly; Firefox's only come over with its CSV export. */
  passwordsDirect?: boolean
  passwordsCsvOnly?: boolean
}

export type ImportKind = 'bookmarks' | 'passwords'

/** What the user wants from one browser. */
export interface BrowserChoice {
  bookmarks: boolean
  passwords: boolean
}

/** The choice of every browser, by browser id. */
export type BrowserChoices = Record<string, BrowserChoice>

/** Which kinds of things a screen offers at all. */
export type ImportOffer = Record<ImportKind, boolean>

const NOTHING: BrowserChoice = { bookmarks: false, passwords: false }

/** What can be taken from a browser: bookmarks when it has some, passwords when they can be read directly. */
export function availableKinds(source: ImportSourceInfo): Record<ImportKind, boolean> {
  return {
    bookmarks: (source.bookmarkCount ?? 0) > 0,
    // An unknown count (a locked database) still allows trying; a known zero does not.
    passwords: source.passwordsDirect === true && (source.loginCount == null || source.loginCount > 0),
  }
}

/** The kinds a screen shows for a browser: what is offered and what the browser has. */
export function offeredKinds(source: ImportSourceInfo, offer: ImportOffer): Record<ImportKind, boolean> {
  const available = availableKinds(source)
  return { bookmarks: offer.bookmarks && available.bookmarks, passwords: offer.passwords && available.passwords }
}

/**
 * What is ticked when the list is first shown: for the browser Windows opens links with (or the only browser
 * there is) the kinds in `defaults` that it has; nothing for the others. Reading another browser's passwords is
 * something the user opts into by ticking it. A browser with nothing to take stays unticked.
 */
export function initialBrowserChoices(
  sources: readonly ImportSourceInfo[],
  offer: ImportOffer,
  defaults: Partial<ImportOffer>,
): BrowserChoices {
  const preferred = sources.find((source) => source.isDefault) ?? (sources.length === 1 ? sources[0] : undefined)
  const choices: BrowserChoices = {}
  for (const source of sources) {
    if (source !== preferred) {
      choices[source.browser] = { ...NOTHING }
      continue
    }
    const kinds = offeredKinds(source, offer)
    choices[source.browser] = {
      bookmarks: kinds.bookmarks && (defaults.bookmarks ?? false),
      passwords: kinds.passwords && (defaults.passwords ?? false),
    }
  }
  return choices
}

/** Ticks or unticks everything a browser can give (the checkbox next to its name). */
export function choiceForWholeBrowser(source: ImportSourceInfo, offer: ImportOffer, checked: boolean): BrowserChoice {
  if (!checked) return { ...NOTHING }
  return offeredKinds(source, offer)
}

export function anyChosen(choices: BrowserChoices): boolean {
  return Object.values(choices).some((choice) => choice.bookmarks || choice.passwords)
}

/** One line item of "what will come over from this browser": the kind and how many (null when not counted). */
export interface ChosenPart {
  kind: ImportKind
  count: number | null
}

/** What is going to be taken from a browser with the current choice; empty when nothing is ticked. */
export function chosenParts(source: ImportSourceInfo, choice: BrowserChoice | undefined, offer: ImportOffer): ChosenPart[] {
  const kinds = offeredKinds(source, offer)
  const parts: ChosenPart[] = []
  if (choice?.bookmarks && kinds.bookmarks) parts.push({ kind: 'bookmarks', count: source.bookmarkCount ?? 0 })
  if (choice?.passwords && kinds.passwords) parts.push({ kind: 'passwords', count: source.loginCount ?? null })
  return parts
}

/** The browsers shown on a screen that only offers one kind: the ones that have it. */
export function sourcesWithKinds<T extends ImportSourceInfo>(sources: readonly T[], offer: ImportOffer): T[] {
  const both = offer.bookmarks && offer.passwords
  // With both kinds offered every browser is shown (even one with nothing to take: it stays unticked).
  if (both) return [...sources]
  return sources.filter((source) => {
    const kinds = offeredKinds(source, offer)
    return kinds.bookmarks || kinds.passwords
  })
}
