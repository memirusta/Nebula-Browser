import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DownloadManager } from './components/DownloadManager/DownloadManager'
import { TabSearch } from './components/TabSearch/TabSearch'
import { SiteInfoPanel } from './components/SiteInfoPanel/SiteInfoPanel'
import { PrivateBrowsingPanel } from './components/PrivateBrowsingPanel/PrivateBrowsingPanel'
import { ExtensionsPanel } from './components/ExtensionsPanel/ExtensionsPanel'
import { SemiLunarMenu } from './components/SemiLunarMenu/SemiLunarMenu'
import { RightToolbar } from './components/RightToolbar/RightToolbar'
import {
  matchBrowserShortcut,
  shouldIgnoreShellShortcut,
} from './core/browserShortcuts'
import { DEFAULT_SHORTCUTS } from './core/constants'
import { controlDownload } from './core/download'
import { registerListenerGroup } from './core/listenerGroup'
import {
  emitBrowserShortcut,
  emitChromeAction,
  listenActiveUrl,
  listenDownloadUiState,
  listenToolbarUiState,
  listenGuidedTutorialState,
  listenTabCatalog,
  listenTabSearchRequests,
  listenViewMode,
  listenTabSpawned,
  listenZoomIndicator,
  listenSiteInfoState,
  type DownloadUiStatePayload,
  type ToolbarUiStatePayload,
  type GuidedTutorialStatePayload,
  type ShellViewMode,
  type TabCatalogPayload,
  type SiteInfoStatePayload,
} from './core/nebulaBridge'
import {
  shortcutIdForTabWebviewLabel,
  type BrowserTab,
} from './core/browserTab'
import { buildSemiLunarShortcutCatalog } from './core/semiLunarCatalog'
import {
  listenSensitiveFeatureUsage,
  type SensitiveFeatureUsage,
} from './core/sensitiveFeatureUsage'
import { computeAdaptiveLunarSize } from './core/lunarSizing'
import { chromeOverlayMinimumHeight } from './core/chromeOverlayLayout'
import { tabCanGoForward } from './core/tabNavigation'
import { useBrowseSessions } from './hooks/useBrowseSessions'
import { useBrowserShortcutBindings } from './hooks/useBrowserShortcutBindings'
import { useNebulaSettings } from './hooks/useNebulaSettings'
import { useLocale } from './hooks/useLocale'
import { usePinnedShortcuts } from './hooks/usePinnedShortcuts'
import { useShortcutFolders } from './hooks/useShortcutFolders'
import { useShortcutPreferences } from './hooks/useShortcutPreferences'
import { setChromeBubbleRects, setChromeOverlayMinimumLogicalHeight } from './platform/tauriChromeWebview'
import { hostHasSiteException, siteCompatibilityTarget } from './core/siteCompatibility'
import './styles/global.css'

/** How long the camera/microphone bubble stays in full when something starts being used. */
const USAGE_BUBBLE_FULL_MS = 4_500
/** How long after the pointer leaves it shrinks again. */
const USAGE_BUBBLE_HOVER_LEAVE_MS = 1_200
/** The widest the bubble gets, as in its style sheet. */
const USAGE_BUBBLE_MAX_WIDTH = 560
/** Longer than its grow/shrink animation. */
const USAGE_BUBBLE_SETTLE_MS = 480
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
  const { t, tf } = useLocale()
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
  } = usePinnedShortcuts(allShortcuts)

  const { getSession } = useBrowseSessions()

  const [catalog, setCatalog] = useState<TabCatalogPayload>({
    tabs: [],
    activeTabId: null,
  })
  const [activeUrl, setActiveUrl] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ShellViewMode>('home')
  const [guidedTutorial, setGuidedTutorial] = useState<GuidedTutorialStatePayload>({
    open: false,
    step: 0,
  })
  const [downloadUi, setDownloadUi] = useState<DownloadUiStatePayload>({
    items: [],
    activeCount: 0,
    aggregateProgress: null,
    panelOpen: false,
  })
  const [toolbarUi, setToolbarUi] = useState<ToolbarUiStatePayload>({
    notificationBadge: 0,
  })
  const [zoomIndicatorPercent, setZoomIndicatorPercent] = useState<number | null>(null)
  const [tabSearchOpen, setTabSearchOpen] = useState(false)
  const [siteInfoOpen, setSiteInfoOpen] = useState(false)
  const [privateInfoOpen, setPrivateInfoOpen] = useState(false)
  const extensionsContext = `${viewMode}:${catalog.activeTabId ?? ''}`
  const [extensionsOpenFor, setExtensionsOpenFor] = useState<string | null>(null)
  const extensionsOpen = extensionsOpenFor === extensionsContext
  const closeExtensions = useCallback(() => setExtensionsOpenFor(null), [])
  const privateTabs = useMemo(() => catalog.tabs.filter((tab) => tab.isPrivate), [catalog.tabs])
  const privateIndicatorVisible = settings.privacy.privateMode || privateTabs.length > 0
  const closePrivateInfo = useCallback(() => setPrivateInfoOpen(false), [])
  const [siteInfoState, setSiteInfoState] = useState<SiteInfoStatePayload>({
    shortcutId: null,
    url: null,
    origin: null,
    hostname: null,
    protectionDisabled: false,
    darkenWebpagesOverride: 'default',
    permissionPromptsAllowed: false,
    notificationPermission: null,
    permissions: {
      camera: 'unsupported',
      microphone: 'unsupported',
      location: 'unsupported',
    },
  })
  const [sensitiveUsageByTab, setSensitiveUsageByTab] = useState(
    () => new Map<string, SensitiveFeatureUsage>(),
  )
  const zoomIndicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The camera/microphone bubble shows in full when something starts being used, then shrinks to icons.
  const [usageExpanded, setUsageExpanded] = useState(true)
  const usageCollapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const usageBubbleRef = useRef<HTMLDivElement>(null)
  // A tab a page opened: the menu opens for a moment and its icon is highlighted (the menu does it).
  const [spawnedTab, setSpawnedTab] = useState<{ shortcutId: string; key: number } | null>(null)
  const zoomBubbleRef = useRef<HTMLDivElement>(null)

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
      () => listenToolbarUiState(setToolbarUi),
      () => listenGuidedTutorialState(setGuidedTutorial),
      () => listenZoomIndicator(showZoomIndicator),
      () => listenTabSpawned((shortcutId) => {
        setSpawnedTab((current) => ({ shortcutId, key: (current?.key ?? 0) + 1 }))
      }),
      () => listenTabSearchRequests(() => { setExtensionsOpenFor(null); setPrivateInfoOpen(false); setTabSearchOpen(true) }),
      () => listenSiteInfoState(setSiteInfoState),
      () => listenSensitiveFeatureUsage((usage) => {
        setSensitiveUsageByTab((current) => {
          const next = new Map(current)
          if (usage.camera || usage.microphone || usage.location || usage.screen) {
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
      void emitBrowserShortcut(action)
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

  // Forward is offered only while the active tab has a page ahead of the one it shows.
  const canGoForward = useMemo(() => {
    const active = catalog.tabs.find((tab) => tab.shortcutId === catalog.activeTabId)
    return Boolean(active && tabCanGoForward(active))
  }, [catalog.tabs, catalog.activeTabId])

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
      (usage) => usage.camera || usage.microphone || usage.location || usage.screen,
    )
    if (active.length === 0) return null
    let camera = false
    let microphone = false
    let location = false
    let screen = false
    for (const usage of active) {
      camera ||= usage.camera
      microphone ||= usage.microphone
      location ||= usage.location
      screen ||= usage.screen
    }
    let host = ''
    if (active.length === 1) {
      try {
        host = new URL(active[0].origin).host
      } catch {
        host = active[0].origin
      }
    }
    return { camera, microphone, location, screen, host, siteCount: active.length }
  }, [sensitiveUsageByTab])

  const usageSignature = sensitiveUsageSummary
    ? [
        sensitiveUsageSummary.camera,
        sensitiveUsageSummary.microphone,
        sensitiveUsageSummary.location,
        sensitiveUsageSummary.screen,
        sensitiveUsageSummary.host,
        sensitiveUsageSummary.siteCount,
      ].join('|')
    : ''

  const usageBubbleLabel = sensitiveUsageSummary
    ? [
        sensitiveUsageSummary.host || tf('privacySiteCount', { n: sensitiveUsageSummary.siteCount }),
        sensitiveUsageSummary.camera ? t('privacyCameraInUse') : '',
        sensitiveUsageSummary.microphone ? t('privacyMicrophoneInUse') : '',
        sensitiveUsageSummary.location ? t('privacyLocationInUse') : '',
        sensitiveUsageSummary.screen ? t('privacyScreenInUse') : '',
      ].filter(Boolean).join(', ')
    : undefined

  const scheduleUsageCollapse = useCallback((delayMs: number) => {
    if (usageCollapseTimerRef.current) clearTimeout(usageCollapseTimerRef.current)
    usageCollapseTimerRef.current = setTimeout(() => {
      usageCollapseTimerRef.current = null
      setUsageExpanded(false)
    }, delayMs)
  }, [])

  const holdUsageExpanded = useCallback(() => {
    if (usageCollapseTimerRef.current) {
      clearTimeout(usageCollapseTimerRef.current)
      usageCollapseTimerRef.current = null
    }
    setUsageExpanded(true)
  }, [])

  // Whenever something new starts being used the bubble is shown in full, then it shrinks.
  useEffect(() => {
    if (!usageSignature) {
      if (usageCollapseTimerRef.current) clearTimeout(usageCollapseTimerRef.current)
      usageCollapseTimerRef.current = null
      setUsageExpanded(true)
      return
    }
    setUsageExpanded(true)
    scheduleUsageCollapse(USAGE_BUBBLE_FULL_MS)
    return () => {
      if (usageCollapseTimerRef.current) clearTimeout(usageCollapseTimerRef.current)
      usageCollapseTimerRef.current = null
    }
  }, [scheduleUsageCollapse, usageSignature])

  const activeSensitiveUsage = useMemo(() => {
    if (!siteInfoState.shortcutId || !siteInfoState.origin) {
      return { camera: false, microphone: false, location: false, screen: false }
    }
    for (const usage of sensitiveUsageByTab.values()) {
      if (
        shortcutIdForTabWebviewLabel(usage.tabLabel) === siteInfoState.shortcutId &&
        usage.origin === siteInfoState.origin
      ) {
        return {
          camera: usage.camera,
          microphone: usage.microphone,
          location: usage.location,
          screen: usage.screen,
        }
      }
    }
    return { camera: false, microphone: false, location: false, screen: false }
  }, [sensitiveUsageByTab, siteInfoState.origin, siteInfoState.shortcutId])

  const effectiveSiteInfoState = useMemo<SiteInfoStatePayload>(() => {
    const target = activeUrl ? siteCompatibilityTarget(activeUrl) : null
    if (!target) return siteInfoState
    const active = catalog.activeTabId
      ? tabById.get(catalog.activeTabId) ?? null
      : null
    const origin = new URL(target.url).origin
    if (
      siteInfoState.shortcutId === active?.shortcutId &&
      siteInfoState.origin === origin
    ) {
      return siteInfoState
    }
    const permissionPromptsAllowed =
      settings.privacy.permissionPolicy === 'ask' ||
      hostHasSiteException(target.hostname, settings.privacy.permissionExceptions)
    const fallbackPermission = permissionPromptsAllowed ? 'prompt' : 'denied'
    return {
      shortcutId: active?.shortcutId ?? null,
      url: target.url,
      origin,
      hostname: target.hostname,
      protectionDisabled: hostHasSiteException(target.hostname, settings.privacy.siteExceptions),
      darkenWebpagesOverride:
        settings.appearance.darkenWebpagesSiteOverrides[target.hostname] ?? 'default',
      permissionPromptsAllowed,
      notificationPermission: null,
      permissions: {
        camera: fallbackPermission,
        microphone: fallbackPermission,
        location: fallbackPermission,
      },
    }
  }, [activeUrl, catalog.activeTabId, settings.appearance, settings.privacy, siteInfoState, tabById])

  useEffect(() => {
    const floatingPanelHeight = chromeOverlayMinimumHeight({
      siteInfoOpen,
      privateInfoOpen,
      extensionsOpen,
      tabSearchOpen,
      isBrowsing: viewMode === 'browsing',
      hasZoom: zoomIndicatorPercent !== null,
      hasSensitiveUsage: sensitiveUsageSummary !== null,
    })
    const homeToolbarHeight =
      viewMode === 'home' &&
      settings.home.showToolbar
        ? downloadUi.items.length > 0
          ? 248
          : 192
        : 0
    const minimumHeight = Math.max(floatingPanelHeight, homeToolbarHeight)
    void setChromeOverlayMinimumLogicalHeight(minimumHeight).then(() => {
      if (viewMode === 'browsing' && catalog.activeTabId) {
        return emitChromeAction({ type: 'raise-chrome-overlay' })
      }
    })
  }, [catalog.activeTabId, downloadUi.items.length, sensitiveUsageSummary, settings.home.showToolbar, siteInfoOpen, privateInfoOpen, extensionsOpen, tabSearchOpen, viewMode, zoomIndicatorPercent])

  // The overlay is as wide as the window and a transparent webview takes every click, so only the
  // bubbles themselves (and the strip and menu) may belong to it; the page below gets the rest.
  const usageBubbleShown = viewMode === 'browsing' && sensitiveUsageSummary !== null
  const zoomBubbleShown = viewMode === 'browsing' && zoomIndicatorPercent !== null
  useEffect(() => {
    if (!usageBubbleShown && !zoomBubbleShown) {
      void setChromeBubbleRects([])
      return
    }
    const measure = (changing: boolean) => {
      const rects: Array<{ x: number; y: number; width: number; height: number }> = []
      if (usageBubbleShown) {
        const element = usageBubbleRef.current?.getBoundingClientRect()
        // While it grows or shrinks the room it can take is reserved, so nothing is cut off.
        if (changing || !element) {
          rects.push({
            x: Math.max(0, window.innerWidth - USAGE_BUBBLE_MAX_WIDTH - 18),
            y: 0,
            width: USAGE_BUBBLE_MAX_WIDTH + 18,
            height: 78,
          })
        } else {
          rects.push({ x: element.left, y: element.top, width: element.width, height: element.height })
        }
      }
      const zoom = zoomBubbleRef.current?.getBoundingClientRect()
      if (zoomBubbleShown && zoom) rects.push({ x: zoom.left, y: zoom.top, width: zoom.width, height: zoom.height })
      void setChromeBubbleRects(rects)
    }
    measure(true)
    const settled = setTimeout(() => measure(false), USAGE_BUBBLE_SETTLE_MS)
    const onResize = () => measure(false)
    window.addEventListener('resize', onResize)
    return () => {
      clearTimeout(settled)
      window.removeEventListener('resize', onResize)
    }
  }, [usageBubbleShown, zoomBubbleShown, usageExpanded, usageSignature])

  useEffect(() => {
    if (viewMode !== 'browsing' || !privateIndicatorVisible) setPrivateInfoOpen(false)
  }, [viewMode, privateIndicatorVisible])

  useEffect(() => {
    if (viewMode !== 'browsing') setSiteInfoOpen(false)
  }, [viewMode])

  useEffect(() => {
    if (!siteInfoOpen) return
    void emitChromeAction({ type: 'request-site-info' })
  }, [activeUrl, siteInfoOpen])

  const getTab = useCallback(
    (shortcutId: string): BrowserTab | null => tabById.get(shortcutId) ?? null,
    [tabById],
  )

  const semiLunarShortcuts = useMemo(() => {
    return buildSemiLunarShortcutCatalog(visibleShortcuts, catalog.tabs)
  }, [visibleShortcuts, catalog.tabs])

  const {
    dockItemIds,
    folders,
    createFolderFromShortcuts,
    addShortcutToFolder,
    removeShortcutFromFolders,
    removeMemberFromFolder,
    renameFolder,
  } = useShortcutFolders(
    visibleShortcuts,
    settings.browsing.restoreTabsOnStartup,
    semiLunarShortcuts,
  )

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
    setPrivateInfoOpen(false)
    setExtensionsOpenFor(null)
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
      {viewMode === 'home' && settings.home.showToolbar && (
        <RightToolbar
          onSettings={(anchor) => {
            void emitChromeAction({ type: 'open-settings', anchor })
          }}
          onNotifications={() => {
            void emitChromeAction({ type: 'toggle-notification-panel' })
          }}
          onDownloads={toggleDownloads}
          onHistory={() => {
            void emitChromeAction({ type: 'toggle-history-panel' })
          }}
          notificationBadge={toolbarUi.notificationBadge}
          downloadCount={downloadUi.items.length}
          activeDownloadCount={downloadUi.activeCount}
          downloadProgress={downloadUi.aggregateProgress}
        />
      )}

      {viewMode === 'browsing' && sensitiveUsageSummary && (
        <div
          ref={usageBubbleRef}
          className={[
            styles.privacyIndicator,
            usageExpanded ? '' : styles.privacyIndicatorCompact,
          ].filter(Boolean).join(' ')}
          role="status"
          aria-live="polite"
          aria-label={usageBubbleLabel}
          tabIndex={0}
          onPointerEnter={holdUsageExpanded}
          onPointerLeave={() => scheduleUsageCollapse(USAGE_BUBBLE_HOVER_LEAVE_MS)}
          onFocus={holdUsageExpanded}
          onBlur={() => scheduleUsageCollapse(USAGE_BUBBLE_HOVER_LEAVE_MS)}
        >
          <span className={styles.privacyIndicatorBody} aria-hidden={!usageExpanded}>
          <span className={styles.privacyIndicatorSite}>
            {sensitiveUsageSummary.host ||
              tf('privacySiteCount', { n: sensitiveUsageSummary.siteCount })}
          </span>
          <span className={styles.privacyIndicatorFeatures}>
            {sensitiveUsageSummary.camera && (
              <span title={t('privacyCameraInUse')}>
                {t('privacyCamera')}
              </span>
            )}
            {sensitiveUsageSummary.microphone && (
              <span title={t('privacyMicrophoneInUse')}>
                {t('privacyMicrophone')}
              </span>
            )}
            {sensitiveUsageSummary.location && (
              <span title={t('privacyLocationInUse')}>
                {t('privacyLocation')}
              </span>
            )}
            {sensitiveUsageSummary.screen && (
              <span title={t('privacyScreenInUse')}>
                {t('privacyScreen')}
              </span>
            )}
          </span>
          </span>
          <span className={styles.privacyIndicatorIcons} aria-hidden="true">
            {sensitiveUsageSummary.camera && (
              <span className={`${styles.privacyIcon} ${styles.privacyIconCamera}`} title={t('privacyCameraInUse')}>
                <svg viewBox="0 0 24 24"><path d="M3 8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="m15 11 6-3.5v9L15 13" /></svg>
              </span>
            )}
            {sensitiveUsageSummary.microphone && (
              <span className={`${styles.privacyIcon} ${styles.privacyIconMicrophone}`} title={t('privacyMicrophoneInUse')}>
                <svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
              </span>
            )}
            {sensitiveUsageSummary.location && (
              <span className={`${styles.privacyIcon} ${styles.privacyIconLocation}`} title={t('privacyLocationInUse')}>
                <svg viewBox="0 0 24 24"><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>
              </span>
            )}
            {sensitiveUsageSummary.screen && (
              <span className={`${styles.privacyIcon} ${styles.privacyIconScreen}`} title={t('privacyScreenInUse')}>
                <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>
              </span>
            )}
          </span>
        </div>
      )}

      {viewMode === 'browsing' && zoomIndicatorPercent !== null && (
        <div
          ref={zoomBubbleRef}
          className={[
            styles.zoomIndicator,
            sensitiveUsageSummary
              ? usageExpanded ? styles.indicatorBelow : styles.indicatorBelowCompact
              : '',
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
            onClick={() => void emitBrowserShortcut('zoom-out')}
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
            onClick={() => void emitBrowserShortcut('zoom-reset')}
          >
            {zoomIndicatorPercent}%
          </button>
          <button
            type="button"
            className={styles.zoomIndicatorButton}
            title="Yakınlaştır"
            aria-label="Yakınlaştır"
            onClick={() => void emitBrowserShortcut('zoom-in')}
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
      onTabDragDrop={(shortcutId, screenX, screenY) => {
        void emitChromeAction({
          type: 'move-tab',
          shortcutId,
          screenX,
          screenY,
        })
      }}
      openTabIds={openTabIds}
      activeTabId={catalog.activeTabId}
      activeTabPrivate={privateIndicatorVisible}
      privateInfoOpen={privateInfoOpen}
      extensionsOpen={extensionsOpen}
      onExtensionsClick={() => {
        setSiteInfoOpen(false)
        setTabSearchOpen(false)
        setPrivateInfoOpen(false)
        closeDownloads()
        setExtensionsOpenFor(value => value === extensionsContext ? null : extensionsContext)
      }}
      onPrivateInfoClick={() => {
        setExtensionsOpenFor(null)
        setSiteInfoOpen(false)
        setTabSearchOpen(false)
        closeDownloads()
        setPrivateInfoOpen((current) => !current)
      }}
      getTab={getTab}
      onToggleMute={toggleMute}
      isMuted={isMuted}
      isPinned={isPinned}
      onTogglePin={(shortcut) => {
        void emitChromeAction({ type: 'toggle-pin', shortcut })
      }}
      canPinMore={canPinMore}
      onRemoveMemberFromFolder={removeMemberFromFolder}
      activeUrl={activeUrl}
      siteInfoOpen={siteInfoOpen}
      onSiteInfoClick={() => {
        setExtensionsOpenFor(null)
        setPrivateInfoOpen(false)
        setSiteInfoOpen((current) => !current)
        void emitChromeAction({ type: 'request-site-info' })
      }}
      getSession={getSession}
      previewOnHover={semiLunar.previewOnHover}
      homeAlwaysOpen={
        guidedTutorial.open && guidedTutorial.step === 0
          ? false
          : semiLunar.homeAlwaysOpen
      }
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
      spawnedTabId={spawnedTab?.shortcutId ?? null}
      spawnedTabKey={spawnedTab?.key ?? 0}
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
      onForwardClick={
        viewMode !== 'home' && canGoForward
          ? () => {
              void emitChromeAction({ type: 'go-forward' })
            }
          : undefined
      }
      onDownloadsClick={
        viewMode === 'browsing' ? toggleDownloads : undefined
      }
      downloadCount={downloadUi.items.length}
      activeDownloadCount={downloadUi.activeCount}
      downloadProgress={downloadUi.aggregateProgress}
      downloadPanelOpen={browsingDownloadPanelOpen}
      forceOpen={browsingDownloadPanelOpen || privateInfoOpen || extensionsOpen}
      tutorialExpansion={
        guidedTutorial.open && guidedTutorial.step === 1
          ? true
          : null
      }
      tutorialHoverOpen={guidedTutorial.open && guidedTutorial.step === 0}
      tutorialDemoTab={guidedTutorial.open && guidedTutorial.step === 1}
      tutorialHighlight={
        guidedTutorial.open
          ? guidedTutorial.step === 0
            ? 'edge'
            : guidedTutorial.step === 1
              ? 'content'
              : null
          : null
      }
      />

      {extensionsOpen && viewMode === 'browsing' && (
        <ExtensionsPanel top={adaptiveLunar.height + 12}
          activeUrl={activeUrl ?? undefined}
          privateTab={!!tabById.get(catalog.activeTabId ?? '')?.isPrivate}
          onClose={closeExtensions} onManage={() => {
            closeExtensions()
            void emitChromeAction({ type: 'open-extensions' })
          }} />
      )}

      {privateInfoOpen && viewMode === 'browsing' && (
        <PrivateBrowsingPanel
          tabs={privateTabs}
          top={adaptiveLunar.height + 12}
          onClose={closePrivateInfo}
          onEnd={() => {
            void emitChromeAction({ type: 'end-private-browsing' })
            closePrivateInfo()
          }}
        />
      )}

      {siteInfoOpen && effectiveSiteInfoState.hostname && effectiveSiteInfoState.origin && effectiveSiteInfoState.shortcutId && (
        <SiteInfoPanel
          state={effectiveSiteInfoState}
          favicon={tabById.get(effectiveSiteInfoState.shortcutId)?.favicon}
          top={adaptiveLunar.height + 12}
          usage={activeSensitiveUsage}
          onClose={() => setSiteInfoOpen(false)}
          onToggleProtection={() => {
            void emitChromeAction({
              type: 'set-site-protection',
              hostname: effectiveSiteInfoState.hostname!,
              disabled: !effectiveSiteInfoState.protectionDisabled,
            })
          }}
          onSetDarkening={(mode) => {
            void emitChromeAction({
              type: 'set-site-darkening',
              hostname: effectiveSiteInfoState.hostname!,
              mode,
            })
          }}
          onSetNotificationPermission={(permission) => {
            void emitChromeAction({
              type: 'set-site-notification-permission',
              origin: effectiveSiteInfoState.origin!,
              permission,
            })
          }}
          onResetPermissions={() => {
            void emitChromeAction({
              type: 'reset-site-permissions',
              shortcutId: effectiveSiteInfoState.shortcutId!,
              origin: effectiveSiteInfoState.origin!,
            })
          }}
          onClearSiteData={() => {
            void emitChromeAction({
              type: 'clear-site-data',
              shortcutId: effectiveSiteInfoState.shortcutId!,
              origin: effectiveSiteInfoState.origin!,
            })
            setSiteInfoOpen(false)
          }}
        />
      )}

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
