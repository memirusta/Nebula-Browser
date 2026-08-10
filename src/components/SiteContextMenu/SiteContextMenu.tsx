import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type {
  SiteContextMenuItem,
  SiteContextMenuRequest,
} from '../../platform/tauriContextMenu'
import styles from './SiteContextMenu.module.css'

interface SiteContextMenuProps {
  request: SiteContextMenuRequest
  onSelect: (commandId: number | null) => void
}

function MenuItems({
  items,
  onSelect,
}: {
  items: SiteContextMenuItem[]
  onSelect: (commandId: number) => void
}) {
  return (
    <>
      {items.map((item, index) => {
        if (item.kind === 'separator') {
          return <div key={`sep-${index}`} className={styles.separator} role="separator" />
        }

        const hasChildren = item.kind === 'submenu' && item.children.length > 0
        return (
          <div key={`${item.commandId}-${item.name}-${index}`} className={styles.itemShell}>
            <button
              type="button"
              className={styles.item}
              disabled={!item.enabled || hasChildren}
              onClick={() => {
                if (!hasChildren && item.enabled) onSelect(item.commandId)
              }}
            >
              <span className={styles.check}>{item.checked ? '✓' : ''}</span>
              <span className={styles.label}>{item.label || item.name}</span>
              {item.shortcut && <span className={styles.shortcut}>{item.shortcut}</span>}
              {hasChildren && <span className={styles.chevron}>›</span>}
            </button>
            {hasChildren && (
              <div className={styles.submenu}>
                <MenuItems items={item.children} onSelect={onSelect} />
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}

export function SiteContextMenu({ request, onSelect }: SiteContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ x: request.x, y: request.y })

  useEffect(() => {
    setPosition({ x: request.x, y: request.y })
  }, [request.id, request.x, request.y])

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const bounds = menu.getBoundingClientRect()
    const margin = 8
    const x = Math.max(margin, Math.min(request.x, window.innerWidth - bounds.width - margin))
    const y = Math.max(margin, Math.min(request.y, window.innerHeight - bounds.height - margin))
    setPosition({ x, y })
  }, [request])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onSelect(null)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onSelect])

  return createPortal(
    <div
      className={styles.layer}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onSelect(null)
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        if (event.target === event.currentTarget) onSelect(null)
      }}
    >
      <div
        ref={menuRef}
        className={styles.menu}
        role="menu"
        style={{ left: position.x, top: position.y }}
      >
        {request.items.length > 0 ? (
          <MenuItems
            items={request.items}
            onSelect={(commandId) => onSelect(commandId)}
          />
        ) : (
          <div className={styles.empty}>No actions available</div>
        )}
      </div>
    </div>,
    document.body,
  )
}
