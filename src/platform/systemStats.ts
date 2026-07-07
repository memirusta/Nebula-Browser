import { invoke } from '@tauri-apps/api/core'
import { isTauri } from './runtime'

export interface SystemStatsSnapshot {
  ramPercent: number
  ramUsedGb: number
  ramTotalGb: number
  cpuPercent: number
}

export async function fetchSystemStats(): Promise<SystemStatsSnapshot | null> {
  if (!isTauri) return null

  try {
    return await invoke<SystemStatsSnapshot>('get_system_stats')
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[nebula] get_system_stats failed', error)
    }
    return null
  }
}
