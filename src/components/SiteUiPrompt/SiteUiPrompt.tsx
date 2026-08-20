import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useModalFocusTrap } from '../../hooks/useModalFocusTrap'
import { useLocale } from '../../hooks/useLocale'
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
  const copy = COPY[locale]
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
          : PERMISSION_LABELS[locale][
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
              ? 'N'
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
