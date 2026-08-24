export const MAX_TAB_NAVIGATION_ENTRIES = 100

export interface TabNavigationEntry {
  url: string
  title: string
  favicon?: string
}

export interface TabNavigationState {
  entries: TabNavigationEntry[]
  index: number
}

function normalizeHttpUrl(rawUrl: string): string | null {
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

export function createTabNavigationEntry(
  url: string,
  title?: string | null,
  favicon?: string | null,
): TabNavigationEntry | null {
  const normalizedUrl = normalizeHttpUrl(url)
  if (!normalizedUrl) return null
  const normalizedTitle = title?.trim() || fallbackTitle(normalizedUrl)
  const normalizedFavicon = favicon?.trim()
  return {
    url: normalizedUrl,
    title: normalizedTitle,
    ...(normalizedFavicon ? { favicon: normalizedFavicon } : {}),
  }
}

export function createTabNavigationState(
  url: string,
  title?: string | null,
  favicon?: string | null,
): TabNavigationState {
  const entry = createTabNavigationEntry(url, title, favicon)
  return entry ? { entries: [entry], index: 0 } : { entries: [], index: -1 }
}

function sameEntry(left: TabNavigationEntry, right: TabNavigationEntry): boolean {
  return (
    left.url === right.url &&
    left.title === right.title &&
    left.favicon === right.favicon
  )
}

export function sanitizeTabNavigationState(
  value: unknown,
  fallbackUrl: string,
  fallbackTitleValue?: string | null,
  fallbackFavicon?: string | null,
): TabNavigationState {
  const fallback = createTabNavigationState(
    fallbackUrl,
    fallbackTitleValue,
    fallbackFavicon,
  )
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback

  const candidate = value as Partial<TabNavigationState>
  if (!Array.isArray(candidate.entries)) return fallback

  const entries = candidate.entries.flatMap((rawEntry) => {
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) return []
    const raw = rawEntry as Partial<TabNavigationEntry>
    if (typeof raw.url !== 'string') return []
    const entry = createTabNavigationEntry(
      raw.url,
      typeof raw.title === 'string' ? raw.title : null,
      typeof raw.favicon === 'string' ? raw.favicon : null,
    )
    return entry ? [entry] : []
  }).slice(-MAX_TAB_NAVIGATION_ENTRIES)

  if (entries.length === 0) return fallback
  const rawIndex = typeof candidate.index === 'number' && Number.isInteger(candidate.index)
    ? candidate.index
    : entries.length - 1
  const index = Math.min(Math.max(rawIndex, 0), entries.length - 1)
  return { entries, index }
}

/** Record an ordinary navigation and truncate any forward branch. */
export function recordTabNavigation(
  state: TabNavigationState,
  url: string,
  title?: string | null,
  favicon?: string | null,
): TabNavigationState {
  const entry = createTabNavigationEntry(url, title, favicon)
  if (!entry) return state

  const current = state.entries[state.index]
  if (current?.url === entry.url) {
    if (sameEntry(current, entry)) return state
    const entries = [...state.entries]
    entries[state.index] = entry
    return { entries, index: state.index }
  }

  const activeBranch = state.entries.slice(0, Math.max(0, state.index + 1))
  let entries = [...activeBranch, entry]
  if (entries.length > MAX_TAB_NAVIGATION_ENTRIES) {
    entries = entries.slice(-MAX_TAB_NAVIGATION_ENTRIES)
  }
  return { entries, index: entries.length - 1 }
}

/** Apply a Back/Forward result to a known persisted stack position. */
export function applyTabHistoryTarget(
  state: TabNavigationState,
  targetIndex: number,
  observed?: {
    url: string
    title?: string | null
    favicon?: string | null
  },
): TabNavigationState {
  if (
    !Number.isInteger(targetIndex) ||
    targetIndex < 0 ||
    targetIndex >= state.entries.length
  ) {
    return state
  }

  const entries = [...state.entries]
  if (observed) {
    const entry = createTabNavigationEntry(
      observed.url,
      observed.title,
      observed.favicon,
    )
    if (entry) entries[targetIndex] = entry
  }
  return { entries, index: targetIndex }
}

export function tabHistoryTarget(
  state: TabNavigationState,
  direction: -1 | 1,
): { index: number; entry: TabNavigationEntry } | null {
  const index = state.index + direction
  const entry = state.entries[index]
  return entry ? { index, entry } : null
}
