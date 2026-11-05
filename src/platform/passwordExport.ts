import { invoke } from '@tauri-apps/api/core'
import { isTauri } from './runtime'

export type PasswordExportResult =
  | { status: 'exported'; count: number; fileName?: string }
  | { status: 'cancelled' | 'unavailable' | 'failed' }

/**
 * Saves the passwords as a CSV file. The native side asks where to save, has Windows Hello confirm the person,
 * and only then reads the vault and writes the file: the passwords never come through here.
 */
export async function exportPasswordsCsv(options: {
  message: string
  title: string
  fileName: string
}): Promise<PasswordExportResult> {
  if (!isTauri) return { status: 'unavailable' }
  try {
    const result = await invoke<PasswordExportResult>('password_export_csv', options)
    if (result?.status === 'exported') {
      return { status: 'exported', count: result.count, fileName: result.fileName }
    }
    if (result?.status === 'cancelled' || result?.status === 'unavailable') {
      return { status: result.status }
    }
    return { status: 'failed' }
  } catch {
    return { status: 'failed' }
  }
}
