import { invoke } from '@tauri-apps/api/core'
import type { GoogleProfileClaims } from '../core/googleSignIn'

export interface GoogleSyncStatus {
  enabled: boolean
  email?: string | null
}

export interface GoogleSyncCloudData {
  content: string
  modifiedTime?: string | null
}

function invokeErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message) return message
  }
  return 'Google sync failed.'
}

export async function getGoogleSyncStatus(): Promise<GoogleSyncStatus> {
  try {
    return await invoke<GoogleSyncStatus>('google_sync_status')
  } catch (error) {
    throw new Error(invokeErrorMessage(error))
  }
}

export async function enableGoogleSyncLoopback(args: {
  clientId: string
  codeVerifier: string
  codeChallenge: string
  state: string
  expectedEmail: string
}): Promise<GoogleProfileClaims> {
  try {
    return await invoke<GoogleProfileClaims>('google_sync_enable_loopback', {
      clientId: args.clientId,
      codeVerifier: args.codeVerifier,
      codeChallenge: args.codeChallenge,
      state: args.state,
      expectedEmail: args.expectedEmail,
    })
  } catch (error) {
    throw new Error(invokeErrorMessage(error))
  }
}

export async function pullGoogleSyncData(clientId: string): Promise<GoogleSyncCloudData | null> {
  try {
    return await invoke<GoogleSyncCloudData | null>('google_sync_pull', { clientId })
  } catch (error) {
    throw new Error(invokeErrorMessage(error))
  }
}

export async function pushGoogleSyncData(clientId: string, content: string): Promise<void> {
  try {
    await invoke('google_sync_push', { clientId, content })
  } catch (error) {
    throw new Error(invokeErrorMessage(error))
  }
}

export async function forgetGoogleSync(): Promise<void> {
  try {
    await invoke('google_sync_forget')
  } catch (error) {
    throw new Error(invokeErrorMessage(error))
  }
}
