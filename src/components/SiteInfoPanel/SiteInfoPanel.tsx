import { useEffect, useRef, useState } from 'react'
import type {
  SiteInfoStatePayload,
  SitePermissionState,
} from '../../core/nebulaBridge'
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
  }
  onClose: () => void
  onToggleProtection: () => void
  onSetNotificationPermission: (
    permission: 'allow' | 'block' | null,
  ) => void
  onResetPermissions: () => void
  onClearSiteData: () => void
}

type PermissionName = 'camera' | 'microphone' | 'location'

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
  onSetNotificationPermission,
  onResetPermissions,
  onClearSiteData,
}: SiteInfoPanelProps) {
  const { locale } = useLocale()
  const panelRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const tr = locale === 'tr'
  const secure = state.url?.startsWith('https://') === true
  useModalFocusTrap(panelRef, true)

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
    if (usage[name]) return tr ? 'Şu anda kullanılıyor' : 'In use now'
    if (stateValue === 'granted') return tr ? 'İzin verildi' : 'Allowed'
    if (stateValue === 'denied') return tr ? 'Engellendi' : 'Blocked'
    if (stateValue === 'prompt') return tr ? 'Sorulacak' : 'Ask'
    return tr ? 'Desteklenmiyor' : 'Unsupported'
  }

  const permissions: Array<[PermissionName, string, SitePermissionState]> = [
    ['camera', tr ? 'Kamera' : 'Camera', state.permissions.camera],
    ['microphone', tr ? 'Mikrofon' : 'Microphone', state.permissions.microphone],
    ['location', tr ? 'Konum' : 'Location', state.permissions.location],
  ]

  return (
    <section
      ref={panelRef}
      className={styles.panel}
      style={{ top }}
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
          <span>{tr ? 'Site bilgileri ve izinler' : 'Site information and permissions'}</span>
        </span>
        <button
          ref={closeRef}
          type="button"
          className={styles.close}
          onClick={onClose}
          aria-label={tr ? 'Kapat' : 'Close'}
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
            {secure
              ? tr ? 'Bağlantı güvenli' : 'Connection is secure'
              : tr ? 'Bağlantı güvenli değil' : 'Connection is not secure'}
          </strong>
          <small>{secure ? 'HTTPS' : 'HTTP'}</small>
        </span>
      </div>

      <div className={styles.sectionHeader}>
        <span>{tr ? 'Site koruması' : 'Site protection'}</span>
        <span className={state.protectionDisabled ? styles.warning : styles.good}>
          {state.protectionDisabled
            ? tr ? 'Kapalı' : 'Off'
            : tr ? 'Açık' : 'On'}
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
            {state.protectionDisabled
              ? tr ? 'Bu sitede korumaları aç' : 'Enable protections on this site'
              : tr ? 'Bu sitede korumaları kapat' : 'Disable protections on this site'}
          </strong>
          <small>
            {tr
              ? 'Takipçi, çerez bannerı ve gizlilik korumaları'
              : 'Tracker, cookie banner, and privacy protections'}
          </small>
        </span>
      </button>

      <div className={styles.sectionHeader}>
        <span>{tr ? 'İzinler' : 'Permissions'}</span>
        <span>{state.permissionPromptsAllowed ? (tr ? 'Sorabilir' : 'Can ask') : (tr ? 'Engelli' : 'Blocked')}</span>
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
        <span>{tr ? 'Bildirimler' : 'Notifications'}</span>
        <div className={styles.segmented}>
          {([
            [null, tr ? 'Varsayılan' : 'Default'],
            ['allow', tr ? 'İzin ver' : 'Allow'],
            ['block', tr ? 'Engelle' : 'Block'],
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
          {tr ? 'İzinleri sıfırla' : 'Reset permissions'}
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
          {confirmClear
            ? tr ? 'Tekrar tıkla: verileri temizle' : 'Click again to clear data'
            : tr ? 'Site verilerini temizle' : 'Clear site data'}
        </button>
      </footer>
    </section>
  )
}
