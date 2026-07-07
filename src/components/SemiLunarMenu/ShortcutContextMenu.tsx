import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { Shortcut } from '../../core/types'
import styles from './ShortcutContextMenu.module.css'

interface ShortcutContextMenuProps {
  x: number
  y: number
  shortcut: Shortcut
  isMuted: boolean
  isPinned?: boolean
  canPinMore?: boolean
  onClose: () => void
  onRemove: () => void
  onToggleMute: () => void
  onOpenNewTab: () => void
  onTogglePin?: () => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
  onLayout?: (rect: DOMRect) => void
}

export function ShortcutContextMenu({
  x,
  y,
  shortcut,
  isMuted,
  isPinned = false,
  canPinMore = true,
  onClose,
  onRemove,
  onToggleMute,
  onOpenNewTab,
  onTogglePin,
  onMouseEnter,
  onMouseLeave,
  onLayout,
}: ShortcutContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return
      onClose()
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  useEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const rect = menu.getBoundingClientRect()
    const pad = 8
    let left = x
    let top = y
    if (left + rect.width > window.innerWidth - pad) {
      left = window.innerWidth - rect.width - pad
    }
    if (top + rect.height > window.innerHeight - pad) {
      top = window.innerHeight - rect.height - pad
    }
    menu.style.left = `${Math.max(pad, left)}px`
    menu.style.top = `${Math.max(pad, top)}px`
    onLayout?.(menu.getBoundingClientRect())
  }, [x, y, onLayout])

  return createPortal(
    <div
      ref={menuRef}
      className={styles.menu}
      style={{ left: x, top: y }}
      role="menu"
      aria-label={`${shortcut.label} menüsü`}
      data-semi-lunar-safe=""
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <button
        type="button"
        className={styles.item}
        role="menuitem"
        onClick={() => {
          onOpenNewTab()
          onClose()
        }}
      >
        Yeni sekmede aç
      </button>
      {onTogglePin && (
        <button
          type="button"
          className={styles.item}
          role="menuitem"
          disabled={!isPinned && !canPinMore}
          onClick={() => {
            if (!isPinned && !canPinMore) return
            onTogglePin()
            onClose()
          }}
        >
          {isPinned ? 'Sabitlemeyi kaldır' : canPinMore ? 'Ana sayfaya sabitle' : 'Sabitleme dolu (max 12)'}
        </button>
      )}
      <button
        type="button"
        className={styles.item}
        role="menuitem"
        onClick={() => {
          onToggleMute()
          onClose()
        }}
      >
        {isMuted ? 'Sesi aç' : 'Sessize al'}
      </button>
      <div className={styles.separator} role="separator" />
      <button
        type="button"
        className={`${styles.item} ${styles.itemDanger}`}
        role="menuitem"
        onClick={() => {
          onRemove()
          onClose()
        }}
      >
        Kapat
      </button>
    </div>,
    document.body,
  )
}
