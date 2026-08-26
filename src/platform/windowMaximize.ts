import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { isTauri } from './runtime'

export interface WindowPresentationState {
  browserFullscreen: boolean
  siteFullscreen: boolean
  maximized: boolean
  focused: boolean
}

const FALLBACK_WINDOW_PRESENTATION_STATE: WindowPresentationState = {
  browserFullscreen: false,
  siteFullscreen: false,
  maximized: false,
  focused: false,
}

export async function getWindowPresentationState(): Promise<WindowPresentationState> {
  if (!isTauri) return FALLBACK_WINDOW_PRESENTATION_STATE

  const appWindow = getCurrentWindow()

  try {
    return await invoke<WindowPresentationState>('window_presentation_state', {
      windowLabel: appWindow.label,
    })
  } catch {
    // Keep non-Windows/dev fallback behavior functional if the native command is
    // temporarily unavailable. Custom F11/site fullscreen are Windows-owned and
    // therefore intentionally default to false here.
    const [maximized, focused] = await Promise.all([
      appWindow.isMaximized().catch(() => false),
      appWindow.isFocused().catch(() => false),
    ])

    return {
      browserFullscreen: false,
      siteFullscreen: false,
      maximized,
      focused,
    }
  }
}

export async function isWindowMaximized(): Promise<boolean> {
  return (await getWindowPresentationState()).maximized
}

export async function isWindowInteractionLocked(): Promise<boolean> {
  const state = await getWindowPresentationState()
  // Ordinary Windows maximize keeps native title-bar semantics: dragging the
  // Semi-Lunar handle should restore-and-move the window. Only Nebula's custom
  // F11 and HTML5/site fullscreen states own the parent HWND strongly enough
  // to forbid dragging.
  return state.browserFullscreen || state.siteFullscreen
}

/**
 * Toggle ordinary Windows maximize only when no custom Nebula fullscreen owns
 * the parent HWND. F11/site fullscreen state lives in Rust and must not be
 * mutated behind that state machine by the separate Chrome WebView context.
 */
export async function toggleWindowMaximize(): Promise<boolean> {
  if (!isTauri) return false

  const before = await getWindowPresentationState()
  if (before.browserFullscreen || before.siteFullscreen) {
    return before.maximized
  }

  const appWindow = getCurrentWindow()
  await appWindow.toggleMaximize()
  return (await getWindowPresentationState()).maximized
}
