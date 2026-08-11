import { useCallback, useEffect, useMemo, useState } from 'react'
import { emit } from '@tauri-apps/api/event'
import { DownloadManager } from './components/DownloadManager/DownloadManager'
import { SemiLunarMenu } from './components/SemiLunarMenu/SemiLunarMenu'
import { matchBrowserShortcut, shouldIgnoreShellShortcut } from './core/browserShortcuts'
import { DEFAULT_SHORTCUTS } from './core/constants'
import { controlDownload } from './core/download'
import {
  emitChromeAction,
  listenActiveUrl,
  listenDownloadUiState,
  listenTabCatalog,
  listenViewMode,
  type DownloadUiStatePayload,
  type ShellViewMode,
  type TabCatalogPayload,
} from './core/nebulaBridge'
import { shortcutFromTab, type BrowserTab } from './core/browserTab'
import { computeAdaptiveLunarSize } from './core/lunarSizing'
import type { Shortcut } from './core/types'
import { useBrowseSessions } from './hooks/useBrowseSessions'
import { useBrowserShortcutBindings } from './hooks/useBrowserShortcutBindings'
import { useNebulaSettings } from './hooks/useNebulaSettings'
import { usePinnedShortcuts } from './hooks/usePinnedShortcuts'
import { useShortcutFolders } from './hooks/useShortcutFolders'
import { useShortcutPreferences } from './hooks/useShortcutPreferences'
import './styles/global.css'

/**
 * Dedicated always-on-top Nebula chrome surface.
 *
 * Home lives in the main WebView, browser tabs are full-screen sibling WebViews,
 * and this WebView owns only the Semi-Lunar UI. Keeping those three surfaces
 * separate means Home never has to be clipped/resized just to expose a tab.
 */
export function ChromeApp() {
  const { settings } = useNebulaSettings()
  const semiLunar = settings.semiLunar
  const { bindings: browserShortcutBindings } = useBrowserShortcutBindings({ syncNative: false })

  const {
    visibleShortcuts,
    allShortcuts,
    toggleMute,
    removeShortcut,
    isMuted,
  } = useShortcutPreferences(DEFAULT_SHORTCUTS)

  const {
    isPinned,
    canPinMore,
    togglePin,
  } = usePinnedShortcuts(allShortcuts, visibleShortcuts)

  const {
    dockItemIds,
    folders,
    createFolderFromShortcuts,
    addShortcutToFolder,
    removeShortcutFromFolders,
    removeMemberFromFolder,
    renameFolder,
  } = useShortcutFolders(visibleShortcuts, semiLunar.rememberFolders)

  const { getSession } = useBrowseSessions()

  const [catalog, setCatalog] = useState<TabCatalogPayload>({
    tabs: [],
    activeTabId: null,
  })
  const [activeUrl, setActiveUrl] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ShellViewMode>('home')
  const [downloadUi, setDownloadUi] = useState<DownloadUiStatePayload>({
    items: [],
    activeCount: 0,
    aggregateProgress: null,
    panelOpen: false,
  })

  useEffect(() => {
    document.documentElement.dataset.nebulaChrome = 'true'

    const blockNativeContextMenu = (event: MouseEvent) => {
      event.preventDefault()
    }

    window.addEventListener('contextmenu', blockNativeContextMenu, true)

    return () => {
      window.removeEventListener('contextmenu', blockNativeContextMenu, true)
      delete document.documentElement.dataset.nebulaChrome
    }
  }, [])

  useEffect(() => {
    let disposed = false
    const unlisteners: Array<() => void> = []

    void Promise.all([
      listenTabCatalog((next) => setCatalog(next)),
      listenActiveUrl(setActiveUrl),
      listenViewMode(setViewMode),
      listenDownloadUiState(setDownloadUi),
    ]).then((items) => {
      if (disposed) {
        items.forEach((dispose) => dispose())
        return
      }
      unlisteners.push(...items)
      void emitChromeAction({ type: 'request-state' })
    })

    return () => {
      disposed = true
      unlisteners.forEach((dispose) => dispose())
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreShellShortcut(event, browserShortcutBindings)) return
      const action = matchBrowserShortcut(event, browserShortcutBindings)
      if (!action) return
      event.preventDefault()
      void emit('nebula-browser-shortcut', action)
    }

    // Capture phase is intentional: folder portals and focused controls must
    // not swallow browser-level shortcuts such as Ctrl+Tab.
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [browserShortcutBindings])

  const openTabIds = useMemo(
    () => catalog.tabs.map((tab) => tab.shortcutId),
    [catalog.tabs],
  )

  const tabById = useMemo(
    () => new Map(catalog.tabs.map((tab) => [tab.shortcutId, tab])),
    [catalog.tabs],
  )

  const getTab = useCallback(
    (shortcutId: string): BrowserTab | null => tabById.get(shortcutId) ?? null,
    [tabById],
  )

  const semiLunarShortcuts = useMemo(() => {
    const byId = new Map<string, Shortcut>(
      visibleShortcuts.map((shortcut) => [shortcut.id, shortcut]),
    )

    for (const tab of catalog.tabs) {
      const existing = byId.get(tab.shortcutId)
      byId.set(
        tab.shortcutId,
        existing
          ? {
              ...existing,
              label: tab.title,
              url: tab.url,
              favicon: tab.favicon,
            }
          : shortcutFromTab(tab),
      )
    }

    return [...byId.values()]
  }, [visibleShortcuts, catalog.tabs])

  const adaptiveLunar = useMemo(
    () =>
      computeAdaptiveLunarSize(
        Math.max(openTabIds.length, 1),
        semiLunar.lunarWidthPx,
        semiLunar.lunarHeightPx,
      ),
    [openTabIds.length, semiLunar.lunarWidthPx, semiLunar.lunarHeightPx],
  )

  const onNavigate = useCallback(
    (url: string, shortcutId?: string) => {
      const id = shortcutId ?? ''
      if (id && tabById.has(id)) {
        void emitChromeAction({ type: 'switch-tab', shortcutId: id })
        return
      }

      void emitChromeAction({
        type: 'open-tab',
        shortcutId: id,
        url,
      })
    },
    [tabById],
  )

  const onRemoveShortcut = useCallback(
    (id: string) => {
      removeShortcut(id)
      removeShortcutFromFolders(id)
    },
    [removeShortcut, removeShortcutFromFolders],
  )

  const toggleDownloads = useCallback(() => {
    void emitChromeAction({ type: 'toggle-download-panel' })
  }, [])

  const closeDownloads = useCallback(() => {
    void emitChromeAction({ type: 'close-download-panel' })
  }, [])

  const removeDownload = useCallback((id: string) => {
    void emitChromeAction({ type: 'remove-download', id })
  }, [])

  const clearFinishedDownloads = useCallback(() => {
    void emitChromeAction({ type: 'clear-finished-downloads' })
  }, [])

  const mode = viewMode === 'home' ? 'home' : 'browsing'
  const browsingDownloadPanelOpen =
    viewMode === 'browsing' && downloadUi.panelOpen

  useEffect(() => {
    if (!browsingDownloadPanelOpen) return

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target

      if (!(target instanceof Element)) {
        closeDownloads()
        return
      }

      if (
        target.closest('[data-nebula-download-panel="true"]') ||
        target.closest('[data-nebula-download-toggle="true"]')
      ) {
        return
      }

      closeDownloads()
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [
    browsingDownloadPanelOpen,
    closeDownloads,
  ])
  return (
    <>
      <SemiLunarMenu
      shortcuts={semiLunarShortcuts}
      dockItemIds={dockItemIds}
      folders={folders}
      onCreateFolder={createFolderFromShortcuts}
      onAddToFolder={addShortcutToFolder}
      onRenameFolder={renameFolder}
      onNavigate={onNavigate}
      onRemoveShortcut={onRemoveShortcut}
      onCloseTab={(shortcutId) => {
        void emitChromeAction({ type: 'close-tab', shortcutId })
      }}
      openTabIds={openTabIds}
      activeTabId={catalog.activeTabId}
      getTab={getTab}
      onToggleMute={toggleMute}
      isMuted={isMuted}
      isPinned={isPinned}
      onTogglePin={togglePin}
      canPinMore={canPinMore}
      onRemoveMemberFromFolder={removeMemberFromFolder}
      activeUrl={activeUrl}
      getSession={getSession}
      previewOnHover={semiLunar.previewOnHover}
      homeAlwaysOpen={semiLunar.homeAlwaysOpen}
      browsingHoverOpen={semiLunar.browsingHoverOpen}
      browsingOpenDelayMs={semiLunar.browsingOpenDelayMs}
      closeDelayMs={semiLunar.closeDelayMs}
      previewDelayMs={semiLunar.previewDelayMs}
      closeBtnDelayMs={semiLunar.closeBtnDelayMs}
      folderMergeHoldMs={semiLunar.folderMergeHoldMs}
      mergeAnimMs={semiLunar.mergeAnimMs}
      iconSizePx={semiLunar.iconSizePx}
      lunarWidthPx={adaptiveLunar.width}
      lunarHeightPx={adaptiveLunar.height}
      rememberLayout={semiLunar.rememberLayout}
      mode={mode}
      shellViewMode={viewMode}
      onHomeClick={
        viewMode === 'home'
          ? undefined
          : () => {
              void emitChromeAction({ type: 'open-overlay' })
            }
      }
      onBackClick={
        viewMode === 'home'
          ? undefined
          : () => {
              void emitChromeAction({ type: 'go-back' })
            }
      }
      onDownloadsClick={
        viewMode === 'browsing' ? toggleDownloads : undefined
      }
      downloadCount={downloadUi.items.length}
      activeDownloadCount={downloadUi.activeCount}
      downloadProgress={downloadUi.aggregateProgress}
      downloadPanelOpen={browsingDownloadPanelOpen}
      forceOpen={browsingDownloadPanelOpen}
      />

      {browsingDownloadPanelOpen && (
        <DownloadManager
          items={downloadUi.items}
          variant="browsing"
          browsingTop={adaptiveLunar.height + 14}
          onAction={controlDownload}
          onRemove={removeDownload}
          onClearFinished={clearFinishedDownloads}
          onClose={closeDownloads}
        />
      )}
    </>
  )
}
