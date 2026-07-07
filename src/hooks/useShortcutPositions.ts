import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  SHORTCUT_POSITIONS_KEY,
  buildDefaultPositions,
  clampToBounds,
  createLunarMetrics,
  createShortcutPositionsSnapshot,
  mergeShortcutPositions,
  parseShortcutPositionsSnapshot,
  resolveCollisions,
  scalePositionsToMetrics,
  type LunarMetrics,
  type ShortcutPosition,
} from '../core/shortcutLayout'
import { persistLocalStorage, useStorageSync } from '../core/storageSync'

function loadRawSnapshot(metrics: LunarMetrics) {
  try {
    const raw = localStorage.getItem(SHORTCUT_POSITIONS_KEY)
    if (!raw) {
      return { positions: [] as ShortcutPosition[], lunarWidth: metrics.w, lunarHeight: metrics.h }
    }
    return parseShortcutPositionsSnapshot(JSON.parse(raw), metrics)
  } catch {
    return { positions: [] as ShortcutPosition[], lunarWidth: metrics.w, lunarHeight: metrics.h }
  }
}

function persistPositionsSnapshot(positions: ShortcutPosition[], metrics: LunarMetrics) {
  persistLocalStorage(
    SHORTCUT_POSITIONS_KEY,
    JSON.stringify(createShortcutPositionsSnapshot(positions, metrics)),
  )
}

/** Persist active layout while keeping positions for tabs not currently in the dock. */
function persistActivePositions(activePositions: ShortcutPosition[], metrics: LunarMetrics) {
  const snapshot = loadRawSnapshot(metrics)
  const scaled =
    snapshot.positions.length > 0 &&
    (snapshot.lunarWidth !== metrics.w || snapshot.lunarHeight !== metrics.h)
      ? scalePositionsToMetrics(
          snapshot.positions,
          snapshot.lunarWidth,
          snapshot.lunarHeight,
          metrics,
        )
      : snapshot.positions

  const activeIds = new Set(activePositions.map((position) => position.id))
  const preserved = scaled.filter((position) => !activeIds.has(position.id))
  persistPositionsSnapshot([...activePositions, ...preserved], metrics)
}

function loadStoredPositions(metrics: LunarMetrics): ShortcutPosition[] {
  const snapshot = loadRawSnapshot(metrics)
  if (snapshot.positions.length === 0) return []

  if (snapshot.lunarWidth !== metrics.w || snapshot.lunarHeight !== metrics.h) {
    return scalePositionsToMetrics(
      snapshot.positions,
      snapshot.lunarWidth,
      snapshot.lunarHeight,
      metrics,
    )
  }

  return snapshot.positions
}

function loadInitialPositions(
  shortcutIds: string[],
  metrics: LunarMetrics,
  iconSizePx?: number,
): ShortcutPosition[] {
  const stored = loadStoredPositions(metrics)
  if (stored.length === 0) {
    return buildDefaultPositions(shortcutIds, metrics, iconSizePx)
  }
  return mergeShortcutPositions(shortcutIds, stored, iconSizePx, metrics)
}

function activePositionsMatch(a: ShortcutPosition[], b: ShortcutPosition[]) {
  if (a.length !== b.length) return false
  return a.every((position) => {
    const other = b.find((entry) => entry.id === position.id)
    return other && other.x === position.x && other.y === position.y
  })
}

function mergePositionsFromStorage(
  shortcutIds: string[],
  metrics: LunarMetrics,
  iconSizePx: number | undefined,
  prev: ShortcutPosition[],
): ShortcutPosition[] {
  const stored = loadStoredPositions(metrics)
  const merged = mergeShortcutPositions(shortcutIds, stored, iconSizePx, metrics)
  const prevActive = prev.filter((position) => shortcutIds.includes(position.id))

  if (activePositionsMatch(merged, prevActive) && prev.length === prevActive.length) {
    return prev
  }

  return merged
}

export function useShortcutPositions(
  shortcutIds: string[],
  iconSizePx?: number,
  lunarWidthPx?: number,
  lunarHeightPx?: number,
) {
  const shortcutIdsKey = shortcutIds.join('\0')
  const metrics = useMemo(
    () => createLunarMetrics(lunarWidthPx ?? 1100, lunarHeightPx ?? 152),
    [lunarWidthPx, lunarHeightPx],
  )
  const prevMetricsRef = useRef(metrics)

  const [positions, setPositions] = useState<ShortcutPosition[]>(() =>
    loadInitialPositions(shortcutIds, metrics, iconSizePx),
  )

  const reloadPositions = useCallback(() => {
    setPositions((prev) => mergePositionsFromStorage(shortcutIds, metrics, iconSizePx, prev))
  }, [shortcutIdsKey, shortcutIds, iconSizePx, metrics])

  useStorageSync(SHORTCUT_POSITIONS_KEY, reloadPositions)

  useEffect(() => {
    setPositions((prev) => {
      const merged = mergePositionsFromStorage(shortcutIds, metrics, iconSizePx, prev)
      if (merged === prev) return prev

      persistActivePositions(merged, metrics)
      return merged
    })
  }, [shortcutIdsKey, shortcutIds, iconSizePx, metrics])

  useEffect(() => {
    const prev = prevMetricsRef.current
    prevMetricsRef.current = metrics
    if (prev.w === metrics.w && prev.h === metrics.h) return

    const snapshot = loadRawSnapshot(prev)
    const allScaled = scalePositionsToMetrics(
      snapshot.positions,
      snapshot.lunarWidth,
      snapshot.lunarHeight,
      metrics,
    )
    persistPositionsSnapshot(allScaled, metrics)

    setPositions((current) => {
      const active = mergeShortcutPositions(shortcutIds, allScaled, iconSizePx, metrics)
      if (activePositionsMatch(active, current)) return current
      return active
    })
  }, [metrics.w, metrics.h, shortcutIdsKey, shortcutIds, iconSizePx])

  const persist = useCallback(
    (next: ShortcutPosition[]) => {
      setPositions(next)
      persistActivePositions(next, metrics)
    },
    [metrics],
  )

  const moveShortcut = useCallback(
    (id: string, x: number, y: number, finalize: boolean) => {
      const clamped = clampToBounds(x, y, iconSizePx, metrics)
      setPositions((prev) => {
        const next = prev.map((p) =>
          p.id === id ? { ...p, x: clamped.x, y: clamped.y } : p,
        )
        if (!finalize) return next

        const resolved = resolveCollisions(next, id, iconSizePx, metrics)
        persistActivePositions(resolved, metrics)
        return resolved
      })
    },
    [iconSizePx, metrics],
  )

  const resetPositions = useCallback(() => {
    const defaults = buildDefaultPositions(shortcutIds, metrics, iconSizePx)
    persistPositionsSnapshot(defaults, metrics)
    persist(defaults)
  }, [shortcutIds, metrics, iconSizePx, persist])

  const removePosition = useCallback(
    (id: string) => {
      setPositions((prev) => {
        const next = prev.filter((p) => p.id !== id)
        const stored = loadStoredPositions(metrics).filter((position) => position.id !== id)
        persistPositionsSnapshot(stored, metrics)
        return next
      })
    },
    [metrics],
  )

  const setPosition = useCallback(
    (id: string, x: number, y: number) => {
      const clamped = clampToBounds(x, y, iconSizePx, metrics)
      setPositions((prev) => {
        const exists = prev.some((p) => p.id === id)
        const next = exists
          ? prev.map((p) => (p.id === id ? { id, ...clamped } : p))
          : [...prev, { id, ...clamped }]
        persistActivePositions(next, metrics)
        return next
      })
    },
    [iconSizePx, metrics],
  )

  const replacePositionId = useCallback(
    (oldId: string, newId: string) => {
      setPositions((prev) => {
        const item = prev.find((p) => p.id === oldId)
        if (!item) return prev

        const next = prev
          .filter((p) => p.id !== oldId && p.id !== newId)
          .concat({ id: newId, x: item.x, y: item.y })

        const stored = loadStoredPositions(metrics)
          .filter((position) => position.id !== oldId && position.id !== newId)
          .concat({ id: newId, x: item.x, y: item.y })
        persistPositionsSnapshot(stored, metrics)
        return next
      })
    },
    [metrics],
  )

  return { positions, moveShortcut, resetPositions, removePosition, setPosition, replacePositionId }
}
