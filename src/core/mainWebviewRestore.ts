export interface MainWebviewSize {
  width: number
  height: number
}

export function hasUsableWindowClientSize(size: MainWebviewSize): boolean {
  return Number.isFinite(size.width) && Number.isFinite(size.height)
    && size.width >= 256 && size.height >= 160
}

/** Recheck ownership after each asynchronous step: an overlay or a different
 * tab may have taken over while Windows was restoring the surfaces. */
export async function restoreBrowsingSurfaces(dependencies: {
  canRestore: () => Promise<boolean>
  restoreBounds: () => Promise<boolean>
  showTab: () => Promise<void>
  showChrome: () => Promise<void>
  stack: () => Promise<void>
}): Promise<boolean> {
  if (!await dependencies.canRestore()) return false
  if (!await dependencies.restoreBounds()) return false
  if (!await dependencies.canRestore()) return false
  await dependencies.showTab()
  if (!await dependencies.canRestore()) return false
  await dependencies.showChrome()
  if (!await dependencies.canRestore()) return false
  await dependencies.stack()
  return true
}

/** At most one active repair and one latest pending request, even if the
 * renderer receives a burst of delayed focus/resize events after restore. */
export function createCoalescedRestoreRepair(
  repair: (reason: string) => Promise<void>,
  onError: (reason: string, error: unknown) => void,
) {
  let pending: string | null = null
  let running = false
  let disposed = false

  async function drain(): Promise<void> {
    running = true
    try {
      while (!disposed && pending !== null) {
        const reason = pending
        pending = null
        try {
          await repair(reason)
        } catch (error) {
          onError(reason, error)
        }
      }
    } finally {
      running = false
    }
  }

  return {
    request(reason: string): void {
      if (disposed) return
      pending = reason
      if (!running) void drain()
    },
    dispose(): void {
      disposed = true
      pending = null
    },
  }
}
