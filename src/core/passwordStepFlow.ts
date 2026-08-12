import { passwordOriginFromUrl } from './passwordMatch.ts'

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
  usernameOrigins: string[]
  passwordOrigins: string[]
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

export class PasswordStepFlowTracker {
  private readonly identities = new Map<string, StoredIdentity>()
  private readonly submissions = new Map<string, StoredSubmission>()
  private readonly ttlMs: number

  constructor(ttlMs = DEFAULT_PASSWORD_STEP_TTL_MS) {
    this.ttlMs = ttlMs
  }

  captureIdentity(input: PasswordStepIdentityInput): boolean {
    const origin = passwordOriginFromUrl(input.origin)
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
    const origin = passwordOriginFromUrl(input.origin)
    const urlOrigin = passwordOriginFromUrl(input.url)
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

  /**
   * The identifier itself is safe to carry across a same-tab split-login
   * navigation for a short period. It is only used to narrow credentials that
   * are already authorized for the current origin/role; it never authorizes a
   * password on a new origin by itself.
   */
  peekIdentityForUrl(
    shortcutId: string,
    _currentUrl: string,
    now = Date.now(),
  ): string | null {
    const identity = this.identities.get(shortcutId)
    if (!identity) return null

    if (now - identity.receivedAt > this.ttlMs) {
      this.identities.delete(shortcutId)
      return null
    }

    return identity.username
  }

  takeSubmission(
    shortcutId: string,
    _currentUrl: string,
    now = Date.now(),
  ): ResolvedPasswordStepSubmission | null {
    const submission = this.submissions.get(shortcutId)
    if (!submission) return null

    this.submissions.delete(shortcutId)
    if (now - submission.receivedAt > this.ttlMs) {
      this.identities.delete(shortcutId)
      return null
    }

    const identity = this.identities.get(shortcutId)
    const identityFresh = Boolean(
      identity &&
      now - identity.receivedAt <= this.ttlMs,
    )

    let username = submission.username
    if (!username) {
      if (!identity || !identityFresh) {
        this.identities.delete(shortcutId)
        return null
      }
      username = identity.username
    }

    const normalizedUser = username.trim().toLowerCase()
    const identityMatchesUser = Boolean(
      identityFresh &&
      identity &&
      identity.username.trim().toLowerCase() === normalizedUser,
    )

    const usernameOrigins = new Set<string>()
    if (identityMatchesUser && identity) usernameOrigins.add(identity.origin)
    if (submission.username.trim()) usernameOrigins.add(submission.origin)
    const passwordOrigins = [submission.origin]

    this.identities.delete(shortcutId)
    return {
      shortcutId,
      url: submission.url,
      username,
      password: submission.password,
      usernameOrigins: [...usernameOrigins],
      passwordOrigins,
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
