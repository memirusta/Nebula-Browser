export type ListenerDisposer = () => void
export type ListenerRegistration = () => Promise<ListenerDisposer>

function disposeAll(disposers: ListenerDisposer[]): void {
  for (const dispose of disposers.slice().reverse()) {
    try {
      dispose()
    } catch {
      // Cleanup is best-effort, but one broken disposer must not leak the rest.
    }
  }
}

export async function registerListenerGroup(
  registrations: ListenerRegistration[],
): Promise<ListenerDisposer> {
  const disposers: ListenerDisposer[] = []
  try {
    for (const register of registrations) {
      disposers.push(await register())
    }
  } catch (error) {
    disposeAll(disposers)
    throw error
  }

  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    disposeAll(disposers)
  }
}
