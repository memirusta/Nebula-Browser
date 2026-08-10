import { invoke } from '@tauri-apps/api/core'
import type { ImportedPassword } from '../core/passwordImport'
import { isTauri } from './runtime'

export interface ChromiumPasswordSource {
  browser: string
  displayName: string
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

export async function importDefaultBrowserPasswords(
  limit = 200,
  browser: string,
): Promise<ImportedPassword[]> {
  if (!isTauri) return []

  try {
    return await invoke<ImportedPassword[]>('import_default_browser_passwords', {
      limit,
      browser,
    })
  } catch (error) {
    throw new Error(invokeErrorMessage(error))
  }
}
