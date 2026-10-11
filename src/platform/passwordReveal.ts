import { invoke } from '@tauri-apps/api/core'
import { isTauri } from './runtime'

export type PasswordRevealResult =
  | { verified: true; reason?: never }
  | { verified: false; reason: 'unavailable' | 'cancelled' | 'failed' }

/** Request OS verification for this action; successful verification is never cached. */
export async function verifyPasswordReveal(message: string): Promise<PasswordRevealResult> {
  if (!isTauri) return { verified: false, reason: 'unavailable' }
  try {
    const result = await invoke<PasswordRevealResult>('password_verify_reveal', { message })
    if (result?.verified === true) return { verified: true }
    const reason = result?.reason
    return {
      verified: false,
      reason: reason === 'unavailable' || reason === 'cancelled' ? reason : 'failed',
    }
  } catch {
    return { verified: false, reason: 'failed' }
  }
}
