import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { fitContextMenuPosition } from '../../core/contextMenuPosition'
import type { Shortcut } from '../../core/types'
import { useLocale } from '../../hooks/useLocale'
import styles from './ShortcutContextMenu.module.css'

interface ShortcutContextMenuProps {
  requestId: number
  x: number
  y: number
  shortcut: Shortcut
  isMuted: boolean
  isTabOpen?: boolean
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
  requestId,
  x,
  y,
  shortcut,
  isMuted,
  isTabOpen = false,
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
  const { t, tf } = useLocale()
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })
  const [positioned, setPositioned] = useState(false)
  let host = ''
  try {
    host = new URL(shortcut.url).hostname
  } catch {
    host = shortcut.url
  }

  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      // A second right-click owns the next contextmenu request. Closing during
      // pointerdown would briefly unmount the menu and compact the native
      // chrome WebView before that replacement request can be positioned.
      if (e.button === 2) return
      if (menuRef.current?.contains(e.target as Node)) return
      onClose()
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
      const buttons = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
      if (buttons.length === 0) return
      e.preventDefault()
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
      const next = e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? buttons.length - 1
          : e.key === 'ArrowDown'
            ? (current + 1 + buttons.length) % buttons.length
            : (current - 1 + buttons.length) % buttons.length
      buttons[next]?.focus()
    }
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  const positionMenu = useCallback(() => {
    const menu = menuRef.current
    if (!menu) return
    const bounds = menu.getBoundingClientRect()
    const viewport = window.visualViewport
    const next = fitContextMenuPosition({
      anchorX: x,
      anchorY: y,
      menuWidth: bounds.width,
      menuHeight: bounds.height,
      viewportLeft: viewport?.offsetLeft ?? 0,
      viewportTop: viewport?.offsetTop ?? 0,
      viewportWidth: viewport?.width ?? window.innerWidth,
      viewportHeight: viewport?.height ?? window.innerHeight,
    })

    setPosition((current) =>
      current.left === next.left && current.top === next.top ? current : next,
    )
    setPositioned(true)
    onLayout?.(new DOMRect(next.left, next.top, bounds.width, bounds.height))
  }, [x, y, onLayout])

  useEffect(() => {
    setPositioned(false)
    setPosition({ left: x, top: y })

    let firstFrame = 0
    let secondFrame = 0
    firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        positionMenu()
        menuRef.current
          ?.querySelector<HTMLButtonElement>('button:not(:disabled)')
          ?.focus()
      })
    })

    return () => {
      cancelAnimationFrame(firstFrame)
      cancelAnimationFrame(secondFrame)
    }
  }, [requestId, x, y, positionMenu])

  useEffect(() => {
    const menu = menuRef.current
    if (!menu) return

    const resizeObserver = new ResizeObserver(positionMenu)
    const viewport = window.visualViewport
    resizeObserver.observe(menu)
    window.addEventListener('resize', positionMenu)
    viewport?.addEventListener('resize', positionMenu)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', positionMenu)
      viewport?.removeEventListener('resize', positionMenu)
    }
  }, [positionMenu])

  return createPortal(
    <div
      ref={menuRef}
      className={styles.menu}
      style={{
        left: position.left,
        top: position.top,
        visibility: positioned ? 'visible' : 'hidden',
      }}
      role="menu"
      aria-label={tf('shortcutMenuAria', { label: shortcut.label })}
      data-semi-lunar-safe=""
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className={styles.header}>
        <span className={styles.favicon} aria-hidden="true">
          {shortcut.favicon ? (
            <img src={shortcut.favicon} alt="" draggable={false} />
          ) : (
            shortcut.label.charAt(0).toUpperCase()
          )}
        </span>
        <span className={styles.identity}>
          <strong>{shortcut.label}</strong>
          <span>{host}</span>
        </span>
        {isTabOpen && (
          <span className={styles.liveBadge}>
            {isMuted
              ? t('shortcutStatusMuted')
              : t('shortcutStatusLive')}
          </span>
        )}
      </div>
      <div className={styles.separator} role="separator" />
      <button
        type="button"
        className={styles.item}
        role="menuitem"
        onClick={() => {
          onOpenNewTab()
          onClose()
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4H4v16h16v-4M13 4h7v7M20 4l-9 9" /></svg>
        <span>{t('ctxOpenNewTab')}</span>
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
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 4 8 0-1 5 3 3v2H6v-2l3-3-1-5ZM12 14v7" /></svg>
          <span>{isPinned ? t('ctxUnpin') : canPinMore ? t('ctxPin') : t('ctxPinFull')}</span>
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
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 9h4l5-4v14l-5-4H5V9Z" />
          {isMuted ? <path d="m17 9 4 6m0-6-4 6" /> : <path d="M17 9c1.3 1.7 1.3 4.3 0 6" />}
        </svg>
        <span>{isMuted ? t('ctxUnmute') : t('ctxMute')}</span>
        {isMuted && <span className={styles.stateDot} aria-hidden="true" />}
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
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" /></svg>
        <span>{isTabOpen ? t('ctxClose') : t('removeShortcut')}</span>
      </button>
    </div>,
    document.body,
  )
}
