import type { ImportedPassword } from './passwordCsv.ts'
import { passwordOriginFromUrl } from './passwordMatch.ts'

/** The id used for the copy that is already saved in Nebula's own vault. */
export const NEBULA_SOURCE = 'nebula'

/** A saved password as the comparison needs it (the shape of the vault entries). */
export interface ExistingPassword {
  url?: string
  username: string
  password: string
  label?: string
  updatedAt?: number
}

/** One place a password was found: a browser profile, or Nebula's vault. */
export interface ImportCopy {
  browser: string
  profile: string
  /** When it was last used, else when it was saved (Unix ms). */
  timestampMs: number | null
}

/** One password the account has, with everywhere it was found. */
export interface ImportChoice {
  password: string
  copies: ImportCopy[]
  /** The newest of the copies. */
  timestampMs: number | null
  /** The one Nebula proposes: the password used or saved most recently. */
  recommended: boolean
  /** What would be saved if this is picked. */
  entry: ImportedPassword
}

/** The same account with different passwords in different places: the user decides which one to keep. */
export interface ImportConflict {
  key: string
  host: string
  username: string
  choices: ImportChoice[]
}

export interface ImportPlan {
  /** Accounts every copy of which agrees: imported as they are. */
  ready: ImportedPassword[]
  conflicts: ImportConflict[]
}

/** Index of the choice chosen for each conflict, by conflict key; a missing key means the recommended one. */
export type ImportPicks = Record<string, number>

function accountKey(url: string, username: string): string {
  const origin = passwordOriginFromUrl(url) ?? url.trim().toLowerCase()
  return `${origin}\u0000${username.trim().toLowerCase()}`
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./i, '')
  } catch {
    return url
  }
}

function newest(values: Array<number | null>): number | null {
  const known = values.filter((value): value is number => typeof value === 'number')
  return known.length > 0 ? Math.max(...known) : null
}

function copyTimestamp(item: ImportedPassword): number | null {
  return item.lastUsedMs ?? item.createdMs ?? null
}

/**
 * Compares what was read from the browsers (and what Nebula already has) account by account. An account is the
 * site (its origin) and the user name. When all copies of an account agree it is simply imported; when they hold
 * different passwords, the account becomes a conflict with one choice per distinct password.
 */
export function planImport(
  imported: readonly ImportedPassword[],
  existing: readonly ExistingPassword[] = [],
): ImportPlan {
  const groups = new Map<string, ImportedPassword[]>()
  for (const item of imported) {
    if (!item.url || !item.username || !item.password) continue
    const key = accountKey(item.url, item.username)
    const group = groups.get(key)
    if (group) group.push(item)
    else groups.set(key, [item])
  }

  const vault = new Map<string, ExistingPassword>()
  for (const entry of existing) {
    if (!entry.url) continue
    const key = accountKey(entry.url, entry.username)
    const current = vault.get(key)
    if (!current || (entry.updatedAt ?? 0) > (current.updatedAt ?? 0)) vault.set(key, entry)
  }

  const ready: ImportedPassword[] = []
  const conflicts: ImportConflict[] = []

  for (const [key, items] of groups) {
    const saved = vault.get(key)
    const byPassword = new Map<string, ImportChoice>()
    const add = (
      password: string,
      copy: ImportCopy,
      entry: ImportedPassword,
    ) => {
      const choice = byPassword.get(password)
      if (choice) {
        choice.copies.push(copy)
        const stamp = newest([choice.timestampMs, copy.timestampMs])
        if (copy.timestampMs !== null && copy.timestampMs === stamp && copy.timestampMs !== choice.timestampMs) {
          choice.entry = entry
        }
        choice.timestampMs = stamp
        return
      }
      byPassword.set(password, {
        password,
        copies: [copy],
        timestampMs: copy.timestampMs,
        recommended: false,
        entry,
      })
    }

    for (const item of items) {
      add(
        item.password,
        {
          browser: item.browser ?? '',
          profile: item.profile ?? '',
          timestampMs: copyTimestamp(item),
        },
        { label: item.label, url: item.url, username: item.username, password: item.password },
      )
    }
    if (saved) {
      add(
        saved.password,
        { browser: NEBULA_SOURCE, profile: '', timestampMs: saved.updatedAt ?? null },
        {
          label: saved.label || hostOf(saved.url ?? ''),
          url: saved.url ?? items[0].url,
          username: saved.username,
          password: saved.password,
        },
      )
    }

    const choices = [...byPassword.values()]
    if (choices.length === 1) {
      ready.push(choices[0].entry)
      continue
    }

    // The most recently used or saved password is the proposal; on a tie the first one found stays.
    let best = 0
    choices.forEach((choice, index) => {
      if ((choice.timestampMs ?? -1) > (choices[best].timestampMs ?? -1)) best = index
    })
    choices[best].recommended = true
    conflicts.push({
      key,
      host: hostOf(items[0].url),
      username: items[0].username,
      choices,
    })
  }

  return { ready, conflicts }
}

/** The entries to save once the user has picked (or accepted the proposals for) every conflict. */
export function resolveImport(plan: ImportPlan, picks: ImportPicks = {}): ImportedPassword[] {
  const resolved = [...plan.ready]
  for (const conflict of plan.conflicts) {
    const picked = picks[conflict.key]
    const choice =
      conflict.choices[picked ?? -1] ?? conflict.choices.find((candidate) => candidate.recommended)
    if (choice) resolved.push(choice.entry)
  }
  return resolved
}
