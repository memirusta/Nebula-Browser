function hashQuery(query: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < query.length; index += 1) {
    hash ^= query.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

export function searchShortcutIdentity(engine: string, query: string): string {
  const canonical = query.trim().toLocaleLowerCase().normalize('NFKC')
  const canonicalComparable = canonical
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
  const asciiComparable = canonical
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
  const fullSlug = asciiComparable
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const slug = (fullSlug || 'query').slice(0, 48)

  const lossy =
    asciiComparable !== canonicalComparable ||
    fullSlug !== asciiComparable ||
    fullSlug.length > 48 ||
    !fullSlug
  const identity = lossy ? `${slug}-${hashQuery(canonical)}` : slug
  return `search-${engine}-${identity}`
}
