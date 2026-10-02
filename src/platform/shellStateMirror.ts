// Starts the localStorage mirror in a shell webview. Import this first in the entry
// point, before any module that touches localStorage, so no write is missed.
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { isTauri } from './runtime'
import {
  contentDigest,
  createShellStateMirror,
  hookStorage,
  isExcludedKey,
  type BarrierAnswer,
  type MirrorResult,
  type ShellStateMirror,
} from './shellStateMirrorCore'

const BARRIER_EVENT = 'nebula-shell-barrier'

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource))
}

function liveStorage(): Map<string, string> {
  const entries = new Map<string, string>()
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (key === null || isExcludedKey(key)) continue
    const value = localStorage.getItem(key)
    if (value !== null) entries.set(key, value)
  }
  return entries
}

type BarrierEvent = { id: string; phase: 'drain' | 'commit' | 'abort' }

function answerBarrier(id: string, phase: 'drain' | 'commit', answer: BarrierAnswer): Promise<void> {
  return invoke<void>('shell_isolation_barrier_ack', { ack: { id, phase, ...answer } })
}

/** The migration gate asks every shell webview two questions (docs/EXTENSION_OPT_IN_SPLIT.md, 2a). */
function listenForBarrier(mirror: ShellStateMirror): void {
  void listen<BarrierEvent>(BARRIER_EVENT, async ({ payload }) => {
    try {
      if (payload.phase === 'drain') {
        await answerBarrier(payload.id, 'drain', await mirror.barrierDrain(payload.id))
      } else if (payload.phase === 'commit') {
        // The next start must not look like a crash: mark this run clean before answering.
        try {
          const history = await import('../core/browsingHistory')
          history.markBrowserRunClean()
        } catch {
          // Without the mark the next start asks about restoring tabs; the switch still holds.
        }
        await answerBarrier(payload.id, 'commit', mirror.barrierCommit(payload.id))
      } else {
        mirror.barrierEnd(payload.id)
      }
    } catch (error) {
      console.warn('shell state mirror: barrier answer failed', error)
    }
  })
}

/**
 * After a switch the host seeded this webview's localStorage before any page script
 * (see shell_isolation.rs). It now reports the digest of what it holds; the host compares
 * it with the one the migration gate recorded and makes the switch final or rolls back.
 */
async function reportHydration(): Promise<void> {
  const marker = (window as unknown as { __NEBULA_HYDRATION__?: { id: string } }).__NEBULA_HYDRATION__
  if (!marker) return
  const entries = liveStorage()
  const digest = await contentDigest(entries, sha256)
  await invoke('shell_isolation_hydrated', {
    report: { id: marker.id, digest, keyCount: entries.size },
  })
}

function startShellStateMirror(): ShellStateMirror | null {
  if (!isTauri || typeof localStorage === 'undefined') return null

  const mirror = createShellStateMirror({
    storage: localStorage,
    send: (ops, barrierId) =>
      invoke<MirrorResult>('shell_store_apply', { ops, barrierId: barrierId ?? null }),
    sha256,
    wipe: () => invoke<void>('shell_store_wipe'),
    now: () => Date.now(),
    setTimer: (callback, ms) => window.setTimeout(callback, ms),
    clearTimer: (handle) => window.clearTimeout(handle as number),
    warn: (message) => console.warn(message),
  })

  hookStorage(Storage.prototype, localStorage, mirror)
  mirror.start()
  listenForBarrier(mirror)
  void reportHydration().catch((error) =>
    console.warn('shell isolation: hydration report failed', error),
  )

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
