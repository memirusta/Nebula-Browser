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

  const sources = await listChromiumPasswordSources()
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
    const imported = await importDefaultBrowserPasswords(500, browser)
    return {
      ok: true,
      count: imported.length,
      message: tf(locale, 'gsImportDone', { count: imported.length }),
      needsCsv: false,
      imported,
    }
  } catch (error) {
    const nativeMessage =
      error instanceof Error ? error.message : typeof error === 'string' ? error : ''
    const needsCsv =
      nativeMessage.includes('app-bound') ||
      nativeMessage.includes('CSV') ||
      nativeMessage.includes('Dışa aktar') ||
      nativeMessage.includes('dışa aktar')
    return {
      ok: false,
      count: 0,
      message: t(locale, needsCsv ? 'gsImportNeedsCsv' : 'gsImportFailed'),
      needsCsv,
      imported: [],
    }
  }
}
