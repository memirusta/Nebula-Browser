/** What an import did, and the lines that tell the user about it. Kept free of the UI so it can be tested. */

export type ImportKind = 'bookmarks' | 'passwords'

export interface BrowserImportFailure {
  browser: string
  kind: ImportKind
  /** Only the browser's own export can bring these over (its encryption, or no direct way to read it). */
  needsCsv: boolean
}

export interface BrowserImportResult {
  /** What the user asked for. */
  attempted: Record<ImportKind, boolean>
  bookmarkShortcuts: number
  /** Sites left out of the shortcuts because of the limit. */
  extraBookmarks: number
  passwordCount: number
  failures: BrowserImportFailure[]
}

interface Translate {
  t: (key: ResultMessageKey) => string
  tf: (key: ResultMessageKey, vars: Record<string, string | number>) => string
}

export type ResultMessageKey =
  | 'importBookmarksDone'
  | 'importBookmarksMore'
  | 'bookmarksNone'
  | 'gsImportDone'
  | 'gsBrowserReadFailed'
  | 'gsImportNeedsCsv'

export interface ImportDescription {
  lines: string[]
  /** Something could not be read: show the text as an error. */
  error: boolean
  /** Offer the CSV file picker. */
  needsCsv: boolean
}

export function describeImportResult(
  result: BrowserImportResult,
  browserNames: ReadonlyMap<string, string>,
  { t, tf }: Translate,
): ImportDescription {
  const lines: string[] = []

  if (result.attempted.bookmarks) {
    if (result.bookmarkShortcuts > 0) {
      lines.push(tf('importBookmarksDone', { count: result.bookmarkShortcuts }))
      if (result.extraBookmarks > 0) {
        lines.push(tf('importBookmarksMore', { count: result.extraBookmarks }))
      }
    } else if (!result.failures.some((failure) => failure.kind === 'bookmarks')) {
      lines.push(t('bookmarksNone'))
    }
  }

  if (result.attempted.passwords) {
    const failedAll = result.failures.some((failure) => failure.kind === 'passwords') && result.passwordCount === 0
    if (!failedAll) lines.push(tf('gsImportDone', { count: result.passwordCount }))
  }

  const seen = new Set<string>()
  for (const failure of result.failures) {
    const key = `${failure.kind}:${failure.browser}`
    if (seen.has(key)) continue
    seen.add(key)
    lines.push(tf('gsBrowserReadFailed', { browser: browserNames.get(failure.browser) ?? failure.browser }))
  }

  const needsCsv = result.failures.some((failure) => failure.needsCsv)
  if (needsCsv) lines.push(t('gsImportNeedsCsv'))

  return { lines, error: result.failures.length > 0, needsCsv }
}
