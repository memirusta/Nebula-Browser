import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ModuleSize } from '../../core/homeLayout'
import type { BrowseSession } from '../../core/browseSession'
import { MODULE_SIZE_SCALE } from '../../core/homeLayout'
import type { Shortcut } from '../../core/types'
import { ShortcutContextMenu } from '../SemiLunarMenu/ShortcutContextMenu'
import { ShortcutPreviewOverlay } from '../SemiLunarMenu/ShortcutPreviewOverlay'
import { DEFAULT_NEBULA_SETTINGS } from '../../core/nebulaSettings'
import styles from './PinnedStrip.module.css'

const HOLD_MS = 1000
const HOLD_CANCEL_PX = 12
const UNLOCK_ANIM_MS = 420

interface PinnedStripProps {
  shortcuts: Shortcut[]
  onNavigate: (url: string) => void
  onUnpin: (id: string) => void
  onReorder: (fromIndex: number, toIndex: number) => void
  isMuted?: (id: string) => boolean
  onToggleMute?: (id: string) => void
  onRemoveShortcut?: (id: string) => void
  previewOnHover?: boolean
  previewDelayMs?: number
  onShortcutInteractionChange?: (active: boolean) => void
  activeUrl?: string | null
  getSession?: (url: string) => BrowseSession | null
  editMode?: boolean
  size?: ModuleSize
}

type DisplayItem = {
  shortcut: Shortcut
  isPlaceholder: boolean
  sourceIndex: number
}

function buildPreviewItems(
  shortcuts: Shortcut[],
  from: number,
  placeholderSlot: number,
): DisplayItem[] {
  const without = shortcuts
    .map((shortcut, sourceIndex) => ({ shortcut, sourceIndex }))
    .filter(({ sourceIndex }) => sourceIndex !== from)

  const result: DisplayItem[] = []
  let withoutIdx = 0

  for (let slot = 0; slot < shortcuts.length; slot++) {
    if (slot === placeholderSlot) {
      result.push({
        shortcut: shortcuts[from],
        isPlaceholder: true,
        sourceIndex: from,
      })
    } else {
      result.push({
        shortcut: without[withoutIdx].shortcut,
        isPlaceholder: false,
        sourceIndex: without[withoutIdx].sourceIndex,
      })
      withoutIdx++
    }
  }

  return result
}

export function PinnedStrip({
  shortcuts,
  onNavigate,
  onUnpin,
  onReorder,
  isMuted = () => false,
  onToggleMute,
  onRemoveShortcut,
  previewOnHover = DEFAULT_NEBULA_SETTINGS.semiLunar.previewOnHover,
  previewDelayMs = DEFAULT_NEBULA_SETTINGS.semiLunar.previewDelayMs,
  onShortcutInteractionChange,
  activeUrl = null,
  getSession,
  editMode = false,
  size = 'm',
}: PinnedStripProps) {
  const listRef = useRef<HTMLUListElement>(null)
  const [previewShortcut, setPreviewShortcut] = useState<Shortcut | null>(null)
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    shortcut: Shortcut
    x: number
    y: number
  } | null>(null)
  const [holdIndex, setHoldIndex] = useState<number | null>(null)
  const [unlockIndex, setUnlockIndex] = useState<number | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropTarget, setDropTarget] = useState<number | null>(null)
  const [ghostPos, setGhostPos] = useState({ x: 0, y: 0 })

  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const unlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const holdStartRef = useRef({ x: 0, y: 0 })
  const holdIndexRef = useRef<number | null>(null)
  const suppressClickRef = useRef(false)
  const dragIndexRef = useRef<number | null>(null)
  const dropTargetRef = useRef<number | null>(null)
  const pointerCaptureRef = useRef<HTMLButtonElement | null>(null)
  const capturedPointerIdRef = useRef<number | null>(null)

  const clearPreviewTimer = useCallback(() => {
    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current)
      previewTimerRef.current = null
    }
  }, [])

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
  }, [])

  const clearUnlockTimer = useCallback(() => {
    if (unlockTimerRef.current) {
      clearTimeout(unlockTimerRef.current)
      unlockTimerRef.current = null
    }
  }, [])

  const hidePreview = useCallback(() => {
    clearPreviewTimer()
    setPreviewShortcut(null)
  }, [clearPreviewTimer])

  const resetDragState = useCallback(() => {
    clearHoldTimer()
    clearUnlockTimer()
    hidePreview()
    holdIndexRef.current = null
    if (pointerCaptureRef.current && capturedPointerIdRef.current !== null) {
      try {
        pointerCaptureRef.current.releasePointerCapture(capturedPointerIdRef.current)
      } catch {
        /* already released */
      }
      pointerCaptureRef.current = null
      capturedPointerIdRef.current = null
    }
    setHoldIndex(null)
    setUnlockIndex(null)
    setDragIndex(null)
    setDropTarget(null)
    dragIndexRef.current = null
    dropTargetRef.current = null
  }, [clearHoldTimer, clearUnlockTimer, hidePreview])

  const activateDrag = useCallback(
    (index: number) => {
      hidePreview()
      clearHoldTimer()
      setHoldIndex(null)
      setUnlockIndex(index)
      setDragIndex(index)
      dragIndexRef.current = index
      dropTargetRef.current = index
      setDropTarget(index)
      setGhostPos({ x: holdStartRef.current.x, y: holdStartRef.current.y })
      suppressClickRef.current = true

      clearUnlockTimer()
      unlockTimerRef.current = setTimeout(() => {
        setUnlockIndex(null)
        unlockTimerRef.current = null
      }, UNLOCK_ANIM_MS)
    },
    [clearHoldTimer, clearUnlockTimer, hidePreview],
  )

  const resolveDropTarget = useCallback((clientX: number) => {
    const list = listRef.current
    if (!list) return dropTargetRef.current ?? 0

    const items = list.querySelectorAll<HTMLElement>('[data-drop-slot]')
    if (items.length === 0) return 0

    const readSlot = (el: HTMLElement) => {
      const value = Number(el.dataset.slotIndex)
      return Number.isNaN(value) ? null : value
    }

    const firstRect = items[0].getBoundingClientRect()
    const lastRect = items[items.length - 1].getBoundingClientRect()

    if (clientX <= firstRect.left) {
      return readSlot(items[0]) ?? 0
    }
    if (clientX >= lastRect.right) {
      return readSlot(items[items.length - 1]) ?? items.length - 1
    }

    let nearestSlot = readSlot(items[0]) ?? 0
    let nearestDist = Infinity

    for (let i = 0; i < items.length; i++) {
      const rect = items[i].getBoundingClientRect()
      const center = rect.left + rect.width / 2
      const dist = Math.abs(clientX - center)
      if (dist < nearestDist) {
        nearestDist = dist
        const slot = readSlot(items[i])
        if (slot !== null) nearestSlot = slot
      }
    }

    return nearestSlot
  }, [])

  const displayItems = useMemo((): DisplayItem[] => {
    if (dragIndex === null || dropTarget === null) {
      return shortcuts.map((shortcut, sourceIndex) => ({
        shortcut,
        isPlaceholder: false,
        sourceIndex,
      }))
    }
    return buildPreviewItems(shortcuts, dragIndex, dropTarget)
  }, [shortcuts, dragIndex, dropTarget])

  useEffect(() => {
    if (holdIndex === null && dragIndex === null) return

    const onPointerMove = (e: PointerEvent) => {
      if (holdIndex !== null && dragIndexRef.current === null) {
        const dx = e.clientX - holdStartRef.current.x
        const dy = e.clientY - holdStartRef.current.y
        if (Math.hypot(dx, dy) > HOLD_CANCEL_PX) {
          clearHoldTimer()
          holdIndexRef.current = null
          setHoldIndex(null)
        }
        return
      }

      if (dragIndexRef.current === null) return
      setGhostPos({ x: e.clientX, y: e.clientY })
      const target = resolveDropTarget(e.clientX)
      if (target !== dropTargetRef.current) {
        dropTargetRef.current = target
        setDropTarget(target)
      }
    }

    const onPointerUp = () => {
      if (dragIndexRef.current !== null) {
        const from = dragIndexRef.current
        const to = dropTargetRef.current
        if (to !== null && to !== from) {
          onReorder(from, to)
        }
      }

      resetDragState()
      window.setTimeout(() => {
        suppressClickRef.current = false
      }, 0)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }
  }, [holdIndex, dragIndex, clearHoldTimer, onReorder, resetDragState, resolveDropTarget])

  useEffect(() => () => resetDragState(), [resetDragState])

  useEffect(() => () => clearPreviewTimer(), [clearPreviewTimer])

  const previewActive = previewShortcut !== null

  useEffect(() => {
    onShortcutInteractionChange?.(previewActive)
  }, [previewActive, onShortcutInteractionChange])

  useEffect(() => {
    return () => onShortcutInteractionChange?.(false)
  }, [onShortcutInteractionChange])

  const handlePinEnter = useCallback(
    (shortcut: Shortcut) => {
      if (editMode) return
      if (dragIndexRef.current !== null || holdIndexRef.current !== null) return
      clearPreviewTimer()
      if (!previewOnHover) return
      previewTimerRef.current = setTimeout(() => {
        setPreviewShortcut(shortcut)
      }, previewDelayMs)
    },
    [clearPreviewTimer, previewDelayMs, previewOnHover, editMode],
  )

  const handlePinLeave = useCallback(() => {
    hidePreview()
  }, [hidePreview])

  const handleContextMenu = useCallback(
    (shortcut: Shortcut, e: React.MouseEvent) => {
      if (editMode) return
      e.preventDefault()
    e.stopPropagation()
    setContextMenu({ shortcut, x: e.clientX, y: e.clientY })
  },
  [editMode],
)

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0 || dragIndexRef.current !== null) return

      const li = e.currentTarget.closest<HTMLElement>('[data-pin-index]')
      if (!li) return
      const index = Number(li.dataset.pinIndex)
      if (Number.isNaN(index)) return

      e.preventDefault()
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
        pointerCaptureRef.current = e.currentTarget
        capturedPointerIdRef.current = e.pointerId
      } catch {
        /* pointer capture unsupported */
      }

      holdStartRef.current = { x: e.clientX, y: e.clientY }
      holdIndexRef.current = index
      setHoldIndex(index)
      hidePreview()
      clearHoldTimer()
      holdTimerRef.current = setTimeout(() => {
        const held = holdIndexRef.current
        if (held !== null) activateDrag(held)
      }, HOLD_MS)
    },
    [activateDrag, clearHoldTimer, hidePreview],
  )

  const handleOpen = useCallback(
    (url: string) => {
      if (editMode || suppressClickRef.current) return
      onNavigate(url)
    },
    [editMode, onNavigate],
  )

  if (shortcuts.length === 0) return null

  const scale = MODULE_SIZE_SCALE[size]
  const sizeStyle = {
    '--pin-scale': String(scale),
  } as React.CSSProperties

  const draggedShortcut = dragIndex !== null ? shortcuts[dragIndex] : null
  const isDragging = dragIndex !== null

  return (
    <>
      {draggedShortcut &&
        createPortal(
          <div
            className={styles.dragGhost}
            style={{ left: `${ghostPos.x}px`, top: `${ghostPos.y}px` }}
            aria-hidden="true"
          >
            {draggedShortcut.favicon ? (
              <img src={draggedShortcut.favicon} alt="" draggable={false} />
            ) : (
              <span>{draggedShortcut.label.charAt(0)}</span>
            )}
          </div>,
          document.body,
        )}

      <nav className={styles.strip} aria-label="Sabitlenen siteler" style={sizeStyle}>
        <ul
          ref={listRef}
          className={[
            styles.list,
            isDragging ? styles.listDragging : '',
            previewActive ? styles.listPreviewActive : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {displayItems.map(({ shortcut, isPlaceholder, sourceIndex }, slotIndex) => {
            if (isPlaceholder) {
              return (
                <li
                  key={`${shortcut.id}-placeholder`}
                  className={`${styles.item} ${styles.itemPlaceholder}`}
                  data-drop-slot
                  data-slot-index={slotIndex}
                  aria-hidden="true"
                >
                  <div className={styles.placeholderSlot}>
                    <span className={styles.placeholderIcon} />
                  </div>
                </li>
              )
            }

            const isHolding = holdIndex === sourceIndex
            const isUnlocking = unlockIndex === sourceIndex
            const isPreviewing = previewShortcut?.id === shortcut.id

            return (
              <li
                key={shortcut.id}
                data-pin-index={sourceIndex}
                data-drop-slot
                data-slot-index={slotIndex}
                className={[styles.item, isPreviewing ? styles.itemPreviewing : '']
                  .filter(Boolean)
                  .join(' ')}
              >
                <button
                  type="button"
                  className={[
                    styles.pinBtn,
                    isHolding ? styles.pinBtnHolding : '',
                    isUnlocking ? styles.pinBtnUnlock : '',
                    isDragging ? styles.pinBtnIdleWhileDrag : '',
                    isMuted(shortcut.id) ? styles.pinBtnMuted : '',
                    isPreviewing ? styles.pinBtnPreviewing : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onPointerDown={handlePointerDown}
                  onMouseEnter={() => handlePinEnter(shortcut)}
                  onMouseLeave={handlePinLeave}
                  onClick={() => handleOpen(shortcut.url)}
                  onContextMenu={(e) => handleContextMenu(shortcut, e)}
                  aria-label={`${shortcut.label} — sabitlenmiş${isPreviewing ? ', önizleniyor' : ''}`}
                  title={isHolding ? 'Sürüklemek için basılı tut…' : shortcut.label}
                >
                  <span className={styles.iconShell}>
                    {isHolding && (
                      <svg
                        className={styles.holdRing}
                        viewBox="0 0 52 52"
                        aria-hidden="true"
                      >
                        <circle className={styles.holdRingTrack} cx="26" cy="26" r="23" />
                        <circle className={styles.holdRingProgress} cx="26" cy="26" r="23" />
                      </svg>
                    )}
                    {isUnlocking && <span className={styles.unlockBurst} aria-hidden="true" />}
                    <span className={styles.iconWrap}>
                      {shortcut.favicon ? (
                        <img
                          src={shortcut.favicon}
                          alt=""
                          className={styles.favicon}
                          draggable={false}
                        />
                      ) : (
                        <span className={styles.fallback}>{shortcut.label.charAt(0)}</span>
                      )}
                    </span>
                  </span>
                  <span className={styles.label}>{shortcut.label}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </nav>

      <ShortcutPreviewOverlay
        shortcut={previewShortcut}
        visible={previewShortcut !== null}
        activeUrl={activeUrl}
        session={previewShortcut ? (getSession?.(previewShortcut.url) ?? null) : null}
      />

      {contextMenu && (
        <ShortcutContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          shortcut={contextMenu.shortcut}
          isMuted={isMuted(contextMenu.shortcut.id)}
          isPinned
          canPinMore={false}
          onClose={() => setContextMenu(null)}
          onRemove={() => onRemoveShortcut?.(contextMenu.shortcut.id)}
          onToggleMute={() => onToggleMute?.(contextMenu.shortcut.id)}
          onOpenNewTab={() => onNavigate(contextMenu.shortcut.url)}
          onTogglePin={() => onUnpin(contextMenu.shortcut.id)}
        />
      )}
    </>
  )
}
