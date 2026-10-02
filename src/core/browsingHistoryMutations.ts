import { isTauri } from '../platform/runtime'
import {
  loadBrowsingHistory,
  persistBrowsingHistory,
  loadClosedTabs,
  persistClosedTabs,
  BROWSING_HISTORY_KEY,
  CLOSED_TABS_KEY,
  type HistoryEntry,
  type ClosedTabEntry,
} from './browsingHistory'

function mutate<T>(
  key: string,
  load: () => T[],
  save: (items: T[]) => void,
  transform: (items: T[]) => T[],
): Promise<void> {
  const operation = () => {
    // Never use a renderer snapshot: deletions in another window have already
    // taken effect when this lock is acquired.
    const current = load()
    const next = transform(current)
    if (next !== current) save(next)
  }
  if (navigator.locks) return navigator.locks.request(key, operation)
  if (isTauri) return Promise.reject(new Error('Shared history lock unavailable'))
  operation()
  return Promise.resolve()
}

export function updateBrowsingHistory(transform: (entries: HistoryEntry[]) => HistoryEntry[]): Promise<void> {
  return mutate(BROWSING_HISTORY_KEY, loadBrowsingHistory, persistBrowsingHistory, transform)
}

export function updateClosedTabs(transform: (entries: ClosedTabEntry[]) => ClosedTabEntry[]): Promise<void> {
  return mutate(CLOSED_TABS_KEY, loadClosedTabs, persistClosedTabs, transform)
}
