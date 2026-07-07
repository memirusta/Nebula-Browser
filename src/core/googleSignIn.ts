import type { NebulaAccount } from './nebulaAccount'
import { isTauri } from '../platform/runtime'
import { exchangeGoogleOAuthToken, signInWithGoogleLoopback } from '../platform/googleOAuth'

export interface GoogleSignInResult {
  claims: GoogleProfileClaims | null
  error?: string
}

export interface GoogleProfileClaims {
  name?: string
  email?: string
  picture?: string
}

const GOOGLE_AUTH_PENDING_KEY = 'nebula-google-auth-pending'
const GOOGLE_OAUTH_RETURN_KEY = 'nebula-google-oauth-return'
const GOOGLE_OAUTH_RESULT_KEY = 'nebula-google-oauth-result'
const GOOGLE_OAUTH_USED_CODE_KEY = 'nebula-google-oauth-used-code'
const PENDING_CLAIMS_KEY = 'nebula-pending-google-claims'

let consumeInFlight: Promise<GoogleProfileClaims | null> | null = null

interface PendingGoogleAuth {
  verifier: string
  state: string
  redirectUri: string
}

function readStoredAuth(key: string): string | null {
  return localStorage.getItem(key) ?? sessionStorage.getItem(key)
}

function writeStoredAuth(key: string, value: string): void {
  localStorage.setItem(key, value)
  sessionStorage.removeItem(key)
}

function removeStoredAuth(key: string): void {
  localStorage.removeItem(key)
  sessionStorage.removeItem(key)
}

function randomString(byteLength: number): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function sha256Base64Url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return base64UrlEncode(new Uint8Array(hash))
}

export function getGoogleClientId(): string | undefined {
  const id = import.meta.env.VITE_GOOGLE_CLIENT_ID
  return typeof id === 'string' && id.trim() ? id.trim() : undefined
}

export function isViteDevServer(): boolean {
  const { hostname, port } = window.location
  return (hostname === 'localhost' || hostname === '127.0.0.1') && port === '5173'
}

/** Google sign-in is available when a client id is configured. */
export function isGoogleSignInSupported(): boolean {
  return Boolean(getGoogleClientId())
}

export function googleRedirectUri(): string {
  const isViteDev = isViteDevServer()

  if (isViteDev) {
    const fromEnv = import.meta.env.VITE_GOOGLE_REDIRECT_URI
    let uri =
      typeof fromEnv === 'string' && fromEnv.trim() ? fromEnv.trim() : 'http://localhost:5173'
    if (uri === 'http://localhost:5173/' || uri === 'http://127.0.0.1:5173/') {
      uri = uri.slice(0, -1)
    }
    return uri
  }

  return window.location.origin
}

export function decodeGoogleCredential(credential: string): GoogleProfileClaims | null {
  try {
    const payload = credential.split('.')[1]
    if (!payload) return null
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const json = atob(normalized)
    return JSON.parse(json) as GoogleProfileClaims
  } catch {
    return null
  }
}

/** Tauri: loopback via system browser. Browser dev: same-window redirect. */
export async function signInWithGoogleProfile(
  oauthReturn?: string,
): Promise<GoogleSignInResult> {
  const clientId = getGoogleClientId()
  if (!clientId) {
    return { claims: null, error: 'Google client ID yapilandirilmamis.' }
  }

  if (isTauri) {
    const verifier = randomString(32)
    const challenge = await sha256Base64Url(verifier)
    const state = randomString(16)

    const { claims, error } = await signInWithGoogleLoopback({
      clientId,
      codeVerifier: verifier,
      codeChallenge: challenge,
      state,
    })

    if (claims) {
      writeStoredAuth(PENDING_CLAIMS_KEY, JSON.stringify(claims))
    }

    return { claims, error }
  }

  if (oauthReturn) {
    await startGoogleSignInRedirect(oauthReturn)
  }

  return { claims: null }
}

/** Same-window OAuth (WebView2 blocks GIS popups). */
export async function startGoogleSignInRedirect(oauthReturn: string): Promise<boolean> {
  const clientId = getGoogleClientId()
  if (!clientId) return false

  const verifier = randomString(32)
  const challenge = await sha256Base64Url(verifier)
  const state = randomString(16)
  const redirectUri = googleRedirectUri()

  const pending: PendingGoogleAuth = { verifier, state, redirectUri }
  writeStoredAuth(GOOGLE_AUTH_PENDING_KEY, JSON.stringify(pending))
  writeStoredAuth(GOOGLE_OAUTH_RETURN_KEY, oauthReturn)
  removeStoredAuth(GOOGLE_OAUTH_RESULT_KEY)
  removeStoredAuth(GOOGLE_OAUTH_USED_CODE_KEY)

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  })

  window.location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
  return true
}

export async function consumeGoogleSignInRedirect(): Promise<GoogleProfileClaims | null> {
  if (consumeInFlight) {
    return consumeInFlight
  }

  consumeInFlight = consumeGoogleSignInRedirectOnce().finally(() => {
    consumeInFlight = null
  })

  return consumeInFlight
}

async function consumeGoogleSignInRedirectOnce(): Promise<GoogleProfileClaims | null> {
  try {
    const cached = readStoredAuth(GOOGLE_OAUTH_RESULT_KEY)
    if (cached) {
      return JSON.parse(cached) as GoogleProfileClaims
    }
  } catch {
    removeStoredAuth(GOOGLE_OAUTH_RESULT_KEY)
  }

  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const state = params.get('state')

  if (!code || !state) return null

  const pendingRaw = readStoredAuth(GOOGLE_AUTH_PENDING_KEY)
  if (!pendingRaw) return null

  let pending: PendingGoogleAuth
  try {
    pending = JSON.parse(pendingRaw) as PendingGoogleAuth
  } catch {
    return null
  }

  if (pending.state !== state) return null

  const usedCode = readStoredAuth(GOOGLE_OAUTH_USED_CODE_KEY)
  if (usedCode === code) {
    try {
      const cached = readStoredAuth(GOOGLE_OAUTH_RESULT_KEY)
      if (cached) return JSON.parse(cached) as GoogleProfileClaims
    } catch {
      removeStoredAuth(GOOGLE_OAUTH_RESULT_KEY)
    }
    return null
  }

  writeStoredAuth(GOOGLE_OAUTH_USED_CODE_KEY, code)
  window.history.replaceState({}, '', window.location.pathname + window.location.hash)

  const clientId = getGoogleClientId()
  if (!clientId) return null

  let claims: GoogleProfileClaims | null = null

  if (isTauri) {
    claims = (await exchangeGoogleOAuthToken({
      code,
      codeVerifier: pending.verifier,
      redirectUri: pending.redirectUri,
      clientId,
    })).claims
  } else {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        code,
        code_verifier: pending.verifier,
        grant_type: 'authorization_code',
        redirect_uri: pending.redirectUri,
      }),
    })

    if (!tokenRes.ok) {
      removeStoredAuth(GOOGLE_OAUTH_USED_CODE_KEY)
      removeStoredAuth(GOOGLE_AUTH_PENDING_KEY)
      if (import.meta.env.DEV) {
        const detail = await tokenRes.text().catch(() => '')
        console.warn('[nebula] Google token exchange failed', tokenRes.status, detail)
      }
      return null
    }

    removeStoredAuth(GOOGLE_AUTH_PENDING_KEY)

    const tokenJson = (await tokenRes.json()) as { id_token?: string; access_token?: string }

    if (tokenJson.id_token) {
      claims = decodeGoogleCredential(tokenJson.id_token)
    } else if (tokenJson.access_token) {
      const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${tokenJson.access_token}` },
      })
      if (userRes.ok) {
        claims = (await userRes.json()) as GoogleProfileClaims
      }
    }
  }

  if (!claims) {
    removeStoredAuth(GOOGLE_OAUTH_USED_CODE_KEY)
    return null
  }

  removeStoredAuth(GOOGLE_AUTH_PENDING_KEY)
  writeStoredAuth(GOOGLE_OAUTH_RESULT_KEY, JSON.stringify(claims))
  writeStoredAuth(PENDING_CLAIMS_KEY, JSON.stringify(claims))

  return claims
}

export function nebulaAccountFromGoogleClaims(claims: GoogleProfileClaims): NebulaAccount {
  const displayName =
    claims.name?.trim() || claims.email?.split('@')[0]?.trim() || 'Kullanıcı'
  return {
    provider: 'google',
    displayName,
    email: claims.email,
    avatarUrl: claims.picture,
  }
}

export function takePendingGoogleClaims(): GoogleProfileClaims | null {
  try {
    const raw = readStoredAuth(PENDING_CLAIMS_KEY)
    if (!raw) return null
    removeStoredAuth(PENDING_CLAIMS_KEY)
    return JSON.parse(raw) as GoogleProfileClaims
  } catch {
    return null
  }
}

export function takeGoogleOAuthReturn(): string | null {
  const value = readStoredAuth(GOOGLE_OAUTH_RETURN_KEY)
  removeStoredAuth(GOOGLE_OAUTH_RETURN_KEY)
  return value
}

export async function resumeGoogleSignInFromRedirect(): Promise<{
  claims: GoogleProfileClaims | null
}> {
  const claims = await consumeGoogleSignInRedirect()
  return { claims }
}
