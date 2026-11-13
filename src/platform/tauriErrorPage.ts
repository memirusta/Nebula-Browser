import { invoke } from '@tauri-apps/api/core'
import type { PopupTheme } from '../core/popupTheme'
import { isTauri } from './runtime'

/** Hands the interface's colours to the page a failed navigation shows, which is built natively and has none of Nebula's styles. */
export async function syncNativeErrorPageTheme(theme: PopupTheme): Promise<void> {
  if (!isTauri) return
  try {
    await invoke('webview_set_error_page_theme', {
      theme: {
        dark: theme.dark,
        base: theme.base,
        text: theme.text,
        muted: theme.muted,
        border: theme.border,
        surface: theme.surface,
        accent: theme.accent,
        strong: theme.strong,
        on: theme.on,
      },
    })
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[nebula] Failed to sync the error page theme', error)
    }
  }
}
