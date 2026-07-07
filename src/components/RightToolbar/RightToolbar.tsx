import { useRef } from 'react'
import { EditModuleChrome } from '../HomeEdit/EditModuleChrome'
import { useLocale } from '../../hooks/useLocale'
import styles from './RightToolbar.module.css'

export interface ToolbarAnchor {
  x: number
  y: number
}

interface RightToolbarProps {
  onSettings: (anchor: ToolbarAnchor) => void
  variant?: 'default' | 'overlay'
  notificationBadge?: number
  editMode?: boolean
  editToolbarVisible?: boolean
  onEditToggleToolbar?: () => void
}

const ACTION_IDS = ['settings', 'notifications'] as const

function ToolbarIcon({ id }: { id: (typeof ACTION_IDS)[number] }) {
  switch (id) {
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
  variant = 'default',
  notificationBadge = 0,
  editMode = false,
  editToolbarVisible = true,
  onEditToggleToolbar,
}: RightToolbarProps) {
  const { t } = useLocale()
  const settingsRef = useRef<HTMLButtonElement>(null)

  const actionLabels: Record<(typeof ACTION_IDS)[number], string> = {
    settings: t('settings'),
    notifications: t('notifications'),
  }

  const handlers: Record<(typeof ACTION_IDS)[number], () => void> = {
    settings: () => {
      if (editMode) return
      const el = settingsRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      onSettings({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
    },
    notifications: () => {
      if (editMode) return
    },
  }

  const toolbar = (
    <aside className={variant === 'overlay' ? styles.rootOverlay : styles.root}>
      <div className={styles.actions}>
        {ACTION_IDS.map((id) => (
          <button
            key={id}
            ref={id === 'settings' ? settingsRef : undefined}
            type="button"
            className={[
              styles.actionBtn,
              variant === 'overlay' ? styles.actionBtnOverlay : '',
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
