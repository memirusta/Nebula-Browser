export interface ExtensionCatalogStatus<T> {
  statuses: Record<string, T> | null
  failed: boolean
}

/** Reconciles batch profile reads with individual operations in this settings view. */
export function createExtensionCatalogStatus<T>(
  read: () => Promise<Record<string, T>>,
  publish: (state: ExtensionCatalogStatus<T>) => void,
) {
  let active = true
  let request = 0
  let revision = 0
  let state: ExtensionCatalogStatus<T> = { statuses: null, failed: false }
  const changes = new Map<string, { revision: number; value: T }>()
  return {
    async refresh() {
      if (!active) return
      const current = ++request
      const started = revision
      try {
        const received = await read()
        if (!active || current !== request) return
        const statuses = { ...received }
        for (const [id, change] of changes) {
          if (change.revision > started) statuses[id] = change.value
          else changes.delete(id)
        }
        state = { statuses, failed: false }
        publish(state)
      } catch {
        if (active && current === request) {
          state = { ...state, failed: true }
          publish(state)
        }
      }
    },
    setStatus(id: string, value: T) {
      if (!active) return
      changes.set(id, { revision: ++revision, value })
      state = { ...state, statuses: { ...state.statuses, [id]: value } }
      publish(state)
    },
    dispose() {
      active = false
      ++request
      changes.clear()
    },
  }
}
