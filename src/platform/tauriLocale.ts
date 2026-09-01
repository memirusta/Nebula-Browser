import { invoke } from '@tauri-apps/api/core'
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { NebulaLocale } from '../core/locale'
import { isTauri } from './runtime'

export const UI_LOCALE_CHANGED_EVENT = 'nebula-ui-locale-changed'

export async function syncNativeUiLocale(locale: NebulaLocale): Promise<void> {
  if (!isTauri) return
  try {
    await Promise.all([
      invoke('webview_set_ui_locale', { locale }),
      emit(UI_LOCALE_CHANGED_EVENT, locale),
    ])
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[nebula] Failed to sync native UI locale', error)
    }
  }
}

export function listenUiLocaleChanges(
  onLocale: (locale: NebulaLocale) => void,
): Promise<UnlistenFn> {
  if (!isTauri) return Promise.resolve(() => {})
  return listen<NebulaLocale>(UI_LOCALE_CHANGED_EVENT, ({ payload }) => {
    onLocale(payload)
  })
}
