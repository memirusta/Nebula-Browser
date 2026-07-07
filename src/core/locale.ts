export type NebulaLocale = 'tr' | 'en'

export const LOCALE_STORAGE_KEY = 'nebula-locale-v1'

export { LOCALE_MESSAGES, type LocaleMessageKey } from './localeMessages'
import { LOCALE_MESSAGES, type LocaleMessageKey } from './localeMessages'

export function detectDefaultLocale(): NebulaLocale {
  try {
    if (navigator.language.toLowerCase().startsWith('tr')) return 'tr'
  } catch {
    // ignore
  }
  return 'en'
}

export function loadLocale(): NebulaLocale {
  try {
    const raw = localStorage.getItem(LOCALE_STORAGE_KEY)
    if (raw === 'tr' || raw === 'en') return raw
  } catch {
    // ignore
  }
  return detectDefaultLocale()
}

export function saveLocale(locale: NebulaLocale): void {
  localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  document.documentElement.lang = locale
}

export function applyDocumentLocale(locale: NebulaLocale = loadLocale()): void {
  document.documentElement.lang = locale
}

export function t(locale: NebulaLocale, key: LocaleMessageKey): string {
  return LOCALE_MESSAGES[key][locale]
}

/** Replace `{name}` placeholders in translated strings. */
export function tf(locale: NebulaLocale, key: LocaleMessageKey, vars: Record<string, string | number>): string {
  let text = t(locale, key)
  for (const [name, value] of Object.entries(vars)) {
    text = text.replaceAll(`{${name}}`, String(value))
  }
  return text
}
