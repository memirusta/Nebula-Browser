export interface ExtensionPanelState<T> {
  items: T[]
  loading: boolean
  pending: string | null
  error: string
}

/** One panel lifetime. Dispose before changing profiles or hiding private data. */
export function createExtensionPanelController<T>(
  read: () => Promise<T[]>,
  publish: (state: ExtensionPanelState<T>) => void,
) {
  let state: ExtensionPanelState<T> = { items: [], loading: true, pending: null, error: '' }
  let active = true
  let revision = 0
  let reading = false
  let operationError = ''
  const update = (patch: Partial<ExtensionPanelState<T>>) => {
    state = { ...state, ...patch }
    publish(state)
  }
  return {
    async refresh() {
      if (!active || state.pending || reading) return
      const request = ++revision
      reading = true
      try {
        const items = await read()
        if (active && request === revision) update({ items, error: operationError })
      } catch (error) {
        if (active && request === revision) update({ error: operationError || String(error) })
      } finally {
        if (active && request === revision) {
          reading = false
          update({ loading: false })
        }
      }
    },
    async run(id: string, operation: () => Promise<unknown>) {
      if (!active || state.pending) return
      const request = ++revision
      reading = false
      operationError = ''
      update({ pending: id, error: '' })
      try { await operation() }
      catch (error) { operationError = String(error) }
      if (!active || request !== revision) return
      // Keep actions locked until the authoritative post-operation read finishes.
      let readError = ''
      try {
        const items = await read()
        if (active && request === revision) update({ items })
      } catch (error) {
        readError = String(error)
      } finally {
        if (active && request === revision) update({ pending: null, loading: false, error: operationError || readError })
      }
    },
    dispose() {
      active = false
      ++revision
    },
  }
}
