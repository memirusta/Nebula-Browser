import type { NebulaLocale } from './locale'

const messages: Record<NebulaLocale, { title: string; protection: string; general: string }> = {
  tr: { title: 'Sayfa açılamadı', protection: 'Reklam engelleme koruması başlatılamadığı için sayfa açılamadı. Nebula’yı yeniden başlatıp tekrar deneyin.', general: 'Sayfa başlatılamadı. Tekrar deneyin.' },
  en: { title: 'Could not open page', protection: 'The page could not open because ad-blocking protection failed to start. Restart Nebula and try again.', general: 'The page could not start. Please try again.' },
  es: { title: 'No se pudo abrir la página', protection: 'La página no se pudo abrir porque no se inició la protección contra anuncios. Reinicia Nebula e inténtalo de nuevo.', general: 'No se pudo iniciar la página. Inténtalo de nuevo.' },
  de: { title: 'Seite konnte nicht geöffnet werden', protection: 'Die Seite konnte nicht geöffnet werden, weil der Werbeschutz nicht gestartet wurde. Starte Nebula neu und versuche es erneut.', general: 'Die Seite konnte nicht gestartet werden. Versuche es erneut.' },
  fr: { title: 'Impossible d’ouvrir la page', protection: 'La page n’a pas pu s’ouvrir car la protection contre les publicités n’a pas démarré. Redémarrez Nebula et réessayez.', general: 'La page n’a pas pu démarrer. Réessayez.' },
  id: { title: 'Halaman tidak dapat dibuka', protection: 'Halaman tidak dapat dibuka karena perlindungan pemblokiran iklan gagal dimulai. Mulai ulang Nebula dan coba lagi.', general: 'Halaman tidak dapat dimulai. Coba lagi.' },
  ru: { title: 'Не удалось открыть страницу', protection: 'Страница не открылась, поскольку не удалось запустить блокировку рекламы. Перезапустите Nebula и повторите попытку.', general: 'Не удалось запустить страницу. Повторите попытку.' },
  it: { title: 'Impossibile aprire la pagina', protection: 'La pagina non si è aperta perché la protezione dagli annunci non si è avviata. Riavvia Nebula e riprova.', general: 'Impossibile avviare la pagina. Riprova.' },
  ja: { title: 'ページを開けませんでした', protection: '広告ブロック保護を開始できなかったため、ページを開けませんでした。Nebulaを再起動して、もう一度お試しください。', general: 'ページを開始できませんでした。もう一度お試しください。' },
}

export function nativeTabFailureMessage(detail: unknown, locale: NebulaLocale) {
  const record = typeof detail === 'object' && detail !== null
    ? detail as Record<string, unknown> : {}
  const error = [record.errorMessage, record.errorValue]
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
    ?.slice(0, 1000) ?? ''
  const copy = messages[locale]
  const explanation = /ublock|ubol/i.test(error) ? copy.protection : copy.general
  return { title: copy.title, message: error ? `${explanation}\n\n${error}` : explanation }
}
