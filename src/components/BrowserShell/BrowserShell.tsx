import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  listenExternalUrlPending,
  takePendingExternalUrls,
} from '../../platform/externalOpen'
import { createPortal } from 'react-dom'
import { DeveloperTools } from '../DeveloperTools/DeveloperTools'
import { AppDialogHost } from '../AppDialog/AppDialogHost'
import {
  getAppDialogsSnapshot,
  showAppConfirmation,
} from '../../core/appDialog'
import { SiteUiPrompt } from '../SiteUiPrompt/SiteUiPrompt'
import { PasswordSavePrompt } from '../PasswordSavePrompt/PasswordSavePrompt'
import { PasswordFillPrompt } from '../PasswordFillPrompt/PasswordFillPrompt'
import { PrintDialog } from '../PrintDialog/PrintDialog'
import { SiteContextMenu } from '../SiteContextMenu/SiteContextMenu'
import { isTauri } from '../../platform/runtime'
import {
  listenChromeActions,
  emitActiveUrl,
  emitDownloadUiState,
  emitTabCatalog,
  emitTabSearchRequest,
  emitSiteInfoState,
  emitViewMode,
  emitZoomIndicator,
} from '../../core/nebulaBridge'
import type {
  DownloadUiStatePayload,
  ShellViewMode,
  SiteInfoStatePayload,
  SitePermissionState,
} from '../../core/nebulaBridge'
import type { BrowserShortcutId } from '../../core/browserShortcuts'
import {
  NATIVE_TAB_FAILED_EVENT,
  NATIVE_TAB_READY_EVENT,
  syncTauriViewMode,
  applyTauriViewModeNow,
} from '../../platform/tauriBrowsingMode'
import {
  initSiteFullscreenBridge,
  exitSiteFullscreenForTabSwitch,
  forceExitSiteFullscreen,
  isSiteFullscreenActive,
  toggleBrowserWindowFullscreen,
} from '../../platform/tauriSiteFullscreen'
import { writeTransitionLog } from '../../platform/tauriTransitionLog'
import {
  setOverlayModeActive,
  stackBrowsingChromeAboveBrowser,
} from '../../platform/tauriWebviewStack'
import { setChromeWebviewSuppressed } from '../../platform/tauriChromeWebview'
import {
  closeSitePopupForContent,
  isPopupContentLabel,
  openSitePopup,
} from '../../platform/tauriPopup'
import {
  listenSiteCloseWindows,
  listenSiteNewWindows,
  listenSitePointerDown,
  listenSitePrintRequests,
  listenSiteZoomRequests,
  listenSiteUiCancelled,
  listenSiteUiRequests,
  respondToSiteUi,
  type SiteUiRequest,
  type SiteUiResponse,
} from '../../platform/tauriSiteUi'
import {
  listenSiteContextMenuCancelled,
  listenSiteContextMenus,
  respondToSiteContextMenu,
  NEBULA_PRINT_COMMAND_ID,
  type SiteContextMenuRequest,
} from '../../platform/tauriContextMenu'
import { DEFAULT_SHORTCUTS } from '../../core/constants'
import {
  matchingProtocolHandlerDecision,
  resolveProtocolHandler,
  saveProtocolHandlerDecision,
} from '../../core/protocolHandlers'
import { loadBrowseSessions } from '../../core/browseSession'
import { resolveShortcutForOpen } from '../../core/navigateShortcut'
import { SHORTCUT_POSITIONS_KEY } from '../../core/shortcutLayout'
import { removeLocalStorage } from '../../core/storageSync'
import { registerListenerGroup } from '../../core/listenerGroup'
import {
  clearGoogleBrowserSession,
  GoogleBrowserSessionTracker,
  markGoogleBrowserSessionLinked,
} from '../../core/googleBrowserSession'
import {
  closeBrowseTab,
  navigateBrowseTabBack,
  navigateBrowseTabForward,
  prepareBrowseTabInBackground,
  reloadBrowseTab,
  listenTabWebviewSnapshots,
  listenTabWebviewLoadingStates,
  printBrowseWebview,
  setBrowseTabMuted,
  setBrowseTabZoom,
  zoomBrowseTab,
  setBrowsePrivacyOptions,
  clearSitePermissions,
  listenSiteCompatibilityRequests,
  navigateBrowseTab,
  clearBrowseData,
  getUblockExtensionInfo,
  getUblockRuntimeStatus,
  type BrowsingDataKind,
} from '../../platform/tauriBrowser'
import {
  addSiteException,
  hostHasSiteException,
  removeSiteException,
  siteCompatibilityTarget,
} from '../../core/siteCompatibility'
import { callTabDevTools } from '../../platform/tauriDevTools'
import { useBrowserTabs } from '../../hooks/useBrowserTabs'
import { useBrowserShortcuts } from '../../hooks/useBrowserShortcuts'
import { useBrowserShortcutBindings } from '../../hooks/useBrowserShortcutBindings'
import {
  shortcutFromTab,
  shortcutIdForTabWebviewLabel,
  tabWebviewLabel,
  titleFromUrl,
  type BrowserTab,
} from '../../core/browserTab'
import {
  rememberSiteZoom,
  siteZoomFactor,
  siteZoomOrigin,
} from '../../core/siteZoom'
import { computeAdaptiveLunarSize } from '../../core/lunarSizing'
import {
  homeLayoutFromSettings,
  type HomeLayout,
} from '../../core/homeLayout'
import { HomeCenter } from '../HomeCenter/HomeCenter'
import { LeftSidebar } from '../LeftSidebar/LeftSidebar'
import { RightToolbar } from '../RightToolbar/RightToolbar'
import { SemiLunarMenu } from '../SemiLunarMenu/SemiLunarMenu'
import { HomeEditBar } from '../HomeEdit/HomeEditBar'
import { WallpaperBackground } from '../WallpaperBackground/WallpaperBackground'
import { usePinnedShortcuts } from '../../hooks/usePinnedShortcuts'
import { useShortcutPreferences } from '../../hooks/useShortcutPreferences'
import {
  SHORTCUT_FOLDERS_KEY,
  useShortcutFolders,
} from '../../hooks/useShortcutFolders'
import { useNebulaSettings } from '../../hooks/useNebulaSettings'
import { useBrowseSessions } from '../../hooks/useBrowseSessions'
import { useBrowsingHistory } from '../../hooks/useBrowsingHistory'
import {
  CURRENT_SESSION_KEY,
  type BrowserSessionSnapshot,
  type ClosedTabEntry,
} from '../../core/browsingHistory'
import { useWidgetLayout } from '../../hooks/useWidgetLayout'
import { useWallpaper } from '../../hooks/useWallpaper'
import type { ToolbarAnchor } from '../RightToolbar/RightToolbar'
import type { Shortcut } from '../../core/types'
import { TabbedBrowserContent } from './TabbedBrowserContent'
import type { OnboardingResult } from '../Onboarding/OnboardingWizard'
import {
  completeOnboarding,
  isOAuthReturnUrl,
  isOnboardingComplete,
  onboardingStepAfterOAuthReturn,
  peekOnboardingResumeStep,
  takeOnboardingImportedShortcuts,
  takeOnboardingResumeStep,
  type OnboardingStep,
} from '../../core/onboarding'
import { factoryResetNebulaApp } from '../../core/appReset'
import {
  nebulaAccountFromGoogleClaims,
  resumeGoogleSignInFromRedirect,
} from '../../core/googleSignIn'
import { useNebulaAccount } from '../../hooks/useNebulaAccount'
import { useLocale } from '../../hooks/useLocale'
import { usePasswordVault } from '../../hooks/usePasswordVault'
import { usePasswordBridge } from '../../hooks/usePasswordBridge'
import { useDownloads } from '../../hooks/useDownloads'
import { useNotifications } from '../../hooks/useNotifications'
import { listenNativeNotificationActivations } from '../../core/notification'
import { DownloadManager } from '../DownloadManager/DownloadManager'
import { NotificationPanel } from '../NotificationPanel/NotificationPanel'
import { HistoryPanel } from '../HistoryPanel/HistoryPanel'
import { CrashRecoveryPrompt } from '../CrashRecoveryPrompt/CrashRecoveryPrompt'
import styles from './BrowserShell.module.css'

type ViewMode = 'home' | 'browsing' | 'overlay'

interface PrintTarget {
  webviewLabel: string
  title: string
  url: string
}

const HomeWidgetGrid = lazy(() =>
  import('../SpatialGrid/HomeWidgetGrid').then((module) => ({
    default: module.HomeWidgetGrid,
  })),
)

const SettingsPanel = lazy(() =>
  import('../SettingsPanel/SettingsPanel').then((module) => ({
    default: module.SettingsPanel,
  })),
)

const OnboardingWizard = lazy(() =>
  import('../Onboarding/OnboardingWizard').then((module) => ({
    default: module.OnboardingWizard,
  })),
)

const SITE_PERMISSION_QUERY = `(async () => {
  const result = {};
  for (const name of ['camera', 'microphone', 'geolocation']) {
    try { result[name] = (await navigator.permissions.query({ name })).state; }
    catch { result[name] = 'unsupported'; }
  }
  return result;
})()`

async function readSitePermissionStates(
  shortcutId: string,
): Promise<SiteInfoStatePayload['permissions']> {
  const response = await callTabDevTools<{
    result?: { value?: Record<string, unknown> }
  }>(shortcutId, 'Runtime.evaluate', {
    expression: SITE_PERMISSION_QUERY,
    awaitPromise: true,
    returnByValue: true,
  })
  const value = response.result?.value ?? {}
  const state = (name: string): SitePermissionState => {
    const candidate = value[name]
    return candidate === 'granted' ||
      candidate === 'denied' ||
      candidate === 'prompt' ||
      candidate === 'unsupported'
      ? candidate
      : 'unsupported'
  }
  return {
    camera: state('camera'),
    microphone: state('microphone'),
    location: state('geolocation'),
  }
}

export function BrowserShell() {
  const { t } = useLocale()

  const {
    settings,
    togglePreviewOnHover,
    updateCategory,
    resetCategory,
    applyHomeLayout,
  } = useNebulaSettings()

  const {
    bindings: browserShortcutBindings,
    setBinding: setBrowserShortcutBinding,
    resetBinding: resetBrowserShortcutBinding,
    resetAll: resetAllBrowserShortcutBindings,
  } = useBrowserShortcutBindings()

  const [viewMode, setViewMode] =
    useState<ViewMode>('home')

  const isHome =
    viewMode ===
    'home'

  const isBrowsing =
    viewMode ===
    'browsing'

  const isOverlay =
    viewMode ===
    'overlay'

  const [, setNativeTabReady] =
    useState(false)

  const viewModeRef =
    useRef<ViewMode>('home')

  const overlayDismissGuardRef =
    useRef(0)

  const {
    wallpaper,
    updateWallpaper,
    pickWallpaper,
    pickVideoWallpaper,
    resetWallpaper,
  } = useWallpaper()

  const {
    visibleShortcuts,
    allShortcuts,
    toggleMute,
    removeShortcut,
    addVisitedShortcut,
    isMuted,
    resetShortcuts,
    applyImportedShortcuts,
  } = useShortcutPreferences(
    DEFAULT_SHORTCUTS,
  )

  const {
    pinnedShortcuts:
      pinnedShortcutList,
    isPinned,
    canPinMore,
    togglePin,
    unpinShortcut,
    reorderPins,
    resetPins,
    reloadPinnedIds,
  } = usePinnedShortcuts(
    allShortcuts,
    visibleShortcuts,
  )

  const {
    dockItemIds,
    folders,
    createFolderFromShortcuts,
    addShortcutToFolder,
    removeShortcutFromFolders,
    removeMemberFromFolder,
    renameFolder,
    resetFolders,
  } = useShortcutFolders(
    visibleShortcuts,
    settings.browsing.restoreTabsOnStartup,
  )

  const {
    account,
    displayName:
      accountDisplayName,
    setAccount,
  } = useNebulaAccount(
    settings.home.userDisplayName,
  )

  const {
    entries: passwordEntries,
    reload:
      reloadPasswordVault,
  } = usePasswordVault()

  const widgetLayout =
    useWidgetLayout({
      showRamWidget:
        settings.home.showRamWidget,
      showCpuWidget:
        settings.home.showCpuWidget,
    })

  const {
    recordVisit:
      recordBrowseSessionVisit,
    getSession,
  } = useBrowseSessions()

  const {
    entries:
      historyEntries,
    hosts:
      historyHosts,
    closedTabs:
      persistedClosedTabs,
    previousSession,
    previousRunUnclean,
    recordVisit:
      recordHistoryVisit,
    removeEntry:
      removeHistoryEntry,
    clearAll:
      clearAllHistory,
    clearFiltered:
      clearFilteredHistory,
    recordClosedTab,
    removeClosedTab,
    clearClosedTabs,
    saveCurrentSession,
    clearCurrentSession,
  } = useBrowsingHistory()

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
    updateTabMeta,
    getTab,
    setActiveTabId,
  } = useBrowserTabs()

  /*
   * Synchronous cursor for rapid Ctrl+Tab switching.
   *
   * React state can batch multiple keyboard events before
   * activeTabId commits. This cursor always reflects the
   * latest intended destination immediately.
   */
  const tabSwitchCursorRef =
    useRef<string | null>(
      activeTabId,
    )

  const startupSessionRestoreRef =
    useRef(false)

  useEffect(() => {
    tabSwitchCursorRef.current =
      activeTabId
  }, [activeTabId])

  useEffect(() => {
    const clearNonPersistentStateOnExit = () => {
      if (
        settings.browsing.restoreTabsOnStartup
      ) {
        saveCurrentSession(
          tabsRef.current,
          activeTabIdRef.current,
        )
      } else {
        localStorage.removeItem(CURRENT_SESSION_KEY)
      }

      if (!settings.browsing.restoreTabsOnStartup) {
        localStorage.removeItem(SHORTCUT_POSITIONS_KEY)
      }

      if (!settings.browsing.restoreTabsOnStartup) {
        localStorage.removeItem(SHORTCUT_FOLDERS_KEY)
      }
    }

    window.addEventListener('beforeunload', clearNonPersistentStateOnExit)
    window.addEventListener('pagehide', clearNonPersistentStateOnExit)

    return () => {
      window.removeEventListener('beforeunload', clearNonPersistentStateOnExit)
      window.removeEventListener('pagehide', clearNonPersistentStateOnExit)
    }
  }, [
    activeTabIdRef,
    saveCurrentSession,
    settings.browsing.restoreTabsOnStartup,
    tabsRef,
  ])

  const downloads =
    useDownloads()
  const actDownload = downloads.act
  const removeDownload = downloads.remove
  const clearFinishedDownloads = downloads.clearFinished

  const notificationCenter =
    useNotifications(
      downloads.items,
      settings.notifications
        .siteNotifications,
      settings.notifications.showNotificationContent,
      settings.notifications.downloadNotifications,
    )
  const setSiteNotificationPermission =
    notificationCenter.setSitePermission
  const clearSiteNotificationPermissions =
    notificationCenter.clearSitePermissions

  const [
    downloadPanelOpen,
    setDownloadPanelOpen,
  ] = useState(false)

  const [
    notificationPanelOpen,
    setNotificationPanelOpen,
  ] = useState(false)

  const [
    historyPanelOpen,
    setHistoryPanelOpen,
  ] = useState(false)

  const [
    printTarget,
    setPrintTarget,
  ] = useState<PrintTarget | null>(
    null,
  )

  const [, setTabZoomPercent] =
    useState<Record<string, number>>({})
  const appliedSiteZoomRef =
    useRef(new Map<string, string>())

  const openPrintDialogForTab =
    useCallback(
      (tabId: string) => {
        const tab =
          tabsRef.current.find(
            (entry) =>
              entry.shortcutId ===
              tabId,
          )

        setPrintTarget({
          webviewLabel:
            tabWebviewLabel(
              tabId,
            ),
          title:
            tab?.title ??
            t('untitledPage'),
          url:
            tab?.url ?? '',
        })
      },
      [t, tabsRef],
    )

  const changeActiveTabZoom =
    useCallback(
      async (
        action:
          | 'in'
          | 'out'
          | 'reset',
      ) => {
        const tabId =
          activeTabIdRef.current

        if (!tabId || !isTauri) return

        const tabBeforeZoom =
          tabsRef.current.find(
            (tab) => tab.shortcutId === tabId,
          )
        const originBeforeZoom =
          siteZoomOrigin(tabBeforeZoom?.url ?? '')

        const factor =
          await zoomBrowseTab(
            tabId,
            action,
          )

        const percent =
          Math.round(
            factor * 100,
          )

        setTabZoomPercent(
          (current) => ({
            ...current,
            [tabId]: percent,
          }),
        )

        void emitZoomIndicator(
          percent,
        )

        const tabAfterZoom =
          tabsRef.current.find(
            (tab) => tab.shortcutId === tabId,
          )
        if (
          !settings.privacy.privateMode &&
          originBeforeZoom &&
          siteZoomOrigin(tabAfterZoom?.url ?? '') === originBeforeZoom
        ) {
          rememberSiteZoom(tabAfterZoom?.url ?? '', factor)
          appliedSiteZoomRef.current.set(
            tabId,
            `${originBeforeZoom}|${factor.toFixed(3)}`,
          )
        }
      },
      [activeTabIdRef, settings.privacy.privateMode, tabsRef],
    )

  useEffect(() => {
    if (!isTauri) return

    const openIds = new Set(tabs.map((tab) => tab.shortcutId))
    for (const shortcutId of appliedSiteZoomRef.current.keys()) {
      if (!openIds.has(shortcutId)) {
        appliedSiteZoomRef.current.delete(shortcutId)
      }
    }

    for (const tab of tabs) {
      const origin = siteZoomOrigin(tab.url)
      if (!origin) continue
      const factor = settings.privacy.privateMode
        ? 1
        : siteZoomFactor(tab.url)
      const signature = `${origin}|${factor.toFixed(3)}`
      if (appliedSiteZoomRef.current.get(tab.shortcutId) === signature) continue

      appliedSiteZoomRef.current.set(tab.shortcutId, `pending:${signature}`)
      void setBrowseTabZoom(tab.shortcutId, factor)
        .then((appliedFactor) => {
          appliedSiteZoomRef.current.set(
            tab.shortcutId,
            `${origin}|${appliedFactor.toFixed(3)}`,
          )
          setTabZoomPercent((current) => ({
            ...current,
            [tab.shortcutId]: Math.round(appliedFactor * 100),
          }))
        })
        .catch(() => {
          if (appliedSiteZoomRef.current.get(tab.shortcutId) === `pending:${signature}`) {
            appliedSiteZoomRef.current.delete(tab.shortcutId)
          }
        })
    }
  }, [settings.privacy.privateMode, tabs])

  const downloadUiStateRef =
    useRef<DownloadUiStatePayload>({
      items: downloads.items,
      activeCount: downloads.activeCount,
      aggregateProgress: downloads.aggregateProgress,
      panelOpen: downloadPanelOpen,
    })

  const [
    crashRecoveryOpen,
    setCrashRecoveryOpen,
  ] = useState(
    () =>
      previousRunUnclean &&
      previousSession !== null,
  )

  const [
    ublockVersion,
    setUblockVersion,
  ] = useState<string | null>(
    null,
  )

  const [
    ublockEnabled,
    setUblockEnabled,
  ] = useState(false)

  const observedDownloadIdsRef =
    useRef<Set<string>>(
      new Set(),
    )

  useEffect(() => {
    if (!isTauri) return

    void getUblockExtensionInfo()
      .then((info) => {
        setUblockVersion(
          info.version,
        )
      })
      .catch(() => {
        setUblockVersion(
          null,
        )
      })
  }, [])

  useEffect(() => {
    setUblockEnabled(
      false,
    )

    if (
      !isTauri ||
      !activeTabId
    ) {
      return
    }

    let cancelled =
      false

    const timer =
      setTimeout(() => {
        void getUblockRuntimeStatus(
          activeTabId,
        )
          .then(
            (status) => {
              if (
                !cancelled
              ) {
                setUblockEnabled(
                  status.installed &&
                    status.enabled,
                )
              }
            },
          )
          .catch(() => {
            if (
              !cancelled
            ) {
              setUblockEnabled(
                false,
              )
            }
          })
      }, 1200)

    return () => {
      cancelled =
        true

      clearTimeout(
        timer,
      )
    }
  }, [activeTabId])

  useEffect(() => {
    let hasNewDownload =
      false

    for (
      const download of
      downloads.items
    ) {
      if (
        observedDownloadIdsRef.current.has(
          download.id,
        )
      ) {
        continue
      }

      observedDownloadIdsRef.current.add(
        download.id,
      )

      hasNewDownload =
        true
    }

    if (
      hasNewDownload
    ) {
      setNotificationPanelOpen(
        false,
      )

      setHistoryPanelOpen(
        false,
      )

      setDownloadPanelOpen(
        true,
      )
    }
  }, [downloads.items])

  useEffect(() => {
    const nextState: DownloadUiStatePayload = {
      items: downloads.items,
      activeCount: downloads.activeCount,
      aggregateProgress: downloads.aggregateProgress,
      panelOpen: downloadPanelOpen,
    }

    downloadUiStateRef.current =
      nextState

    if (!isTauri) return

    void emitDownloadUiState(
      nextState,
    )
  }, [
    downloadPanelOpen,
    downloads.activeCount,
    downloads.aggregateProgress,
    downloads.items,
  ])

  const toggleDownloadPanel =
    useCallback(() => {
      setNotificationPanelOpen(
        false,
      )

      setHistoryPanelOpen(
        false,
      )

      setDownloadPanelOpen(
        (open) =>
          !open,
      )
    }, [])

  const closeDownloadPanel =
    useCallback(() => {
      setDownloadPanelOpen(
        false,
      )
    }, [])

  useEffect(() => {
    if (!isTauri) return

    let disposed =
      false

    let unlisten:
      | (() => void)
      | undefined

    void listenSitePointerDown(
      () => {
        closeDownloadPanel()
      },
    ).then(
      (dispose) => {
        if (disposed) {
          dispose()
          return
        }

        unlisten =
          dispose
      },
    )

    return () => {
      disposed =
        true

      unlisten?.()
    }
  }, [
    closeDownloadPanel,
  ])

  const toggleNotificationPanel =
    useCallback(() => {
      setDownloadPanelOpen(
        false,
      )

      setHistoryPanelOpen(
        false,
      )

      setNotificationPanelOpen(
        (open) =>
          !open,
      )
    }, [])

  const closeNotificationPanel =
    useCallback(() => {
      setNotificationPanelOpen(
        false,
      )
    }, [])

  const toggleHistoryPanel =
    useCallback(() => {
      setDownloadPanelOpen(
        false,
      )

      setNotificationPanelOpen(
        false,
      )

      if (
        viewModeRef.current ===
        'browsing'
      ) {
        overlayDismissGuardRef.current =
          performance.now() +
          450

        if (
          isTauri
        ) {
          setOverlayModeActive(
            true,
          )
        }

        setViewMode(
          'overlay',
        )

        setHistoryPanelOpen(
          true,
        )

        return
      }

      setHistoryPanelOpen(
        (open) =>
          !open,
      )
    }, [])

  const closeHistoryPanel =
    useCallback(() => {
      setHistoryPanelOpen(
        false,
      )
    }, [])

  const handleRemoveFromSemiLunar =
    useCallback(
      (
        id: string,
      ) => {
        removeShortcut(
          id,
        )

        removeShortcutFromFolders(
          id,
        )
      },
      [
        removeShortcut,
        removeShortcutFromFolders,
      ],
    )

  const handleResetShortcuts =
    useCallback(() => {
      resetShortcuts()
      resetFolders()
      resetPins()

      localStorage.removeItem(
        SHORTCUT_POSITIONS_KEY,
      )
    }, [
      resetShortcuts,
      resetFolders,
      resetPins,
    ])

  const handleResetSemiLunarLayout =
    useCallback(() => {
      removeLocalStorage(
        SHORTCUT_POSITIONS_KEY,
      )
    }, [])

  const handleApplyImportedShortcuts =
    useCallback(
      (
        shortcuts:
          Shortcut[],
      ) => {
        if (
          shortcuts.length ===
          0
        ) {
          return
        }

        applyImportedShortcuts(
          shortcuts,
        )

        reloadPinnedIds()
      },
      [
        applyImportedShortcuts,
        reloadPinnedIds,
      ],
    )

  const handleOnboardingComplete =
    useCallback(
      (
        result:
          OnboardingResult,
      ) => {
        if (
          result
            .importedShortcuts
            .length > 0
        ) {
          handleApplyImportedShortcuts(
            result.importedShortcuts,
          )
        }

        if (
          result.account
        ) {
          setAccount(
            result.account,
          )

          updateCategory(
            'home',
            'userDisplayName',
            result.account
              .displayName,
          )
        }

        completeOnboarding()

        setOnboardingOpen(
          false,
        )

        setOnboardingInitialStep(
          undefined,
        )
      },
      [
        handleApplyImportedShortcuts,
        setAccount,
        updateCategory,
      ],
    )

  const handleFactoryReset =
    useCallback(() => {
      void factoryResetNebulaApp().catch((error: unknown) => {
        console.error('[nebula reset] Factory reset failed before reload.', error)
      })
    }, [])

  const handleAccountSignOut =
    useCallback(() => {
      clearGoogleBrowserSession()

      const name =
        settings.home
          .userDisplayName
          .trim() ||
        t(
          'userFallback',
        )

      setAccount({
        provider:
          'local',
        displayName:
          name,
      })
    }, [
      setAccount,
      settings.home
        .userDisplayName,
      t,
    ])

  const [
    activeUrl,
    setActiveUrl,
  ] = useState<
    string | null
  >(null)

  const passwordBridge =
    usePasswordBridge({
      enabled:
        isBrowsing &&
        isTauri,
      preserveStateWhenDisabled:
        viewMode ===
        'overlay',
      activeTabId,
      activeUrl,
      entries:
        passwordEntries,
      onVaultChange:
        reloadPasswordVault,
    })

  const passwordPromptOffer =
    passwordBridge.offer

  const passwordSaveOffer =
    passwordPromptOffer?.mode ===
    'save'
      ? passwordPromptOffer
      : null

  const passwordFillOffer =
    passwordPromptOffer?.mode ===
    'fill'
      ? passwordPromptOffer
      : null

  const [
    ,
    setTabSwitchHistory,
  ] = useState<string[]>(
    [],
  )

  const pendingBrowseTargetRef =
    useRef<{
      tabId: string
      url: string
      forceNavigate?: boolean
    } | null>(
      null,
    )

  const [
    tauriBrowseSyncToken,
    setTauriBrowseSyncToken,
  ] = useState(0)

  const [
    shortcutInteractionActive,
    setShortcutInteractionActive,
  ] = useState(false)

  const [
    lunarShortcutInteraction,
    setLunarShortcutInteraction,
  ] = useState(false)

  const [
    pinShortcutInteraction,
    setPinShortcutInteraction,
  ] = useState(false)

  const [
    settingsOpen,
    setSettingsOpen,
  ] = useState(false)

  const [
    developerToolsOpen,
    setDeveloperToolsOpen,
  ] = useState(false)

  const developerToolsPreviousModeRef =
    useRef<ViewMode>(
      'home',
    )

  const [
    siteUiQueue,
    setSiteUiQueue,
  ] = useState<SiteUiRequest[]>([])

  const [
    siteContextMenu,
    setSiteContextMenu,
  ] = useState<SiteContextMenuRequest | null>(null)

  const [
    compatibilityPromptActive,
    setCompatibilityPromptActive,
  ] = useState(false)

  const compatibilityPromptActiveRef =
    useRef(false)

  const compatibilityPromptedHostsRef =
    useRef(new Map<string, number>())

  const siteSurfaceActive =
    siteUiQueue.length > 0 ||
    siteContextMenu !== null ||
    passwordPromptOffer !== null ||
    compatibilityPromptActive

  const siteUiPreviousModeRef =
    useRef<ViewMode>('home')

  const siteUiWasOpenRef =
    useRef(false)

  const [
    settingsActivated,
    setSettingsActivated,
  ] = useState(false)

  const [
    settingsAnchor,
    setSettingsAnchor,
  ] =
    useState<ToolbarAnchor | null>(
      null,
    )

  useEffect(() => {
    if (!isTauri) return

    void setChromeWebviewSuppressed(
      settingsOpen ||
        developerToolsOpen ||
        crashRecoveryOpen ||
        siteUiQueue.length > 0 ||
        siteContextMenu !== null ||
        passwordPromptOffer !== null ||
        compatibilityPromptActive ||
        (
          viewMode !== 'browsing' &&
          (
            downloadPanelOpen ||
            notificationPanelOpen ||
            historyPanelOpen
          )
        ),
    )
  }, [
    crashRecoveryOpen,
    compatibilityPromptActive,
    developerToolsOpen,
    downloadPanelOpen,
    historyPanelOpen,
    notificationPanelOpen,
    passwordPromptOffer,
    settingsOpen,
    siteContextMenu,
    siteUiQueue.length,
    viewMode,
  ])

  const [
    homeEditMode,
    setHomeEditMode,
  ] = useState(false)

  const [
    draftLayout,
    setDraftLayout,
  ] =
    useState<HomeLayout | null>(
      null,
    )

  const [
    onboardingOpen,
    setOnboardingOpen,
  ] = useState(() => {
    if (
      !isOnboardingComplete() &&
      isOAuthReturnUrl()
    ) {
      return false
    }

    return (
      !isOnboardingComplete()
    )
  })

  const [
    onboardingInitialStep,
    setOnboardingInitialStep,
  ] =
    useState<
      OnboardingStep | undefined
    >(
      () =>
        onboardingStepAfterOAuthReturn(),
    )

  const googleResumeStartedRef =
    useRef(false)

  const googleBrowserSessionTrackerRef =
    useRef(
      new GoogleBrowserSessionTracker(),
    )

  const closingTabIdsRef =
    useRef<Set<string>>(
      new Set(),
    )

  const closedTabsRef =
    useRef<
      BrowserTab[]
    >([])

  const historyUrlByTabRef =
    useRef<
      Map<
        string,
        string
      >
    >(
      new Map(),
    )

  const [
    focusSearchRequest,
    setFocusSearchRequest,
  ] = useState(0)

  useEffect(() => {
    if (
      googleResumeStartedRef
        .current
    ) {
      return
    }

    if (
      !isOAuthReturnUrl()
    ) {
      return
    }

    googleResumeStartedRef.current =
      true

    void (async () => {
      const {
        claims,
      } =
        await resumeGoogleSignInFromRedirect()

      if (!claims) {
        window.history.replaceState(
          {},
          '',
          window.location
            .pathname +
            window.location
              .hash,
        )

        if (
          !isOnboardingComplete()
        ) {
          const resume =
            peekOnboardingResumeStep() ??
            'profile'

          setOnboardingOpen(
            true,
          )

          setOnboardingInitialStep(
            resume ===
              'profile'
              ? 'profile'
              : resume,
          )
        }

        return
      }

      const googleAccount =
        nebulaAccountFromGoogleClaims(
          claims,
          t('userFallback'),
        )

      setAccount(
        googleAccount,
      )

      updateCategory(
        'home',
        'userDisplayName',
        googleAccount
          .displayName,
      )

      const pendingImports =
        takeOnboardingImportedShortcuts()

      if (
        pendingImports.length >
        0
      ) {
        handleApplyImportedShortcuts(
          pendingImports,
        )
      }

      takeOnboardingResumeStep()

      if (
        !isOnboardingComplete()
      ) {
        setOnboardingOpen(
          true,
        )

        setOnboardingInitialStep(
          'profile',
        )

        window.history.replaceState(
          {},
          '',
          window.location
            .pathname +
            window.location
              .hash,
        )

        return
      }

      completeOnboarding()

      setOnboardingOpen(
        false,
      )

      setOnboardingInitialStep(
        undefined,
      )
    })()
  }, [
    setAccount,
    updateCategory,
    handleApplyImportedShortcuts,
    t,
  ])

  useEffect(() => {
    setShortcutInteractionActive(
      lunarShortcutInteraction ||
        pinShortcutInteraction,
    )
  }, [
    lunarShortcutInteraction,
    pinShortcutInteraction,
  ])

  useEffect(() => {
    viewModeRef.current =
      viewMode
  }, [viewMode])

  useEffect(() => {
    if (!isTauri) return

    const recoverHome =
      (
        event:
          Event,
      ) => {
        const detail =
          event instanceof
          CustomEvent
            ? event.detail
            : undefined

        const eventTabId =
          typeof detail ===
            'object' &&
          detail !== null &&
          'tabId' in
            detail &&
          typeof detail.tabId ===
            'string'
            ? detail.tabId
            : undefined

        if (
          eventTabId &&
          eventTabId !==
            activeTabIdRef.current
        ) {
          void writeTransitionLog(
            'shell.native-tab-failed.stale',
            'info',
            {
              ...(typeof detail ===
                'object' &&
              detail !==
                null
                ? detail
                : {}),
              activeTabId:
                activeTabIdRef.current,
              viewMode:
                viewModeRef.current,
            },
          )

          return
        }

        void writeTransitionLog(
          'shell.native-tab-failed',
          'info',
          {
            ...(typeof detail ===
              'object' &&
            detail !==
              null
              ? detail
              : {}),
            activeTabId:
              activeTabIdRef.current,
            viewMode:
              viewModeRef.current,
          },
        )

        setNativeTabReady(
          false,
        )

        setOverlayModeActive(
          false,
        )

        setActiveUrl(
          null,
        )

        setViewMode(
          'home',
        )

        delete document
          .documentElement
          .dataset
          .nebulaBrowsingTauri

        delete document
          .documentElement
          .dataset
          .nebulaOverlayTauri
      }

    const markNativeTabReady =
      (
        event:
          Event,
      ) => {
        const detail =
          event instanceof
          CustomEvent
            ? event.detail
            : undefined

        const eventTabId =
          typeof detail ===
            'object' &&
          detail !== null &&
          'tabId' in
            detail &&
          typeof detail.tabId ===
            'string'
            ? detail.tabId
            : undefined

        if (
          eventTabId &&
          eventTabId !==
            activeTabIdRef.current
        ) {
          void writeTransitionLog(
            'shell.native-tab-ready.stale',
            'info',
            {
              ...(typeof detail ===
                'object' &&
              detail !==
                null
                ? detail
                : {}),
              activeTabId:
                activeTabIdRef.current,
              viewMode:
                viewModeRef.current,
            },
          )

          return
        }

        void writeTransitionLog(
          'shell.native-tab-ready',
          'info',
          {
            ...(typeof detail ===
              'object' &&
            detail !==
              null
              ? detail
              : {}),
            activeTabId:
              activeTabIdRef.current,
            viewMode:
              viewModeRef.current,
          },
        )

        setNativeTabReady(
          true,
        )
      }

    window.addEventListener(
      NATIVE_TAB_FAILED_EVENT,
      recoverHome,
    )

    window.addEventListener(
      NATIVE_TAB_READY_EVENT,
      markNativeTabReady,
    )

    return () => {
      window.removeEventListener(
        NATIVE_TAB_FAILED_EVENT,
        recoverHome,
      )

      window.removeEventListener(
        NATIVE_TAB_READY_EVENT,
        markNativeTabReady,
      )
    }
  }, [activeTabIdRef])

  useEffect(() => {
    if (
      viewMode ===
      'home'
    ) {
      setNativeTabReady(
        false,
      )
    }
  }, [viewMode])

  useEffect(() => {
    if (!isTauri) return

    void emitViewMode(
      viewMode,
    )
  }, [viewMode])

  useEffect(() => {
    if (!isTauri) return

    if (
      viewMode ===
      'browsing'
    ) {
      document
        .documentElement
        .dataset
        .nebulaBrowsingTauri =
        'true'

      delete document
        .documentElement
        .dataset
        .nebulaOverlayTauri
    } else if (
      viewMode ===
      'overlay'
    ) {
      delete document
        .documentElement
        .dataset
        .nebulaBrowsingTauri

      document
        .documentElement
        .dataset
        .nebulaOverlayTauri =
        'true'
    } else {
      delete document
        .documentElement
        .dataset
        .nebulaBrowsingTauri

      delete document
        .documentElement
        .dataset
        .nebulaOverlayTauri
    }

    return () => {
      delete document
        .documentElement
        .dataset
        .nebulaBrowsingTauri

      delete document
        .documentElement
        .dataset
        .nebulaOverlayTauri
    }
  }, [viewMode])

  useEffect(() => {
    if (activeTab) {
      setActiveUrl(
        activeTab.url,
      )
    }
  }, [activeTab])

  // Web fallback history is navigation-driven. Keep the latest title available
  // without re-recording a visit every time a page mutates document.title.
  const activeTabTitleRef = useRef(activeTab?.title)
  activeTabTitleRef.current = activeTab?.title

  useEffect(() => {
    if (!activeUrl) {
      return
    }

    recordBrowseSessionVisit(
      activeUrl,
    )
  }, [
    activeUrl,
    recordBrowseSessionVisit,
  ])

  useEffect(() => {
    if (
      isTauri ||
      !activeUrl
    ) {
      return
    }

    recordHistoryVisit(
      activeUrl,
      activeTabTitleRef.current,
    )
  }, [
    activeUrl,
    recordHistoryVisit,
  ])

  const registerGoogleSessionHelperTab =
    useCallback(
      (
        shortcutId:
          string,
        url:
          string,
      ) => {
        googleBrowserSessionTrackerRef
          .current
          .register(
            shortcutId,
            url,
          )
      },
      [],
    )

  const dismissGoogleSessionHelperTab =
    useCallback(
      async (
        shortcutId:
          string,
      ) => {
        googleBrowserSessionTrackerRef
          .current
          .discard(
            shortcutId,
          )

        const onHelperTab =
          viewModeRef.current ===
            'browsing' &&
          activeTabIdRef.current ===
            shortcutId

        if (isTauri) {
          await closeBrowseTab(
            shortcutId,
          )
        }

        closeTab(
          shortcutId,
        )

        setTabSwitchHistory(
          (history) =>
            history.filter(
              (id) =>
                id !==
                shortcutId,
            ),
        )

        if (onHelperTab) {
          setActiveUrl(
            null,
          )

          setViewMode(
            'home',
          )

          await applyTauriViewModeNow(
            'home',
            null,
          )

          delete document
            .documentElement
            .dataset
            .nebulaBrowsingTauri

          delete document
            .documentElement
            .dataset
            .nebulaOverlayTauri
        }
      },
      [
        activeTabIdRef,
        closeTab,
      ],
    )

  useEffect(() => {
    if (!isTauri) return

    let cancelled =
      false

    let unlisten:
      | (() => void)
      | undefined

    void listenTabWebviewSnapshots(
      (
        snapshot,
      ) => {
        if (
          !tabsRef.current.some(
            (tab) =>
              tab.shortcutId ===
              snapshot.shortcutId,
          )
        ) {
          return
        }

        const googleSessionEmail =
          googleBrowserSessionTrackerRef
            .current
            .complete(
              snapshot.shortcutId,
              snapshot.url,
            )

        if (googleSessionEmail) {
          markGoogleBrowserSessionLinked(
            googleSessionEmail,
          )

          void dismissGoogleSessionHelperTab(
            snapshot.shortcutId,
          )

          return
        }

        if (
          !googleBrowserSessionTrackerRef
            .current
            .has(
              snapshot.shortcutId,
            )
        ) {
          const previousHistoryUrl =
            historyUrlByTabRef
              .current
              .get(
                snapshot.shortcutId,
              )

          if (
            previousHistoryUrl !==
            snapshot.url
          ) {
            recordHistoryVisit(
              snapshot.url,
              snapshot.title,
            )

            historyUrlByTabRef
              .current
              .set(
                snapshot.shortcutId,
                snapshot.url,
              )
          }
        }

        applyTabSnapshot(
          snapshot.shortcutId,
          snapshot.url,
          snapshot.title,
        )

        if (
          activeTabIdRef.current !==
          snapshot.shortcutId
        ) {
          return
        }

        const current =
          tabsRef.current.find(
            (tab) =>
              tab.shortcutId ===
              snapshot.shortcutId,
          )

        if (
          !current ||
          current.url !==
            snapshot.url
        ) {
          setActiveUrl(
            snapshot.url,
          )
        }
      },
    ).then(
      (
        dispose,
      ) => {
        if (
          cancelled
        ) {
          dispose()
          return
        }

        unlisten =
          dispose
      },
    )

    return () => {
      cancelled =
        true

      unlisten?.()
    }
  }, [
    activeTabIdRef,
    applyTabSnapshot,
    dismissGoogleSessionHelperTab,
    recordHistoryVisit,
    tabsRef,
  ])

  useEffect(() => {
    if (!isTauri) return

    let cancelled =
      false

    let unlisten:
      | (() => void)
      | undefined

    void listenTabWebviewLoadingStates(
      ({
        shortcutId,
        isLoading,
      }) => {
        updateTabMeta(
          shortcutId,
          { isLoading },
        )
      },
    ).then(
      (dispose) => {
        if (cancelled) {
          dispose()
          return
        }

        unlisten =
          dispose
      },
    )

    return () => {
      cancelled =
        true

      unlisten?.()
    }
  }, [
    updateTabMeta,
  ])
  useEffect(() => {
    if (!isTauri) return

    void emitActiveUrl(
      activeUrl,
    )
  }, [activeUrl])

  useEffect(() => {
    if (!isTauri) return

    void emitTabCatalog({
      tabs,
      activeTabId,
    })
  }, [
    tabs,
    activeTabId,
  ])

  const openSettings =
    useCallback(
      (
        anchor:
          ToolbarAnchor,
      ) => {
        setDownloadPanelOpen(
          false,
        )

        setNotificationPanelOpen(
          false,
        )

        setHistoryPanelOpen(
          false,
        )

        setOverlayModeActive(
          false,
        )

        setViewMode(
          'home',
        )

        setSettingsActivated(
          true,
        )

        setSettingsAnchor(
          anchor,
        )

        setSettingsOpen(
          true,
        )
      },
      [],
    )

  const closeSettings =
    useCallback(() => {
      setSettingsOpen(
        false,
      )

      setSettingsAnchor(
        null,
      )
    }, [])

  const handleClearBrowsingData =
    useCallback(
      async (
        kind:
          BrowsingDataKind =
          'all',
      ) => {
        const tabId =
          activeTabIdRef.current ??
          openTabIds[0]

        await clearBrowseData(
          tabId ??
            null,
          kind,
        )

        if (
          kind ===
            'all' ||
          kind ===
            'permissions'
        ) {
          clearSiteNotificationPermissions()
        }

        if (
          kind ===
            'all' ||
          kind ===
            'history'
        ) {
          clearAllHistory()
        }
      },
      [
        activeTabIdRef,
        clearSiteNotificationPermissions,
        clearAllHistory,
        openTabIds,
      ],
    )

  const handleReopenOnboarding =
    useCallback(() => {
      closeSettings()

      setOnboardingInitialStep(
        'profile',
      )

      setOnboardingOpen(
        true,
      )
    }, [
      closeSettings,
    ])

  const enterHomeEditMode =
    useCallback(() => {
      setViewMode(
        'home',
      )

      setDraftLayout(
        homeLayoutFromSettings(
          settings.home,
        ),
      )

      setHomeEditMode(
        true,
      )

      setSettingsOpen(
        false,
      )

      setSettingsAnchor(
        null,
      )
    }, [
      settings.home,
    ])

  const saveHomeEditMode =
    useCallback(() => {
      if (
        draftLayout
      ) {
        applyHomeLayout(
          draftLayout,
        )
      }

      setHomeEditMode(
        false,
      )

      setDraftLayout(
        null,
      )
    }, [
      draftLayout,
      applyHomeLayout,
    ])

  const cancelHomeEditMode =
    useCallback(() => {
      setHomeEditMode(
        false,
      )

      setDraftLayout(
        null,
      )
    }, [])

  const updateDraftLayout =
    useCallback(
      (
        patch:
          Partial<HomeLayout>,
      ) => {
        setDraftLayout(
          (prev) =>
            prev
              ? {
                  ...prev,
                  ...patch,
                }
              : prev,
        )
      },
      [],
    )

  const switchToExistingBrowseTab =
    useCallback(
      (
        shortcutId:
          string,
      ) => {
        /*
         * Update immediately so another Ctrl+Tab received
         * before React commits can continue from this target.
         */
        tabSwitchCursorRef.current =
          shortcutId

        setTabSwitchHistory(
          (history) => {
            const current =
              activeTabIdRef.current

            if (
              current &&
              current !==
                shortcutId
            ) {
              return [
                ...history,
                current,
              ]
            }

            return history
          },
        )

        setActiveTabId(
          shortcutId,
        )

        setViewMode(
          'browsing',
        )

        setTauriBrowseSyncToken(
          (token) =>
            token +
            1,
        )
      },
      [
        activeTabIdRef,
        setActiveTabId,
      ],
    )

  const openShortcutByUrl =
    useCallback(
      (
        shortcutUrl:
          string,
        options?: {
          forceTargetUrl?: boolean
          activate?: boolean
        },
      ) => {
        const activate =
          options?.activate !==
          false

        const {
          shortcut:
            launchShortcut,
          forceLoad,
        } =
          resolveShortcutForOpen(
            shortcutUrl,
            allShortcuts,
            loadBrowseSessions(),
            options,
          )

        const existingTab =
          getTab(
            launchShortcut.id,
          )

        const tabExists =
          !!existingTab

        registerGoogleSessionHelperTab(
          launchShortcut.id,
          launchShortcut.url,
        )

        const openInBackground =
          () => {
            addVisitedShortcut(
              launchShortcut.url,
            )

            openOrSwitchTab(
              launchShortcut,
              {
                reload:
                  forceLoad &&
                  tabExists,
                activate:
                  false,
              },
            )

            pendingBrowseTargetRef.current =
              null

            setViewMode(
              'home',
            )

            setTauriBrowseSyncToken(
              (token) =>
                token +
                1,
            )

            if (
              isTauri
            ) {
              void prepareBrowseTabInBackground(
                launchShortcut.id,
                launchShortcut.url,
                {
                  forceNavigate:
                    forceLoad ||
                    !tabExists,
                },
              )
            }
          }

        if (
          tabExists &&
          !forceLoad
        ) {
          if (
            activate
          ) {
            switchToExistingBrowseTab(
              launchShortcut.id,
            )

            return
          }

          openInBackground()
          return
        }

        if (
          !activate
        ) {
          openInBackground()
          return
        }

        addVisitedShortcut(
          launchShortcut.url,
        )

        setTabSwitchHistory(
          (history) => {
            const current =
              activeTabIdRef.current

            if (
              current &&
              current !==
                launchShortcut.id
            ) {
              return [
                ...history,
                current,
              ]
            }

            return history
          },
        )

        pendingBrowseTargetRef.current =
          {
            tabId:
              launchShortcut.id,
            url:
              launchShortcut.url,
            forceNavigate:
              forceLoad,
          }

        tabSwitchCursorRef.current =
          launchShortcut.id

        openOrSwitchTab(
          launchShortcut,
          {
            reload:
              forceLoad &&
              tabExists,
          },
        )

        setTauriBrowseSyncToken(
          (token) =>
            token +
            1,
        )

        setViewMode(
          'browsing',
        )
      },
      [
        addVisitedShortcut,
        allShortcuts,
        getTab,
        openOrSwitchTab,
        activeTabIdRef,
        registerGoogleSessionHelperTab,
        switchToExistingBrowseTab,
      ],
    )

  useEffect(() => {
    if (!isTauri) return
    let disposed = false
    let unlisten: (() => void) | undefined

    void listenNativeNotificationActivations(({ tabLabel, origin, downloadId }) => {
      if (disposed) return
      if (downloadId) {
        void actDownload(downloadId, 'reveal').catch(() => undefined)
        return
      }
      const shortcutId = tabLabel
        ? shortcutIdForTabWebviewLabel(tabLabel)
        : null
      if (
        shortcutId &&
        tabsRef.current.some((tab) => tab.shortcutId === shortcutId)
      ) {
        switchToExistingBrowseTab(shortcutId)
        return
      }
      if (origin) {
        openShortcutByUrl(origin, { forceTargetUrl: true, activate: true })
      }
    }).then((dispose) => {
      if (disposed) dispose()
      else unlisten = dispose
    })

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [actDownload, openShortcutByUrl, switchToExistingBrowseTab, tabsRef])

  const openFromSearchBar =
    useCallback(
      (
        shortcutUrl:
          string,
      ) => {
        openShortcutByUrl(
          shortcutUrl,
          {
            forceTargetUrl:
              true,
            activate:
              true,
          },
        )
      },
      [
        openShortcutByUrl,
      ],
    )

  const openBrowseUrl =
    useCallback(
      (
        shortcutUrl:
          string,
        options?: {
          activate?: boolean
        },
      ) => {
        openShortcutByUrl(
          shortcutUrl,
          {
            forceTargetUrl:
              true,
            activate:
              options?.activate ??
              true,
          },
        )
      },
      [
        openShortcutByUrl,
      ],
    )

  const openHistoryTab =
    useCallback(
      (
        url: string,
        title?: string,
        activate =
          true,
        restoredId?:
          string,
      ) => {
        const id =
          restoredId?.trim() ||
          `history-${crypto.randomUUID()}`

        const shortcut:
          Shortcut = {
          id,
          label:
            title?.trim() ||
            url,
          url,
        }

        if (
          !activate
        ) {
          openOrSwitchTab(
            shortcut,
            {
              activate:
                false,
              reload:
                Boolean(restoredId),
            },
          )

          if (
            isTauri
          ) {
            void prepareBrowseTabInBackground(
              id,
              url,
              {
                forceNavigate:
                  true,
              },
            )
          }

          return
        }

        setTabSwitchHistory(
          (history) => {
            const current =
              activeTabIdRef.current

            if (
              current &&
              current !==
                id
            ) {
              return [
                ...history,
                current,
              ]
            }

            return history
          },
        )

        pendingBrowseTargetRef.current =
          {
            tabId:
              id,
            url,
            forceNavigate:
              true,
          }

        tabSwitchCursorRef.current =
          id

        openOrSwitchTab(
          shortcut,
          restoredId
            ? {
                reload:
                  true,
              }
            : undefined,
        )

        setTauriBrowseSyncToken(
          (token) =>
            token +
            1,
        )

        setViewMode(
          'browsing',
        )
      },
      [
        activeTabIdRef,
        openOrSwitchTab,
      ],
    )

  const openHistoryEntry =
    useCallback(
      (
        url:
          string,
        title?:
          string,
      ) => {
        closeHistoryPanel()

        openHistoryTab(
          url,
          title,
          true,
        )
      },
      [
        closeHistoryPanel,
        openHistoryTab,
      ],
    )

  const openClosedHistoryTab =
    useCallback(
      (
        entry:
          ClosedTabEntry,
      ) => {
        removeClosedTab(
          entry.id,
        )

        closeHistoryPanel()

        openHistoryTab(
          entry.url,
          entry.title,
          true,
        )
      },
      [
        closeHistoryPanel,
        openHistoryTab,
        removeClosedTab,
      ],
    )

  const openPreviousHistorySession =
    useCallback(
      (
        session:
          BrowserSessionSnapshot,
      ) => {
        if (
          session.tabs.length ===
          0
        ) {
          return
        }

        closeHistoryPanel()

        const activeIndex =
          Math.max(
            0,
            session.tabs.findIndex(
              (tab) =>
                tab.id ===
                session.activeTabId,
            ),
          )

        session.tabs.forEach(
          (
            tab,
            index,
          ) => {
            if (
              index ===
              activeIndex
            ) {
              return
            }

            openHistoryTab(
              tab.url,
              tab.title,
              false,
              tab.id,
            )
          },
        )

        const active =
          session.tabs[
            activeIndex
          ] ??
          session.tabs[0]

        if (active) {
          openHistoryTab(
            active.url,
            active.title,
            true,
            active.id,
          )
        }
      },
      [
        closeHistoryPanel,
        openHistoryTab,
      ],
    )

  const restoreCrashedSession =
    useCallback(() => {
      if (
        !previousSession
      ) {
        return
      }

      setCrashRecoveryOpen(
        false,
      )

      openPreviousHistorySession(
        previousSession,
      )
    }, [
      openPreviousHistorySession,
      previousSession,
    ])

  useEffect(() => {
    if (startupSessionRestoreRef.current) return
    startupSessionRestoreRef.current = true

    if (
      previousRunUnclean ||
      crashRecoveryOpen ||
      !settings.browsing.restoreTabsOnStartup ||
      !previousSession
    ) {
      return
    }

    openPreviousHistorySession(
      previousSession,
    )
  }, [
    crashRecoveryOpen,
    openPreviousHistorySession,
    previousRunUnclean,
    previousSession,
    settings.browsing.restoreTabsOnStartup,
  ])

  const dismissCrashRecovery =
    useCallback(() => {
      setCrashRecoveryOpen(
        false,
      )
    }, [])

  const handleCloseTab =
    useCallback(
      async (
        shortcutId:
          string,
      ) => {
        if (
          closingTabIdsRef.current.has(
            shortcutId,
          )
        ) {
          return
        }

        closingTabIdsRef.current.add(
          shortcutId,
        )

        const closing =
          tabsRef.current.find(
            (tab) =>
              tab.shortcutId ===
              shortcutId,
          )

        if (
          closing
        ) {
          closedTabsRef.current =
            [
              closing,
              ...closedTabsRef.current,
            ].slice(
              0,
              25,
            )

          recordClosedTab(
            closing,
          )
        }

        historyUrlByTabRef.current.delete(
          shortcutId,
        )

        googleBrowserSessionTrackerRef
          .current
          .discard(
            shortcutId,
          )

        const remaining =
          tabsRef.current.filter(
            (tab) =>
              !closingTabIdsRef.current.has(
                tab.shortcutId,
              ),
          )

        const goingHome =
          remaining.length ===
          0

        closeTab(
          shortcutId,
        )

        setTabSwitchHistory(
          (history) =>
            history.filter(
              (id) =>
                id !==
                shortcutId,
            ),
        )

        if (
          tabSwitchCursorRef.current ===
          shortcutId
        ) {
          tabSwitchCursorRef.current =
            remaining[0]
              ?.shortcutId ??
            null
        }

        if (
          goingHome
        ) {
          setOverlayModeActive(
            false,
          )

          setActiveUrl(
            null,
          )

          setViewMode(
            'home',
          )

          tabSwitchCursorRef.current =
            null

          delete document
            .documentElement
            .dataset
            .nebulaBrowsingTauri

          delete document
            .documentElement
            .dataset
            .nebulaOverlayTauri
        }

        try {
          if (
            isTauri
          ) {
            await forceExitSiteFullscreen()

            if (
              goingHome
            ) {
              await applyTauriViewModeNow(
                'home',
                null,
              )
            }

            await closeBrowseTab(
              shortcutId,
            )
          }
        } catch (error) {
          if (
            import.meta.env.DEV
          ) {
            console.warn(
              `[nebula] close tab ${shortcutId} failed`,
              error,
            )
          }
        } finally {
          closingTabIdsRef.current.delete(
            shortcutId,
          )
        }
      },
      [
        closeTab,
        recordClosedTab,
        tabsRef,
      ],
    )

  useEffect(() => {
    if (
      tabs.length !==
        0 ||
      viewMode ===
        'home'
    ) {
      return
    }

    setOverlayModeActive(
      false,
    )

    setActiveUrl(
      null,
    )

    setViewMode(
      'home',
    )

    tabSwitchCursorRef.current =
      null

    delete document
      .documentElement
      .dataset
      .nebulaBrowsingTauri

    delete document
      .documentElement
      .dataset
      .nebulaOverlayTauri

    if (
      isTauri
    ) {
      void applyTauriViewModeNow(
        'home',
        null,
      )
    }
  }, [
    tabs.length,
    viewMode,
  ])

  useEffect(() => {
    if (
      crashRecoveryOpen &&
      tabs.length ===
        0
    ) {
      return
    }

    const timer =
      window.setTimeout(
        () => {
          saveCurrentSession(
            tabs,
            activeTabId,
          )
        },
        250,
      )

    return () =>
      window.clearTimeout(
        timer,
      )
  }, [
    activeTabId,
    crashRecoveryOpen,
    saveCurrentSession,
    tabs,
  ])

  const openOverlay =
    useCallback(() => {
      overlayDismissGuardRef.current =
        performance.now() +
        450

      if (
        isTauri
      ) {
        setOverlayModeActive(
          true,
        )
      }

      setViewMode(
        'overlay',
      )
    }, [])

  const dismissOverlay =
    useCallback(() => {
      if (
        performance.now() <
        overlayDismissGuardRef.current
      ) {
        return
      }

      if (
        isTauri
      ) {
        setOverlayModeActive(
          false,
        )
      }

      setViewMode(
        'browsing',
      )
    }, [])

  const goHome =
    useCallback(() => {
      void (async () => {
        await forceExitSiteFullscreen()

        setViewMode(
          'home',
        )
      })()
    }, [])

  const openNewBlankTab =
    useCallback(() => {
      const id =
        `tab-${crypto.randomUUID()}`

      const shortcut:
        Shortcut = {
        id,
        label:
          t(
            'newTab',
          ),
        url:
          'about:blank',
      }

      setTabSwitchHistory(
        (history) => {
          const current =
            activeTabIdRef.current

          if (
            current &&
            current !==
              id
          ) {
            return [
              ...history,
              current,
            ]
          }

          return history
        },
      )

      pendingBrowseTargetRef.current =
        {
          tabId:
            id,
          url:
            shortcut.url,
          forceNavigate:
            true,
        }

      tabSwitchCursorRef.current =
        id

      openOrSwitchTab(
        shortcut,
      )

      setTauriBrowseSyncToken(
        (token) =>
          token +
          1,
      )

      setViewMode(
        'browsing',
      )
    }, [
      activeTabIdRef,
      openOrSwitchTab,
      t,
    ])

  const openUrlInNewTab =
    useCallback(
      (
        rawUrl: string,
      ) => {
        const url =
          rawUrl.trim() ||
          'about:blank'

        try {
          const parsed =
            new URL(
              url,
              'about:blank',
            )

          if (
            ![
              'http:',
              'https:',
              'about:',
            ].includes(
              parsed.protocol,
            )
          ) {
            return
          }
        } catch {
          return
        }

        const id =
          `tab-${crypto.randomUUID()}`

        const shortcut:
          Shortcut = {
          id,
          label:
            url ===
            'about:blank'
              ? t('newTab')
              : titleFromUrl(
                  url,
                ),
          url,
        }

        setTabSwitchHistory(
          (history) => {
            const current =
              activeTabIdRef.current

            if (
              current &&
              current !== id
            ) {
              return [
                ...history,
                current,
              ]
            }

            return history
          },
        )

        pendingBrowseTargetRef.current =
          {
            tabId: id,
            url,
            forceNavigate: true,
          }

        tabSwitchCursorRef.current =
          id

        openOrSwitchTab(
          shortcut,
        )

        setTauriBrowseSyncToken(
          (token) =>
            token + 1,
        )

        setViewMode(
          'browsing',
        )
      },
      [
        activeTabIdRef,
        openOrSwitchTab,
        t,
      ],
    )

    useEffect(() => {
    if (!isTauri) return

    let disposed =
      false

    let unlisten:
      | (() => void)
      | undefined

    const drainExternalUrls =
      async () => {
        try {
          const urls =
            await takePendingExternalUrls()

          if (
            disposed
          ) {
            return
          }

          for (
            const url of
            urls
          ) {
            openUrlInNewTab(
              url,
            )
          }
        } catch (error) {
          if (
            import.meta.env.DEV
          ) {
            console.warn(
              '[nebula] failed to open external URL',
              error,
            )
          }
        }
      }

    const register =
      async () => {
        const dispose =
          await listenExternalUrlPending(
            () => {
              void drainExternalUrls()
            },
          )

        if (
          disposed
        ) {
          dispose()
          return
        }

        unlisten =
          dispose

        // Also drains URLs captured during cold startup or while the
        // frontend listener was not ready yet.
        await drainExternalUrls()
      }

    void register().catch(
      (error) => {
        if (
          import.meta.env.DEV
        ) {
          console.warn(
            '[nebula] external URL listener failed to register',
            error,
          )
        }
      },
    )

    return () => {
      disposed =
        true

      unlisten?.()
    }
  }, [
    openUrlInNewTab,
  ])


  const openHomeNavigate =
    useCallback(
      (
        shortcutUrl:
          string,
      ) => {
        const normalizedTarget =
          (() => {
            try {
              return new URL(
                shortcutUrl,
              ).href
            } catch {
              return shortcutUrl
            }
          })()

        const isPinnedTarget =
          pinnedShortcutList.some(
            (shortcut) => {
              try {
                return (
                  new URL(
                    shortcut.url,
                  ).href ===
                  normalizedTarget
                )
              } catch {
                return (
                  shortcut.url ===
                  shortcutUrl
                )
              }
            },
          )

        if (
          isPinnedTarget
        ) {
          openUrlInNewTab(
            shortcutUrl,
          )
          return
        }

        openBrowseUrl(
          shortcutUrl,
        )
      },
      [
        openBrowseUrl,
        openUrlInNewTab,
        pinnedShortcutList,
      ],
    )
  useEffect(() => {
    if (!isTauri) return

    let disposed = false
    let disposeListeners:
      (() => void) | undefined

    const register =
      async () => {
        const dispose =
          await registerListenerGroup([
            () => listenSiteUiRequests(
              (request) => {
                if (
                  request.requestType ===
                    'protocol-handler' &&
                  request.permissionKind
                ) {
                  const existing =
                    matchingProtocolHandlerDecision(
                      request.permissionKind,
                      request.message,
                      request.uri,
                    )

                  if (existing) {
                    void respondToSiteUi(
                      request.id,
                      {
                        accepted:
                          existing.allowed,
                      },
                    )
                    return
                  }
                }

                if (
                  request.requestType ===
                    'external-uri'
                ) {
                  const handlerUrl =
                    resolveProtocolHandler(
                      request.message,
                    )

                  if (handlerUrl) {
                    void respondToSiteUi(
                      request.id,
                      {
                        // Cancel the OS launch. Nebula routes this
                        // scheme to the web handler the user allowed.
                        accepted: false,
                      },
                    ).then(() => {
                      openUrlInNewTab(
                        handlerUrl,
                      )
                    })
                    return
                  }
                }

                setSiteUiQueue(
                  (queue) =>
                    queue.some(
                      (item) =>
                        item.id ===
                        request.id,
                    )
                      ? queue
                      : [
                          ...queue,
                          request,
                        ],
                )
              },
            ),
            () => listenSiteUiCancelled(
              ({ id }) => {
                setSiteUiQueue(
                  (queue) =>
                    queue.filter(
                      (item) =>
                        item.id !== id,
                    ),
                )
              },
            ),
            () => listenSiteContextMenus(
              (request) => {
                setSiteContextMenu(
                  request,
                )
              },
            ),
            () => listenSiteContextMenuCancelled(
              ({ id }) => {
                setSiteContextMenu(
                  (current) =>
                    current?.id === id
                      ? null
                      : current,
                )
              },
            ),
            () => listenSitePrintRequests(
              (request) => {
                const tabId =
                  shortcutIdForTabWebviewLabel(
                    request.tabLabel,
                  ) ?? null
                const tab =
                  tabId
                    ? tabsRef.current.find(
                        (entry) =>
                          entry.shortcutId ===
                          tabId,
                      )
                    : null

                setPrintTarget({
                  webviewLabel:
                    request.tabLabel,
                  title:
                    request.title ||
                    tab?.title ||
                    t('untitledPage'),
                  url:
                    request.url ||
                    tab?.url ||
                    '',
                })
              },
            ),
            () => listenSiteZoomRequests(
              ({ tabLabel, action }) => {
                const tabId =
                  shortcutIdForTabWebviewLabel(
                    tabLabel,
                  )
                if (
                  !tabId ||
                  tabId !==
                    activeTabIdRef.current
                ) {
                  return
                }

                void changeActiveTabZoom(
                  action,
                )
              },
            ),
            () => listenSiteNewWindows(
              (payload) => {
                if (
                  !payload.features
                    .isPopup
                ) {
                  openUrlInNewTab(
                    payload.uri,
                  )
                  return
                }

                void openSitePopup(
                  payload,
                ).catch((error) => {
                  if (import.meta.env.DEV) {
                    console.warn(
                      '[nebula] popup window creation failed',
                      error,
                    )
                  }
                })
              },
            ),
            () => listenSiteCloseWindows(
              ({ tabLabel }) => {
                if (
                  isPopupContentLabel(
                    tabLabel,
                  )
                ) {
                  void closeSitePopupForContent(
                    tabLabel,
                  )
                  return
                }

                const shortcutId =
                  shortcutIdForTabWebviewLabel(
                    tabLabel,
                  )

                if (shortcutId) {
                  void handleCloseTab(
                    shortcutId,
                  )
                }
              },
            ),
          ])

        if (disposed) {
          dispose()
          return
        }

        disposeListeners =
          dispose
      }

    void register().catch((error) => {
      if (import.meta.env.DEV) {
        console.warn('[nebula] site UI listeners failed to register', error)
      }
    })

    return () => {
      disposed = true
      disposeListeners?.()
    }
  }, [
    activeTabIdRef,
    changeActiveTabZoom,
    handleCloseTab,
    openUrlInNewTab,
    t,
    tabsRef,
  ])

  useEffect(() => {
    const open =
      siteUiQueue.length > 0 ||
      siteContextMenu !== null ||
      printTarget !== null ||
      passwordPromptOffer !== null ||
      compatibilityPromptActive

    if (
      open &&
      !siteUiWasOpenRef.current
    ) {
      const previous =
        viewModeRef.current

      siteUiPreviousModeRef.current =
        previous

      setDownloadPanelOpen(
        false,
      )
      setNotificationPanelOpen(
        false,
      )
      setHistoryPanelOpen(
        false,
      )

      if (
        previous ===
        'browsing'
      ) {
        setOverlayModeActive(
          true,
        )
        setViewMode(
          'overlay',
        )
      }
    }

    if (
      !open &&
      siteUiWasOpenRef.current
    ) {
      const previous =
        siteUiPreviousModeRef.current

      if (
        previous ===
          'browsing' &&
        activeTabIdRef.current
      ) {
        setOverlayModeActive(
          false,
        )
        setViewMode(
          'browsing',
        )
      } else if (
        previous ===
          'overlay' &&
        activeTabIdRef.current
      ) {
        setOverlayModeActive(
          true,
        )
        setViewMode(
          'overlay',
        )
      } else if (
        previous ===
        'home'
      ) {
        setOverlayModeActive(
          false,
        )
        setViewMode(
          'home',
        )
      }
    }

    siteUiWasOpenRef.current =
      open
  }, [
    activeTabIdRef,
    compatibilityPromptActive,
    passwordPromptOffer,
    siteContextMenu,
    siteUiQueue.length,
    printTarget,
  ])

  const handleSiteContextMenuSelect =
    useCallback(
      async (
        commandId: number | null,
      ) => {
        const request =
          siteContextMenu

        if (!request) return

        // Clear the visible menu immediately so the main shell can return to
        // the page as soon as WebView2 completes the original native command.
        setSiteContextMenu(null)

        try {
          await respondToSiteContextMenu(
            request.id,
            commandId,
          )

          if (
            commandId ===
              NEBULA_PRINT_COMMAND_ID
          ) {
            const shortcutId =
              shortcutIdForTabWebviewLabel(
                request.tabLabel,
              )

            if (shortcutId) {
              openPrintDialogForTab(
                shortcutId,
              )
            }
          }
        } catch (error) {
          if (import.meta.env.DEV) {
            console.warn(
              '[nebula] site context-menu response failed',
              error,
            )
          }
        }
      },
      [openPrintDialogForTab, siteContextMenu],
    )

  const handleSiteUiResponse =
    useCallback(
      async (
        response:
          SiteUiResponse,
      ) => {
        const request =
          siteUiQueue[0]

        if (!request) return

        try {
          if (
            request.requestType ===
              'protocol-handler' &&
            request.permissionKind
          ) {
            saveProtocolHandlerDecision(
              request.permissionKind,
              request.message,
              request.uri,
              request.title,
              response.accepted,
            )
          }

          await respondToSiteUi(
            request.id,
            response,
          )

          if (
            request.requestType ===
              'permission' &&
            request.permissionKind ===
              'notifications' &&
            response.remember
          ) {
            setSiteNotificationPermission(
              request.uri,
              response.accepted
                ? 'allow'
                : 'block',
            )
          }
        } catch (error) {
          if (
            import.meta.env.DEV
          ) {
            console.warn(
              '[nebula] site UI response failed',
              error,
            )
          }
        } finally {
          setSiteUiQueue(
            (queue) =>
              queue.filter(
                (item) =>
                  item.id !==
                  request.id,
              ),
          )
        }
      },
      [
        setSiteNotificationPermission,
        siteUiQueue,
      ],
    )

  const reopenLastClosedTab =
    useCallback(() => {
      const closed =
        closedTabsRef.current.shift()

      if (
        !closed
      ) {
        return
      }

      const shortcut =
        shortcutFromTab(
          closed,
        )

      setTabSwitchHistory(
        (history) => {
          const current =
            activeTabIdRef.current

          if (
            current &&
            current !==
              closed.shortcutId
          ) {
            return [
              ...history,
              current,
            ]
          }

          return history
        },
      )

      pendingBrowseTargetRef.current =
        {
          tabId:
            closed.shortcutId,
          url:
            closed.url,
          forceNavigate:
            true,
        }

      tabSwitchCursorRef.current =
        closed.shortcutId

      openOrSwitchTab(
        shortcut,
        {
          reload:
            true,
        },
      )

      setTauriBrowseSyncToken(
        (token) =>
          token +
          1,
      )

      setViewMode(
        'browsing',
      )
    }, [
      activeTabIdRef,
      openOrSwitchTab,
    ])

  const switchTabAfterSiteFullscreen =
    useCallback(
      (
        shortcutId:
          string,
      ) => {
        /*
         * Normal Ctrl+Tab remains immediate. Only HTML5 fullscreen needs the
         * native handoff.
         */
        tabSwitchCursorRef.current =
          shortcutId

        if (
          !isSiteFullscreenActive()
        ) {
          switchToExistingBrowseTab(
            shortcutId,
          )
          return
        }

        const fullscreenOwner =
          activeTabIdRef.current ??
          undefined

        /*
         * Selecting the already-fullscreen tab is an exit, not a handoff.
         * Restore that same tab normally so its bounds are repaired.
         */
        if (
          fullscreenOwner ===
          shortcutId
        ) {
          void forceExitSiteFullscreen(
            fullscreenOwner,
          ).catch(
            () => undefined,
          )
          return
        }

        void exitSiteFullscreenForTabSwitch(
          fullscreenOwner,
        )
          .catch(
            () => false,
          )
          .then(() => {
            if (
              tabSwitchCursorRef.current !==
              shortcutId
            ) {
              return
            }

            switchToExistingBrowseTab(
              shortcutId,
            )
          })
      },
      [
        activeTabIdRef,
        switchToExistingBrowseTab,
      ],
    )

  const cycleTab =
    useCallback(
      (
        direction:
          1 | -1,
      ) => {
        const ids =
          tabsRef.current.map(
            (tab) =>
              tab.shortcutId,
          )

        if (
          ids.length ===
          0
        ) {
          return
        }

        /*
         * React may not commit activeTabId between rapid keyboard
         * events, so use the synchronous target cursor first.
         */
        const current =
          tabSwitchCursorRef.current ??
          activeTabIdRef.current

        let index =
          current
            ? ids.indexOf(
                current,
              )
            : -1

        /*
         * The cursor can temporarily reference a tab that was
         * just closed. Recover from committed state if needed.
         */
        if (
          index <
          0
        ) {
          const committed =
            activeTabIdRef.current

          index =
            committed
              ? ids.indexOf(
                  committed,
                )
              : -1
        }

        const nextIndex =
          (
            index +
            direction +
            ids.length
          ) %
          ids.length

        const nextId =
          ids[
            nextIndex
          ]

        if (
          !nextId
        ) {
          return
        }

        /*
         * Update BEFORE React state so another Ctrl+Tab arriving
         * in the same frame continues from this intended target.
         */
        tabSwitchCursorRef.current =
          nextId

        switchTabAfterSiteFullscreen(
          nextId,
        )
      },
      [
        activeTabIdRef,
        switchTabAfterSiteFullscreen,
        tabsRef,
      ],
    )

  const switchToTabByIndex =
    useCallback(
      (
        index:
          number,
      ) => {
        const ids =
          tabsRef.current.map(
            (tab) =>
              tab.shortcutId,
          )

        if (
          index <
            0 ||
          index >=
            ids.length
        ) {
          return
        }

        const target =
          ids[index]

        if (
          !target
        ) {
          return
        }

        tabSwitchCursorRef.current =
          target

        switchTabAfterSiteFullscreen(
          target,
        )
      },
      [
        switchTabAfterSiteFullscreen,
        tabsRef,
      ],
    )

  const goBackInPage =
    useCallback(() => {
      if (
        viewModeRef.current ===
        'overlay'
      ) {
        dismissOverlay()
        return
      }

      if (
        isTauri &&
        activeTabIdRef.current
      ) {
        void navigateBrowseTabBack(
          activeTabIdRef.current,
        ).then(
          (
            wentBack,
          ) => {
            if (
              !wentBack &&
              viewModeRef.current ===
                'browsing'
            ) {
              setViewMode(
                'home',
              )
            }
          },
        )

        return
      }

      if (
        viewModeRef.current ===
        'browsing'
      ) {
        setViewMode(
          'home',
        )
      }
    }, [
      activeTabIdRef,
      dismissOverlay,
    ])

  const goForwardInPage =
    useCallback(() => {
      if (
        !isTauri ||
        !activeTabIdRef.current
      ) {
        return
      }

      void navigateBrowseTabForward(
        activeTabIdRef.current,
      )
    }, [
      activeTabIdRef,
    ])

  const reloadActiveTab =
    useCallback(() => {
      const tabId =
        activeTabIdRef.current

      if (
        !tabId
      ) {
        return
      }

      if (
        isTauri
      ) {
        void reloadBrowseTab(
          tabId,
        )

        return
      }

      const tab =
        getTab(
          tabId,
        )

      if (
        !tab
      ) {
        return
      }

      openOrSwitchTab(
        {
          id:
            tab.shortcutId,
          label:
            tab.title,
          url:
            tab.url,
          favicon:
            tab.favicon,
        },
        {
          reload:
            true,
        },
      )
    }, [
      activeTabIdRef,
      getTab,
      openOrSwitchTab,
    ])

  const focusAddressBar =
    useCallback(() => {
      if (
        viewModeRef.current ===
        'home'
      ) {
        setFocusSearchRequest(
          (token) =>
            token +
            1,
        )

        return
      }

      openOverlay()

      setFocusSearchRequest(
        (token) =>
          token +
          1,
      )
    }, [
      openOverlay,
    ])

  const openDeveloperTools =
    useCallback(() => {
      if (
        developerToolsOpen
      ) {
        return
      }

      const previousMode =
        viewModeRef.current

      developerToolsPreviousModeRef.current =
        previousMode

      setDownloadPanelOpen(
        false,
      )

      setNotificationPanelOpen(
        false,
      )

      setHistoryPanelOpen(
        false,
      )

      if (
        previousMode ===
        'browsing'
      ) {
        if (
          isTauri
        ) {
          setOverlayModeActive(
            true,
          )
        }

        setViewMode(
          'overlay',
        )
      }

      setDeveloperToolsOpen(
        true,
      )
    }, [
      developerToolsOpen,
    ])

  const closeDeveloperTools =
    useCallback(() => {
      const previousMode =
        developerToolsPreviousModeRef.current

      setDeveloperToolsOpen(
        false,
      )

      if (
        previousMode ===
          'browsing' &&
        activeTabIdRef.current
      ) {
        if (
          isTauri
        ) {
          setOverlayModeActive(
            false,
          )
        }

        setViewMode(
          'browsing',
        )

        return
      }

      if (
        previousMode ===
          'overlay' &&
        activeTabIdRef.current
      ) {
        if (
          isTauri
        ) {
          setOverlayModeActive(
            true,
          )
        }

        setViewMode(
          'overlay',
        )

        return
      }

      if (
        isTauri
      ) {
        setOverlayModeActive(
          false,
        )
      }

      setViewMode(
        'home',
      )
    }, [
      activeTabIdRef,
    ])

  const toggleDeveloperTools =
    useCallback(() => {
      if (
        developerToolsOpen
      ) {
        closeDeveloperTools()
        return
      }

      openDeveloperTools()
    }, [
      closeDeveloperTools,
      developerToolsOpen,
      openDeveloperTools,
    ])

  const handleBrowserShortcut =
    useCallback(
      (
        action:
          BrowserShortcutId,
      ) => {
        if (
          action ===
          'devtools'
        ) {
          toggleDeveloperTools()
          return
        }

        if (
          developerToolsOpen
        ) {
          if (
            action ===
            'close-overlay'
          ) {
            closeDeveloperTools()
          }

          return
        }

        if (
          printTarget
        ) {
          if (
            action ===
            'close-overlay'
          ) {
            setPrintTarget(
              null,
            )
          }

          return
        }

        if (
          siteSurfaceActive ||
          getAppDialogsSnapshot().length > 0 ||
          settingsOpen ||
          onboardingOpen
        ) {
          return
        }

        switch (
          action
        ) {
          case 'new-tab':
            openNewBlankTab()
            break

          case 'close-tab':
            if (
              activeTabIdRef.current
            ) {
              void handleCloseTab(
                activeTabIdRef.current,
              )
            }
            break

          case 'reopen-tab':
            reopenLastClosedTab()
            break

          case 'next-tab':
            cycleTab(
              1,
            )
            break

          case 'prev-tab':
            cycleTab(
              -1,
            )
            break

          case 'switch-tab-1':
          case 'switch-tab-2':
          case 'switch-tab-3':
          case 'switch-tab-4':
          case 'switch-tab-5':
          case 'switch-tab-6':
          case 'switch-tab-7':
          case 'switch-tab-8':
            switchToTabByIndex(
              Number(
                action.slice(
                  -1,
                ),
              ) -
                1,
            )
            break

          case 'switch-tab-last': {
            const count =
              tabsRef.current
                .length

            if (
              count >
              0
            ) {
              switchToTabByIndex(
                count -
                  1,
              )
            }

            break
          }

          case 'reload':
            reloadActiveTab()
            break

          case 'focus-url-bar':
            focusAddressBar()
            break

          case 'go-back':
            goBackInPage()
            break

          case 'go-forward':
            goForwardInPage()
            break

          case 'go-home':
            goHome()
            break

          case 'open-history':
            toggleHistoryPanel()
            break

          case 'open-tab-search':
            void emitTabSearchRequest()
            break

          case 'print':
            if (
              activeTabIdRef.current &&
              isTauri
            ) {
              openPrintDialogForTab(
                activeTabIdRef.current,
              )
            }
            break

          case 'toggle-fullscreen':
            void toggleBrowserWindowFullscreen()
            break

          case 'zoom-in':
          case 'zoom-out':
          case 'zoom-reset': {
            if (
              activeTabIdRef.current &&
              isTauri
            ) {
              const zoomAction =
                action ===
                'zoom-in'
                  ? 'in'
                  : action ===
                      'zoom-out'
                    ? 'out'
                    : 'reset'

              void changeActiveTabZoom(
                zoomAction,
              )
            }

            break
          }

          case 'close-overlay':
            if (
              viewModeRef.current ===
              'overlay'
            ) {
              dismissOverlay()
            }

            break
        }
      },
      [
        activeTabIdRef,
        closeDeveloperTools,
        cycleTab,
        developerToolsOpen,
        dismissOverlay,
        focusAddressBar,
        goBackInPage,
        goForwardInPage,
        goHome,
        handleCloseTab,
        onboardingOpen,
        printTarget,
        openPrintDialogForTab,
        changeActiveTabZoom,
        openNewBlankTab,
        reloadActiveTab,
        reopenLastClosedTab,
        settingsOpen,
        siteSurfaceActive,
        switchToTabByIndex,
        tabsRef,
        toggleDeveloperTools,
        toggleHistoryPanel,
      ],
    )

  useBrowserShortcuts({
    onAction:
      handleBrowserShortcut,
    bindings:
      browserShortcutBindings,
    enabled:
      !onboardingOpen,
  })

  useEffect(() => {
    if (
      viewMode !==
      'overlay'
    ) {
      return
    }

    if (
      developerToolsOpen ||
      siteSurfaceActive
    ) {
      return
    }

    const onKeyDown =
      (
        e:
          KeyboardEvent,
      ) => {
        if (
          e.key ===
          'Escape'
        ) {
          dismissOverlay()
        }
      }

    window.addEventListener(
      'keydown',
      onKeyDown,
    )

    return () =>
      window.removeEventListener(
        'keydown',
        onKeyDown,
      )
  }, [
    viewMode,
    developerToolsOpen,
    dismissOverlay,
    siteSurfaceActive,
  ])

  // In Tauri the main WebView is now the persistent Home surface.
  // Browser tabs cover it while browsing; overlay mode intentionally hides it.
  const showHomeSurface =
    isHome ||
    (isTauri && isBrowsing)

  const showBrowser =
    (
      isBrowsing ||
      isOverlay
    ) &&
    activeTabId !==
      null

  useEffect(() => {
    if (!isTauri) return

    return initSiteFullscreenBridge()
  }, [])

  const activeSiteInfoState = useMemo<SiteInfoStatePayload>(() => {
    const emptyPermissions: SiteInfoStatePayload['permissions'] = {
      camera: 'unsupported',
      microphone: 'unsupported',
      location: 'unsupported',
    }
    if (!activeTab) {
      return {
        shortcutId: null,
        url: null,
        origin: null,
        hostname: null,
        protectionDisabled: false,
        permissionPromptsAllowed: false,
        notificationPermission: null,
        permissions: emptyPermissions,
      }
    }

    const target = siteCompatibilityTarget(activeTab.url)
    if (!target) {
      return {
        shortcutId: activeTab.shortcutId,
        url: activeTab.url,
        origin: null,
        hostname: null,
        protectionDisabled: false,
        permissionPromptsAllowed: false,
        notificationPermission: null,
        permissions: emptyPermissions,
      }
    }

    const origin = new URL(target.url).origin
    const permissionPromptsAllowed =
      settings.privacy.permissionPolicy === 'ask' ||
      hostHasSiteException(
        target.hostname,
        settings.privacy.permissionExceptions,
      )
    const defaultPermissionState: SitePermissionState =
      permissionPromptsAllowed ? 'prompt' : 'denied'

    return {
      shortcutId: activeTab.shortcutId,
      url: target.url,
      origin,
      hostname: target.hostname,
      protectionDisabled: hostHasSiteException(
        target.hostname,
        settings.privacy.siteExceptions,
      ),
      permissionPromptsAllowed,
      notificationPermission:
        notificationCenter.sitePermissions[origin] ?? null,
      permissions: {
        camera: defaultPermissionState,
        microphone: defaultPermissionState,
        location: defaultPermissionState,
      },
    }
  }, [
    activeTab,
    notificationCenter.sitePermissions,
    settings.privacy.permissionExceptions,
    settings.privacy.permissionPolicy,
    settings.privacy.siteExceptions,
  ])

  const activeSiteInfoStateRef = useRef(activeSiteInfoState)
  activeSiteInfoStateRef.current = activeSiteInfoState

  const emitFreshSiteInfoState = useCallback(async () => {
    const snapshot = activeSiteInfoStateRef.current
    await emitSiteInfoState(snapshot)
    if (!snapshot.shortcutId || !snapshot.origin) return

    try {
      const permissions = await readSitePermissionStates(snapshot.shortcutId)
      const current = activeSiteInfoStateRef.current
      if (
        current.shortcutId !== snapshot.shortcutId ||
        current.origin !== snapshot.origin
      ) {
        return
      }
      await emitSiteInfoState({ ...current, permissions })
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('[nebula] site permission state query failed', error)
      }
    }
  }, [])

  useEffect(() => {
    if (!isTauri) return
    void emitFreshSiteInfoState()
  }, [activeSiteInfoState, emitFreshSiteInfoState])

  useEffect(() => {
    if (!isTauri) return

    let cancelled =
      false

    let unlisten:
      | (() => void)
      | undefined

    void listenChromeActions(
      (
        action,
      ) => {
        switch (
          action.type
        ) {
          case 'request-state': {
            const currentTabs =
              tabsRef.current
            const currentActiveId =
              activeTabIdRef.current
            const currentActiveTab =
              currentTabs.find(
                (tab) =>
                  tab.shortcutId ===
                  currentActiveId,
              )

            void emitTabCatalog({
              tabs: currentTabs,
              activeTabId:
                currentActiveId,
            })
            void emitActiveUrl(
              currentActiveTab?.url ??
                null,
            )
            void emitViewMode(
              viewModeRef.current,
            )
            void emitDownloadUiState(
              downloadUiStateRef.current,
            )
            void emitFreshSiteInfoState()
            break
          }

          case 'request-site-info':
            void emitFreshSiteInfoState()
            break

          case 'raise-chrome-overlay':
            void stackBrowsingChromeAboveBrowser(activeTabIdRef.current)
            break

          case 'open-tab':
            if (
              action.shortcutId &&
              tabsRef.current.some(
                (tab) =>
                  tab.shortcutId ===
                  action.shortcutId,
              )
            ) {
              tabSwitchCursorRef.current =
                action.shortcutId

              setActiveTabId(
                action.shortcutId,
              )

              setViewMode(
                'browsing',
              )

              break
            }

            openShortcutByUrl(
              action.url,
            )
            break

          case 'close-tab':
            void handleCloseTab(
              action.shortcutId,
            )
            break

          case 'switch-tab':
            tabSwitchCursorRef.current =
              action.shortcutId

            setActiveTabId(
              action.shortcutId,
            )

            setViewMode(
              'browsing',
            )
            break

          case 'set-tab-muted': {
            const tab = tabsRef.current.find(
              (entry) => entry.shortcutId === action.shortcutId,
            )
            if (!tab) break

            void setBrowseTabMuted(action.shortcutId, action.muted)
              .then(() => {
                updateTabMeta(action.shortcutId, { isMuted: action.muted })
              })
              .catch((error) => {
                if (import.meta.env.DEV) {
                  console.warn('[nebula] tab mute failed', error)
                }
              })
            break
          }

          case 'set-site-protection': {
            const site = activeSiteInfoStateRef.current
            if (!site.hostname || site.hostname !== action.hostname) break
            const siteExceptions = action.disabled
              ? addSiteException(
                  settings.privacy.siteExceptions,
                  site.hostname,
                )
              : removeSiteException(
                  settings.privacy.siteExceptions,
                  site.hostname,
                )
            updateCategory('privacy', 'siteExceptions', siteExceptions)
            break
          }

          case 'set-site-notification-permission': {
            const site = activeSiteInfoStateRef.current
            if (!site.origin || site.origin !== action.origin) break
            setSiteNotificationPermission(action.origin, action.permission)
            break
          }

          case 'reset-site-permissions': {
            const site = activeSiteInfoStateRef.current
            if (
              site.shortcutId !== action.shortcutId ||
              site.origin !== action.origin
            ) {
              break
            }
            void clearSitePermissions(action.shortcutId, action.origin)
              .then(() => {
                setSiteNotificationPermission(action.origin, null)
                void emitFreshSiteInfoState()
              })
              .catch((error: unknown) => {
                console.error('[nebula] site permission reset failed', error)
              })
            break
          }

          case 'clear-site-data': {
            const site = activeSiteInfoStateRef.current
            if (
              site.shortcutId !== action.shortcutId ||
              site.origin !== action.origin
            ) {
              break
            }
            void callTabDevTools(action.shortcutId, 'Storage.clearDataForOrigin', {
              origin: action.origin,
              storageTypes: 'all',
            })
              .then(() => reloadBrowseTab(action.shortcutId))
              .catch((error: unknown) => {
                console.error('[nebula] site data clear failed', error)
              })
            break
          }

          case 'open-overlay':
            openOverlay()
            break

          case 'go-back':
            goBackInPage()
            break

          case 'go-home':
            goHome()
            break

          case 'toggle-download-panel':
            toggleDownloadPanel()
            break

          case 'close-download-panel':
            closeDownloadPanel()
            break

          case 'remove-download':
            removeDownload(action.id)
            break

          case 'clear-finished-downloads':
            clearFinishedDownloads()
            break
        }
      },
    ).then(
      (
        dispose,
      ) => {
        if (
          cancelled
        ) {
          dispose()
          return
        }

        unlisten =
          dispose
      },
    )

    return () => {
      cancelled =
        true

      unlisten?.()
    }
  }, [
    openShortcutByUrl,
    handleCloseTab,
    setActiveTabId,
    updateTabMeta,
    openOverlay,
    goBackInPage,
    goHome,
    tabsRef,
    toggleDownloadPanel,
    closeDownloadPanel,
    activeTabIdRef,
    removeDownload,
    clearFinishedDownloads,
    emitFreshSiteInfoState,
    setSiteNotificationPermission,
    settings.privacy.siteExceptions,
    updateCategory,
  ])

  useEffect(() => {
    if (!isTauri) return

    if (
      isHome
    ) {
      void writeTransitionLog(
        'shell.sync-view-mode',
        'info',
        {
          mode:
            'home',
        },
      )

      syncTauriViewMode(
        'home',
        null,
      )

      return
    }

    if (
      isOverlay
    ) {
      void writeTransitionLog(
        'shell.sync-view-mode',
        'info',
        {
          mode:
            'overlay',
        },
      )

      syncTauriViewMode(
        'overlay',
        null,
      )

      return
    }

    if (
      !isBrowsing ||
      !activeTabId
    ) {
      return
    }

    const tab =
      tabsRef.current.find(
        (entry) =>
          entry.shortcutId ===
          activeTabId,
      )

    if (!tab) {
      return
    }

    const pending =
      pendingBrowseTargetRef.current

    const forceNavigate =
      pending?.tabId ===
      activeTabId
        ? pending.forceNavigate
        : undefined

    const targetUrl =
      pending?.tabId ===
      activeTabId
        ? pending.url
        : tab.url

    if (
      pending?.tabId ===
      activeTabId
    ) {
      pendingBrowseTargetRef.current =
        null
    }

    void writeTransitionLog(
      'shell.sync-view-mode',
      'info',
      {
        mode:
          'browsing',
        tabId:
          activeTabId,
        url:
          targetUrl,
        forceNavigate:
          forceNavigate ??
          false,
        pendingTarget:
          pending?.tabId ===
          activeTabId,
      },
    )

    setNativeTabReady(
      false,
    )

    syncTauriViewMode(
      'browsing',
      {
        tabId:
          activeTabId,
        url:
          targetUrl,
        forceNavigate,
      },
    )
  }, [
    isHome,
    isBrowsing,
    isOverlay,
    activeTabId,
    tauriBrowseSyncToken,
    tabsRef,
  ])

  const browserContentVisible =
    isOverlay ||
    !shortcutInteractionActive

  const hideHomeChrome =
    shortcutInteractionActive &&
    !homeEditMode

  const {
    home,
    semiLunar,
    notifications,
    privacy,
  } = settings

  const compatibilityContextRef = useRef({
    privacy,
    siteNotifications:
      notifications.siteNotifications,
    showNotificationContent:
      notifications.showNotificationContent,
    notificationAllowedSites:
      notificationCenter.allowedSites,
    notificationBlockedSites:
      notificationCenter.blockedSites,
    openTabIds,
  })

  compatibilityContextRef.current = {
    privacy,
    siteNotifications:
      notifications.siteNotifications,
    showNotificationContent:
      notifications.showNotificationContent,
    notificationAllowedSites:
      notificationCenter.allowedSites,
    notificationBlockedSites:
      notificationCenter.blockedSites,
    openTabIds,
  }

  useEffect(() => {
    if (!isTauri) return

    let disposed = false
    let unlisten: (() => void) | undefined

    void listenSiteCompatibilityRequests((request) => {
      if (
        disposed ||
        compatibilityPromptActiveRef.current
      ) {
        return
      }

      const shortcutId =
        shortcutIdForTabWebviewLabel(request.tabLabel)
      const target = siteCompatibilityTarget(request.url)
      if (
        !shortcutId ||
        !target ||
        !getTab(shortcutId)
      ) {
        return
      }

      const current = compatibilityContextRef.current
      if (
        hostHasSiteException(
          target.hostname,
          current.privacy.siteExceptions,
        )
      ) {
        return
      }

      const now = Date.now()
      const promptedAt =
        compatibilityPromptedHostsRef.current.get(
          target.hostname,
        ) ?? 0
      if (now - promptedAt < 5 * 60_000) {
        return
      }

      compatibilityPromptedHostsRef.current.set(
        target.hostname,
        now,
      )
      compatibilityPromptActiveRef.current = true
      setCompatibilityPromptActive(true)

      void showAppConfirmation(
        `${target.hostname} ${t('siteCompatibilityMessage')}`,
        t('siteCompatibilityTitle'),
        {
          acceptLabel: t('siteCompatibilityRetry'),
          cancelLabel: t('siteCompatibilityNotNow'),
        },
      )
        .then(async (accepted) => {
          if (!accepted || !getTab(shortcutId)) return

          const latest = compatibilityContextRef.current
          const siteExceptions = addSiteException(
            latest.privacy.siteExceptions,
            target.hostname,
          )
          const nextPrivacy = {
            ...latest.privacy,
            siteExceptions,
          }

          await setBrowsePrivacyOptions(
            {
              ...nextPrivacy,
              siteNotifications:
                latest.siteNotifications,
              showNotificationContent:
                latest.showNotificationContent,
              notificationAllowedSites:
                latest.notificationAllowedSites,
              notificationBlockedSites:
                latest.notificationBlockedSites,
            },
            latest.openTabIds,
          )

          updateCategory(
            'privacy',
            'siteExceptions',
            siteExceptions,
          )
          await navigateBrowseTab(shortcutId, target.url)
        })
        .catch((error: unknown) => {
          console.error(
            `[nebula compatibility] Failed to retry ${target.hostname} (${request.errorStatus}).`,
            error,
          )
        })
        .finally(() => {
          compatibilityPromptActiveRef.current = false
          setCompatibilityPromptActive(false)
        })
    }).then((dispose) => {
      if (disposed) {
        dispose()
        return
      }
      unlisten = dispose
    }).catch((error: unknown) => {
      console.error(
        '[nebula compatibility] Failed to listen for site failures.',
        error,
      )
    })

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [getTab, t, updateCategory])

  useEffect(() => {
    if (!isTauri) return

    void setBrowsePrivacyOptions(
      {
        ...privacy,
        siteNotifications:
          notifications.siteNotifications,
        showNotificationContent:
          notifications.showNotificationContent,
        notificationAllowedSites:
          notificationCenter.allowedSites,
        notificationBlockedSites:
          notificationCenter.blockedSites,
      },
      openTabIds,
    ).catch((error: unknown) => {
      console.error('[nebula privacy] Failed to apply browser privacy settings.', error)
    })
  }, [
    clearAllHistory,
    openTabIds,
    privacy,
    notifications.siteNotifications,
    notifications.showNotificationContent,
    notificationCenter.allowedSites,
    notificationCenter.blockedSites,
  ])

  const editLayout =
    homeEditMode &&
    draftLayout
      ? draftLayout
      : homeLayoutFromSettings(
          home,
        )

  const effectiveHome =
    homeEditMode
      ? {
          ...home,

          showPinnedStrip:
            editLayout
              .pinnedStrip
              .visible,

          pinnedStripSize:
            editLayout
              .pinnedStrip
              .size,

          searchSize:
            editLayout
              .search
              .size,

          searchOffsetX:
            editLayout
              .search
              .offset.x,

          searchOffsetY:
            editLayout
              .search
              .offset.y,

          showProfile:
            editLayout
              .profile
              .visible,

          profileOffsetX:
            editLayout
              .profile
              .offset.x,

          profileOffsetY:
            editLayout
              .profile
              .offset.y,

          showGreeting:
            editLayout
              .profile
              .visible,

          showSystemWidgets:
            editLayout
              .widgets
              .visible,

          showClock:
            editLayout
              .clock
              .visible,

          showToolbar:
            editLayout
              .toolbar
              .visible,
        }
      : home

  const browsingLunarCount =
    Math.max(
      openTabIds.length,
      1,
    )

  const browsingAdaptiveLunar =
    useMemo(
      () =>
        computeAdaptiveLunarSize(
          browsingLunarCount,
          semiLunar.lunarWidthPx,
          semiLunar.lunarHeightPx,
        ),
      [
        browsingLunarCount,
        semiLunar.lunarWidthPx,
        semiLunar.lunarHeightPx,
      ],
    )

  const semiLunarTimingProps = {
    previewOnHover:
      semiLunar.previewOnHover,

    homeAlwaysOpen:
      semiLunar.homeAlwaysOpen,

    browsingHoverOpen:
      semiLunar.browsingHoverOpen,

    browsingOpenDelayMs:
      semiLunar.browsingOpenDelayMs,

    closeDelayMs:
      semiLunar.closeDelayMs,

    previewDelayMs:
      semiLunar.previewDelayMs,

    closeBtnDelayMs:
      semiLunar.closeBtnDelayMs,

    folderMergeHoldMs:
      semiLunar.folderMergeHoldMs,

    mergeAnimMs:
      semiLunar.mergeAnimMs,

    iconSizePx:
      semiLunar.iconSizePx,

    rememberLayout:
      settings.browsing.restoreTabsOnStartup,
  }

  const semiLunarShortcuts =
    useMemo(() => {
      const byId =
        new Map<
          string,
          Shortcut
        >(
          visibleShortcuts.map(
            (
              shortcut,
            ) => [
              shortcut.id,
              shortcut,
            ],
          ),
        )

      for (
        const tab of
        tabs
      ) {
        const existing =
          byId.get(
            tab.shortcutId,
          )

        byId.set(
          tab.shortcutId,
          existing
            ? {
                ...existing,
                label:
                  tab.title,
                url:
                  tab.url,
                favicon:
                  tab.favicon,
              }
            : shortcutFromTab(
                tab,
              ),
        )
      }

      return [
        ...byId.values(),
      ]
    }, [
      visibleShortcuts,
      tabs,
    ])

  const handleSemiLunarNavigate =
    useCallback(
      (
        shortcutUrl:
          string,
        shortcutId?:
          string,
      ) => {
        if (
          shortcutId &&
          tabsRef.current.some(
            (tab) =>
              tab.shortcutId ===
              shortcutId,
          )
        ) {
          switchToExistingBrowseTab(
            shortcutId,
          )

          return
        }

        openShortcutByUrl(
          shortcutUrl,
        )
      },
      [
        openShortcutByUrl,
        switchToExistingBrowseTab,
        tabsRef,
      ],
    )

  const semiLunarShared = {
    shortcuts:
      semiLunarShortcuts,

    dockItemIds,
    folders,

    onCreateFolder:
      createFolderFromShortcuts,

    onAddToFolder:
      addShortcutToFolder,

    onRenameFolder:
      renameFolder,

    onNavigate:
      handleSemiLunarNavigate,

    onRemoveShortcut:
      handleRemoveFromSemiLunar,

    onCloseTab:
      handleCloseTab,

    openTabIds,
    activeTabId,
    getTab,

    onToggleMute:
      toggleMute,

    isMuted,
    isPinned,

    onTogglePin:
      togglePin,

    canPinMore,

    onRemoveMemberFromFolder:
      removeMemberFromFolder,

    onShortcutInteractionChange:
      setLunarShortcutInteraction,

    activeUrl,
    getSession,

    ...semiLunarTimingProps,
  }

  const semiLunarMenuProps = {
    ...semiLunarShared,

    mode:
      (
        isHome
          ? 'home'
          : 'browsing'
      ) as
        | 'home'
        | 'browsing',

    shellViewMode:
      viewMode as ShellViewMode,

    lunarWidthPx:
      browsingAdaptiveLunar.width,

    lunarHeightPx:
      browsingAdaptiveLunar.height,

    onHomeClick:
      isHome
        ? undefined
        : openOverlay,

    onBackClick:
      isHome
        ? undefined
        : goBackInPage,

    onDownloadsClick:
      isHome
        ? undefined
        : toggleDownloadPanel,

    downloadCount:
      downloads.items.length,

    activeDownloadCount:
      downloads.activeCount,

    downloadProgress:
      downloads.aggregateProgress,

    downloadPanelOpen:
      !isHome &&
      downloadPanelOpen,

    forceOpen:
      !isHome &&
      downloadPanelOpen,

  }

  const toolbarProps = {
    onSettings:
      openSettings,

    onNotifications:
      toggleNotificationPanel,

    onDownloads:
      toggleDownloadPanel,

    onHistory:
      toggleHistoryPanel,

    notificationBadge:
      notifications
        .showToolbarBadge
        ? notificationCenter
            .unreadCount
        : 0,

    downloadCount:
      downloads.items.length,

    activeDownloadCount:
      downloads.activeCount,

    downloadProgress:
      downloads.aggregateProgress,

  }

  return (
    <div
      className={[
        styles.shell,

        isTauri
          ? styles.shellTauri
          : '',

        isTauri &&
        isOverlay
          ? styles.shellTauriOverlay
          : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {showHomeSurface && (
        <WallpaperBackground
          config={
            wallpaper
          }
          active={
            isHome &&
            !settingsOpen &&
            !onboardingOpen &&
            !developerToolsOpen &&
            !siteSurfaceActive
          }
          hidden={
            shortcutInteractionActive &&
            !homeEditMode
          }
        />
      )}

      {isHome &&
        homeEditMode && (
          <div
            className={
              styles.editDimOverlay
            }
            aria-hidden="true"
          />
        )}

      {showHomeSurface && (
        <>
          <HomeCenter
            onNavigate={
              openHomeNavigate
            }
            onSearchNavigate={
              openFromSearchBar
            }
            searchEngine={
              effectiveHome.searchEngine
            }
            historyEntries={
              historyEntries
            }
            userDisplayName={
              accountDisplayName
            }
            avatarUrl={
              account?.avatarUrl
            }
            showGreeting={
              effectiveHome.showGreeting
            }
            showProfile={
              effectiveHome.showProfile
            }
            showPinnedStrip={
              effectiveHome.showPinnedStrip
            }
            pinnedStripSize={
              effectiveHome.pinnedStripSize
            }
            searchSize={
              effectiveHome.searchSize
            }
            searchOffset={{
              x:
                effectiveHome.searchOffsetX,
              y:
                effectiveHome.searchOffsetY,
            }}
            profileOffset={{
              x:
                effectiveHome.profileOffsetX,
              y:
                effectiveHome.profileOffsetY,
            }}
            pinnedShortcuts={
              pinnedShortcutList
            }
            onUnpinShortcut={
              unpinShortcut
            }
            onReorderPins={
              reorderPins
            }
            isShortcutMuted={
              isMuted
            }
            onToggleShortcutMute={
              toggleMute
            }
            onRemoveShortcut={
              handleRemoveFromSemiLunar
            }
            previewOnHover={
              semiLunar.previewOnHover
            }
            previewDelayMs={
              semiLunar.previewDelayMs
            }
            onShortcutInteractionChange={
              setPinShortcutInteraction
            }
            activeUrl={
              activeUrl
            }
            getSession={
              getSession
            }
            focusSearchRequest={
              focusSearchRequest
            }
            hideChrome={
              hideHomeChrome
            }
            pinPreviewActive={
              pinShortcutInteraction
            }
            editMode={
              homeEditMode
            }
            editLayout={
              homeEditMode
                ? editLayout
                : undefined
            }
            onEditLayoutChange={
              updateDraftLayout
            }
          />

          <div
            className={
              hideHomeChrome
                ? styles.homeChromeHidden
                : ''
            }
            aria-hidden={
              hideHomeChrome
            }
          >
            {(
              effectiveHome
                .showSystemWidgets ||
              homeEditMode
            ) && (
              <div
                className={[
                  styles.widgetColumn,

                  homeEditMode
                    ? styles.editElevated
                    : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <LeftSidebar
                  onAddWidget={
                    widgetLayout.addWidget
                  }
                  activeTypes={
                    widgetLayout.activeTypes
                  }
                  widgetSettings={{
                    showRamWidget:
                      home.showRamWidget,

                    showCpuWidget:
                      home.showCpuWidget,
                  }}
                  onExportWidgets={
                    widgetLayout.exportBackup
                  }
                  onImportWidgets={
                    widgetLayout.importBackup
                  }
                  clockSettings={{
                    showClock:
                      effectiveHome.showClock,

                    clockFontSize:
                      home.clockFontSize,

                    clockFontWeight:
                      home.clockFontWeight,

                    clockShowDate:
                      home.clockShowDate,

                    clockFontFamily:
                      home.clockFontFamily,
                  }}
                  editMode={
                    homeEditMode
                  }
                  editWidgetsVisible={
                    editLayout.widgets.visible
                  }
                  editClockVisible={
                    editLayout.clock.visible
                  }
                  onEditToggleWidgets={() =>
                    updateDraftLayout({
                      widgets: {
                        ...editLayout.widgets,

                        visible:
                          !editLayout.widgets.visible,
                      },
                    })
                  }
                  onEditToggleClock={() =>
                    updateDraftLayout({
                      clock: {
                        ...editLayout.clock,

                        visible:
                          !editLayout.clock.visible,
                      },
                    })
                  }
                >
                  {effectiveHome
                    .showSystemWidgets &&
                    isHome && (
                    <Suspense
                      fallback={
                        null
                      }
                    >
                      <HomeWidgetGrid
                        panes={
                          widgetLayout.visiblePanes
                        }
                        layout={
                          widgetLayout.visibleLayout
                        }
                        statsEnabled={
                          home.showRamWidget ||
                          home.showCpuWidget
                        }
                        onLayoutChange={
                          widgetLayout.onLayoutChange
                        }
                        onFocusPane={
                          widgetLayout.focusWidget
                        }
                        onClosePane={
                          widgetLayout.removeWidget
                        }
                        onUpdatePane={
                          widgetLayout.updateWidgetData
                        }
                        onNavigate={
                          openFromSearchBar
                        }
                      />
                    </Suspense>
                  )}
                </LeftSidebar>
              </div>
            )}

            {(
              effectiveHome
                .showToolbar ||
              homeEditMode
            ) && (
              <div
                className={
                  homeEditMode
                    ? styles.editElevated
                    : ''
                }
              >
                <RightToolbar
                  {...toolbarProps}
                  editMode={
                    homeEditMode
                  }
                  editToolbarVisible={
                    editLayout.toolbar.visible
                  }
                  onEditToggleToolbar={() =>
                    updateDraftLayout({
                      toolbar: {
                        ...editLayout.toolbar,

                        visible:
                          !editLayout.toolbar.visible,
                      },
                    })
                  }
                />
              </div>
            )}
          </div>

          {homeEditMode && (
            <HomeEditBar
              onSave={
                saveHomeEditMode
              }
              onCancel={
                cancelHomeEditMode
              }
            />
          )}
        </>
      )}

      {showBrowser &&
        !isTauri && (
          <div
            className={[
              styles.browserFullscreen,

              isOverlay
                ? styles.browserBehindOverlay
                : '',

              shortcutInteractionActive
                ? styles.browserHiddenDuringPreview
                : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <TabbedBrowserContent
              tabs={
                tabs
              }
              activeTabId={
                activeTabId
              }
              visible={
                browserContentVisible
              }
            />
          </div>
        )}

      {!isTauri &&
        createPortal(
          <div
            className={
              (
                isHome &&
                pinShortcutInteraction
              ) ||
              (
                isBrowsing &&
                historyPanelOpen
              )
                ? styles.semiLunarHidden
                : ''
            }
            aria-hidden={
              (
                isHome &&
                pinShortcutInteraction
              ) ||
              (
                isBrowsing &&
                historyPanelOpen
              )
                ? true
                : undefined
            }
          >
            <SemiLunarMenu
              {...semiLunarMenuProps}
            />
          </div>,
          document.body,
        )}

      {crashRecoveryOpen &&
        previousSession &&
        createPortal(
          <CrashRecoveryPrompt
            tabCount={
              previousSession
                .tabs.length
            }
            onRestore={
              restoreCrashedSession
            }
            onDismiss={
              dismissCrashRecovery
            }
          />,
          document.body,
        )}

      {historyPanelOpen &&
        createPortal(
          <HistoryPanel
            entries={
              historyEntries
            }
            hosts={
              historyHosts
            }
            closedTabs={
              persistedClosedTabs
            }
            previousSession={
              previousSession
            }
            variant={
              isBrowsing
                ? 'browsing'
                : 'home'
            }
            browsingTop={
              browsingAdaptiveLunar.height +
              14
            }
            onOpenUrl={
              openHistoryEntry
            }
            onOpenClosedTab={
              openClosedHistoryTab
            }
            onOpenPreviousSession={
              openPreviousHistorySession
            }
            onRemoveEntry={
              removeHistoryEntry
            }
            onClearFiltered={
              clearFilteredHistory
            }
            onClearAll={
              clearAllHistory
            }
            onClearClosed={
              clearClosedTabs
            }
            onClose={
              closeHistoryPanel
            }
          />,
          document.body,
        )}

      {downloadPanelOpen &&
        !(isTauri && isBrowsing) &&
        createPortal(
          <DownloadManager
            items={
              downloads.items
            }
            variant={
              isBrowsing
                ? 'browsing'
                : 'home'
            }
            browsingTop={
              browsingAdaptiveLunar.height +
              14
            }
            onAction={
              downloads.act
            }
            onRemove={
              downloads.remove
            }
            onClearFinished={
              downloads.clearFinished
            }
            onClose={
              closeDownloadPanel
            }
          />,
          document.body,
        )}

      {notificationPanelOpen &&
        createPortal(
          <NotificationPanel
            items={
              notificationCenter.items
            }
            variant={
              isBrowsing
                ? 'browsing'
                : 'home'
            }
            browsingTop={
              browsingAdaptiveLunar.height +
              14
            }
            onMarkRead={
              notificationCenter.markRead
            }
            onMarkAllRead={
              notificationCenter.markAllRead
            }
            onRemove={
              notificationCenter.remove
            }
            onClear={
              notificationCenter.clear
            }
            onOpenOrigin={(
              origin,
              tabLabel,
            ) => {
              closeNotificationPanel()

              const shortcutId = tabLabel
                ? shortcutIdForTabWebviewLabel(tabLabel)
                : null
              if (
                shortcutId &&
                tabsRef.current.some(
                  (tab) => tab.shortcutId === shortcutId,
                )
              ) {
                switchToExistingBrowseTab(shortcutId)
                return
              }

              openShortcutByUrl(
                origin,
                {
                  forceTargetUrl:
                    true,

                  activate:
                    true,
                },
              )
            }}
            onOpenDownload={(downloadId) => {
              closeNotificationPanel()
              void actDownload(downloadId, 'reveal').catch(() => undefined)
            }}
            onClose={
              closeNotificationPanel
            }
          />,
          document.body,
        )}

      {isOverlay &&
        !developerToolsOpen &&
        !siteSurfaceActive && (
          <>
            <button
              type="button"
              className={[
                styles.overlayBackdrop,

                isTauri
                  ? styles.overlayBackdropTauri
                  : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={
                dismissOverlay
              }
              aria-label={
                t(
                  'returnBrowsing',
                )
              }
            />

            <div
              className={
                styles.overlayHome
              }
            >
              <button
                type="button"
                className={
                  styles.overlayDismiss
                }
                onClick={
                  dismissOverlay
                }
                aria-label={
                  t(
                    'closeOverlay',
                  )
                }
              >
                âœ•
              </button>

              <div
                className={
                  styles.overlayChrome
                }
              >
                <RightToolbar
                  variant="overlay"
                  {...toolbarProps}
                />

                <button
                  type="button"
                  className={
                    styles.overlayMainMenu
                  }
                  onClick={
                    goHome
                  }
                  title={
                    t(
                      'homeTitle',
                    )
                  }
                  aria-label={
                    t(
                      'homeAria',
                    )
                  }
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M12 3L4 9v12h5v-7h6v7h5V9l-8-6z" />
                  </svg>
                </button>
              </div>

              <HomeCenter
                variant="overlay"
                onNavigate={
              openHomeNavigate
            }
                onSearchNavigate={
                  openFromSearchBar
                }
                searchEngine={
                  home.searchEngine
                }
                historyEntries={
                  historyEntries
                }
                userDisplayName={
                  home.userDisplayName
                }
                showGreeting={
                  false
                }
                showProfile={
                  false
                }
                showPinnedStrip={
                  pinnedShortcutList.length >
                  0
                }
                pinnedShortcuts={
                  pinnedShortcutList
                }
                onUnpinShortcut={
                  unpinShortcut
                }
                onReorderPins={
                  reorderPins
                }
                isShortcutMuted={
                  isMuted
                }
                onToggleShortcutMute={
                  toggleMute
                }
                onRemoveShortcut={
                  handleRemoveFromSemiLunar
                }
                previewOnHover={
                  semiLunar.previewOnHover
                }
                previewDelayMs={
                  semiLunar.previewDelayMs
                }
                activeUrl={
                  activeUrl
                }
                getSession={
                  getSession
                }
                focusSearchRequest={
                  focusSearchRequest
                }
              />
            </div>
          </>
        )}

      {siteContextMenu && (
        <SiteContextMenu
          request={
            siteContextMenu
          }
          onSelect={
            (commandId) => {
              void handleSiteContextMenuSelect(
                commandId,
              )
            }
          }
        />
      )}

      {printTarget && (
        <PrintDialog
          webviewLabel={printTarget.webviewLabel}
          title={printTarget.title}
          url={printTarget.url}
          onCancel={() => {
            setPrintTarget(
              null,
            )
          }}
          onPrint={async (
            options,
          ) => {
            await printBrowseWebview(
              printTarget.webviewLabel,
              options,
            )

            setPrintTarget(
              null,
            )
          }}
        />
      )}

      {siteUiQueue[0] && (
        <SiteUiPrompt
          request={
            siteUiQueue[0]
          }
          pendingCount={
            siteUiQueue.length
          }
          onRespond={
            (response) => {
              void handleSiteUiResponse(
                response,
              )
            }
          }
        />
      )}

      {passwordFillOffer && (
        <PasswordFillPrompt
          site={
            passwordFillOffer.label
          }
          pageUrl={
            passwordFillOffer.pageUrl
          }
          matches={
            passwordFillOffer.matches ?? []
          }
          onFill={
            passwordBridge.acceptFill
          }
          onDismiss={
            passwordBridge.dismissOffer
          }
        />
      )}

      {passwordSaveOffer && (
        <PasswordSavePrompt
          site={
            passwordSaveOffer.label
          }
          pageUrl={
            passwordSaveOffer.pageUrl
          }
          username={
            passwordSaveOffer.username
          }
          onSave={
            passwordBridge.acceptSave
          }
          onDismiss={
            passwordBridge.dismissOffer
          }
        />
      )}

      <AppDialogHost />

      {developerToolsOpen && (
        <DeveloperTools
          activeTabId={
            activeTabId
          }
          activeUrl={
            activeUrl
          }
          openTabIds={
            openTabIds
          }
          sourceViewMode={
            developerToolsPreviousModeRef.current
          }
          onClose={
            closeDeveloperTools
          }
        />
      )}

      {onboardingOpen && (
        <Suspense
          fallback={
            null
          }
        >
          <OnboardingWizard
            open
            initialStep={
              onboardingInitialStep
            }
            onApplyImportedShortcuts={
              handleApplyImportedShortcuts
            }
            onComplete={
              handleOnboardingComplete
            }
          />
        </Suspense>
      )}

      {settingsActivated && (
        <Suspense
          fallback={
            null
          }
        >
          <SettingsPanel
            open={
              settingsOpen
            }
            anchor={
              settingsAnchor
            }
            onClose={
              closeSettings
            }
            wallpaperConfig={
              wallpaper
            }
            onUpdateWallpaper={
              updateWallpaper
            }
            onPickWallpaper={
              pickWallpaper
            }
            onPickVideoWallpaper={
              pickVideoWallpaper
            }
            onResetWallpaper={
              resetWallpaper
            }
            onResetShortcuts={
              handleResetShortcuts
            }
            onClearSavedSession={
              clearCurrentSession
            }
            onResetSemiLunarLayout={
              handleResetSemiLunarLayout
            }
            onResetFolders={
              resetFolders
            }
            shortcutBindings={
              browserShortcutBindings
            }
            onSetShortcutBinding={
              setBrowserShortcutBinding
            }
            onResetShortcutBinding={
              resetBrowserShortcutBinding
            }
            onResetAllShortcutBindings={
              resetAllBrowserShortcutBindings
            }
            settings={
              settings
            }
            notificationSites={
              notificationCenter.sites
            }
            notificationSitePermissions={
              notificationCenter.sitePermissions
            }
            onSetNotificationSitePermission={
              notificationCenter.setSitePermission
            }
            onUpdate={
              updateCategory
            }
            onResetCategory={
              resetCategory
            }
            onTogglePreviewOnHover={
              togglePreviewOnHover
            }
            onEnterHomeEdit={
              enterHomeEditMode
            }
            onFactoryReset={
              handleFactoryReset
            }
            onClearBrowsingData={
              handleClearBrowsingData
            }
            activeUrl={
              activeUrl
            }
            ublockVersion={
              ublockVersion
            }
            ublockEnabled={
              ublockEnabled
            }
            account={
              account
            }
            onAccountChange={
              setAccount
            }
            onAccountSignOut={
              handleAccountSignOut
            }
            onReopenOnboarding={
              handleReopenOnboarding
            }
            onOpenBrowseUrl={(
              url,
            ) =>
              openBrowseUrl(
                url,
                {
                  activate:
                    false,
                },
              )
            }
          />
        </Suspense>
      )}
    </div>
  )
}
