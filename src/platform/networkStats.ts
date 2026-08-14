import { invoke } from '@tauri-apps/api/core'
import { isTauri } from './runtime'

export interface NetworkStatsSnapshot {
  interfaceName: string
  connectionType: string
  downloadMbps: number
  uploadMbps: number
  available: boolean
}

export async function fetchNetworkStats():
  Promise<NetworkStatsSnapshot | null> {
  if (!isTauri) return null

  try {
    return await invoke<NetworkStatsSnapshot>(
      'get_network_stats',
    )
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn(
        '[nebula] get_network_stats failed',
        error,
      )
    }

    return null
  }
}
