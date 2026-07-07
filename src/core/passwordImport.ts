import type { SavedPassword } from './passwordVault'
import { loadPasswordVault, savePasswordVault } from './passwordVault'

export interface ImportedPassword {
  label: string
  url: string
  username: string
  password: string
}

function entryKey(entry: { url?: string; username: string }): string {
  return `${(entry.url ?? '').toLowerCase()}\0${entry.username.toLowerCase()}`
}

export function mergeImportedPasswords(
  imported: Array<Omit<SavedPassword, 'id' | 'updatedAt'>>,
): SavedPassword[] {
  const map = new Map<string, SavedPassword>()
  for (const entry of loadPasswordVault()) {
    map.set(entryKey(entry), entry)
  }

  const now = Date.now()
  for (const draft of imported) {
    const key = entryKey(draft)
    const existing = map.get(key)
    map.set(key, {
      id: existing?.id ?? crypto.randomUUID(),
      label: draft.label,
      url: draft.url,
      username: draft.username,
      password: draft.password,
      updatedAt: now,
    })
  }

  const next = Array.from(map.values()).sort((a, b) => b.updatedAt - a.updatedAt)
  savePasswordVault(next)
  return next
}

function parseCsvLine(line: string): string[] {
  const values: string[] = []
  let current = ''
  let inQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }
    if (char === ',' && !inQuotes) {
      values.push(current)
      current = ''
      continue
    }
    current += char
  }

  values.push(current)
  return values
}

export function parsePasswordCsv(text: string): ImportedPassword[] {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length < 2) return []

  const header = parseCsvLine(lines[0]).map((value) => value.trim().toLowerCase())
  const urlIndex = header.indexOf('url')
  const usernameIndex = header.indexOf('username')
  const passwordIndex = header.indexOf('password')
  const nameIndex = header.indexOf('name')

  if (urlIndex < 0 || usernameIndex < 0 || passwordIndex < 0) {
    return []
  }

  const imported: ImportedPassword[] = []
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line)
    const url = cols[urlIndex]?.trim() ?? ''
    const username = cols[usernameIndex]?.trim() ?? ''
    const password = cols[passwordIndex] ?? ''
    if (!url || !username || !password) continue

    const label =
      (nameIndex >= 0 ? cols[nameIndex]?.trim() : '') ||
      (() => {
        try {
          return new URL(url).hostname
        } catch {
          return url
        }
      })()

    imported.push({ label, url, username, password })
  }

  return imported
}
