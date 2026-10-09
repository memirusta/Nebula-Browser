import { invoke } from '@tauri-apps/api/core'
import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi'
import { Webview, getCurrentWebview, type WebviewOptions } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { SEMI_LUNAR_HIT_ZONE_HEIGHT } from '../core/windowChrome'
import { chromeClipRegion, type ChromeClipRect } from '../core/chromeOverlayLayout'
import { hasUsableWindowClientSize } from '../core/mainWebviewRestore'
import { debounce } from './debounce'
import { waitForTauriCreated } from './tauriCreationWait'
import { getActiveBrowseTabId } from './tauriBrowser'
import { isChromeShell } from '../core/nebulaBridge'
import {
  BROWSER_WINDOW_ID_QUERY,
  currentBrowserWindowId,
  currentChromeWebviewLabel,
} from './browserWindowScope'
import { isTauri } from './runtime'
import { isOverlayModeActive, stackBrowsingChromeAboveBrowser } from './tauriWebviewStack'
import { windowClientPhysicalSize } from './windowClientBounds'


export const CHROME_WEBVIEW_LABEL = 'nebula-chrome'
const LAYOUT_DEBOUNCE_MS = 120

type ExtensionEnabledWebviewOptions = WebviewOptions & {
  browserExtensionsEnabled: boolean
}

interface ShowChromeWebviewOptions {
  stack?: boolean
}

let activeChromeWebview: Webview | null = null
let resizeUnlisten: (() => void) | null = null
let scaleUnlisten: (() => void) | null = null
let focusUnlisten: (() => void) | null = null
let resizeDebounceCancel: (() => void) | null = null
let lastChromeBoundsKey: string | null = null
// Physical Semi-Lunar bounds are owned only by the #chrome context. The main
// WebView creates/shows the child, but must not keep a competing resize listener.
let chromeBoundsListenerBound = false
let chromeOverlayLogicalWidth: number | null = null
let chromeOverlayLogicalHeight = SEMI_LUNAR_HIT_ZONE_HEIGHT
let chromeOverlayMinimumLogicalHeight = 0
// Hover preview can temporarily need the full client height. The WebView width
// stays full-client so the collapsed trigger remains available across the
// whole top edge; the visual dome itself is centered by CSS.
let chromeOverlayFullHeight = false
let chromeVisibilitySuppressed = false
let chromeVisibilityRequestSequence = 0
let chromeBoundsSyncPromise: Promise<void> | null = null
let chromeBoundsDirty = false
let chromeAutoResizeDisabled = false
// Floating bubbles (camera or microphone in use, zoom) in logical px, in overlay coordinates.
let chromeBubbleRects: ChromeClipRect[] = []
let lastChromeClipKey = ''

// Keep a small tolerance around the centered dome for conservative native
// rectangle checks. The actual WebView remains full-client width.
const CHROME_OVERLAY_WIDTH_GUTTER = 32

function chromeWebviewUrl(): string {
  const query = new URLSearchParams({
    [BROWSER_WINDOW_ID_QUERY]: currentBrowserWindowId(),
  })
  return `${window.location.origin}${window.location.pathname}?${query.toString()}#chrome`
}

function chromeWebviewLabel(): string {
  return currentChromeWebviewLabel()
}

let shellSplit: Promise<boolean> | null = null
/** SPIKE: whether the shell runs in its own WebView2 environment. */
function shellSplitEnabled(): Promise<boolean> {
  shellSplit ??= invoke<boolean>('shell_split_enabled').catch(() => false)
  return shellSplit
}

async function chromePhysicalBounds(): Promise<{
  position: PhysicalPosition
  size: PhysicalSize
  clientSize: PhysicalSize
}> {
  const windowSize = await windowClientPhysicalSize()
  const requestedPhysicalHeight = Math.ceil(
    Math.max(1, chromeOverlayLogicalHeight, chromeOverlayMinimumLogicalHeight) *
      await getCurrentWindow().scaleFactor(),
  )

  const height = chromeOverlayFullHeight
    ? Math.max(1, windowSize.height)
    : Math.max(1, Math.min(windowSize.height, requestedPhysicalHeight))

  return {
    position: new PhysicalPosition(0, 0),
    size: new PhysicalSize(Math.max(1, windowSize.width), height),
    clientSize: windowSize,
  }
}

/** Apply (or lift) the overlay's clip from the current overlay state; unchanged clips are not sent again. */
async function applyChromeClip(): Promise<void> {
  if (!isTauri || !isChromeShell()) return
  try {
    const region = chromeClipRegion(
      {
        bubbles: chromeBubbleRects,
        fullHeight: chromeOverlayFullHeight,
        logicalHeight: chromeOverlayLogicalHeight,
        minimumLogicalHeight: chromeOverlayMinimumLogicalHeight,
        stripLogicalHeight: SEMI_LUNAR_HIT_ZONE_HEIGHT,
      },
      await getCurrentWindow().scaleFactor(),
    )
    const key = JSON.stringify(region)
    if (key === lastChromeClipKey) return
    await invoke<boolean>('webview_set_chrome_clip', {
      windowLabel: getCurrentWindow().label,
      rects: region,
    })
    lastChromeClipKey = key
  } catch (error) {
    // A clip that cannot be applied leaves the overlay whole: it blocks more, never less.
    lastChromeClipKey = ''
    if (import.meta.env.DEV) console.warn('[nebula] chrome clip failed', error)
  }
}

/** The floating bubbles that need room below the strip, as the overlay shows them. */
export async function setChromeBubbleRects(bubbles: ChromeClipRect[]): Promise<void> {
  chromeBubbleRects = bubbles
  await applyChromeClip()
}

/**
 * Conservative native hit-test bounds for Semi-Lunar itself.
 *
 * Deliberately ignores chromeOverlayFullHeight and the transient minimum height:
 * previews can temporarily make the chrome WebView full-client, but that must
 * not make the whole browser window count as "hovering Semi-Lunar".
 */
async function semiLunarPhysicalBounds(): Promise<{
  position: PhysicalPosition
  size: PhysicalSize
}> {
  const windowSize = await windowClientPhysicalSize()
  const scaleFactor = await getCurrentWindow().scaleFactor()
  const requestedPhysicalWidth = chromeOverlayLogicalWidth === null
    ? windowSize.width
    : Math.ceil(
        (Math.max(1, chromeOverlayLogicalWidth) + CHROME_OVERLAY_WIDTH_GUTTER) * scaleFactor,
      )
  const requestedPhysicalHeight = Math.ceil(
    Math.max(1, chromeOverlayLogicalHeight) * scaleFactor,
  )

  const width = Math.max(1, Math.min(windowSize.width, requestedPhysicalWidth))
  const height = Math.max(1, Math.min(windowSize.height, requestedPhysicalHeight))
  const x = Math.max(0, Math.round((windowSize.width - width) / 2))

  return {
    position: new PhysicalPosition(x, 0),
    size: new PhysicalSize(width, height),
  }
}

/**
 * Ask Windows whether the real OS cursor is still inside Semi-Lunar's native
 * child-WebView rectangle. null means "native check unavailable"; callers
 * should then keep their normal DOM hover behavior.
 */
export async function isCursorInsideSemiLunarNativeBounds(): Promise<boolean | null> {
  if (!isTauri || !isChromeShell()) return null

  try {
    const { position, size } = await semiLunarPhysicalBounds()
    const windowLabel = getCurrentWindow().label

    return await invoke<boolean>('window_cursor_in_client_rect', {
      windowLabel,
      x: position.x,
      y: position.y,
      width: size.width,
      height: size.height,
    })
  } catch (error) {
    console.warn('[nebula] native Semi-Lunar cursor hit-test failed', error)
    return null
  }
}

/**
 * Ask Windows whether the real cursor is still inside the collapsed 10px
 * activation strip. This deliberately ignores the last synced chrome height:
 * during a rapid open/close resize that height can still describe the expanded
 * dome and would incorrectly turn a brief edge crossing into an open request.
 */
export async function isCursorInsideSemiLunarNativeTrigger(): Promise<boolean | null> {
  if (!isTauri || !isChromeShell()) return null

  try {
    const [windowSize, scaleFactor] = await Promise.all([
      windowClientPhysicalSize(),
      getCurrentWindow().scaleFactor(),
    ])
    const height = Math.max(1, Math.ceil(SEMI_LUNAR_HIT_ZONE_HEIGHT * scaleFactor))
    const windowLabel = getCurrentWindow().label

    return await invoke<boolean>('window_cursor_in_client_rect', {
      windowLabel,
      x: 0,
      y: 0,
      width: Math.max(1, windowSize.width),
      height,
    })
  } catch (error) {
    console.warn('[nebula] native Semi-Lunar trigger hit-test failed', error)
    return null
  }
}

/**
 * Ask Windows whether the real OS cursor is inside the *visible* Semi-Lunar
 * dome rather than merely inside the transparent rectangular Chrome WebView.
 *
 * The browsing dome uses `ellipse(50% 100% at 50% 0%)`, so pass its actual
 * logical lunar dimensions and let Rust perform the hit-test in the same
 * physical client coordinate space as GetCursorPos/ScreenToClient.
 */
export async function isCursorInsideSemiLunarNativeShape(
  lunarWidthPx: number,
  lunarHeightPx: number,
): Promise<boolean | null> {
  if (!isTauri || !isChromeShell()) return null
  if (!Number.isFinite(lunarWidthPx) || !Number.isFinite(lunarHeightPx)) return null

  try {
    const currentWindow = getCurrentWindow()
    return await invoke<boolean>('window_cursor_in_client_lunar_shape', {
      windowLabel: currentWindow.label,
      lunarWidthPx: Math.max(1, lunarWidthPx),
      lunarHeightPx: Math.max(1, lunarHeightPx),
    })
  } catch (error) {
    console.warn('[nebula] native Semi-Lunar shape hit-test failed', error)
    return null
  }
}

async function syncChromeBounds(webview: Webview): Promise<void> {
  chromeBoundsDirty = true
  if (!chromeBoundsSyncPromise) {
    chromeBoundsSyncPromise = (async () => {
      while (chromeBoundsDirty) {
        chromeBoundsDirty = false
        // Read shared state only when the operation starts, so an older hover
        // request cannot overwrite a newer compact-bounds request.
        const { position, size, clientSize } = await chromePhysicalBounds()
        if (!hasUsableWindowClientSize(clientSize) || await getCurrentWindow().isMinimized()) continue
        const key = `${position.x},${position.y},${size.width},${size.height}`
        if (lastChromeBoundsKey === key) continue

        try {
          const applied = await invoke<boolean>('webview_set_chrome_bounds', {
            windowLabel: getCurrentWindow().label,
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
          })
          if (!applied) throw new Error('atomic chrome bounds unavailable')
        } catch (error) {
          if (import.meta.env.DEV) {
            console.warn('[nebula] atomic chrome bounds failed; using Webview fallback', error)
          }
          await webview.setPosition(position)
          await webview.setSize(size)
        }
        if (!chromeAutoResizeDisabled) {
          await webview.setAutoResize(false)
          chromeAutoResizeDisabled = true
        }
        lastChromeBoundsKey = key
      }
      // The menu opening or closing, a preview and a panel all change what the clip may be.
      await applyChromeClip()
    })().finally(() => {
      chromeBoundsSyncPromise = null
      if (chromeBoundsDirty) void syncChromeBounds(webview)
    })
  }
  await chromeBoundsSyncPromise
}

function unbindResizeListeners(): void {
  resizeDebounceCancel?.()
  resizeDebounceCancel = null
  resizeUnlisten?.()
  resizeUnlisten = null
  scaleUnlisten?.()
  scaleUnlisten = null
  focusUnlisten?.()
  focusUnlisten = null
  chromeBoundsListenerBound = false
}

async function bindChromeResize(webview: Webview): Promise<void> {
  unbindResizeListeners()
  activeChromeWebview = webview
  lastChromeBoundsKey = null
  chromeBoundsListenerBound = true

  const onLayoutChange = debounce(() => {
    // Equal cached dimensions do not prove that the controller survived
    // minimize/restore. Reapply from ChromeApp's own overlay state.
    lastChromeBoundsKey = null
    void syncChromeBounds(webview)
  }, LAYOUT_DEBOUNCE_MS)

  await syncChromeBounds(webview)

  const appWindow = getCurrentWindow()
  let nextResizeUnlisten: (() => void) | null = null
  try {
    nextResizeUnlisten = await appWindow.onResized(onLayoutChange)
    const nextScaleUnlisten = await appWindow.onScaleChanged(onLayoutChange)
    resizeUnlisten = nextResizeUnlisten
    scaleUnlisten = nextScaleUnlisten
    focusUnlisten = await appWindow.onFocusChanged(({ payload: focused }) => {
      if (focused) onLayoutChange()
    })
    resizeDebounceCancel = onLayoutChange.cancel
  } catch (error) {
    onLayoutChange.cancel()
    nextResizeUnlisten?.()
    scaleUnlisten?.()
    scaleUnlisten = null
    chromeBoundsListenerBound = false
    throw error
  }
}

async function waitForWebviewCreated(webview: Webview): Promise<void> {
  await waitForTauriCreated(webview, 'chrome webview', 10_000)
}

export function setChromeWebviewHeight(logicalHeight: number): void {
  chromeOverlayLogicalHeight = Math.max(1, logicalHeight)
}

/** Keep transient chrome UI visible without changing Semi-Lunar's own layout. */
export async function setChromeOverlayMinimumLogicalHeight(
  logicalHeight: number,
): Promise<void> {
  chromeOverlayMinimumLogicalHeight = Math.max(0, logicalHeight)
  const webview = await getChromeWebview()
  if (!webview) return
  await syncChromeBounds(webview)
}

/**
 * Size the dedicated chrome WebView to the current chrome height. It remains
 * full-client width so every point on the top edge can open Semi-Lunar. Home
 * and browser WebViews stay underneath; this floating surface never pushes
 * site content down.
 */
export async function setChromeOverlayLogicalBounds(
  logicalHeight: number,
  logicalWidth?: number,
  fullHeight = false,
): Promise<void> {
  if (!isTauri) return

  chromeOverlayLogicalHeight = Math.max(1, logicalHeight)
  chromeOverlayFullHeight = fullHeight
  if (logicalWidth !== undefined && Number.isFinite(logicalWidth)) {
    chromeOverlayLogicalWidth = Math.max(1, logicalWidth)
  }

  const webview = await getChromeWebview()
  if (!webview) return

  if (!chromeBoundsListenerBound) {
    await bindChromeResize(webview)
  }

  await syncChromeBounds(webview)
}

export async function syncChromeWebviewBounds(): Promise<void> {
  // The main/Home JS context has different module state. Let only ChromeApp
  // reapply the floating overlay bounds; otherwise main would race it back to
  // the tiny bootstrap rectangle after window/fullscreen changes.
  if (!isTauri || !isChromeShell()) return

  const webview = await getChromeWebview()
  if (!webview) return

  await syncChromeBounds(webview)
}

export async function getChromeWebview(): Promise<Webview | null> {
  if (!isTauri) return null

  if (isChromeShell()) {
    try {
      const current = getCurrentWebview()
      activeChromeWebview = current
      return current
    } catch {
      // fall through
    }
  }

  const webview =
    activeChromeWebview ?? (await Webview.getByLabel(chromeWebviewLabel()))
  if (webview) {
    activeChromeWebview = webview
  }
  return webview
}

/**
 * Force the native chrome child back to a shallow top strip.
 *
 * BrowserShell and ChromeApp have separate JS module state. During a
 * fullscreen handoff, stale hover-preview state in ChromeApp can otherwise
 * leave this transparent WebView full-height and intercept site clicks.
 */
export async function forceChromeWebviewCompactBounds(): Promise<void> {
  if (!isTauri) return

  const webview =
    await Webview.getByLabel(
      chromeWebviewLabel(),
    )

  if (!webview) return

  const windowSize =
    await windowClientPhysicalSize()
  const scaleFactor =
    await getCurrentWindow()
      .scaleFactor()

  const width = Math.max(1, windowSize.width)
  const height =
    Math.max(
      1,
      Math.min(
        windowSize.height,
        Math.ceil(
          SEMI_LUNAR_HIT_ZONE_HEIGHT *
            scaleFactor,
        ),
      ),
    )
  try {
    const applied = await invoke<boolean>('webview_set_chrome_bounds', {
      windowLabel: getCurrentWindow().label,
      x: 0,
      y: 0,
      width,
      height,
    })
    if (!applied) throw new Error('atomic chrome bounds unavailable')
  } catch {
    await webview.setPosition(new PhysicalPosition(0, 0))
    await webview.setSize(new PhysicalSize(width, height))
  }
  await webview.setAutoResize(
    false,
  )
}

export async function ensureChromeWebviewVisible(): Promise<void> {
  if (!isTauri || chromeVisibilitySuppressed) return

  const webview = await getChromeWebview()
  if (!webview) return

  await webview.show()
}

export async function showChromeWebview(
  logicalHeight: number,
  options?: ShowChromeWebviewOptions,
): Promise<void> {
  if (!isTauri) return

  if (chromeVisibilitySuppressed) {
    const existing = await Webview.getByLabel(chromeWebviewLabel())
    if (existing) await existing.hide()
    return
  }

  setChromeWebviewHeight(logicalHeight)

  const appWindow = getCurrentWindow()
  let webview = await Webview.getByLabel(chromeWebviewLabel())
  const bounds = await chromePhysicalBounds()

  if (!webview) {
    try {
      if (await shellSplitEnabled()) {
        // SPIKE: a JS-created webview cannot be placed in the trusted folder.
        await invoke('shell_chrome_webview_create', {
          windowLabel: appWindow.label,
          label: chromeWebviewLabel(),
          url: chromeWebviewUrl(),
          x: bounds.position.x,
          y: bounds.position.y,
          width: bounds.size.width,
          height: bounds.size.height,
        })
        webview = await Webview.getByLabel(chromeWebviewLabel())
        if (!webview) throw new Error('chrome webview missing after native creation')
      } else {
        const webviewOptions: ExtensionEnabledWebviewOptions = {
          url: chromeWebviewUrl(),
          x: bounds.position.x,
          y: bounds.position.y,
          width: bounds.size.width,
          height: bounds.size.height,
          transparent: true,
          focus: false,
          browserExtensionsEnabled: true,
        }
        webview = new Webview(appWindow, chromeWebviewLabel(), webviewOptions)
        await waitForWebviewCreated(webview)
      }
      chromeAutoResizeDisabled = false
      await invoke('webview_setup_branding', { label: chromeWebviewLabel() })
    } catch {
      webview = await Webview.getByLabel(chromeWebviewLabel())
      if (!webview) throw new Error('failed to create chrome webview')
      await invoke('webview_setup_branding', { label: chromeWebviewLabel() })
    }
  } else {
    activeChromeWebview = webview
  }

  // Idempotent repair for an already-created chrome WebView: native browser
  // UI must remain suppressed even if the surface was created very early.
  await invoke('webview_setup_branding', { label: chromeWebviewLabel() })

  // Existing chrome keeps the bounds last published by ChromeApp. Never
  // resize it from the main/Home JS context: that context has a separate copy
  // of this module state and would race the overlay back to bootstrap size on
  // every Home/Browsing transition.
  await webview.show()

  if (
    options?.stack !==
    false
  ) {
    await stackBrowsingChromeAboveBrowser(
      getActiveBrowseTabId(),
    )
  }
}


/**
 * Temporarily hide the dedicated Chrome surface while a modal owned by the
 * main WebView is open. The flag lives in the main JS context, so concurrent
 * Home/Browsing transitions cannot immediately show Chrome again. Bounds are
 * deliberately preserved; ChromeApp remains the sole owner of its geometry.
 */
export async function setChromeWebviewSuppressed(suppressed: boolean): Promise<void> {
  if (!isTauri) return

  const requestSequence = ++chromeVisibilityRequestSequence
  chromeVisibilitySuppressed = suppressed
  const webview = await Webview.getByLabel(chromeWebviewLabel())
  if (requestSequence !== chromeVisibilityRequestSequence) return

  if (chromeVisibilitySuppressed) {
    if (webview) await webview.hide()
    return
  }

  // Lifting a panel's suppression must not bring Semi-Lunar back over the overlay menu: that menu
  // hides it on purpose, and a surface that comes back with its old tall bounds covers the menu's
  // buttons. Leaving the overlay shows it again through the normal mode change.
  if (isOverlayModeActive()) return

  if (!webview) {
    await showChromeWebview(SEMI_LUNAR_HIT_ZONE_HEIGHT)
    if (
      requestSequence !== chromeVisibilityRequestSequence ||
      chromeVisibilitySuppressed
    ) {
      const createdWebview = await Webview.getByLabel(chromeWebviewLabel())
      if (createdWebview && chromeVisibilitySuppressed) await createdWebview.hide()
    }
    return
  }

  await webview.show()
  if (requestSequence !== chromeVisibilityRequestSequence) return
  await stackBrowsingChromeAboveBrowser(getActiveBrowseTabId())
}

export async function hideChromeWebview(): Promise<void> {
  if (!isTauri) return

  unbindResizeListeners()
  activeChromeWebview = null
  lastChromeBoundsKey = null
  chromeAutoResizeDisabled = false
  chromeOverlayFullHeight = false
  chromeOverlayLogicalWidth = null
  chromeOverlayLogicalHeight = SEMI_LUNAR_HIT_ZONE_HEIGHT

  const webview = await Webview.getByLabel(chromeWebviewLabel())
  if (webview) {
    await webview.hide()
  }
}
