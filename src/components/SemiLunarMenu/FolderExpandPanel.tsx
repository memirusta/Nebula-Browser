import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Shortcut } from '../../core/types'
import { DRAG_THRESHOLD } from '../../core/shortcutLayout'
import { useLocale } from '../../hooks/useLocale'
import styles from './FolderExpandPanel.module.css'

interface FolderExpandPanelProps {
  folderId: string
  folderName: string
  members: Shortcut[]
  anchorX: number
  anchorY: number
  onNavigate: (url: string, shortcutId?: string) => void
  onRenameFolder: (folderId: string, name: string) => void
  onClose: () => void

  onCloseShortcut: (shortcut: Shortcut) => void
  onContextMenu: (shortcut: Shortcut, x: number, y: number) => void
  closeBtnDelayMs?: number

  onRemoveFromFolder: (
    folderId: string,
    shortcutId: string,
    clientX: number,
    clientY: number,
  ) => void

  onDragStart?: () => void
  onDragEnd?: () => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
  previewOnHover?: boolean
  previewDelayMs?: number
  onPreviewShow?: (shortcut: Shortcut) => void
  onPreviewHide?: () => void
}

function FolderPanelItem({
  shortcut,
  panelRef,
  onNavigate,
  onClose,
  onDragOut,
  onCloseShortcut,
  onContextMenu,
  closeBtnDelayMs,
  onDragStart,
  onDragEnd,
  previewOnHover,
  previewDelayMs,
  onPreviewShow,
  onPreviewHide,
}: {
  shortcut: Shortcut
  panelRef: React.RefObject<HTMLDivElement | null>
  onNavigate: (url: string, shortcutId?: string) => void
  onClose: () => void
  onDragOut: (shortcutId: string, clientX: number, clientY: number) => void

  onCloseShortcut: () => void
  onContextMenu: (x: number, y: number) => void
  closeBtnDelayMs: number

  onDragStart?: () => void
  onDragEnd?: () => void
  previewOnHover: boolean
  previewDelayMs: number
  onPreviewShow?: (shortcut: Shortcut) => void
  onPreviewHide?: () => void
}) {
  const [isDragging, setIsDragging] = useState(false)
  const [ghostPos, setGhostPos] = useState({ x: 0, y: 0 })
  const [showCloseBtn, setShowCloseBtn] = useState(false)
  const dragState = useRef({
    active: false,
    pointerId: -1,
    startClientX: 0,
    startClientY: 0,
    moved: false,
  })
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeBtnTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearPreviewTimer = useCallback(() => {
    if (previewTimer.current) {
      clearTimeout(previewTimer.current)
      previewTimer.current = null
    }
  }, [])

  const clearCloseBtnTimer = useCallback(() => {
  if (closeBtnTimer.current) {
    clearTimeout(closeBtnTimer.current)
    closeBtnTimer.current = null
  }
}, [])

useEffect(
  () => () => {
    clearPreviewTimer()
    clearCloseBtnTimer()
  },
  [clearPreviewTimer, clearCloseBtnTimer],
)
  const finishDrag = useCallback(
    (clientX: number, clientY: number) => {
      const wasMoved = dragState.current.moved
      dragState.current.active = false
      dragState.current.moved = false
      setIsDragging(false)
      onDragEnd?.()
      if (!wasMoved) return

      const panel = panelRef.current?.getBoundingClientRect()
      const outside =
        !panel ||
        clientX < panel.left ||
        clientX > panel.right ||
        clientY < panel.top ||
        clientY > panel.bottom

      if (outside) {
        onDragOut(shortcut.id, clientX, clientY)
      }
    },
    [onDragEnd, onDragOut, panelRef, shortcut.id],
  )

  const processPointerMove = useCallback(
    (clientX: number, clientY: number) => {
      if (!dragState.current.active) return
      const dx = clientX - dragState.current.startClientX
      const dy = clientY - dragState.current.startClientY
      if (!dragState.current.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
  dragState.current.moved = true

  setShowCloseBtn(false)
  clearCloseBtnTimer()
  clearPreviewTimer()
  onPreviewHide?.()

  setIsDragging(true)
  onDragStart?.()
}
      if (dragState.current.moved) {
        setGhostPos({ x: clientX, y: clientY })
      }
    },
    [clearCloseBtnTimer, clearPreviewTimer, onDragStart, onPreviewHide],
  )

  const cancelPointerInteraction = useCallback(() => {
    if (!dragState.current.active) return

    const wasMoved = dragState.current.moved
    dragState.current.active = false
    dragState.current.moved = false

    setIsDragging(false)
    setShowCloseBtn(false)
    clearPreviewTimer()
    clearCloseBtnTimer()
    onPreviewHide?.()

    if (wasMoved) {
      onDragEnd?.()
    }
  }, [clearCloseBtnTimer, clearPreviewTimer, onDragEnd, onPreviewHide])

  useEffect(() => {
    if (!isDragging) return
    const onWindowPointerMove = (e: PointerEvent) => {
      if (e.pointerId !== dragState.current.pointerId) return
      processPointerMove(e.clientX, e.clientY)
    }
    const onWindowPointerUp = (e: PointerEvent) => {
      if (e.pointerId !== dragState.current.pointerId) return
      finishDrag(e.clientX, e.clientY)
    }
    const onWindowPointerCancel = (e: PointerEvent) => {
      if (e.pointerId !== dragState.current.pointerId) return
      cancelPointerInteraction()
    }
    window.addEventListener('pointermove', onWindowPointerMove)
    window.addEventListener('pointerup', onWindowPointerUp)
    window.addEventListener('pointercancel', onWindowPointerCancel)
    return () => {
      window.removeEventListener('pointermove', onWindowPointerMove)
      window.removeEventListener('pointerup', onWindowPointerUp)
      window.removeEventListener('pointercancel', onWindowPointerCancel)
    }
  }, [cancelPointerInteraction, finishDrag, isDragging, processPointerMove])

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    clearPreviewTimer()
    onPreviewHide?.()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragState.current = {
      active: true,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      moved: false,
    }
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    processPointerMove(e.clientX, e.clientY)
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!dragState.current.active) return
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    if (dragState.current.moved) {
      finishDrag(e.clientX, e.clientY)
    } else {
      dragState.current.active = false
      onNavigate(shortcut.url, shortcut.id)
      onClose()
    }
  }
  
  
  const handlePointerCancel = (e: React.PointerEvent) => {
    if (!dragState.current.active) return
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    cancelPointerInteraction()
  }

  const handleWrapEnter = () => {
  if (isDragging) return

  clearCloseBtnTimer()

  closeBtnTimer.current = setTimeout(() => {
    setShowCloseBtn(true)
  }, closeBtnDelayMs)
}

const handleWrapLeave = () => {
  setShowCloseBtn(false)
  clearCloseBtnTimer()
  clearPreviewTimer()
  onPreviewHide?.()
}

const handleContextMenu = (e: React.MouseEvent) => {
  e.preventDefault()
  e.stopPropagation()

  if (isDragging) return

  clearCloseBtnTimer()
  clearPreviewTimer()
  onPreviewHide?.()

  onContextMenu(e.clientX, e.clientY)
}

const handleClosePointerDown = (e: React.PointerEvent) => {
  e.preventDefault()
  e.stopPropagation()

  setShowCloseBtn(false)
  clearCloseBtnTimer()
  clearPreviewTimer()
  onPreviewHide?.()

  onCloseShortcut()
}


  const handleMouseEnter = () => {
    if (isDragging) return
    clearPreviewTimer()
    if (previewOnHover && onPreviewShow) {
      previewTimer.current = setTimeout(() => onPreviewShow(shortcut), previewDelayMs)
    }
  }

  const handleMouseLeave = () => {
    clearPreviewTimer()
    onPreviewHide?.()
  }

return (
  <>
    <div
      className={styles.itemWrap}
      onMouseEnter={handleWrapEnter}
      onMouseLeave={handleWrapLeave}
      onContextMenu={handleContextMenu}
    >
      <button
        type="button"
        className={[
          styles.item,
          isDragging ? styles.itemDragging : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onContextMenu={handleContextMenu}
        aria-label={shortcut.label}
      >
        {shortcut.favicon ? (
          <img
            src={shortcut.favicon}
            alt=""
            draggable={false}
          />
        ) : (
          <span>{shortcut.label[0]}</span>
        )}

        <span className={styles.label}>
          {shortcut.label}
        </span>
      </button>

      {showCloseBtn && !isDragging && (
        <button
          type="button"
          className={styles.closeBtn}
          onPointerDown={handleClosePointerDown}
          aria-label={`Close ${shortcut.label}`}
          title={`Close ${shortcut.label}`}
        >
          ✕
        </button>
      )}
    </div>

    {isDragging &&
      createPortal(
        <div
          className={styles.dragGhost}
          style={{
            left: `${ghostPos.x}px`,
            top: `${ghostPos.y}px`,
          }}
          aria-hidden="true"
        >
          {shortcut.favicon ? (
            <img
              src={shortcut.favicon}
              alt=""
              draggable={false}
            />
          ) : (
            <span>{shortcut.label[0]}</span>
          )}
        </div>,
        document.body,
      )}
  </>
)
}

export function FolderExpandPanel({
  folderId,
  folderName,
  members,
  anchorX,
  anchorY,
  onNavigate,
  onRenameFolder,
  onClose,
  onRemoveFromFolder,

  onCloseShortcut,
  onContextMenu,
  closeBtnDelayMs = 500,

  onDragStart,
  onDragEnd,
  onMouseEnter,
  onMouseLeave,
  previewOnHover = true,
  previewDelayMs = 1000,
  onPreviewShow,
  onPreviewHide,
}: FolderExpandPanelProps) {
  const { t, tf } = useLocale()
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(folderName)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const isEditingRef = useRef(false)

  useEffect(() => {
    isEditingRef.current = isEditing
  }, [isEditing])

  useEffect(() => {
    if (!isEditing) setEditValue(folderName)
  }, [folderName, isEditing])

  useEffect(() => {
    if (!isEditing) return
    const input = inputRef.current
    if (!input) return
    input.focus()
    input.select()
  }, [isEditing])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isEditingRef.current) {
          e.stopPropagation()
          setEditValue(folderName)
          setIsEditing(false)
          return
        }
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [folderName, onClose])

  const commitRename = useCallback(() => {
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== folderName) {
      onRenameFolder(folderId, trimmed)
    }
    setIsEditing(false)
  }, [editValue, folderId, folderName, onRenameFolder])

  const cancelRename = useCallback(() => {
    setEditValue(folderName)
    setIsEditing(false)
  }, [folderName])

  const handleDragOut = useCallback(
    (shortcutId: string, clientX: number, clientY: number) => {
      onRemoveFromFolder(folderId, shortcutId, clientX, clientY)
    },
    [folderId, onRemoveFromFolder],
  )

  const panelWidth = 220
  const left = Math.min(Math.max(16, anchorX - panelWidth / 2), window.innerWidth - panelWidth - 16)

  return createPortal(
    <>
      <div className={styles.backdrop} onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        className={styles.panel}
        style={{ left: `${left}px`, top: `${anchorY + 28}px` }}
        role="dialog"
        aria-label={tf('folderTitle', { name: folderName })}
        data-semi-lunar-safe=""
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        {isEditing ? (
          <input
            ref={inputRef}
            className={styles.titleInput}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitRename()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                cancelRename()
              }
            }}
            aria-label={t('folderNameLabel')}
          />
        ) : (
          <button
            type="button"
            className={styles.title}
            onClick={() => setIsEditing(true)}
            title={t('folderRename')}
          >
            {folderName}
          </button>
        )}
        <div className={styles.grid}>
          {members.map((s) => (
            <FolderPanelItem
              key={s.id}
              shortcut={s}
              panelRef={panelRef}
              onNavigate={onNavigate}
              onClose={onClose}
              onDragOut={handleDragOut}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onCloseShortcut={() => onCloseShortcut(s)}
              onContextMenu={(x, y) => onContextMenu(s, x, y)}
              closeBtnDelayMs={closeBtnDelayMs} 
              previewOnHover={previewOnHover}
              previewDelayMs={previewDelayMs}
              onPreviewShow={onPreviewShow}
              onPreviewHide={onPreviewHide}
            />
          ))}
        </div>
      </div>
    </>,
    document.body,
  )
}
