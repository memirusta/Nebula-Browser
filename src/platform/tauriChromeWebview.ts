import { invoke } from '@tauri-apps/api/core'
import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi'
import { Webview, getCurrentWebview, type WebviewOptions } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { SEMI_LUNAR_HIT_ZONE_HEIGHT } from '../core/windowChrome'
import { debounce } from './debounce'
import { getActiveBrowseTabId, syncTauriBrowserBounds } from './tauriBrowser'
import { isChromeShell } from '../core/nebulaBridge'
import {
  BROWSER_WINDOW_ID_QUERY,
  currentBrowserWindowId,
  currentChromeWebviewLabel,
} from './browserWindowScope'
import { isTauri } from './runtime'
import {
  scheduleStackBrowsingChromeAboveBrowser,
  stackBrowsingChromeAboveBrowser,
} from './tauriWebviewStack'
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
let lastChromeBoundsKey: string | null = null
// Physical Semi-Lunar bounds are owned only by the #chrome context. The main
// WebView creates/shows the child, but must not keep a competing resize listener.
let chromeBoundsListenerBound = false
let chromeOverlayLogicalWidth: number | null = null
let chromeOverlayLogicalHeight = SEMI_LUNAR_HIT_ZONE_HEIGHT
let chromeOverlayMinimumLogicalHeight = 0
// Hover preview needs the full client height for its centered card, but its
// width stays compact and centered. Resizing the chrome WebView from compact
// width to full width made WebView2 briefly reflow its surface and visibly
// nudged the Semi-Lunar sideways.
let chromeOverlayFullHeight = false
let chromeVisibilitySuppressed = false
let chromeVisibilityRequestSequence = 0
let chromeBoundsSyncQueue: Promise<void> = Promise.resolve()

// Semi-Lunar uses max-width: 98vw. Give its dedicated WebView a tiny logical
// gutter so a requested 1100px lunar still has 1100px available inside the
// overlay viewport instead of being shrunk to 98% of itself.
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

async function chromePhysicalBounds(): Promise<{
  position: PhysicalPosition
  size: PhysicalSize
}> {
  const windowSize = await windowClientPhysicalSize()

  const scaleFactor = await getCurrentWindow().scaleFactor()
  const requestedLogicalWidth = Math.max(1, chromeOverlayLogicalWidth ?? 1100)
  const requestedPhysicalWidth = Math.ceil(
    (requestedLogicalWidth + CHROME_OVERLAY_WIDTH_GUTTER) * scaleFactor,
  )
  const requestedPhysicalHeight = Math.ceil(
    Math.max(1, chromeOverlayLogicalHeight, chromeOverlayMinimumLogicalHeight) * scaleFactor,
  )

  const width = Math.max(1, Math.min(windowSize.width, requestedPhysicalWidth))
  const height = chromeOverlayFullHeight
    ? Math.max(1, windowSize.height)
    : Math.max(1, Math.min(windowSize.height, requestedPhysicalHeight))
  const x = Math.max(0, Math.round((windowSize.width - width) / 2))

  return {
    position: new PhysicalPosition(x, 0),
    size: new PhysicalSize(width, height),
  }
}

async function syncChromeBounds(webview: Webview): Promise<boolean> {
  let changed = false

  const applyLatestBounds = async () => {
    // Read the shared target state only when this queued operation starts. A
    // rapid hover enter/leave can otherwise let an older async resize finish
    // after the newer compact-bounds request.
    const { position, size } = await chromePhysicalBounds()
    const key = `${position.x},${position.y},${size.width},${size.height}`
    if (lastChromeBoundsKey === key) return

    let appliedAtomically = false
    try {
      appliedAtomically = await invoke<boolean>('webview_set_chrome_bounds', {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
      })
    } catch (error) {
      console.warn('[nebula] atomic chrome bounds failed; using Webview fallback', error)
    }

    // Keep the existing cross-platform fallback. Windows uses one SetWindowPos
    // call above so the compositor never sees mismatched position/size frames.
    if (!appliedAtomically) {
      await webview.setPosition(position)
      await webview.setSize(size)
    }
    await webview.setAutoResize(false)
    lastChromeBoundsKey = key
    changed = true
  }

  const queued = chromeBoundsSyncQueue.then(applyLatestBounds, applyLatestBounds)
  chromeBoundsSyncQueue = queued.then(
    () => undefined,
    () => undefined,
  )
  await queued
  return changed
}

function unbindResizeListeners(): void {
  resizeUnlisten?.()
  resizeUnlisten = null
  scaleUnlisten?.()
  scaleUnlisten = null
  chromeBoundsListenerBound = false
}

async function bindChromeResize(webview: Webview): Promise<void> {
  unbindResizeListeners()
  activeChromeWebview = webview
  lastChromeBoundsKey = null
  chromeBoundsListenerBound = true

  const onLayoutChange = debounce(() => {
    void syncChromeBounds(webview).then(async (changed) => {
      if (!changed) return
      await syncTauriBrowserBounds()
      scheduleStackBrowsingChromeAboveBrowser(getActiveBrowseTabId())
    })
  }, LAYOUT_DEBOUNCE_MS)

  await syncChromeBounds(webview)

  const appWindow = getCurrentWindow()
  resizeUnlisten = await appWindow.onResized(onLayoutChange)
  scaleUnlisten = await appWindow.onScaleChanged(onLayoutChange)
}

async function waitForWebviewCreated(webview: Webview): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('chrome webview create timeout'))
    }, 10_000)

    const done = () => clearTimeout(timeout)

    webview.once('tauri://created', () => {
      done()
      resolve()
    })
    webview.once('tauri://error', (event) => {
      done()
      reject(event)
    })
  })
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
 * Size the dedicated chrome WebView to the Semi-Lunar itself. Home and browser
 * WebViews stay full-client underneath; this is a floating overlay, not layout
 * chrome, so it never pushes site content down.
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

  const changed = await syncChromeBounds(webview)
  if (changed) {
    scheduleStackBrowsingChromeAboveBrowser(getActiveBrowseTabId(), 0)
  }
}

export async function syncChromeWebviewBounds(): Promise<void> {
  // The main/Home JS context has different module state. Let only ChromeApp
  // reapply the floating overlay bounds; otherwise main would race it back to
  // the tiny bootstrap rectangle after window/fullscreen changes.
  if (!isTauri || !isChromeShell()) return

  const webview = await getChromeWebview()
  if (!webview) return

  const changed = await syncChromeBounds(webview)
  if (changed) {
    await syncTauriBrowserBounds()
    scheduleStackBrowsingChromeAboveBrowser(getActiveBrowseTabId())
  }
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
 * leave this transparent WebView full-client and intercept site clicks.
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

  const requestedLogicalWidth =
    chromeOverlayLogicalWidth ??
    1100
  const width =
    Math.max(
      1,
      Math.min(
        windowSize.width,
        Math.ceil(
          (
            requestedLogicalWidth +
            CHROME_OVERLAY_WIDTH_GUTTER
          ) *
            scaleFactor,
        ),
      ),
    )
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
  const x =
    Math.max(
      0,
      Math.round(
        (
          windowSize.width -
          width
        ) /
          2,
      ),
    )

  await webview.setPosition(
    new PhysicalPosition(
      x,
      0,
    ),
  )
  await webview.setSize(
    new PhysicalSize(
      width,
      height,
    ),
  )
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
  chromeOverlayFullHeight = false
  chromeOverlayLogicalWidth = null
  chromeOverlayLogicalHeight = SEMI_LUNAR_HIT_ZONE_HEIGHT

  const webview = await Webview.getByLabel(chromeWebviewLabel())
  if (webview) {
    await webview.hide()
  }
}
