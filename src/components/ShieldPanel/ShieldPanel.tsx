import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import type { SiteInfoStatePayload } from '../../core/nebulaBridge'
import { getLocaleCopy } from '../../core/locale'
import { useLocale } from '../../hooks/useLocale'
import { useDialogFocusTrap } from '../../hooks/useDialogFocusTrap'
import { EMPTY_SHIELD_PAGE_SUMMARY } from '../../core/shieldSummary'
import { ShieldIcon } from './ShieldIcon'
import { SiteInfoPanel } from '../SiteInfoPanel/SiteInfoPanel'
import styles from './ShieldPanel.module.css'
import floatingPanel from '../../styles/floatingPanel.module.css'

/** What the person turned on in the settings, as far as the panel tells it. */
export interface ShieldPanelProtections {
  shield: boolean
  ads: boolean
  trackers: boolean
  malware: boolean
  fingerprint: boolean
}

/** One panel for what the shield does on this page (its first tab) and what the site may do (the second: the site's connection, permissions, darkening). */
interface ShieldPanelProps {
  state: SiteInfoStatePayload
  favicon?: string
  top: number
  usage: { camera: boolean; microphone: boolean; location: boolean; screen: boolean }
  protections: ShieldPanelProtections
  onClose: () => void
  /** The switch of this site: protections on it off or on again. */
  onToggleSite: () => void
  onOpenSettings: () => void
  onSetDarkening: (mode: 'default' | 'off' | 'always') => void
  onSetNotificationPermission: (permission: 'allow' | 'block' | null) => void
  onResetPermissions: () => void
  onClearSiteData: () => void
}

type Tab = 'shield' | 'site'

const COPY = {
  tr: {
    title: 'Nebula Shield',
    statusOn: 'Bu sitede koruma açık',
    statusSiteOff: 'Bu sitede koruma kapalı',
    statusOff: 'Shield kapalı',
    blockedOnPage: 'bu sayfada engellendi',
    ads: 'Reklamlar',
    trackers: 'İzleyiciler',
    mostBlocked: 'En çok engellenen',
    nothingYet: 'Bu sayfada şimdilik hiçbir şey engellenmedi',
    siteSwitch: 'Bu sitede korumalar',
    siteSwitchHint: 'Kapatırsan reklam, izleyici ve zararlı site denetimi bu sitede çalışmaz',
    fingerprint: 'Parmak izi koruması',
    malware: 'Zararlı site denetimi',
    on: 'Açık',
    off: 'Kapalı',
    settings: 'Shield ayarları',
    offHint: 'Nebula Shield ayarlardan kapatılmış',
    close: 'Kapat',
    tabShield: 'Shield',
    tabSite: 'Site',
  },
  en: {
    title: 'Nebula Shield',
    statusOn: 'Protection is on for this site',
    statusSiteOff: 'Protection is off for this site',
    statusOff: 'Shield is off',
    blockedOnPage: 'blocked on this page',
    ads: 'Ads',
    trackers: 'Trackers',
    mostBlocked: 'Blocked most',
    nothingYet: 'Nothing has been blocked on this page yet',
    siteSwitch: 'Protections on this site',
    siteSwitchHint: 'Turn it off and ads, trackers and the malware check stop working on this site',
    fingerprint: 'Fingerprint protection',
    malware: 'Malware check',
    on: 'On',
    off: 'Off',
    settings: 'Shield settings',
    offHint: 'Nebula Shield is turned off in the settings',
    close: 'Close',
    tabShield: 'Shield',
    tabSite: 'Site',
  },
  es: {
    title: 'Nebula Shield',
    statusOn: 'Protección activada en este sitio',
    statusSiteOff: 'Protección desactivada en este sitio',
    statusOff: 'Shield desactivado',
    blockedOnPage: 'bloqueado en esta página',
    ads: 'Anuncios',
    trackers: 'Rastreadores',
    mostBlocked: 'Más bloqueado',
    nothingYet: 'Aún no se ha bloqueado nada en esta página',
    siteSwitch: 'Protecciones en este sitio',
    siteSwitchHint: 'Si lo desactivas, los anuncios, los rastreadores y la comprobación de malware dejan de funcionar en este sitio',
    fingerprint: 'Protección contra huella digital',
    malware: 'Comprobación de malware',
    on: 'Activado',
    off: 'Desactivado',
    settings: 'Ajustes de Shield',
    offHint: 'Nebula Shield está desactivado en los ajustes',
    close: 'Cerrar',
    tabShield: 'Shield',
    tabSite: 'Sitio',
  },
  de: {
    title: 'Nebula Shield',
    statusOn: 'Schutz ist für diese Website aktiv',
    statusSiteOff: 'Schutz ist für diese Website aus',
    statusOff: 'Shield ist aus',
    blockedOnPage: 'auf dieser Seite blockiert',
    ads: 'Werbung',
    trackers: 'Tracker',
    mostBlocked: 'Am häufigsten blockiert',
    nothingYet: 'Auf dieser Seite wurde noch nichts blockiert',
    siteSwitch: 'Schutz auf dieser Website',
    siteSwitchHint: 'Wenn du ihn ausschaltest, funktionieren Werbe-, Tracker- und Malware-Schutz auf dieser Website nicht mehr',
    fingerprint: 'Fingerprint-Schutz',
    malware: 'Malware-Prüfung',
    on: 'An',
    off: 'Aus',
    settings: 'Shield-Einstellungen',
    offHint: 'Nebula Shield ist in den Einstellungen ausgeschaltet',
    close: 'Schließen',
    tabShield: 'Shield',
    tabSite: 'Website',
  },
  fr: {
    title: 'Nebula Shield',
    statusOn: 'La protection est activée sur ce site',
    statusSiteOff: 'La protection est désactivée sur ce site',
    statusOff: 'Shield est désactivé',
    blockedOnPage: 'bloqué sur cette page',
    ads: 'Publicités',
    trackers: 'Traqueurs',
    mostBlocked: 'Les plus bloqués',
    nothingYet: 'Rien n’a encore été bloqué sur cette page',
    siteSwitch: 'Protections sur ce site',
    siteSwitchHint: 'Si vous la désactivez, les publicités, les traqueurs et la vérification des logiciels malveillants ne fonctionnent plus sur ce site',
    fingerprint: 'Protection contre le fingerprinting',
    malware: 'Vérification des logiciels malveillants',
    on: 'Activé',
    off: 'Désactivé',
    settings: 'Réglages de Shield',
    offHint: 'Nebula Shield est désactivé dans les réglages',
    close: 'Fermer',
    tabShield: 'Shield',
    tabSite: 'Site',
  },
  id: {
    title: 'Nebula Shield',
    statusOn: 'Perlindungan aktif untuk situs ini',
    statusSiteOff: 'Perlindungan nonaktif untuk situs ini',
    statusOff: 'Shield nonaktif',
    blockedOnPage: 'diblokir di halaman ini',
    ads: 'Iklan',
    trackers: 'Pelacak',
    mostBlocked: 'Paling banyak diblokir',
    nothingYet: 'Belum ada yang diblokir di halaman ini',
    siteSwitch: 'Perlindungan di situs ini',
    siteSwitchHint: 'Jika dimatikan, iklan, pelacak, dan pemeriksaan malware tidak berfungsi di situs ini',
    fingerprint: 'Perlindungan sidik jari',
    malware: 'Pemeriksaan malware',
    on: 'Aktif',
    off: 'Nonaktif',
    settings: 'Pengaturan Shield',
    offHint: 'Nebula Shield dimatikan di pengaturan',
    close: 'Tutup',
    tabShield: 'Shield',
    tabSite: 'Situs',
  },
  ru: {
    title: 'Nebula Shield',
    statusOn: 'Защита включена для этого сайта',
    statusSiteOff: 'Защита отключена для этого сайта',
    statusOff: 'Shield выключен',
    blockedOnPage: 'заблокировано на этой странице',
    ads: 'Реклама',
    trackers: 'Трекеры',
    mostBlocked: 'Больше всего блокировок',
    nothingYet: 'На этой странице пока ничего не заблокировано',
    siteSwitch: 'Защита на этом сайте',
    siteSwitchHint: 'Если отключить, реклама, трекеры и проверка на вредоносные сайты перестанут работать на этом сайте',
    fingerprint: 'Защита от отпечатков',
    malware: 'Проверка на вредоносные сайты',
    on: 'Вкл',
    off: 'Выкл',
    settings: 'Настройки Shield',
    offHint: 'Nebula Shield выключен в настройках',
    close: 'Закрыть',
    tabShield: 'Shield',
    tabSite: 'Сайт',
  },
  it: {
    title: 'Nebula Shield',
    statusOn: 'La protezione è attiva su questo sito',
    statusSiteOff: 'La protezione è disattivata su questo sito',
    statusOff: 'Shield è disattivato',
    blockedOnPage: 'bloccati in questa pagina',
    ads: 'Pubblicità',
    trackers: 'Tracker',
    mostBlocked: 'Più bloccati',
    nothingYet: 'In questa pagina non è stato ancora bloccato nulla',
    siteSwitch: 'Protezioni su questo sito',
    siteSwitchHint: 'Se la disattivi, pubblicità, tracker e controllo malware smettono di funzionare su questo sito',
    fingerprint: 'Protezione dal fingerprinting',
    malware: 'Controllo malware',
    on: 'Attivo',
    off: 'Disattivato',
    settings: 'Impostazioni di Shield',
    offHint: 'Nebula Shield è disattivato nelle impostazioni',
    close: 'Chiudi',
    tabShield: 'Shield',
    tabSite: 'Sito',
  },
  ja: {
    title: 'Nebula Shield',
    statusOn: 'このサイトでは保護がオンです',
    statusSiteOff: 'このサイトでは保護がオフです',
    statusOff: 'Shield はオフです',
    blockedOnPage: 'このページでブロックしました',
    ads: '広告',
    trackers: 'トラッカー',
    mostBlocked: 'ブロックが多い順',
    nothingYet: 'このページではまだ何もブロックしていません',
    siteSwitch: 'このサイトの保護',
    siteSwitchHint: 'オフにすると、このサイトでは広告・トラッカー・マルウェアのチェックが働きません',
    fingerprint: 'フィンガープリント対策',
    malware: 'マルウェアのチェック',
    on: 'オン',
    off: 'オフ',
    settings: 'Shield の設定',
    offHint: 'Nebula Shield は設定でオフになっています',
    close: '閉じる',
    tabShield: 'Shield',
    tabSite: 'サイト',
  },
} as const

export function ShieldPanel({
  state,
  favicon,
  top,
  usage,
  protections,
  onClose,
  onToggleSite,
  onOpenSettings,
  onSetDarkening,
  onSetNotificationPermission,
  onResetPermissions,
  onClearSiteData,
}: ShieldPanelProps) {
  const { locale } = useLocale()
  const copy = getLocaleCopy(COPY, locale)
  const panelRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ shield: null, site: null })
  const [tab, setTab] = useState<Tab>('shield')
  useDialogFocusTrap({ active: true, containerRef: panelRef, initialFocusRef: closeRef, onEscape: onClose })
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) onClose()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [onClose])

  const summary = state.shieldSummary ?? EMPTY_SHIELD_PAGE_SUMMARY
  const shieldOff = !protections.shield
  const siteOff = !shieldOff && state.protectionDisabled
  const working = !shieldOff && !siteOff
  const status = shieldOff ? copy.statusOff : siteOff ? copy.statusSiteOff : copy.statusOn
  const most = Math.max(1, ...summary.top.map((site) => site.count))
  const adsShare = summary.total > 0 ? summary.ads / summary.total : 0

  const protectionRows: Array<[string, boolean]> = [
    [copy.fingerprint, protections.fingerprint],
    [copy.malware, protections.malware],
  ]

  // Arrow keys move between the tabs, as on any tab list; only the tab that is shown is in the tab order.
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    const next: Tab = event.key === 'ArrowLeft' || event.key === 'Home' ? 'shield' : 'site'
    setTab(next)
    tabRefs.current[next]?.focus()
  }

  return (
    <section
      ref={panelRef}
      className={[styles.panel, floatingPanel.viewportBound].join(' ')}
      style={{ '--panel-preferred-top': `${top}px`, '--panel-height': '1100px' } as CSSProperties}
      role="dialog"
      aria-modal="true"
      aria-labelledby="nebula-shield-title"
      tabIndex={-1}
    >
      <header className={styles.header}>
        <span className={[styles.badge, working ? '' : styles.badgeOff].join(' ')} aria-hidden="true">
          {favicon && tab === 'site' ? <img className={styles.badgeIcon} src={favicon} alt="" /> : <ShieldIcon off={!working} />}
        </span>
        <span className={styles.identity}>
          <strong id="nebula-shield-title">{state.hostname}</strong>
          <span className={working ? styles.statusOn : styles.statusOff}>{status}</span>
        </span>
        <button ref={closeRef} type="button" className={styles.close} onClick={onClose} aria-label={copy.close}>
          ×
        </button>
      </header>

      <div className={styles.tabs} role="tablist">
        {(['shield', 'site'] as const).map((name) => (
          <button
            key={name}
            ref={(element) => { tabRefs.current[name] = element }}
            type="button"
            role="tab"
            id={`nebula-shield-tab-${name}`}
            aria-selected={tab === name}
            aria-controls={`nebula-shield-tabpanel-${name}`}
            tabIndex={tab === name ? 0 : -1}
            className={[styles.tab, tab === name ? styles.tabActive : ''].join(' ')}
            onClick={() => setTab(name)}
            onKeyDown={onTabKeyDown}
          >
            {name === 'shield' ? copy.tabShield : copy.tabSite}
          </button>
        ))}
      </div>

      {tab === 'site' ? (
        <div role="tabpanel" id="nebula-shield-tabpanel-site" aria-labelledby="nebula-shield-tab-site" className={styles.tabpanel}>
          <SiteInfoPanel
            embedded
            state={state}
            favicon={favicon}
            top={top}
            usage={usage}
            onClose={onClose}
            onToggleProtection={onToggleSite}
            onSetDarkening={onSetDarkening}
            onSetNotificationPermission={onSetNotificationPermission}
            onResetPermissions={onResetPermissions}
            onClearSiteData={onClearSiteData}
          />
        </div>
      ) : (
        <div role="tabpanel" id="nebula-shield-tabpanel-shield" aria-labelledby="nebula-shield-tab-shield" className={styles.tabpanel}>
          {shieldOff ? (
            <p className={styles.offNote}>{copy.offHint}</p>
          ) : (
            <>
              <div className={[styles.counter, siteOff ? styles.counterOff : ''].join(' ')}>
                <strong className={styles.count} aria-live="polite">{summary.total.toLocaleString(locale)}</strong>
                <span className={styles.countLabel}>{copy.blockedOnPage}</span>
              </div>

              {summary.total > 0 && (
                <>
                  <div className={styles.split} role="img" aria-label={`${copy.ads} ${summary.ads}, ${copy.trackers} ${summary.trackers}`}>
                    <span className={styles.splitAds} style={{ width: `${Math.round(adsShare * 100)}%` }} />
                    <span className={styles.splitTrackers} style={{ width: `${100 - Math.round(adsShare * 100)}%` }} />
                  </div>
                  <div className={styles.kinds}>
                    <div className={styles.kind}>
                      <span className={styles.dotAds} aria-hidden="true" />
                      <span>{copy.ads}</span>
                      <strong>{summary.ads.toLocaleString(locale)}</strong>
                    </div>
                    <div className={styles.kind}>
                      <span className={styles.dotTrackers} aria-hidden="true" />
                      <span>{copy.trackers}</span>
                      <strong>{summary.trackers.toLocaleString(locale)}</strong>
                    </div>
                  </div>
                </>
              )}

              <div className={styles.sectionHeader}>
                <span>{copy.mostBlocked}</span>
              </div>
              {summary.top.length > 0 ? (
                <ul className={styles.sites}>
                  {summary.top.map((site) => (
                    <li key={site.host} className={styles.site}>
                      <span className={styles.siteBar} style={{ width: `${Math.max(6, Math.round((site.count / most) * 100))}%` }} aria-hidden="true" />
                      <span className={styles.siteName}>{site.host}</span>
                      <strong>{site.count.toLocaleString(locale)}</strong>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.empty}>{copy.nothingYet}</p>
              )}

              <button
                type="button"
                className={styles.siteSwitch}
                role="switch"
                aria-checked={!siteOff}
                onClick={onToggleSite}
              >
                <span className={styles.switchText}>
                  <strong>{copy.siteSwitch}</strong>
                  <small>{copy.siteSwitchHint}</small>
                </span>
                <span className={[styles.track, siteOff ? '' : styles.trackOn].join(' ')} aria-hidden="true">
                  <span className={styles.thumb} />
                </span>
              </button>

              <div className={styles.protections}>
                {protectionRows.map(([label, on]) => (
                  <div className={styles.protection} key={label}>
                    <span>{label}</span>
                    <strong className={on && !siteOff ? styles.good : styles.muted}>{on && !siteOff ? copy.on : copy.off}</strong>
                  </div>
                ))}
              </div>
            </>
          )}

          <footer className={styles.footer}>
            <button type="button" className={styles.settingsLink} onClick={onOpenSettings}>
              {copy.settings}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
            </button>
          </footer>
        </div>
      )}
    </section>
  )
}
