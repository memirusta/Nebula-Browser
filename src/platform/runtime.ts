export const isTauri =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export type Runtime = 'web' | 'tauri'
