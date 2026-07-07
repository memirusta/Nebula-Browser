import { useCallback, useRef, type ReactNode } from 'react'
import { clampModuleOffset, type ModuleOffset, type ModuleSize } from '../../core/homeLayout'
import styles from './EditModuleChrome.module.css'

const SIZES: ModuleSize[] = ['s', 'm', 'l']

interface EditModuleChromeProps {
  label: string
  visible?: boolean
  onToggleVisible?: () => void
  size?: ModuleSize
  onSizeChange?: (size: ModuleSize) => void
  reorderHint?: boolean
  positionHint?: boolean
  offset?: ModuleOffset
  onOffsetChange?: (offset: ModuleOffset) => void
  controlsAtBottom?: boolean
  hidden?: boolean
  children: ReactNode
}

export function EditModuleChrome({
  label,
  visible = true,
  onToggleVisible,
  size,
  onSizeChange,
  reorderHint = false,
  positionHint = false,
  offset,
  onOffsetChange,
  controlsAtBottom = false,
  hidden = false,
  children,
}: EditModuleChromeProps) {
  const dragRef = useRef<{
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)

  const isDraggable = Boolean(onOffsetChange && offset)

  const handleLabelPointerDown = useCallback(
    (e: React.PointerEvent<HTMLSpanElement>) => {
      if (!isDraggable || !offset || !onOffsetChange) return
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      e.currentTarget.setPointerCapture(e.pointerId)
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        originX: offset.x,
        originY: offset.y,
      }
    },
    [isDraggable, offset, onOffsetChange],
  )

  const handleLabelPointerMove = useCallback(
    (e: React.PointerEvent<HTMLSpanElement>) => {
      if (!dragRef.current || !onOffsetChange) return
      const dx = e.clientX - dragRef.current.startX
      const dy = e.clientY - dragRef.current.startY
      onOffsetChange(
        clampModuleOffset(dragRef.current.originX + dx, dragRef.current.originY + dy),
      )
    },
    [onOffsetChange],
  )

  const handleLabelPointerUp = useCallback((e: React.PointerEvent<HTMLSpanElement>) => {
    if (!dragRef.current) return
    dragRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }, [])

  return (
    <div
      className={[styles.wrapper, hidden ? styles.wrapperHidden : ''].filter(Boolean).join(' ')}
      style={
        offset
          ? { transform: `translate(${offset.x}px, ${offset.y}px)` }
          : undefined
      }
    >
      <div className={styles.frame}>
        <div
          className={[
            styles.controls,
            controlsAtBottom ? styles.controlsBottom : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <span
            className={[styles.label, isDraggable ? styles.labelDraggable : '']
              .filter(Boolean)
              .join(' ')}
            onPointerDown={handleLabelPointerDown}
            onPointerMove={handleLabelPointerMove}
            onPointerUp={handleLabelPointerUp}
            onPointerCancel={handleLabelPointerUp}
            title={isDraggable ? 'Sürükleyerek taşı' : undefined}
          >
            {isDraggable && <span className={styles.dragGrip} aria-hidden="true" />}
            {label}
          </span>
          {onToggleVisible && (
            <button
              type="button"
              className={[
                styles.toggleBtn,
                visible ? styles.toggleBtnActive : styles.toggleBtnOff,
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={onToggleVisible}
              aria-pressed={visible}
            >
              {visible ? 'Görünür' : 'Gizli'}
            </button>
          )}
          {onSizeChange &&
            SIZES.map((s) => (
              <button
                key={s}
                type="button"
                className={[styles.sizeBtn, size === s ? styles.sizeBtnActive : '']
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => onSizeChange(s)}
                aria-pressed={size === s}
              >
                {s.toUpperCase()}
              </button>
            ))}
        </div>
        <div className={styles.frameInner}>{children}</div>
      </div>
      {reorderHint && <span className={styles.hint}>Sürükleyerek sırala</span>}
      {positionHint && <span className={styles.hint}>Etiketten tutup sürükle</span>}
    </div>
  )
}
