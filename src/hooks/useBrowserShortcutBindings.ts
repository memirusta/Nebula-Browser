import { invoke } from '@tauri-apps/api/core'
import { useCallback, useEffect, useState } from 'react'
import {
  BROWSER_SHORTCUT_BINDINGS_KEY,
  DEFAULT_BROWSER_SHORTCUT_BINDINGS,
  findBrowserShortcutConflict,
  loadBrowserShortcutBindings,
  persistBrowserShortcutBindings,
  validateBrowserShortcutBinding,
  type BrowserShortcutBindings,
  type ConfigurableBrowserShortcutId,
} from '../core/browserShortcuts'
import { useStorageSync } from '../core/storageSync'
import { isTauri } from '../platform/runtime'

function bindingsEqual(a: BrowserShortcutBindings, b: BrowserShortcutBindings): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function cloneDefaults(): BrowserShortcutBindings {
  return Object.fromEntries(
    Object.entries(DEFAULT_BROWSER_SHORTCUT_BINDINGS).map(([action, actionBindings]) => [
      action,
      [...actionBindings],
    ]),
  ) as BrowserShortcutBindings
}

export function useBrowserShortcutBindings(
  options: { syncNative?: boolean } = {},
) {
  const syncNative = options.syncNative !== false
  const [bindings, setBindings] = useState<BrowserShortcutBindings>(loadBrowserShortcutBindings)

  const reload = useCallback(() => {
    const next = loadBrowserShortcutBindings()
    setBindings((previous) => (bindingsEqual(previous, next) ? previous : next))
  }, [])

  useStorageSync(BROWSER_SHORTCUT_BINDINGS_KEY, reload)

  useEffect(() => {
    if (!isTauri || !syncNative) return
    void invoke('webview_set_shortcut_bindings', { bindings }).catch((error) => {
      if (import.meta.env.DEV) {
        console.warn('[nebula] failed to sync native browser shortcuts', error)
      }
    })
  }, [bindings, syncNative])

  const setBinding = useCallback(
    (action: ConfigurableBrowserShortcutId, binding: string): boolean => {
      if (
        !validateBrowserShortcutBinding(binding).ok ||
        findBrowserShortcutConflict(bindings, binding, action)
      ) {
        return false
      }

      const next: BrowserShortcutBindings = {
        ...bindings,
        [action]: [binding],
      }
      persistBrowserShortcutBindings(next)
      setBindings(next)
      return true
    },
    [bindings],
  )

  const resetBinding = useCallback(
    (action: ConfigurableBrowserShortcutId): boolean => {
      const defaults = [...DEFAULT_BROWSER_SHORTCUT_BINDINGS[action]]
      if (defaults.some((binding) => findBrowserShortcutConflict(bindings, binding, action))) {
        return false
      }

      const next: BrowserShortcutBindings = {
        ...bindings,
        [action]: defaults,
      }
      persistBrowserShortcutBindings(next)
      setBindings(next)
      return true
    },
    [bindings],
  )

  const resetAll = useCallback(() => {
    const next = cloneDefaults()
    persistBrowserShortcutBindings(next)
    setBindings(next)
  }, [])

  return {
    bindings,
    setBinding,
    resetBinding,
    resetAll,
  }
}
