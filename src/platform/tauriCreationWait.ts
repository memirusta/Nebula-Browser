import type {
  EventCallback,
  EventName,
  UnlistenFn,
} from '@tauri-apps/api/event'

export interface TauriCreationTarget {
  once<T>(event: EventName, handler: EventCallback<T>): Promise<UnlistenFn>
}

/**
 * Wait for a Tauri window or WebView to finish creation without retaining the
 * opposite once-listener after success, failure, or timeout.
 */
export function waitForTauriCreated(
  target: TauriCreationTarget,
  description: string,
  timeoutMs: number,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false
    const unlisteners: UnlistenFn[] = []

    const finish = (succeeded: boolean, error?: unknown) => {
      if (settled) return
      settled = true
      globalThis.clearTimeout(timeout)

      for (const unlisten of unlisteners.splice(0)) {
        unlisten()
      }

      if (succeeded) resolve()
      else reject(error)
    }

    const remember = (registration: Promise<UnlistenFn>) => {
      void registration.then(
        (unlisten) => {
          if (settled) unlisten()
          else unlisteners.push(unlisten)
        },
        (error) => finish(false, error),
      )
    }

    const timeout = globalThis.setTimeout(
      () => finish(false, new Error(`${description} create timeout`)),
      timeoutMs,
    )

    try {
      remember(target.once('tauri://created', () => finish(true)))
      remember(
        target.once<unknown>('tauri://error', (event) =>
          finish(
            false,
            event.payload ?? new Error(`${description} create error`),
          ),
        ),
      )
    } catch (error) {
      finish(false, error)
    }
  })
}
