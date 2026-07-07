import { getCurrentWebview, Webview } from '@tauri-apps/api/webview'
import { isTauri } from './runtime'

const MAIN_WEBVIEW_LABEL = 'main'

export async function showMainWebview(): Promise<void> {
  if (!isTauri) return

  try {
    const webview = await Webview.getByLabel(MAIN_WEBVIEW_LABEL)
    if (webview) {
      await webview.show()
      return
    }
  } catch {
    // fall through
  }

  try {
    await getCurrentWebview().show()
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[nebula] showMainWebview failed', error)
    }
  }
}

export async function hideMainWebview(): Promise<void> {
  if (!isTauri) return

  try {
    const webview = await Webview.getByLabel(MAIN_WEBVIEW_LABEL)
    if (webview) {
      await webview.hide()
      return
    }
  } catch {
    // fall through
  }

  try {
    await getCurrentWebview().hide()
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[nebula] hideMainWebview failed', error)
    }
  }
}
