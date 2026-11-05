import { importDefaultBrowserPasswords, listChromiumPasswordSources } from '../platform/browserPasswordImport'
import type { ImportedPassword } from './passwordImport'
import { t, tf, type NebulaLocale } from './locale'
import { isTauri } from '../platform/runtime'

export interface PasswordSyncResult {
  ok: boolean
  count: number
  message: string
  needsCsv: boolean
  imported: ImportedPassword[]
}

export interface BrowserReadFailure {
  browser: string
  /** The browser's own encryption (or a missing database) means only its CSV export can bring the passwords. */
  needsCsv: boolean
}

export interface BrowserPasswordsRead {
  imported: ImportedPassword[]
  failures: BrowserReadFailure[]
}

function needsCsvFor(error: unknown): boolean {
  const nativeMessage =
    error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return (
    nativeMessage.includes('app-bound') ||
    nativeMessage.includes('CSV') ||
    nativeMessage.includes('Dışa aktar') ||
    nativeMessage.includes('dışa aktar')
  )
}

/** Reads the saved passwords of each chosen browser; a browser that cannot be read does not stop the others. */
export async function readPasswordsFromBrowsers(browsers: readonly string[]): Promise<BrowserPasswordsRead> {
  const imported: ImportedPassword[] = []
  const failures: BrowserReadFailure[] = []
  for (const browser of browsers) {
    try {
      imported.push(...(await importDefaultBrowserPasswords(browser)))
    } catch (error) {
      failures.push({ browser, needsCsv: needsCsvFor(error) })
    }
  }
  return { imported, failures }
}

/** Imports from one browser (kept for callers that have a single browser in mind). */
export async function syncPasswordsFromBrowser(
  locale: NebulaLocale,
  preferredBrowser = 'chrome',
): Promise<PasswordSyncResult> {
  if (!isTauri) {
    return {
      ok: false,
      count: 0,
      message: t(locale, 'gsImportDesktopOnly'),
      needsCsv: false,
      imported: [],
    }
  }

  const sources = (await listChromiumPasswordSources()).filter((source) => !source.csvOnly)
  const browser = sources.some((source) => source.browser === preferredBrowser)
    ? preferredBrowser
    : sources[0]?.browser

  if (!browser) {
    return {
      ok: false,
      count: 0,
      message: t(locale, 'gsImportSourceMissing'),
      needsCsv: true,
      imported: [],
    }
  }

  try {
    const imported = await importDefaultBrowserPasswords(browser)
    return {
      ok: true,
      count: imported.length,
      message: tf(locale, 'gsImportDone', { count: imported.length }),
      needsCsv: false,
      imported,
    }
  } catch (error) {
    const needsCsv = needsCsvFor(error)
    return {
      ok: false,
      count: 0,
      message: t(locale, needsCsv ? 'gsImportNeedsCsv' : 'gsImportFailed'),
      needsCsv,
      imported: [],
    }
  }
}
