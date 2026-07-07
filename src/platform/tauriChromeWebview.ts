import { invoke } from '@tauri-apps/api/core'
import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi'
import { Webview, getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { TITLE_BAR_HEIGHT } from '../core/windowChrome'
import { debounce } from './debounce'
import { getActiveBrowseTabId, syncTauriBrowserBounds } from './tauriBrowser'
import { isChromeShell } from '../core/nebulaBridge'
import { isTauri } from './runtime'
import {
  scheduleStackBrowsingChromeAboveBrowser,
  stackBrowsingChromeAboveBrowser,
} from './tauriWebviewStack'
import {
  logicalHeightToPhysical,
  windowClientPhysicalSize,
} from './windowClientBounds'

import {
  getBrowsingChromeLogicalHeight,
  resetBrowsingChromeLogicalHeight,
  setBrowsingChromeLogicalHeight,
} from './browsingLayout'

export const CHROME_WEBVIEW_LABEL = 'nebula-chrome'
const LAYOUT_DEBOUNCE_MS = 120

let activeChromeWebview: Webview | null = null
let resizeUnlisten: (() => void) | null = null
let scaleUnlisten: (() => void) | null = null
let lastChromeBoundsKey: string | null = null

function chromeWebviewUrl(): string {
  return `${window.location.origin}${window.location.pathname}#chrome`
}

async function chromePhysicalSize(): Promise<PhysicalSize> {
  const appWindow = getCurrentWindow()
  const [windowSize, scale] = await Promise.all([
    windowClientPhysicalSize(),
    appWindow.scaleFactor(),
  ])
  const height = Math.min(
    logicalHeightToPhysical(getBrowsingChromeLogicalHeight(), scale),
    windowSize.height,
  )

  return new PhysicalSize(windowSize.width, height)
}

async function syncChromeBounds(webview: Webview): Promise<boolean> {
  const size = await chromePhysicalSize()
  const key = `${size.width},${size.height}`
  if (lastChromeBoundsKey === key) return false

  lastChromeBoundsKey = key
  await webview.setPosition(new PhysicalPosition(0, 0))
  await webview.setSize(size)
  await webview.setAutoResize(false)
  return true
}

function unbindResizeListeners(): void {
  resizeUnlisten?.()
  resizeUnlisten = null
  scaleUnlisten?.()
  scaleUnlisten = null
}

async function bindChromeResize(webview: Webview): Promise<void> {
  unbindResizeListeners()
  activeChromeWebview = webview
  lastChromeBoundsKey = null

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
  setBrowsingChromeLogicalHeight(logicalHeight)
  lastChromeBoundsKey = null
}

export function getChromeWebviewLogicalHeight(): number {
  return getBrowsingChromeLogicalHeight()
}

export async function syncChromeWebviewBounds(): Promise<void> {
  if (!isTauri) return

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
  if (!isTauri) return

  const webview = await getChromeWebview()
  if (!webview) return

  await webview.show()
}

export async function showChromeWebview(logicalHeight: number): Promise<void> {
  if (!isTauri) return

  setChromeWebviewHeight(logicalHeight)

  const appWindow = getCurrentWindow()
  let webview = await Webview.getByLabel(CHROME_WEBVIEW_LABEL)
  const size = await chromePhysicalSize()

  if (!webview) {
    try {
      webview = new Webview(appWindow, CHROME_WEBVIEW_LABEL, {
        url: chromeWebviewUrl(),
        x: 0,
        y: 0,
        width: size.width,
        height: size.height,
        transparent: true,
        focus: false,
      })
      await waitForWebviewCreated(webview)
    } catch {
      webview = await Webview.getByLabel(CHROME_WEBVIEW_LABEL)
      if (!webview) throw new Error('failed to create chrome webview')
    }
    await bindChromeResize(webview)
  } else {
    activeChromeWebview = webview
    await bindChromeResize(webview)
  }

  await webview.show()
  await stackBrowsingChromeAboveBrowser(getActiveBrowseTabId())
}

export async function hideChromeWebview(): Promise<void> {
  if (!isTauri) return

  unbindResizeListeners()
  activeChromeWebview = null
  lastChromeBoundsKey = null
  resetBrowsingChromeLogicalHeight()

  const webview = await Webview.getByLabel(CHROME_WEBVIEW_LABEL)
  if (webview) {
    await webview.hide()
  }

  await invoke('webview_set_chrome_hit_region', { logicalHeight: null })
}

export async function expandChromeForQuickMenu(): Promise<boolean> {
  if (!isTauri) return false

  setChromeWebviewHeight(window.innerHeight)
  lastChromeBoundsKey = null

  const webview = await getChromeWebview()
  if (!webview) return false

  const size = await chromePhysicalSize()
  await webview.setPosition(new PhysicalPosition(0, 0))
  await webview.setSize(size)
  await webview.setAutoResize(false)
  lastChromeBoundsKey = `${size.width},${size.height}`

  await invoke('webview_set_chrome_hit_region', { logicalHeight: window.innerHeight })
  await webview.show()
  return true
}

export async function collapseChromeFromQuickMenu(): Promise<void> {
  if (!isTauri) return

  setChromeWebviewHeight(TITLE_BAR_HEIGHT)
  lastChromeBoundsKey = null

  const webview = await getChromeWebview()
  if (!webview) return

  const size = await chromePhysicalSize()
  await webview.setPosition(new PhysicalPosition(0, 0))
  await webview.setSize(size)
  await webview.setAutoResize(false)
  lastChromeBoundsKey = `${size.width},${size.height}`

  await invoke('webview_set_chrome_hit_region', { logicalHeight: TITLE_BAR_HEIGHT })
  await webview.show()
}
