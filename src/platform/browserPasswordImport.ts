import { invoke } from '@tauri-apps/api/core'
import type { ImportedPassword } from '../core/passwordImport'
import { isTauri } from './runtime'

export interface ChromiumPasswordSource {
  browser: string
  displayName: string
  /** Saved logins found in the browser (counted, not read); absent when the count could not be made. */
  loginCount?: number | null
  /** The browser Windows opens links with. */
  isDefault?: boolean
  /** Recognised, but its passwords only come over with its CSV export (Firefox). */
  csvOnly?: boolean
}

function invokeErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  return String(error)
}

export async function listChromiumPasswordSources(): Promise<ChromiumPasswordSource[]> {
  if (!isTauri) return []

  try {
    return await invoke<ChromiumPasswordSource[]>('list_chromium_password_sources')
  } catch {
    return []
  }
}

/** Reads every saved password of one browser (all its profiles); there is no cap on how many. */
export async function importDefaultBrowserPasswords(browser: string): Promise<ImportedPassword[]> {
  if (!isTauri) return []

  try {
    return await invoke<ImportedPassword[]>('import_default_browser_passwords', {
      browser,
    })
  } catch (error) {
    throw new Error(invokeErrorMessage(error))
  }
}
