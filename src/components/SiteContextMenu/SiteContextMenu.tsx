import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import {
  NEBULA_INSPECT_COMMAND_ID,
  type SiteContextMenuItem,
  type SiteContextMenuRequest,
} from '../../platform/tauriContextMenu'
// Nebula owns Inspect instead of depending on WebView2's developer-menu
// entry, which is absent in some release configurations.
import { useLocale } from '../../hooks/useLocale'
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

export function SiteContextMenu({
  request,
  onSelect,
}: SiteContextMenuProps) {
  const { t } = useLocale()
  const menuRef = useRef<HTMLDivElement>(null)

  const menuItems = useMemo(() => {
    if (request.items.some((item) => item.commandId === NEBULA_INSPECT_COMMAND_ID)) {
      return request.items
    }

    const items = request.items.slice()
    if (items.length > 0 && items.at(-1)?.kind !== 'separator') {
      items.push({
        commandId: -1,
        label: '',
        name: 'nebula-separator',
        shortcut: '',
        kind: 'separator',
        enabled: false,
        checked: false,
        children: [],
      })
    }
    items.push({
      commandId: NEBULA_INSPECT_COMMAND_ID,
      label: t('contextInspect'),
      name: 'inspect',
      shortcut: '',
      kind: 'command',
      enabled: true,
      checked: false,
      children: [],
    })
    return items
  }, [request.items, t])

  const [position, setPosition] = useState({
    x: 0,
    y: 0,
  })

  const [positioned, setPositioned] =
    useState(false)

  const positionMenu = useCallback(() => {
    const menu = menuRef.current
    if (!menu) return

    const bounds =
      menu.getBoundingClientRect()

    const margin = 8

    const viewportWidth =
      window.visualViewport?.width ??
      window.innerWidth

    const viewportHeight =
      window.visualViewport?.height ??
      window.innerHeight

    let x = request.x
    let y = request.y

    // Flip horizontally if the menu would
    // cross the right edge.
    if (
      x + bounds.width + margin >
      viewportWidth
    ) {
      x =
        request.x -
        bounds.width
    }

    // Flip vertically if the menu would
    // cross the bottom edge.
    if (
      y + bounds.height + margin >
      viewportHeight
    ) {
      y =
        request.y -
        bounds.height
    }

    // Final safety clamp.
    x = Math.max(
      margin,
      Math.min(
        x,
        viewportWidth -
          bounds.width -
          margin,
      ),
    )

    y = Math.max(
      margin,
      Math.min(
        y,
        viewportHeight -
          bounds.height -
          margin,
      ),
    )

    setPosition({
      x,
      y,
    })

    setPositioned(true)
  }, [
    request.x,
    request.y,
  ])

  // Wait until the overlay has had time to
  // obtain its final bounds before measuring.
  useEffect(() => {
    setPositioned(false)

    let frame1 = 0
    let frame2 = 0

    frame1 =
      requestAnimationFrame(() => {
        frame2 =
          requestAnimationFrame(() => {
            positionMenu()
          })
      })

    return () => {
      cancelAnimationFrame(frame1)
      cancelAnimationFrame(frame2)
    }
  }, [
    request.id,
    positionMenu,
  ])

  // Reposition after the initial measurement
  // if viewport/menu dimensions later change.
  useEffect(() => {
    if (!positioned) return

    const menu = menuRef.current
    if (!menu) return

    const observer =
      new ResizeObserver(() => {
        positionMenu()
      })

    observer.observe(menu)

    const visualViewport =
      window.visualViewport

    window.addEventListener(
      'resize',
      positionMenu,
    )

    visualViewport?.addEventListener(
      'resize',
      positionMenu,
    )

    return () => {
      observer.disconnect()

      window.removeEventListener(
        'resize',
        positionMenu,
      )

      visualViewport?.removeEventListener(
        'resize',
        positionMenu,
      )
    }
  }, [
    positioned,
    positionMenu,
  ])

  // Keep the original Escape behaviour.
  useEffect(() => {
    const onKeyDown = (
      event: KeyboardEvent,
    ) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onSelect(null)
      }
    }

    window.addEventListener(
      'keydown',
      onKeyDown,
      true,
    )

    return () =>
      window.removeEventListener(
        'keydown',
        onKeyDown,
        true,
      )
  }, [onSelect])

  return createPortal(
    <div
      className={styles.layer}
      role="presentation"
      onMouseDown={(event) => {
        if (
          event.target ===
          event.currentTarget
        ) {
          onSelect(null)
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault()

        if (
          event.target ===
          event.currentTarget
        ) {
          onSelect(null)
        }
      }}
    >
      <div
        ref={menuRef}
        className={styles.menu}
        role="menu"
        style={{
          left: position.x,
          top: position.y,
          visibility:
            positioned
              ? 'visible'
              : 'hidden',
        }}
      >
        {menuItems.length > 0 ? (
          <MenuItems
            items={menuItems}
            onSelect={(commandId) =>
              onSelect(commandId)
            }
          />
        ) : (
          <div
            className={styles.empty}
          >
            {t('contextNoActions')}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
