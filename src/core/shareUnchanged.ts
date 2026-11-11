/**
 * Settings are built anew on every change, so every object in them is a new object even when nothing in it changed, and
 * everything that waits for such an object (an effect that applies the privacy settings to every tab, say) runs again.
 * This gives back the old object wherever the new one holds the same values, and a new one only along the path of what
 * really changed.
 *
 * Kept free of imports so tests can read it as it is.
 */
export function shareUnchanged<T>(previous: T, next: T): T {
  if (previous === next) return previous
  if (!isTree(previous) || !isTree(next)) return next
  if (Array.isArray(previous) !== Array.isArray(next)) return next

  if (Array.isArray(next)) {
    const before = previous as unknown as unknown[]
    const items = (next as unknown as unknown[]).map((item, index) => shareUnchanged(before[index], item))
    const same = items.length === before.length && items.every((item, index) => item === before[index])
    return (same ? previous : items) as unknown as T
  }

  const before = previous as Record<string, unknown>
  const after = next as Record<string, unknown>
  const keys = Object.keys(after)
  const result: Record<string, unknown> = {}
  let same = keys.length === Object.keys(before).length
  for (const key of keys) {
    result[key] = shareUnchanged(before[key], after[key])
    if (!(key in before) || result[key] !== before[key]) same = false
  }
  return (same ? previous : result) as T
}

function isTree(value: unknown): value is object {
  return typeof value === 'object' && value !== null
}
