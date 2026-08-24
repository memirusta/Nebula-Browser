import type { Shortcut } from './types'

export const PINNED_SHORTCUTS_KEY = 'nebula-pinned-shortcuts-v5'
export const MAX_PINNED_SHORTCUTS = 12
export const PINNED_SHORTCUTS_SCHEMA_VERSION = 2

export const LEGACY_PINNED_SHORTCUT_KEYS = [
  'nebula-pinned-shortcuts-v4',
  'nebula-pinned-shortcuts-v3',
  'nebula-pinned-shortcuts-v2',
  'nebula-pinned-shortcuts-v1',
] as const

export interface PinnedShortcut {
  id: string
  url: string
  title: string
  favicon?: string
}

export interface PinnedShortcutsSnapshot {
  schemaVersion: typeof PINNED_SHORTCUTS_SCHEMA_VERSION
  pins: PinnedShortcut[]
  /** Legacy ids whose URL metadata is not available in the current catalog yet. */
  unresolvedLegacyIds: string[]
}

interface PinStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function emptySnapshot(): PinnedShortcutsSnapshot {
  return {
    schemaVersion: PINNED_SHORTCUTS_SCHEMA_VERSION,
    pins: [],
    unresolvedLegacyIds: [],
  }
}

function normalizedHttpUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.href
  } catch {
    return null
  }
}

function fallbackTitle(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || url
  } catch {
    return url
  }
}

export function pinnedShortcutFromShortcut(shortcut: Shortcut): PinnedShortcut | null {
  const id = shortcut.id.trim()
  const url = normalizedHttpUrl(shortcut.url)
  if (!id || !url) return null

  const title = shortcut.label.trim() || fallbackTitle(url)
  const favicon = shortcut.favicon?.trim()
  return {
    id,
    url,
    title,
    ...(favicon ? { favicon } : {}),
  }
}

export function shortcutFromPinnedShortcut(pin: PinnedShortcut): Shortcut {
  return {
    id: pin.id,
    url: pin.url,
    label: pin.title,
    ...(pin.favicon ? { favicon: pin.favicon } : {}),
  }
}

function normalizeStoredPin(value: unknown): PinnedShortcut | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Partial<PinnedShortcut>
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.url !== 'string' ||
    typeof candidate.title !== 'string' ||
    (candidate.favicon !== undefined && typeof candidate.favicon !== 'string')
  ) {
    return null
  }

  return pinnedShortcutFromShortcut({
    id: candidate.id,
    url: candidate.url,
    label: candidate.title,
    favicon: candidate.favicon,
  })
}

function samePin(left: PinnedShortcut, right: PinnedShortcut): boolean {
  return (
    left.id === right.id &&
    left.url === right.url &&
    left.title === right.title &&
    left.favicon === right.favicon
  )
}

export function addPinnedShortcut(
  pins: PinnedShortcut[],
  shortcut: Shortcut | PinnedShortcut,
): { pins: PinnedShortcut[]; accepted: boolean } {
  const candidate = 'label' in shortcut
    ? pinnedShortcutFromShortcut(shortcut)
    : normalizeStoredPin(shortcut)
  if (!candidate) return { pins, accepted: false }

  const matchingIndex = pins.findIndex(
    (pin) => pin.id === candidate.id || pin.url === candidate.url,
  )
  if (matchingIndex < 0) {
    if (pins.length >= MAX_PINNED_SHORTCUTS) return { pins, accepted: false }
    return { pins: [...pins, candidate], accepted: true }
  }

  // One id and one exact URL can each identify at most one pin. Re-pinning
  // refreshes the owned metadata in place instead of creating a duplicate.
  const next = pins.filter(
    (pin, index) =>
      index === matchingIndex ||
      (pin.id !== candidate.id && pin.url !== candidate.url),
  )
  const retainedIndex = next.findIndex(
    (pin) => pin.id === pins[matchingIndex]?.id && pin.url === pins[matchingIndex]?.url,
  )
  const replaceIndex = retainedIndex >= 0 ? retainedIndex : Math.min(matchingIndex, next.length - 1)
  if (replaceIndex >= 0) next[replaceIndex] = candidate
  else next.push(candidate)

  return {
    pins: next.length === pins.length && next.every((pin, index) => samePin(pin, pins[index]!))
      ? pins
      : next,
    accepted: true,
  }
}

export function removePinnedShortcut(
  pins: PinnedShortcut[],
  id: string,
): PinnedShortcut[] {
  const next = pins.filter((pin) => pin.id !== id)
  return next.length === pins.length ? pins : next
}

function sanitizePins(values: unknown[]): PinnedShortcut[] {
  let pins: PinnedShortcut[] = []
  for (const value of values) {
    const pin = normalizeStoredPin(value)
    if (!pin) continue
    pins = addPinnedShortcut(pins, pin).pins
  }
  return pins
}

function sanitizeLegacyIds(values: unknown[], resolvedIds: ReadonlySet<string>): string[] {
  const result: string[] = []
  for (const value of values) {
    if (typeof value !== 'string') continue
    const id = value.trim()
    if (!id || resolvedIds.has(id) || result.includes(id)) continue
    if (result.length >= MAX_PINNED_SHORTCUTS) break
    result.push(id)
  }
  return result
}

function parseCurrentSnapshot(raw: string): PinnedShortcutsSnapshot | null {
  try {
    const parsed = JSON.parse(raw) as Partial<PinnedShortcutsSnapshot>
    if (
      !parsed ||
      parsed.schemaVersion !== PINNED_SHORTCUTS_SCHEMA_VERSION ||
      !Array.isArray(parsed.pins)
    ) {
      return null
    }

    const pins = sanitizePins(parsed.pins)
    const resolvedIds = new Set(pins.map((pin) => pin.id))
    const unresolvedLegacyIds = Array.isArray(parsed.unresolvedLegacyIds)
      ? sanitizeLegacyIds(parsed.unresolvedLegacyIds, resolvedIds).slice(
          0,
          Math.max(0, MAX_PINNED_SHORTCUTS - pins.length),
        )
      : []
    return {
      schemaVersion: PINNED_SHORTCUTS_SCHEMA_VERSION,
      pins,
      unresolvedLegacyIds,
    }
  } catch {
    return null
  }
}

function parseLegacyIds(raw: string): string[] | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed) || !parsed.every((id) => typeof id === 'string')) return null
    return sanitizeLegacyIds(parsed, new Set()).slice(0, MAX_PINNED_SHORTCUTS)
  } catch {
    return null
  }
}

export function reconcilePinnedShortcuts(
  snapshot: PinnedShortcutsSnapshot,
  catalog: Shortcut[],
): PinnedShortcutsSnapshot {
  if (snapshot.unresolvedLegacyIds.length === 0 || catalog.length === 0) return snapshot

  const byId = new Map(catalog.map((shortcut) => [shortcut.id, shortcut]))
  let pins = snapshot.pins
  const unresolvedLegacyIds: string[] = []
  for (const id of snapshot.unresolvedLegacyIds) {
    const shortcut = byId.get(id)
    if (!shortcut) {
      unresolvedLegacyIds.push(id)
      continue
    }
    const result = addPinnedShortcut(pins, shortcut)
    pins = result.pins
    if (!result.accepted) unresolvedLegacyIds.push(id)
  }

  if (
    pins === snapshot.pins &&
    unresolvedLegacyIds.length === snapshot.unresolvedLegacyIds.length
  ) {
    return snapshot
  }
  return {
    schemaVersion: PINNED_SHORTCUTS_SCHEMA_VERSION,
    pins,
    unresolvedLegacyIds,
  }
}

export function serializePinnedShortcuts(snapshot: PinnedShortcutsSnapshot): string {
  return JSON.stringify(snapshot)
}

export function loadPinnedShortcuts(
  catalog: Shortcut[] = [],
  storage: PinStorage = localStorage,
): PinnedShortcutsSnapshot {
  const currentRaw = storage.getItem(PINNED_SHORTCUTS_KEY)
  if (currentRaw) {
    const parsed = parseCurrentSnapshot(currentRaw)
    if (parsed) {
      const reconciled = reconcilePinnedShortcuts(parsed, catalog)
      const serialized = serializePinnedShortcuts(reconciled)
      if (serialized !== currentRaw) storage.setItem(PINNED_SHORTCUTS_KEY, serialized)
      return reconciled
    }
  }

  const byId = new Map(catalog.map((shortcut) => [shortcut.id, shortcut]))
  for (const key of LEGACY_PINNED_SHORTCUT_KEYS) {
    const raw = storage.getItem(key)
    if (!raw) continue
    const ids = parseLegacyIds(raw)
    if (!ids) continue

    let pins: PinnedShortcut[] = []
    const unresolvedLegacyIds: string[] = []
    for (const id of ids) {
      const shortcut = byId.get(id)
      const result = shortcut ? addPinnedShortcut(pins, shortcut) : null
      if (result?.accepted) pins = result.pins
      else unresolvedLegacyIds.push(id)
    }
    const snapshot: PinnedShortcutsSnapshot = {
      schemaVersion: PINNED_SHORTCUTS_SCHEMA_VERSION,
      pins,
      unresolvedLegacyIds,
    }
    storage.setItem(PINNED_SHORTCUTS_KEY, serializePinnedShortcuts(snapshot))
    return snapshot
  }

  return emptySnapshot()
}

/** Includes unresolved legacy ids so transient pruning cannot discard them. */
export function loadPinnedShortcutIds(
  catalog: Shortcut[] = [],
  storage: PinStorage = localStorage,
): string[] {
  const snapshot = loadPinnedShortcuts(catalog, storage)
  return [
    ...snapshot.pins.map((pin) => pin.id),
    ...snapshot.unresolvedLegacyIds,
  ].slice(0, MAX_PINNED_SHORTCUTS)
}
