import { invoke } from '@tauri-apps/api/core'
import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi'
import { Webview, getCurrentWebview, type WebviewOptions } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { SEMI_LUNAR_HIT_ZONE_HEIGHT, TITLE_BAR_HEIGHT } from '../core/windowChrome'
import { debounce } from './debounce'
import { getActiveBrowseTabId, syncTauriBrowserBounds } from './tauriBrowser'
import { isChromeShell } from '../core/nebulaBridge'
import { isTauri } from './runtime'
import {
  scheduleStackBrowsingChromeAboveBrowser,
  stackBrowsingChromeAboveBrowser,
} from './tauriWebviewStack'
import { windowClientPhysicalSize } from './windowClientBounds'

import {
  getBrowsingChromeLogicalHeight,
  resetBrowsingChromeLogicalHeight,
  setBrowsingChromeLogicalHeight,
} from './browsingLayout'

export const CHROME_WEBVIEW_LABEL = 'nebula-chrome'
const LAYOUT_DEBOUNCE_MS = 120

type ExtensionEnabledWebviewOptions = WebviewOptions & {
  browserExtensionsEnabled: boolean
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
let chromeOverlayFullClient = false
let chromeVisibilitySuppressed = false

// Semi-Lunar uses max-width: 98vw. Give its dedicated WebView a tiny logical
// gutter so a requested 1100px lunar still has 1100px available inside the
// overlay viewport instead of being shrunk to 98% of itself.
const CHROME_OVERLAY_WIDTH_GUTTER = 32

function chromeWebviewUrl(): string {
  return `${window.location.origin}${window.location.pathname}#chrome`
}

async function chromePhysicalBounds(): Promise<{
  position: PhysicalPosition
  size: PhysicalSize
}> {
  const windowSize = await windowClientPhysicalSize()
  if (chromeOverlayFullClient) {
    return {
      position: new PhysicalPosition(0, 0),
      size: new PhysicalSize(windowSize.width, windowSize.height),
    }
  }

  const scaleFactor = await getCurrentWindow().scaleFactor()
  const requestedLogicalWidth = Math.max(1, chromeOverlayLogicalWidth ?? 1)
  const requestedPhysicalWidth = Math.ceil(
    (requestedLogicalWidth + CHROME_OVERLAY_WIDTH_GUTTER) * scaleFactor,
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

async function syncChromeBounds(webview: Webview): Promise<boolean> {
  const { position, size } = await chromePhysicalBounds()
  const key = `${position.x},${position.y},${size.width},${size.height}`
  if (lastChromeBoundsKey === key) return false

  lastChromeBoundsKey = key
  await webview.setPosition(position)
  await webview.setSize(size)
  await webview.setAutoResize(false)
  return true
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
  setBrowsingChromeLogicalHeight(logicalHeight)
}

/**
 * Size the dedicated chrome WebView to the Semi-Lunar itself. Home and browser
 * WebViews stay full-client underneath; this is a floating overlay, not layout
 * chrome, so it never pushes site content down.
 */
export async function setChromeOverlayLogicalBounds(
  logicalHeight: number,
  logicalWidth?: number,
): Promise<void> {
  if (!isTauri) return

  chromeOverlayFullClient = false
  chromeOverlayLogicalHeight = Math.max(1, logicalHeight)
  if (logicalWidth !== undefined && Number.isFinite(logicalWidth)) {
    chromeOverlayLogicalWidth = Math.max(1, logicalWidth)
  }
  setBrowsingChromeLogicalHeight(logicalHeight)

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

export function getChromeWebviewLogicalHeight(): number {
  return getBrowsingChromeLogicalHeight()
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
    activeChromeWebview ?? (await Webview.getByLabel(CHROME_WEBVIEW_LABEL))
  if (webview) {
    activeChromeWebview = webview
  }
  return webview
}

export async function ensureChromeWebviewVisible(): Promise<void> {
  if (!isTauri || chromeVisibilitySuppressed) return

  const webview = await getChromeWebview()
  if (!webview) return

  await webview.show()
}

export async function showChromeWebview(logicalHeight: number): Promise<void> {
  if (!isTauri) return

  if (chromeVisibilitySuppressed) {
    const existing = await Webview.getByLabel(CHROME_WEBVIEW_LABEL)
    if (existing) await existing.hide()
    return
  }

  setChromeWebviewHeight(logicalHeight)

  const appWindow = getCurrentWindow()
  let webview = await Webview.getByLabel(CHROME_WEBVIEW_LABEL)
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
      webview = new Webview(appWindow, CHROME_WEBVIEW_LABEL, webviewOptions)
      await waitForWebviewCreated(webview)
      await invoke('webview_setup_branding', { label: CHROME_WEBVIEW_LABEL })
    } catch {
      webview = await Webview.getByLabel(CHROME_WEBVIEW_LABEL)
      if (!webview) throw new Error('failed to create chrome webview')
      await invoke('webview_setup_branding', { label: CHROME_WEBVIEW_LABEL })
    }
  } else {
    activeChromeWebview = webview
  }

  // Existing chrome keeps the bounds last published by ChromeApp. Never
  // resize it from the main/Home JS context: that context has a separate copy
  // of this module state and would race the overlay back to bootstrap size on
  // every Home/Browsing transition.
  await webview.show()
  await stackBrowsingChromeAboveBrowser(getActiveBrowseTabId())
}


/**
 * Temporarily hide the dedicated Chrome surface while a modal owned by the
 * main WebView is open. The flag lives in the main JS context, so concurrent
 * Home/Browsing transitions cannot immediately show Chrome again. Bounds are
 * deliberately preserved; ChromeApp remains the sole owner of its geometry.
 */
export async function setChromeWebviewSuppressed(suppressed: boolean): Promise<void> {
  if (!isTauri) return

  chromeVisibilitySuppressed = suppressed
  const webview = await Webview.getByLabel(CHROME_WEBVIEW_LABEL)
  if (!webview) return

  if (suppressed) {
    await webview.hide()
    return
  }

  await webview.show()
  await stackBrowsingChromeAboveBrowser(getActiveBrowseTabId())
}

export async function hideChromeWebview(): Promise<void> {
  if (!isTauri) return

  unbindResizeListeners()
  activeChromeWebview = null
  lastChromeBoundsKey = null
  chromeOverlayLogicalWidth = null
  chromeOverlayLogicalHeight = SEMI_LUNAR_HIT_ZONE_HEIGHT
  chromeOverlayFullClient = false
  resetBrowsingChromeLogicalHeight()

  const webview = await Webview.getByLabel(CHROME_WEBVIEW_LABEL)
  if (webview) {
    await webview.hide()
  }
}

export async function expandChromeForQuickMenu(): Promise<boolean> {
  if (!isTauri) return false

  chromeOverlayFullClient = true
  const webview = await getChromeWebview()
  if (!webview) return false

  lastChromeBoundsKey = null
  await syncChromeBounds(webview)
  await webview.show()
  return true
}

export async function collapseChromeFromQuickMenu(): Promise<void> {
  if (!isTauri) return

  chromeOverlayFullClient = false
  setChromeWebviewHeight(Math.max(TITLE_BAR_HEIGHT, SEMI_LUNAR_HIT_ZONE_HEIGHT))

  const webview = await getChromeWebview()
  if (!webview) return

  lastChromeBoundsKey = null
  await syncChromeBounds(webview)
  await webview.show()
}
