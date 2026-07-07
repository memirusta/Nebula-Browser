import { persistLocalStorage } from './storageSync'

export const NEBULA_ACCOUNT_KEY = 'nebula-account-v1'

export type AccountProvider = 'google' | 'local'

export interface NebulaAccount {
  provider: AccountProvider
  displayName: string
  email?: string
  avatarUrl?: string
}

function parseAccount(raw: string): NebulaAccount | null {
  try {
    const parsed = JSON.parse(raw) as Partial<NebulaAccount>
    if (typeof parsed.displayName !== 'string' || !parsed.displayName.trim()) return null
    const provider = parsed.provider === 'google' ? 'google' : 'local'
    return {
      provider,
      displayName: parsed.displayName.trim().slice(0, 48),
      email: typeof parsed.email === 'string' ? parsed.email.slice(0, 120) : undefined,
      avatarUrl: typeof parsed.avatarUrl === 'string' ? parsed.avatarUrl : undefined,
    }
  } catch {
    return null
  }
}

export function loadNebulaAccount(): NebulaAccount | null {
  try {
    const raw = localStorage.getItem(NEBULA_ACCOUNT_KEY)
    if (!raw) return null
    return parseAccount(raw)
  } catch {
    return null
  }
}

export function saveNebulaAccount(account: NebulaAccount | null): void {
  if (!account) {
    localStorage.removeItem(NEBULA_ACCOUNT_KEY)
    return
  }
  persistLocalStorage(NEBULA_ACCOUNT_KEY, JSON.stringify(account))
}

export function accountDisplayName(account: NebulaAccount | null, fallback: string): string {
  return account?.displayName?.trim() || fallback
}
