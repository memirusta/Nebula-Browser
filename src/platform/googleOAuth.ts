import { invoke } from '@tauri-apps/api/core'
import type { GoogleProfileClaims } from '../core/googleSignIn'

export async function exchangeGoogleOAuthToken(args: {
  code: string
  codeVerifier: string
  redirectUri: string
  clientId: string
}): Promise<GoogleProfileClaims | null> {
  try {
    return await invoke<GoogleProfileClaims>('exchange_google_oauth_token', {
      code: args.code,
      codeVerifier: args.codeVerifier,
      redirectUri: args.redirectUri,
      clientId: args.clientId,
    })
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[nebula] Google token exchange failed', error)
    }
    return null
  }
}
