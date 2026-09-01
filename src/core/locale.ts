import { ES_LOCALE_MESSAGES } from './localeMessages.es'
import { DE_LOCALE_MESSAGES } from './localeMessages.de'
import {
  FR_LOCALE_MESSAGES,
  ID_LOCALE_MESSAGES,
  RU_LOCALE_MESSAGES,
} from './localeMessages.additional'
import { IT_LOCALE_MESSAGES, JA_LOCALE_MESSAGES } from './localeMessages.it-ja'

export const SUPPORTED_LOCALES = ['tr', 'en', 'es', 'de', 'fr', 'id', 'ru', 'it', 'ja'] as const

export type NebulaLocale = (typeof SUPPORTED_LOCALES)[number]

export const LOCALE_OPTIONS: ReadonlyArray<{
  value: NebulaLocale
  nativeLabel: string
  intlLocale: string
}> = [
  { value: 'en', nativeLabel: 'English', intlLocale: 'en-US' },
  { value: 'tr', nativeLabel: 'Türkçe', intlLocale: 'tr-TR' },
  { value: 'es', nativeLabel: 'Español', intlLocale: 'es-ES' },
  { value: 'de', nativeLabel: 'Deutsch', intlLocale: 'de-DE' },
  { value: 'fr', nativeLabel: 'Français', intlLocale: 'fr-FR' },
  { value: 'id', nativeLabel: 'Bahasa Indonesia', intlLocale: 'id-ID' },
  { value: 'ru', nativeLabel: 'Русский', intlLocale: 'ru-RU' },
  { value: 'it', nativeLabel: 'Italiano', intlLocale: 'it-IT' },
  { value: 'ja', nativeLabel: '日本語', intlLocale: 'ja-JP' },
]

export const LOCALE_STORAGE_KEY = 'nebula-locale-v1'

export { LOCALE_MESSAGES, type LocaleMessageKey } from './localeMessages'
import { LOCALE_MESSAGES, type LocaleMessageKey } from './localeMessages'

export function isNebulaLocale(value: unknown): value is NebulaLocale {
  return typeof value === 'string' && SUPPORTED_LOCALES.includes(value as NebulaLocale)
}

export function normalizeLocale(value: string | null | undefined): NebulaLocale {
  const language = value?.trim().toLowerCase().replace('_', '-') ?? ''
  if (language.startsWith('tr')) return 'tr'
  if (language.startsWith('es')) return 'es'
  if (language.startsWith('de')) return 'de'
  if (language.startsWith('fr')) return 'fr'
  if (language.startsWith('id')) return 'id'
  if (language.startsWith('ru')) return 'ru'
  if (language.startsWith('it')) return 'it'
  if (language.startsWith('ja')) return 'ja'
  return 'en'
}

export function detectDefaultLocale(): NebulaLocale {
  try {
    return normalizeLocale(navigator.languages?.[0] ?? navigator.language)
  } catch {
    return 'en'
  }
}

export function loadLocale(): NebulaLocale {
  try {
    const raw = localStorage.getItem(LOCALE_STORAGE_KEY)
    if (isNebulaLocale(raw)) return raw
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
  if (locale === 'es') return ES_LOCALE_MESSAGES[key]
  if (locale === 'de') return DE_LOCALE_MESSAGES[key]
  if (locale === 'fr') return FR_LOCALE_MESSAGES[key]
  if (locale === 'id') return ID_LOCALE_MESSAGES[key]
  if (locale === 'ru') return RU_LOCALE_MESSAGES[key]
  if (locale === 'it') return IT_LOCALE_MESSAGES[key]
  if (locale === 'ja') return JA_LOCALE_MESSAGES[key]
  return LOCALE_MESSAGES[key][locale]
}

export function getIntlLocale(locale: NebulaLocale): string {
  return LOCALE_OPTIONS.find((option) => option.value === locale)?.intlLocale ?? 'en-US'
}

type WidenLocaleCopy<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => R
    : T[K] extends string
      ? string
      : T[K]
}

export function getLocaleCopy<T extends Record<string, unknown>>(
  copy: Readonly<{ en: T } & Record<NebulaLocale, WidenLocaleCopy<T>>>,
  locale: NebulaLocale,
): WidenLocaleCopy<T> {
  return copy[locale]
}

/** Replace `{name}` placeholders in translated strings. */
export function tf(locale: NebulaLocale, key: LocaleMessageKey, vars: Record<string, string | number>): string {
  let text = t(locale, key)
  for (const [name, value] of Object.entries(vars)) {
    text = text.replaceAll(`{${name}}`, String(value))
  }
  return text
}
