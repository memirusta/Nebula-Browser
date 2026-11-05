import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { IMPORTED_SHORTCUT_LIMIT, planBookmarkShortcuts, type ImportedBookmark } from '../src/core/bookmarkImport.ts'
import { describeImportResult, type BrowserImportResult } from '../src/core/browserImportResult.ts'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

function mark(host: string, overrides: Partial<ImportedBookmark> = {}): ImportedBookmark {
  return { title: host, url: `https://${host}/`, browser: 'chrome', dateAddedMs: 1_000, lastUsedMs: null, ...overrides }
}

test('the most recently used bookmarks become the shortcuts, one per site, across browsers', () => {
  const plan = planBookmarkShortcuts([
    mark('old.example', { lastUsedMs: 1_000 }),
    mark('www.fresh.example', { browser: 'brave', lastUsedMs: 9_000 }),
    mark('fresh.example', { browser: 'chrome', lastUsedMs: 2_000 }),
    mark('middle.example', { browser: 'firefox', dateAddedMs: 5_000, lastUsedMs: null }),
  ])
  assert.deepEqual(
    plan.shortcuts.map((shortcut) => new URL(shortcut.url).hostname),
    ['www.fresh.example', 'middle.example', 'old.example'],
    'recency order; fresh.example from two browsers is one site, the newest copy wins',
  )
  assert.equal(plan.total, 3)
  assert.equal(plan.extra, 0)
})

test('only the limit of shortcuts is made, and the rest is counted', () => {
  assert.equal(IMPORTED_SHORTCUT_LIMIT, 40)
  const many = Array.from({ length: 100 }, (_, index) => mark(`site${index}.example`, { lastUsedMs: index }))
  const plan = planBookmarkShortcuts(many)
  assert.equal(plan.shortcuts.length, 40)
  assert.equal(plan.total, 100)
  assert.equal(plan.extra, 60)
  assert.equal(new URL(plan.shortcuts[0].url).hostname, 'site99.example', 'the newest first')
  assert.equal(planBookmarkShortcuts(many, 5).extra, 95)
})

test('bookmarks without dates keep the order they were read in, and unusable addresses are skipped', () => {
  const plan = planBookmarkShortcuts([
    { title: 'B', url: 'https://b.example/' },
    { title: 'A', url: 'https://a.example/' },
    { title: 'Settings', url: 'chrome://settings' },
    { title: 'Broken', url: 'not a url' },
    { title: 'File', url: 'file:///C:/x.html' },
  ])
  assert.deepEqual(plan.shortcuts.map((shortcut) => shortcut.label), ['B', 'A'])
})

test('a shortcut is labelled with the bookmark title, or the site when it has none', () => {
  const [titled, untitled] = planBookmarkShortcuts([
    mark('titled.example', { title: '  My shop  ', lastUsedMs: 2 }),
    mark('untitled.example', { title: '', lastUsedMs: 1 }),
  ]).shortcuts
  assert.equal(titled.label, 'My shop')
  assert.equal(untitled.label, 'untitled.example')
})

const names = new Map([
  ['chrome', 'Google Chrome'],
  ['firefox', 'Firefox'],
])
const keys = {
  t: (key: string) => `[${key}]`,
  tf: (key: string, vars: Record<string, string | number>) =>
    `[${key} ${Object.entries(vars).map(([name, value]) => `${name}=${value}`).join(' ')}]`,
}
function result(overrides: Partial<BrowserImportResult> = {}): BrowserImportResult {
  return {
    attempted: { bookmarks: true, passwords: false },
    bookmarkShortcuts: 0,
    extraBookmarks: 0,
    passwordCount: 0,
    failures: [],
    ...overrides,
  }
}

test('the import result says what came over, and what was left out', () => {
  const done = describeImportResult(
    result({ attempted: { bookmarks: true, passwords: true }, bookmarkShortcuts: 40, extraBookmarks: 12, passwordCount: 7 }),
    names,
    keys,
  )
  assert.deepEqual(done.lines, [
    '[importBookmarksDone count=40]',
    '[importBookmarksMore count=12]',
    '[gsImportDone count=7]',
  ])
  assert.equal(done.error, false)
  assert.equal(done.needsCsv, false)

  assert.deepEqual(describeImportResult(result(), names, keys).lines, ['[bookmarksNone]'])
})

test('a browser that cannot be read is named, and a CSV export is offered when only that can help', () => {
  const failed = describeImportResult(
    result({
      attempted: { bookmarks: true, passwords: true },
      bookmarkShortcuts: 3,
      passwordCount: 0,
      failures: [
        { browser: 'chrome', kind: 'passwords', needsCsv: true },
        { browser: 'firefox', kind: 'passwords', needsCsv: true },
      ],
    }),
    names,
    keys,
  )
  assert.equal(failed.error, true)
  assert.equal(failed.needsCsv, true)
  assert.ok(failed.lines.includes('[gsBrowserReadFailed browser=Google Chrome]'))
  assert.ok(failed.lines.includes('[gsBrowserReadFailed browser=Firefox]'))
  assert.ok(failed.lines.includes('[gsImportNeedsCsv]'))
  assert.ok(!failed.lines.some((line) => line.startsWith('[gsImportDone')), 'no "0 imported" when every password source failed')

  // A bookmark file that cannot be read is an error but no CSV can help.
  const bookmarks = describeImportResult(
    result({ failures: [{ browser: 'chrome', kind: 'bookmarks', needsCsv: false }] }),
    names,
    keys,
  )
  assert.equal(bookmarks.needsCsv, false)
  assert.ok(!bookmarks.lines.includes('[bookmarksNone]'))
})

test('the new commands are registered in Rust and allowed for the app, and the old ones are gone', () => {
  const lib = read('../src-tauri/src/lib.rs')
  const permissions = read('../src-tauri/permissions/webview-commands.toml')
  for (const command of ['list_browser_import_sources', 'import_browser_bookmarks']) {
    assert.match(lib, new RegExp(`browser_import::${command},`), `${command} in generate_handler!`)
    assert.match(permissions, new RegExp(`"${command}"`), `${command} in the permission file`)
  }
  for (const gone of ['detect_default_browser', 'import_default_browser_bookmarks']) {
    assert.doesNotMatch(lib, new RegExp(gone))
    assert.doesNotMatch(permissions, new RegExp(gone))
  }
  assert.match(lib, /^mod browser_import;/m)
  assert.doesNotMatch(lib, /mod browser_bookmarks;/)
})

test('the first-run import step offers every browser, ticks bookmarks only, and leaves passwords to the user', () => {
  const step = read('../src/components/Onboarding/OnboardingImportStep.tsx')
  const wizard = read('../src/components/Onboarding/OnboardingWizard.tsx')
  const hook = read('../src/hooks/useBrowserImport.ts')

  assert.ok(step.includes('const OFFER = { bookmarks: true, passwords: true }'))
  assert.ok(step.includes('const DEFAULTS = { bookmarks: true, passwords: false }'))
  assert.match(wizard, /<OnboardingImportStep/)
  assert.doesNotMatch(wizard, /detectDefaultBrowser|importDefaultBrowserBookmarks/)

  // Only the ticked browsers are read; passwords are compared and decided before anything is saved.
  assert.match(hook, /importBrowserBookmarks\(browser\)/)
  assert.match(hook, /readPasswordsFromBrowsers\(passwordBrowsers\)/)
  assert.match(hook, /planImport\(read\.imported, existingPasswords\)/)
  assert.match(hook, /resolveImport\(plan, picks\)/)
  // What is read is decided per browser and per kind, from what the user ticked and what the browser has.
  assert.ok(hook.includes('offeredKinds(source, offer)[kind]'))
})

test('the browser lists and the conflict screen never put a password on screen', () => {
  for (const file of [
    '../src/components/BrowserImport/BrowserSourceList.tsx',
    '../src/components/BrowserImport/PasswordConflictList.tsx',
    '../src/components/Onboarding/OnboardingImportStep.tsx',
    '../src/components/GoogleAccountSetupModal/GoogleAccountSetupPanel.tsx',
  ]) {
    const source = read(file)
    assert.doesNotMatch(source, /\.password\b/, `${file} must not read a password field`)
  }
})

test('a failed lookup of the browsers is shown as a failure, not as "no browser found"', () => {
  const platform = read('../src/platform/browserImport.ts')
  const hook = read('../src/hooks/useBrowserImport.ts')
  const step = read('../src/components/Onboarding/OnboardingImportStep.tsx')
  const panel = read('../src/components/GoogleAccountSetupModal/GoogleAccountSetupPanel.tsx')

  const listing = platform.slice(platform.indexOf('export async function listBrowserImportSources'), platform.indexOf('/** Every bookmark of one browser'))
  assert.ok(!listing.includes('catch'), 'the native error must reach the caller')
  assert.ok(hook.includes('setSourcesError(message)'))
  assert.ok(hook.includes('retryLoad: loadSources'))
  assert.ok(step.includes("t('importListFailed')") && step.includes('imp.retryLoad'))
  assert.ok(panel.includes("t('importListFailed')") && panel.includes('imp.retryLoad'))
})

test('an empty list of browsers explains itself: the folders looked in and what was there', () => {
  const list = read('../src/components/BrowserImport/BrowserSourceList.tsx')
  const lib = read('../src-tauri/src/lib.rs')
  const permissions = read('../src-tauri/permissions/webview-commands.toml')
  assert.ok(list.includes('<ImportLookupDetails />'))
  assert.ok(lib.includes('browser_import::browser_import_diagnostics,'))
  assert.ok(permissions.includes('"browser_import_diagnostics"'))
})

test('every browser is listed, each with its own choices, and a browser with nothing to take stays unticked', async () => {
  const { availableKinds, anyChosen, choiceForWholeBrowser, chosenParts, offeredKinds, sourcesWithKinds } = await import('../src/core/passwordImportSources.ts')
  const both = { bookmarks: true, passwords: true }
  // The real case: Brave with one saved login and no bookmarks.
  const brave = { browser: 'brave', displayName: 'Brave', passwordsDirect: true, passwordsCsvOnly: false, loginCount: 1, bookmarkCount: null }
  const firefox = { browser: 'firefox', displayName: 'Firefox', passwordsDirect: false, passwordsCsvOnly: true, loginCount: null, bookmarkCount: 12 }
  const vivaldi = { browser: 'vivaldi', displayName: 'Vivaldi', passwordsDirect: false, passwordsCsvOnly: false, loginCount: null, bookmarkCount: 3 }

  assert.deepEqual(availableKinds(brave), { bookmarks: false, passwords: true })
  assert.deepEqual(availableKinds(firefox), { bookmarks: true, passwords: false }, 'Firefox: bookmarks directly, passwords only as CSV')
  assert.deepEqual(availableKinds({ ...brave, loginCount: null }), { bookmarks: false, passwords: true }, 'an unknown count still allows trying')
  assert.deepEqual(availableKinds({ ...brave, loginCount: 0 }), { bookmarks: false, passwords: false })
  assert.deepEqual(offeredKinds(brave, { bookmarks: true, passwords: false }), { bookmarks: false, passwords: false })

  // With both kinds on offer every browser is a card; a screen with one kind shows the browsers that have it.
  assert.deepEqual(sourcesWithKinds([brave, firefox, vivaldi], both).map((s) => s.browser), ['brave', 'firefox', 'vivaldi'])
  assert.deepEqual(sourcesWithKinds([brave, firefox, vivaldi], { bookmarks: false, passwords: true }).map((s) => s.browser), ['brave'])
  assert.deepEqual(sourcesWithKinds([brave, firefox, vivaldi], { bookmarks: true, passwords: false }).map((s) => s.browser), ['firefox', 'vivaldi'])

  // The checkbox next to a name ticks everything the browser can give, or nothing.
  assert.deepEqual(choiceForWholeBrowser(brave, both, true), { bookmarks: false, passwords: true })
  assert.deepEqual(choiceForWholeBrowser(firefox, both, true), { bookmarks: true, passwords: false })
  assert.deepEqual(choiceForWholeBrowser(firefox, both, false), { bookmarks: false, passwords: false })

  // Under the name: what will be taken, only for what is ticked; nothing ticked, nothing said.
  assert.deepEqual(chosenParts(firefox, { bookmarks: true, passwords: true }, both), [{ kind: 'bookmarks', count: 12 }])
  assert.deepEqual(chosenParts(brave, { bookmarks: true, passwords: true }, both), [{ kind: 'passwords', count: 1 }])
  assert.deepEqual(chosenParts(brave, { bookmarks: false, passwords: false }, both), [])
  assert.deepEqual(chosenParts(brave, undefined, both), [])
  assert.equal(anyChosen({ brave: { bookmarks: false, passwords: false } }), false)
  assert.equal(anyChosen({ brave: { bookmarks: false, passwords: true } }), true)
})
