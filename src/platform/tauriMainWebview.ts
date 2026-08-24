import { getCurrentWebview, Webview } from '@tauri-apps/api/webview'
import { isTauri } from './runtime'
import { currentBrowserWindowLabel } from './browserWindowScope'

export async function showMainWebview(): Promise<void> {
  if (!isTauri) return

  try {
    const webview = await Webview.getByLabel(currentBrowserWindowLabel())
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
export async function focusMainWebview(): Promise<void> {
  if (!isTauri) return

  try {
    const webview =
      await Webview.getByLabel(
        currentBrowserWindowLabel(),
      )

    if (webview) {
      await webview.setFocus()
      return
    }
  } catch {
    // fall through
  }

  try {
    await getCurrentWebview().setFocus()
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn(
        '[nebula] focusMainWebview failed',
        error,
      )
    }
  }
}

export async function hideMainWebview(): Promise<void> {
  if (!isTauri) return

  try {
    const webview = await Webview.getByLabel(currentBrowserWindowLabel())
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
