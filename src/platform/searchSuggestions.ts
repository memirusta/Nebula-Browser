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
    alert(
      '[Nebula Suggestions]\n\nTauri runtime algılanmadı.',
    )

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
    const message =
      error instanceof Error
        ? error.message
        : String(error)

    alert(
      `[Nebula Suggestions Error]\n\n${message}`,
    )

    console.error(
      '[nebula] search suggestions failed',
      error,
    )

    return []
  }
}