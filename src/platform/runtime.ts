export const isTauri =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export type Runtime = 'web' | 'tauri'

export function getRuntime(): Runtime {
  return isTauri ? 'tauri' : 'web'
}
