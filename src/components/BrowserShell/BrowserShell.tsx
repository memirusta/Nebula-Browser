import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { isTauri } from '../../platform/runtime'
import { listenChromeActions, emitActiveUrl, emitTabCatalog, emitViewMode } from '../../core/nebulaBridge'
import type { ShellViewMode } from '../../core/nebulaBridge'
import { syncTauriViewMode, applyTauriViewModeNow } from '../../platform/tauriBrowsingMode'
import { setOverlayModeActive } from '../../platform/tauriWebviewStack'
import { DEFAULT_SHORTCUTS } from '../../core/constants'
import { loadBrowseSessions } from '../../core/browseSession'
import { resolveShortcutForOpen } from '../../core/navigateShortcut'
import { SHORTCUT_POSITIONS_KEY } from '../../core/shortcutLayout'
import { closeBrowseTab, navigateBrowseTabBack, snapshotTabWebview } from '../../platform/tauriBrowser'
import { useBrowserTabs } from '../../hooks/useBrowserTabs'
import { shortcutFromTab } from '../../core/browserTab'
import { computeAdaptiveLunarSize } from '../../core/lunarSizing'
import { homeLayoutFromSettings, type HomeLayout } from '../../core/homeLayout'
import { HomeCenter } from '../HomeCenter/HomeCenter'
import { LeftSidebar } from '../LeftSidebar/LeftSidebar'
import { HomeWidgetGrid } from '../SpatialGrid/HomeWidgetGrid'
import { RightToolbar } from '../RightToolbar/RightToolbar'
import { SemiLunarMenu } from '../SemiLunarMenu/SemiLunarMenu'
import { SettingsPanel } from '../SettingsPanel/SettingsPanel'
import { HomeEditBar } from '../HomeEdit/HomeEditBar'
import { WallpaperBackground } from '../WallpaperBackground/WallpaperBackground'
import { usePinnedShortcuts } from '../../hooks/usePinnedShortcuts'
import { useShortcutPreferences } from '../../hooks/useShortcutPreferences'
import { useShortcutFolders } from '../../hooks/useShortcutFolders'
import { useNebulaSettings } from '../../hooks/useNebulaSettings'
import { useBrowseSessions } from '../../hooks/useBrowseSessions'
import { useWidgetLayout } from '../../hooks/useWidgetLayout'
import { useSystemStats, useWallpaper } from '../../hooks/useSystemStats'
import type { ToolbarAnchor } from '../RightToolbar/RightToolbar'
import type { Shortcut } from '../../core/types'
import { TabbedBrowserContent } from './TabbedBrowserContent'
import {
  OnboardingWizard,
  type OnboardingResult,
} from '../Onboarding/OnboardingWizard'
import { completeOnboarding, isOAuthReturnUrl, isOnboardingComplete, onboardingStepAfterOAuthReturn, peekOnboardingResumeStep, takeOnboardingImportedShortcuts, takeOnboardingResumeStep } from '../../core/onboarding'
import { factoryResetNebulaApp } from '../../core/appReset'
import {
  nebulaAccountFromGoogleClaims,
  resumeGoogleSignInFromRedirect,
} from '../../core/googleSignIn'
import { useNebulaAccount } from '../../hooks/useNebulaAccount'
import styles from './BrowserShell.module.css'

type ViewMode = 'home' | 'browsing' | 'overlay'

export function BrowserShell() {
  const stats = useSystemStats()
  const { wallpaper, pickWallpaper, resetWallpaper } = useWallpaper()
  const { visibleShortcuts, allShortcuts, toggleMute, removeShortcut, addVisitedShortcut, isMuted, resetShortcuts, applyImportedShortcuts } =
    useShortcutPreferences(DEFAULT_SHORTCUTS)
  const {
    pinnedShortcuts: pinnedShortcutList,
    isPinned,
    canPinMore,
    togglePin,
    unpinShortcut,
    reorderPins,
    resetPins,
    reloadPinnedIds,
  } = usePinnedShortcuts(allShortcuts, visibleShortcuts)
  const {
    dockItemIds,
    folders,
    createFolderFromShortcuts,
    addShortcutToFolder,
    removeShortcutFromFolders,
    removeMemberFromFolder,
    renameFolder,
    resetFolders,
  } = useShortcutFolders(visibleShortcuts)
  const { settings, togglePreviewOnHover, updateCategory, resetCategory, applyHomeLayout } =
    useNebulaSettings()
  const { account, displayName: accountDisplayName, setAccount } = useNebulaAccount(
    settings.home.userDisplayName,
  )
  const widgetLayout = useWidgetLayout({
    showRamWidget: settings.home.showRamWidget,
    showCpuWidget: settings.home.showCpuWidget,
  })
  const { recordVisit, getSession } = useBrowseSessions()
  const {
    tabs,
    activeTab,
    activeTabId,
    openTabIds,
    activeTabIdRef,
    tabsRef,
    openOrSwitchTab,
    closeTab,
    applyTabSnapshot,
    getTab,
    setActiveTabId,
  } = useBrowserTabs()

  const handleRemoveFromSemiLunar = useCallback(
    (id: string) => {
      removeShortcut(id)
      removeShortcutFromFolders(id)
    },
    [removeShortcut, removeShortcutFromFolders],
  )

  const handleResetShortcuts = useCallback(() => {
    resetShortcuts()
    resetFolders()
    resetPins()
    localStorage.removeItem(SHORTCUT_POSITIONS_KEY)
  }, [resetShortcuts, resetFolders, resetPins])

  const handleApplyImportedShortcuts = useCallback(
    (shortcuts: Shortcut[]) => {
      if (shortcuts.length === 0) return
      applyImportedShortcuts(shortcuts)
      reloadPinnedIds()
    },
    [applyImportedShortcuts, reloadPinnedIds],
  )

  const handleOnboardingComplete = useCallback(
    (result: OnboardingResult) => {
      if (result.importedShortcuts.length > 0) {
        handleApplyImportedShortcuts(result.importedShortcuts)
      }

      if (result.account) {
        setAccount(result.account)
        updateCategory('home', 'userDisplayName', result.account.displayName)
      }

      completeOnboarding()
      setOnboardingOpen(false)
      setOnboardingInitialStep(undefined)
    },
    [handleApplyImportedShortcuts, setAccount, updateCategory],
  )

  const handleFactoryReset = useCallback(() => {
    factoryResetNebulaApp()
  }, [])

  const [activeUrl, setActiveUrl] = useState<string | null>(null)
  const [, setTabSwitchHistory] = useState<string[]>([])
  const pollTickRef = useRef(0)
  const pendingBrowseTargetRef = useRef<{ tabId: string; url: string; forceNavigate?: boolean } | null>(
    null,
  )
  const overlayDismissGuardRef = useRef(0)
  const [tauriBrowseSyncToken, setTauriBrowseSyncToken] = useState(0)
  const [viewMode, setViewMode] = useState<ViewMode>('home')
  const viewModeRef = useRef<ViewMode>('home')
  const [shortcutInteractionActive, setShortcutInteractionActive] = useState(false)
  const [lunarShortcutInteraction, setLunarShortcutInteraction] = useState(false)
  const [pinShortcutInteraction, setPinShortcutInteraction] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsAnchor, setSettingsAnchor] = useState<ToolbarAnchor | null>(null)
  const [homeEditMode, setHomeEditMode] = useState(false)
  const [draftLayout, setDraftLayout] = useState<HomeLayout | null>(null)
  const [onboardingOpen, setOnboardingOpen] = useState(() => {
    if (!isOnboardingComplete() && isOAuthReturnUrl()) return false
    return !isOnboardingComplete()
  })
  const [onboardingInitialStep, setOnboardingInitialStep] = useState<
    'welcome' | 'bookmarks' | 'profile' | 'done' | undefined
  >(() => onboardingStepAfterOAuthReturn())
  const googleResumeStartedRef = useRef(false)

  useEffect(() => {
    if (googleResumeStartedRef.current) return
    if (!isOAuthReturnUrl()) return
    googleResumeStartedRef.current = true

    void (async () => {
      const { claims } = await resumeGoogleSignInFromRedirect()
      if (!claims) {
        window.history.replaceState({}, '', window.location.pathname + window.location.hash)
        if (!isOnboardingComplete()) {
          const resume = peekOnboardingResumeStep() ?? 'profile'
          setOnboardingOpen(true)
          setOnboardingInitialStep(resume === 'profile' ? 'profile' : resume)
        }
        return
      }

      const googleAccount = nebulaAccountFromGoogleClaims(claims)
      setAccount(googleAccount)
      updateCategory('home', 'userDisplayName', googleAccount.displayName)

      const pendingImports = takeOnboardingImportedShortcuts()
      if (pendingImports.length > 0) {
        handleApplyImportedShortcuts(pendingImports)
      }

      takeOnboardingResumeStep()

      if (!isOnboardingComplete()) {
        completeOnboarding()
      }
      setOnboardingOpen(false)
      setOnboardingInitialStep(undefined)
    })()
  }, [setAccount, updateCategory, handleApplyImportedShortcuts])

  useEffect(() => {
    setShortcutInteractionActive(lunarShortcutInteraction || pinShortcutInteraction)
  }, [lunarShortcutInteraction, pinShortcutInteraction])

  useEffect(() => {
    viewModeRef.current = viewMode
  }, [viewMode])

  useEffect(() => {
    if (!isTauri) return
    void emitViewMode(viewMode)
  }, [viewMode])

  useEffect(() => {
    if (!isTauri) return

    if (viewMode === 'browsing') {
      document.documentElement.dataset.nebulaBrowsingTauri = 'true'
      delete document.documentElement.dataset.nebulaOverlayTauri
    } else if (viewMode === 'overlay') {
      delete document.documentElement.dataset.nebulaBrowsingTauri
      document.documentElement.dataset.nebulaOverlayTauri = 'true'
    } else {
      delete document.documentElement.dataset.nebulaBrowsingTauri
      delete document.documentElement.dataset.nebulaOverlayTauri
    }

    return () => {
      delete document.documentElement.dataset.nebulaBrowsingTauri
      delete document.documentElement.dataset.nebulaOverlayTauri
    }
  }, [viewMode])

  useEffect(() => {
    if (activeTab) {
      setActiveUrl(activeTab.url)
    }
  }, [activeTab])

  useEffect(() => {
    if (!activeUrl) return
    recordVisit(activeUrl)
  }, [activeUrl, recordVisit])

  useEffect(() => {
    if (!isTauri || viewMode !== 'browsing' || tabs.length === 0) return

    const poll = async () => {
      pollTickRef.current += 1
      const tick = pollTickRef.current

      for (const tab of tabsRef.current) {
        const isActive = tab.shortcutId === activeTabIdRef.current
        if (!isActive && tick % 4 !== 0) continue

        const snapshot = await snapshotTabWebview(tab.shortcutId)
        if (!snapshot) continue

        applyTabSnapshot(tab.shortcutId, snapshot.url, snapshot.title)
        if (isActive) {
          const current = tabsRef.current.find((t) => t.shortcutId === tab.shortcutId)
          if (!current || current.url !== snapshot.url) {
            recordVisit(snapshot.url)
            setActiveUrl(snapshot.url)
          }
        }
      }
    }

    void poll()
    const id = window.setInterval(() => void poll(), 4000)
    return () => clearInterval(id)
  }, [viewMode, tabs.length, applyTabSnapshot, recordVisit, activeTabIdRef, tabsRef])

  useEffect(() => {
    if (!isTauri) return
    void emitActiveUrl(activeUrl)
  }, [activeUrl])

  useEffect(() => {
    if (!isTauri) return
    void emitTabCatalog({ tabs, activeTabId })
  }, [tabs, activeTabId])

  const openSettings = useCallback((anchor: ToolbarAnchor) => {
    setSettingsAnchor(anchor)
    setSettingsOpen(true)
  }, [])

  const closeSettings = useCallback(() => {
    setSettingsOpen(false)
    setSettingsAnchor(null)
  }, [])

  const enterHomeEditMode = useCallback(() => {
    setViewMode('home')
    setDraftLayout(homeLayoutFromSettings(settings.home))
    setHomeEditMode(true)
    setSettingsOpen(false)
    setSettingsAnchor(null)
  }, [settings.home])

  const saveHomeEditMode = useCallback(() => {
    if (draftLayout) {
      applyHomeLayout(draftLayout)
    }
    setHomeEditMode(false)
    setDraftLayout(null)
  }, [draftLayout, applyHomeLayout])

  const cancelHomeEditMode = useCallback(() => {
    setHomeEditMode(false)
    setDraftLayout(null)
  }, [])

  const updateDraftLayout = useCallback((patch: Partial<HomeLayout>) => {
    setDraftLayout((prev) => (prev ? { ...prev, ...patch } : prev))
  }, [])

  const switchToExistingBrowseTab = useCallback(
    (shortcutId: string) => {
      setTabSwitchHistory((history) => {
        const current = activeTabIdRef.current
        if (current && current !== shortcutId) {
          return [...history, current]
        }
        return history
      })
      setActiveTabId(shortcutId)
      setViewMode('browsing')
      setTauriBrowseSyncToken((token) => token + 1)
    },
    [activeTabIdRef, setActiveTabId],
  )

  const openShortcutByUrl = useCallback(
    (shortcutUrl: string, options?: { forceTargetUrl?: boolean }) => {
      const { shortcut: launchShortcut, forceLoad } = resolveShortcutForOpen(
        shortcutUrl,
        allShortcuts,
        loadBrowseSessions(),
        options,
      )
      const existingTab = getTab(launchShortcut.id)
      const tabExists = !!existingTab

      if (tabExists && !forceLoad) {
        switchToExistingBrowseTab(launchShortcut.id)
        return
      }

      addVisitedShortcut(launchShortcut.url)

      setTabSwitchHistory((history) => {
        const current = activeTabIdRef.current
        if (current && current !== launchShortcut.id) {
          return [...history, current]
        }
        return history
      })

      pendingBrowseTargetRef.current = {
        tabId: launchShortcut.id,
        url: launchShortcut.url,
        forceNavigate: forceLoad,
      }

      openOrSwitchTab(launchShortcut, { reload: forceLoad && tabExists })
      setTauriBrowseSyncToken((token) => token + 1)
      setViewMode('browsing')
    },
    [
      addVisitedShortcut,
      allShortcuts,
      getTab,
      openOrSwitchTab,
      activeTabIdRef,
      switchToExistingBrowseTab,
    ],
  )

  const openFromSearchBar = useCallback(
    (shortcutUrl: string) => {
      openShortcutByUrl(shortcutUrl, { forceTargetUrl: true })
    },
    [openShortcutByUrl],
  )

  const handleCloseTab = useCallback(
    async (shortcutId: string) => {
      const remaining = tabsRef.current.filter((tab) => tab.shortcutId !== shortcutId)
      const goingHome = remaining.length === 0

      if (isTauri) {
        await closeBrowseTab(shortcutId)
        if (goingHome) {
          await applyTauriViewModeNow('home', null)
          delete document.documentElement.dataset.nebulaBrowsingTauri
          delete document.documentElement.dataset.nebulaOverlayTauri
        }
      }

      closeTab(shortcutId)
      setTabSwitchHistory((history) => history.filter((id) => id !== shortcutId))

      if (goingHome) {
        setActiveUrl(null)
        setViewMode('home')
      }
    },
    [closeTab, tabsRef],
  )

  const goBack = useCallback(() => {
    if (viewModeRef.current === 'overlay') {
      if (isTauri) setOverlayModeActive(false)
      setViewMode('browsing')
      return
    }

    setTabSwitchHistory((history) => {
      if (history.length > 0) {
        const next = [...history]
        const previousTabId = next.pop()!
        if (tabsRef.current.some((tab) => tab.shortcutId === previousTabId)) {
          setActiveTabId(previousTabId)
          setViewMode('browsing')
        } else {
          setViewMode('home')
        }
        return next
      }

      if (isTauri && activeTabIdRef.current) {
        void navigateBrowseTabBack(activeTabIdRef.current).then((wentBack) => {
          if (!wentBack) setViewMode('home')
        })
      } else {
        setViewMode('home')
      }

      return history
    })
  }, [setActiveTabId, tabsRef])

  const openOverlay = useCallback(() => {
    overlayDismissGuardRef.current = performance.now() + 450
    if (isTauri) setOverlayModeActive(true)
    setViewMode('overlay')
  }, [])

  const dismissOverlay = useCallback(() => {
    if (performance.now() < overlayDismissGuardRef.current) return
    if (isTauri) setOverlayModeActive(false)
    setViewMode('browsing')
  }, [])

  const goHome = useCallback(() => {
    setViewMode('home')
  }, [])

  useEffect(() => {
    if (viewMode !== 'overlay') return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismissOverlay()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [viewMode, dismissOverlay])

  const isHome = viewMode === 'home'
  const isBrowsing = viewMode === 'browsing'
  const isOverlay = viewMode === 'overlay'
  const showBrowser = (isBrowsing || isOverlay) && activeTabId !== null

  useEffect(() => {
    if (!isTauri) return

    let cancelled = false
    let unlisten: (() => void) | undefined

    void listenChromeActions((action) => {
      switch (action.type) {
        case 'open-tab':
          if (action.shortcutId && tabsRef.current.some((tab) => tab.shortcutId === action.shortcutId)) {
            setActiveTabId(action.shortcutId)
            setViewMode('browsing')
            break
          }
          openShortcutByUrl(action.url)
          break
        case 'close-tab':
          void handleCloseTab(action.shortcutId)
          break
        case 'switch-tab':
          setActiveTabId(action.shortcutId)
          setViewMode('browsing')
          break
        case 'open-overlay':
          openOverlay()
          break
        case 'open-quick-menu':
          setOverlayModeActive(true)
          setViewMode('overlay')
          break
        case 'close-quick-menu':
          setOverlayModeActive(false)
          setViewMode('browsing')
          break
        case 'toggle-quick-menu':
          setViewMode((mode) => {
            const next = mode === 'overlay' ? 'browsing' : 'overlay'
            setOverlayModeActive(next === 'overlay')
            return next
          })
          break
        case 'go-back':
          goBack()
          break
        case 'go-home':
          goHome()
          break
      }
    }).then((dispose) => {
      if (cancelled) {
        dispose()
        return
      }
      unlisten = dispose
    })

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [openShortcutByUrl, handleCloseTab, setActiveTabId, openOverlay, goBack, goHome, tabsRef])

  useEffect(() => {
    if (!isTauri) return

    if (isHome) {
      syncTauriViewMode('home', null)
      return
    }

    if (isOverlay) {
      syncTauriViewMode('overlay', null)
      return
    }

    if (!isBrowsing || !activeTabId) return

    const tab = tabsRef.current.find((entry) => entry.shortcutId === activeTabId)
    if (!tab) return

    const pending = pendingBrowseTargetRef.current
    const forceNavigate = pending?.tabId === activeTabId ? pending.forceNavigate : undefined
    const targetUrl = pending?.tabId === activeTabId ? pending.url : tab.url

    if (pending?.tabId === activeTabId) {
      pendingBrowseTargetRef.current = null
    }

    syncTauriViewMode('browsing', {
      tabId: activeTabId,
      url: targetUrl,
      forceNavigate,
    })
  }, [isHome, isBrowsing, isOverlay, activeTabId, tauriBrowseSyncToken, tabsRef])

  const browserContentVisible = isOverlay || !shortcutInteractionActive
  const hideHomeChrome = shortcutInteractionActive && !homeEditMode
  const { home, semiLunar, notifications } = settings

  const editLayout = homeEditMode && draftLayout ? draftLayout : homeLayoutFromSettings(home)
  const effectiveHome = homeEditMode
    ? {
        ...home,
        showPinnedStrip: editLayout.pinnedStrip.visible,
        pinnedStripSize: editLayout.pinnedStrip.size,
        searchSize: editLayout.search.size,
        searchOffsetX: editLayout.search.offset.x,
        searchOffsetY: editLayout.search.offset.y,
        showProfile: editLayout.profile.visible,
        profileOffsetX: editLayout.profile.offset.x,
        profileOffsetY: editLayout.profile.offset.y,
        showGreeting: editLayout.profile.visible,
        showSystemWidgets: editLayout.widgets.visible,
        showClock: editLayout.clock.visible,
        showToolbar: editLayout.toolbar.visible,
      }
    : home

  const homeAdaptiveLunar = useMemo(
    () =>
      computeAdaptiveLunarSize(
        visibleShortcuts.length,
        semiLunar.lunarWidthPx,
        semiLunar.lunarHeightPx,
      ),
    [visibleShortcuts.length, semiLunar.lunarWidthPx, semiLunar.lunarHeightPx],
  )

  const browsingLunarCount = Math.max(openTabIds.length, 1)

  const browsingAdaptiveLunar = useMemo(
    () =>
      computeAdaptiveLunarSize(
        browsingLunarCount,
        semiLunar.lunarWidthPx,
        semiLunar.lunarHeightPx,
      ),
    [browsingLunarCount, semiLunar.lunarWidthPx, semiLunar.lunarHeightPx],
  )

  const semiLunarTimingProps = {
    previewOnHover: semiLunar.previewOnHover,
    homeAlwaysOpen: semiLunar.homeAlwaysOpen,
    browsingHoverOpen: semiLunar.browsingHoverOpen,
    browsingOpenDelayMs: semiLunar.browsingOpenDelayMs,
    closeDelayMs: semiLunar.closeDelayMs,
    previewDelayMs: semiLunar.previewDelayMs,
    closeBtnDelayMs: semiLunar.closeBtnDelayMs,
    folderMergeHoldMs: semiLunar.folderMergeHoldMs,
    mergeAnimMs: semiLunar.mergeAnimMs,
    iconSizePx: semiLunar.iconSizePx,
  }

  const semiLunarShortcuts = useMemo(() => {
    const byId = new Map<string, Shortcut>(visibleShortcuts.map((shortcut) => [shortcut.id, shortcut]))
    for (const tab of tabs) {
      const existing = byId.get(tab.shortcutId)
      byId.set(
        tab.shortcutId,
        existing
          ? { ...existing, label: tab.title, url: tab.url, favicon: tab.favicon }
          : shortcutFromTab(tab),
      )
    }
    return [...byId.values()]
  }, [visibleShortcuts, tabs])

  const handleSemiLunarNavigate = useCallback(
    (shortcutUrl: string, shortcutId?: string) => {
      if (shortcutId && tabsRef.current.some((tab) => tab.shortcutId === shortcutId)) {
        switchToExistingBrowseTab(shortcutId)
        return
      }
      openShortcutByUrl(shortcutUrl)
    },
    [openShortcutByUrl, switchToExistingBrowseTab, tabsRef],
  )

  const semiLunarShared = {
    shortcuts: semiLunarShortcuts,
    dockItemIds,
    folders,
    onCreateFolder: createFolderFromShortcuts,
    onAddToFolder: addShortcutToFolder,
    onRenameFolder: renameFolder,
    onNavigate: handleSemiLunarNavigate,
    onRemoveShortcut: handleRemoveFromSemiLunar,
    onCloseTab: handleCloseTab,
    openTabIds,
    activeTabId,
    getTab,
    onToggleMute: toggleMute,
    isMuted,
    isPinned,
    onTogglePin: togglePin,
    canPinMore,
    onRemoveMemberFromFolder: removeMemberFromFolder,
    onShortcutInteractionChange: setLunarShortcutInteraction,
    activeUrl,
    getSession,
    ...semiLunarTimingProps,
  }

  const semiLunarMenuProps = {
    ...semiLunarShared,
    mode: (isHome ? 'home' : 'browsing') as 'home' | 'browsing',
    shellViewMode: viewMode as ShellViewMode,
    lunarWidthPx: isHome ? homeAdaptiveLunar.width : browsingAdaptiveLunar.width,
    lunarHeightPx: isHome ? homeAdaptiveLunar.height : browsingAdaptiveLunar.height,
    onHomeClick: isHome ? undefined : openOverlay,
    onBackClick: isHome ? undefined : goBack,
  }

  const toolbarProps = {
    onSettings: openSettings,
    notificationBadge: notifications.showToolbarBadge ? notifications.toolbarBadgeCount : 0,
  }

  return (
    <div
      className={[
        styles.shell,
        isTauri ? styles.shellTauri : '',
        isTauri && isOverlay ? styles.shellTauriOverlay : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {isHome && (
        <WallpaperBackground
          imageUrl={wallpaper}
          hidden={shortcutInteractionActive && !homeEditMode}
        />
      )}

      {isHome && homeEditMode && <div className={styles.editDimOverlay} aria-hidden="true" />}

      {isHome && (
        <>
          <HomeCenter
            onNavigate={openShortcutByUrl}
            onSearchNavigate={openFromSearchBar}
            searchEngine={effectiveHome.searchEngine}
            userDisplayName={accountDisplayName}
            avatarUrl={account?.avatarUrl}
            showGreeting={effectiveHome.showGreeting}
            showProfile={effectiveHome.showProfile}
            showPinnedStrip={effectiveHome.showPinnedStrip}
            pinnedStripSize={effectiveHome.pinnedStripSize}
            searchSize={effectiveHome.searchSize}
            searchOffset={{
              x: effectiveHome.searchOffsetX,
              y: effectiveHome.searchOffsetY,
            }}
            profileOffset={{
              x: effectiveHome.profileOffsetX,
              y: effectiveHome.profileOffsetY,
            }}
            pinnedShortcuts={pinnedShortcutList}
            onUnpinShortcut={unpinShortcut}
            onReorderPins={reorderPins}
            isShortcutMuted={isMuted}
            onToggleShortcutMute={toggleMute}
            onRemoveShortcut={handleRemoveFromSemiLunar}
            previewOnHover={semiLunar.previewOnHover}
            previewDelayMs={semiLunar.previewDelayMs}
            onShortcutInteractionChange={setPinShortcutInteraction}
            activeUrl={activeUrl}
            getSession={getSession}
            hideChrome={hideHomeChrome}
            pinPreviewActive={pinShortcutInteraction}
            editMode={homeEditMode}
            editLayout={homeEditMode ? editLayout : undefined}
            onEditLayoutChange={updateDraftLayout}
          />
          <div
            className={hideHomeChrome ? styles.homeChromeHidden : ''}
            aria-hidden={hideHomeChrome}
          >
            {(effectiveHome.showSystemWidgets || homeEditMode) && (
              <div className={[styles.widgetColumn, homeEditMode ? styles.editElevated : '']
                .filter(Boolean)
                .join(' ')}>
                <LeftSidebar
                  onAddWidget={widgetLayout.addWidget}
                  activeTypes={widgetLayout.activeTypes}
                  widgetSettings={{
                    showRamWidget: home.showRamWidget,
                    showCpuWidget: home.showCpuWidget,
                  }}
                  clockSettings={{
                    showClock: effectiveHome.showClock,
                    clockFontSize: home.clockFontSize,
                    clockFontWeight: home.clockFontWeight,
                    clockShowDate: home.clockShowDate,
                    clockFontFamily: home.clockFontFamily,
                  }}
                  editMode={homeEditMode}
                  editWidgetsVisible={editLayout.widgets.visible}
                  editClockVisible={editLayout.clock.visible}
                  onEditToggleWidgets={() =>
                    updateDraftLayout({
                      widgets: { ...editLayout.widgets, visible: !editLayout.widgets.visible },
                    })
                  }
                  onEditToggleClock={() =>
                    updateDraftLayout({
                      clock: { ...editLayout.clock, visible: !editLayout.clock.visible },
                    })
                  }
                >
                  {effectiveHome.showSystemWidgets && (
                    <HomeWidgetGrid
                      panes={widgetLayout.visiblePanes}
                      layout={widgetLayout.visibleLayout}
                      stats={stats}
                      onLayoutChange={widgetLayout.onLayoutChange}
                      onFocusPane={widgetLayout.focusWidget}
                      onClosePane={widgetLayout.removeWidget}
                    />
                  )}
                </LeftSidebar>
              </div>
            )}
            {(effectiveHome.showToolbar || homeEditMode) && (
              <div className={homeEditMode ? styles.editElevated : ''}>
                <RightToolbar
                  {...toolbarProps}
                  editMode={homeEditMode}
                  editToolbarVisible={editLayout.toolbar.visible}
                  onEditToggleToolbar={() =>
                    updateDraftLayout({
                      toolbar: { ...editLayout.toolbar, visible: !editLayout.toolbar.visible },
                    })
                  }
                />
              </div>
            )}
          </div>
          {homeEditMode && <HomeEditBar onSave={saveHomeEditMode} onCancel={cancelHomeEditMode} />}
        </>
      )}

      {showBrowser && !isTauri && (
        <div
          className={[
            styles.browserFullscreen,
            isOverlay ? styles.browserBehindOverlay : '',
            shortcutInteractionActive ? styles.browserHiddenDuringPreview : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <TabbedBrowserContent
            tabs={tabs}
            activeTabId={activeTabId}
            visible={browserContentVisible}
          />
        </div>
      )}

      {createPortal(
        <div
          className={isHome && pinShortcutInteraction ? styles.semiLunarHidden : ''}
          aria-hidden={isHome && pinShortcutInteraction ? true : undefined}
        >
          <SemiLunarMenu {...semiLunarMenuProps} />
        </div>,
        document.body,
      )}

      {isOverlay && (
        <>
          <button
            type="button"
            className={[
              styles.overlayBackdrop,
              isTauri ? styles.overlayBackdropTauri : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={dismissOverlay}
            aria-label="Return to browsing"
          />
          <div className={styles.overlayHome}>
            <button
              type="button"
              className={styles.overlayDismiss}
              onClick={dismissOverlay}
              aria-label="Close overlay"
            >
              ✕
            </button>
            <div className={styles.overlayChrome}>
              <RightToolbar variant="overlay" {...toolbarProps} />
              <button
                type="button"
                className={styles.overlayMainMenu}
                onClick={goHome}
                title="Ana sayfa"
                aria-label="Ana sayfa — ana ekrana dön"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 3L4 9v12h5v-7h6v7h5V9l-8-6z" />
                </svg>
              </button>
            </div>
            <HomeCenter
              variant="overlay"
              onNavigate={openShortcutByUrl}
              onSearchNavigate={openFromSearchBar}
              searchEngine={home.searchEngine}
              userDisplayName={home.userDisplayName}
              showGreeting={false}
              showProfile={false}
              showPinnedStrip={pinnedShortcutList.length > 0}
              pinnedShortcuts={pinnedShortcutList}
              onUnpinShortcut={unpinShortcut}
              onReorderPins={reorderPins}
              isShortcutMuted={isMuted}
              onToggleShortcutMute={toggleMute}
              onRemoveShortcut={handleRemoveFromSemiLunar}
              previewOnHover={semiLunar.previewOnHover}
              previewDelayMs={semiLunar.previewDelayMs}
              activeUrl={activeUrl}
              getSession={getSession}
            />
          </div>
        </>
      )}

      <OnboardingWizard
        open={onboardingOpen}
        initialStep={onboardingInitialStep}
        onApplyImportedShortcuts={handleApplyImportedShortcuts}
        onComplete={handleOnboardingComplete}
      />

      <SettingsPanel
        open={settingsOpen}
        anchor={settingsAnchor}
        onClose={closeSettings}
        onPickWallpaper={pickWallpaper}
        onResetWallpaper={resetWallpaper}
        onResetShortcuts={handleResetShortcuts}
        settings={settings}
        onUpdate={updateCategory}
        onResetCategory={resetCategory}
        onTogglePreviewOnHover={togglePreviewOnHover}
        onEnterHomeEdit={enterHomeEditMode}
        onFactoryReset={handleFactoryReset}
      />
    </div>
  )
}
