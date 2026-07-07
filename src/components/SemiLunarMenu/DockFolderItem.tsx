import { useCallback, useEffect, useRef, useState } from 'react'
import type { Shortcut, ShortcutFolder } from '../../core/types'
import { DRAG_THRESHOLD } from '../../core/shortcutLayout'
import { ShortcutFolderIcon } from './ShortcutFolderIcon'
import styles from './SemiLunarMenu.module.css'

interface DockFolderItemProps {
  folder: ShortcutFolder
  members: Shortcut[]
  x: number
  y: number
  isDropHover: boolean
  isDropTarget: boolean
  merging: boolean
  anchorRef: React.RefObject<HTMLDivElement | null>
  onMove: (x: number, y: number, finalize: boolean) => void
  onOpen: () => void
  onDragStart: () => void
  onDragEnd: () => void
  onDragMove: (x: number, y: number) => void
}

export function DockFolderItem({
  folder,
  members,
  x,
  y,
  isDropHover,
  isDropTarget,
  merging,
  anchorRef,
  onMove,
  onOpen,
  onDragStart,
  onDragEnd,
  onDragMove,
}: DockFolderItemProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [dragPos, setDragPos] = useState({ x, y })
  const dragState = useRef({
    active: false,
    pointerId: -1,
    pointerOffsetX: 0,
    pointerOffsetY: 0,
    startClientX: 0,
    startClientY: 0,
    moved: false,
    lastX: x,
    lastY: y,
  })
  const moveRaf = useRef<number | null>(null)

  useEffect(() => {
    if (!isDragging) setDragPos({ x, y })
  }, [x, y, isDragging])

  const getLocalPosition = useCallback(
    (clientX: number, clientY: number) => {
      const anchor = anchorRef.current?.getBoundingClientRect()
      if (!anchor) return null
      return {
        x: clientX - anchor.left - dragState.current.pointerOffsetX,
        y: clientY - anchor.top - dragState.current.pointerOffsetY,
      }
    },
    [anchorRef],
  )

  const scheduleMove = useCallback(
    (nextX: number, nextY: number, finalize: boolean) => {
      dragState.current.lastX = nextX
      dragState.current.lastY = nextY
      if (finalize) {
        if (moveRaf.current !== null) cancelAnimationFrame(moveRaf.current)
        onMove(nextX, nextY, true)
        return
      }
      if (moveRaf.current !== null) return
      moveRaf.current = requestAnimationFrame(() => {
        moveRaf.current = null
        onMove(dragState.current.lastX, dragState.current.lastY, false)
      })
    },
    [onMove],
  )

  const processPointerMove = useCallback(
    (clientX: number, clientY: number) => {
      if (!dragState.current.active) return
      const local = getLocalPosition(clientX, clientY)
      if (!local) return
      const dx = clientX - dragState.current.startClientX
      const dy = clientY - dragState.current.startClientY
      if (!dragState.current.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        dragState.current.moved = true
        setIsDragging(true)
        onDragStart()
      }
      if (dragState.current.moved) {
        setDragPos(local)
        onDragMove(local.x, local.y)
        scheduleMove(local.x, local.y, false)
      }
    },
    [getLocalPosition, onDragMove, onDragStart, scheduleMove],
  )

  const finishDrag = useCallback(
    (clientX: number, clientY: number) => {
      if (!dragState.current.active) return
      const wasMoved = dragState.current.moved
      dragState.current.active = false
      if (wasMoved) {
        const local = getLocalPosition(clientX, clientY)
        if (local) {
          setDragPos(local)
          scheduleMove(local.x, local.y, true)
        }
        setIsDragging(false)
        onDragEnd()
      }
    },
    [getLocalPosition, onDragEnd, scheduleMove],
  )

  useEffect(() => {
    if (!isDragging) return
    const onWindowPointerMove = (e: PointerEvent) => {
      if (e.pointerId !== dragState.current.pointerId) return
      processPointerMove(e.clientX, e.clientY)
    }
    const onWindowPointerUp = (e: PointerEvent) => {
      if (e.pointerId !== dragState.current.pointerId) return
      if (dragState.current.moved) finishDrag(e.clientX, e.clientY)
      else dragState.current.active = false
    }
    window.addEventListener('pointermove', onWindowPointerMove)
    window.addEventListener('pointerup', onWindowPointerUp)
    window.addEventListener('pointercancel', onWindowPointerUp)
    return () => {
      window.removeEventListener('pointermove', onWindowPointerMove)
      window.removeEventListener('pointerup', onWindowPointerUp)
      window.removeEventListener('pointercancel', onWindowPointerUp)
    }
  }, [finishDrag, isDragging, processPointerMove])

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const anchor = anchorRef.current?.getBoundingClientRect()
    if (!anchor) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragState.current = {
      active: true,
      pointerId: e.pointerId,
      pointerOffsetX: e.clientX - anchor.left - x,
      pointerOffsetY: e.clientY - anchor.top - y,
      startClientX: e.clientX,
      startClientY: e.clientY,
      moved: false,
      lastX: x,
      lastY: y,
    }
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!dragState.current.active) return
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    if (dragState.current.moved) finishDrag(e.clientX, e.clientY)
    else {
      dragState.current.active = false
      onOpen()
    }
  }

  const visualX = isDragging ? dragPos.x : x
  const visualY = isDragging ? dragPos.y : y

  return (
    <div
      className={`${styles.shortcutWrap} ${isDragging ? styles.shortcutWrapDragging : ''} ${merging ? styles.shortcutWrapMerging : ''}`}
      style={{ left: `${visualX}px`, top: `${visualY}px` }}
    >
      <button
        type="button"
        className={[
          styles.shortcut,
          styles.shortcutFolder,
          isDragging ? styles.shortcutDragging : '',
          isDropHover ? styles.shortcutDropHover : '',
          isDropTarget ? styles.shortcutDropTarget : '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={{ transform: 'translate(-50%, -50%)' }}
        onPointerDown={handlePointerDown}
        onPointerMove={(e) => processPointerMove(e.clientX, e.clientY)}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        title={`${folder.name} klasörü`}
        tabIndex={-1}
      >
        <ShortcutFolderIcon
          members={members}
          merging={merging}
          dropHover={isDropHover}
          dropTarget={isDropTarget}
        />
      </button>
    </div>
  )
}
