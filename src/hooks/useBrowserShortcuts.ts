import { useEffect, useRef } from 'react'
import { register, unregisterAll } from '@tauri-apps/plugin-global-shortcut'
import {
  BROWSER_GLOBAL_SHORTCUTS,
  matchBrowserShortcut,
  shouldIgnoreShellShortcut,
  type BrowserShortcutId,
} from '../core/browserShortcuts'
import { isTauri } from '../platform/runtime'

export interface BrowserShortcutHandlers {
  onAction: (action: BrowserShortcutId) => void
  enabled?: boolean
}

export function useBrowserShortcuts({ onAction, enabled = true }: BrowserShortcutHandlers): void {
  const onActionRef = useRef(onAction)
  onActionRef.current = onAction

  useEffect(() => {
    if (!enabled) return

    const dispatch = (action: BrowserShortcutId) => {
      onActionRef.current(action)
    }

    if (isTauri) {
      void (async () => {
        const seen = new Set<string>()
        for (const entry of BROWSER_GLOBAL_SHORTCUTS) {
          if (seen.has(entry.accelerator)) continue
          seen.add(entry.accelerator)
          const actionId = entry.id
          try {
            await register(entry.accelerator, (event) => {
              if (event.state !== 'Pressed') return
              dispatch(actionId)
            })
          } catch (error) {
            if (import.meta.env.DEV) {
              console.warn('[nebula] shortcut register failed', entry.accelerator, error)
            }
          }
        }
      })()

      return () => {
        void unregisterAll().catch(() => {})
      }
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreShellShortcut(event)) return
      const action = matchBrowserShortcut(event)
      if (!action) return
      event.preventDefault()
      dispatch(action)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled])
}
