/**
 * The words of the retry without protections (see compatibilityTrial.ts), in the nine languages. `{host}` is the site.
 * Kept free of imports so tests can read it as it is.
 */
export interface SiteCompatibilityCopy {
  /** Asked after the site loaded with the protections off. */
  worked: string
  keepOff: string
  backOn: string
  /** Said when it did not load even without them. */
  didNotHelp: string
}

const COPY: Record<string, SiteCompatibilityCopy> = {
  en: {
    worked: '{host} loaded with the protections off. Keep them off for this site?',
    keepOff: 'Keep them off',
    backOn: 'Turn them back on',
    didNotHelp: '{host} could not be reached even with the protections off, so they stay on. The cause is most likely the network or the site itself.',
  },
  tr: {
    worked: '{host} korumalar kapalıyken açıldı. Bu site için kapalı kalsın mı?',
    keepOff: 'Kapalı kalsın',
    backOn: 'Geri aç',
    didNotHelp: '{host} korumalar kapalıyken de açılamadı, bu yüzden korumalar açık kaldı. Sebep büyük ihtimalle ağ ya da sitenin kendisi.',
  },
  es: {
    worked: '{host} se cargó con las protecciones desactivadas. ¿Mantenerlas desactivadas para este sitio?',
    keepOff: 'Mantener desactivadas',
    backOn: 'Volver a activarlas',
    didNotHelp: '{host} tampoco se pudo alcanzar sin las protecciones, así que siguen activadas. La causa es muy probablemente la red o el propio sitio.',
  },
  de: {
    worked: '{host} wurde mit ausgeschaltetem Schutz geladen. Soll er für diese Website ausgeschaltet bleiben?',
    keepOff: 'Ausgeschaltet lassen',
    backOn: 'Wieder einschalten',
    didNotHelp: '{host} war auch ohne Schutz nicht erreichbar, deshalb bleibt er eingeschaltet. Die Ursache ist sehr wahrscheinlich das Netzwerk oder die Website selbst.',
  },
  fr: {
    worked: "{host} s'est chargé avec les protections désactivées. Les laisser désactivées pour ce site ?",
    keepOff: 'Les laisser désactivées',
    backOn: 'Les réactiver',
    didNotHelp: "{host} est resté inaccessible même sans les protections, elles restent donc activées. La cause est très probablement le réseau ou le site lui-même.",
  },
  id: {
    worked: '{host} termuat dengan perlindungan dimatikan. Biarkan tetap mati untuk situs ini?',
    keepOff: 'Biarkan mati',
    backOn: 'Nyalakan lagi',
    didNotHelp: '{host} tetap tidak dapat dijangkau meski perlindungan dimatikan, jadi perlindungan tetap menyala. Penyebabnya kemungkinan besar jaringan atau situsnya sendiri.',
  },
  ru: {
    worked: '{host} загрузился с отключённой защитой. Оставить её отключённой для этого сайта?',
    keepOff: 'Оставить отключённой',
    backOn: 'Включить снова',
    didNotHelp: '{host} не открылся и без защиты, поэтому она остаётся включённой. Скорее всего, причина в сети или на самом сайте.',
  },
  it: {
    worked: '{host} si è caricato con le protezioni disattivate. Lasciarle disattivate per questo sito?',
    keepOff: 'Lascia disattivate',
    backOn: 'Riattivale',
    didNotHelp: "{host} non è raggiungibile nemmeno senza le protezioni, quindi restano attive. La causa è molto probabilmente la rete o il sito stesso.",
  },
  ja: {
    worked: '{host} は保護をオフにすると読み込めました。このサイトでは保護をオフのままにしますか？',
    keepOff: 'オフのままにする',
    backOn: 'オンに戻す',
    didNotHelp: '保護をオフにしても {host} に接続できなかったため、保護はオンのままです。原因はネットワークかサイト自体である可能性が高いです。',
  },
}

export const SITE_COMPATIBILITY_LANGUAGES = Object.keys(COPY)

export function siteCompatibilityCopy(locale: string, host: string): SiteCompatibilityCopy {
  const copy = COPY[locale] ?? COPY.en
  const fill = (text: string) => text.replace('{host}', host)
  return { worked: fill(copy.worked), keepOff: copy.keepOff, backOn: copy.backOn, didNotHelp: fill(copy.didNotHelp) }
}
