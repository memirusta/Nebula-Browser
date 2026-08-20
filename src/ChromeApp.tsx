import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { emit } from '@tauri-apps/api/event'
import { DownloadManager } from './components/DownloadManager/DownloadManager'
import { TabSearch } from './components/TabSearch/TabSearch'
import { SemiLunarMenu } from './components/SemiLunarMenu/SemiLunarMenu'
import {
  matchBrowserShortcut,
  shouldIgnoreShellShortcut,
} from './core/browserShortcuts'
import { DEFAULT_SHORTCUTS } from './core/constants'
import { controlDownload } from './core/download'
import { registerListenerGroup } from './core/listenerGroup'
import {
  emitChromeAction,
  listenActiveUrl,
  listenDownloadUiState,
  listenTabCatalog,
  listenTabSearchRequests,
  listenViewMode,
  listenZoomIndicator,
  type DownloadUiStatePayload,
  type ShellViewMode,
  type TabCatalogPayload,
} from './core/nebulaBridge'
import {
  shortcutFromTab,
  shortcutIdForTabWebviewLabel,
  type BrowserTab,
} from './core/browserTab'
import {
  listenSensitiveFeatureUsage,
  type SensitiveFeatureUsage,
} from './core/sensitiveFeatureUsage'
import { computeAdaptiveLunarSize } from './core/lunarSizing'
import type { Shortcut } from './core/types'
import { useBrowseSessions } from './hooks/useBrowseSessions'
import { useBrowserShortcutBindings } from './hooks/useBrowserShortcutBindings'
import { useNebulaSettings } from './hooks/useNebulaSettings'
import { useLocale } from './hooks/useLocale'
import { usePinnedShortcuts } from './hooks/usePinnedShortcuts'
import { useShortcutFolders } from './hooks/useShortcutFolders'
import { useShortcutPreferences } from './hooks/useShortcutPreferences'
import { setChromeOverlayMinimumLogicalHeight } from './platform/tauriChromeWebview'
import './styles/global.css'
import styles from './ChromeApp.module.css'

/**
 * Dedicated always-on-top Nebula chrome surface.
 *
 * Home lives in the main WebView, browser tabs are full-screen sibling WebViews,
 * and this WebView owns only the Semi-Lunar UI. Keeping those three surfaces
 * separate means Home never has to be clipped/resized just to expose a tab.
 */
export function ChromeApp() {
  const { settings } = useNebulaSettings()
  const { locale } = useLocale()
  const semiLunar = settings.semiLunar
  const { bindings: browserShortcutBindings } = useBrowserShortcutBindings({ syncNative: false })

  const {
    visibleShortcuts,
    allShortcuts,
    toggleMute: toggleShortcutMute,
    removeShortcut,
    isMuted: isShortcutMuted,
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
  } = useShortcutFolders(visibleShortcuts, settings.browsing.restoreTabsOnStartup)

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
  const [zoomIndicatorPercent, setZoomIndicatorPercent] = useState<number | null>(null)
  const [tabSearchOpen, setTabSearchOpen] = useState(false)
  const [sensitiveUsageByTab, setSensitiveUsageByTab] = useState(
    () => new Map<string, SensitiveFeatureUsage>(),
  )
  const zoomIndicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showZoomIndicator = useCallback((percent: number) => {
    if (!Number.isFinite(percent)) return
    setZoomIndicatorPercent(Math.round(percent))
    if (zoomIndicatorTimerRef.current) {
      clearTimeout(zoomIndicatorTimerRef.current)
    }
    zoomIndicatorTimerRef.current = setTimeout(() => {
      setZoomIndicatorPercent(null)
      zoomIndicatorTimerRef.current = null
    }, 2800)
  }, [])

  useEffect(
    () => () => {
      if (zoomIndicatorTimerRef.current) {
        clearTimeout(zoomIndicatorTimerRef.current)
      }
    },
    [],
  )

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
    let disposeListeners: (() => void) | undefined

    void registerListenerGroup([
      () => listenTabCatalog((next) => setCatalog(next)),
      () => listenActiveUrl(setActiveUrl),
      () => listenViewMode(setViewMode),
      () => listenDownloadUiState(setDownloadUi),
      () => listenZoomIndicator(showZoomIndicator),
      () => listenTabSearchRequests(() => setTabSearchOpen(true)),
      () => listenSensitiveFeatureUsage((usage) => {
        setSensitiveUsageByTab((current) => {
          const next = new Map(current)
          if (usage.camera || usage.microphone || usage.location) {
            next.set(usage.tabLabel, usage)
          } else {
            next.delete(usage.tabLabel)
          }
          return next
        })
      }),
    ])
      .then((dispose) => {
        if (disposed) {
          dispose()
          return
        }
        disposeListeners = dispose
        void emitChromeAction({ type: 'request-state' })
      })
      .catch((error) => {
        if (import.meta.env.DEV) {
          console.warn('[nebula] chrome listeners failed to register', error)
        }
      })

    return () => {
      disposed = true
      disposeListeners?.()
    }
  }, [showZoomIndicator])

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

  useEffect(() => {
    setSensitiveUsageByTab((current) => {
      let changed = false
      const next = new Map(current)
      for (const [tabLabel, usage] of next) {
        const shortcutId = shortcutIdForTabWebviewLabel(tabLabel)
        const tab = shortcutId ? tabById.get(shortcutId) : null
        let tabOrigin = ''
        try {
          tabOrigin = tab ? new URL(tab.url).origin : ''
        } catch {
          tabOrigin = ''
        }
        if (!tab || tabOrigin !== usage.origin) {
          next.delete(tabLabel)
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [tabById])

  const sensitiveUsageSummary = useMemo(() => {
    const active = [...sensitiveUsageByTab.values()].filter(
      (usage) => usage.camera || usage.microphone || usage.location,
    )
    if (active.length === 0) return null
    let camera = false
    let microphone = false
    let location = false
    for (const usage of active) {
      camera ||= usage.camera
      microphone ||= usage.microphone
      location ||= usage.location
    }
    let host = ''
    if (active.length === 1) {
      try {
        host = new URL(active[0].origin).host
      } catch {
        host = active[0].origin
      }
    }
    return { camera, microphone, location, host, siteCount: active.length }
  }, [sensitiveUsageByTab])

  useEffect(() => {
    const hasZoom = zoomIndicatorPercent !== null
    const hasSensitiveUsage = sensitiveUsageSummary !== null
    const minimumHeight = tabSearchOpen
      ? 650
      : viewMode !== 'browsing'
      ? 0
      : hasZoom && hasSensitiveUsage
        ? 138
        : hasZoom || hasSensitiveUsage
          ? 78
          : 0
    void setChromeOverlayMinimumLogicalHeight(minimumHeight)
  }, [sensitiveUsageSummary, tabSearchOpen, viewMode, zoomIndicatorPercent])

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

  const isMuted = useCallback(
    (shortcutId: string) => {
      const tab = tabById.get(shortcutId)
      return tab ? tab.isMuted === true : isShortcutMuted(shortcutId)
    },
    [isShortcutMuted, tabById],
  )

  const toggleMute = useCallback(
    (shortcutId: string) => {
      const tab = tabById.get(shortcutId)
      if (!tab) {
        toggleShortcutMute(shortcutId)
        return
      }

      void emitChromeAction({
        type: 'set-tab-muted',
        shortcutId,
        muted: tab.isMuted !== true,
      })
    },
    [tabById, toggleShortcutMute],
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
      {viewMode === 'browsing' && sensitiveUsageSummary && (
        <div
          className={styles.privacyIndicator}
          role="status"
          aria-live="polite"
        >
          <span className={styles.privacyIndicatorPulse} aria-hidden="true" />
          <span className={styles.privacyIndicatorSite}>
            {sensitiveUsageSummary.host ||
              (locale === 'tr'
                ? `${sensitiveUsageSummary.siteCount} site`
                : `${sensitiveUsageSummary.siteCount} sites`)}
          </span>
          <span className={styles.privacyIndicatorFeatures}>
            {sensitiveUsageSummary.camera && (
              <span title={locale === 'tr' ? 'Kamera kullanılıyor' : 'Camera in use'}>
                {locale === 'tr' ? 'Kamera' : 'Camera'}
              </span>
            )}
            {sensitiveUsageSummary.microphone && (
              <span title={locale === 'tr' ? 'Mikrofon kullanılıyor' : 'Microphone in use'}>
                {locale === 'tr' ? 'Mikrofon' : 'Microphone'}
              </span>
            )}
            {sensitiveUsageSummary.location && (
              <span title={locale === 'tr' ? 'Konum kullanılıyor' : 'Location in use'}>
                {locale === 'tr' ? 'Konum' : 'Location'}
              </span>
            )}
          </span>
        </div>
      )}

      {viewMode === 'browsing' && zoomIndicatorPercent !== null && (
        <div
          className={[
            styles.zoomIndicator,
            sensitiveUsageSummary ? styles.zoomIndicatorShifted : '',
          ].filter(Boolean).join(' ')}
          role="status"
          aria-live="polite"
          onPointerEnter={() => {
            if (zoomIndicatorTimerRef.current) {
              clearTimeout(zoomIndicatorTimerRef.current)
              zoomIndicatorTimerRef.current = null
            }
          }}
          onPointerLeave={() => {
            zoomIndicatorTimerRef.current = setTimeout(() => {
              setZoomIndicatorPercent(null)
              zoomIndicatorTimerRef.current = null
            }, 900)
          }}
        >
          <button
            type="button"
            className={styles.zoomIndicatorButton}
            title="Uzaklaştır"
            aria-label="Uzaklaştır"
            onClick={() => void emit('nebula-browser-shortcut', 'zoom-out')}
          >
            −
          </button>
          <svg className={styles.zoomIndicatorIcon} viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="m15.5 15.5 5 5" />
          </svg>
          <button
            type="button"
            className={styles.zoomIndicatorValue}
            title="%100'e sıfırla"
            aria-label={`Yakınlaştırmayı sıfırla: ${zoomIndicatorPercent}%`}
            onClick={() => void emit('nebula-browser-shortcut', 'zoom-reset')}
          >
            {zoomIndicatorPercent}%
          </button>
          <button
            type="button"
            className={styles.zoomIndicatorButton}
            title="Yakınlaştır"
            aria-label="Yakınlaştır"
            onClick={() => void emit('nebula-browser-shortcut', 'zoom-in')}
          >
            +
          </button>
        </div>
      )}

      {tabSearchOpen && (
        <TabSearch
          tabs={catalog.tabs}
          activeTabId={catalog.activeTabId}
          onSelect={(shortcutId) => {
            void emitChromeAction({ type: 'switch-tab', shortcutId })
          }}
          onCloseTab={(shortcutId) => {
            void emitChromeAction({ type: 'close-tab', shortcutId })
          }}
          onToggleMute={toggleMute}
          onClose={() => setTabSearchOpen(false)}
        />
      )}

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
      rememberLayout={settings.browsing.restoreTabsOnStartup}
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
