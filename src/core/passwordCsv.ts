export interface ImportedPassword {
  label: string
  url: string
  username: string
  password: string
  /** Where a password read from a browser came from (not set for CSV rows). */
  browser?: string
  profile?: string
  createdMs?: number | null
  lastUsedMs?: number | null
}

/**
 * Parse RFC 4180-style CSV records. Newlines inside quoted fields are part of
 * the field instead of record separators, and doubled quotes are unescaped.
 * Returns null for an unterminated quoted field so callers never import a
 * silently truncated credential file.
 */
function parseCsvRecords(text: string): string[][] | null {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  const pushField = () => {
    row.push(field)
    field = ''
  }

  const pushRow = () => {
    pushField()
    rows.push(row)
    row = []
  }

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]

    if (char === '"') {
      if (inQuotes && text[index + 1] === '"') {
        field += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === ',' && !inQuotes) {
      pushField()
      continue
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && text[index + 1] === '\n') index += 1
      pushRow()
      continue
    }

    field += char
  }

  if (inQuotes) return null

  if (field.length > 0 || row.length > 0) {
    pushRow()
  }

  return rows
}

// Column names of the password exports of the common browsers and managers (lower case). Chrome, Edge, Brave,
// Opera, Vivaldi, Firefox, Safari, 1Password, LastPass and Dashlane use the first names of each list; Bitwarden
// (login_uri, login_username, login_password) and KeePass (Web Site, Login Name) use the others.
const URL_COLUMNS = ['url', 'login_uri', 'web site', 'website', 'uri']
const USERNAME_COLUMNS = ['username', 'login_username', 'login name', 'user name']
const PASSWORD_COLUMNS = ['password', 'login_password']
const NAME_COLUMNS = ['name', 'title', 'account']

function columnIndex(header: string[], names: readonly string[]): number {
  for (const name of names) {
    const index = header.indexOf(name)
    if (index >= 0) return index
  }
  return -1
}

/** The first address of a cell (Bitwarden lists several, one per line), with a scheme so it can be matched. */
function normalizeCsvUrl(value: string): string {
  const first = value.split(/[\r\n]+/).map((part) => part.trim()).find(Boolean) ?? ''
  if (!first) return ''
  return /^[a-z][a-z0-9+.-]*:/i.test(first) ? first : `https://${first}`
}

export function parsePasswordCsv(text: string): ImportedPassword[] {
  const rows = parseCsvRecords(text.replace(/^\uFEFF/, ''))
  if (!rows) return []

  const nonEmptyRows = rows.filter((row) => row.some((value) => value.trim().length > 0))
  if (nonEmptyRows.length < 2) return []

  const header = nonEmptyRows[0].map((value) => value.trim().toLowerCase())
  const urlIndex = columnIndex(header, URL_COLUMNS)
  const usernameIndex = columnIndex(header, USERNAME_COLUMNS)
  const passwordIndex = columnIndex(header, PASSWORD_COLUMNS)
  const nameIndex = columnIndex(header, NAME_COLUMNS)
  // Bitwarden exports notes, cards and identities in the same file; only logins are passwords.
  const typeIndex = header.indexOf('type')

  if (urlIndex < 0 || usernameIndex < 0 || passwordIndex < 0) {
    return []
  }

  const imported: ImportedPassword[] = []
  for (const cols of nonEmptyRows.slice(1)) {
    if (typeIndex >= 0 && (cols[typeIndex]?.trim().toLowerCase() ?? 'login') !== 'login') continue
    const url = normalizeCsvUrl(cols[urlIndex] ?? '')
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
