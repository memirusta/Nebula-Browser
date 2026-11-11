import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

import { DEFAULT_SHORTCUTS } from '../src/core/constants.ts'
import {
  isFaviconServiceAddress,
  isPlaceholderFavicon,
  placeholderFavicon,
  usableStoredFavicon,
} from '../src/core/faviconPlaceholder.ts'

const root = new URL('../', import.meta.url)

test('the placeholder is a drawn image of the first letter of the host, the same for the same site', () => {
  const icon = placeholderFavicon('https://www.example.com/some/page?q=1')
  assert.ok(icon.startsWith('data:image/svg+xml'))
  assert.ok(isPlaceholderFavicon(icon))
  assert.equal(icon, placeholderFavicon('example.com'))
  assert.equal(icon, placeholderFavicon('EXAMPLE.com.'))

  const svg = decodeURIComponent(icon)
  assert.match(svg, />E<\/text>/)
  assert.doesNotMatch(svg, /some|page|q=1/)
  // Different sites differ at least by letter.
  assert.match(decodeURIComponent(placeholderFavicon('github.com')), />G<\/text>/)
})

test('a favicon service of a third party is recognised, a site\'s own icon address is not', () => {
  assert.equal(isFaviconServiceAddress('https://www.google.com/s2/favicons?domain=example.com&sz=64'), true)
  assert.equal(isFaviconServiceAddress('https://t1.gstatic.com/faviconV2?client=SOCIAL&url=https://example.com&size=64'), true)
  assert.equal(isFaviconServiceAddress('https://www.google.com/search?q=favicons'), false)
  assert.equal(isFaviconServiceAddress('https://example.com/favicon.ico'), false)
  assert.equal(isFaviconServiceAddress('not an address'), false)
})

test('only an icon the page or the site gave counts as stored', () => {
  const png = 'data:image/png;base64,iVBORw0KGgo='
  assert.equal(usableStoredFavicon(png), png)
  assert.equal(usableStoredFavicon(`  ${png} `), png)
  assert.equal(usableStoredFavicon('https://example.com/favicon.ico'), 'https://example.com/favicon.ico')
  assert.equal(usableStoredFavicon('/nebula-app-logo.png'), '/nebula-app-logo.png')
  assert.equal(usableStoredFavicon('https://www.google.com/s2/favicons?domain=example.com&sz=64'), null)
  assert.equal(usableStoredFavicon(placeholderFavicon('example.com')), null)
  assert.equal(usableStoredFavicon(''), null)
  assert.equal(usableStoredFavicon(undefined), null)
})

test('the default shortcuts carry drawn icons, not a favicon service', () => {
  assert.ok(DEFAULT_SHORTCUTS.length > 0)
  for (const shortcut of DEFAULT_SHORTCUTS) {
    assert.ok(shortcut.favicon && isPlaceholderFavicon(shortcut.favicon), shortcut.id)
  }
})

function sourceFiles(directory: URL, extensions: string[]): string[] {
  const found: string[] = []
  const walk = (path: string) => {
    for (const name of readdirSync(path)) {
      if (name === 'node_modules' || name === 'target' || name === 'dist') continue
      const full = join(path, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (extensions.some((extension) => name.endsWith(extension))) found.push(full)
    }
  }
  walk(directory.pathname.replace(/^\/([A-Za-z]:)/, '$1'))
  return found
}

test('no source asks Google for a site icon', () => {
  const files = [
    ...sourceFiles(new URL('src/', root), ['.ts', '.tsx']),
    ...sourceFiles(new URL('src-tauri/src/', root), ['.rs']),
  ]
  assert.ok(files.length > 50)
  const allowed = new Set(['faviconPlaceholder.ts'])
  for (const file of files) {
    if (allowed.has(file.split(/[\\/]/).pop() ?? '')) continue
    // The Rust test modules name the services to prove they are refused.
    const text = readFileSync(file, 'utf8').split('#[cfg(test)]')[0]
    assert.doesNotMatch(text, /google\.com\/s2\/favicons|gstatic\.com\/favicon|faviconV2/, file)
  }
})
