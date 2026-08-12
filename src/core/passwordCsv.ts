export interface ImportedPassword {
  label: string
  url: string
  username: string
  password: string
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

export function parsePasswordCsv(text: string): ImportedPassword[] {
  const rows = parseCsvRecords(text.replace(/^\uFEFF/, ''))
  if (!rows) return []

  const nonEmptyRows = rows.filter((row) => row.some((value) => value.trim().length > 0))
  if (nonEmptyRows.length < 2) return []

  const header = nonEmptyRows[0].map((value) => value.trim().toLowerCase())
  const urlIndex = header.indexOf('url')
  const usernameIndex = header.indexOf('username')
  const passwordIndex = header.indexOf('password')
  const nameIndex = header.indexOf('name')

  if (urlIndex < 0 || usernameIndex < 0 || passwordIndex < 0) {
    return []
  }

  const imported: ImportedPassword[] = []
  for (const cols of nonEmptyRows.slice(1)) {
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
