const DEFAULT_PASSWORD_STEP_TTL_MS = 5 * 60_000

export interface PasswordStepIdentityInput {
  shortcutId: string
  origin: string
  username: string
  receivedAt?: number
}

export interface PasswordStepSubmissionInput {
  shortcutId: string
  origin: string
  url: string
  username: string
  password: string
  receivedAt?: number
}

export interface ResolvedPasswordStepSubmission {
  shortcutId: string
  url: string
  username: string
  password: string
}

interface StoredIdentity {
  origin: string
  username: string
  receivedAt: number
}

interface StoredSubmission {
  origin: string
  url: string
  username: string
  password: string
  receivedAt: number
}

function httpOrigin(value: string): string | null {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.origin
  } catch {
    return null
  }
}

export class PasswordStepFlowTracker {
  private readonly identities = new Map<string, StoredIdentity>()
  private readonly submissions = new Map<string, StoredSubmission>()
  private readonly ttlMs: number

  constructor(ttlMs = DEFAULT_PASSWORD_STEP_TTL_MS) {
    this.ttlMs = ttlMs
  }

  captureIdentity(input: PasswordStepIdentityInput): boolean {
    const origin = httpOrigin(input.origin)
    const username = input.username.trim()
    if (!origin || !username) return false

    this.identities.set(input.shortcutId, {
      origin,
      username,
      receivedAt: input.receivedAt ?? Date.now(),
    })
    return true
  }

  captureSubmission(input: PasswordStepSubmissionInput): boolean {
    const origin = httpOrigin(input.origin)
    const urlOrigin = httpOrigin(input.url)
    if (!origin || urlOrigin !== origin || !input.password) return false

    this.submissions.set(input.shortcutId, {
      origin,
      url: input.url,
      username: input.username.trim(),
      password: input.password,
      receivedAt: input.receivedAt ?? Date.now(),
    })
    return true
  }

  takeSubmission(
    shortcutId: string,
    currentUrl: string,
    now = Date.now(),
  ): ResolvedPasswordStepSubmission | null {
    const submission = this.submissions.get(shortcutId)
    if (!submission) return null

    this.submissions.delete(shortcutId)
    const currentOrigin = httpOrigin(currentUrl)
    if (
      !currentOrigin ||
      currentOrigin !== submission.origin ||
      now - submission.receivedAt > this.ttlMs
    ) {
      this.identities.delete(shortcutId)
      return null
    }

    let username = submission.username
    if (!username) {
      const identity = this.identities.get(shortcutId)
      if (
        !identity ||
        identity.origin !== submission.origin ||
        now - identity.receivedAt > this.ttlMs
      ) {
        this.identities.delete(shortcutId)
        return null
      }
      username = identity.username
    }

    this.identities.delete(shortcutId)
    return {
      shortcutId,
      url: submission.url,
      username,
      password: submission.password,
    }
  }

  clearTab(shortcutId: string): void {
    this.identities.delete(shortcutId)
    this.submissions.delete(shortcutId)
  }

  clearAll(): void {
    this.identities.clear()
    this.submissions.clear()
  }
}
