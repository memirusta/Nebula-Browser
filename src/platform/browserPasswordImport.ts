import { invoke } from '@tauri-apps/api/core'
import type { ImportedPassword } from '../core/passwordImport'
import { isTauri } from './runtime'

export interface BrowserPasswordInfo {
  browser: string
  displayName: string
  passwordsAvailable: boolean
}

export interface ChromiumPasswordSource {
  browser: string
  displayName: string
}

export interface PasswordImportDiagnostics {
  browser: string
  displayName: string
  totalRows: number
  decryptable: number
  appBound: number
  failed: number
}

const UNKNOWN: BrowserPasswordInfo = {
  browser: 'unknown',
  displayName: 'Tarayıcı',
  passwordsAvailable: false,
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

export async function detectBrowserPasswords(): Promise<BrowserPasswordInfo> {
  if (!isTauri) return UNKNOWN

  try {
    return await invoke<BrowserPasswordInfo>('detect_browser_passwords')
  } catch {
    return UNKNOWN
  }
}

export async function inspectBrowserPasswords(
  browser: string,
): Promise<PasswordImportDiagnostics | null> {
  if (!isTauri) return null

  try {
    return await invoke<PasswordImportDiagnostics>('inspect_browser_passwords', {
      browser,
    })
  } catch {
    return null
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
