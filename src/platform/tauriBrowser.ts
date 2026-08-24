import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { Webview, type WebviewOptions } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {
  assignTabWebviewLabel,
  releaseTabWebviewLabel,
  shortcutIdForTabWebviewLabel,
  tabWebviewLabel,
} from '../core/browserTab'
import { KeyedLifecycleQueue } from '../core/keyedLifecycleQueue'
import { allSettledOrThrow, LatestPerKeyRunner } from '../core/latestPerKey'
import {
  prewarmCreationIsCurrent,
  prewarmProfileMatches,
} from '../core/prewarmProfile'
import { debounce } from './debounce'
import { isTauri } from './runtime'
import {
  traceTransitionCall,
  transitionErrorDetails,
  writeTransitionLog,
} from './tauriTransitionLog'
import {
  scheduleStackBrowsingChromeAboveBrowser,
  stackBrowsingChromeAboveBrowser,
} from './tauriWebviewStack'
import {
  browserWebviewFullscreenPhysicalBounds,
  browserWebviewPhysicalBounds,
} from './windowClientBounds'

const LAYOUT_DEBOUNCE_MS = 120
const UBLOCK_READY_TIMEOUT_MS = 4_000
const WEBVIEW_CREATE_TIMEOUT_MS = 15_000
const NEXT_PREWARM_DELAY_MS = 1_500
const MEMORY_PRESSURE_POLL_MS = 15_000
const MEMORY_PRESSURE_MIN_PERCENT = 45
const MEMORY_PRESSURE_MAX_PERCENT = 95
const TAB_SLEEP_DELAY_RELAXED_MS = 10 * 60_000
const TAB_SLEEP_DELAY_PRESSURED_MS = 45_000
const TAB_SLEEP_RETRY_MS = 60_000
const TAB_UNLOAD_DELAY_RELAXED_MS = 2 * 60 * 60_000
const TAB_UNLOAD_DELAY_PRESSURED_MS = 15 * 60_000
const TAB_UNLOAD_RETRY_MS = 5 * 60_000
const MIN_DYNAMIC_TIMER_MS = 1_000
const TAB_RESTORE_RETRY_MS = 350
const TAB_RESTORE_ATTEMPTS = 12

const BACKGROUND_ACTIVE_HOSTS = [
  'bsky.app',
  'discord.com',
  'discordapp.com',
  'facebook.com',
  'instagram.com',
  'linkedin.com',
  'slack.com',
  'snapchat.com',
  'teams.microsoft.com',
  'threads.net',
  'tiktok.com',
  'twitter.com',
  'x.com',
  'reddit.com',
  'web.whatsapp.com',
  'messenger.com',
  'web.telegram.org',
  'messages.google.com',
] as const

const PREWARMED_TAB_PREFIX = 'nebula-tab-prewarmed-'

export interface UblockExtensionInfo {
  extensionRoot: string
  version: string
  sourceSha256: string
}

export interface UblockRuntimeStatus {
  installed: boolean
  enabled: boolean
}

export interface SiteCompatibilityRequest {
  tabLabel: string
  url: string
  errorStatus: string
}

export function listenSiteCompatibilityRequests(
  onRequest: (request: SiteCompatibilityRequest) => void,
): Promise<UnlistenFn> {
  if (!isTauri) return Promise.resolve(() => {})
  return listen<SiteCompatibilityRequest>(
    'nebula-site-compatibility-request',
    ({ payload }) => onRequest(payload),
  )
}

type ExtensionWebviewOptions = WebviewOptions & {
  browserExtensionsEnabled: boolean
}

let ublockInfoPromise: Promise<UblockExtensionInfo> | null = null
let ublockProfileReadyPromise: Promise<void> | null = null

async function waitForUblockRules(): Promise<void> {
  if (document.documentElement.dataset.nebulaUblockReady === 'true') return

  await new Promise<void>((resolve) => {
    let settled = false

    const finish = () => {
      if (settled) return
      settled = true
      observer.disconnect()
      window.clearTimeout(timeout)
      resolve()
    }

    const observer = new MutationObserver(() => {
      if (document.documentElement.dataset.nebulaUblockReady === 'true') {
        finish()
      }
    })

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-nebula-ublock-ready'],
    })

    const timeout = window.setTimeout(
      finish,
      UBLOCK_READY_TIMEOUT_MS,
    )
  })
}

export function getUblockExtensionInfo(): Promise<UblockExtensionInfo> {
  if (!ublockInfoPromise) {
    ublockInfoPromise = invoke<UblockExtensionInfo>(
      'ublock_extension_info',
    ).catch((error) => {
      ublockInfoPromise = null
      throw error
    })
  }

  return ublockInfoPromise
}

export function getUblockRuntimeStatus(
  shortcutId: string,
): Promise<UblockRuntimeStatus> {
  return invoke<UblockRuntimeStatus>('ublock_extension_status', {
    label: tabWebviewLabel(shortcutId),
  })
}

async function ensureUblockProfile(label: string): Promise<void> {
  if (!ublockProfileReadyPromise) {
    ublockProfileReadyPromise = (async () => {
      let status = await invoke<UblockRuntimeStatus>(
        'ublock_extension_status',
        { label },
      )

      let installedNow = false

      if (!status.installed || !status.enabled) {
        status = await invoke<UblockRuntimeStatus>(
          'ublock_extension_install',
          { label },
        )
        installedNow = true
      }

      if (!status.installed || !status.enabled) {
        throw new Error(
          'uBlock Origin Lite was not enabled for the browser profile',
        )
      }

      if (installedNow) {
        await waitForUblockRules()
      } else {
        void waitForUblockRules()
      }
    })().catch((error) => {
      ublockProfileReadyPromise = null
      throw error
    })
  }

  return ublockProfileReadyPromise
}

/** Install/verify uBO while the home screen is visible so first navigation stays fast. */
export async function prewarmUblockProfile(): Promise<void> {
  if (!isTauri) return
  await ensureUblockProfile('main')
}

export interface BrowserPrivacyOptions {
  blockTrackers: boolean
  strictCookies: boolean
  httpsOnly: boolean
  trackingLevel: 'none' | 'balanced' | 'strict'
  globalPrivacyControl: boolean
  privateMode: boolean
  siteExceptions: string
  customBlockList: string
  permissionPolicy: 'ask' | 'block'
  permissionExceptions: string
  cookieBannerBlocking: boolean
  siteNotifications: boolean
  showNotificationContent: boolean
  notificationAllowedSites: string[]
  notificationBlockedSites: string[]
}

let privacyOptions: BrowserPrivacyOptions = {
  blockTrackers: false,
  strictCookies: false,
  httpsOnly: false,
  trackingLevel: 'balanced',
  globalPrivacyControl: true,
  privateMode: false,
  siteExceptions: '',
  customBlockList: '',
  permissionPolicy: 'ask',
  permissionExceptions: '',
  cookieBannerBlocking: true,
  siteNotifications: true,
  showNotificationContent: true,
  notificationAllowedSites: [],
  notificationBlockedSites: [],
}

let privacyRevision = 0
const popupPrivacyModes = new Map<string, boolean>()

function nativePrivacyOptions(options: BrowserPrivacyOptions) {
  return {
    ...options,
    siteExceptions: options.siteExceptions
      .split(/[\s,;]+/)
      .filter(Boolean),
    customBlockList: options.customBlockList
      .split(/[\s,;]+/)
      .filter(Boolean),
    permissionExceptions: options.permissionExceptions
      .split(/[\s,;]+/)
      .filter(Boolean),
  }
}

const privacyApplyRunner = new LatestPerKeyRunner(
  () => ({
    revision: privacyRevision,
    value: nativePrivacyOptions({ ...privacyOptions }),
  }),
  async (label: string, options) => {
    await invoke('webview_apply_privacy', {
      label,
      options,
    })
  },
)

async function applyPrivacyToLabel(label: string): Promise<void> {
  await privacyApplyRunner.run(label)
}

async function applyPrivacyToPopupLabel(
  label: string,
  privateMode: boolean,
): Promise<void> {
  await invoke('webview_apply_privacy', {
    label,
    options: nativePrivacyOptions({
      ...privacyOptions,
      privateMode,
    }),
  })
}

/**
 * Configure a newly-created, still-unnavigated popup target. The target's
 * private-mode bit comes from the opener's actual WebView2 profile, not from
 * the latest Settings value, so an already-open tab cannot accidentally spawn
 * a popup into a different profile.
 */
export async function configurePopupBrowseWebview(
  label: string,
  privateMode: boolean,
): Promise<void> {
  if (!isTauri) return

  await invoke('webview_setup_popup_target', { label })
  await invoke('webview_apply_browser_identity', { label })
  await applyPrivacyToPopupLabel(label, privateMode)
  popupPrivacyModes.set(label, privateMode)
}

export async function teardownPopupBrowseWebview(
  label: string,
): Promise<void> {
  popupPrivacyModes.delete(label)
  if (!isTauri) return
  await invoke('webview_teardown_popup_target', { label })
}

export async function setBrowsePrivacyOptions(
  options: BrowserPrivacyOptions,
  shortcutIds: string[],
): Promise<void> {
  const privateModeChanged = privacyOptions.privateMode !== options.privateMode
  if (JSON.stringify(privacyOptions) !== JSON.stringify(options)) {
    privacyRevision += 1
  }

  privacyOptions = { ...options }

  if (!isTauri) return

  if (privateModeChanged) {
    await resetPrewarmedWebviewForPrivateModeChange()
  }

  await allSettledOrThrow(
    [
      ...shortcutIds.map((shortcutId) =>
        applyPrivacyToLabel(
          tabWebviewLabel(shortcutId),
        ),
      ),
      ...Array.from(
        popupPrivacyModes.entries(),
        ([label, privateMode]) =>
          applyPrivacyToPopupLabel(
            label,
            privateMode,
          ),
      ),
    ],
    'Failed to apply privacy settings to browser tabs or popup windows',
  )
}

export type BrowsingDataKind =
  | 'all'
  | 'cookies'
  | 'cache'
  | 'history'
  | 'permissions'

export async function clearBrowseData(
  shortcutId: string | null,
  kind: BrowsingDataKind = 'all',
): Promise<void> {
  if (!isTauri) return

  await invoke('webview_clear_browsing_data', {
    label: shortcutId
      ? tabWebviewLabel(shortcutId)
      : 'main',
    kind,
  })
}

interface NativeTabSnapshotPayload {
  label: string
  url: string
  title: string
}

export interface TabWebviewSnapshot {
  shortcutId: string
  url: string
  title: string | null
}

interface NativeTabLoadingPayload {
  label: string
  isLoading: boolean
}

export interface TabWebviewLoadingState {
  shortcutId: string
  isLoading: boolean
}
interface NativeNavigationPerformancePayload {
  label: string
  url: string
  durationMs: number
  success: boolean
}

let navigationPerformanceListenerPromise:
  Promise<UnlistenFn> | null = null

async function ensureNavigationPerformanceListener(): Promise<void> {
  if (!navigationPerformanceListenerPromise) {
    navigationPerformanceListenerPromise =
      listen<NativeNavigationPerformancePayload>(
        'nebula-tab-navigation-performance',
        ({ payload }) => {
          const shortcutId =
            shortcutIdForTabWebviewLabel(payload.label)

          void writeTransitionLog(
            'performance.navigation',
            payload.success ? 'ok' : 'error',
            {
              shortcutId,
              label: payload.label,
              url: payload.url,
              durationMs: payload.durationMs,
            },
          )
        },
      ).catch((error) => {
        navigationPerformanceListenerPromise = null
        throw error
      })
  }

  await navigationPerformanceListenerPromise.then(
    () => undefined,
  )
}

export function listenTabWebviewSnapshots(
  onSnapshot: (snapshot: TabWebviewSnapshot) => void,
): Promise<UnlistenFn> {
  return listen<NativeTabSnapshotPayload>(
    'nebula-tab-snapshot',
    ({ payload }) => {
      const shortcutId =
        shortcutIdForTabWebviewLabel(payload.label)

      if (
        !shortcutId ||
        !payload.url ||
        payload.url === 'about:blank'
      ) {
        return
      }

      onSnapshot({
        shortcutId,
        url: payload.url,
        title: payload.title.trim() || null,
      })
    },
  )
}

/** Read WebView2's source at the moment a user action needs the live page URL. */
export async function readBrowseTabCurrentUrl(shortcutId: string): Promise<string> {
  const url = await invoke<string>('webview_current_url', {
    label: tabWebviewLabel(shortcutId),
  })
  const parsed = new URL(url)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('The browser tab does not have a pinnable URL.')
  }
  return parsed.href
}

export function listenTabWebviewLoadingStates(
  onLoadingState: (state: TabWebviewLoadingState) => void,
): Promise<UnlistenFn> {
  return listen<NativeTabLoadingPayload>(
    'nebula-tab-loading-state',
    ({ payload }) => {
      const shortcutId =
        shortcutIdForTabWebviewLabel(payload.label)

      if (!shortcutId) return

      onLoadingState({
        shortcutId,
        isLoading: payload.isLoading,
      })
    },
  )
}
let activeTabId: string | null = null
let activeWebview: Webview | null = null

const webviewCache = new Map<string, Webview>()
const createdTabs = new Set<string>()
const lowMemoryWebviews = new Set<string>()
const suspendedWebviews = new Set<string>()
const tabSleepTimers = new Map<string, number>()
const tabUnloadTimers = new Map<string, number>()
const tabUnloadInFlight = new Map<string, Promise<void>>()
const tabActivationRequests = new Set<string>()
const tabLastActiveAt = new Map<string, number>()
const tabLifecycleQueue = new KeyedLifecycleQueue<string>()

let systemMemoryPressurePercent =
  MEMORY_PRESSURE_MIN_PERCENT

let memoryPressurePollTimer: number | null = null
let memoryPressurePollInFlight: Promise<void> | null = null

interface UnloadedTabState {
  url: string
  title: string | null
  scrollX: number
  scrollY: number
  capturedAt: number
}

interface PageUnloadProbe {
  href?: string
  title?: string
  scrollX?: number
  scrollY?: number
  hasDirtyForm?: boolean
}

const unloadedTabStates = new Map<string, UnloadedTabState>()
const configuredWebviews = new Set<string>()

let prewarmedWebview: Webview | null = null
let prewarmedPrivateMode: boolean | null = null
let prewarmPromise: Promise<void> | null = null
let nextPrewarmTimer: number | null = null
let prewarmSequence = 0
let prewarmGeneration = 0
let activationSequence = 0

async function resetPrewarmedWebviewForPrivateModeChange(): Promise<void> {
  prewarmGeneration += 1

  if (nextPrewarmTimer !== null) {
    window.clearTimeout(nextPrewarmTimer)
    nextPrewarmTimer = null
  }

  const ready = prewarmedWebview
  prewarmedWebview = null
  prewarmedPrivateMode = null

  if (ready) {
    configuredWebviews.delete(ready.label)
    privacyApplyRunner.invalidate(ready.label)
    await destroyTabWebview(ready.label)
  }

  if (prewarmPromise) {
    await prewarmPromise.catch(() => undefined)
  }

  scheduleNextBrowseWebviewPrewarm()
}

let resizeUnlisten: (() => void) | null = null
let scaleUnlisten: (() => void) | null = null
let lastBrowserBoundsKey: string | null = null
let siteFullscreenBounds = false
let windowMinimizedWebviewLabel: string | null = null

export function setSiteFullscreenBoundsMode(
  active: boolean,
): void {
  siteFullscreenBounds = active
  lastBrowserBoundsKey = null
}

async function currentBrowserPhysicalBounds() {
  if (siteFullscreenBounds) {
    return browserWebviewFullscreenPhysicalBounds()
  }

  return browserWebviewPhysicalBounds()
}

function boundsKey(
  x: number,
  y: number,
  width: number,
  height: number,
): string {
  return `${x},${y},${width},${height}`
}

async function syncBrowserBounds(
  webview: Webview,
  traceId = 'background-layout',
): Promise<boolean> {
  const { position, size } =
    await traceTransitionCall(
      traceId,
      'browser.bounds.resolve',
      { label: webview.label },
      currentBrowserPhysicalBounds,
    )

  const key = boundsKey(
    position.x,
    position.y,
    size.width,
    size.height,
  )

  if (lastBrowserBoundsKey === key) {
    await writeTransitionLog(
      'browser.bounds.unchanged',
      'info',
      {
        traceId,
        label: webview.label,
        bounds: key,
      },
    )

    return false
  }

  lastBrowserBoundsKey = key

  await traceTransitionCall(
    traceId,
    'browser.bounds.set-position',
    {
      label: webview.label,
      x: position.x,
      y: position.y,
    },
    () => webview.setPosition(position),
  )

  await traceTransitionCall(
    traceId,
    'browser.bounds.set-size',
    {
      label: webview.label,
      width: size.width,
      height: size.height,
    },
    () => webview.setSize(size),
  )

  await traceTransitionCall(
    traceId,
    'browser.bounds.set-auto-resize',
    {
      label: webview.label,
      autoResize: false,
    },
    () => webview.setAutoResize(false),
  )

  return true
}

function unbindResizeListeners(): void {
  resizeUnlisten?.()
  resizeUnlisten = null

  scaleUnlisten?.()
  scaleUnlisten = null
}

async function currentWindowIsMinimized(): Promise<boolean> {
  try {
    return await getCurrentWindow().isMinimized()
  } catch {
    return false
  }
}

async function showWebviewForCurrentWindowState(
  webview: Webview,
  traceId: string,
): Promise<void> {
  if (
    await currentWindowIsMinimized()
  ) {
    await webview.hide()
    windowMinimizedWebviewLabel =
      webview.label

    await writeTransitionLog(
      'browser.window-visibility',
      'info',
      {
        traceId,
        label: webview.label,
        minimized: true,
      },
    )
    return
  }

  if (
    windowMinimizedWebviewLabel ===
    webview.label
  ) {
    windowMinimizedWebviewLabel =
      null
  }

  await webview.show()
}

async function syncWebviewWindowVisibilityAfterResize(
  webview: Webview,
  traceId: string,
): Promise<boolean> {
  if (
    activeWebview?.label !==
    webview.label
  ) {
    return false
  }

  if (
    await currentWindowIsMinimized()
  ) {
    if (
      windowMinimizedWebviewLabel !==
      webview.label
    ) {
      await webview.hide()
      windowMinimizedWebviewLabel =
        webview.label

      await writeTransitionLog(
        'browser.window-visibility',
        'info',
        {
          traceId,
          label: webview.label,
          minimized: true,
        },
      )
    }
    return false
  }

  if (
    windowMinimizedWebviewLabel ===
    webview.label
  ) {
    windowMinimizedWebviewLabel =
      null
    await webview.show()

    await writeTransitionLog(
      'browser.window-visibility',
      'ok',
      {
        traceId,
        label: webview.label,
        minimized: false,
      },
    )
  }

  return true
}

async function bindBrowserResize(
  webview: Webview,
  traceId: string,
): Promise<void> {
  unbindResizeListeners()

  activeWebview = webview
  lastBrowserBoundsKey = null

  const onLayoutChange = debounce(() => {
    void (async () => {
      const resizeTraceId =
        `${traceId}:resize`
      const visible =
        await syncWebviewWindowVisibilityAfterResize(
          webview,
          resizeTraceId,
        )

      if (!visible) return

      const changed =
        await syncBrowserBounds(
          webview,
          resizeTraceId,
        )

      if (!changed || siteFullscreenBounds) return

      scheduleStackBrowsingChromeAboveBrowser(
        activeTabId,
      )
    })()
      .catch((error) => {
        void writeTransitionLog(
          'browser.bounds.resize-callback',
          'error',
          {
            traceId,
            label: webview.label,
            ...transitionErrorDetails(error),
          },
        )
      })
  }, LAYOUT_DEBOUNCE_MS)

  await syncBrowserBounds(
    webview,
    traceId,
  )

  const appWindow = getCurrentWindow()

  resizeUnlisten = await traceTransitionCall(
    traceId,
    'browser.bounds.listen-resized',
    { label: webview.label },
    () =>
      appWindow.onResized(
        onLayoutChange,
      ),
  )

  scaleUnlisten = await traceTransitionCall(
    traceId,
    'browser.bounds.listen-scale-changed',
    { label: webview.label },
    () =>
      appWindow.onScaleChanged(
        onLayoutChange,
      ),
  )
}

async function waitForWebviewCreated(
  webview: Webview,
): Promise<void> {
  await new Promise<void>(
    (resolve, reject) => {
      let settled = false

      const finish = (
        error?: unknown,
      ) => {
        if (settled) return

        settled = true
        window.clearTimeout(timeout)

        if (error === undefined) {
          resolve()
        } else {
          reject(error)
        }
      }

      const timeout =
        window.setTimeout(
          () =>
            finish(
              new Error(
                `browser webview create timeout: ${webview.label}`,
              ),
            ),
          WEBVIEW_CREATE_TIMEOUT_MS,
        )

      void webview.once(
        'tauri://created',
        () => finish(),
      )

      void webview.once(
        'tauri://error',
        (event) =>
          finish(event),
      )
    },
  )
}

async function configureTabWebview(
  label: string,
  traceId: string,
): Promise<void> {
  await ensureNavigationPerformanceListener()

  if (!configuredWebviews.has(label)) {
    await traceTransitionCall(
      traceId,
      'browser.webview.configure-integrations',
      { label },
      () =>
        invoke(
          'webview_setup_tab_error_pages',
          { label },
        ),
    )

    await traceTransitionCall(
      traceId,
      'browser.webview.apply-browser-identity',
      { label },
      () =>
        invoke(
          'webview_apply_browser_identity',
          { label },
        ),
    )

    configuredWebviews.add(label)
  }

  await traceTransitionCall(
    traceId,
    'browser.webview.apply-privacy',
    {
      label,
      privacyRevision,
    },
    () =>
      applyPrivacyToLabel(label),
  )
}

function scheduleNextBrowseWebviewPrewarm(): void {
  if (nextPrewarmTimer !== null) return

  nextPrewarmTimer =
    window.setTimeout(
      () => {
        nextPrewarmTimer = null

        void prewarmBrowseWebview().catch(
          (error) => {
            void writeTransitionLog(
              'browser.prewarm.scheduled',
              'error',
              transitionErrorDetails(
                error,
              ),
            )
          },
        )
      },
      NEXT_PREWARM_DELAY_MS,
    )
}

export async function prewarmBrowseWebview(): Promise<void> {
  if (
    !isTauri ||
    prewarmedWebview ||
    prewarmPromise
  ) {
    return
  }

  const traceId =
    `prewarm-${Date.now()}-${prewarmSequence + 1}`
  const generation = prewarmGeneration
  const privateMode = privacyOptions.privateMode

  prewarmPromise = (async () => {
    await traceTransitionCall(
      traceId,
      'browser.prewarm.ensure-ublock',
      { label: 'main' },
      () =>
        ensureUblockProfile(
          'main',
        ),
    )

    const label =
      `${PREWARMED_TAB_PREFIX}${++prewarmSequence}`

    const appWindow =
      getCurrentWindow()

    const options:
      ExtensionWebviewOptions = {
      url: 'about:blank',
      x: -10_000,
      y: -10_000,
      width: 1,
      height: 1,
      focus: false,
      dragDropEnabled:
        false,
      incognito:
        privateMode,
      browserExtensionsEnabled:
        true,
    }

    const webview =
      await traceTransitionCall(
        traceId,
        'browser.prewarm.construct',
        { label },
        async () =>
          new Webview(
            appWindow,
            label,
            options,
          ),
      )

    try {
      await traceTransitionCall(
        traceId,
        'browser.prewarm.wait-created',
        { label },
        () =>
          waitForWebviewCreated(
            webview,
          ),
      )

      await configureTabWebview(
        label,
        traceId,
      )

      await traceTransitionCall(
        traceId,
        'browser.prewarm.hide',
        { label },
        () =>
          webview.hide(),
      )

      if (
        !prewarmCreationIsCurrent(
          generation,
          prewarmGeneration,
          privateMode,
          privacyOptions.privateMode,
        )
      ) {
        configuredWebviews.delete(label)
        privacyApplyRunner.invalidate(label)
        await traceTransitionCall(
          traceId,
          'browser.prewarm.discard-stale-profile',
          { label, privateMode },
          () => destroyTabWebview(label),
        )
        return
      }

      prewarmedWebview =
        webview
      prewarmedPrivateMode =
        privateMode

      await writeTransitionLog(
        'browser.prewarm.ready',
        'ok',
        {
          traceId,
          label,
        },
      )
    } catch (error) {
      if (
        prewarmedWebview?.label ===
        label
      ) {
        prewarmedWebview = null
        prewarmedPrivateMode = null
      }
      configuredWebviews.delete(
        label,
      )

      privacyApplyRunner.invalidate(label)

      try {
        await traceTransitionCall(
          traceId,
          'browser.prewarm.close-after-error',
          { label },
          () =>
            webview.close(),
        )
      } catch {
        // ignore
      }

      throw error
    }
  })().finally(() => {
    prewarmPromise = null
  })

  await prewarmPromise
}

function cancelTabSleep(
  label: string,
): void {
  const timer =
    tabSleepTimers.get(label)

  if (timer === undefined) return

  window.clearTimeout(timer)
  tabSleepTimers.delete(label)
}

function cancelTabUnload(
  shortcutId: string,
): void {
  const timer =
    tabUnloadTimers.get(
      shortcutId,
    )

  if (timer === undefined) return

  window.clearTimeout(timer)
  tabUnloadTimers.delete(
    shortcutId,
  )
}

function clamp(
  value: number,
  min: number,
  max: number,
): number {
  return Math.min(
    max,
    Math.max(min, value),
  )
}

function lerp(
  start: number,
  end: number,
  amount: number,
): number {
  return (
    start +
    (end - start) * amount
  )
}

function memoryPressureAggressiveness(
  percent =
    systemMemoryPressurePercent,
): number {
  return clamp(
    (
      percent -
      MEMORY_PRESSURE_MIN_PERCENT
    ) /
      (
        MEMORY_PRESSURE_MAX_PERCENT -
        MEMORY_PRESSURE_MIN_PERCENT
      ),
    0,
    1,
  )
}

function dynamicSleepThresholdMs(
  percent =
    systemMemoryPressurePercent,
): number {
  return Math.round(
    lerp(
      TAB_SLEEP_DELAY_RELAXED_MS,
      TAB_SLEEP_DELAY_PRESSURED_MS,
      memoryPressureAggressiveness(
        percent,
      ),
    ),
  )
}

function dynamicUnloadThresholdMs(
  percent =
    systemMemoryPressurePercent,
): number {
  return Math.round(
    lerp(
      TAB_UNLOAD_DELAY_RELAXED_MS,
      TAB_UNLOAD_DELAY_PRESSURED_MS,
      memoryPressureAggressiveness(
        percent,
      ),
    ),
  )
}

function inactiveForMs(
  shortcutId: string,
): number {
  return Math.max(
    0,
    Date.now() -
      (
        tabLastActiveAt.get(
          shortcutId,
        ) ??
        Date.now()
      ),
  )
}

function rescheduleInactiveTabsForMemoryPressure(): void {
  for (
    const [
      shortcutId,
      webview,
    ] of webviewCache.entries()
  ) {
    if (
      shortcutId ===
        activeTabId ||
      tabActivationRequests.has(
        shortcutId,
      )
    ) {
      continue
    }

    scheduleTabSleep(
      webview,
    )

    scheduleTabUnload(
      webview,
    )
  }
}

async function refreshSystemMemoryPressure(): Promise<void> {
  if (
    memoryPressurePollInFlight
  ) {
    return memoryPressurePollInFlight
  }

  memoryPressurePollInFlight =
    (async () => {
      try {
        const next =
          await invoke<number>(
            'get_system_memory_pressure',
          )

        if (
          !Number.isFinite(
            next,
          )
        ) {
          return
        }

        const normalized =
          clamp(
            Math.round(
              next,
            ),
            0,
            100,
          )

        const changed =
          normalized !==
          systemMemoryPressurePercent

        systemMemoryPressurePercent =
          normalized

        if (changed) {
          rescheduleInactiveTabsForMemoryPressure()
        }
      } catch {
        // keep last value
      }
    })().finally(() => {
      memoryPressurePollInFlight =
        null
    })

  return memoryPressurePollInFlight
}

function ensureMemoryPressureMonitor(): void {
  if (
    memoryPressurePollTimer !==
    null
  ) {
    return
  }

  void refreshSystemMemoryPressure()

  memoryPressurePollTimer =
    window.setInterval(
      () => {
        void refreshSystemMemoryPressure()
      },
      MEMORY_PRESSURE_POLL_MS,
    )
}

function stopMemoryPressureMonitorIfIdle(): void {
  if (
    tabSleepTimers.size > 0 ||
    tabUnloadTimers.size > 0 ||
    tabUnloadInFlight.size > 0
  ) {
    return
  }

  if (memoryPressurePollTimer !== null) {
    window.clearInterval(memoryPressurePollTimer)
    memoryPressurePollTimer = null
  }
}

function parseExecutedJson<T>(
  raw: string | null,
): T | null {
  if (!raw?.trim()) return null

  try {
    const unwrapped =
      JSON.parse(raw) as unknown

    return (
      typeof unwrapped ===
      'string'
        ? JSON.parse(
            unwrapped,
          )
        : unwrapped
    ) as T
  } catch {
    return null
  }
}

async function probeTabBeforeUnload(
  shortcutId: string,
  webview: Webview,
): Promise<{
  state:
    | UnloadedTabState
    | null
  blockedReason:
    | string
    | null
}> {
  try {
    await invoke(
      'webview_set_suspended',
      {
        label:
          webview.label,
        suspended:
          false,
      },
    )
  } catch {
    // continue
  }

  suspendedWebviews.delete(
    webview.label,
  )

  const script = `(() => {
    const dirtyControl = (element) => {
      if (element instanceof HTMLInputElement) {
        if (element.type === 'checkbox' || element.type === 'radio') {
          return element.checked !== element.defaultChecked;
        }
        if (element.type === 'file') return Boolean(element.files && element.files.length);
        return element.value !== element.defaultValue;
      }
      if (element instanceof HTMLTextAreaElement) return element.value !== element.defaultValue;
      if (element instanceof HTMLSelectElement) {
        return Array.from(element.options).some((option) => option.selected !== option.defaultSelected);
      }
      return false;
    };
    const dirtyForm = Array.from(document.querySelectorAll('input,textarea,select')).some(dirtyControl);
    const dirtyEditable = Array.from(document.querySelectorAll('[contenteditable=""],[contenteditable="true"],[contenteditable="plaintext-only"]'))
      .some((element) => Boolean((element.textContent || '').trim()));
    return JSON.stringify({
      href: location.href,
      title: document.title,
      scrollX: Math.round(window.scrollX || 0),
      scrollY: Math.round(window.scrollY || 0),
      hasDirtyForm: dirtyForm || dirtyEditable,
    });
  })()`

  let raw: string | null =
    null

  try {
    raw =
      await invoke<string>(
        'webview_execute_script',
        {
          label:
            webview.label,
          script,
        },
      )
  } catch {
    return {
      state: null,
      blockedReason:
        'page-state-unavailable',
    }
  }

  const probe =
    parseExecutedJson<PageUnloadProbe>(
      raw,
    )

  if (!probe) {
    return {
      state: null,
      blockedReason:
        'page-state-unavailable',
    }
  }

  if (probe.hasDirtyForm) {
    return {
      state: null,
      blockedReason:
        'unsaved-form',
    }
  }

  let url =
    probe.href?.trim() ??
    ''

  if (
    !url ||
    url === 'about:blank'
  ) {
    try {
      url =
        await invoke<string>(
          'webview_current_url',
          {
            label:
              webview.label,
          },
        )
    } catch {
      return {
        state: null,
        blockedReason:
          'url-unavailable',
      }
    }
  }

  if (
    !url ||
    url === 'about:blank'
  ) {
    return {
      state: null,
      blockedReason:
        'blank-page',
    }
  }

  const state:
    UnloadedTabState = {
    url,
    title:
      probe.title?.trim() ||
      null,
    scrollX:
      Number.isFinite(
        probe.scrollX,
      )
        ? Math.max(
            0,
            Math.round(
              probe.scrollX ??
                0,
            ),
          )
        : 0,
    scrollY:
      Number.isFinite(
        probe.scrollY,
      )
        ? Math.max(
            0,
            Math.round(
              probe.scrollY ??
                0,
            ),
          )
        : 0,
    capturedAt:
      Date.now(),
  }

  await writeTransitionLog(
    'browser.tab-unload-probe',
    'ok',
    {
      shortcutId,
      label:
        webview.label,
      url:
        state.url,
      scrollX:
        state.scrollX,
      scrollY:
        state.scrollY,
    },
  )

  return {
    state,
    blockedReason: null,
  }
}

async function restoreUnloadedTabState(
  shortcutId: string,
  webview: Webview,
  state: UnloadedTabState,
): Promise<void> {
  const targetX =
    Math.max(
      0,
      state.scrollX,
    )

  const targetY =
    Math.max(
      0,
      state.scrollY,
    )

  let restored =
    targetX === 0 &&
    targetY === 0

  for (
    let attempt = 0;
    !restored &&
    attempt <
      TAB_RESTORE_ATTEMPTS;
    attempt += 1
  ) {
    if (attempt > 0) {
      await new Promise<void>(
        (resolve) =>
          window.setTimeout(
            resolve,
            TAB_RESTORE_RETRY_MS,
          ),
      )
    }

    if (
      activeTabId !==
      shortcutId
    ) {
      break
    }

    const script = `(() => {
      if (document.readyState === 'loading') return false;
      const x = ${targetX};
      const y = ${targetY};
      window.scrollTo(x, y);
      return Math.abs(window.scrollX - x) < 4 && Math.abs(window.scrollY - y) < 4;
    })()`

    try {
      const raw =
        await invoke<string>(
          'webview_execute_script',
          {
            label:
              webview.label,
            script,
          },
        )

      const parsed =
        parseExecutedJson<boolean>(
          raw,
        )

      restored =
        parsed === true
    } catch {
      // retry
    }
  }

  unloadedTabStates.delete(
    shortcutId,
  )

  await writeTransitionLog(
    'browser.tab-restore',
    restored
      ? 'ok'
      : 'info',
    {
      shortcutId,
      label:
        webview.label,
      url:
        state.url,
      scrollX:
        targetX,
      scrollY:
        targetY,
      restored,
      dormantMs:
        Date.now() -
        state.capturedAt,
    },
  )
}

function hostMatches(
  hostname: string,
  candidate: string,
): boolean {
  const host =
    hostname.toLowerCase()

  const normalized =
    candidate
      .trim()
      .toLowerCase()
      .replace(
        /^https?:\/\//,
        '',
      )
      .replace(
        /^\*\./,
        '',
      )
      .split('/')[0]
      .split(':')[0]

  if (!normalized) {
    return false
  }

  return (
    host === normalized ||
    host.endsWith(
      `.${normalized}`,
    )
  )
}

async function backgroundKeepAliveReason(
  label: string,
): Promise<string | null> {
  try {
    if (
      await invoke<boolean>(
        'webview_is_playing_audio',
        { label },
      )
    ) {
      return 'audio'
    }
  } catch {
    return 'audio-state-unavailable'
  }

  let url: string

  try {
    url =
      await invoke<string>(
        'webview_current_url',
        { label },
      )
  } catch {
    return null
  }

  try {
    const hostname =
      new URL(
        url,
      ).hostname.toLowerCase()

    if (
      BACKGROUND_ACTIVE_HOSTS.some(
        (host) =>
          hostMatches(
            hostname,
            host,
          ),
      )
    ) {
      return 'realtime-site'
    }

    if (
      privacyOptions.siteNotifications &&
      privacyOptions.notificationAllowedSites.some(
        (site) =>
          hostMatches(
            hostname,
            site,
          ),
      )
    ) {
      return 'notifications'
    }
  } catch {
    // ignore
  }

  return null
}

async function setLowMemoryFallback(
  webview: Webview,
): Promise<void> {
  if (
    lowMemoryWebviews.has(
      webview.label,
    )
  ) {
    return
  }

  try {
    await invoke(
      'webview_set_memory_usage',
      {
        label:
          webview.label,
        low:
          true,
      },
    )

    lowMemoryWebviews.add(
      webview.label,
    )
  } catch {
    // ignore
  }
}

function scheduleTabSleep(
  webview: Webview,
  delayMs?: number,
): void {
  cancelTabSleep(
    webview.label,
  )

  const label =
    webview.label

  if (
    suspendedWebviews.has(
      label,
    ) &&
    delayMs === undefined
  ) {
    return
  }

  const shortcutId =
    shortcutIdForTabWebviewLabel(
      label,
    )

  if (!shortcutId) {
    return
  }

  ensureMemoryPressureMonitor()

  const thresholdMs =
    dynamicSleepThresholdMs()

  const remainingMs =
    Math.max(
      MIN_DYNAMIC_TIMER_MS,
      thresholdMs -
        inactiveForMs(
          shortcutId,
        ),
    )

  const effectiveDelayMs =
    delayMs ??
    remainingMs

  const timer =
    window.setTimeout(
      () => {
        tabSleepTimers.delete(
          label,
        )

        if (
          activeWebview?.label ===
          label
        ) {
          return
        }

        void (async () => {
          const keepAliveReason =
            await backgroundKeepAliveReason(
              label,
            )

          if (
            activeWebview?.label ===
            label
          ) {
            return
          }

          if (
            keepAliveReason
          ) {
            suspendedWebviews.delete(
              label,
            )

            await setLowMemoryFallback(
              webview,
            )

            await writeTransitionLog(
              'browser.tab-sleep',
              'info',
              {
                label,
                suspended:
                  false,
                keepAliveReason,
                memoryPressurePercent:
                  systemMemoryPressurePercent,
                thresholdMs,
              },
            )

            if (
              activeWebview?.label !==
              label
            ) {
              scheduleTabSleep(
                webview,
                TAB_SLEEP_RETRY_MS,
              )
            }

            return
          }

          try {
            const suspended =
              await invoke<boolean>(
                'webview_set_suspended',
                {
                  label,
                  suspended:
                    true,
                },
              )

            if (suspended) {
              lowMemoryWebviews.delete(
                label,
              )

              suspendedWebviews.add(
                label,
              )

              await writeTransitionLog(
                'browser.tab-sleep',
                'ok',
                {
                  label,
                  suspended:
                    true,
                  memoryPressurePercent:
                    systemMemoryPressurePercent,
                  thresholdMs,
                },
              )

              return
            }

            suspendedWebviews.delete(
              label,
            )

            await setLowMemoryFallback(
              webview,
            )

            await writeTransitionLog(
              'browser.tab-sleep',
              'info',
              {
                label,
                suspended:
                  false,
                memoryPressurePercent:
                  systemMemoryPressurePercent,
                thresholdMs,
              },
            )
          } catch (error) {
            suspendedWebviews.delete(
              label,
            )

            await setLowMemoryFallback(
              webview,
            )

            await writeTransitionLog(
              'browser.tab-sleep',
              'info',
              {
                label,
                suspended:
                  false,
                ...transitionErrorDetails(
                  error,
                ),
              },
            )
          }
        })()
      },
      effectiveDelayMs,
    )

  tabSleepTimers.set(
    label,
    timer,
  )
}

async function unloadTabIfInactive(
  shortcutId: string,
  webview: Webview,
): Promise<void> {
  if (
    activeTabId ===
      shortcutId ||
    tabActivationRequests.has(
      shortcutId,
    )
  ) {
    return
  }

  if (
    webviewCache.get(
      shortcutId,
    )?.label !==
    webview.label
  ) {
    return
  }

  const keepAliveReason =
    await backgroundKeepAliveReason(
      webview.label,
    )

  if (
    activeTabId ===
      shortcutId ||
    tabActivationRequests.has(
      shortcutId,
    )
  ) {
    return
  }

  if (keepAliveReason) {
    await setLowMemoryFallback(
      webview,
    )

    await writeTransitionLog(
      'browser.tab-unload',
      'info',
      {
        shortcutId,
        label:
          webview.label,
        unloaded:
          false,
        keepAliveReason,
      },
    )

    scheduleTabUnload(
      webview,
      TAB_UNLOAD_RETRY_MS,
    )

    return
  }

  const {
    state,
    blockedReason,
  } =
    await probeTabBeforeUnload(
      shortcutId,
      webview,
    )

  if (
    activeTabId ===
      shortcutId ||
    tabActivationRequests.has(
      shortcutId,
    )
  ) {
    await restoreWebviewMemory(
      webview,
    )

    return
  }

  if (!state) {
    await writeTransitionLog(
      'browser.tab-unload',
      'info',
      {
        shortcutId,
        label:
          webview.label,
        unloaded:
          false,
        blockedReason:
          blockedReason ??
          'unknown',
      },
    )

    scheduleTabSleep(
      webview,
      TAB_SLEEP_RETRY_MS,
    )

    scheduleTabUnload(
      webview,
      TAB_UNLOAD_RETRY_MS,
    )

    return
  }

  unloadedTabStates.set(
    shortcutId,
    state,
  )

  cancelTabSleep(
    webview.label,
  )

  lowMemoryWebviews.delete(
    webview.label,
  )

  suspendedWebviews.delete(
    webview.label,
  )

  await writeTransitionLog(
    'browser.tab-unload',
    'start',
    {
      shortcutId,
      label:
        webview.label,
      url:
        state.url,
    },
  )

  if (
    activeTabId ===
      shortcutId ||
    tabActivationRequests.has(
      shortcutId,
    )
  ) {
    unloadedTabStates.delete(
      shortcutId,
    )

    await restoreWebviewMemory(
      webview,
    )

    return
  }

  await destroyTabWebview(
    webview.label,
    shortcutId,
  )

  webviewCache.delete(
    shortcutId,
  )

  createdTabs.delete(
    shortcutId,
  )

  tabLastActiveAt.delete(
    shortcutId,
  )

  configuredWebviews.delete(
    webview.label,
  )

  privacyApplyRunner.invalidate(webview.label)

  releaseTabWebviewLabel(
    shortcutId,
  )

  await writeTransitionLog(
    'browser.tab-unload',
    'ok',
    {
      shortcutId,
      label:
        webview.label,
      unloaded:
        true,
      url:
        state.url,
    },
  )
}

function scheduleTabUnload(
  webview: Webview,
  delayMs?: number,
): void {
  const shortcutId =
    shortcutIdForTabWebviewLabel(
      webview.label,
    )

  if (
    !shortcutId ||
    webviewCache.get(
      shortcutId,
    )?.label !==
      webview.label
  ) {
    return
  }

  ensureMemoryPressureMonitor()

  const thresholdMs =
    dynamicUnloadThresholdMs()

  const remainingMs =
    Math.max(
      MIN_DYNAMIC_TIMER_MS,
      thresholdMs -
        inactiveForMs(
          shortcutId,
        ),
    )

  const effectiveDelayMs =
    delayMs ??
    remainingMs

  cancelTabUnload(
    shortcutId,
  )

  const timer =
    window.setTimeout(
      () => {
        tabUnloadTimers.delete(
          shortcutId,
        )

        if (
          activeTabId ===
            shortcutId ||
          tabActivationRequests.has(
            shortcutId,
          )
        ) {
          return
        }

        const task =
          tabLifecycleQueue
            .run(
              shortcutId,
              async (lease) => {
                if (!lease.isCurrent()) return
                await unloadTabIfInactive(
                  shortcutId,
                  webview,
                )
              },
            )
            .catch(
              (error) => {
                void writeTransitionLog(
                  'browser.tab-unload',
                  'error',
                  {
                    shortcutId,
                    label:
                      webview.label,
                    ...transitionErrorDetails(
                      error,
                    ),
                  },
                )

                if (
                  activeTabId !==
                    shortcutId &&
                  !tabActivationRequests.has(
                    shortcutId,
                  )
                ) {
                  scheduleTabUnload(
                    webview,
                    TAB_UNLOAD_RETRY_MS,
                  )
                }
              },
            )
            .finally(() => {
              if (
                tabUnloadInFlight.get(
                  shortcutId,
                ) === task
              ) {
                tabUnloadInFlight.delete(
                  shortcutId,
                )
              }

              stopMemoryPressureMonitorIfIdle()
            })

        tabUnloadInFlight.set(
          shortcutId,
          task,
        )
      },
      effectiveDelayMs,
    )

  tabUnloadTimers.set(
    shortcutId,
    timer,
  )
}

async function hideWebviewSafe(
  webview: Webview,
): Promise<void> {
  try {
    await webview.hide()
  } catch {
    // already hidden/destroyed
  }

  const shortcutId =
    shortcutIdForTabWebviewLabel(
      webview.label,
    )

  if (
    shortcutId &&
    !tabLastActiveAt.has(
      shortcutId,
    )
  ) {
    tabLastActiveAt.set(
      shortcutId,
      Date.now(),
    )
  }

  ensureMemoryPressureMonitor()

  scheduleTabSleep(
    webview,
  )

  scheduleTabUnload(
    webview,
  )
}

async function restoreWebviewMemory(
  webview: Webview,
): Promise<void> {
  cancelTabSleep(
    webview.label,
  )

  const shortcutId =
    shortcutIdForTabWebviewLabel(
      webview.label,
    )

  if (shortcutId) {
    cancelTabUnload(
      shortcutId,
    )
  }

  stopMemoryPressureMonitorIfIdle()

  try {
    await invoke(
      'webview_set_suspended',
      {
        label:
          webview.label,
        suspended:
          false,
      },
    )
  } catch {
    // ignore
  }

  suspendedWebviews.delete(
    webview.label,
  )

  if (
    !lowMemoryWebviews.has(
      webview.label,
    )
  ) {
    return
  }

  try {
    await invoke(
      'webview_set_memory_usage',
      {
        label:
          webview.label,
        low:
          false,
      },
    )

    lowMemoryWebviews.delete(
      webview.label,
    )
  } catch {
    // best effort
  }
}

async function getOrCreateTabWebview(
  shortcutId: string,
  initialUrl: string,
  forceNavigate = false,
  traceId: string,
): Promise<Webview> {
  let label =
    tabWebviewLabel(
      shortcutId,
    )

  await writeTransitionLog(
    'browser.webview.resolve',
    'start',
    {
      traceId,
      shortcutId,
      label,
      cached:
        webviewCache.has(
          shortcutId,
        ),
      forceNavigate,
      initialUrl,
    },
  )

  let webview =
    webviewCache.get(
      shortcutId,
    ) ??
    (
      await traceTransitionCall(
        traceId,
        'browser.webview.get-by-label',
        {
          shortcutId,
          label,
        },
        () =>
          Webview.getByLabel(
            label,
          ),
      )
    )

  if (!webview) {
    if (
      !prewarmedWebview &&
      prewarmPromise
    ) {
      await traceTransitionCall(
        traceId,
        'browser.webview.await-prewarm',
        {
          shortcutId,
          label,
        },
        () =>
          prewarmPromise!.catch(
            () => undefined,
          ),
      )
    }

    if (prewarmedWebview) {
      webview =
        prewarmedWebview
      const adoptedPrivateMode =
        prewarmedPrivateMode

      prewarmedWebview =
        null
      prewarmedPrivateMode =
        null

      assignTabWebviewLabel(
        shortcutId,
        webview.label,
      )

      label =
        webview.label

      lowMemoryWebviews.delete(
        label,
      )

      suspendedWebviews.delete(
        label,
      )

      try {
        if (
          !prewarmProfileMatches(
            adoptedPrivateMode,
            privacyOptions.privateMode,
          )
        ) {
          throw new Error(
            'prewarmed WebView profile no longer matches private mode',
          )
        }

        await traceTransitionCall(
          traceId,
          'browser.webview.adopt.apply-privacy',
          {
            shortcutId,
            label,
          },
          () =>
            applyPrivacyToLabel(
              label,
            ),
        )

        if (
          !prewarmProfileMatches(
            adoptedPrivateMode,
            privacyOptions.privateMode,
          )
        ) {
          throw new Error(
            'private mode changed while adopting the prewarmed WebView',
          )
        }

        if (
          initialUrl &&
          initialUrl !==
            'about:blank'
        ) {
          await traceTransitionCall(
            traceId,
            'browser.webview.adopt.navigate',
            {
              shortcutId,
              label,
              url:
                initialUrl,
            },
            () =>
              invoke(
                'webview_navigate',
                {
                  label,
                  url:
                    initialUrl,
                },
            ),
          )
        }

        if (
          !prewarmProfileMatches(
            adoptedPrivateMode,
            privacyOptions.privateMode,
          )
        ) {
          throw new Error(
            'private mode changed while navigating the prewarmed WebView',
          )
        }

        createdTabs.add(
          shortcutId,
        )

        webviewCache.set(
          shortcutId,
          webview,
        )

        scheduleNextBrowseWebviewPrewarm()

        return webview
      } catch (
        adoptionError
      ) {
        await writeTransitionLog(
          'browser.webview.adopt',
          'error',
          {
            traceId,
            shortcutId,
            label,
            ...transitionErrorDetails(
              adoptionError,
            ),
          },
        )

        if (
          import.meta.env.DEV
        ) {
          console.warn(
            '[nebula] prewarmed tab adoption failed; using a fresh tab',
            adoptionError,
          )
        }

        await traceTransitionCall(
          traceId,
          'browser.webview.adopt.destroy-after-error',
          {
            shortcutId,
            label,
          },
          () =>
            destroyTabWebview(
              label,
              shortcutId,
            ),
        )

        configuredWebviews.delete(
          label,
        )

        privacyApplyRunner.invalidate(label)

        releaseTabWebviewLabel(
          shortcutId,
        )

        label =
          tabWebviewLabel(
            shortcutId,
          )

        webview = null
      }
    }

    lowMemoryWebviews.delete(
      label,
    )

    suspendedWebviews.delete(
      label,
    )

    const appWindow =
      getCurrentWindow()

    /*
     * Fresh child WebViews are intentionally born off-screen. Their real
     * bounds are applied later by bindBrowserResize(), immediately before the
     * activation commit. This prevents WebView2's uninitialised creation
     * surface from ever appearing inside the visible client area.
     */

    await traceTransitionCall(
      traceId,
      'browser.webview.ensure-ublock',
      {
        shortcutId,
        label,
      },
      () =>
        ensureUblockProfile(
          'main',
        ),
    )

    try {
      const webviewOptions:
        ExtensionWebviewOptions = {
        url:
          'about:blank',
        x:
          -10_000,
        y:
          -10_000,
        width:
          1,
        height:
          1,
        focus:
          false,
        dragDropEnabled:
          false,
        incognito:
          privacyOptions.privateMode,
        browserExtensionsEnabled:
          true,
      }

      webview =
        await traceTransitionCall(
          traceId,
          'browser.webview.construct',
          {
            shortcutId,
            label,
          },
          async () =>
            new Webview(
              appWindow,
              label,
              webviewOptions,
            ),
        )

      await traceTransitionCall(
        traceId,
        'browser.webview.wait-created',
        {
          shortcutId,
          label,
        },
        () =>
          waitForWebviewCreated(
            webview!,
          ),
      )

      await traceTransitionCall(
        traceId,
        'browser.webview.hide-after-create',
        {
          shortcutId,
          label,
        },
        () =>
          webview!.hide(),
      )

      await configureTabWebview(
        label,
        traceId,
      )

      if (
        initialUrl &&
        initialUrl !==
          'about:blank'
      ) {
        await traceTransitionCall(
          traceId,
          'browser.webview.navigate',
          {
            shortcutId,
            label,
            url:
              initialUrl,
          },
          () =>
            invoke(
              'webview_navigate',
              {
                label,
                url:
                  initialUrl,
              },
            ),
        )
      }

      createdTabs.add(
        shortcutId,
      )
    } catch (
      extensionError
    ) {
      await writeTransitionLog(
        'browser.webview.primary-create',
        'error',
        {
          traceId,
          shortcutId,
          label,
          ...transitionErrorDetails(
            extensionError,
          ),
        },
      )

      webview =
        await traceTransitionCall(
          traceId,
          'browser.webview.recover-get-by-label',
          {
            shortcutId,
            label,
          },
          () =>
            Webview.getByLabel(
              label,
            ),
        )

      if (!webview) {
        if (
          import.meta.env.DEV
        ) {
          console.warn(
            '[nebula] extension-enabled tab creation failed; retrying safely',
            extensionError,
          )
        }

        const fallbackOptions:
          ExtensionWebviewOptions = {
          url:
            'about:blank',
          x:
            -10_000,
          y:
            -10_000,
          width:
            1,
          height:
            1,
          focus:
            false,
          dragDropEnabled:
            false,
          incognito:
            privacyOptions.privateMode,

          // Safe fallback: retry without browser extensions.
          browserExtensionsEnabled:
            false,
        }

        webview =
          await traceTransitionCall(
            traceId,
            'browser.webview.fallback-construct',
            {
              shortcutId,
              label,
            },
            async () =>
              new Webview(
                appWindow,
                label,
                fallbackOptions,
              ),
          )

        await traceTransitionCall(
          traceId,
          'browser.webview.fallback-wait-created',
          {
            shortcutId,
            label,
          },
          () =>
            waitForWebviewCreated(
              webview!,
            ),
        )

        await traceTransitionCall(
          traceId,
          'browser.webview.fallback-hide-after-create',
          {
            shortcutId,
            label,
          },
          () =>
            webview!.hide(),
        )
      }

      /*
       * The first attempt may have created the native controller before a
       * later setup step failed. A recovered view must obey the same hidden
       * staging rule as a clean fresh creation.
       */
      await traceTransitionCall(
        traceId,
        'browser.webview.recover-hide-before-configure',
        {
          shortcutId,
          label,
        },
        () =>
          webview!.hide(),
      )

      await configureTabWebview(
        label,
        traceId,
      )

      if (
        initialUrl &&
        initialUrl !==
          'about:blank'
      ) {
        await traceTransitionCall(
          traceId,
          'browser.webview.recover-navigate',
          {
            shortcutId,
            label,
            url:
              initialUrl,
          },
          () =>
            invoke(
              'webview_navigate',
              {
                label,
                url:
                  initialUrl,
              },
            ),
        )
      }

      createdTabs.add(
        shortcutId,
      )
    }

    webviewCache.set(
      shortcutId,
      webview,
    )
  } else {
    webviewCache.set(
      shortcutId,
      webview,
    )

    await configureTabWebview(
      label,
      traceId,
    )

    if (forceNavigate) {
      await traceTransitionCall(
        traceId,
        'browser.webview.existing.navigate',
        {
          shortcutId,
          label,
          url:
            initialUrl,
        },
        () =>
          invoke(
            'webview_navigate',
            {
              label,
              url:
                initialUrl,
            },
          ),
      )
    }
  }

  return webview
}

async function hideOtherTabs(
  visibleId: string,
): Promise<void> {
  await Promise.all(
    [
      ...webviewCache.entries(),
    ].map(
      async (
        [
          id,
          webview,
        ],
      ) => {
        if (
          id ===
          visibleId
        ) {
          return
        }

        await hideWebviewSafe(
          webview,
        )
      },
    ),
  )
}

interface ActivateBrowseTabOptions {
  forceNavigate?: boolean
  traceId?: string
  shouldContinue?: () => boolean
  /** Home -> browsing: place the hidden tab below the shell before first show. */
  stageBelowShellBeforeShow?: boolean
}

export async function activateBrowseTab(
  shortcutId: string,
  initialUrl: string,
  options?: ActivateBrowseTabOptions,
): Promise<void> {
  if (!isTauri) return

  cancelTabUnload(shortcutId)
  const callerShouldContinue = options?.shouldContinue ?? (() => true)
  await tabLifecycleQueue.run(shortcutId, async (lease) => {
    await activateBrowseTabQueued(shortcutId, initialUrl, {
      ...options,
      shouldContinue: () => lease.isCurrent() && callerShouldContinue(),
    })
  })
}

async function activateBrowseTabQueued(
  shortcutId: string,
  initialUrl: string,
  options?: ActivateBrowseTabOptions,
): Promise<void> {
  if (!isTauri) return

  const activationStartedAt =
    performance.now()

  const forceNavigate =
    options?.forceNavigate ??
    false

  const traceId =
    options?.traceId ??
    `activation-${Date.now()}-${++activationSequence}`

  const shouldContinue =
    options?.shouldContinue ??
    (() => true)

  const stageBelowShellBeforeShow =
    options?.stageBelowShellBeforeShow ??
    false

  const logSuperseded =
    async (
      stage: string,
      webview?: Webview,
    ): Promise<void> => {
      await writeTransitionLog(
        'browser.activation.superseded',
        'info',
        {
          traceId,
          shortcutId,
          stage,
          label:
            webview?.label,
        },
      )
    }

  cancelTabUnload(
    shortcutId,
  )

  tabActivationRequests.add(
    shortcutId,
  )

  try {
    const inFlightUnload =
      tabUnloadInFlight.get(
        shortcutId,
      )

    if (inFlightUnload) {
      await inFlightUnload.catch(
        () => undefined,
      )
    }

    if (!shouldContinue()) {
      await logSuperseded(
        'after-in-flight-unload',
      )
      return
    }

    const sameActiveTab =
      activeTabId ===
      shortcutId

    const dormantState =
      forceNavigate
        ? null
        : (
            unloadedTabStates.get(
              shortcutId,
            ) ?? null
          )

    if (forceNavigate) {
      unloadedTabStates.delete(
        shortcutId,
      )
    }

    const targetUrl =
      dormantState?.url ??
      initialUrl

    await writeTransitionLog(
      'browser.activation',
      'start',
      {
        traceId,
        shortcutId,
        initialUrl:
          targetUrl,
        forceNavigate,
        sameActiveTab,
        restoredFromUnload:
          Boolean(
            dormantState,
          ),
      },
    )

    const webview =
      await traceTransitionCall(
        traceId,
        'browser.activation.get-or-create',
        {
          shortcutId,
        },
        () =>
          getOrCreateTabWebview(
            shortcutId,
            targetUrl,
            forceNavigate,
            traceId,
          ),
      )

    /*
     * WebView creation/navigation can take long enough for another
     * Ctrl+Tab request to supersede this activation.
     */
    if (!shouldContinue()) {
      await logSuperseded(
        'after-get-or-create',
        webview,
      )
      return
    }

    /*
     * Same tab: there is no outgoing browser surface to replace.
     */
    if (
      sameActiveTab &&
      !forceNavigate
    ) {
      await traceTransitionCall(
        traceId,
        'browser.activation.restore-memory',
        {
          shortcutId,
          label:
            webview.label,
        },
        () =>
          restoreWebviewMemory(
            webview,
          ),
      )

      if (!shouldContinue()) {
        await logSuperseded(
          'same-tab-after-restore-memory',
          webview,
        )
        return
      }

      activeTabId =
        shortcutId

      activeWebview =
        webview

      tabLastActiveAt.set(
        shortcutId,
        Date.now(),
      )

      if (stageBelowShellBeforeShow) {
        /*
         * Home -> browsing hand-off: the shell is still full-screen here.
         * Stage this hidden WebView below it BEFORE making it visible so a
         * newly-created WebView2 surface can never flash above the shell.
         */
        await traceTransitionCall(
          traceId,
          'browser.activation.stage-below-shell',
          {
            shortcutId,
            label: webview.label,
          },
          () =>
            stackBrowsingChromeAboveBrowser(
              shortcutId,
            ),
        )

        if (!shouldContinue()) {
          await logSuperseded(
            'same-tab-after-stage-below-shell',
            webview,
          )
          return
        }
      }

      await traceTransitionCall(
        traceId,
        'browser.activation.show',
        {
          shortcutId,
          label:
            webview.label,
        },
        () =>
          showWebviewForCurrentWindowState(
            webview,
            `${traceId}:show`,
          ),
      )

      /*
       * If this became stale during show(), keep the surface visible.
       * The newest transition will replace it safely.
       */
      if (!shouldContinue()) {
        await logSuperseded(
          'same-tab-after-show',
          webview,
        )
        return
      }

      await traceTransitionCall(
        traceId,
        'browser.activation.stack-chrome',
        {
          shortcutId,
          label:
            webview.label,
        },
        () =>
          stackBrowsingChromeAboveBrowser(
            shortcutId,
          ),
      )

      if (!shouldContinue()) {
        await logSuperseded(
          'same-tab-after-stack',
          webview,
        )
        return
      }

      if (dormantState) {
        await restoreUnloadedTabState(
          shortcutId,
          webview,
          dormantState,
        )
      }

      await writeTransitionLog(
        'browser.activation',
        'ok',
        {
          traceId,
          shortcutId,
          label:
            webview.label,
          durationMs:
            Math.round(
              (
                performance.now() -
                activationStartedAt
              ) *
                10,
            ) /
            10,
        },
      )

      return
    }

    /*
     * Prepare the incoming WebView while the old tab is still visible.
     */
    await traceTransitionCall(
      traceId,
      'browser.activation.bind-resize',
      {
        shortcutId,
        label:
          webview.label,
      },
      () =>
        bindBrowserResize(
          webview,
          traceId,
        ),
    )

    if (!shouldContinue()) {
      await logSuperseded(
        'after-bind-resize',
        webview,
      )
      return
    }

    await traceTransitionCall(
      traceId,
      'browser.activation.restore-memory',
      {
        shortcutId,
        label:
          webview.label,
      },
      () =>
        restoreWebviewMemory(
          webview,
        ),
    )

    if (!shouldContinue()) {
      await logSuperseded(
        'after-restore-memory',
        webview,
      )
      return
    }

    /*
     * Only commit logical active-tab state after all preparation is done.
     */
    const previouslyActiveTabId =
      activeTabId

    if (
      previouslyActiveTabId &&
      previouslyActiveTabId !==
        shortcutId
    ) {
      tabLastActiveAt.set(
        previouslyActiveTabId,
        Date.now(),
      )
    }

    activeTabId =
      shortcutId

    activeWebview =
      webview

    tabLastActiveAt.set(
      shortcutId,
      Date.now(),
    )

    /*
     * Critical anti-flicker ordering:
     *
     *   incoming show
     *       ↓
     *   outgoing tabs hide
     *       ↓
     *   final z-order repair
     *
     * There must never be a frame with zero browser WebViews visible.
     */
    if (stageBelowShellBeforeShow) {
      /*
       * A freshly-created child WebView may become visible above its siblings
       * for one compositor turn. Home still owns the whole client area here,
       * so establish the final z-order while the incoming tab is hidden.
       */
      await traceTransitionCall(
        traceId,
        'browser.activation.stage-below-shell',
        {
          shortcutId,
          label: webview.label,
        },
        () =>
          stackBrowsingChromeAboveBrowser(
            shortcutId,
          ),
      )

      if (!shouldContinue()) {
        await logSuperseded(
          'after-stage-below-shell',
          webview,
        )
        return
      }
    }

    await traceTransitionCall(
      traceId,
      'browser.activation.show',
      {
        shortcutId,
        label:
          webview.label,
      },
      () =>
        showWebviewForCurrentWindowState(
          webview,
          `${traceId}:show`,
        ),
    )

    /*
     * A newer activation may have arrived while show() was in flight.
     * In that case do NOT hide anything. Let the new activation take over.
     */
    if (!shouldContinue()) {
      await logSuperseded(
        'after-show',
        webview,
      )
      return
    }

    await traceTransitionCall(
      traceId,
      'browser.activation.hide-other-tabs',
      {
        shortcutId,
      },
      () =>
        hideOtherTabs(
          shortcutId,
        ),
    )

    if (!shouldContinue()) {
      await logSuperseded(
        'after-hide-other-tabs',
        webview,
      )
      return
    }

    await traceTransitionCall(
      traceId,
      'browser.activation.stack-chrome',
      {
        shortcutId,
        label:
          webview.label,
      },
      () =>
        stackBrowsingChromeAboveBrowser(
          shortcutId,
        ),
    )

    if (!shouldContinue()) {
      await logSuperseded(
        'after-stack-chrome',
        webview,
      )
      return
    }

    if (dormantState) {
      await restoreUnloadedTabState(
        shortcutId,
        webview,
        dormantState,
      )

      if (!shouldContinue()) {
        await logSuperseded(
          'after-restore-unloaded-state',
          webview,
        )
        return
      }
    }

    await writeTransitionLog(
      'browser.activation',
      'ok',
      {
        traceId,
        shortcutId,
        label:
          webview.label,
        durationMs:
          Math.round(
            (
              performance.now() -
              activationStartedAt
            ) *
              10,
          ) /
          10,
      },
    )
  } finally {
    tabActivationRequests.delete(
      shortcutId,
    )
  }
}

/** Create or navigate a tab webview without showing it or browsing chrome. */
export async function prepareBrowseTabInBackground(
  shortcutId: string,
  url: string,
  options?: {
    forceNavigate?: boolean
  },
): Promise<void> {
  if (!isTauri) return

  cancelTabUnload(shortcutId)
  await tabLifecycleQueue.run(shortcutId, async (lease) => {
    await prepareBrowseTabInBackgroundQueued(
      shortcutId,
      url,
      options,
      lease.isCurrent,
    )
  })
}

async function prepareBrowseTabInBackgroundQueued(
  shortcutId: string,
  url: string,
  options: { forceNavigate?: boolean } | undefined,
  isCurrent: () => boolean,
): Promise<void> {
  if (!isTauri) return

  cancelTabUnload(
    shortcutId,
  )

  tabActivationRequests.add(
    shortcutId,
  )

  try {
    const inFlightUnload =
      tabUnloadInFlight.get(
        shortcutId,
      )

    if (inFlightUnload) {
      await inFlightUnload.catch(
        () => undefined,
      )
    }

    if (!isCurrent()) return

    const forceNavigate =
      options?.forceNavigate ??
      true

    if (forceNavigate) {
      unloadedTabStates.delete(
        shortcutId,
      )
    }

    const dormantState =
      forceNavigate
        ? null
        : (
            unloadedTabStates.get(
              shortcutId,
            ) ?? null
          )

    const targetUrl =
      dormantState?.url ??
      url

    const traceId =
      `background-${Date.now()}-${++activationSequence}`

    const webview =
      await getOrCreateTabWebview(
        shortcutId,
        targetUrl,
        forceNavigate,
        traceId,
      )

    if (!isCurrent()) return

    if (
      !tabLastActiveAt.has(
        shortcutId,
      )
    ) {
      tabLastActiveAt.set(
        shortcutId,
        Date.now(),
      )
    }

    await hideWebviewSafe(
      webview,
    )
  } finally {
    tabActivationRequests.delete(
      shortcutId,
    )
  }
}

export async function syncTauriBrowserBounds(): Promise<void> {
  if (
    !isTauri ||
    !activeWebview
  ) {
    return
  }

  const changed =
    await syncBrowserBounds(
      activeWebview,
    )

  if (changed) {
    scheduleStackBrowsingChromeAboveBrowser(
      activeTabId,
    )
  }
}

/** Force tab HWND + Tauri bounds to match the window after layout transitions. */
export async function forceSyncActiveTabBounds(): Promise<void> {
  if (
    !isTauri ||
    !activeWebview
  ) {
    return
  }

  lastBrowserBoundsKey = null

  await syncBrowserBounds(
    activeWebview,
  )

  await stackBrowsingChromeAboveBrowser(
    activeTabId,
  )
}

export async function navigateBrowseTabBack(
  shortcutId: string,
): Promise<boolean> {
  if (!isTauri) {
    return false
  }

  try {
    return await invoke<boolean>(
      'webview_go_back',
      {
        label:
          tabWebviewLabel(
            shortcutId,
          ),
      },
    )
  } catch (error) {
    if (
      import.meta.env.DEV
    ) {
      console.warn(
        '[nebula] webview_go_back failed',
        error,
      )
    }

    return false
  }
}

export async function navigateBrowseTabForward(
  shortcutId: string,
): Promise<boolean> {
  if (!isTauri) {
    return false
  }

  try {
    return await invoke<boolean>(
      'webview_go_forward',
      {
        label:
          tabWebviewLabel(
            shortcutId,
          ),
      },
    )
  } catch (error) {
    if (
      import.meta.env.DEV
    ) {
      console.warn(
        '[nebula] webview_go_forward failed',
        error,
      )
    }

    return false
  }
}

export async function clearSitePermissions(
  shortcutId: string,
  origin: string,
): Promise<void> {
  if (!isTauri) return
  await invoke('webview_clear_site_permissions', {
    label: tabWebviewLabel(shortcutId),
    origin,
  })
}

export async function navigateBrowseTab(
  shortcutId: string,
  url: string,
): Promise<void> {
  if (!isTauri) return
  await invoke('webview_navigate', {
    label: tabWebviewLabel(shortcutId),
    url,
  })
}

export async function reloadBrowseTab(
  shortcutId: string,
): Promise<void> {
  if (!isTauri) return

  try {
    await invoke(
      'webview_reload',
      {
        label:
          tabWebviewLabel(
            shortcutId,
          ),
      },
    )
  } catch (error) {
    if (
      import.meta.env.DEV
    ) {
      console.warn(
        '[nebula] webview_reload failed',
        error,
      )
    }
  }
}

export interface BrowsePrinterInfo {
  name: string
  isDefault: boolean
}

export async function listBrowsePrinters(): Promise<BrowsePrinterInfo[]> {
  if (!isTauri) return []

  try {
    return await invoke<BrowsePrinterInfo[]>(
      'webview_list_printers',
    )
  } catch (error) {
    if (
      import.meta.env.DEV
    ) {
      console.warn(
        '[nebula] webview_list_printers failed',
        error,
      )
    }

    return []
  }
}

export interface BrowsePrintOptions {
  printerName: string
  pageRanges: string
  landscape: boolean
  copies: number
  scale: number
  backgrounds: boolean
  headersAndFooters: boolean
  selectionOnly: boolean
  paperSize: 'a4' | 'letter'
  margins: 'default' | 'minimum' | 'none'
}

export async function renderBrowsePrintPreview(
  label: string,
  options: BrowsePrintOptions,
): Promise<string | null> {
  if (!isTauri) return null

  try {
    return await invoke<string>(
      'webview_print_preview',
      {
        label,
        options,
      },
    )
  } catch (error) {
    if (
      import.meta.env.DEV
    ) {
      console.warn(
        '[nebula] print preview capture failed',
        error,
      )
    }

    return null
  }
}

export async function printBrowseTab(
  shortcutId: string,
  options: BrowsePrintOptions,
): Promise<void> {
  return printBrowseWebview(
    tabWebviewLabel(shortcutId),
    options,
  )
}

export async function printBrowseWebview(
  label: string,
  options: BrowsePrintOptions,
): Promise<void> {
  if (!isTauri) return

  try {
    await invoke(
      'webview_print',
      {
        label,
        options,
      },
    )
  } catch (error) {
    if (
      import.meta.env.DEV
    ) {
      console.warn(
        '[nebula] webview_print failed',
        error,
      )
    }

    throw error
  }
}

export async function zoomBrowseTab(
  shortcutId: string,
  action:
    | 'in'
    | 'out'
    | 'reset',
): Promise<number> {
  if (!isTauri) return 1

  try {
    return await invoke<number>(
      'webview_zoom',
      {
        label:
          tabWebviewLabel(
            shortcutId,
          ),
        action,
      },
    )
  } catch (error) {
    if (
      import.meta.env.DEV
    ) {
      console.warn(
        '[nebula] webview_zoom failed',
        error,
      )
    }

    return 1
  }
}

export async function setBrowseTabZoom(
  shortcutId: string,
  factor: number,
): Promise<number> {
  if (!isTauri) return factor

  try {
    return await invoke<number>(
      'webview_set_zoom',
      {
        label: tabWebviewLabel(shortcutId),
        factor,
      },
    )
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[nebula] webview_set_zoom failed', error)
    }
    throw error
  }
}

export async function openBrowseTabDevTools(
  shortcutId: string,
): Promise<void> {
  if (!isTauri) return

  try {
    await invoke(
      'webview_open_devtools',
      {
        label:
          tabWebviewLabel(
            shortcutId,
          ),
      },
    )
  } catch (error) {
    if (
      import.meta.env.DEV
    ) {
      console.warn(
        '[nebula] webview_open_devtools failed',
        error,
      )
    }
  }
}

export async function setBrowseTabMuted(
  shortcutId: string,
  muted: boolean,
): Promise<void> {
  if (!isTauri) return

  await invoke('webview_set_muted', {
    label: tabWebviewLabel(shortcutId),
    muted,
  })
}

export async function hideAllBrowseTabs(): Promise<void> {
  if (!isTauri) return

  unbindResizeListeners()

  if (activeTabId) {
    tabLastActiveAt.set(
      activeTabId,
      Date.now(),
    )
  }

  activeWebview = null
  activeTabId = null
  lastBrowserBoundsKey = null

  await Promise.all(
    [
      ...webviewCache.values(),
    ].map(
      (webview) =>
        hideWebviewSafe(
          webview,
        ),
    ),
  )

  try {
    const all =
      await Webview.getAll()

    const spareLabel =
      prewarmedWebview?.label

    await Promise.all(
      all
        .filter(
          (webview) =>
            webview.label !==
              spareLabel &&
            webview.label.startsWith(
              'nebula-tab-',
            ),
        )
        .map(
          (webview) =>
            hideWebviewSafe(
              webview,
            ),
        ),
    )
  } catch {
    // ignore
  }
}

async function resolveTabWebview(
  shortcutId: string,
): Promise<Webview | null> {
  const label =
    tabWebviewLabel(
      shortcutId,
    )

  const cached =
    webviewCache.get(
      shortcutId,
    )

  if (cached) {
    return cached
  }

  try {
    const byLabel =
      await Webview.getByLabel(
        label,
      )

    if (byLabel) {
      return byLabel
    }
  } catch {
    // continue
  }

  try {
    const all =
      await Webview.getAll()

    return (
      all.find(
        (webview) =>
          webview.label ===
          label,
      ) ??
      null
    )
  } catch {
    return null
  }
}

async function destroyTabWebview(
  label: string,
  shortcutId?: string,
): Promise<void> {
  try {
    await invoke(
      'webview_close_tab',
      { label },
    )

    return
  } catch (error) {
    if (
      import.meta.env.DEV
    ) {
      console.warn(
        `[nebula] webview_close_tab ${label} failed`,
        error,
      )
    }
  }

  const resolvedShortcutId =
    shortcutId ??
    shortcutIdForTabWebviewLabel(
      label,
    ) ??
    label

  const webview =
    await resolveTabWebview(
      resolvedShortcutId,
    )

  if (!webview) {
    return
  }

  try {
    await invoke(
      'webview_navigate',
      {
        label,
        url:
          'about:blank',
      },
    )
  } catch {
    // continue
  }

  try {
    await webview.hide()
  } catch {
    // already hidden
  }

  try {
    await webview.close()
  } catch (
    fallbackError
  ) {
    if (
      import.meta.env.DEV
    ) {
      console.warn(
        `[nebula] JS fallback close ${label} failed`,
        fallbackError,
      )
    }
  }
}

export async function closeBrowseTab(
  shortcutId: string,
): Promise<void> {
  if (!isTauri) return

  tabLifecycleQueue.invalidate(shortcutId)
  cancelTabUnload(shortcutId)
  await tabLifecycleQueue.run(shortcutId, async () => {
    await closeBrowseTabQueued(shortcutId)
  })
  await tabLifecycleQueue.releaseWhenIdle(shortcutId)
}

async function closeBrowseTabQueued(
  shortcutId: string,
): Promise<void> {
  if (!isTauri) return

  cancelTabUnload(
    shortcutId,
  )

  const inFlightUnload =
    tabUnloadInFlight.get(
      shortcutId,
    )

  if (inFlightUnload) {
    await inFlightUnload.catch(
      () => undefined,
    )
  }

  unloadedTabStates.delete(
    shortcutId,
  )

  const label =
    tabWebviewLabel(
      shortcutId,
    )

  cancelTabSleep(
    label,
  )

  await destroyTabWebview(
    label,
    shortcutId,
  )

  webviewCache.delete(
    shortcutId,
  )

  createdTabs.delete(
    shortcutId,
  )

  lowMemoryWebviews.delete(
    label,
  )

  suspendedWebviews.delete(
    label,
  )

  tabLastActiveAt.delete(
    shortcutId,
  )

  configuredWebviews.delete(
    label,
  )

  privacyApplyRunner.invalidate(label)

  releaseTabWebviewLabel(
    shortcutId,
  )

  if (
    activeTabId ===
    shortcutId
  ) {
    activeTabId = null
    activeWebview = null

    unbindResizeListeners()

    lastBrowserBoundsKey =
      null
  }

  try {
    const all =
      await Webview.getAll()

    await Promise.all(
      all
        .filter(
          (candidate) =>
            candidate.label ===
            label,
        )
        .map(
          (orphan) =>
            destroyTabWebview(
              orphan.label,
              shortcutId,
            ),
        ),
    )
  } catch {
    // ignore sweep errors
  }

  stopMemoryPressureMonitorIfIdle()
}

export async function syncTabWebviewFullscreenBounds(
  shortcutId: string,
): Promise<void> {
  if (!isTauri) return

  const webview =
    await resolveTabWebview(
      shortcutId,
    )

  if (!webview) {
    return
  }

  const {
    position,
    size,
  } =
    await browserWebviewFullscreenPhysicalBounds()

  await restoreWebviewMemory(
    webview,
  )

  lastBrowserBoundsKey =
    boundsKey(
      position.x,
      position.y,
      size.width,
      size.height,
    )

  await webview.setPosition(
    position,
  )

  await webview.setSize(
    size,
  )

  await webview.setAutoResize(
    false,
  )

  await showWebviewForCurrentWindowState(
    webview,
    'browser.fullscreen.show',
  )

  await invoke(
    'webview_raise_tab_fullscreen',
    {
      label:
        tabWebviewLabel(
          shortcutId,
        ),
    },
  )
}

export function getActiveBrowseTabId(): string | null {
  return activeTabId
}
