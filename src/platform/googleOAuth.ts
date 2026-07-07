import { invoke } from '@tauri-apps/api/core'
import type { GoogleProfileClaims } from '../core/googleSignIn'

export interface GoogleOAuthStatus {
  clientIdConfigured: boolean
  secretConfigured: boolean
  appdataEnvPath: string
}

function invokeErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    if ('message' in error && typeof error.message === 'string') return error.message
    if ('toString' in error && typeof error.toString === 'function') {
      const text = String(error)
      if (text && text !== '[object Object]') return text
    }
  }
  return 'Google girisi basarisiz.'
}

export async function getGoogleOAuthStatus(): Promise<GoogleOAuthStatus | null> {
  try {
    return await invoke<GoogleOAuthStatus>('google_oauth_status')
  } catch {
    return null
  }
}

export async function exchangeGoogleOAuthToken(args: {
  code: string
  codeVerifier: string
  redirectUri: string
  clientId: string
}): Promise<{ claims: GoogleProfileClaims | null; error?: string }> {
  try {
    const claims = await invoke<GoogleProfileClaims>('exchange_google_oauth_token', {
      code: args.code,
      codeVerifier: args.codeVerifier,
      redirectUri: args.redirectUri,
      clientId: args.clientId,
    })
    return { claims }
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[nebula] Google token exchange failed', error)
    }
    return { claims: null, error: invokeErrorMessage(error) }
  }
}

export async function signInWithGoogleLoopback(args: {
  clientId: string
  codeVerifier: string
  codeChallenge: string
  state: string
}): Promise<{ claims: GoogleProfileClaims | null; error?: string }> {
  try {
    const claims = await invoke<GoogleProfileClaims>('google_oauth_sign_in_loopback', {
      clientId: args.clientId,
      codeVerifier: args.codeVerifier,
      codeChallenge: args.codeChallenge,
      state: args.state,
    })
    return { claims }
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[nebula] Google loopback sign-in failed', error)
    }
    return { claims: null, error: invokeErrorMessage(error) }
  }
}
