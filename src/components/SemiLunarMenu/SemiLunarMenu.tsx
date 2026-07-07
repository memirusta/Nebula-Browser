import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Shortcut, ShortcutFolder } from '../../core/types'
import { folderDockId, isFolderDockId, parseFolderDockId } from '../../core/types'
import { findDropTarget } from '../../core/shortcutDrop'
import {
  buildParallelRimPath,
  createLunarMetrics,
  LUNAR_INNER_RIM_OFFSET,
  LUNAR_RIM_CLIP_Y,
} from '../../core/lunarShape'
import { DRAG_THRESHOLD, clampToBounds, type ShortcutPosition } from '../../core/shortcutLayout'
import {
  buildBrowsingVisibleDockItemIds,
  openTabIdForDockId,
} from '../../core/browsingDock'
import { hostKeyForShortcut } from '../../core/shortcutFromUrl'
import type { BrowseSession } from '../../core/browseSession'
import type { BrowserTab } from '../../core/browserTab'
import type { RemoveMemberResult } from '../../hooks/useShortcutFolders'
import { useShortcutPositions } from '../../hooks/useShortcutPositions'
import { truncateTabTitle } from '../../core/browserTab'
import { DEFAULT_NEBULA_SETTINGS } from '../../core/nebulaSettings'
import { isChromeShell } from '../../core/nebulaBridge'
import type { ShellViewMode } from '../../core/nebulaBridge'
import { isTauri } from '../../platform/runtime'
import { debounce } from '../../platform/debounce'
import { expandShellHitRegionToFitBottom, syncChromeShellLayout } from '../../platform/tauriShell'
import { useLocale } from '../../hooks/useLocale'
import { ShortcutContextMenu } from './ShortcutContextMenu'
import { ShortcutPreviewOverlay } from './ShortcutPreviewOverlay'
import { DockFolderItem } from './DockFolderItem'
import { FolderExpandPanel } from './FolderExpandPanel'
import { ShortcutFolderIcon } from './ShortcutFolderIcon'
import styles from './SemiLunarMenu.module.css'

type MenuMode = 'home' | 'browsing' | 'overlay'
type MenuStage = 'closed' | 'expanded'

interface SemiLunarMenuProps {
  shortcuts: Shortcut[]
  dockItemIds: string[]
  folders: ShortcutFolder[]
  onCreateFolder: (sourceId: string, targetShortcutId: string) => string | null
  onAddToFolder: (folderDockId: string, shortcutId: string) => boolean
  onRenameFolder: (folderId: string, name: string) => void
  onNavigate: (url: string, shortcutId?: string) => void
  onRemoveShortcut?: (id: string) => void
  onCloseTab?: (id: string) => void
  openTabIds?: string[]
  activeTabId?: string | null
  getTab?: (shortcutId: string) => BrowserTab | null
  onToggleMute?: (id: string) => void
  isMuted?: (id: string) => boolean
  isPinned?: (id: string) => boolean
  onTogglePin?: (id: string) => void
  canPinMore?: boolean
  previewOnHover?: boolean
  homeAlwaysOpen?: boolean
  browsingHoverOpen?: boolean
  browsingOpenDelayMs?: number
  closeDelayMs?: number
  previewDelayMs?: number
  closeBtnDelayMs?: number
  folderMergeHoldMs?: number
  mergeAnimMs?: number
  iconSizePx?: number
  lunarWidthPx?: number
  lunarHeightPx?: number
  onRemoveMemberFromFolder?: (
    folderId: string,
    shortcutId: string,
  ) => RemoveMemberResult | null
  mode?: MenuMode
  shellViewMode?: ShellViewMode
  onHomeClick?: () => void
  onBackClick?: () => void
  forceOpen?: boolean
  chromeQuickMenuOpen?: boolean
  onShortcutInteractionChange?: (active: boolean) => void
  activeUrl?: string | null
  getSession?: (url: string) => BrowseSession | null
}

export function SemiLunarMenu({
  shortcuts,
  dockItemIds,
  folders,
  onCreateFolder,
  onAddToFolder,
  onRenameFolder,
  onNavigate,
  onRemoveShortcut,
  onCloseTab,
  openTabIds = [],
  activeTabId = null,
  getTab,
  onToggleMute,
  isMuted = () => false,
  isPinned = () => false,
  onTogglePin,
  canPinMore = true,
  previewOnHover = true,
  homeAlwaysOpen = DEFAULT_NEBULA_SETTINGS.semiLunar.homeAlwaysOpen,
  browsingHoverOpen = DEFAULT_NEBULA_SETTINGS.semiLunar.browsingHoverOpen,
  browsingOpenDelayMs = DEFAULT_NEBULA_SETTINGS.semiLunar.browsingOpenDelayMs,
  closeDelayMs = DEFAULT_NEBULA_SETTINGS.semiLunar.closeDelayMs,
  previewDelayMs = DEFAULT_NEBULA_SETTINGS.semiLunar.previewDelayMs,
  closeBtnDelayMs = DEFAULT_NEBULA_SETTINGS.semiLunar.closeBtnDelayMs,
  folderMergeHoldMs = DEFAULT_NEBULA_SETTINGS.semiLunar.folderMergeHoldMs,
  mergeAnimMs = DEFAULT_NEBULA_SETTINGS.semiLunar.mergeAnimMs,
  iconSizePx = DEFAULT_NEBULA_SETTINGS.semiLunar.iconSizePx,
  lunarWidthPx = DEFAULT_NEBULA_SETTINGS.semiLunar.lunarWidthPx,
  lunarHeightPx = DEFAULT_NEBULA_SETTINGS.semiLunar.lunarHeightPx,
  onRemoveMemberFromFolder,
  mode = 'home',
  shellViewMode = 'browsing',
  onHomeClick,
  onBackClick,
  forceOpen = false,
  chromeQuickMenuOpen = false,
  onShortcutInteractionChange,
  activeUrl = null,
  getSession,
}: SemiLunarMenuProps) {
  const { t, tf } = useLocale()
  const isHome = mode === 'home'
  const isBrowsing = mode === 'browsing'
  const [stage, setStage] = useState<MenuStage>(
    isHome && homeAlwaysOpen ? 'expanded' : 'closed',
  )
  const [previewShortcut, setPreviewShortcut] = useState<Shortcut | null>(null)
  const [openFolderId, setOpenFolderId] = useState<string | null>(null)
  const [mergeAnim, setMergeAnim] = useState<{
    sourceId: string
    targetId: string
    sourceX: number
    sourceY: number
    targetX: number
    targetY: number
    sourceShortcut: Shortcut
    targetShortcut: Shortcut
  } | null>(null)
  const [newFolderId, setNewFolderId] = useState<string | null>(null)
  const [dragHover, setDragHover] = useState<{ id: string; x: number; y: number } | null>(null)
  const [mergeReady, setMergeReady] = useState<{ sourceId: string; targetId: string } | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    shortcut: Shortcut
    x: number
    y: number
  } | null>(null)
  const [isAnyDragging, setIsAnyDragging] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mergeHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mergeHoldTargetRef = useRef<string | null>(null)
  const mergeStartedRef = useRef(false)
  const dragHoverRef = useRef(dragHover)
  const positionsRef = useRef<ShortcutPosition[]>([])
  const isDraggingRef = useRef(false)
  const contextMenuOpenRef = useRef(false)
  const contextMenuHoverRef = useRef(false)
  const folderPanelHoverRef = useRef(false)
  const folderOpenRef = useRef(false)
  const anchorRef = useRef<HTMLDivElement>(null)

  const lunarMetrics = useMemo(
    () => createLunarMetrics(lunarWidthPx, lunarHeightPx),
    [lunarWidthPx, lunarHeightPx],
  )
  const innerRimPath = useMemo(
    () => buildParallelRimPath(LUNAR_INNER_RIM_OFFSET, 48, 2, lunarMetrics),
    [lunarMetrics],
  )

  const shortcutMap = useMemo(() => {
    const m = new Map<string, Shortcut>()
    for (const s of shortcuts) m.set(s.id, s)
    return m
  }, [shortcuts])

  const folderMap = useMemo(() => {
    const m = new Map<string, ShortcutFolder>()
    for (const f of folders) m.set(f.id, f)
    return m
  }, [folders])

  const visibleDockItemIds = useMemo(() => {
    if (!isBrowsing) return dockItemIds
    return buildBrowsingVisibleDockItemIds(dockItemIds, openTabIds, folders, shortcutMap)
  }, [isBrowsing, dockItemIds, openTabIds, folders, shortcutMap])

  const { positions, moveShortcut, removePosition, setPosition, replacePositionId } =
    useShortcutPositions(visibleDockItemIds, iconSizePx, lunarWidthPx, lunarHeightPx)

  dragHoverRef.current = dragHover
  positionsRef.current = positions

  const dropTargetId =
    dragHover && !mergeAnim
      ? findDropTarget(positions, dragHover.id, dragHover.x, dragHover.y, iconSizePx)
      : null

  const shrinkTargetId = mergeReady?.targetId ?? null

  const clearMergeHoldTimer = useCallback(() => {
    if (mergeHoldTimerRef.current) {
      clearTimeout(mergeHoldTimerRef.current)
      mergeHoldTimerRef.current = null
    }
    mergeHoldTargetRef.current = null
    setMergeReady(null)
  }, [])

  const completeMerge = useCallback(
    (sourceId: string, targetDockId: string, targetX: number, targetY: number) => {
      if (isFolderDockId(targetDockId)) {
        if (onAddToFolder(targetDockId, sourceId)) {
          removePosition(sourceId)
        }
        return
      }
      const newDockId = onCreateFolder(sourceId, targetDockId)
      if (!newDockId) return
      removePosition(sourceId)
      removePosition(targetDockId)
      setPosition(newDockId, targetX, targetY)
      setNewFolderId(parseFolderDockId(newDockId))
      setTimeout(() => setNewFolderId(null), 500)
    },
    [onAddToFolder, onCreateFolder, removePosition, setPosition],
  )

  const startMerge = useCallback(
    (sourceId: string, targetId: string, sourceX: number, sourceY: number) => {
      if (mergeStartedRef.current || isFolderDockId(sourceId)) return

      const sourceShortcut = shortcutMap.get(sourceId)
      const targetPos = positions.find((p) => p.id === targetId)
      if (!sourceShortcut || !targetPos) return

      let targetShortcut: Shortcut | undefined

      if (isFolderDockId(targetId)) {
        const folder = folderMap.get(parseFolderDockId(targetId))
        if (!folder) return
        targetShortcut = shortcutMap.get(folder.members[0]) ?? sourceShortcut
      } else {
        targetShortcut = shortcutMap.get(targetId)
        if (!targetShortcut) return
      }

      mergeStartedRef.current = true
      clearMergeHoldTimer()
      setDragHover(null)

      setMergeAnim({
        sourceId,
        targetId,
        sourceX,
        sourceY,
        targetX: targetPos.x,
        targetY: targetPos.y,
        sourceShortcut,
        targetShortcut,
      })
      setTimeout(() => {
        completeMerge(sourceId, targetId, targetPos.x, targetPos.y)
        setMergeAnim(null)
        setDragHover(null)
      }, mergeAnimMs)
    },
    [clearMergeHoldTimer, completeMerge, folderMap, mergeAnimMs, positions, shortcutMap],
  )

  const handleMoveShortcut = useCallback(
    (id: string, x: number, y: number, finalize: boolean) => {
      if (mergeStartedRef.current) {
        if (finalize) {
          clearMergeHoldTimer()
          mergeStartedRef.current = false
          setDragHover(null)
        }
        return
      }
      if (finalize) {
        if (mergeReady?.sourceId === id) {
          const currentTarget = findDropTarget(positionsRef.current, id, x, y, iconSizePx)
          if (currentTarget === mergeReady.targetId) {
            setMergeReady(null)
            startMerge(id, mergeReady.targetId, x, y)
            return
          }
        }
        clearMergeHoldTimer()
      }
      moveShortcut(id, x, y, finalize)
      if (finalize) setDragHover(null)
    },
    [clearMergeHoldTimer, iconSizePx, mergeReady, moveShortcut, startMerge],
  )

  useEffect(() => {
    if (!dragHover || mergeAnim) {
      clearMergeHoldTimer()
      return
    }

    const targetId = findDropTarget(
      positions,
      dragHover.id,
      dragHover.x,
      dragHover.y,
      iconSizePx,
    )
    if (!targetId || isFolderDockId(dragHover.id)) {
      clearMergeHoldTimer()
      return
    }

    if (mergeHoldTargetRef.current === targetId) {
      if (mergeHoldTimerRef.current !== null) return
      if (mergeReady?.sourceId === dragHover.id && mergeReady.targetId === targetId) return
    }

    clearMergeHoldTimer()
    mergeHoldTargetRef.current = targetId
    mergeHoldTimerRef.current = setTimeout(() => {
      mergeHoldTimerRef.current = null
      const hover = dragHoverRef.current
      if (!hover) return
      const currentTarget = findDropTarget(
        positionsRef.current,
        hover.id,
        hover.x,
        hover.y,
        iconSizePx,
      )
      if (currentTarget !== targetId) return
      setMergeReady({ sourceId: hover.id, targetId })
    }, folderMergeHoldMs)
  }, [clearMergeHoldTimer, dragHover, folderMergeHoldMs, iconSizePx, mergeAnim, mergeReady, positions])

  useEffect(() => () => clearMergeHoldTimer(), [clearMergeHoldTimer])

  const clearTimers = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    if (openTimer.current) clearTimeout(openTimer.current)
  }, [])

  const requestOpen = useCallback(
    (immediate = false) => {
      if (isBrowsing && !browsingHoverOpen) return
      clearTimers()

      if (isBrowsing && !immediate && browsingOpenDelayMs > 0) {
        openTimer.current = setTimeout(() => {
          setStage('expanded')
        }, browsingOpenDelayMs)
        return
      }

      setStage('expanded')
    },
    [browsingHoverOpen, browsingOpenDelayMs, clearTimers, isBrowsing],
  )

  const handleEnter = useCallback(() => {
    requestOpen(false)
  }, [requestOpen])

  const handleEnterImmediate = useCallback(() => {
    requestOpen(true)
  }, [requestOpen])

  const handleMenuClick = useCallback(() => {
    clearTimers()
    folderOpenRef.current = false
    setOpenFolderId(null)
    setContextMenu(null)
    contextMenuOpenRef.current = false
    contextMenuHoverRef.current = false
    onHomeClick?.()
  }, [clearTimers, onHomeClick])

  const shouldDeferClose = useCallback(() => {
    if (isDraggingRef.current) return true
    if (contextMenuOpenRef.current || contextMenuHoverRef.current) return true
    if (folderPanelHoverRef.current) return true
    return false
  }, [])

  const scheduleClose = useCallback(() => {
    if (chromeQuickMenuOpen) return
    if (isBrowsing && shellViewMode === 'overlay') return
    if (isHome && homeAlwaysOpen) return
    if (shouldDeferClose()) return
    clearTimers()
    closeTimer.current = setTimeout(() => {
      if (folderPanelHoverRef.current || contextMenuHoverRef.current) return
      if (folderOpenRef.current) {
        folderOpenRef.current = false
        setOpenFolderId(null)
      }
      setStage('closed')
    }, closeDelayMs)
  }, [chromeQuickMenuOpen, shellViewMode, clearTimers, closeDelayMs, homeAlwaysOpen, isHome, isBrowsing, shouldDeferClose])

  const handleContextMenuOpen = useCallback(
    (shortcut: Shortcut, x: number, y: number) => {
      contextMenuOpenRef.current = true
      clearTimers()
      setStage('expanded')
      setContextMenu({ shortcut, x, y })
    },
    [clearTimers],
  )

  const handleContextMenuClose = useCallback(() => {
    contextMenuOpenRef.current = false
    contextMenuHoverRef.current = false
    setContextMenu(null)
    scheduleClose()
  }, [scheduleClose])

  const handleContextMenuEnter = useCallback(() => {
    contextMenuHoverRef.current = true
    clearTimers()
    setStage('expanded')
  }, [clearTimers])

  const handleContextMenuLeave = useCallback(() => {
    contextMenuHoverRef.current = false
    scheduleClose()
  }, [scheduleClose])

  const handleFolderPanelEnter = useCallback(() => {
    folderPanelHoverRef.current = true
    clearTimers()
    setStage('expanded')
  }, [clearTimers])

  const handleFolderPanelLeave = useCallback(() => {
    folderPanelHoverRef.current = false
    scheduleClose()
  }, [scheduleClose])

  const handleFolderClose = useCallback(() => {
    folderOpenRef.current = false
    setOpenFolderId(null)
    scheduleClose()
  }, [scheduleClose])

  const handleFolderOpen = useCallback(
    (dockId: string) => {
      folderOpenRef.current = true
      clearTimers()
      setStage('expanded')
      setOpenFolderId(dockId)
    },
    [clearTimers],
  )

  const handleRemoveFromFolder = useCallback(
    (folderId: string, shortcutId: string, clientX: number, clientY: number) => {
      if (!onRemoveMemberFromFolder) return
      const dockId = folderDockId(folderId)
      const folderPos =
        positions.find((p) => p.id === dockId) ?? { id: dockId, x: lunarMetrics.cx, y: 55 }
      const anchor = anchorRef.current?.getBoundingClientRect()
      let dropX = folderPos.x
      let dropY = folderPos.y
      if (anchor) {
        const clamped = clampToBounds(
          clientX - anchor.left,
          clientY - anchor.top,
          iconSizePx,
          lunarMetrics,
        )
        dropX = clamped.x
        dropY = clamped.y
      }

      const result = onRemoveMemberFromFolder(folderId, shortcutId)
      if (!result) return

      if (result.action === 'dissolved') {
        if (result.remainingMemberId) {
          replacePositionId(dockId, result.remainingMemberId)
        } else {
          removePosition(dockId)
        }
        setPosition(shortcutId, dropX, dropY)
        handleFolderClose()
      } else {
        setPosition(shortcutId, dropX, dropY)
      }
    },
    [
      onRemoveMemberFromFolder,
      positions,
      replacePositionId,
      removePosition,
      setPosition,
      handleFolderClose,
      lunarMetrics,
      iconSizePx,
    ],
  )

  const handleDragStart = useCallback(() => {
    isDraggingRef.current = true
    mergeStartedRef.current = false
    clearMergeHoldTimer()
    setIsAnyDragging(true)
    clearTimers()
    setStage('expanded')
    setPreviewShortcut(null)
    contextMenuOpenRef.current = false
    contextMenuHoverRef.current = false
    setContextMenu(null)
  }, [clearMergeHoldTimer, clearTimers])

  const handleDragEnd = useCallback(() => {
    isDraggingRef.current = false
    clearMergeHoldTimer()
    mergeStartedRef.current = false
    setIsAnyDragging(false)
  }, [clearMergeHoldTimer])

  const getPosition = (id: string) => {
    const direct = positions.find((p) => p.id === id)
    if (direct) return direct

    const shortcut = shortcutMap.get(id)
    if (shortcut) {
      const host = hostKeyForShortcut(shortcut.url)
      const alias = positions.find((position) => {
        if (position.id === id) return false
        const other = shortcutMap.get(position.id)
        return other && hostKeyForShortcut(other.url) === host
      })
      if (alias) return alias
    }

    return { id, x: lunarMetrics.cx, y: 55 }
  }

  const resolveCloseTabId = useCallback(
    (dockId: string) => openTabIdForDockId(dockId, openTabIds, shortcutMap),
    [openTabIds, shortcutMap],
  )

  const handleDockClose = useCallback(
    (dockId: string, shortcutId: string) => {
      const targetTabId = resolveCloseTabId(dockId)
      if (targetTabId) {
        onCloseTab?.(targetTabId)
        return
      }
      if (!isBrowsing) onRemoveShortcut?.(shortcutId)
    },
    [isBrowsing, onCloseTab, onRemoveShortcut, resolveCloseTabId],
  )

  const resolveTabForDock = useCallback(
    (dockId: string) => {
      const tabId = resolveCloseTabId(dockId)
      return tabId ? (getTab?.(tabId) ?? null) : null
    },
    [getTab, resolveCloseTabId],
  )

  const previewActive = previewShortcut !== null
  const shortcutInteractionActive = previewActive || isAnyDragging

  useEffect(() => {
    onShortcutInteractionChange?.(shortcutInteractionActive)
  }, [shortcutInteractionActive, onShortcutInteractionChange])

  useEffect(() => {
    return () => onShortcutInteractionChange?.(false)
  }, [onShortcutInteractionChange])

  useEffect(() => {
    if (mode !== 'home') return
    if (homeAlwaysOpen) {
      setStage('expanded')
    } else {
      setStage('closed')
    }
  }, [homeAlwaysOpen, mode])

  const prevModeRef = useRef(mode)
  useEffect(() => {
    const previous = prevModeRef.current
    prevModeRef.current = mode
    if (previous === mode) return

    clearTimers()
    setPreviewShortcut(null)
    setContextMenu(null)
    contextMenuOpenRef.current = false
    contextMenuHoverRef.current = false

    if (mode === 'home') {
      folderOpenRef.current = false
      setOpenFolderId(null)
      setStage(homeAlwaysOpen ? 'expanded' : 'closed')
      return
    }

    if (mode === 'browsing' && shellViewMode !== 'overlay') {
      folderOpenRef.current = false
      setOpenFolderId(null)
      setStage('closed')
    }
  }, [mode, shellViewMode, homeAlwaysOpen, clearTimers])

  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current)
    }
  }, [])

  const isExpanded =
    forceOpen ||
    stage === 'expanded' ||
    (isHome && homeAlwaysOpen)

  const handleContextMenuLayout = useCallback(
    (rect: DOMRect) => {
      if (!contextMenu || !isBrowsing || !isTauri || isChromeShell()) return
      void expandShellHitRegionToFitBottom(
        rect.bottom,
        isExpanded,
        lunarHeightPx,
        Boolean(openFolderId),
      )
    },
    [contextMenu, isBrowsing, isExpanded, lunarHeightPx, openFolderId],
  )

  useEffect(() => {
    if (!contextMenu || !isBrowsing || !isTauri || isChromeShell() || shellViewMode === 'overlay') {
      return
    }

    void expandShellHitRegionToFitBottom(
      contextMenu.y + 200,
      isExpanded,
      lunarHeightPx,
      Boolean(openFolderId),
    )

    return () => {
      void syncChromeShellLayout(
        isExpanded,
        lunarHeightPx,
        Boolean(openFolderId),
        previewShortcut !== null,
      )
    }
  }, [
    contextMenu,
    isBrowsing,
    shellViewMode,
    isExpanded,
    lunarHeightPx,
    openFolderId,
    previewShortcut,
  ])

  useEffect(() => {
    if (!isBrowsing || !isTauri || isChromeShell()) return
    if (contextMenu) return

    if (chromeQuickMenuOpen) {
      clearTimers()
      setStage('expanded')
      void syncChromeShellLayout(
        true,
        lunarHeightPx,
        Boolean(openFolderId),
        previewShortcut !== null,
      )
      return
    }

    if (shellViewMode === 'overlay') {
      clearTimers()
      folderOpenRef.current = false
      setOpenFolderId(null)
      return
    }

    if (shellViewMode === 'browsing') {
      clearTimers()
      void syncChromeShellLayout(
        stage === 'expanded',
        lunarHeightPx,
        Boolean(openFolderId),
        previewShortcut !== null,
      )
    }
  }, [
    chromeQuickMenuOpen,
    shellViewMode,
    isBrowsing,
    stage,
    lunarHeightPx,
    openFolderId,
    previewShortcut,
    contextMenu,
    clearTimers,
  ])

  useEffect(() => {
    if (mode === 'overlay' || !isBrowsing || !isTauri || isChromeShell()) return
    if (contextMenu) return

    const applyLayout = debounce(() => {
      void syncChromeShellLayout(
        isExpanded,
        lunarHeightPx,
        Boolean(openFolderId),
        previewShortcut !== null,
      )
    }, 150)

    applyLayout()
  }, [mode, isBrowsing, isExpanded, lunarHeightPx, openFolderId, previewShortcut, contextMenu])

  if (mode === 'overlay') return null

  const rootClass = [
    isBrowsing ? styles.browsingRoot : styles.root,
    isExpanded ? styles.rootExpanded : '',
  ]
    .filter(Boolean)
    .join(' ')

  const nav = (
    <nav
      className={rootClass}
      aria-label={t('quickAccess')}
      style={
        {
          '--lunar-width': `${lunarWidthPx}px`,
          '--lunar-height': `${lunarHeightPx}px`,
        } as React.CSSProperties
      }
      onMouseEnter={isBrowsing && !isExpanded ? handleEnter : handleEnterImmediate}
      onMouseLeave={scheduleClose}
    >
        <div
          className={[styles.triggerZone, isBrowsing ? styles.triggerZoneBrowsing : '']
            .filter(Boolean)
            .join(' ')}
          aria-hidden="true"
          onClick={isBrowsing ? handleEnterImmediate : undefined}
        />

        <div
            className={[
              styles.lunarGlass,
              isExpanded ? styles.visible : '',
              isExpanded ? styles.open : '',
            ]
            .filter(Boolean)
            .join(' ')}
        >
          <div
            className={[
              styles.lunarDome,
              isBrowsing && isTauri ? styles.lunarDomeBrowsing : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <div className={styles.glassFill}>
              <div className={styles.glassFrost} aria-hidden="true" />
            </div>
          </div>

          <svg
            className={styles.arcStroke}
            viewBox={`0 0 ${lunarMetrics.w} ${lunarMetrics.h}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="arcGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="rgba(255,255,255,0)" />
                <stop offset="18%" stopColor="rgba(255,255,255,0.08)" />
                <stop offset="50%" stopColor="rgba(255,255,255,0.16)" />
                <stop offset="82%" stopColor="rgba(255,255,255,0.08)" />
                <stop offset="100%" stopColor="rgba(255,255,255,0)" />
              </linearGradient>
              <linearGradient id="arcGradInner" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="rgba(255,255,255,0)" />
                <stop offset="18%" stopColor="rgba(255,255,255,0.18)" />
                <stop offset="50%" stopColor="rgba(255,255,255,0.4)" />
                <stop offset="82%" stopColor="rgba(255,255,255,0.18)" />
                <stop offset="100%" stopColor="rgba(255,255,255,0)" />
              </linearGradient>
              <clipPath id="lunarRimBand">
                <rect x="0" y={LUNAR_RIM_CLIP_Y} width={lunarMetrics.w} height={lunarMetrics.h - LUNAR_RIM_CLIP_Y} />
              </clipPath>
            </defs>
            <ellipse
              cx={lunarMetrics.cx}
              cy={lunarMetrics.cy}
              rx={lunarMetrics.rx}
              ry={lunarMetrics.ry}
              fill="none"
              stroke="url(#arcGrad)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
              clipPath="url(#lunarRimBand)"
            />
            <path
              d={innerRimPath}
              fill="none"
              stroke="url(#arcGradInner)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {isExpanded && onHomeClick && (
            <div className={styles.evBtnColumn}>
              {isBrowsing && onBackClick && (
                <button
                  type="button"
                  className={styles.evBtn}
                  onClick={(event) => {
                    event.stopPropagation()
                    onBackClick?.()
                  }}
                  title={t('goBack')}
                  aria-label={t('goBackAria')}
                >
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M15 18l-6-6 6-6"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              )}
              <button
                type="button"
                className={styles.evBtn}
                onClick={(event) => {
                  event.stopPropagation()
                  handleMenuClick()
                }}
                title={t('quickMenu')}
                aria-label={t('quickMenu')}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z" />
                </svg>
              </button>
            </div>
          )}

          {isExpanded && (
            <div
              ref={anchorRef}
              className={[
                styles.iconAnchor,
                isBrowsing && isTauri ? styles.iconAnchorBrowsing : '',
                isAnyDragging ? styles.iconAnchorDragging : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {visibleDockItemIds.map((dockId) => {
                const pos = getPosition(dockId)
                const merging =
                  mergeAnim?.sourceId === dockId ||
                  mergeAnim?.targetId === dockId ||
                  (isFolderDockId(dockId) && newFolderId === parseFolderDockId(dockId))

                if (isFolderDockId(dockId)) {
                  const folder = folderMap.get(parseFolderDockId(dockId))
                  if (!folder) return null
                  const members = folder.members
                    .map((id) => shortcutMap.get(id))
                    .filter((s): s is Shortcut => s !== undefined)
                  return (
                    <DockFolderItem
                      key={dockId}
                      folder={folder}
                      members={members}
                      x={pos.x}
                      y={pos.y}
                      isDropHover={dropTargetId === dockId}
                      isDropTarget={shrinkTargetId === dockId}
                      merging={!!merging && !mergeAnim}
                      anchorRef={anchorRef}
                      onMove={(x, y, finalize) => handleMoveShortcut(dockId, x, y, finalize)}
                      onOpen={() => handleFolderOpen(dockId)}
                      onDragStart={handleDragStart}
                      onDragEnd={handleDragEnd}
                      onDragMove={(x, y) => setDragHover({ id: dockId, x, y })}
                    />
                  )
                }

                const item = shortcutMap.get(dockId)
                if (!item) return null

                const openTabId = openTabIdForDockId(dockId, openTabIds, shortcutMap)
                const tabIsOpen = openTabId !== null
                const tabIsActive = openTabId !== null && activeTabId === openTabId
                const tab = resolveTabForDock(dockId)
                const displayFavicon = tab?.favicon ?? item.favicon
                const displayTitle = tab ? truncateTabTitle(tab.title) : item.label
                const hoverTitle = tab?.title ?? item.label

                return (
                  <DraggableShortcut
                    key={dockId}
                    item={item}
                    x={pos.x}
                    y={pos.y}
                    muted={isMuted(item.id)}
                    isDropHover={dropTargetId === dockId}
                    isDropTarget={shrinkTargetId === dockId}
                    merging={!!merging}
                    anchorRef={anchorRef}
                    onMove={(x, y, finalize) => handleMoveShortcut(dockId, x, y, finalize)}
                    onNavigate={() => {
                      const targetTabId = resolveCloseTabId(dockId)
                      onNavigate(item.url, targetTabId ?? item.id)
                    }}
                    onRemove={
                      tabIsOpen || !isBrowsing
                        ? () => handleDockClose(dockId, item.id)
                        : undefined
                    }
                    closeAriaLabel={
                      tabIsOpen
                        ? tf('closeTabAria', { title: hoverTitle })
                        : tf('removeShortcutAria', { label: item.label })
                    }
                    isTabActive={tabIsActive}
                    displayFavicon={displayFavicon}
                    displayTitle={displayTitle}
                    hoverTitle={hoverTitle}
                    onContextMenu={(x, y) => handleContextMenuOpen(item, x, y)}
                    onPreviewShow={() => setPreviewShortcut(item)}
                    onPreviewHide={() => setPreviewShortcut(null)}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                    onDragMove={(x, y) => setDragHover({ id: dockId, x, y })}
                    previewOnHover={previewOnHover}
                    previewDelayMs={previewDelayMs}
                    closeBtnDelayMs={closeBtnDelayMs}
                  />
                )
              })}

              {mergeAnim && (
                <div className={styles.mergeLayer} aria-hidden="true">
                  <div
                    className={styles.mergeGhost}
                    style={{
                      left: `${mergeAnim.sourceX}px`,
                      top: `${mergeAnim.sourceY}px`,
                      ['--merge-dx' as string]: `${mergeAnim.targetX - mergeAnim.sourceX}px`,
                      ['--merge-dy' as string]: `${mergeAnim.targetY - mergeAnim.sourceY}px`,
                    }}
                  >
                    {mergeAnim.sourceShortcut.favicon ? (
                      <img src={mergeAnim.sourceShortcut.favicon} alt="" draggable={false} />
                    ) : (
                      mergeAnim.sourceShortcut.label[0]
                    )}
                  </div>
                  <div
                    className={styles.mergeGhost}
                    style={{
                      left: `${mergeAnim.targetX}px`,
                      top: `${mergeAnim.targetY}px`,
                      ['--merge-dx' as string]: '0px',
                      ['--merge-dy' as string]: '0px',
                    }}
                  >
                    {mergeAnim.targetShortcut.favicon ? (
                      <img src={mergeAnim.targetShortcut.favicon} alt="" draggable={false} />
                    ) : (
                      mergeAnim.targetShortcut.label[0]
                    )}
                  </div>
                  <div
                    className={`${styles.mergeGhost} ${styles.mergeGhostFolder}`}
                    style={{
                      left: `${mergeAnim.targetX}px`,
                      top: `${mergeAnim.targetY}px`,
                      animationDelay: '200ms',
                    }}
                  >
                    <ShortcutFolderIcon
                      members={[mergeAnim.sourceShortcut, mergeAnim.targetShortcut]}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </nav>
  )

  const overlays = (
    <>
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
          isPinned={isPinned(contextMenu.shortcut.id)}
          canPinMore={canPinMore}
          onClose={handleContextMenuClose}
          onRemove={() => {
            const targetTabId =
              openTabIds.includes(contextMenu.shortcut.id)
                ? contextMenu.shortcut.id
                : resolveCloseTabId(contextMenu.shortcut.id)
            if (targetTabId) {
              onCloseTab?.(targetTabId)
              return
            }
            onRemoveShortcut?.(contextMenu.shortcut.id)
          }}
          onToggleMute={() => onToggleMute?.(contextMenu.shortcut.id)}
          onOpenNewTab={() => onNavigate(contextMenu.shortcut.url, contextMenu.shortcut.id)}
          onTogglePin={
            onTogglePin ? () => onTogglePin(contextMenu.shortcut.id) : undefined
          }
          onMouseEnter={handleContextMenuEnter}
          onMouseLeave={handleContextMenuLeave}
          onLayout={handleContextMenuLayout}
        />
      )}

      {openFolderId && (() => {
        const folder = folderMap.get(parseFolderDockId(openFolderId))
        if (!folder) return null
        const members = folder.members
          .map((id) => shortcutMap.get(id))
          .filter((s): s is Shortcut => s !== undefined)
        const pos = getPosition(openFolderId)
        const anchor = anchorRef.current?.getBoundingClientRect()
        if (!anchor) return null
        return (
          <FolderExpandPanel
            folderId={folder.id}
            folderName={folder.name}
            members={members}
            anchorX={anchor.left + pos.x}
            anchorY={anchor.top + pos.y}
            onNavigate={onNavigate}
            onRenameFolder={onRenameFolder}
            onClose={handleFolderClose}
            onRemoveFromFolder={handleRemoveFromFolder}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onMouseEnter={handleFolderPanelEnter}
            onMouseLeave={handleFolderPanelLeave}
            previewOnHover={previewOnHover}
            previewDelayMs={previewDelayMs}
            onPreviewShow={setPreviewShortcut}
            onPreviewHide={() => setPreviewShortcut(null)}
          />
        )
      })()}
    </>
  )

  if (isBrowsing && !isChromeShell()) {
    const browsingChromeClass = [
      styles.browsingChrome,
      isTauri ? styles.browsingChromeTauri : styles.browsingChromeWeb,
      isExpanded ? styles.browsingChromeExpanded : styles.browsingChromeCollapsed,
      shellViewMode === 'overlay' ? styles.browsingChromeOverlayHidden : '',
    ]
      .filter(Boolean)
      .join(' ')

    return (
      <>
        <div
          className={browsingChromeClass}
          style={
            {
              '--lunar-height': `${lunarHeightPx}px`,
            } as React.CSSProperties
          }
        >
          <div
            className={[
              styles.browsingHoverBridge,
              isTauri ? '' : styles.browsingHoverBridgeWeb,
            ]
              .filter(Boolean)
              .join(' ')}
            aria-hidden="true"
            onMouseEnter={handleEnter}
            onMouseLeave={scheduleClose}
            onClick={handleEnterImmediate}
          />
          {nav}
        </div>
        {overlays}
      </>
    )
  }

  return (
    <>
      {nav}
      {overlays}
    </>
  )
}

function DraggableShortcut({
  item,
  x,
  y,
  muted,
  isDropHover,
  isDropTarget,
  merging,
  anchorRef,
  onMove,
  onNavigate,
  onRemove,
  closeAriaLabel,
  isTabActive = false,
  displayFavicon,
  displayTitle,
  hoverTitle,
  onContextMenu,
  onPreviewShow,
  onPreviewHide,
  onDragStart,
  onDragEnd,
  onDragMove,
  previewOnHover,
  previewDelayMs,
  closeBtnDelayMs,
}: {
  item: Shortcut
  x: number
  y: number
  muted: boolean
  isDropHover: boolean
  isDropTarget: boolean
  merging: boolean
  anchorRef: React.RefObject<HTMLDivElement | null>
  onMove: (x: number, y: number, finalize: boolean) => void
  onNavigate: () => void
  onRemove?: () => void
  closeAriaLabel: string
  isTabActive?: boolean
  displayFavicon?: string
  displayTitle?: string
  hoverTitle?: string
  onContextMenu: (x: number, y: number) => void
  onPreviewShow: () => void
  onPreviewHide: () => void
  onDragStart: () => void
  onDragEnd: () => void
  onDragMove: (x: number, y: number) => void
  previewOnHover: boolean
  previewDelayMs: number
  closeBtnDelayMs: number
}) {
  const { tf } = useLocale()
  const [isDragging, setIsDragging] = useState(false)
  const [dragPos, setDragPos] = useState({ x, y })
  const [isShortcutHovered, setIsShortcutHovered] = useState(false)
  const [showCloseBtn, setShowCloseBtn] = useState(false)
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
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeBtnTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!isDragging) {
      setDragPos({ x, y })
    }
  }, [x, y, isDragging])

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

  const cancelMoveRaf = useCallback(() => {
    if (moveRaf.current !== null) {
      cancelAnimationFrame(moveRaf.current)
      moveRaf.current = null
    }
  }, [])

  useEffect(() => () => {
    clearPreviewTimer()
    clearCloseBtnTimer()
    cancelMoveRaf()
  }, [clearCloseBtnTimer, clearPreviewTimer, cancelMoveRaf])

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
        cancelMoveRaf()
        onMove(nextX, nextY, true)
        return
      }
      if (moveRaf.current !== null) return
      moveRaf.current = requestAnimationFrame(() => {
        moveRaf.current = null
        onMove(dragState.current.lastX, dragState.current.lastY, false)
      })
    },
    [cancelMoveRaf, onMove],
  )

  const handleWrapEnter = () => {
    if (isDragging) return
    if (onRemove) {
      clearCloseBtnTimer()
      closeBtnTimer.current = setTimeout(() => setShowCloseBtn(true), closeBtnDelayMs)
    }
  }

  const handleWrapLeave = () => {
    setIsShortcutHovered(false)
    setShowCloseBtn(false)
    clearPreviewTimer()
    clearCloseBtnTimer()
    onPreviewHide()
  }

  const handleShortcutEnter = () => {
    if (isDragging) return
    setIsShortcutHovered(true)
    clearPreviewTimer()
    if (previewOnHover) {
      previewTimer.current = setTimeout(onPreviewShow, previewDelayMs)
    }
  }

  const handleShortcutLeave = () => {
    setIsShortcutHovered(false)
    clearPreviewTimer()
    onPreviewHide()
  }

  const handleCloseEnter = () => {
    clearPreviewTimer()
    onPreviewHide()
  }

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
        setIsShortcutHovered(false)
        setShowCloseBtn(false)
        clearPreviewTimer()
        clearCloseBtnTimer()
        onPreviewHide()
        onDragStart()
      }
      if (dragState.current.moved) {
        setDragPos(local)
        onDragMove(local.x, local.y)
        scheduleMove(local.x, local.y, false)
      }
    },
    [clearCloseBtnTimer, clearPreviewTimer, getLocalPosition, onDragMove, onDragStart, onPreviewHide, scheduleMove],
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
      if (dragState.current.moved) {
        finishDrag(e.clientX, e.clientY)
      } else {
        dragState.current.active = false
        onNavigate()
      }
    }
    window.addEventListener('pointermove', onWindowPointerMove)
    window.addEventListener('pointerup', onWindowPointerUp)
    window.addEventListener('pointercancel', onWindowPointerUp)
    return () => {
      window.removeEventListener('pointermove', onWindowPointerMove)
      window.removeEventListener('pointerup', onWindowPointerUp)
      window.removeEventListener('pointercancel', onWindowPointerUp)
    }
  }, [finishDrag, isDragging, onNavigate, processPointerMove])

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
      onNavigate()
    }
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (isDragging) return
    onContextMenu(e.clientX, e.clientY)
  }

  const handleCloseClick = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    clearPreviewTimer()
    onPreviewHide()
    onRemove?.()
  }

  const resolvedFavicon = displayFavicon ?? item.favicon
  const resolvedTitle = displayTitle ?? item.label
  const resolvedHoverTitle = hoverTitle ?? item.label

  const scale = isShortcutHovered && !isDragging ? 1.12 : 1
  const visualX = isDragging ? dragPos.x : x
  const visualY = isDragging ? dragPos.y : y

  return (
    <div
      className={[
        styles.shortcutWrap,
        isDragging ? styles.shortcutWrapDragging : '',
        isShortcutHovered && !isDragging ? styles.shortcutWrapHovered : '',
        merging ? styles.shortcutWrapMerging : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ left: `${visualX}px`, top: `${visualY}px` }}
      onMouseEnter={handleWrapEnter}
      onMouseLeave={handleWrapLeave}
      onContextMenu={handleContextMenu}
    >
      <button
        type="button"
        className={[
          styles.shortcut,
          isDragging ? styles.shortcutDragging : '',
          muted ? styles.shortcutMuted : '',
          isShortcutHovered && !isDragging ? styles.shortcutHovered : '',
          isDropHover ? styles.shortcutDropHover : '',
          isDropTarget ? styles.shortcutDropTarget : '',
          showCloseBtn && !isDragging && onRemove ? styles.shortcutWithClose : '',
          isTabActive ? styles.shortcutTabActive : '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={{ transform: `translate(-50%, -50%) scale(${scale})` }}
        onMouseEnter={handleShortcutEnter}
        onMouseLeave={handleShortcutLeave}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onContextMenu={handleContextMenu}
        aria-label={tf('shortcutAria', { label: item.label })}
        tabIndex={-1}
      >
        {resolvedFavicon ? (
          <img src={resolvedFavicon} alt="" className={styles.favicon} draggable={false} />
        ) : (
          <span className={styles.fallback}>{resolvedTitle[0]}</span>
        )}
        {muted && <span className={styles.mutedStrike} aria-hidden="true" />}
        {showCloseBtn && !isDragging && onRemove && (
          <span
            role="button"
            className={styles.closeBtn}
            onMouseEnter={handleCloseEnter}
            onPointerEnter={handleCloseEnter}
            onPointerDown={handleCloseClick}
            aria-label={closeAriaLabel}
          >
            ✕
          </span>
        )}
      </button>
      {isShortcutHovered && !isDragging && (
        <span className={styles.shortcutHoverLabel} aria-hidden="true">
          {resolvedHoverTitle}
        </span>
      )}
    </div>
  )
}
