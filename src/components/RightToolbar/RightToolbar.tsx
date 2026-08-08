import { useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { EditModuleChrome } from '../HomeEdit/EditModuleChrome'
import { useLocale } from '../../hooks/useLocale'
import styles from './RightToolbar.module.css'

export interface ToolbarAnchor {
  x: number
  y: number
}

interface RightToolbarProps {
  onSettings: (anchor: ToolbarAnchor) => void
  onNotifications: () => void
  onDownloads: () => void
  onHistory: () => void
  variant?: 'default' | 'overlay'
  notificationBadge?: number
  downloadCount?: number
  activeDownloadCount?: number
  downloadProgress?: number | null
  editMode?: boolean
  editToolbarVisible?: boolean
  onEditToggleToolbar?: () => void
}

const ACTION_IDS = ['settings', 'notifications', 'history', 'downloads'] as const

function ToolbarIcon({ id }: { id: (typeof ACTION_IDS)[number] }) {
  switch (id) {
    case 'downloads':
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 3v11m0 0 4-4m-4 4-4-4M5 20h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'history':
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M4.5 9A8 8 0 1 1 4 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M4.5 4.5V9H9M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'settings':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.52-.4-1.08-.73-1.69-.98l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.61.25-1.17.59-1.69.98l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.52.4 1.08.73 1.69.98l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.61-.25 1.17-.59 1.69-.98l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
        </svg>
      )
    case 'notifications':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 22c1.1 0 2-.9 2-2h-4a2 2 0 0 0 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2zm-2 1H8v-6c0-2.48 1.51-4.5 4-4.5s4 2.02 4 4.5v6z" />
        </svg>
      )
  }
}

export function RightToolbar({
  onSettings,
  onNotifications,
  onDownloads,
  onHistory,
  variant = 'default',
  notificationBadge = 0,
  downloadCount = 0,
  activeDownloadCount = 0,
  downloadProgress = null,
  editMode = false,
  editToolbarVisible = true,
  onEditToggleToolbar,
}: RightToolbarProps) {
  const { t } = useLocale()
  const settingsRef = useRef<HTMLButtonElement>(null)

  const actionLabels: Record<(typeof ACTION_IDS)[number], string> = {
    downloads: t('downloads'),
    settings: t('settings'),
    notifications: t('notifications'),
    history: t('historyTitle'),
  }

  const onToolbarKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled]):not([tabindex="-1"])'))
    if (buttons.length === 0) return
    const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement)
    let nextIndex = currentIndex
    if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = buttons.length - 1
    else if (event.key === 'ArrowDown') nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % buttons.length
    else if (event.key === 'ArrowUp') nextIndex = currentIndex < 0 ? buttons.length - 1 : (currentIndex - 1 + buttons.length) % buttons.length
    event.preventDefault()
    buttons[nextIndex]?.focus()
  }

  const handlers: Record<(typeof ACTION_IDS)[number], () => void> = {
    downloads: () => {
      if (editMode) return
      onDownloads()
    },
    history: () => {
      if (editMode) return
      onHistory()
    },
    settings: () => {
      if (editMode) return
      const el = settingsRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      onSettings({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
    },
    notifications: () => {
      if (editMode) return
      onNotifications()
    },
  }

  const toolbar = (
    <aside className={variant === 'overlay' ? styles.rootOverlay : styles.root}>
      <div className={styles.actions} role="toolbar" aria-orientation="vertical" aria-label={t('toolbarLabel')} onKeyDown={onToolbarKeyDown}>
        {ACTION_IDS.filter((id) => id !== 'downloads' || downloadCount > 0).map((id) => (
          <button
            key={id}
            ref={id === 'settings' ? settingsRef : undefined}
            type="button"
            className={[
              styles.actionBtn,
              variant === 'overlay' ? styles.actionBtnOverlay : '',
              id === 'downloads' && activeDownloadCount > 0 ? styles.actionBtnActive : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={handlers[id]}
            title={actionLabels[id]}
            aria-label={actionLabels[id]}
            tabIndex={editMode ? -1 : undefined}
          >
            <span className={styles.actionIcon}>
              <ToolbarIcon id={id} />
            </span>
            {id === 'downloads' && activeDownloadCount > 0 && downloadProgress !== null && (
              <svg className={styles.progressRing} viewBox="0 0 44 44" aria-hidden="true">
                <circle cx="22" cy="22" r="20.5" pathLength="100" style={{ strokeDashoffset: 100 - downloadProgress }} />
              </svg>
            )}
            {id === 'downloads' && downloadCount > 0 && (
              <span className={[styles.badge, activeDownloadCount === 0 ? styles.badgeComplete : ''].filter(Boolean).join(' ')}>
                {activeDownloadCount > 0 ? activeDownloadCount : '✓'}
              </span>
            )}
            {id === 'notifications' && notificationBadge > 0 && (
              <span className={styles.badge}>{notificationBadge}</span>
            )}
          </button>
        ))}
      </div>
    </aside>
  )

  if (!editMode) return toolbar

  return (
    <EditModuleChrome
      label={t('toolbarLabel')}
      visible={editToolbarVisible}
      onToggleVisible={onEditToggleToolbar}
      hidden={!editToolbarVisible}
    >
      {toolbar}
    </EditModuleChrome>
  )
}
