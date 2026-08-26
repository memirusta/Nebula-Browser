import { useEffect, useRef } from 'react'
import {
  matchBrowserShortcut,
  shouldIgnoreShellShortcut,
  type BrowserShortcutBindings,
  type BrowserShortcutId,
} from '../core/browserShortcuts'
import { listenBrowserShortcutActions } from '../core/nebulaBridge'
import { isTauri } from '../platform/runtime'

export interface BrowserShortcutHandlers {
  onAction: (action: BrowserShortcutId) => void
  bindings: BrowserShortcutBindings
  enabled?: boolean
}

export function useBrowserShortcuts({
  onAction,
  bindings,
  enabled = true,
}: BrowserShortcutHandlers): void {
  const onActionRef = useRef(onAction)
  const bindingsRef = useRef(bindings)
  onActionRef.current = onAction
  bindingsRef.current = bindings

  useEffect(() => {
    if (!enabled) return

    const dispatch = (action: BrowserShortcutId) => {
      onActionRef.current(action)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreShellShortcut(event, bindingsRef.current)) return
      const action = matchBrowserShortcut(event, bindingsRef.current)
      if (!action) return
      event.preventDefault()
      dispatch(action)
    }

    window.addEventListener('keydown', onKeyDown)
    let cancelled = false
    let unlisten: (() => void) | undefined
    if (isTauri) {
      void listenBrowserShortcutActions(dispatch).then((dispose) => {
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
