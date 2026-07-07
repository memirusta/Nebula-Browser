import { importDefaultBrowserPasswords, listChromiumPasswordSources } from '../platform/browserPasswordImport'
import type { ImportedPassword } from './passwordImport'
import { isTauri } from '../platform/runtime'

export interface PasswordSyncResult {
  ok: boolean
  count: number
  message: string
  needsCsv: boolean
  imported: ImportedPassword[]
}

export async function syncPasswordsFromBrowser(
  preferredBrowser = 'chrome',
): Promise<PasswordSyncResult> {
  if (!isTauri) {
    return {
      ok: false,
      count: 0,
      message: 'Şifre aktarımı masaüstü uygulamasında kullanılabilir.',
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
      message: 'Chrome veya Edge şifre veritabanı bulunamadı.',
      needsCsv: true,
      imported: [],
    }
  }

  try {
    const imported = await importDefaultBrowserPasswords(500, browser)
    return {
      ok: true,
      count: imported.length,
      message: `${imported.length} şifre aktarıldı.`,
      needsCsv: false,
      imported,
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : typeof error === 'string' ? error : 'Şifre aktarımı başarısız.'
    const needsCsv =
      message.includes('app-bound') ||
      message.includes('CSV') ||
      message.includes('Dışa aktar') ||
      message.includes('dışa aktar')
    return {
      ok: false,
      count: 0,
      message,
      needsCsv,
      imported: [],
    }
  }
}
