import assert from 'node:assert/strict'
import test from 'node:test'
import { FAVICON_CACHE_KEY, createFaviconCache, faviconHostKey } from '../src/core/faviconCache.ts'

const ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='

function fakeStorage(initial: string | null = null) {
  let value = initial
  return {
    getItem: (key: string) => (key === FAVICON_CACHE_KEY ? value : null),
    setItem: (key: string, next: string) => {
      if (key === FAVICON_CACHE_KEY) value = next
    },
    value: () => value,
  }
}
const keep = async (icon: string) => icon

test('an icon is remembered by site and found from any page of that site, with or without www', async () => {
  const cache = createFaviconCache(fakeStorage(), keep)
  assert.equal(await cache.remember('https://www.youtube.com/watch?v=1', ICON, false), true)
  for (const url of ['https://youtube.com/', 'https://www.youtube.com/feed/subscriptions', 'http://youtube.com/x']) {
    assert.equal(cache.lookup(url), ICON, url)
  }
  assert.equal(cache.lookup('https://music.youtube.com/'), null, 'another host is another site')
})

test('private tabs, local addresses, addresses without a domain and other schemes are never remembered', async () => {
  const cache = createFaviconCache(fakeStorage(), keep)
  assert.equal(await cache.remember('https://secret.example.com/', ICON, true), false)
  for (const url of ['http://localhost:3000/', 'http://192.168.1.4/', 'https://intranet/', 'file:///c:/x.html', 'about:blank']) {
    assert.equal(await cache.remember(url, ICON, false), false, url)
  }
  assert.equal(cache.size(), 0)
  assert.equal(faviconHostKey('https://www.Example.com./a'), 'example.com')
  assert.equal(faviconHostKey('chrome://settings'), null)
})

test('only icons that are images and small enough are taken, and what is stored is small', async () => {
  const cache = createFaviconCache(fakeStorage(), keep)
  assert.equal(await cache.remember('https://a.example.com/', 'https://a.example.com/favicon.ico', false), false)
  assert.equal(await cache.remember('https://b.example.com/', 'data:image/png;base64,' + 'A'.repeat(100_000), false), false)
  const huge = createFaviconCache(fakeStorage(), async () => 'data:image/png;base64,' + 'A'.repeat(30_000))
  assert.equal(await huge.remember('https://c.example.com/', ICON, false), false, 'a scaled icon that is still big')
  const failing = createFaviconCache(fakeStorage(), async () => null)
  assert.equal(await failing.remember('https://d.example.com/', ICON, false), false, 'an icon that cannot be decoded')
})

test('an icon is refreshed only after a couple of weeks', async () => {
  let clock = 1_000_000
  const cache = createFaviconCache(fakeStorage(), keep, () => clock)
  assert.equal(await cache.remember('https://site.example.com/', ICON, false), true)
  clock += 3 * 24 * 60 * 60 * 1000
  assert.equal(await cache.remember('https://site.example.com/', ICON, false), false)
  clock += 12 * 24 * 60 * 60 * 1000
  assert.equal(await cache.remember('https://site.example.com/', ICON, false), true)
})

test('the cache is kept at a fixed size, dropping the icons that have not been refreshed for longest', async () => {
  let clock = 1_000_000
  const cache = createFaviconCache(fakeStorage(), keep, () => (clock += 1000))
  for (let i = 0; i < 260; i += 1) await cache.remember(`https://site${i}.example.com/`, ICON, false)
  assert.equal(cache.size(), 250)
  assert.equal(cache.lookup('https://site0.example.com/'), null)
  assert.equal(cache.lookup('https://site259.example.com/'), ICON)
})

test('it survives a restart, a damaged cache, and storage that refuses to write', async () => {
  const storage = fakeStorage()
  await createFaviconCache(storage, keep).remember('https://kept.example.com/', ICON, false)
  assert.equal(createFaviconCache(storage, keep).lookup('https://kept.example.com/'), ICON)
  assert.equal(createFaviconCache(fakeStorage('not json'), keep).size(), 0)
  assert.equal(createFaviconCache(fakeStorage('{"version":1,"icons":{"x.example.com":{"icon":"javascript:alert(1)","at":1}}}'), keep).size(), 0)
  const full = createFaviconCache(
    {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota')
      },
    },
    keep,
  )
  assert.equal(await full.remember('https://site.example.com/', ICON, false), true)
  assert.equal(full.lookup('https://site.example.com/'), ICON, 'kept for this run')
})

test('the cache key is outside the shell state mirror, which has size limits and is not a place for derived data', () => {
  assert.ok(FAVICON_CACHE_KEY.startsWith('__nebula_'))
})

test('a site with no icon yet is asked for once, the icon is scaled and kept, and the next time nothing is asked', async () => {
  const asked: string[] = []
  const fetcher = async (host: string) => {
    asked.push(host)
    return ICON
  }
  const cache = createFaviconCache(fakeStorage(), keep, () => 1_000_000, fetcher)
  assert.equal(await cache.ensure('https://www.example.com/page'), ICON)
  assert.deepEqual(asked, ['example.com'], 'the site, not the page, and without www')
  assert.equal(await cache.ensure('https://example.com/other'), ICON)
  assert.equal(cache.lookup('https://example.com/'), ICON)
  assert.deepEqual(asked, ['example.com'], 'a known site is not asked for again')
})

test('several rows asking for one site at once make one request', async () => {
  let calls = 0
  let release: (value: string) => void = () => undefined
  const gate = new Promise<string>((resolve) => {
    release = resolve
  })
  const cache = createFaviconCache(fakeStorage(), keep, () => 1_000_000, async () => {
    calls += 1
    return gate
  })
  const answers = [cache.ensure('https://one.example.com/'), cache.ensure('https://one.example.com/x'), cache.ensure('http://one.example.com/')]
  release(ICON)
  assert.deepEqual(await Promise.all(answers), [ICON, ICON, ICON])
  assert.equal(calls, 1)
})

test('a site that has no icon anywhere is not asked again for a few days, then is', async () => {
  let clock = 1_000_000
  let calls = 0
  const storage = fakeStorage()
  const cache = createFaviconCache(storage, keep, () => clock, async () => {
    calls += 1
    return null
  })
  assert.equal(await cache.ensure('https://nothing.example.com/'), null)
  assert.equal(await cache.ensure('https://nothing.example.com/'), null)
  assert.equal(calls, 1)
  // The miss survives a restart.
  const again = createFaviconCache(storage, keep, () => clock, async () => {
    calls += 1
    return null
  })
  assert.equal(await again.ensure('https://nothing.example.com/'), null)
  assert.equal(calls, 1)
  clock += 4 * 24 * 60 * 60 * 1000
  assert.equal(await again.ensure('https://nothing.example.com/'), null)
  assert.equal(calls, 2)
})

test('a failing or lying native side never breaks the cache or stores rubbish', async () => {
  const failing = createFaviconCache(fakeStorage(), keep, () => 1, async () => {
    throw new Error('network')
  })
  assert.equal(await failing.ensure('https://down.example.com/'), null)
  const lying = createFaviconCache(fakeStorage(), keep, () => 1, async () => 'javascript:alert(1)')
  assert.equal(await lying.ensure('https://liar.example.com/'), null)
  assert.equal(lying.size(), 0)
  // No native side (a plain browser) just means no fetching.
  assert.equal(await createFaviconCache(fakeStorage(), keep).ensure('https://x.example.com/'), null)
  // Addresses that are not a site are never asked for.
  const never = createFaviconCache(fakeStorage(), keep, () => 1, async () => {
    throw new Error('must not be asked')
  })
  for (const url of ['http://localhost:3000/', 'https://intranet/', 'file:///c:/x', 'http://192.168.0.2/']) {
    assert.equal(await never.ensure(url), null, url)
  }
})

test('the favicon command is registered, permitted and open to the shell only', async () => {
  const { readFileSync } = await import('node:fs')
  const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  assert.match(read('src-tauri/src/lib.rs'), /favicon_fetch::favicon_fetch/)
  assert.match(read('src-tauri/permissions/webview-commands.toml'), /identifier = "allow-favicon-fetch"[\s\S]*?"favicon_fetch"/)
  const capability = JSON.parse(read('src-tauri/capabilities/default.json'))
  assert.ok(capability.permissions.includes('allow-favicon-fetch'))
  // The capability that has it covers the shell's webviews, not tabs, popups or extension pages.
  for (const webview of capability.webviews) assert.doesNotMatch(webview, /nebula-tab|popup|extension/)
  // The native side only asks public sites for small images.
  const native = read('src-tauri/src/favicon_fetch.rs')
  assert.match(native, /is_local_network_host/)
  assert.match(native, /MAX_ICON_BYTES/)
})

test('rows that show icons are told when one is kept, and when another window changed the cache', async () => {
  const storage = fakeStorage()
  const cache = createFaviconCache(storage, keep)
  let told = 0
  const stop = cache.subscribe(() => {
    told += 1
  })
  const before = cache.version()
  assert.equal(await cache.remember('https://a.example.com/', ICON, false), true)
  assert.equal(told, 1)
  assert.ok(cache.version() > before)
  // Nothing new kept: nobody is told.
  assert.equal(await cache.remember('https://a.example.com/', ICON, false), false)
  assert.equal(told, 1)
  // Another window kept an icon: read the stored cache again.
  const other = createFaviconCache(storage, keep)
  await other.remember('https://b.example.com/', ICON, false)
  assert.equal(cache.lookup('https://b.example.com/'), null, 'not known until it is read again')
  cache.reload()
  assert.equal(told, 2)
  assert.equal(cache.lookup('https://b.example.com/'), ICON)
  stop()
  cache.reload()
  assert.equal(told, 2, 'a row that stopped listening is not told')
})
