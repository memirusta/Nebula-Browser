// Starts the localStorage mirror in a shell webview. Import this first in the entry
// point, before any module that touches localStorage, so no write is missed.
import { invoke } from '@tauri-apps/api/core'
import { isTauri } from './runtime'
import {
  createShellStateMirror,
  hookStorage,
  type MirrorResult,
  type ShellStateMirror,
} from './shellStateMirrorCore'

function startShellStateMirror(): ShellStateMirror | null {
  if (!isTauri || typeof localStorage === 'undefined') return null

  const mirror = createShellStateMirror({
    storage: localStorage,
    send: (ops) => invoke<MirrorResult>('shell_store_apply', { ops }),
    wipe: () => invoke<void>('shell_store_wipe'),
    now: () => Date.now(),
    setTimer: (callback, ms) => window.setTimeout(callback, ms),
    clearTimer: (handle) => window.clearTimeout(handle as number),
    warn: (message) => console.warn(message),
  })

  hookStorage(Storage.prototype, localStorage, mirror)
  mirror.start()

  // A hidden or closing window cannot wait for its debounce timer.
  window.addEventListener('pagehide', () => void mirror.flush())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void mirror.flush()
  })
  return mirror
}

export const shellStateMirror = startShellStateMirror()

/** Factory reset: the mirror must not keep what the user just erased. */
export async function wipeShellStateMirror(): Promise<void> {
  if (!isTauri) return
  if (shellStateMirror) await shellStateMirror.wipe()
  else await invoke<void>('shell_store_wipe')
}
