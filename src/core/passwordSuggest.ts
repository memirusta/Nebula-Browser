import type { SavedPassword } from './passwordVault'

/** The words of the list's heading, with `{count}` where the number of accounts goes. */
export interface PasswordSuggestLabels {
  all: string
  filtered: string
  /** The tag on a passkey row. */
  passkey: string
}

export interface PasswordSuggestPayload {
  accounts: string[]
  labels: PasswordSuggestLabels
}

/** The user names to list for a site: the most recently used first, each name once. */
export function suggestionAccounts(matches: readonly SavedPassword[]): string[] {
  const seen = new Set<string>()
  const names: string[] = []
  for (const entry of [...matches].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const name = entry.username.trim()
    const key = name.toLowerCase()
    if (!name || seen.has(key)) continue
    seen.add(key)
    names.push(name)
  }
  return names
}

/** The saved account a pick in the page's list names. A name that is not one of the offered ones gives nothing. */
export function entryForPickedAccount(
  matches: readonly SavedPassword[],
  username: string,
): SavedPassword | null {
  const wanted = username.trim().toLowerCase()
  if (!wanted) return null
  const candidates = matches
    .filter((entry) => entry.username.trim().toLowerCase() === wanted)
    .sort((a, b) => b.updatedAt - a.updatedAt)
  return candidates[0] ?? null
}

/** The script that hands the list to the page. It only calls the function the page script defined at document
 * start; a page without it answers `missing` (the shell then falls back to its own prompt). */
export function buildPasswordSuggestScript(payload: PasswordSuggestPayload): string {
  return `(function(){var f=window.__nebulaPasswordSuggest;if(typeof f!=='function')return 'missing';return f(${JSON.stringify(
    JSON.stringify(payload),
  )});})()`
}

/** The words of the bubble that offers to save or update a password. */
export interface PasswordSaveLabels {
  title: string
  site: string
  account: string
  password: string
  save: string
  dismiss: string
}

/** What the page's bubble is told: the site and the account only. The password stays in the shell. */
export interface PasswordSaveBubble {
  site: string
  username: string
  labels: PasswordSaveLabels
}

/** The script that shows the save/update bubble in the page, or (with `null`) takes it away. A page without the
 * bubble answers `missing` (the shell then asks with its own prompt). */
export function buildPasswordSaveScript(bubble: PasswordSaveBubble | null): string {
  const payload = bubble ?? { hide: true }
  return `(function(){var f=window.__nebulaPasswordSave;if(typeof f!=='function')return 'missing';return f(${JSON.stringify(
    JSON.stringify(payload),
  )});})()`
}
