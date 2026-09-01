import { useEffect, useRef, useState } from 'react'
import type {
  SiteInfoStatePayload,
  SitePermissionState,
} from '../../core/nebulaBridge'
import { getLocaleCopy } from '../../core/locale'
import { useLocale } from '../../hooks/useLocale'
import { useModalFocusTrap } from '../../hooks/useModalFocusTrap'
import styles from './SiteInfoPanel.module.css'

interface SiteInfoPanelProps {
  state: SiteInfoStatePayload
  favicon?: string
  top: number
  usage: {
    camera: boolean
    microphone: boolean
    location: boolean
    screen: boolean
  }
  onClose: () => void
  onToggleProtection: () => void
  onSetDarkening: (mode: 'default' | 'off' | 'always') => void
  onSetNotificationPermission: (
    permission: 'allow' | 'block' | null,
  ) => void
  onResetPermissions: () => void
  onClearSiteData: () => void
}

type PermissionName = 'camera' | 'microphone' | 'location' | 'screen'

const COPY = {
  tr: {
    inUse: 'Şu anda kullanılıyor',
    allowed: 'İzin verildi',
    blocked: 'Engellendi',
    ask: 'Sorulacak',
    unsupported: 'Desteklenmiyor',
    camera: 'Kamera',
    microphone: 'Mikrofon',
    location: 'Konum',
    screenSharing: 'Ekran paylaşımı',
    subtitle: 'Site bilgileri ve izinler',
    close: 'Kapat',
    secure: 'Bağlantı güvenli',
    notSecure: 'Bağlantı güvenli değil',
    protection: 'Site koruması',
    off: 'Kapalı',
    on: 'Açık',
    enableProtection: 'Bu sitede korumaları aç',
    disableProtection: 'Bu sitede korumaları kapat',
    protectionHint: 'Takipçi, çerez bannerı ve gizlilik korumaları',
    darkening: 'Sayfa koyulaştırma',
    default: 'Varsayılan',
    always: 'Her zaman',
    permissions: 'İzinler',
    canAsk: 'Sorabilir',
    notifications: 'Bildirimler',
    allow: 'İzin ver',
    block: 'Engelle',
    resetPermissions: 'İzinleri sıfırla',
    clearDataConfirm: 'Tekrar tıkla: verileri temizle',
    clearSiteData: 'Site verilerini temizle',
  },
  en: {
    inUse: 'In use now',
    allowed: 'Allowed',
    blocked: 'Blocked',
    ask: 'Ask',
    unsupported: 'Unsupported',
    camera: 'Camera',
    microphone: 'Microphone',
    location: 'Location',
    screenSharing: 'Screen sharing',
    subtitle: 'Site information and permissions',
    close: 'Close',
    secure: 'Connection is secure',
    notSecure: 'Connection is not secure',
    protection: 'Site protection',
    off: 'Off',
    on: 'On',
    enableProtection: 'Enable protections on this site',
    disableProtection: 'Disable protections on this site',
    protectionHint: 'Tracker, cookie banner, and privacy protections',
    darkening: 'Page darkening',
    default: 'Default',
    always: 'Always',
    permissions: 'Permissions',
    canAsk: 'Can ask',
    notifications: 'Notifications',
    allow: 'Allow',
    block: 'Block',
    resetPermissions: 'Reset permissions',
    clearDataConfirm: 'Click again to clear data',
    clearSiteData: 'Clear site data',
  },
  es: {
    inUse: 'En uso ahora',
    allowed: 'Permitido',
    blocked: 'Bloqueado',
    ask: 'Preguntar',
    unsupported: 'No compatible',
    camera: 'Cámara',
    microphone: 'Micrófono',
    location: 'Ubicación',
    screenSharing: 'Compartir pantalla',
    subtitle: 'Información y permisos del sitio',
    close: 'Cerrar',
    secure: 'La conexión es segura',
    notSecure: 'La conexión no es segura',
    protection: 'Protección del sitio',
    off: 'Desactivado',
    on: 'Activado',
    enableProtection: 'Activar las protecciones en este sitio',
    disableProtection: 'Desactivar las protecciones en este sitio',
    protectionHint: 'Protecciones contra rastreadores, banners de cookies y riesgos de privacidad',
    darkening: 'Oscurecimiento de páginas',
    default: 'Predeterminado',
    always: 'Siempre',
    permissions: 'Permisos',
    canAsk: 'Puede preguntar',
    notifications: 'Notificaciones',
    allow: 'Permitir',
    block: 'Bloquear',
    resetPermissions: 'Restablecer permisos',
    clearDataConfirm: 'Haz clic de nuevo para borrar los datos',
    clearSiteData: 'Borrar datos del sitio',
  },
  de: {
    inUse: 'Wird gerade verwendet',
    allowed: 'Zugelassen',
    blocked: 'Blockiert',
    ask: 'Nachfragen',
    unsupported: 'Nicht unterstützt',
    camera: 'Kamera',
    microphone: 'Mikrofon',
    location: 'Standort',
    screenSharing: 'Bildschirmfreigabe',
    subtitle: 'Websiteinformationen und Berechtigungen',
    close: 'Schließen',
    secure: 'Verbindung ist sicher',
    notSecure: 'Verbindung ist nicht sicher',
    protection: 'Website-Schutz',
    off: 'Aus',
    on: 'Ein',
    enableProtection: 'Schutz auf dieser Website aktivieren',
    disableProtection: 'Schutz auf dieser Website deaktivieren',
    protectionHint: 'Tracker-, Cookie-Banner- und Datenschutzschutz',
    darkening: 'Seite abdunkeln',
    default: 'Standard',
    always: 'Immer',
    permissions: 'Berechtigungen',
    canAsk: 'Kann nachfragen',
    notifications: 'Benachrichtigungen',
    allow: 'Zulassen',
    block: 'Blockieren',
    resetPermissions: 'Berechtigungen zurücksetzen',
    clearDataConfirm: 'Zum Löschen der Daten erneut klicken',
    clearSiteData: 'Websitedaten löschen',
  },
  fr: {
    inUse: 'Utilisé actuellement',
    allowed: 'Autorisé',
    blocked: 'Bloqué',
    ask: 'Demander',
    unsupported: 'Non pris en charge',
    camera: 'Caméra',
    microphone: 'Microphone',
    location: 'Localisation',
    screenSharing: 'Partage d’écran',
    subtitle: 'Informations et autorisations du site',
    close: 'Fermer',
    secure: 'La connexion est sécurisée',
    notSecure: 'La connexion n’est pas sécurisée',
    protection: 'Protection du site',
    off: 'Désactivée',
    on: 'Activée',
    enableProtection: 'Activer les protections sur ce site',
    disableProtection: 'Désactiver les protections sur ce site',
    protectionHint: 'Protections contre les traqueurs, les bannières de cookies et les atteintes à la vie privée',
    darkening: 'Assombrissement de la page',
    default: 'Par défaut',
    always: 'Toujours',
    permissions: 'Autorisations',
    canAsk: 'Peut demander',
    notifications: 'Notifications',
    allow: 'Autoriser',
    block: 'Bloquer',
    resetPermissions: 'Réinitialiser les autorisations',
    clearDataConfirm: 'Cliquez à nouveau pour effacer les données',
    clearSiteData: 'Effacer les données du site',
  },
  id: {
    inUse: 'Sedang digunakan',
    allowed: 'Diizinkan',
    blocked: 'Diblokir',
    ask: 'Tanya',
    unsupported: 'Tidak didukung',
    camera: 'Kamera',
    microphone: 'Mikrofon',
    location: 'Lokasi',
    screenSharing: 'Berbagi layar',
    subtitle: 'Informasi dan izin situs',
    close: 'Tutup',
    secure: 'Koneksi aman',
    notSecure: 'Koneksi tidak aman',
    protection: 'Perlindungan situs',
    off: 'Nonaktif',
    on: 'Aktif',
    enableProtection: 'Aktifkan perlindungan di situs ini',
    disableProtection: 'Nonaktifkan perlindungan di situs ini',
    protectionHint: 'Perlindungan pelacak, banner cookie, dan privasi',
    darkening: 'Penggelapan halaman',
    default: 'Bawaan',
    always: 'Selalu',
    permissions: 'Izin',
    canAsk: 'Dapat meminta',
    notifications: 'Notifikasi',
    allow: 'Izinkan',
    block: 'Blokir',
    resetPermissions: 'Atur ulang izin',
    clearDataConfirm: 'Klik lagi untuk menghapus data',
    clearSiteData: 'Hapus data situs',
  },
  ru: {
    inUse: 'Используется сейчас',
    allowed: 'Разрешено',
    blocked: 'Заблокировано',
    ask: 'Спрашивать',
    unsupported: 'Не поддерживается',
    camera: 'Камера',
    microphone: 'Микрофон',
    location: 'Местоположение',
    screenSharing: 'Демонстрация экрана',
    subtitle: 'Сведения о сайте и разрешения',
    close: 'Закрыть',
    secure: 'Соединение защищено',
    notSecure: 'Соединение не защищено',
    protection: 'Защита сайта',
    off: 'Выкл.',
    on: 'Вкл.',
    enableProtection: 'Включить защиту на этом сайте',
    disableProtection: 'Отключить защиту на этом сайте',
    protectionHint: 'Защита от трекеров, баннеров cookie и угроз конфиденциальности',
    darkening: 'Затемнение страницы',
    default: 'По умолчанию',
    always: 'Всегда',
    permissions: 'Разрешения',
    canAsk: 'Может запросить',
    notifications: 'Уведомления',
    allow: 'Разрешить',
    block: 'Блокировать',
    resetPermissions: 'Сбросить разрешения',
    clearDataConfirm: 'Нажмите ещё раз, чтобы удалить данные',
    clearSiteData: 'Удалить данные сайта',
  },
  it: {
    inUse: 'In uso ora',
    allowed: 'Consentito',
    blocked: 'Bloccato',
    ask: 'Chiedi',
    unsupported: 'Non supportato',
    camera: 'Fotocamera',
    microphone: 'Microfono',
    location: 'Posizione',
    screenSharing: 'Condivisione schermo',
    subtitle: 'Informazioni e autorizzazioni del sito',
    close: 'Chiudi',
    secure: 'Connessione sicura',
    notSecure: 'Connessione non sicura',
    protection: 'Protezione sito',
    off: 'Disattivata',
    on: 'Attiva',
    enableProtection: 'Attiva le protezioni su questo sito',
    disableProtection: 'Disattiva le protezioni su questo sito',
    protectionHint: 'Protezione da tracker, banner dei cookie e rischi per la privacy',
    darkening: 'Oscuramento pagina',
    default: 'Predefinito',
    always: 'Sempre',
    permissions: 'Autorizzazioni',
    canAsk: 'Può chiedere',
    notifications: 'Notifiche',
    allow: 'Consenti',
    block: 'Blocca',
    resetPermissions: 'Reimposta autorizzazioni',
    clearDataConfirm: 'Fai di nuovo clic per cancellare i dati',
    clearSiteData: 'Cancella dati del sito',
  },
  ja: {
    inUse: '現在使用中',
    allowed: '許可済み',
    blocked: 'ブロック済み',
    ask: '確認する',
    unsupported: '未対応',
    camera: 'カメラ',
    microphone: 'マイク',
    location: '位置情報',
    screenSharing: '画面共有',
    subtitle: 'サイト情報と権限',
    close: '閉じる',
    secure: '接続は保護されています',
    notSecure: '接続は保護されていません',
    protection: 'サイト保護',
    off: 'オフ',
    on: 'オン',
    enableProtection: 'このサイトで保護を有効にする',
    disableProtection: 'このサイトで保護を無効にする',
    protectionHint: 'トラッカー、Cookie バナー、プライバシー保護',
    darkening: 'ページを暗くする',
    default: '既定',
    always: '常に',
    permissions: '権限',
    canAsk: '確認可能',
    notifications: '通知',
    allow: '許可',
    block: 'ブロック',
    resetPermissions: '権限をリセット',
    clearDataConfirm: 'もう一度クリックしてデータを消去',
    clearSiteData: 'サイトデータを消去',
  },
} as const

function PermissionIcon({ name }: { name: PermissionName }) {
  if (name === 'camera') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 7.5h11a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2Zm13 3 4-2v7l-4-2" />
      </svg>
    )
  }
  if (name === 'microphone') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="8" y="3" width="8" height="12" rx="4" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
      </svg>
    )
  }
  if (name === 'screen') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="4" width="18" height="13" rx="2" />
        <path d="M8 21h8M12 17v4M9 10l3-3 3 3M12 7v7" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 21s7-5.2 7-12a7 7 0 1 0-14 0c0 6.8 7 12 7 12Z" />
      <circle cx="12" cy="9" r="2.4" />
    </svg>
  )
}

export function SiteInfoPanel({
  state,
  favicon,
  top,
  usage,
  onClose,
  onToggleProtection,
  onSetDarkening,
  onSetNotificationPermission,
  onResetPermissions,
  onClearSiteData,
}: SiteInfoPanelProps) {
  const { locale } = useLocale()
  const copy = getLocaleCopy(COPY, locale)
  const panelRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [resolvedTop, setResolvedTop] = useState(top)
  const secure = state.url?.startsWith('https://') === true
  useModalFocusTrap(panelRef, true)
  
  useEffect(() => {
  const panel =
    panelRef.current

  if (!panel) {
    return
  }

  const updatePosition = () => {
    const height =
      panel.getBoundingClientRect().height

    const maxTop =
      window.innerHeight -
      height -
      12

    setResolvedTop(
      Math.max(
        12,
        Math.min(top, maxTop),
      ),
    )
  }

  updatePosition()

  const observer =
    new ResizeObserver(
      updatePosition,
    )

  observer.observe(panel)

  window.addEventListener(
    'resize',
    updatePosition,
  )

  return () => {
    observer.disconnect()

    window.removeEventListener(
      'resize',
      updatePosition,
    )
  }
}, [top])
  
  useEffect(() => {
    closeRef.current?.focus()
    const onPointerDown = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [onClose])

  const permissionLabel = (
    name: PermissionName,
    stateValue: SitePermissionState,
  ) => {
    if (usage[name]) return copy.inUse
    if (stateValue === 'granted') return copy.allowed
    if (stateValue === 'denied') return copy.blocked
    if (stateValue === 'prompt') return copy.ask
    return copy.unsupported
  }

  const permissions: Array<[PermissionName, string, SitePermissionState]> = [
    ['camera', copy.camera, state.permissions.camera],
    ['microphone', copy.microphone, state.permissions.microphone],
    ['location', copy.location, state.permissions.location],
    ['screen', copy.screenSharing, 'prompt'],
  ]

  return (
    <section
      ref={panelRef}
      className={styles.panel}
      style={{ top: resolvedTop }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="nebula-site-info-title"
    >
      <header className={styles.header}>
        <span className={styles.favicon} aria-hidden="true">
          {favicon ? <img src={favicon} alt="" /> : 'N'}
        </span>
        <span className={styles.identity}>
          <strong id="nebula-site-info-title">{state.hostname}</strong>
          <span>{copy.subtitle}</span>
        </span>
        <button
          ref={closeRef}
          type="button"
          className={styles.close}
          onClick={onClose}
          aria-label={copy.close}
        >
          ×
        </button>
      </header>

      <div className={styles.securityRow}>
        <span className={styles.securityIcon} aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5z" />
          </svg>
        </span>
        <span>
          <strong>
            {secure ? copy.secure : copy.notSecure}
          </strong>
          <small>{secure ? 'HTTPS' : 'HTTP'}</small>
        </span>
      </div>

      <div className={styles.sectionHeader}>
        <span>{copy.protection}</span>
        <span className={state.protectionDisabled ? styles.warning : styles.good}>
          {state.protectionDisabled ? copy.off : copy.on}
        </span>
      </div>
      <button
        type="button"
        className={styles.protectionButton}
        onClick={onToggleProtection}
      >
        <span className={styles.shield} aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M12 3 5 6v5c0 4.6 2.8 8.3 7 10 4.2-1.7 7-5.4 7-10V6l-7-3Z" /></svg>
        </span>
        <span>
          <strong>
            {state.protectionDisabled ? copy.enableProtection : copy.disableProtection}
          </strong>
          <small>
            {copy.protectionHint}
          </small>
        </span>
      </button>

      <div className={styles.notificationRow}>
        <span>{copy.darkening}</span>
        <div className={styles.segmented}>
          {([
            ['default', copy.default],
            ['off', copy.off],
            ['always', copy.always],
          ] as const).map(([value, label]) => (
            <button
              type="button"
              key={value}
              className={state.darkenWebpagesOverride === value ? styles.segmentActive : ''}
              onClick={() => onSetDarkening(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.sectionHeader}>
        <span>{copy.permissions}</span>
        <span>{state.permissionPromptsAllowed ? copy.canAsk : copy.blocked}</span>
      </div>
      <div className={styles.permissionList}>
        {permissions.map(([name, label, value]) => (
          <div className={styles.permissionRow} key={name}>
            <span className={usage[name] ? styles.permissionIconActive : styles.permissionIcon}>
              <PermissionIcon name={name} />
            </span>
            <span>{label}</span>
            <strong className={usage[name] ? styles.inUse : ''}>
              {permissionLabel(name, value)}
            </strong>
          </div>
        ))}
      </div>

      <div className={styles.notificationRow}>
        <span>{copy.notifications}</span>
        <div className={styles.segmented}>
          {([
            [null, copy.default],
            ['allow', copy.allow],
            ['block', copy.block],
          ] as const).map(([value, label]) => (
            <button
              type="button"
              key={value ?? 'default'}
              className={state.notificationPermission === value ? styles.segmentActive : ''}
              onClick={() => onSetNotificationPermission(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <footer className={styles.footer}>
        <button type="button" className={styles.secondary} onClick={onResetPermissions}>
          {copy.resetPermissions}
        </button>
        <button
          type="button"
          className={confirmClear ? styles.dangerConfirm : styles.secondary}
          onClick={() => {
            if (!confirmClear) {
              setConfirmClear(true)
              return
            }
            onClearSiteData()
            setConfirmClear(false)
          }}
          onBlur={() => setConfirmClear(false)}
        >
          {confirmClear ? copy.clearDataConfirm : copy.clearSiteData}
        </button>
      </footer>
    </section>
  )
}
