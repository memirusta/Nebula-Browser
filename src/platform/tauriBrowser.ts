import { invoke } from '@tauri-apps/api/core'
import { Webview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { tabWebviewLabel } from '../core/browserTab'
import { debounce } from './debounce'
import { isTauri } from './runtime'
import {
  scheduleStackBrowsingChromeAboveBrowser,
  stackBrowsingChromeAboveBrowser,
} from './tauriWebviewStack'
import {
  browserWebviewFullscreenPhysicalBounds,
  browserWebviewPhysicalBounds,
} from './windowClientBounds'

const LEGACY_BROWSER_LABEL = 'nebula-browser'
const BROWSER_WEBVIEW_BG = '#000000'
const LAYOUT_DEBOUNCE_MS = 120

let activeTabId: string | null = null
let activeWebview: Webview | null = null
const webviewCache = new Map<string, Webview>()
const createdTabs = new Set<string>()
let resizeUnlisten: (() => void) | null = null
let scaleUnlisten: (() => void) | null = null
let lastBrowserBoundsKey: string | null = null
let siteFullscreenBounds = false

export function isSiteFullscreenBoundsActive(): boolean {
  return siteFullscreenBounds
}

export function setSiteFullscreenBoundsMode(active: boolean): void {
  siteFullscreenBounds = active
  lastBrowserBoundsKey = null
}

async function currentBrowserPhysicalBounds() {
  if (siteFullscreenBounds) {
    return browserWebviewFullscreenPhysicalBounds()
  }
  return browserWebviewPhysicalBounds()
}

function boundsKey(x: number, y: number, width: number, height: number): string {
  return `${x},${y},${width},${height}`
}

async function syncBrowserBounds(webview: Webview): Promise<boolean> {
  const { position, size } = await currentBrowserPhysicalBounds()
  const key = boundsKey(position.x, position.y, size.width, size.height)
  if (lastBrowserBoundsKey === key) return false

  lastBrowserBoundsKey = key
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
}

async function bindBrowserResize(webview: Webview): Promise<void> {
  unbindResizeListeners()
  activeWebview = webview
  lastBrowserBoundsKey = null

  const onLayoutChange = debounce(() => {
    void syncBrowserBounds(webview).then((changed) => {
      if (!changed || siteFullscreenBounds) return
      scheduleStackBrowsingChromeAboveBrowser(activeTabId)
    })
  }, LAYOUT_DEBOUNCE_MS)

  await syncBrowserBounds(webview)

  const appWindow = getCurrentWindow()
  resizeUnlisten = await appWindow.onResized(onLayoutChange)
  scaleUnlisten = await appWindow.onScaleChanged(onLayoutChange)
}

async function waitForWebviewCreated(webview: Webview): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('browser webview create timeout'))
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

async function hideLegacyBrowser(): Promise<void> {
  try {
    const legacy = await Webview.getByLabel(LEGACY_BROWSER_LABEL)
    if (legacy) await legacy.hide()
  } catch {
    // ignore
  }
}

async function hideWebviewSafe(webview: Webview): Promise<void> {
  try {
    await webview.hide()
  } catch {
    // already hidden or destroyed
  }
}

async function getOrCreateTabWebview(
  shortcutId: string,
  initialUrl: string,
  forceNavigate = false,
): Promise<Webview> {
  const label = tabWebviewLabel(shortcutId)
  let webview = webviewCache.get(shortcutId) ?? (await Webview.getByLabel(label))

  if (!webview) {
    const appWindow = getCurrentWindow()
    const { position, size } = await browserWebviewPhysicalBounds()

    try {
      webview = new Webview(appWindow, label, {
        url: 'about:blank',
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        focus: false,
        backgroundColor: BROWSER_WEBVIEW_BG,
      })
      await waitForWebviewCreated(webview)
      await invoke('webview_setup_tab_error_pages', { label })
      if (initialUrl && initialUrl !== 'about:blank') {
        await invoke('webview_navigate', { label, url: initialUrl })
      }
      createdTabs.add(shortcutId)
    } catch {
      webview = await Webview.getByLabel(label)
      if (!webview) throw new Error(`failed to create tab webview ${label}`)
      await invoke('webview_setup_tab_error_pages', { label })
      if (forceNavigate) {
        await invoke('webview_navigate', { label, url: initialUrl })
      }
      createdTabs.add(shortcutId)
    }

    webviewCache.set(shortcutId, webview)
  } else {
    webviewCache.set(shortcutId, webview)
    await invoke('webview_setup_tab_error_pages', { label })
    if (forceNavigate) {
      await invoke('webview_navigate', { label, url: initialUrl })
    }
  }

  return webview
}

async function hideOtherTabs(visibleId: string): Promise<void> {
  await Promise.all(
    [...webviewCache.entries()].map(async ([id, webview]) => {
      if (id === visibleId) return
      await hideWebviewSafe(webview)
    }),
  )
}

export async function activateBrowseTab(
  shortcutId: string,
  initialUrl: string,
  options?: { forceNavigate?: boolean },
): Promise<void> {
  if (!isTauri) return

  const forceNavigate = options?.forceNavigate ?? false
  const sameActiveTab = activeTabId === shortcutId

  await hideLegacyBrowser()

  const webview = await getOrCreateTabWebview(
    shortcutId,
    initialUrl,
    forceNavigate,
  )

  activeTabId = shortcutId
  await hideOtherTabs(shortcutId)

  if (sameActiveTab && !forceNavigate) {
    await webview.show()
    await stackBrowsingChromeAboveBrowser(shortcutId)
    return
  }

  await bindBrowserResize(webview)
  await webview.show()
  await stackBrowsingChromeAboveBrowser(shortcutId)
}

/** Create or navigate a tab webview without showing it or browsing chrome. */
export async function prepareBrowseTabInBackground(
  shortcutId: string,
  url: string,
  options?: { forceNavigate?: boolean },
): Promise<void> {
  if (!isTauri) return

  const forceNavigate = options?.forceNavigate ?? true
  await hideLegacyBrowser()

  const webview = await getOrCreateTabWebview(shortcutId, url, forceNavigate)
  await hideWebviewSafe(webview)
}

export async function syncTauriBrowserBounds(): Promise<void> {
  if (!isTauri || !activeWebview) return

  const changed = await syncBrowserBounds(activeWebview)
  if (changed) scheduleStackBrowsingChromeAboveBrowser(activeTabId)
}

/** Force tab HWND + Tauri bounds to match the window after layout transitions. */
export async function forceSyncActiveTabBounds(): Promise<void> {
  if (!isTauri || !activeWebview) return

  lastBrowserBoundsKey = null
  await syncBrowserBounds(activeWebview)
  await stackBrowsingChromeAboveBrowser(activeTabId)
}

export async function hideBrowseTabById(shortcutId: string): Promise<void> {
  if (!isTauri) return

  const cached = webviewCache.get(shortcutId)
  if (cached) {
    await hideWebviewSafe(cached)
    return
  }

  const label = tabWebviewLabel(shortcutId)
  try {
    const webview = await Webview.getByLabel(label)
    if (webview) await hideWebviewSafe(webview)
  } catch {
    // tab may already be hidden
  }
}

export async function showBrowseTabById(shortcutId: string): Promise<void> {
  if (!isTauri) return

  const label = tabWebviewLabel(shortcutId)
  let webview = webviewCache.get(shortcutId) ?? null
  if (!webview) {
    try {
      webview = await Webview.getByLabel(label)
    } catch {
      webview = null
    }
  }
  if (!webview) return

  webviewCache.set(shortcutId, webview)
  activeTabId = shortcutId
  activeWebview = webview

  await syncBrowserBounds(webview)
  await webview.show()
  await stackBrowsingChromeAboveBrowser(shortcutId)
}

export async function hideActiveBrowseTab(): Promise<void> {
  if (!isTauri || !activeTabId) return
  await hideBrowseTabById(activeTabId)
}

export async function showActiveBrowseTab(): Promise<void> {
  if (!isTauri || !activeTabId) return
  await showBrowseTabById(activeTabId)
}

export async function navigateBrowseTabBack(shortcutId: string): Promise<boolean> {
  if (!isTauri) return false

  try {
    return await invoke<boolean>('webview_go_back', {
      label: tabWebviewLabel(shortcutId),
    })
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[nebula] webview_go_back failed', error)
    }
    return false
  }
}

export async function navigateBrowseTabForward(shortcutId: string): Promise<boolean> {
  if (!isTauri) return false

  try {
    return await invoke<boolean>('webview_go_forward', {
      label: tabWebviewLabel(shortcutId),
    })
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[nebula] webview_go_forward failed', error)
    }
    return false
  }
}

export async function reloadBrowseTab(shortcutId: string): Promise<void> {
  if (!isTauri) return

  try {
    await invoke('webview_reload', { label: tabWebviewLabel(shortcutId) })
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[nebula] webview_reload failed', error)
    }
  }
}

export async function zoomBrowseTab(
  shortcutId: string,
  action: 'in' | 'out' | 'reset',
): Promise<void> {
  if (!isTauri) return

  try {
    await invoke('webview_zoom', { label: tabWebviewLabel(shortcutId), action })
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[nebula] webview_zoom failed', error)
    }
  }
}

export async function openBrowseTabDevTools(shortcutId: string): Promise<void> {
  if (!isTauri) return

  try {
    await invoke('webview_open_devtools', { label: tabWebviewLabel(shortcutId) })
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[nebula] webview_open_devtools failed', error)
    }
  }
}

export async function readTabWebviewUrl(shortcutId: string): Promise<string | null> {
  if (!isTauri) return null

  try {
    const url = await invoke<string>('webview_current_url', {
      label: tabWebviewLabel(shortcutId),
    })
    if (!url || url === 'about:blank') return null
    return url
  } catch {
    return null
  }
}

export async function readTabWebviewTitle(shortcutId: string): Promise<string | null> {
  if (!isTauri) return null

  try {
    const title = await invoke<string>('webview_document_title', {
      label: tabWebviewLabel(shortcutId),
    })
    if (!title?.trim()) return null
    return title.trim()
  } catch {
    return null
  }
}

export async function snapshotTabWebview(
  shortcutId: string,
): Promise<{ url: string; title: string | null } | null> {
  const url = await readTabWebviewUrl(shortcutId)
  if (!url) return null
  const title = await readTabWebviewTitle(shortcutId)
  return { url, title }
}

export async function hideAllBrowseTabs(): Promise<void> {
  if (!isTauri) return

  unbindResizeListeners()
  activeWebview = null
  activeTabId = null
  lastBrowserBoundsKey = null

  await Promise.all([...webviewCache.values()].map((webview) => hideWebviewSafe(webview)))

  try {
    const all = await Webview.getAll()
    await Promise.all(
      all
        .filter(
          (webview) =>
            webview.label.startsWith('nebula-tab-') || webview.label === LEGACY_BROWSER_LABEL,
        )
        .map((webview) => hideWebviewSafe(webview)),
    )
  } catch {
    await hideLegacyBrowser()
  }
}

async function resolveTabWebview(shortcutId: string): Promise<Webview | null> {
  const label = tabWebviewLabel(shortcutId)
  const cached = webviewCache.get(shortcutId)
  if (cached) return cached

  try {
    const byLabel = await Webview.getByLabel(label)
    if (byLabel) return byLabel
  } catch {
    // continue
  }

  try {
    const all = await Webview.getAll()
    return all.find((webview) => webview.label === label) ?? null
  } catch {
    return null
  }
}

async function destroyTabWebview(label: string): Promise<void> {
  try {
    await invoke('webview_close_tab', { label })
    return
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn(`[nebula] webview_close_tab ${label} failed`, error)
    }
  }

  const shortcutId = label.startsWith('nebula-tab-')
    ? label.slice('nebula-tab-'.length)
    : label
  const webview = await resolveTabWebview(shortcutId)
  if (!webview) return

  try {
    await invoke('webview_navigate', { label, url: 'about:blank' })
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
  } catch (fallbackError) {
    if (import.meta.env.DEV) {
      console.warn(`[nebula] JS fallback close ${label} failed`, fallbackError)
    }
  }
}

export async function closeBrowseTab(shortcutId: string): Promise<void> {
  if (!isTauri) return

  const label = tabWebviewLabel(shortcutId)

  await destroyTabWebview(label)

  webviewCache.delete(shortcutId)
  createdTabs.delete(shortcutId)

  if (activeTabId === shortcutId) {
    activeTabId = null
    activeWebview = null
    unbindResizeListeners()
    lastBrowserBoundsKey = null
  }

  try {
    const all = await Webview.getAll()
    await Promise.all(
      all
        .filter((candidate) => candidate.label === label)
        .map((orphan) => destroyTabWebview(orphan.label)),
    )
  } catch {
    // ignore sweep errors
  }
}

export async function syncTabWebviewFullscreenBounds(shortcutId: string): Promise<void> {
  if (!isTauri) return

  const webview = await resolveTabWebview(shortcutId)
  if (!webview) return

  const { position, size } = await browserWebviewFullscreenPhysicalBounds()
  lastBrowserBoundsKey = boundsKey(position.x, position.y, size.width, size.height)
  await webview.setPosition(position)
  await webview.setSize(size)
  await webview.setAutoResize(false)
  await webview.show()
  await invoke('webview_raise_tab_fullscreen', { label: tabWebviewLabel(shortcutId) })
}

export function getActiveBrowseTabId(): string | null {
  return activeTabId
}

/** @deprecated Legacy single-webview API */
export async function showTauriBrowser(url: string): Promise<void> {
  await activateBrowseTab('legacy', url)
}

/** @deprecated Legacy single-webview API */
export async function hideTauriBrowser(): Promise<void> {
  await hideAllBrowseTabs()
}

/** @deprecated Use snapshotTabWebview */
export async function snapshotTauriBrowserSession(
  recordVisit: (url: string) => void,
): Promise<string | null> {
  const snapshot = await snapshotTabWebview(activeTabId ?? 'legacy')
  if (!snapshot) return null
  recordVisit(snapshot.url)
  return snapshot.url
}
