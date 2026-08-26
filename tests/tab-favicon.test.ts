import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  browserTabsReducer,
  initialBrowserTabsState,
} from '../src/core/browserTabsReducer.ts'
import { faviconForUrl } from '../src/core/browserTab.ts'
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

test('hostname fallback requests a high-resolution icon for the complete page URL', () => {
  const favicon = faviconForUrl('https://example.com/account?tab=profile')

  assert.match(favicon, /domain_url=https%3A%2F%2Fexample\.com%2Faccount%3Ftab%3Dprofile/)
  assert.match(favicon, /sz=128/)
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
