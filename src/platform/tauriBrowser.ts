import { invoke } from '@tauri-apps/api/core'
import { PhysicalSize, type PhysicalPosition } from '@tauri-apps/api/dpi'
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
import { createCoalescedRestoreRepair, hasUsableWindowClientSize, restoreBrowsingSurfaces } from '../core/mainWebviewRestore'
import { createLayoutAuditor, findLayoutFaults, type LayoutAudit } from '../core/layoutAudit'
import { allSettledOrThrow, LatestPerKeyRunner } from '../core/latestPerKey'
import {
  prewarmCreationIsCurrent,
  prewarmProfileMatches,
  shouldKeepPrewarmedWebview,
} from '../core/prewarmProfile'
import { debounce } from './debounce'
import { SEMI_LUNAR_HIT_ZONE_HEIGHT } from '../core/windowChrome'
import { normalizePageFavicon } from '../core/pageFavicon'
import { isTauri } from './runtime'
import {
  currentBrowserWindowId,
  currentBrowserWindowLabel,
  currentChromeWebviewLabel,
} from './browserWindowScope'
import {
  traceTransitionCall,
  transitionErrorDetails,
  writeTransitionLog,
} from './tauriTransitionLog'
import {
  cancelScheduledStack,
  isBrowsingChromeExpected,
  scheduleStackBrowsingChromeAboveBrowser,
  stackBrowsingChromeAboveBrowser,
} from './tauriWebviewStack'
import { waitForTauriCreated } from './tauriCreationWait'
import {
  browserWebviewFullscreenPhysicalBounds,
  browserWebviewPhysicalBounds,
} from './windowClientBounds'

// Native wait is 15 s (UBLOCK_READY_TIMEOUT); this one only covers the IPC round trip
// on top of it, so a hung host cannot hold tab creation forever.
const UBLOCK_READY_TIMEOUT_MS = 18_000
const LAYOUT_DEBOUNCE_MS = 120
const WEBVIEW_CREATE_TIMEOUT_MS = 15_000
const INITIAL_PREWARM_DELAY_MS = 5_000
const NEXT_PREWARM_DELAY_MS = 1_500
const PREWARM_ADOPTION_GRACE_MS = 120
const MEMORY_PRESSURE_POLL_MS = 15_000
const MEMORY_PRESSURE_MIN_PERCENT = 45
const MEMORY_PRESSURE_MAX_PERCENT = 95
const TAB_SLEEP_DELAY_RELAXED_MS = 90_000
const TAB_SLEEP_DELAY_PRESSURED_MS = 30_000
const TAB_SLEEP_RETRY_MS = 60_000
const TAB_UNLOAD_DELAY_RELAXED_MS = 20 * 60_000
const TAB_UNLOAD_DELAY_PRESSURED_MS = 5 * 60_000
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

/** Asks the host whether uBO Lite's background has finished starting. The host reads it
 * from the extension's own worker in the browser profile, so it does not depend on the
 * shell's page or on which environment the shell runs in. Bounded: failing to confirm
 * only loses the "rules are in place before the first page" guarantee. */
async function waitForUblockRules(): Promise<void> {
  try {
    await Promise.race([
      invoke<boolean>('ublock_extension_ready'),
      new Promise<void>((resolve) => window.setTimeout(resolve, UBLOCK_READY_TIMEOUT_MS)),
    ])
  } catch {
    // Not ready is not an error for the caller; the first navigation still works.
  }
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
  await ensureUblockProfile(currentBrowserWindowLabel())
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

export interface BrowserForceDarkOptions {
  mode: 'off' | 'auto' | 'always'
  theme: 'forest' | 'dark' | 'light'
  systemDark: boolean
  siteOverrides: Record<string, 'off' | 'always'>
}

let forceDarkOptions: BrowserForceDarkOptions = {
  mode: 'off',
  theme: 'forest',
  systemDark: false,
  siteOverrides: {},
}

let forceDarkRevision = 0

const forceDarkApplyRunner = new LatestPerKeyRunner(
  () => ({
    revision: forceDarkRevision,
    value: {
      ...forceDarkOptions,
      siteOverrides: { ...forceDarkOptions.siteOverrides },
    },
  }),
  async (label: string, options) => {
    await invoke('webview_apply_force_dark_pages', { label, options })
  },
)

async function applyForceDarkToLabel(label: string): Promise<void> {
  await forceDarkApplyRunner.run(label)
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
const tabPrivacyModes = new Map<string, boolean>()

export function registerBrowseTabPrivateMode(shortcutId: string, isPrivate: boolean): boolean {
  if (!tabPrivacyModes.has(shortcutId)) tabPrivacyModes.set(shortcutId, isPrivate)
  return tabPrivacyModes.get(shortcutId)!
}

export function browseTabIsPrivate(shortcutId: string): boolean {
  return tabPrivacyModes.get(shortcutId) ?? privacyOptions.privateMode
}

export function browseWebviewIsPrivate(label: string): boolean {
  const popupMode = popupPrivacyModes.get(label)
  if (popupMode !== undefined) return popupMode
  const id = shortcutIdForTabWebviewLabel(label)
  return id ? browseTabIsPrivate(id) : privacyOptions.privateMode
}

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
      options: {
        ...options,
        privateMode: (() => {
          const id = shortcutIdForTabWebviewLabel(label)
          return id ? browseTabIsPrivate(id) : options.privateMode
        })(),
      },
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

  try {
    await invoke('webview_setup_popup_target', { label })
    await invoke('webview_apply_browser_identity', { label })
    await applyPrivacyToPopupLabel(label, privateMode)
    await applyForceDarkToLabel(label)
    popupPrivacyModes.set(label, privateMode)
  } catch (error) {
    popupPrivacyModes.delete(label)
    forceDarkApplyRunner.invalidate(label)
    await invoke('webview_teardown_popup_target', { label }).catch(() => undefined)
    throw error
  }
}

export async function teardownPopupBrowseWebview(
  label: string,
): Promise<void> {
  popupPrivacyModes.delete(label)
  forceDarkApplyRunner.invalidate(label)
  if (!isTauri) return
  await invoke('webview_teardown_popup_target', { label })
}

export async function setBrowseForceDarkOptions(
  options: BrowserForceDarkOptions,
  shortcutIds: string[],
): Promise<void> {
  if (JSON.stringify(forceDarkOptions) !== JSON.stringify(options)) {
    forceDarkRevision += 1
  }
  forceDarkOptions = {
    ...options,
    siteOverrides: { ...options.siteOverrides },
  }

  if (!isTauri) return

  await allSettledOrThrow(
    [
      ...shortcutIds.map((shortcutId) =>
        applyForceDarkToLabel(tabWebviewLabel(shortcutId)),
      ),
      ...Array.from(popupPrivacyModes.keys(), (label) =>
        applyForceDarkToLabel(label),
      ),
    ],
    'Failed to apply webpage darkening to browser tabs or popup windows',
  )
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

export interface BrowserProfileStorageUsage {
  totalBytes: number
  cacheBytes: number
}

export async function getBrowserProfileStorageUsage(): Promise<BrowserProfileStorageUsage | null> {
  if (!isTauri) return null

  return invoke<BrowserProfileStorageUsage>('webview_profile_storage_usage')
}

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
  favicon?: string | null
  canGoBack?: boolean
  canGoForward?: boolean
}

export interface TabWebviewSnapshot {
  shortcutId: string
  url: string
  title: string | null
  favicon: string | null
  /** WebView2's own answer; absent from an older host. */
  canGoForward?: boolean
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
        favicon: normalizePageFavicon(payload.favicon),
        canGoForward: payload.canGoForward,
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
const deferredInitialNavigations = new Map<string, string>()
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
let unfocusedPrewarmTimer: number | null = null
let prewarmWindowFocused = true
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
    forceDarkApplyRunner.invalidate(ready.label)
    await destroyTabWebview(ready.label)
  }

  if (prewarmPromise) {
    await prewarmPromise.catch(() => undefined)
  }

  scheduleNextBrowseWebviewPrewarm()
}

async function discardPrewarmedWebview(
  reason: 'memory-pressure' | 'inactive-window',
): Promise<void> {
  prewarmGeneration += 1

  if (nextPrewarmTimer !== null) {
    window.clearTimeout(nextPrewarmTimer)
    nextPrewarmTimer = null
  }

  const ready = prewarmedWebview
  prewarmedWebview = null
  prewarmedPrivateMode = null

  if (!ready) return

  configuredWebviews.delete(ready.label)
  privacyApplyRunner.invalidate(ready.label)
  forceDarkApplyRunner.invalidate(ready.label)

  await destroyTabWebview(ready.label)

  await writeTransitionLog(
    reason === 'memory-pressure'
      ? 'browser.prewarm.discard-memory-pressure'
      : 'browser.prewarm.discard-inactive-window',
    'info',
    {
      label: ready.label,
      memoryPressurePercent: systemMemoryPressurePercent,
    },
  )
}

export function setBrowserWindowPrewarmFocused(focused: boolean): void {
  prewarmWindowFocused = focused
  if (unfocusedPrewarmTimer !== null) {
    window.clearTimeout(unfocusedPrewarmTimer)
    unfocusedPrewarmTimer = null
  }
  if (focused) {
    if (!prewarmedWebview && !prewarmPromise) scheduleNextBrowseWebviewPrewarm()
    return
  }
  if (nextPrewarmTimer !== null) {
    window.clearTimeout(nextPrewarmTimer)
    nextPrewarmTimer = null
  }
  unfocusedPrewarmTimer = window.setTimeout(() => {
    unfocusedPrewarmTimer = null
    if (!prewarmWindowFocused) {
      void discardPrewarmedWebview('inactive-window')
    }
  }, 30_000)
}

let resizeUnlisten: (() => void) | null = null
let scaleUnlisten: (() => void) | null = null
let resizeDebounceCancel: (() => void) | null = null
let lastBrowserBoundsKey: string | null = null
const browserAutoResizeDisabledLabels = new Set<string>()
type KnownGoodBrowserBounds = {
  label: string
  windowLabel: string
  x: number
  y: number
  width: number
  height: number
}
let lastKnownGoodBrowserBounds: KnownGoodBrowserBounds | null = null
let siteFullscreenBounds = false
let windowMinimizedWebviewLabel: string | null = null

type RestoreTimingEvent = {
  traceId: string
  sequence: number
  stage: string
  monotonicTsMs: number
  details?: Record<string, unknown>
}

const restoreTimingEventsByTraceId = new Map<string, RestoreTimingEvent[]>()
const restoreTimingSequenceByTraceId = new Map<string, number>()

function isRestoreTimingTrace(traceId: string): boolean {
  return traceId.startsWith('restore-')
}

function recordRestoreTiming(
  traceId: string,
  stage: string,
  details?: Record<string, unknown>,
): void {
  if (!isRestoreTimingTrace(traceId)) return
  const sequence =
    (restoreTimingSequenceByTraceId.get(traceId) ?? 0) + 1
  restoreTimingSequenceByTraceId.set(traceId, sequence)

  const events = restoreTimingEventsByTraceId.get(traceId) ?? []
  events.push({
    traceId,
    sequence,
    stage,
    monotonicTsMs:
      Math.round(performance.now() * 1000) / 1000,
    details,
  })
  restoreTimingEventsByTraceId.set(traceId, events)
}

function flushRestoreTiming(
  traceId: string,
  status: 'ok' | 'error',
): void {
  if (!isRestoreTimingTrace(traceId)) return
  const events = restoreTimingEventsByTraceId.get(traceId)
  restoreTimingEventsByTraceId.delete(traceId)
  restoreTimingSequenceByTraceId.delete(traceId)
  if (!events || events.length === 0) return

  queueMicrotask(() => {
    void writeTransitionLog(
      'browser.restore-repair.timing',
      status === 'error' ? 'error' : 'info',
      {
        traceId,
        eventCount: events.length,
        events,
      },
    )
  })
}

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

async function applyBrowserBounds(
  webview: Webview,
  position: PhysicalPosition,
  size: PhysicalSize,
  traceId = 'background-layout',
): Promise<void> {
  const opId = `${traceId}:${webview.label}:bounds:${Date.now()}`
  recordRestoreTiming(traceId, 'browser.bounds.apply-entry', {
    traceId,
    opId,
    label: webview.label,
    x: position.x,
    y: position.y,
    width: size.width,
    height: size.height,
  })

  try {
    const windowLabel = currentBrowserWindowLabel()
    recordRestoreTiming(traceId, 'browser.bounds.atomic-invoke-start', {
      traceId,
      opId,
      label: webview.label,
      windowLabel,
      x: position.x,
      y: position.y,
      width: size.width,
      height: size.height,
    })
    const atomicInvokeStartedAt = performance.now()
    await invoke('webview_set_browser_bounds', {
      label: webview.label,
      windowLabel,
      x: position.x,
      y: position.y,
      width: size.width,
      height: size.height,
    })
    const knownGoodCacheSkipReason =
      _restoreRepairInProgress
        ? 'restore-in-progress'
        : siteFullscreenBounds
          ? 'site-fullscreen'
          : activeWebview === null
            ? 'no-active-webview'
            : activeWebview.label !== webview.label
              ? 'inactive-webview'
              : size.width <= 0 || size.height <= 0
                ? 'invalid-bounds'
                : null
    const knownGoodCacheDetails = {
      traceId,
      label: webview.label,
      windowLabel,
      x: position.x,
      y: position.y,
      width: size.width,
      height: size.height,
    }
    if (knownGoodCacheSkipReason) {
      recordRestoreTiming(
        traceId,
        'browser.bounds.known-good-cache-skip',
        {
          ...knownGoodCacheDetails,
          reason: knownGoodCacheSkipReason,
        },
      )
    } else {
      lastKnownGoodBrowserBounds = {
        label: webview.label,
        windowLabel,
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
      }
      recordRestoreTiming(
        traceId,
        'browser.bounds.known-good-cache-write',
        knownGoodCacheDetails,
      )
    }
    recordRestoreTiming(traceId, 'browser.bounds.atomic-invoke-ok', {
      traceId,
      opId,
      label: webview.label,
      durationMs:
        Math.round((performance.now() - atomicInvokeStartedAt) * 1000) / 1000,
    })
    return
  } catch (error) {
    recordRestoreTiming(traceId, 'browser.bounds.atomic-invoke-error', {
      traceId,
      opId,
      label: webview.label,
      ...transitionErrorDetails(error),
    })
    if (import.meta.env.DEV) {
      console.warn(
        '[nebula] atomic browser bounds failed; using ordered Webview fallback',
        error,
      )
    }
  }

  recordRestoreTiming(traceId, 'browser.bounds.fallback-start', {
    traceId,
    opId,
    label: webview.label,
  })

  // Size first, position last. After a Windows reparent Wry 0.55 may map the
  // current rectangle through the old parent while handling each split call.
  // Finishing with position guarantees the final origin even on an older
  // native binary where the atomic command is unavailable during HMR.
  await webview.setSize(size)
  await webview.setPosition(position)

  recordRestoreTiming(traceId, 'browser.bounds.fallback-ok', {
    traceId,
    opId,
    label: webview.label,
  })
}

async function syncBrowserBounds(
  webview: Webview,
  traceId = 'background-layout',
): Promise<boolean> {
  const opId = `${traceId}:${webview.label}:sync:${Date.now()}`
  recordRestoreTiming(traceId, 'browser.bounds.sync-entry', {
    traceId,
    opId,
    label: webview.label,
  })

  let position: PhysicalPosition
  let size: PhysicalSize
  try {
    recordRestoreTiming(traceId, 'browser.bounds.resolve-start', {
      opId,
      label: webview.label,
    })
    const resolveStartedAt = performance.now()
    const resolved =
      await currentBrowserPhysicalBounds()
    recordRestoreTiming(traceId, 'browser.bounds.resolve-end', {
      opId,
      label: webview.label,
      durationMs:
        Math.round((performance.now() - resolveStartedAt) * 1000) / 1000,
    })
    position = resolved.position
    size = resolved.size
  } catch (error) {
    recordRestoreTiming(traceId, 'browser.bounds.resolve-error', {
      opId,
      label: webview.label,
      ...transitionErrorDetails(error),
    })
    throw error
  }

  const key = boundsKey(
    position.x,
    position.y,
    size.width,
    size.height,
  )

  recordRestoreTiming(traceId, 'browser.bounds.compute-ok', {
    traceId,
    opId,
    label: webview.label,
    x: position.x,
    y: position.y,
    width: size.width,
    height: size.height,
    boundsKey: key,
  })

  // A restored Windows window can briefly expose its minimized bootstrap
  // client rectangle while reporting isMinimized=false. Never apply or cache
  // that rectangle for a site WebView.
  if (!siteFullscreenBounds && !hasUsableWindowClientSize(size)) {
    recordRestoreTiming(traceId, 'browser.bounds.transient-client-skip', {
      traceId,
      opId,
      label: webview.label,
      width: size.width,
      height: size.height,
    })
    return false
  }

  // Native restore owns the authoritative client rectangle. Resize/focus
  // callbacks can still observe the transient minimized size at this point;
  // never let them overwrite the native repair with that frontend reading.
  if (_restoreRepairInProgress) {
    const skippedBoundsDetails = {
      traceId,
      opId,
      label: webview.label,
      x: position.x,
      y: position.y,
      width: size.width,
      height: size.height,
      reason: 'restore-in-progress',
    }
    recordRestoreTiming(
      traceId,
      'browser.bounds.set-skip-restore-repair',
      skippedBoundsDetails,
    )
    void writeTransitionLog(
      'browser.bounds.set-skip-restore-repair',
      'info',
      skippedBoundsDetails,
    )
    return false
  }

  if (lastBrowserBoundsKey === key) {
    recordRestoreTiming(traceId, 'browser.bounds.unchanged', {
      traceId,
      opId,
      label: webview.label,
      bounds: key,
    })

    return false
  }

  recordRestoreTiming(traceId, 'browser.bounds.set-start', {
    label: webview.label,
    x: position.x,
    y: position.y,
    width: size.width,
    height: size.height,
  })
  const setStartedAt = performance.now()
  try {
    await applyBrowserBounds(webview, position, size, traceId)
    recordRestoreTiming(traceId, 'browser.bounds.set-ok', {
      label: webview.label,
      x: position.x,
      y: position.y,
      width: size.width,
      height: size.height,
      durationMs:
        Math.round((performance.now() - setStartedAt) * 1000) / 1000,
    })
  } catch (error) {
    recordRestoreTiming(traceId, 'browser.bounds.set-error', {
      label: webview.label,
      x: position.x,
      y: position.y,
      width: size.width,
      height: size.height,
      durationMs:
        Math.round((performance.now() - setStartedAt) * 1000) / 1000,
      ...transitionErrorDetails(error),
    })
    throw error
  }

  recordRestoreTiming(traceId, 'browser.bounds.set-auto-resize-start', {
    label: webview.label,
    autoResize: false,
  })
  const autoResizeStartedAt = performance.now()
  try {
    if (!browserAutoResizeDisabledLabels.has(webview.label)) {
      await webview.setAutoResize(false)
      browserAutoResizeDisabledLabels.add(webview.label)
    }
    recordRestoreTiming(traceId, 'browser.bounds.set-auto-resize-ok', {
      label: webview.label,
      autoResize: false,
      durationMs:
        Math.round((performance.now() - autoResizeStartedAt) * 1000) / 1000,
    })
  } catch (error) {
    recordRestoreTiming(traceId, 'browser.bounds.set-auto-resize-error', {
      label: webview.label,
      autoResize: false,
      durationMs:
        Math.round((performance.now() - autoResizeStartedAt) * 1000) / 1000,
      ...transitionErrorDetails(error),
    })
    throw error
  }

  lastBrowserBoundsKey = key
  recordRestoreTiming(traceId, 'browser.bounds.sync-exit', {
    traceId,
    opId,
    label: webview.label,
  })

  return true
}

function unbindResizeListeners(): void {
  resizeDebounceCancel?.()
  resizeDebounceCancel = null
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

// Detect a real minimize -> restore transition and repair native browsing layout.
let restoreRepairUnbind: (() => void) | null = null
let _restoreRepairInProgress = false

export function initWindowRestoreRepair(): (() => void) {
  if (!isTauri) return () => {}
  if (restoreRepairUnbind) return restoreRepairUnbind

  let cancelled = false
  let lastKnownMinimized = false
  let delayedFocusRepair: ReturnType<typeof setTimeout> | null = null
  let delayedResizeRepair: ReturnType<typeof setTimeout> | null = null
  const appWindow = getCurrentWindow()

  async function repairBrowsingSurfacesAfterReturn(reason: string): Promise<void> {
    const webview = activeWebview
    const tabId = activeTabId
    if (!webview || !tabId) return
    const stillCurrent = () => !cancelled && !siteFullscreenBounds
      && !_restoreRepairInProgress && isBrowsingChromeExpected()
      && tabActivationRequests.size === 0
      && activeWebview === webview && activeTabId === tabId
    if (!stillCurrent()) return
    const { size } = await browserWebviewPhysicalBounds()
    if (!hasUsableWindowClientSize(size)) return

    const restored = await restoreBrowsingSurfaces({
      canRestore: async () => {
        const minimized = await currentWindowIsMinimized()
        return !minimized && stillCurrent()
      },
      restoreBounds: async () => {
        // A detected restore already replayed authoritative native geometry.
        if (reason === 'native-restore-settled') return true
        await invoke('webview_restore_browsing_layout', {
          windowLabel: currentBrowserWindowLabel(),
          x: 0,
          y: 0,
          width: size.width,
          height: size.height,
          // The visible site must keep its z-order; lowering it below Home
          // until the stack call raises it again flashes Home on every focus.
          activeTabLabel: webview.label,
        })
        return true
      },
      showTab: () => webview.show(),
      showChrome: async () => {
        const { showChromeWebview } = await import('./tauriChromeWebview')
        if (stillCurrent()) await showChromeWebview(SEMI_LUNAR_HIT_ZONE_HEIGHT, { stack: false })
      },
      stack: () => invoke('webview_raise_chrome', {
        windowLabel: currentBrowserWindowLabel(),
        activeTabLabel: webview.label,
        fullRepair: true,
      }),
    })
    if (!restored || !stillCurrent()) return
    if (windowMinimizedWebviewLabel === webview.label) {
      windowMinimizedWebviewLabel = null
    }
    await writeTransitionLog('browser.restore-visible-surfaces', 'info', {
      reason,
      tabActive: true,
      width: size.width,
      height: size.height,
    })
  }

  const browsingSurfaceRepairs = createCoalescedRestoreRepair(
    repairBrowsingSurfacesAfterReturn,
    (reason, error) => {
      void writeTransitionLog('browser.restore-visible-surfaces', 'error', {
        reason,
        ...transitionErrorDetails(error),
      })
    },
  )
  function requestBrowsingSurfaceRepair(reason: string): void {
    browsingSurfaceRepairs.request(reason)
  }

  // Safe local helper: wait for a short layout settle using onResized with timeout.
  async function waitForWindowLayoutSettleLocal(): Promise<void> {
    await new Promise<void>((resolve) => {
      let settled = false
      let unlisten: (() => void) | undefined
      let timeout: ReturnType<typeof setTimeout>
      const finish = () => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        unlisten?.()
        resolve()
      }
      timeout = setTimeout(finish, 120)

      void appWindow
        .onResized(finish)
        .then((dispose) => {
          if (settled) {
            dispose()
            return
          }
          unlisten = dispose
        })
        .catch(finish)
    })
  }

  async function runRestoreRepairIfNeeded(traceId: string): Promise<void> {
    if (_restoreRepairInProgress) return
    if (siteFullscreenBounds) return // let site-fullscreen flow own repairs

    _restoreRepairInProgress = true
    let repairStatus: 'ok' | 'error' = 'ok'
    try {
      recordRestoreTiming(traceId, 'browser.restore-repair.start')

      const targetLabel = activeWebview?.label ?? null
      const cachedBounds = lastKnownGoodBrowserBounds
      const currentWindowLabel = currentBrowserWindowLabel()
      let stableRestoreBounds: KnownGoodBrowserBounds | null = null
      let earlySkipReason: string | null = null
      if (!cachedBounds) {
        earlySkipReason = 'no-cache'
      } else if (!targetLabel) {
        earlySkipReason = 'no-active-webview'
      } else if (cachedBounds.label !== targetLabel) {
        earlySkipReason = 'label-mismatch'
      } else if (cachedBounds.windowLabel !== currentWindowLabel) {
        earlySkipReason = 'window-mismatch'
      } else if (cachedBounds.width <= 0 || cachedBounds.height <= 0) {
        earlySkipReason = 'invalid-bounds'
      }

      if (
        earlySkipReason ||
        !cachedBounds ||
        !targetLabel
      ) {
        recordRestoreTiming(
          traceId,
          'browser.restore-repair.early-cache-skip',
          {
            reason:
              earlySkipReason ??
              (!cachedBounds
                ? 'no-cache'
                : 'no-active-webview'),
            activeWebviewLabel: targetLabel,
            currentWindowLabel,
            cachedLabel: cachedBounds?.label ?? null,
            cachedWindowLabel:
              cachedBounds?.windowLabel ?? null,
          },
        )
      } else {
        recordRestoreTiming(
          traceId,
          'browser.restore-repair.early-cache-hit',
          {
            label: cachedBounds.label,
            windowLabel: cachedBounds.windowLabel,
            x: cachedBounds.x,
            y: cachedBounds.y,
            width: cachedBounds.width,
            height: cachedBounds.height,
          },
        )

        if (
          activeWebview?.label !== targetLabel ||
          cachedBounds.windowLabel !== currentBrowserWindowLabel()
        ) {
          recordRestoreTiming(
            traceId,
            'browser.restore-repair.early-cache-skip',
            {
              reason: activeWebview?.label !== targetLabel
                ? 'active-changed'
                : 'window-mismatch',
              activeWebviewLabel:
                activeWebview?.label ?? null,
              targetLabel,
              cachedLabel: cachedBounds.label,
              cachedWindowLabel:
                cachedBounds.windowLabel,
              currentWindowLabel:
                currentBrowserWindowLabel(),
            },
          )
        } else {
          stableRestoreBounds = cachedBounds
          try {
            recordRestoreTiming(
              traceId,
              'browser.restore-repair.early-invoke-start',
              {
                label: cachedBounds.label,
                windowLabel:
                  cachedBounds.windowLabel,
                x: cachedBounds.x,
                y: cachedBounds.y,
                width: cachedBounds.width,
                height: cachedBounds.height,
              },
            )
            const earlyInvokeStartedAt = performance.now()
            await invoke('webview_set_browser_bounds', {
              label: cachedBounds.label,
              windowLabel: cachedBounds.windowLabel,
              x: cachedBounds.x,
              y: cachedBounds.y,
              width: cachedBounds.width,
              height: cachedBounds.height,
            })
            recordRestoreTiming(
              traceId,
              'browser.restore-repair.early-invoke-ok',
              {
                label: cachedBounds.label,
                durationMs:
                  Math.round(
                    (performance.now() - earlyInvokeStartedAt) * 1000,
                  ) / 1000,
              },
            )
          } catch (error) {
            recordRestoreTiming(
              traceId,
              'browser.restore-repair.early-invoke-error',
              {
                label: cachedBounds.label,
                ...transitionErrorDetails(error),
              },
            )
          }
        }
      }

      // Wait for native layout to settle
      await waitForWindowLayoutSettleLocal()

      if (!stableRestoreBounds) {
        recordRestoreTiming(
          traceId,
          'browser.restore-repair.native-invoke-skip',
          { reason: 'no-stable-cache-bounds' },
        )
      } else {
        // Restore must replay the stable cache snapshot. Reading a fresh client
        // rect here can observe Windows' transient minimized geometry and undo
        // the early cache apply with a bootstrap-sized WebView.
        const maxAttempts = 3
        const backoffMs = 120
        let lastErr: any = null
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            recordRestoreTiming(
              traceId,
              'browser.restore-repair.native-invoke-start',
              {
                attempt,
                label: stableRestoreBounds.label,
                windowLabel: stableRestoreBounds.windowLabel,
                x: stableRestoreBounds.x,
                y: stableRestoreBounds.y,
                width: stableRestoreBounds.width,
                height: stableRestoreBounds.height,
              },
            )
            const invokeStartedAt = performance.now()
            await invoke('webview_restore_browsing_layout', {
              windowLabel: stableRestoreBounds.windowLabel,
              x: stableRestoreBounds.x,
              y: stableRestoreBounds.y,
              width: stableRestoreBounds.width,
              height: stableRestoreBounds.height,
              activeTabLabel: stableRestoreBounds.label,
            })
            recordRestoreTiming(
              traceId,
              'browser.restore-repair.native-invoke-ok',
              {
                attempt,
                durationMs:
                  Math.round((performance.now() - invokeStartedAt) * 1000) / 1000,
              },
            )
            lastErr = null
            break
          } catch (error) {
            lastErr = error
            recordRestoreTiming(
              traceId,
              'browser.restore-repair.native-invoke-error',
              {
                attempt,
                ...transitionErrorDetails(error),
              },
            )
            if (attempt < maxAttempts) {
              await new Promise((r) => setTimeout(r, backoffMs))
            }
          }
        }

        if (lastErr) {
          repairStatus = 'error'
          recordRestoreTiming(
            traceId,
            'browser.restore-repair.native-invoke-failed',
            { ...transitionErrorDetails(lastErr) },
          )
        }
      }

      // The native restore just applied the authoritative client rectangle. Do not
      // immediately read the frontend window size here: Windows can still report
      // transient minimized geometry and overwrite the repaired tab bounds.
      try {
        const activeTabLabel = activeTabId
          ? tabWebviewLabel(activeTabId)
          : null
        const windowLabel = currentBrowserWindowLabel()
        recordRestoreTiming(
          traceId,
          'browser.restore-repair.native-stack-start',
          { activeTabId, activeTabLabel, windowLabel },
        )
        const stackStartedAt = performance.now()
        await invoke('webview_raise_chrome', {
          windowLabel,
          activeTabLabel,
          fullRepair: true,
        })
        recordRestoreTiming(
          traceId,
          'browser.restore-repair.native-stack-ok',
          {
            activeTabId,
            activeTabLabel,
            windowLabel,
            durationMs:
              Math.round((performance.now() - stackStartedAt) * 1000) / 1000,
          },
        )
      } catch (error) {
        repairStatus = 'error'
        recordRestoreTiming(
          traceId,
          'browser.restore-repair.native-stack-error',
          transitionErrorDetails(error),
        )
      }
    } catch (error) {
      repairStatus = 'error'
      recordRestoreTiming(
        traceId,
        'browser.restore-repair.error',
        transitionErrorDetails(error),
      )
    } finally {
      recordRestoreTiming(traceId, 'browser.restore-repair.end', {
        status: repairStatus,
      })
      _restoreRepairInProgress = false
      flushRestoreTiming(traceId, repairStatus)
      requestBrowsingSurfaceRepair('native-restore-settled')
    }
  }

  // Handler invoked on focus/resizes; determine real minimize->restore by
  // sampling isMinimized and previous state.
  const onTransition = async (_reason: string) => {
    if (cancelled) return
    try {
      const currentMin = await currentWindowIsMinimized()
      if (lastKnownMinimized && !currentMin) {
        // Real restore from minimized
        const traceId = `restore-${Date.now()}`
        await runRestoreRepairIfNeeded(traceId)
      }
      lastKnownMinimized = currentMin
    } catch {
      // ignore sampling failures
    }
  }

  // Initialize lastKnownMinimized
  void (async () => {
    lastKnownMinimized = await currentWindowIsMinimized()
  })()

  let focusUnlisten: (() => void) | null = null
  let resizeUnlisten: (() => void) | null = null

  void appWindow.onFocusChanged(({ payload: focused }) => {
    void onTransition('focus')
    if (!focused) return
    // A rapid taskbar minimize/restore can deliver both callbacks after the
    // window is already restored, so lastKnownMinimized never becomes true.
    // Home geometry is repaired by the native window event, without JS IPC.
    requestBrowsingSurfaceRepair('focus')
    if (delayedFocusRepair !== null) clearTimeout(delayedFocusRepair)
    delayedFocusRepair = setTimeout(() => {
      delayedFocusRepair = null
      requestBrowsingSurfaceRepair('focus-settled')
    }, 250)
  }).then((unlisten) => { if (cancelled) unlisten(); else focusUnlisten = unlisten }).catch(() => {})

  void appWindow.onResized(() => {
    void onTransition('resize')
    if (delayedResizeRepair !== null) clearTimeout(delayedResizeRepair)
    delayedResizeRepair = setTimeout(() => {
      delayedResizeRepair = null
      requestBrowsingSurfaceRepair('resize-settled')
    }, LAYOUT_DEBOUNCE_MS)
  }).then((unlisten) => { if (cancelled) unlisten(); else resizeUnlisten = unlisten }).catch(() => {})

  // The repairs above wait for an event (focus, resize, restore). Windows does not always send the one
  // that matters (a window brought forward can change geometry without a resize, and focus can return
  // to a child window so this one never reports Focused). So the layout is also looked at now and then,
  // as Windows has it, and a difference that stays is repaired the same way.
  const layoutAuditor = createLayoutAuditor({
    intervalMs: 2_000,
    confirmations: 2,
    cooldownMs: 6_000,
    now: () => Date.now(),
    setTimer: (callback, ms) => setTimeout(callback, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    read: async () => {
      const webview = activeWebview
      // Only while a site is shown and nothing else owns the geometry.
      if (
        cancelled || !webview || !activeTabId || siteFullscreenBounds ||
        _restoreRepairInProgress || !isBrowsingChromeExpected() ||
        tabActivationRequests.size > 0 || await currentWindowIsMinimized()
      ) {
        return null
      }
      const windowLabel = currentBrowserWindowLabel()
      const audit = await invoke<LayoutAudit>('webview_layout_audit', { windowLabel })
      // The answer is only worth anything if the same tab is still the one shown.
      if (activeWebview !== webview || siteFullscreenBounds) return null
      return findLayoutFaults(audit, {
        mainLabel: windowLabel,
        chromeLabel: currentChromeWebviewLabel(),
        activeTabLabel: webview.label,
      })
    },
    onFault: async (faults) => {
      await writeTransitionLog('browser.layout-audit', 'error', {
        windowLabel: currentBrowserWindowLabel(),
        faults,
      })
      requestBrowsingSurfaceRepair('layout-audit')
      // A webview that draws at another scale than its window is not repaired by moving it.
      if (faults.some((fault) => fault.reason === 'scale')) {
        await invoke('webview_resync_scale', { windowLabel: currentBrowserWindowLabel() }).catch(() => undefined)
      }
      // The overlay positions itself from its own cached bounds, which say "unchanged": put it where
      // Windows should have it, from the audit, not from that cache.
      const chromeLabel = currentChromeWebviewLabel()
      for (const fault of faults) {
        if (fault.label !== chromeLabel || fault.reason === 'missing' || fault.reason === 'scale') continue
        await invoke('webview_set_chrome_bounds', {
          windowLabel: currentBrowserWindowLabel(),
          x: fault.fix.x,
          y: fault.fix.y,
          width: fault.fix.width,
          height: fault.fix.height,
        }).catch(() => undefined)
      }
    },
  })
  layoutAuditor.start()

  restoreRepairUnbind = () => {
    cancelled = true
    layoutAuditor.stop()
    browsingSurfaceRepairs.dispose()
    if (delayedFocusRepair !== null) clearTimeout(delayedFocusRepair)
    if (delayedResizeRepair !== null) clearTimeout(delayedResizeRepair)
    focusUnlisten?.()
    resizeUnlisten?.()
    restoreRepairUnbind = null
  }

  return restoreRepairUnbind
}

async function showWebviewForCurrentWindowState(
  webview: Webview,
  traceId: string,
): Promise<boolean> {
  if (
    await currentWindowIsMinimized()
  ) {
    recordRestoreTiming(traceId, 'browser.webview.hide.request', {
      label: webview.label,
    })
    await webview.hide()
    recordRestoreTiming(traceId, 'browser.webview.hide.ok', {
      label: webview.label,
    })
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
    return false
  }

  if (
    windowMinimizedWebviewLabel ===
    webview.label
  ) {
    windowMinimizedWebviewLabel =
      null
  }

  recordRestoreTiming(traceId, 'browser.webview.show.request', { label: webview.label })
  await webview.show()
  recordRestoreTiming(traceId, 'browser.webview.show.ok', { label: webview.label })
  return true
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
    // Native window events own the active surface's hide/show pair. A delayed
    // renderer callback must not hide it again after Windows has restored it.
    return false
  }

  if (activeWebview?.label !== webview.label) return false

  if (
    windowMinimizedWebviewLabel ===
    webview.label
  ) {
    windowMinimizedWebviewLabel =
      null
    recordRestoreTiming(traceId, 'browser.webview.show.request', { label: webview.label })
    await webview.show()
    recordRestoreTiming(traceId, 'browser.webview.show.ok', { label: webview.label })

    await navigateDeferredInitialWebview(
      webview,
      `${traceId}:restored`,
    )

    await writeTransitionLog(
      'browser.window-visibility',
      'ok',
      {
        traceId,
        label: webview.label,
        minimized: false,
      },
    )

    // This callback originated from the minimized window's resize event. The
    // WebView may still report its transient bootstrap client size here, so
    // do not feed that stale geometry into syncBrowserBounds or the
    // known-good cache. The restore repair has already replayed the stable
    // cached bounds; a later ordinary resize will perform the next sync.
    return false
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

      // HTML5/site fullscreen exclusively owns parent->tab geometry while
      // active. Do not copy a transient Windows work-area resize (for example
      // 1920x1032 after Alt+Tab) into the fullscreen child WebView.
      if (siteFullscreenBounds) {
        await writeTransitionLog(
          'browser.bounds.resize-skipped-site-fullscreen',
          'info',
          {
            traceId: resizeTraceId,
            label: webview.label,
          },
        )
        return
      }

      const changed =
        await syncBrowserBounds(
          webview,
          resizeTraceId,
        )

      if (!changed) return

      recordRestoreTiming(resizeTraceId, 'browser.stack.request', { activeTabId })
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

  let nextResizeUnlisten: (() => void) | null = null
  try {
    nextResizeUnlisten = await traceTransitionCall(
      traceId,
      'browser.bounds.listen-resized',
      { label: webview.label },
      () =>
        appWindow.onResized(
          onLayoutChange,
        ),
    )

    const nextScaleUnlisten = await traceTransitionCall(
      traceId,
      'browser.bounds.listen-scale-changed',
      { label: webview.label },
      () =>
        appWindow.onScaleChanged(
          onLayoutChange,
        ),
    )

    resizeUnlisten = nextResizeUnlisten
    scaleUnlisten = nextScaleUnlisten
    resizeDebounceCancel = onLayoutChange.cancel
  } catch (error) {
    onLayoutChange.cancel()
    nextResizeUnlisten?.()
    throw error
  }
}

async function waitForWebviewCreated(
  webview: Webview,
): Promise<void> {
  await waitForTauriCreated(
    webview,
    `browser webview ${webview.label}`,
    WEBVIEW_CREATE_TIMEOUT_MS,
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

  await traceTransitionCall(
    traceId,
    'browser.webview.apply-force-dark',
    { label, forceDarkRevision },
    () => applyForceDarkToLabel(label),
  )
}

function scheduleBrowseWebviewPrewarm(delayMs: number): void {
  if (import.meta.env.DEV) return
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
      delayMs,
    )
}

export function scheduleInitialBrowseWebviewPrewarm(): void {
  scheduleBrowseWebviewPrewarm(INITIAL_PREWARM_DELAY_MS)
}

function scheduleNextBrowseWebviewPrewarm(): void {
  scheduleBrowseWebviewPrewarm(NEXT_PREWARM_DELAY_MS)
}

async function waitForPendingPrewarmGrace(): Promise<void> {
  const pending = prewarmPromise
  if (!pending) return

  let timeoutId: number | null = null
  const graceElapsed = new Promise<void>((resolve) => {
    timeoutId = window.setTimeout(resolve, PREWARM_ADOPTION_GRACE_MS)
  })

  try {
    await Promise.race([
      pending.catch(() => undefined),
      graceElapsed,
    ])
  } finally {
    if (timeoutId !== null) window.clearTimeout(timeoutId)
  }
}

export async function prewarmBrowseWebview(): Promise<void> {
  if (
    !isTauri ||
    prewarmedWebview ||
    prewarmPromise
  ) {
    return
  }
  if (!prewarmWindowFocused || !(await getCurrentWindow().isFocused())) return

  const traceId =
    `prewarm-${Date.now()}-${prewarmSequence + 1}`
  const generation = prewarmGeneration
  const privateMode = privacyOptions.privateMode

  prewarmPromise = (async () => {
    await refreshSystemMemoryPressure()

    if (!shouldKeepPrewarmedWebview(systemMemoryPressurePercent)) {
      await writeTransitionLog(
        'browser.prewarm.skip-memory-pressure',
        'info',
        {
          memoryPressurePercent: systemMemoryPressurePercent,
        },
      )
      return
    }

    await traceTransitionCall(
      traceId,
      'browser.prewarm.ensure-ublock',
      { label: currentBrowserWindowLabel() },
      () =>
        ensureUblockProfile(
          currentBrowserWindowLabel(),
        ),
    )

    const label =
      `${PREWARMED_TAB_PREFIX}${currentBrowserWindowId()}-${++prewarmSequence}`

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
        forceDarkApplyRunner.invalidate(label)
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
      forceDarkApplyRunner.invalidate(label)

      try {
        await traceTransitionCall(
          traceId,
          'browser.prewarm.close-after-error',
          { label },
          () =>
            destroyTabWebview(label),
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

        const previous =
          systemMemoryPressurePercent

        const changed =
          normalized !==
          previous

        systemMemoryPressurePercent =
          normalized

        if (changed) {
          rescheduleInactiveTabsForMemoryPressure()

          if (!shouldKeepPrewarmedWebview(normalized)) {
            await discardPrewarmedWebview('memory-pressure')
          } else if (
            !shouldKeepPrewarmedWebview(previous) &&
            !prewarmPromise
          ) {
            scheduleNextBrowseWebviewPrewarm()
          }
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
        'webview_has_active_download',
        { label },
      )
    ) {
      return 'download'
    }
  } catch {
    return 'download-state-unavailable'
  }

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

            if (activeWebview?.label !== label) {
              scheduleTabSleep(webview, TAB_SLEEP_RETRY_MS)
            }
          } catch (error) {
            suspendedWebviews.delete(
              label,
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

            if (activeWebview?.label !== label) {
              scheduleTabSleep(webview, TAB_SLEEP_RETRY_MS)
            }
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
  forceDarkApplyRunner.invalidate(webview.label)

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

}

async function getOrCreateTabWebview(
  shortcutId: string,
  initialUrl: string,
  forceNavigate = false,
  traceId: string,
  deferInitialNavigation = false,
): Promise<Webview> {
  const privateMode = registerBrowseTabPrivateMode(shortcutId, browseTabIsPrivate(shortcutId))
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
      deferInitialNavigation,
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
        'browser.webview.prewarm-adoption-grace',
        {
          shortcutId,
          label,
        },
        () => waitForPendingPrewarmGrace(),
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

      try {
        if (
          !prewarmProfileMatches(
            adoptedPrivateMode,
            privateMode,
          )
        ) {
          throw new Error(
            'prewarmed WebView profile no longer matches private mode',
          )
        }

        await traceTransitionCall(
          traceId,
          'browser.webview.adopt.restore-memory',
          { shortcutId, label },
          () => restoreWebviewMemory(webview!),
        )

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

        await traceTransitionCall(
          traceId,
          'browser.webview.adopt.apply-force-dark',
          { shortcutId, label },
          () => applyForceDarkToLabel(label),
        )

        if (
          !prewarmProfileMatches(
            adoptedPrivateMode,
            privateMode,
          )
        ) {
          throw new Error(
            'private mode changed while adopting the prewarmed WebView',
          )
        }

        await stageInitialWebviewNavigation(
          shortcutId,
          label,
          initialUrl,
          deferInitialNavigation,
          traceId,
          'browser.webview.adopt.navigate',
        )

        if (
          !prewarmProfileMatches(
            adoptedPrivateMode,
            privateMode,
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
        forceDarkApplyRunner.invalidate(label)

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
          currentBrowserWindowLabel(),
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
          privateMode,
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

      await stageInitialWebviewNavigation(
        shortcutId,
        label,
        initialUrl,
        deferInitialNavigation,
        traceId,
        'browser.webview.navigate',
      )

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
            privateMode,

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

      await stageInitialWebviewNavigation(
        shortcutId,
        label,
        initialUrl,
        deferInitialNavigation,
        traceId,
        'browser.webview.recover-navigate',
      )

      createdTabs.add(
        shortcutId,
      )
    }

    webviewCache.set(
      shortcutId,
      webview,
    )
    scheduleNextBrowseWebviewPrewarm()
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
      deferredInitialNavigations.delete(label)
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

async function stageInitialWebviewNavigation(
  shortcutId: string,
  label: string,
  url: string,
  defer: boolean,
  traceId: string,
  immediateStage: string,
): Promise<void> {
  if (!url || url === 'about:blank') return

  if (defer) {
    deferredInitialNavigations.set(label, url)
    await writeTransitionLog(
      'browser.webview.initial-navigation-deferred',
      'info',
      {
        traceId,
        shortcutId,
        label,
        url,
      },
    )
    return
  }

  deferredInitialNavigations.delete(label)
  await traceTransitionCall(
    traceId,
    immediateStage,
    {
      shortcutId,
      label,
      url,
    },
    () =>
      invoke(
        'webview_navigate',
        { label, url },
      ),
  )
}

async function navigateDeferredInitialWebview(
  webview: Webview,
  traceId: string,
): Promise<boolean> {
  const url =
    deferredInitialNavigations.get(webview.label)

  if (!url) return false

  await traceTransitionCall(
    traceId,
    'browser.activation.navigate-deferred',
    {
      label: webview.label,
      shortcutId:
        shortcutIdForTabWebviewLabel(webview.label),
      url,
    },
    () =>
      invoke(
        'webview_navigate',
        {
          label: webview.label,
          url,
        },
      ),
  )

  if (
    deferredInitialNavigations.get(webview.label) === url
  ) {
    deferredInitialNavigations.delete(webview.label)
  }

  return true
}

async function hideOtherTabs(
  visibleId: string,
  previouslyActiveTabId: string | null,
): Promise<void> {
  // Background tabs are hidden when created. Normally only the outgoing tab
  // needs a native hide; retain a full reconciliation for Home/restore.
  if (previouslyActiveTabId && previouslyActiveTabId !== visibleId) {
    const outgoing = webviewCache.get(previouslyActiveTabId)
    if (outgoing) {
      await hideWebviewSafe(outgoing)
      return
    }
  }

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
  const queuedAt = performance.now()
  const traceId = options?.traceId ??
    `activation-${Date.now()}-${++activationSequence}`
  const callerShouldContinue = options?.shouldContinue ?? (() => true)
  await tabLifecycleQueue.run(shortcutId, async (lease) => {
    await writeTransitionLog('browser.activation.queue-acquired', 'ok', {
      traceId,
      shortcutId,
      waitMs: Math.round((performance.now() - queuedAt) * 10) / 10,
    })
    await activateBrowseTabQueued(shortcutId, initialUrl, {
      ...options,
      traceId,
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
            true,
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

      const shown = await traceTransitionCall(
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

      if (shown) {
        await navigateDeferredInitialWebview(
          webview,
          traceId,
        )

        if (!shouldContinue()) {
          await logSuperseded(
            'same-tab-after-deferred-navigation',
            webview,
          )
          return
        }
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

    const shown = await traceTransitionCall(
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

    if (shown) {
      await navigateDeferredInitialWebview(
        webview,
        traceId,
      )

      if (!shouldContinue()) {
        await logSuperseded(
          'after-deferred-navigation',
          webview,
        )
        return
      }
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
          previouslyActiveTabId,
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
    !activeWebview ||
    siteFullscreenBounds
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
export async function forceSyncActiveTabBounds(traceId = 'force-sync-active-tab-bounds'): Promise<void> {
  const opId = `${traceId}:${activeWebview?.label ?? 'none'}:${Date.now()}`
  recordRestoreTiming(traceId, 'browser.force-sync-active.entry', {
    traceId,
    opId,
    activeTabId,
    activeWebviewLabel: activeWebview?.label ?? null,
    windowLabel: currentBrowserWindowLabel(),
  })

  if (
    !isTauri ||
    !activeWebview
  ) {
    recordRestoreTiming(traceId, 'browser.force-sync-active.exit', {
      traceId,
      opId,
      activeTabId,
      activeWebviewLabel: activeWebview?.label ?? null,
      skipped: true,
    })
    return
  }

  lastBrowserBoundsKey = null

  recordRestoreTiming(traceId, 'browser.force-sync-active.before-sync', {
    traceId,
    opId,
    label: activeWebview.label,
  })
  await syncBrowserBounds(
    activeWebview,
    traceId,
  )
  recordRestoreTiming(traceId, 'browser.force-sync-active.after-sync', {
    traceId,
    opId,
    label: activeWebview.label,
  })

  recordRestoreTiming(traceId, 'browser.force-sync-active.before-stack', {
    traceId,
    opId,
    activeTabId,
  })
  const stackStartedAt = performance.now()
  await stackBrowsingChromeAboveBrowser(
    activeTabId,
  )
  recordRestoreTiming(traceId, 'browser.force-sync-active.stack-ok', {
    traceId,
    opId,
    activeTabId,
    durationMs:
      Math.round((performance.now() - stackStartedAt) * 1000) / 1000,
  })
  recordRestoreTiming(traceId, 'browser.force-sync-active.exit', {
    traceId,
    opId,
    activeTabId,
    activeWebviewLabel: activeWebview.label,
  })
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

  const previouslyActiveWebview = activeWebview

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
            webview.window.label ===
              currentBrowserWindowLabel() &&
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

  // A tab sent Home is no longer visible, but it was active until this point
  // and therefore has no inactive-tab timer. Schedule its normal suspension
  // path immediately so CPU-heavy pages (for example a WebAssembly engine)
  // cannot keep competing with Home and Semi-Lunar after they are hidden.
  // The scheduler keeps its existing audio, realtime-site, and notification
  // exceptions and restores the tab when it becomes active again.
  if (previouslyActiveWebview) {
    scheduleTabSleep(previouslyActiveWebview, 0)
  }
}

export async function adoptReparentedBrowseTab(
  shortcutId: string,
  label: string,
): Promise<void> {
  if (!isTauri) return
  try {
    const webview = await Webview.getByLabel(label)
    if (!webview) throw new Error(`Transferred webview '${label}' was not found.`)
    assignTabWebviewLabel(shortcutId, label)
    webviewCache.set(shortcutId, webview)
    createdTabs.add(shortcutId)
    await configureTabWebview(
      label,
      `transfer-adopt-${Date.now()}`,
    )
  } catch (error) {
    // Adoption must be atomic. A failed configuration used to leave this
    // window holding a stale cache/label mapping for a webview that the
    // source would subsequently reparent back. Later Home/lifecycle work in
    // this window could then hide the rolled-back tab in its real owner.
    tabPrivacyModes.delete(shortcutId)
    webviewCache.delete(shortcutId)
    createdTabs.delete(shortcutId)
    configuredWebviews.delete(label)
    privacyApplyRunner.invalidate(label)
    forceDarkApplyRunner.invalidate(label)
    releaseTabWebviewLabel(shortcutId)
    throw error
  }
}

export function relinquishBrowseTabOwnership(shortcutId: string): void {
  tabPrivacyModes.delete(shortcutId)
  const label = tabWebviewLabel(shortcutId)
  browserAutoResizeDisabledLabels.delete(label)
  cancelTabUnload(shortcutId)
  cancelTabSleep(label)
  webviewCache.delete(shortcutId)
  createdTabs.delete(shortcutId)
  suspendedWebviews.delete(label)
  tabLastActiveAt.delete(shortcutId)
  unloadedTabStates.delete(shortcutId)
  privacyApplyRunner.invalidate(label)
  forceDarkApplyRunner.invalidate(label)
  releaseTabWebviewLabel(shortcutId)
  if (activeTabId === shortcutId) {
    // A delayed z-order repair may still have captured this tab while it
    // belonged to the source window. Cancel it before the WebView can be
    // restacked from the wrong window after native reparenting.
    cancelScheduledStack()
    activeTabId = null
    activeWebview = null
    unbindResizeListeners()
    lastBrowserBoundsKey = null
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
  deferredInitialNavigations.delete(label)
  browserAutoResizeDisabledLabels.delete(label)

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
  tabPrivacyModes.delete(shortcutId)
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
  forceDarkApplyRunner.invalidate(label)

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

  await applyBrowserBounds(
    webview,
    position,
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
