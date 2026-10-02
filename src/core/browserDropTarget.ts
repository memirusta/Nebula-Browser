/**
 * Where the OS cursor was when a tab was dropped.
 *
 * `outside` is a positive native measurement (the hit window belongs to another
 * process and no Nebula window contains the cursor). `unknown` means the native
 * hit-test could not prove either case and must never create a window.
 */
export type BrowserWindowDropTarget =
  | { kind: 'window'; label: string }
  | { kind: 'outside' }
  | { kind: 'unknown' }

export type BrowserDropAction =
  | { kind: 'existing-window'; windowId: string }
  | { kind: 'new-window' }
  | { kind: 'unresolved' }

export function parseBrowserWindowDropTarget(value: unknown): BrowserWindowDropTarget {
  if (typeof value !== 'object' || value === null) return { kind: 'unknown' }
  const entry = value as { kind?: unknown; label?: unknown }
  if (entry.kind === 'outside') return { kind: 'outside' }
  if (entry.kind === 'window' && typeof entry.label === 'string' && entry.label !== '') {
    return { kind: 'window', label: entry.label }
  }
  return { kind: 'unknown' }
}

/**
 * Decide what a tab drop does. This only runs for a tab that was already
 * released outside the Semi-Lunar, so landing on the source window's own page
 * detaches the tab into a new window just like dropping outside Nebula does.
 */
export function resolveBrowserDropAction(
  target: BrowserWindowDropTarget,
  currentWindowLabel: string,
): BrowserDropAction {
  switch (target.kind) {
    case 'window':
      return target.label === currentWindowLabel
        ? { kind: 'new-window' }
        : { kind: 'existing-window', windowId: target.label }
    case 'outside':
      return { kind: 'new-window' }
    default:
      return { kind: 'unresolved' }
  }
}

/**
 * A secondary window that lost its last tab to a transfer closes itself. The
 * primary `main` window stays: native process stats and extension operations
 * address the `main` WebView, and it falls back to Home like before.
 */
export function closesWhenEmptied(windowId: string): boolean {
  return windowId !== 'main' && windowId.startsWith('nebula-window-')
}
