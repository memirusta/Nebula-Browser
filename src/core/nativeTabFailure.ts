import type { NebulaLocale } from './locale'

const messages: Record<NebulaLocale, { title: string; general: string }> = {
  tr: { title: 'Sayfa açılamadı', general: 'Sayfa başlatılamadı. Tekrar deneyin.' },
  en: { title: 'Could not open page', general: 'The page could not start. Please try again.' },
  es: { title: 'No se pudo abrir la página', general: 'No se pudo iniciar la página. Inténtalo de nuevo.' },
  de: { title: 'Seite konnte nicht geöffnet werden', general: 'Die Seite konnte nicht gestartet werden. Versuche es erneut.' },
  fr: { title: 'Impossible d’ouvrir la page', general: 'La page n’a pas pu démarrer. Réessayez.' },
  id: { title: 'Halaman tidak dapat dibuka', general: 'Halaman tidak dapat dimulai. Coba lagi.' },
  ru: { title: 'Не удалось открыть страницу', general: 'Не удалось запустить страницу. Повторите попытку.' },
  it: { title: 'Impossibile aprire la pagina', general: 'Impossibile avviare la pagina. Riprova.' },
  ja: { title: 'ページを開けませんでした', general: 'ページを開始できませんでした。もう一度お試しください。' },
}

export function nativeTabFailureMessage(detail: unknown, locale: NebulaLocale) {
  const record = typeof detail === 'object' && detail !== null
    ? detail as Record<string, unknown> : {}
  const error = [record.errorMessage, record.errorValue]
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
    ?.slice(0, 1000) ?? ''
  const copy = messages[locale]
  const explanation = copy.general
  return { title: copy.title, message: error ? `${explanation}\n\n${error}` : explanation }
}
