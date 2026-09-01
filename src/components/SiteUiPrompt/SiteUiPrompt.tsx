import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useModalFocusTrap } from '../../hooks/useModalFocusTrap'
import { useLocale } from '../../hooks/useLocale'
import { getLocaleCopy } from '../../core/locale'
import type { SiteUiRequest, SiteUiResponse } from '../../platform/tauriSiteUi'
import styles from './SiteUiPrompt.module.css'

interface SiteUiPromptProps {
  request: SiteUiRequest
  pendingCount: number
  onRespond: (response: SiteUiResponse) => void
}

const PERMISSION_LABELS = {
  tr: {
    microphone: 'mikrofon',
    camera: 'kamera',
    geolocation: 'konum',
    notifications: 'bildirimler',
    sensors: 'hareket sensörleri',
    'clipboard-read': 'pano',
    'multiple-downloads': 'birden çok indirme',
    'file-read-write': 'dosyalar',
    autoplay: 'otomatik oynatma',
    'local-fonts': 'yerel yazı tipleri',
    'midi-sysex': 'MIDI cihazları',
    'window-management': 'pencere yönetimi',
    'persistent-storage': 'kalıcı depolama',
  },
  en: {
    microphone: 'microphone',
    camera: 'camera',
    geolocation: 'location',
    notifications: 'notifications',
    sensors: 'motion sensors',
    'clipboard-read': 'clipboard',
    'multiple-downloads': 'multiple downloads',
    'file-read-write': 'files',
    autoplay: 'autoplay',
    'local-fonts': 'local fonts',
    'midi-sysex': 'MIDI devices',
    'window-management': 'window management',
    'persistent-storage': 'persistent storage',
  },
  es: {
    microphone: 'micrófono',
    camera: 'cámara',
    geolocation: 'ubicación',
    notifications: 'notificaciones',
    sensors: 'sensores de movimiento',
    'clipboard-read': 'portapapeles',
    'multiple-downloads': 'varias descargas',
    'file-read-write': 'archivos',
    autoplay: 'reproducción automática',
    'local-fonts': 'fuentes locales',
    'midi-sysex': 'dispositivos MIDI',
    'window-management': 'gestión de ventanas',
    'persistent-storage': 'almacenamiento persistente',
  },
  de: {
    microphone: 'Mikrofon',
    camera: 'Kamera',
    geolocation: 'Standort',
    notifications: 'Benachrichtigungen',
    sensors: 'Bewegungssensoren',
    'clipboard-read': 'Zwischenablage',
    'multiple-downloads': 'mehrere Downloads',
    'file-read-write': 'Dateien',
    autoplay: 'automatische Wiedergabe',
    'local-fonts': 'lokale Schriftarten',
    'midi-sysex': 'MIDI-Geräte',
    'window-management': 'Fensterverwaltung',
    'persistent-storage': 'dauerhaften Speicher',
  },
  fr: {
    microphone: 'microphone',
    camera: 'caméra',
    geolocation: 'localisation',
    notifications: 'notifications',
    sensors: 'capteurs de mouvement',
    'clipboard-read': 'presse-papiers',
    'multiple-downloads': 'plusieurs téléchargements',
    'file-read-write': 'fichiers',
    autoplay: 'lecture automatique',
    'local-fonts': 'polices locales',
    'midi-sysex': 'appareils MIDI',
    'window-management': 'gestion des fenêtres',
    'persistent-storage': 'stockage persistant',
  },
  id: {
    microphone: 'mikrofon',
    camera: 'kamera',
    geolocation: 'lokasi',
    notifications: 'notifikasi',
    sensors: 'sensor gerak',
    'clipboard-read': 'papan klip',
    'multiple-downloads': 'beberapa unduhan',
    'file-read-write': 'file',
    autoplay: 'putar otomatis',
    'local-fonts': 'font lokal',
    'midi-sysex': 'perangkat MIDI',
    'window-management': 'pengelolaan jendela',
    'persistent-storage': 'penyimpanan persisten',
  },
  ru: {
    microphone: 'микрофон',
    camera: 'камеру',
    geolocation: 'местоположение',
    notifications: 'уведомления',
    sensors: 'датчики движения',
    'clipboard-read': 'буфер обмена',
    'multiple-downloads': 'несколько скачиваний',
    'file-read-write': 'файлы',
    autoplay: 'автовоспроизведение',
    'local-fonts': 'локальные шрифты',
    'midi-sysex': 'MIDI-устройства',
    'window-management': 'управление окнами',
    'persistent-storage': 'постоянное хранилище',
  },
  it: {
    microphone: 'microfono',
    camera: 'fotocamera',
    geolocation: 'posizione',
    notifications: 'notifiche',
    sensors: 'sensori di movimento',
    'clipboard-read': 'appunti',
    'multiple-downloads': 'download multipli',
    'file-read-write': 'file',
    autoplay: 'riproduzione automatica',
    'local-fonts': 'font locali',
    'midi-sysex': 'dispositivi MIDI',
    'window-management': 'gestione delle finestre',
    'persistent-storage': 'archiviazione permanente',
  },
  ja: {
    microphone: 'マイク',
    camera: 'カメラ',
    geolocation: '位置情報',
    notifications: '通知',
    sensors: 'モーションセンサー',
    'clipboard-read': 'クリップボード',
    'multiple-downloads': '複数のダウンロード',
    'file-read-write': 'ファイル',
    autoplay: '自動再生',
    'local-fonts': 'ローカルフォント',
    'midi-sysex': 'MIDI デバイス',
    'window-management': 'ウィンドウ管理',
    'persistent-storage': '永続ストレージ',
  },
} as const

const COPY = {
  tr: {
    thisFeature: 'bu özellik',
    sitePermission: 'Site izni',
    nebulaPermission: 'Nebula izni',
    wantsToUse: (title: string, permission: string) =>
      `${title} ${permission} kullanmak istiyor`,
    allowAccess: (origin: string, permission: string) =>
      `${origin} adresinin ${permission} erişimine izin verilsin mi?`,
    nebulaLocationTitle: 'Nebula konumunu kullanabilir mi?',
    nebulaLocationMessage:
      'Hava durumu konumunu otomatik ayarlamak için hassas konumunu kullanabilir.',
    allow: 'İzin ver',
    block: 'Engelle',
    authRequired: 'Kimlik doğrulama gerekli',
    signInTo: (title: string) => `${title} için giriş yap`,
    serverChallenge: (challenge: string) =>
      `Sunucu kimlik bilgisi istedi (${challenge}).`,
    serverCredentials: 'Sunucu kullanıcı adı ve parola istedi.',
    signIn: 'Giriş yap',
    cancel: 'İptal',
    emailLinks: 'e-posta bağlantılarını',
    protocolLinks: (scheme: string) => `${scheme}: bağlantılarını`,
    protocolHandler: 'Protokol işleyicisi',
    wantsToOpen: (title: string, label: string) =>
      `${title} ${label} açmak istiyor`,
    allowHandle: (origin: string, label: string) =>
      `${origin} adresinin ${label} Nebula içinde işlemesine izin verilsin mi?`,
    openExternal: 'Harici uygulama açılsın mı?',
    wantsAnotherApp: (title: string) => `${title} başka bir uygulama açmak istiyor`,
    allowOutside: (scheme: string) =>
      `Bu sitenin Nebula dışında ${scheme}: bağlantısı açmasına izin verilsin mi?`,
    open: 'Aç',
    leaveSite: 'Siteden ayrıl?',
    unsaved: 'Yaptığınız değişiklikler kaydedilmeyebilir.',
    leave: 'Ayrıl',
    stay: 'Kal',
    siteMessage: 'Site mesajı',
    siteInput: 'Site girişi',
    ok: 'Tamam',
    promptResponse: 'Site istemi yanıtı',
    username: 'Kullanıcı adı',
    password: 'Parola',
    remember: 'Bu site için bu seçimi hatırla',
  },
  en: {
    thisFeature: 'this feature',
    sitePermission: 'Site permission',
    nebulaPermission: 'Nebula permission',
    wantsToUse: (title: string, permission: string) =>
      `${title} wants to use ${permission}`,
    allowAccess: (origin: string, permission: string) =>
      `Allow ${origin} to access ${permission}?`,
    nebulaLocationTitle: 'Allow Nebula to use your location?',
    nebulaLocationMessage:
      'Nebula can use your precise location to set the weather location automatically.',
    allow: 'Allow',
    block: 'Block',
    authRequired: 'Authentication required',
    signInTo: (title: string) => `Sign in to ${title}`,
    serverChallenge: (challenge: string) =>
      `The server requested credentials (${challenge}).`,
    serverCredentials: 'The server requested a username and password.',
    signIn: 'Sign in',
    cancel: 'Cancel',
    emailLinks: 'email links',
    protocolLinks: (scheme: string) => `${scheme}: links`,
    protocolHandler: 'Protocol handler',
    wantsToOpen: (title: string, label: string) =>
      `${title} wants to open ${label}`,
    allowHandle: (origin: string, label: string) =>
      `Allow ${origin} to handle ${label} in Nebula?`,
    openExternal: 'Open external app?',
    wantsAnotherApp: (title: string) => `${title} wants to open another application`,
    allowOutside: (scheme: string) =>
      `Allow this site to open a ${scheme}: link outside Nebula?`,
    open: 'Open',
    leaveSite: 'Leave site?',
    unsaved: 'Changes you made may not be saved.',
    leave: 'Leave',
    stay: 'Stay',
    siteMessage: 'Site message',
    siteInput: 'Site input',
    ok: 'OK',
    promptResponse: 'Site prompt response',
    username: 'Username',
    password: 'Password',
    remember: 'Remember this choice for this site',
  },
  es: {
    thisFeature: 'esta función',
    sitePermission: 'Permiso del sitio',
    nebulaPermission: 'Permiso de Nebula',
    wantsToUse: (title: string, permission: string) =>
      `${title} quiere usar ${permission}`,
    allowAccess: (origin: string, permission: string) =>
      `¿Permitir que ${origin} acceda a ${permission}?`,
    nebulaLocationTitle: '¿Permitir que Nebula use tu ubicación?',
    nebulaLocationMessage:
      'Nebula puede usar tu ubicación precisa para configurar automáticamente el tiempo.',
    allow: 'Permitir',
    block: 'Bloquear',
    authRequired: 'Autenticación necesaria',
    signInTo: (title: string) => `Iniciar sesión en ${title}`,
    serverChallenge: (challenge: string) =>
      `El servidor solicitó credenciales (${challenge}).`,
    serverCredentials: 'El servidor solicitó un nombre de usuario y una contraseña.',
    signIn: 'Iniciar sesión',
    cancel: 'Cancelar',
    emailLinks: 'enlaces de correo electrónico',
    protocolLinks: (scheme: string) => `enlaces ${scheme}:`,
    protocolHandler: 'Controlador de protocolo',
    wantsToOpen: (title: string, label: string) =>
      `${title} quiere abrir ${label}`,
    allowHandle: (origin: string, label: string) =>
      `¿Permitir que ${origin} gestione ${label} en Nebula?`,
    openExternal: '¿Abrir una aplicación externa?',
    wantsAnotherApp: (title: string) => `${title} quiere abrir otra aplicación`,
    allowOutside: (scheme: string) =>
      `¿Permitir que este sitio abra un enlace ${scheme}: fuera de Nebula?`,
    open: 'Abrir',
    leaveSite: '¿Salir del sitio?',
    unsaved: 'Es posible que no se guarden los cambios realizados.',
    leave: 'Salir',
    stay: 'Quedarse',
    siteMessage: 'Mensaje del sitio',
    siteInput: 'Entrada del sitio',
    ok: 'Aceptar',
    promptResponse: 'Respuesta al mensaje del sitio',
    username: 'Nombre de usuario',
    password: 'Contraseña',
    remember: 'Recordar esta elección para este sitio',
  },
  de: {
    thisFeature: 'diese Funktion',
    sitePermission: 'Website-Berechtigung',
    nebulaPermission: 'Nebula-Berechtigung',
    wantsToUse: (title: string, permission: string) =>
      `${title} möchte ${permission} verwenden`,
    allowAccess: (origin: string, permission: string) =>
      `${origin} den Zugriff auf ${permission} erlauben?`,
    nebulaLocationTitle: 'Nebula erlauben, deinen Standort zu verwenden?',
    nebulaLocationMessage:
      'Nebula kann deinen genauen Standort verwenden, um den Wetterstandort automatisch festzulegen.',
    allow: 'Zulassen',
    block: 'Blockieren',
    authRequired: 'Authentifizierung erforderlich',
    signInTo: (title: string) => `Bei ${title} anmelden`,
    serverChallenge: (challenge: string) =>
      `Der Server hat Anmeldedaten angefordert (${challenge}).`,
    serverCredentials: 'Der Server hat einen Benutzernamen und ein Passwort angefordert.',
    signIn: 'Anmelden',
    cancel: 'Abbrechen',
    emailLinks: 'E-Mail-Links',
    protocolLinks: (scheme: string) => `${scheme}:-Links`,
    protocolHandler: 'Protokollhandler',
    wantsToOpen: (title: string, label: string) =>
      `${title} möchte ${label} öffnen`,
    allowHandle: (origin: string, label: string) =>
      `${origin} erlauben, ${label} in Nebula zu verarbeiten?`,
    openExternal: 'Externe App öffnen?',
    wantsAnotherApp: (title: string) => `${title} möchte eine andere Anwendung öffnen`,
    allowOutside: (scheme: string) =>
      `Dieser Website erlauben, einen ${scheme}:-Link außerhalb von Nebula zu öffnen?`,
    open: 'Öffnen',
    leaveSite: 'Website verlassen?',
    unsaved: 'Vorgenommene Änderungen werden möglicherweise nicht gespeichert.',
    leave: 'Verlassen',
    stay: 'Bleiben',
    siteMessage: 'Website-Nachricht',
    siteInput: 'Website-Eingabe',
    ok: 'OK',
    promptResponse: 'Antwort auf die Website-Abfrage',
    username: 'Benutzername',
    password: 'Passwort',
    remember: 'Diese Auswahl für diese Website merken',
  },
  fr: {
    thisFeature: 'cette fonctionnalité',
    sitePermission: 'Autorisation du site',
    nebulaPermission: 'Autorisation de Nebula',
    wantsToUse: (title: string, permission: string) =>
      `${title} souhaite utiliser ${permission}`,
    allowAccess: (origin: string, permission: string) =>
      `Autoriser ${origin} à accéder à ${permission} ?`,
    nebulaLocationTitle: 'Autoriser Nebula à utiliser votre localisation ?',
    nebulaLocationMessage:
      'Nebula peut utiliser votre localisation précise pour définir automatiquement la météo.',
    allow: 'Autoriser',
    block: 'Bloquer',
    authRequired: 'Authentification requise',
    signInTo: (title: string) => `Se connecter à ${title}`,
    serverChallenge: (challenge: string) =>
      `Le serveur a demandé des identifiants (${challenge}).`,
    serverCredentials: 'Le serveur a demandé un nom d’utilisateur et un mot de passe.',
    signIn: 'Se connecter',
    cancel: 'Annuler',
    emailLinks: 'les liens d’e-mail',
    protocolLinks: (scheme: string) => `les liens ${scheme}:`,
    protocolHandler: 'Gestionnaire de protocole',
    wantsToOpen: (title: string, label: string) =>
      `${title} souhaite ouvrir ${label}`,
    allowHandle: (origin: string, label: string) =>
      `Autoriser ${origin} à gérer ${label} dans Nebula ?`,
    openExternal: 'Ouvrir l’application externe ?',
    wantsAnotherApp: (title: string) => `${title} souhaite ouvrir une autre application`,
    allowOutside: (scheme: string) =>
      `Autoriser ce site à ouvrir un lien ${scheme}: hors de Nebula ?`,
    open: 'Ouvrir',
    leaveSite: 'Quitter le site ?',
    unsaved: 'Les modifications effectuées risquent de ne pas être enregistrées.',
    leave: 'Quitter',
    stay: 'Rester',
    siteMessage: 'Message du site',
    siteInput: 'Saisie du site',
    ok: 'OK',
    promptResponse: 'Réponse à la demande du site',
    username: 'Nom d’utilisateur',
    password: 'Mot de passe',
    remember: 'Mémoriser ce choix pour ce site',
  },
  id: {
    thisFeature: 'fitur ini',
    sitePermission: 'Izin situs',
    nebulaPermission: 'Izin Nebula',
    wantsToUse: (title: string, permission: string) =>
      `${title} ingin menggunakan ${permission}`,
    allowAccess: (origin: string, permission: string) =>
      `Izinkan ${origin} mengakses ${permission}?`,
    nebulaLocationTitle: 'Izinkan Nebula menggunakan lokasi Anda?',
    nebulaLocationMessage:
      'Nebula dapat menggunakan lokasi akurat Anda untuk mengatur lokasi cuaca secara otomatis.',
    allow: 'Izinkan',
    block: 'Blokir',
    authRequired: 'Autentikasi diperlukan',
    signInTo: (title: string) => `Masuk ke ${title}`,
    serverChallenge: (challenge: string) =>
      `Server meminta kredensial (${challenge}).`,
    serverCredentials: 'Server meminta nama pengguna dan kata sandi.',
    signIn: 'Masuk',
    cancel: 'Batal',
    emailLinks: 'tautan email',
    protocolLinks: (scheme: string) => `tautan ${scheme}:`,
    protocolHandler: 'Penangan protokol',
    wantsToOpen: (title: string, label: string) =>
      `${title} ingin membuka ${label}`,
    allowHandle: (origin: string, label: string) =>
      `Izinkan ${origin} menangani ${label} di Nebula?`,
    openExternal: 'Buka aplikasi eksternal?',
    wantsAnotherApp: (title: string) => `${title} ingin membuka aplikasi lain`,
    allowOutside: (scheme: string) =>
      `Izinkan situs ini membuka tautan ${scheme}: di luar Nebula?`,
    open: 'Buka',
    leaveSite: 'Tinggalkan situs?',
    unsaved: 'Perubahan yang Anda buat mungkin tidak disimpan.',
    leave: 'Tinggalkan',
    stay: 'Tetap di sini',
    siteMessage: 'Pesan situs',
    siteInput: 'Input situs',
    ok: 'OK',
    promptResponse: 'Jawaban permintaan situs',
    username: 'Nama pengguna',
    password: 'Kata sandi',
    remember: 'Ingat pilihan ini untuk situs ini',
  },
  ru: {
    thisFeature: 'эту функцию',
    sitePermission: 'Разрешение сайта',
    nebulaPermission: 'Разрешение Nebula',
    wantsToUse: (title: string, permission: string) =>
      `${title} запрашивает доступ: ${permission}`,
    allowAccess: (origin: string, permission: string) =>
      `Разрешить ${origin} доступ к функции «${permission}»?`,
    nebulaLocationTitle: 'Разрешить Nebula использовать ваше местоположение?',
    nebulaLocationMessage:
      'Nebula может использовать точное местоположение для автоматической настройки погоды.',
    allow: 'Разрешить',
    block: 'Блокировать',
    authRequired: 'Требуется аутентификация',
    signInTo: (title: string) => `Вход на ${title}`,
    serverChallenge: (challenge: string) =>
      `Сервер запросил учётные данные (${challenge}).`,
    serverCredentials: 'Сервер запросил имя пользователя и пароль.',
    signIn: 'Войти',
    cancel: 'Отмена',
    emailLinks: 'ссылки электронной почты',
    protocolLinks: (scheme: string) => `ссылки ${scheme}:`,
    protocolHandler: 'Обработчик протокола',
    wantsToOpen: (title: string, label: string) =>
      `${title} хочет открыть ${label}`,
    allowHandle: (origin: string, label: string) =>
      `Разрешить ${origin} обрабатывать ${label} в Nebula?`,
    openExternal: 'Открыть внешнее приложение?',
    wantsAnotherApp: (title: string) => `${title} хочет открыть другое приложение`,
    allowOutside: (scheme: string) =>
      `Разрешить этому сайту открыть ссылку ${scheme}: вне Nebula?`,
    open: 'Открыть',
    leaveSite: 'Покинуть сайт?',
    unsaved: 'Внесённые изменения могут не сохраниться.',
    leave: 'Покинуть',
    stay: 'Остаться',
    siteMessage: 'Сообщение сайта',
    siteInput: 'Ввод сайта',
    ok: 'OK',
    promptResponse: 'Ответ на запрос сайта',
    username: 'Имя пользователя',
    password: 'Пароль',
    remember: 'Запомнить этот выбор для сайта',
  },
  it: {
    thisFeature: 'questa funzione',
    sitePermission: 'Autorizzazione del sito',
    nebulaPermission: 'Autorizzazione Nebula',
    wantsToUse: (title: string, permission: string) =>
      `${title} vuole usare ${permission}`,
    allowAccess: (origin: string, permission: string) =>
      `Consentire a ${origin} di accedere a ${permission}?`,
    nebulaLocationTitle: 'Consentire a Nebula di usare la tua posizione?',
    nebulaLocationMessage:
      'Nebula può usare la tua posizione precisa per impostare automaticamente la località meteo.',
    allow: 'Consenti',
    block: 'Blocca',
    authRequired: 'Autenticazione richiesta',
    signInTo: (title: string) => `Accedi a ${title}`,
    serverChallenge: (challenge: string) =>
      `Il server ha richiesto le credenziali (${challenge}).`,
    serverCredentials: 'Il server ha richiesto un nome utente e una password.',
    signIn: 'Accedi',
    cancel: 'Annulla',
    emailLinks: 'collegamenti e-mail',
    protocolLinks: (scheme: string) => `collegamenti ${scheme}:`,
    protocolHandler: 'Gestore protocollo',
    wantsToOpen: (title: string, label: string) =>
      `${title} vuole aprire ${label}`,
    allowHandle: (origin: string, label: string) =>
      `Consentire a ${origin} di gestire ${label} in Nebula?`,
    openExternal: 'Aprire l’app esterna?',
    wantsAnotherApp: (title: string) => `${title} vuole aprire un’altra applicazione`,
    allowOutside: (scheme: string) =>
      `Consentire a questo sito di aprire un collegamento ${scheme}: fuori da Nebula?`,
    open: 'Apri',
    leaveSite: 'Uscire dal sito?',
    unsaved: 'Le modifiche apportate potrebbero non essere salvate.',
    leave: 'Esci',
    stay: 'Resta',
    siteMessage: 'Messaggio del sito',
    siteInput: 'Input del sito',
    ok: 'OK',
    promptResponse: 'Risposta alla richiesta del sito',
    username: 'Nome utente',
    password: 'Password',
    remember: 'Ricorda questa scelta per questo sito',
  },
  ja: {
    thisFeature: 'この機能',
    sitePermission: 'サイトの権限',
    nebulaPermission: 'Nebula の権限',
    wantsToUse: (title: string, permission: string) =>
      `${title} が${permission}を使用しようとしています`,
    allowAccess: (origin: string, permission: string) =>
      `${origin} に${permission}へのアクセスを許可しますか？`,
    nebulaLocationTitle: 'Nebula に位置情報の使用を許可しますか？',
    nebulaLocationMessage:
      'Nebula は正確な位置情報を使用して、天気の地域を自動設定できます。',
    allow: '許可',
    block: 'ブロック',
    authRequired: '認証が必要です',
    signInTo: (title: string) => `${title} にログイン`,
    serverChallenge: (challenge: string) =>
      `サーバーが認証情報を要求しました（${challenge}）。`,
    serverCredentials: 'サーバーがユーザー名とパスワードを要求しました。',
    signIn: 'ログイン',
    cancel: 'キャンセル',
    emailLinks: 'メールリンク',
    protocolLinks: (scheme: string) => `${scheme}: リンク`,
    protocolHandler: 'プロトコルハンドラー',
    wantsToOpen: (title: string, label: string) =>
      `${title} が${label}を開こうとしています`,
    allowHandle: (origin: string, label: string) =>
      `${origin} が Nebula で${label}を処理することを許可しますか？`,
    openExternal: '外部アプリを開きますか？',
    wantsAnotherApp: (title: string) => `${title} が別のアプリを開こうとしています`,
    allowOutside: (scheme: string) =>
      `このサイトが Nebula の外部で ${scheme}: リンクを開くことを許可しますか？`,
    open: '開く',
    leaveSite: 'サイトを離れますか？',
    unsaved: '変更内容が保存されない可能性があります。',
    leave: '移動',
    stay: 'このページに留まる',
    siteMessage: 'サイトからのメッセージ',
    siteInput: 'サイトの入力',
    ok: 'OK',
    promptResponse: 'サイトの入力要求への回答',
    username: 'ユーザー名',
    password: 'パスワード',
    remember: 'このサイトでこの選択を記憶する',
  },
} as const

function originText(uri: string, fallback: string): string {
  try {
    return new URL(uri).origin
  } catch {
    return fallback
  }
}

export function SiteUiPrompt({
  request,
  pendingCount,
  onRespond,
}: SiteUiPromptProps) {
  const { locale } = useLocale()
  const copy = getLocaleCopy(COPY, locale)
  const [text, setText] = useState(request.defaultText ?? '')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  useModalFocusTrap(dialogRef)

  const isInternalLocation =
    request.requestType === 'permission' &&
    request.permissionKind === 'geolocation' &&
    request.tabLabel === 'main'

  useEffect(() => {
    setText(request.defaultText ?? '')
    setUsername('')
    setPassword('')
    setRemember(false)
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }, [request])

  const presentation = useMemo(() => {
    if (isInternalLocation) {
      return {
        eyebrow: copy.nebulaPermission,
        title: copy.nebulaLocationTitle,
        message: copy.nebulaLocationMessage,
        accept: copy.allow,
        cancel: copy.block,
      }
    }

    if (request.requestType === 'permission') {
      const permissionKind = request.permissionKind
      const permission =
        permissionKind === 'unknown'
          ? copy.thisFeature
          : getLocaleCopy(PERMISSION_LABELS, locale)[
              permissionKind as keyof typeof PERMISSION_LABELS.tr
            ] ??
            permissionKind ??
            copy.thisFeature

      return {
        eyebrow: copy.sitePermission,
        title: copy.wantsToUse(request.title, permission),
        message: copy.allowAccess(
          originText(request.uri, request.title),
          permission,
        ),
        accept: copy.allow,
        cancel: copy.block,
      }
    }

    if (request.requestType === 'basic-auth') {
      return {
        eyebrow: copy.authRequired,
        title: copy.signInTo(request.title),
        message: request.challenge
          ? copy.serverChallenge(request.challenge)
          : copy.serverCredentials,
        accept: copy.signIn,
        cancel: copy.cancel,
      }
    }

    if (request.requestType === 'protocol-handler') {
      const scheme = request.permissionKind ?? 'link'
      const label =
        scheme === 'mailto'
          ? copy.emailLinks
          : copy.protocolLinks(scheme)

      return {
        eyebrow: copy.protocolHandler,
        title: copy.wantsToOpen(request.title, label),
        message: copy.allowHandle(
          originText(request.uri, request.title),
          label,
        ),
        accept: copy.allow,
        cancel: copy.block,
      }
    }

    if (request.requestType === 'external-uri') {
      const scheme = request.permissionKind ?? 'external'

      return {
        eyebrow: copy.openExternal,
        title: copy.wantsAnotherApp(request.title),
        message: copy.allowOutside(scheme),
        accept: copy.open,
        cancel: copy.block,
      }
    }

    switch (request.dialogKind) {
      case 'beforeunload':
        return {
          eyebrow: copy.leaveSite,
          title: request.title,
          message: request.message || copy.unsaved,
          accept: copy.leave,
          cancel: copy.stay,
        }
      case 'confirm':
        return {
          eyebrow: copy.siteMessage,
          title: request.title,
          message: request.message,
          accept: copy.ok,
          cancel: copy.cancel,
        }
      case 'prompt':
        return {
          eyebrow: copy.siteInput,
          title: request.title,
          message: request.message,
          accept: copy.ok,
          cancel: copy.cancel,
        }
      default:
        return {
          eyebrow: copy.siteMessage,
          title: request.title,
          message: request.message,
          accept: copy.ok,
          cancel: '',
        }
    }
  }, [copy, isInternalLocation, locale, request])

  const submit = () => {
    onRespond({
      accepted: true,
      text,
      username,
      password,
      remember,
    })
  }

  const reject = () => {
    onRespond({
      accepted: false,
      remember:
        request.requestType ===
          'permission'
          ? remember
          : false,
    })
  }

  return createPortal(
    <div className={styles.backdrop} role="presentation">
      <section
        ref={dialogRef}
        className={styles.card}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="nebula-site-ui-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && request.dialogKind !== 'alert') {
            event.preventDefault()
            reject()
          }

          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            submit()
          }
        }}
      >
        <div className={styles.headerRow}>
          <div className={styles.siteMark}>
            {isInternalLocation
              ? <img src="/nebula-app-logo.png" alt="" aria-hidden="true" draggable={false} />
              : request.title.slice(0, 1).toUpperCase()}
          </div>

          <div className={styles.heading}>
            <span>{presentation.eyebrow}</span>
            <h2 id="nebula-site-ui-title">{presentation.title}</h2>
          </div>

          {pendingCount > 1 && (
            <span className={styles.queueBadge}>
              +{pendingCount - 1}
            </span>
          )}
        </div>

        <p className={styles.message}>{presentation.message}</p>

        {!isInternalLocation && (
          <div className={styles.origin}>
            {originText(request.uri, request.uri)}
          </div>
        )}

        {request.requestType === 'script-dialog' &&
          request.dialogKind === 'prompt' && (
            <input
              ref={inputRef}
              className={styles.input}
              value={text}
              onChange={(event) => setText(event.target.value)}
              aria-label={copy.promptResponse}
            />
          )}

        {request.requestType === 'basic-auth' && (
          <div className={styles.formGrid}>
            <input
              ref={inputRef}
              className={styles.input}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder={copy.username}
              autoComplete="username"
            />

            <input
              className={styles.input}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={copy.password}
              autoComplete="current-password"
            />
          </div>
        )}

        {request.requestType === 'permission' &&
          !isInternalLocation && (
            <label className={styles.rememberRow}>
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
              />

              <span>{copy.remember}</span>
            </label>
          )}

        <div className={styles.actions}>
          {presentation.cancel && (
            <button
              type="button"
              className={styles.secondary}
              onClick={reject}
            >
              {presentation.cancel}
            </button>
          )}

          <button
            type="button"
            className={styles.primary}
            onClick={submit}
            disabled={
              request.requestType === 'basic-auth' &&
              !username.trim()
            }
          >
            {presentation.accept}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  )
}
