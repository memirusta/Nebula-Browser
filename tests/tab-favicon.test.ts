import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  browserTabsReducer,
  initialBrowserTabsState,
} from '../src/core/browserTabsReducer.ts'
import { faviconForUrl } from '../src/core/browserTab.ts'
import { shortcutFromUrl } from '../src/core/shortcutFromUrl.ts'
import { shortcutsFromImportedBookmarks } from '../src/core/bookmarkImport.ts'
import {
  inlinePngSize,
  isLowResolutionInlineFavicon,
  normalizePageFavicon,
} from '../src/core/pageFavicon.ts'
import { updatePinnedShortcutFavicon } from '../src/core/pinnedShortcuts.ts'

const actualGmailFavicon = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='

function pngHeaderDataUrl(width: number, height: number): string {
  const header = Buffer.from([
    137, 80, 78, 71, 13, 10, 26, 10,
    0, 0, 0, 13, 73, 72, 68, 82,
    (width >>> 24) & 255, (width >>> 16) & 255, (width >>> 8) & 255, width & 255,
    (height >>> 24) & 255, (height >>> 16) & 255, (height >>> 8) & 255, height & 255,
  ])
  return `data:image/png;base64,${header.toString('base64')}`
}

test('a native page favicon replaces the hostname fallback and survives title-only snapshots', () => {
  let state = browserTabsReducer(initialBrowserTabsState, {
    type: 'open-or-switch',
    shortcut: {
      id: 'gmail',
      label: 'Gmail',
      url: 'https://mail.google.com',
    },
    reload: false,
    activate: true,
  })

  state = browserTabsReducer(state, {
    type: 'apply-snapshot',
    shortcutId: 'gmail',
    url: 'https://mail.google.com/mail/u/0/#inbox',
    title: 'Inbox',
    favicon: actualGmailFavicon,
  })
  assert.equal(state.tabs[0]?.favicon, actualGmailFavicon)
  assert.equal(
    state.tabs[0]?.navigation.entries[state.tabs[0]?.navigation.index ?? -1]?.favicon,
    actualGmailFavicon,
  )

  state = browserTabsReducer(state, {
    type: 'apply-snapshot',
    shortcutId: 'gmail',
    url: 'https://mail.google.com/mail/u/0/#inbox',
    title: '(1) Inbox',
    favicon: null,
  })
  assert.equal(state.tabs[0]?.favicon, actualGmailFavicon)

  state = browserTabsReducer(state, {
    type: 'apply-snapshot',
    shortcutId: 'gmail',
    url: 'https://example.com/',
    title: 'Example',
    favicon: null,
  })
  assert.match(
    state.tabs[0]?.favicon ?? '',
    /domain_url=https%3A%2F%2Fexample\.com%2F/,
  )
})

test('hostname fallback sends only the public origin to the favicon service', () => {
  const favicon = new URL(faviconForUrl(
    'https://username:password@example.com:8443/account/reset?token=secret#private-fragment',
  ))

  assert.equal(favicon.searchParams.get('domain_url'), 'https://example.com:8443/')
  assert.equal(favicon.searchParams.get('sz'), '128')
  assert.doesNotMatch(favicon.href, /username|password|account|token|secret|private-fragment/)
})

test('local and unsupported favicon fallbacks use the bundled icon without a network request', () => {
  for (const url of [
    'http://192.168.1.1/settings?password=secret',
    'http://10.0.0.1/',
    'http://172.16.0.1/',
    'http://169.254.1.1/',
    'http://127.0.0.1:3000/',
    'http://localhost:3000/',
    'http://service.localhost/',
    'http://printer.local/',
    'http://printer.local./',
    'http://intranet/',
    'http://intranet./',
    'http://[::1]/',
    'http://[fd00::1]/',
    'http://[fe80::1]/',
    'http://[::ffff:192.168.1.1]/',
    'file:///C:/private/document.html',
    'ftp://example.com/private',
    'data:text/html,private',
    'about:blank',
    'invalid URL',
  ]) {
    assert.equal(faviconForUrl(url), '/nebula-app-logo.png', url)
  }
})

test('visited and imported local shortcuts keep their bundled favicon through tab creation', () => {
  for (const url of [
    'http://192.168.1.1/settings',
    'http://localhost:3000/private',
    'http://printer.local/',
    'http://intranet/',
    'http://[::1]/',
    // Search-like local routes must stay local even though the search shortcut
    // logic maps public regional engines to their existing icon aliases.
    'http://google.local/search?q=private',
    'http://bing.local/search?q=private',
  ]) {
    const visited = shortcutFromUrl(url)
    const imported = shortcutsFromImportedBookmarks([{ title: 'Synthetic', url }])[0]
    assert.ok(visited, url)
    assert.ok(imported, url)
    for (const shortcut of [visited, imported]) {
      assert.equal(shortcut.favicon, '/nebula-app-logo.png', url)
      const state = browserTabsReducer(initialBrowserTabsState, {
        type: 'open-or-switch', shortcut, reload: false, activate: true,
      })
      assert.equal(state.tabs[0]?.favicon, '/nebula-app-logo.png', url)
    }
  }
})

test('public shortcut icons preserve hostname and search-engine aliases without URL details', () => {
  const url = 'https://user:secret@www.example.com/reset?token=private#fragment'
  const visited = shortcutFromUrl(url)
  const imported = shortcutsFromImportedBookmarks([{ title: 'Synthetic', url }])[0]
  for (const shortcut of [visited, imported]) {
    assert.ok(shortcut?.favicon)
    assert.equal(new URL(shortcut.favicon).searchParams.get('domain_url'), 'https://example.com/')
    assert.doesNotMatch(shortcut.favicon, /user|secret|reset|token|private|fragment/)
  }
  for (const [searchUrl, expectedOrigin] of [
    ['https://www.google.co.uk/search?q=private', 'https://google.com/'],
    ['https://www.bing.com/search?q=private', 'https://bing.com/'],
    ['https://duckduckgo.com/?q=private', 'https://duckduckgo.com/'],
  ]) {
    const shortcut = shortcutFromUrl(searchUrl)
    assert.ok(shortcut?.favicon)
    assert.equal(new URL(shortcut.favicon).searchParams.get('domain_url'), expectedOrigin)
  }
})

test('native favicon sources accept bounded images and reject active/local schemes', () => {
  assert.equal(normalizePageFavicon(actualGmailFavicon), actualGmailFavicon)
  assert.equal(
    normalizePageFavicon('https://cdn.example/icon.png'),
    'https://cdn.example/icon.png',
  )
  assert.equal(normalizePageFavicon('javascript:alert(1)'), null)
  assert.equal(normalizePageFavicon('file:///C:/secret.png'), null)
  assert.equal(normalizePageFavicon('blob:https://example.com/id'), null)
  assert.equal(normalizePageFavicon('data:text/html;base64,PGgxPkJvb208L2gxPg=='), null)
})

test('small WebView2 tab-strip PNGs are rejected before UI upscaling can blur them', () => {
  const small = pngHeaderDataUrl(16, 16)
  const sharp = pngHeaderDataUrl(128, 128)

  assert.deepEqual(inlinePngSize(small), { width: 16, height: 16 })
  assert.equal(isLowResolutionInlineFavicon(small), true)
  assert.equal(normalizePageFavicon(small), null)
  assert.equal(isLowResolutionInlineFavicon(sharp), false)
  assert.equal(normalizePageFavicon(sharp), sharp)
})

test('a live favicon refreshes the matching pin across same-origin redirects only', () => {
  const pins = [{
    id: 'gmail',
    url: 'https://mail.google.com/',
    title: 'Gmail',
    favicon: 'generic-google.png',
  }]

  const refreshed = updatePinnedShortcutFavicon(
    pins,
    'gmail',
    'https://mail.google.com/mail/u/0/#inbox',
    actualGmailFavicon,
  )
  assert.equal(refreshed[0]?.favicon, actualGmailFavicon)
  assert.equal(refreshed[0]?.url, pins[0]?.url)
  assert.equal(refreshed[0]?.title, pins[0]?.title)

  assert.equal(
    updatePinnedShortcutFavicon(
      refreshed,
      'gmail',
      'https://accounts.example/',
      'data:image/png;base64,external',
    ),
    refreshed,
  )
})

test('native metadata uses WebView2 favicon bytes and rejects stale navigation callbacks', () => {
  const native = readFileSync(
    new URL('../src-tauri/src/tab_metadata.rs', import.meta.url),
    'utf8',
  )

  assert.match(native, /add_FaviconChanged/)
  assert.match(native, /FaviconUri/)
  assert.match(native, /usable_favicon_uri/)
  assert.match(native, /GetFavicon\(COREWEBVIEW2_FAVICON_IMAGE_FORMAT_PNG/)
  assert.match(native, /if current_url != expected_url/)
  assert.match(native, /FAVICON_REQUEST_EPOCHS/)
  assert.match(native, /MAX_FAVICON_BYTES: usize = 64 \* 1024/)
  assert.match(native, /FAVICON_CACHE/)
})
