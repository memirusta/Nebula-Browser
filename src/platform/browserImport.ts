import { invoke } from '@tauri-apps/api/core'
import type { ImportedBookmark } from '../core/bookmarkImport'
import { isTauri } from './runtime'

/** One browser found on this computer that the import step can offer. */
export interface BrowserImportSource {
  browser: string
  displayName: string
  /** The browser Windows opens links with. */
  isDefault?: boolean
  /** Saved logins that can be read (counted, not decrypted). */
  loginCount?: number | null
  /** Whether its saved passwords can be read directly. */
  passwordsDirect?: boolean
  /** Its passwords only come over with its own CSV export (Firefox). */
  passwordsCsvOnly?: boolean
  bookmarkCount?: number | null
}

/**
 * The browsers found on this computer. A failure of the native side is thrown, not turned into an empty list:
 * "no browser found" and "the lookup failed" are different things for the user and for whoever reads the report.
 */
export async function listBrowserImportSources(): Promise<BrowserImportSource[]> {
  if (!isTauri) return []

  return invoke<BrowserImportSource[]>('list_browser_import_sources')
}

/** Every bookmark of one browser (all its profiles), with when each was added and last used. */
export async function importBrowserBookmarks(browser: string): Promise<ImportedBookmark[]> {
  if (!isTauri) return []

  return invoke<ImportedBookmark[]>('import_browser_bookmarks', { browser })
}

export interface BrowserLookupDetail {
  browser: string
  folder: string
  folderExists: boolean
  profiles: number
  passwordStore: boolean
  bookmarkFiles: number
}

/** Where the lookup of the browsers looked, and what it saw there. */
export interface BrowserLookupDiagnostics {
  localAppData: string | null
  roamingAppData: string | null
  firefoxInstalled: boolean
  browsers: BrowserLookupDetail[]
}

export async function browserImportDiagnostics(): Promise<BrowserLookupDiagnostics> {
  return invoke<BrowserLookupDiagnostics>('browser_import_diagnostics')
}

/** The report as plain lines: the folders searched, then each browser folder that exists. */
export function formatLookupDiagnostics(report: BrowserLookupDiagnostics): string {
  const lines = [
    `LOCALAPPDATA: ${report.localAppData ?? '(not set)'}`,
    `APPDATA: ${report.roamingAppData ?? '(not set)'}`,
    `Firefox profile: ${report.firefoxInstalled ? 'found' : 'not found'}`,
  ]
  const found = report.browsers.filter((browser) => browser.folderExists)
  for (const browser of found) {
    lines.push(
      `${browser.browser}: ${browser.folder} - profiles ${browser.profiles}, passwords ${browser.passwordStore ? 'yes' : 'no'}, bookmark files ${browser.bookmarkFiles}`,
    )
  }
  lines.push(`${found.length} of ${report.browsers.length} browser folders exist`)
  return lines.join('\n')
}
