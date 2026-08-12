const GOOGLE_BROWSER_SESSION_KEY = 'nebula-google-browser-session-v1'

export interface GoogleBrowserSessionState {
  email: string
  linkedAt: number
}

export function buildGoogleBrowserSignInUrl(email: string): string {
  const params = new URLSearchParams({
    continue: 'https://www.google.com/',
    Email: email,
    flowName: 'GlifWebSignIn',
    flowEntry: 'ServiceLogin',
  })
  return `https://accounts.google.com/v3/signin/identifier?${params}`
}

export function isGoogleBrowserSignInUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase()
    return host === 'accounts.google.com'
  } catch {
    return false
  }
}

export function googleBrowserSessionEmailFromSignInUrl(url: string): string | null {
  if (!isGoogleBrowserSignInUrl(url)) return null
  try {
    const email = new URL(url).searchParams.get('Email')?.trim()
    return email || null
  } catch {
    return null
  }
}

export function isGoogleAccountDashboardUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase()
    return host === 'myaccount.google.com'
  } catch {
    return false
  }
}

/** Sign-in helper tab reached a post-login page and can be dismissed. */
export function isGoogleSessionHelperTerminalUrl(url: string): boolean {
  if (isGoogleAccountDashboardUrl(url)) return true
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase()
    return host === 'google.com' && (parsed.pathname === '/' || parsed.pathname === '')
  } catch {
    return false
  }
}

export class GoogleBrowserSessionTracker {
  private readonly emailByTab = new Map<string, string>()

  register(tabId: string, signInUrl: string): boolean {
    const email = googleBrowserSessionEmailFromSignInUrl(signInUrl)
    if (!email) return false
    this.emailByTab.set(tabId, email)
    return true
  }

  has(tabId: string): boolean {
    return this.emailByTab.has(tabId)
  }

  discard(tabId: string): void {
    this.emailByTab.delete(tabId)
  }

  complete(tabId: string, url: string): string | null {
    if (!isGoogleSessionHelperTerminalUrl(url)) return null
    const email = this.emailByTab.get(tabId) ?? null
    if (email) this.emailByTab.delete(tabId)
    return email
  }
}

export function loadGoogleBrowserSession(): GoogleBrowserSessionState | null {
  try {
    const raw = localStorage.getItem(GOOGLE_BROWSER_SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as GoogleBrowserSessionState
    if (typeof parsed.email !== 'string' || typeof parsed.linkedAt !== 'number') return null
    return parsed
  } catch {
    return null
  }
}

export function markGoogleBrowserSessionLinked(email: string): void {
  const state: GoogleBrowserSessionState = {
    email: email.trim(),
    linkedAt: Date.now(),
  }
  localStorage.setItem(GOOGLE_BROWSER_SESSION_KEY, JSON.stringify(state))
}

export function clearGoogleBrowserSession(): void {
  localStorage.removeItem(GOOGLE_BROWSER_SESSION_KEY)
}
