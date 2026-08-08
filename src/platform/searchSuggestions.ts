import { invoke } from '@tauri-apps/api/core'
import type { SearchEngine } from '../core/nebulaSettings'
import { isTauri } from './runtime'

export async function fetchSearchSuggestions(
  query: string,
  engine: SearchEngine,
): Promise<string[]> {
  const trimmed = query.trim()

  if (trimmed.length < 2) {
    return []
  }

  if (!isTauri) {
    return []
  }

  try {
    const result = await invoke<string[]>(
      'search_suggestions',
      {
        query: trimmed,
        engine,
      },
    )

    if (import.meta.env.DEV) {
      console.log(
        '[nebula] search suggestions result',
        result,
      )
    }

    return result
  } catch (error) {
  if (import.meta.env.DEV) {
    console.warn(
      '[nebula] search suggestions unavailable',
      error,
    )
  }

  return []
}
}