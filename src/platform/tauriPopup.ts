import { invoke } from '@tauri-apps/api/core'
import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi'
import { Webview, type WebviewOptions } from '@tauri-apps/api/webview'
import { Window } from '@tauri-apps/api/window'
import type { SiteNewWindowPayload } from './tauriSiteUi'
import {
  configurePopupBrowseWebview,
  teardownPopupBrowseWebview,
} from './tauriBrowser'
import { isTauri } from './runtime'
import {
  POPUP_CONTENT_PREFIX,
  POPUP_WINDOW_PREFIX,
} from './popupShell'

export { isPopupContentLabel } from './popupShell'
const DEFAULT_POPUP_CONTENT_WIDTH = 520
const DEFAULT_POPUP_CONTENT_HEIGHT = 680
const MIN_POPUP_WIDTH = 240
const MIN_POPUP_CONTENT_HEIGHT = 120
const CREATE_TIMEOUT_MS = 10_000

type ExtensionWebviewOptions = WebviewOptions & {
  browserExtensionsEnabled: boolean
}

interface PopupRuntime {
  requestId: string
  window: Window
  content: Webview | null
  contentLabel: string
  attached: boolean
  configured: boolean
  closing: boolean
  unlistenResize: (() => void) | null
  unlistenScale: (() => void) | null
  unlistenClose: (() => void) | null
}

const popupByContentLabel = new Map<string, PopupRuntime>()

function safeLabelSuffix(requestId: string): string {
  const clean = requestId.replace(/[^A-Za-z0-9-]/g, '-')
  return clean || `popup-${Date.now()}`
}

function waitForCreated(
  target: Window | Webview,
  description: string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error(`${description} create timeout`))
    }, CREATE_TIMEOUT_MS)

    const finish = () => window.clearTimeout(timeout)

    void target.once('tauri://created', () => {
      finish()
      resolve()
    })

    void target.once('tauri://error', (event) => {
      finish()
      reject(event.payload)
    })
  })
}

async function layoutPopup(runtime: PopupRuntime): Promise<void> {
  if (!runtime.content) return

  const size = await runtime.window.innerSize()

  await Promise.all([
    runtime.content.setPosition(new PhysicalPosition(0, 0)),
    runtime.content.setSize(new PhysicalSize(size.width, Math.max(1, size.height))),
  ])
}

async function cancelPendingRequest(requestId: string): Promise<void> {
  try {
    await invoke('site_popup_cancel', { requestId })
  } catch {
    // The native request may already have been attached or timed out.
  }
}

async function teardownRuntime(runtime: PopupRuntime): Promise<void> {
  if (runtime.closing) return
  runtime.closing = true

  runtime.unlistenResize?.()
  runtime.unlistenScale?.()
  runtime.unlistenClose?.()
  runtime.unlistenResize = null
  runtime.unlistenScale = null
  runtime.unlistenClose = null
  popupByContentLabel.delete(runtime.contentLabel)

  if (!runtime.attached) {
    await cancelPendingRequest(runtime.requestId)
  }

  if (runtime.configured) {
    try {
      await teardownPopupBrowseWebview(runtime.contentLabel)
    } catch {
      // The window may already be tearing down. Native teardown is best effort.
    }
    runtime.configured = false
  }
}

function requestedPopupGeometry(payload: SiteNewWindowPayload): {
  width: number
  height: number
  x?: number
  y?: number
  center: boolean
} {
  const contentWidth = payload.features.hasSize && payload.features.width > 0
    ? payload.features.width
    : DEFAULT_POPUP_CONTENT_WIDTH
  const contentHeight = payload.features.hasSize && payload.features.height > 0
    ? payload.features.height
    : DEFAULT_POPUP_CONTENT_HEIGHT

  const geometry: {
    width: number
    height: number
    x?: number
    y?: number
    center: boolean
  } = {
    width: Math.max(MIN_POPUP_WIDTH, contentWidth),
    height: Math.max(MIN_POPUP_CONTENT_HEIGHT, contentHeight),
    center: !payload.features.hasPosition,
  }

  if (payload.features.hasPosition) {
    geometry.x = payload.features.left
    geometry.y = payload.features.top
  }

  return geometry
}

/**
 * Create the native Nebula popup surface for a real WebView2 NewWindow request.
 * The content WebView intentionally has no URL: WebView2 owns its first
 * navigation after site_popup_attach binds it to the opener's request.
 */
export async function openSitePopup(
  payload: SiteNewWindowPayload,
): Promise<void> {
  if (!isTauri) return

  const suffix = safeLabelSuffix(payload.requestId)
  const windowLabel = `${POPUP_WINDOW_PREFIX}${suffix}`
  const contentLabel = `${POPUP_CONTENT_PREFIX}${suffix}`
  const geometry = requestedPopupGeometry(payload)

  const staleWindow = await Window.getByLabel(windowLabel)
  if (staleWindow) {
    await staleWindow.destroy().catch(() => undefined)
  }

  const popupWindow = new Window(windowLabel, {
    title: '',
    width: geometry.width,
    height: geometry.height,
    ...(geometry.x === undefined ? {} : { x: geometry.x }),
    ...(geometry.y === undefined ? {} : { y: geometry.y }),
    center: geometry.center,
    preventOverflow: true,
    decorations: true,
    resizable: true,
    maximizable: false,
    minimizable: false,
    closable: true,
    visible: false,
    focus: true,
    parent: 'main',
    shadow: true,
    theme: 'dark',
    backgroundColor: [17, 18, 20, 255],
  })

  const runtime: PopupRuntime = {
    requestId: payload.requestId,
    window: popupWindow,
    content: null,
    contentLabel,
    attached: false,
    configured: false,
    closing: false,
    unlistenResize: null,
    unlistenScale: null,
    unlistenClose: null,
  }

  try {
    await waitForCreated(popupWindow, 'popup window')

    const contentOptions: ExtensionWebviewOptions = {
      // Deliberately no `url`: NewWindowRequested requires an unnavigated
      // CoreWebView2 target and performs the initial navigation itself.
      x: 0,
      y: 0,
      width: geometry.width,
      height: geometry.height,
      focus: true,
      dragDropEnabled: false,
      incognito: payload.privateMode,
      browserExtensionsEnabled: true,
    }
    const content = new Webview(popupWindow, contentLabel, contentOptions)
    runtime.content = content
    await waitForCreated(content, 'popup content webview')

    await configurePopupBrowseWebview(contentLabel, payload.privateMode)
    runtime.configured = true

    popupByContentLabel.set(contentLabel, runtime)

    runtime.unlistenClose = await popupWindow.onCloseRequested(async (event) => {
      event.preventDefault()
      if (runtime.closing) return
      await teardownRuntime(runtime)
      await popupWindow.destroy().catch(() => undefined)
    })

    const relayout = () => {
      void layoutPopup(runtime).catch(() => undefined)
    }
    runtime.unlistenResize = await popupWindow.onResized(relayout)
    runtime.unlistenScale = await popupWindow.onScaleChanged(relayout)
    await layoutPopup(runtime)

    await invoke('site_popup_attach', {
      requestId: payload.requestId,
      popupLabel: contentLabel,
    })
    runtime.attached = true

    await popupWindow.show()
    await content.setFocus()
    await popupWindow.setFocus()
  } catch (error) {
    await teardownRuntime(runtime)
    await popupWindow.destroy().catch(() => undefined)
    throw error
  }
}

export async function closeSitePopupForContent(
  contentLabel: string,
): Promise<boolean> {
  const runtime = popupByContentLabel.get(contentLabel)
  if (!runtime) return false

  await runtime.window.close()
  return true
}
