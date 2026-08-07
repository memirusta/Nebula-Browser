import { useEffect, useRef } from 'react'
import { listen } from '@tauri-apps/api/event'
import {
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

    const onKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreShellShortcut(event)) return
      const action = matchBrowserShortcut(event)
      if (!action) return
      event.preventDefault()
      dispatch(action)
    }

    window.addEventListener('keydown', onKeyDown)
    let cancelled = false
    let unlisten: (() => void) | undefined
    if (isTauri) {
      void listen<BrowserShortcutId>('nebula-browser-shortcut', (event) => {
        dispatch(event.payload)
      }).then((dispose) => {
        if (cancelled) dispose()
        else unlisten = dispose
      })
    }
    return () => {
      cancelled = true
      window.removeEventListener('keydown', onKeyDown)
      unlisten?.()
    }
  }, [enabled])
}
