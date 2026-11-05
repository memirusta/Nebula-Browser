import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parsePasswordCsv, type ImportedPassword } from '../src/core/passwordCsv.ts'
import {
  NEBULA_SOURCE,
  planImport,
  resolveImport,
} from '../src/core/passwordImportCompare.ts'
import { initialBrowserChoices } from '../src/core/passwordImportSources.ts'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

function copy(overrides: Partial<ImportedPassword> = {}): ImportedPassword {
  return {
    label: 'shop.example',
    url: 'https://shop.example/login',
    username: 'me@example.com',
    password: 'pw-one',
    browser: 'chrome',
    profile: 'Default',
    createdMs: 1_000,
    lastUsedMs: null,
    ...overrides,
  }
}

test('an account that every browser agrees on is imported as it is', () => {
  const plan = planImport([
    copy(),
    copy({ browser: 'brave', profile: 'Default', url: 'https://www.shop.example/signin' }),
    copy({ browser: 'chrome', profile: 'Profile 1' }),
  ])
  assert.equal(plan.conflicts.length, 0)
  assert.equal(plan.ready.length, 1, 'three copies of one account are one entry')
  assert.equal(plan.ready[0].password, 'pw-one')
})

test('the same account with different passwords becomes a conflict, with the newest one suggested', () => {
  const plan = planImport([
    copy({ browser: 'chrome', password: 'old-pw', lastUsedMs: 1_000 }),
    copy({ browser: 'brave', password: 'new-pw', lastUsedMs: 9_000 }),
    copy({ browser: 'opera', password: 'new-pw', lastUsedMs: 5_000 }),
  ])
  assert.equal(plan.ready.length, 0)
  assert.equal(plan.conflicts.length, 1)
  const [conflict] = plan.conflicts
  assert.equal(conflict.host, 'shop.example')
  assert.equal(conflict.username, 'me@example.com')
  assert.equal(conflict.choices.length, 2, 'one choice per distinct password')

  const recommended = conflict.choices.find((choice) => choice.recommended)!
  assert.equal(recommended.password, 'new-pw')
  assert.deepEqual(recommended.copies.map((c) => c.browser).sort(), ['brave', 'opera'])
  assert.equal(recommended.timestampMs, 9_000)
  assert.equal(conflict.choices.filter((choice) => choice.recommended).length, 1)
})

test('without a choice the suggested password is saved; a choice overrides it', () => {
  const plan = planImport([
    copy({ browser: 'chrome', password: 'old-pw', lastUsedMs: 1_000 }),
    copy({ browser: 'brave', password: 'new-pw', lastUsedMs: 9_000 }),
    copy({ username: 'other@example.com', password: 'alone' }),
  ])
  const byUser = (entries: ImportedPassword[], user: string) => entries.find((e) => e.username === user)!

  const suggested = resolveImport(plan)
  assert.equal(suggested.length, 2)
  assert.equal(byUser(suggested, 'me@example.com').password, 'new-pw')
  assert.equal(byUser(suggested, 'other@example.com').password, 'alone')

  const key = plan.conflicts[0].key
  const oldIndex = plan.conflicts[0].choices.findIndex((choice) => choice.password === 'old-pw')
  const overridden = resolveImport(plan, { [key]: oldIndex })
  assert.equal(byUser(overridden, 'me@example.com').password, 'old-pw')
})

test('a password already saved in Nebula is one of the choices, so an import cannot silently replace it', () => {
  const plan = planImport(
    [copy({ password: 'browser-pw', lastUsedMs: 1_000 })],
    [
      {
        url: 'https://shop.example/',
        username: 'ME@example.com',
        password: 'vault-pw',
        label: 'Shop',
        updatedAt: 50_000,
      },
    ],
  )
  assert.equal(plan.conflicts.length, 1)
  const [conflict] = plan.conflicts
  assert.deepEqual(
    conflict.choices.map((choice) => choice.copies[0].browser).sort(),
    ['chrome', NEBULA_SOURCE],
  )
  // Saved more recently than the browser copy was used: Nebula's own password is the suggestion.
  assert.equal(conflict.choices.find((choice) => choice.recommended)!.password, 'vault-pw')

  // The same password in both: nothing to decide.
  const same = planImport([copy({ password: 'same-pw' })], [
    { url: 'https://shop.example/', username: 'me@example.com', password: 'same-pw', updatedAt: 1 },
  ])
  assert.equal(same.conflicts.length, 0)
})

test('different sites or different accounts never conflict with each other', () => {
  const plan = planImport([
    copy({ password: 'a' }),
    copy({ url: 'https://other.example/', password: 'b' }),
    copy({ username: 'second@example.com', password: 'c' }),
    copy({ url: 'http://shop.example/', password: 'd' }),
  ])
  assert.equal(plan.conflicts.length, 0)
  assert.equal(plan.ready.length, 4, 'http and https are different origins')
})

test('copies without a date are still compared, and the first one found stays the suggestion', () => {
  const plan = planImport([
    copy({ password: 'first', createdMs: null, lastUsedMs: null }),
    copy({ browser: 'brave', password: 'second', createdMs: null, lastUsedMs: null }),
  ])
  const [conflict] = plan.conflicts
  assert.equal(conflict.choices[0].password, 'first')
  assert.ok(conflict.choices[0].recommended)
  assert.equal(conflict.choices[0].timestampMs, null)
})

test('a large import is compared without any cap', () => {
  const many = Array.from({ length: 5000 }, (_, index) =>
    copy({ url: `https://site${index}.example/`, password: `pw-${index}` }),
  )
  const plan = planImport(many)
  assert.equal(plan.ready.length, 5000)
  assert.equal(resolveImport(plan).length, 5000)
})

test('only the browser Windows opens links with is ticked at first, and only for what it has', () => {
  const both = { bookmarks: true, passwords: true }
  const defaults = { bookmarks: true, passwords: false }
  const chrome = { browser: 'chrome', displayName: 'Google Chrome', bookmarkCount: 50, loginCount: 20, passwordsDirect: true }
  const brave = { browser: 'brave', displayName: 'Brave', isDefault: true, bookmarkCount: 33, loginCount: 4, passwordsDirect: true }
  const nothing = { browser: 'vivaldi', displayName: 'Vivaldi', isDefault: true, bookmarkCount: null, loginCount: null, passwordsDirect: false }

  assert.deepEqual(initialBrowserChoices([chrome, brave], both, defaults), {
    chrome: { bookmarks: false, passwords: false },
    brave: { bookmarks: true, passwords: false },
  })
  assert.deepEqual(initialBrowserChoices([chrome], both, defaults), { chrome: { bookmarks: true, passwords: false } }, 'the only browser there is')
  assert.deepEqual(initialBrowserChoices([chrome, { ...brave, isDefault: false }], both, defaults), {
    chrome: { bookmarks: false, passwords: false },
    brave: { bookmarks: false, passwords: false },
  }, 'no guessing between several')
  // A browser with nothing to take stays unticked, even as the default.
  assert.deepEqual(initialBrowserChoices([nothing], both, defaults), { vivaldi: { bookmarks: false, passwords: false } })
  assert.deepEqual(initialBrowserChoices([], both, defaults), {})
  // A screen that only offers passwords (the Google setup) ticks them for the default browser.
  assert.deepEqual(initialBrowserChoices([chrome, brave], { bookmarks: false, passwords: true }, { passwords: true }), {
    chrome: { bookmarks: false, passwords: false },
    brave: { bookmarks: false, passwords: true },
  })
})

test('the CSV exports of the common browsers and password managers are understood', () => {
  const exports: Record<string, string> = {
    'Chrome, Edge, Brave, Opera, Vivaldi': 'name,url,username,password,note\nex,https://a.example/,me,pw1,\n',
    Firefox: '"url","username","password","httpRealm","formActionOrigin"\n"https://a.example","me","pw1",,"https://a.example"\n',
    Safari: 'Title,URL,Username,Password,Notes,OTPAuth\nex,https://a.example/,me,pw1,,\n',
    '1Password': 'Title,Url,Username,Password,OTPAuth\nex,https://a.example/,me,pw1,\n',
    LastPass: 'url,username,password,totp,extra,name,grouping,fav\nhttps://a.example/,me,pw1,,,ex,,0\n',
    Dashlane: 'username,username2,title,password,note,url\nme,,ex,pw1,,https://a.example/\n',
    Bitwarden:
      'folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\n,,login,ex,,,0,https://a.example/,me,pw1,\n',
    KeePass: '"Account","Login Name","Password","Web Site","Comments"\n"ex","me","pw1","https://a.example/",""\n',
  }
  for (const [name, csv] of Object.entries(exports)) {
    const rows = parsePasswordCsv(csv)
    assert.equal(rows.length, 1, name)
    assert.equal(rows[0].username, 'me', name)
    assert.equal(rows[0].password, 'pw1', name)
    assert.equal(rows[0].url.replace(/\/$/, ''), 'https://a.example', name)
  }
})

test('a Bitwarden export keeps only its logins and takes the first address of a login', () => {
  const csv = [
    'folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp',
    ',,login,Shop,,,0,"https://shop.example/\nhttps://shop.example/other",me,pw1,',
    ',,note,Secret note,text,,0,,,,',
    ',,card,Visa,,,0,,,,',
  ].join('\n')
  const rows = parsePasswordCsv(csv)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].url, 'https://shop.example/')
  assert.equal(rows[0].label, 'Shop')
})

test('an address without a scheme gets one so the saved password can match the site', () => {
  const rows = parsePasswordCsv('"Account","Login Name","Password","Web Site"\n"ex","me","pw1","shop.example/login"\n')
  assert.equal(rows[0].url, 'https://shop.example/login')
  assert.equal(parsePasswordCsv('url,username,password\nandroid://com.example.app,me,pw\n')[0].url, 'android://com.example.app')
})

test('the password import has no cap, compares before saving, and Settings keeps its per-browser buttons', () => {
  const hook = read('../src/hooks/useBrowserImport.ts')
  const platform = read('../src/platform/browserPasswordImport.ts')
  const settings = read('../src/components/SettingsPanel/AccountSettingsSection.tsx')
  const setup = read('../src/core/googleAccountSetup.ts')
  const rust = read('../src-tauri/src/browser_passwords.rs')
  const panel = read('../src/components/GoogleAccountSetupModal/GoogleAccountSetupPanel.tsx')

  // The Google setup uses the shared import: nothing is ticked until the user asks, and conflicts are decided first.
  assert.ok(panel.includes('const DEFAULTS = { passwords: true }'))
  assert.ok(panel.includes('load: importPasswords'))
  assert.ok(panel.includes('useBrowserImport({'))
  assert.ok(panel.includes('<PasswordConflictList'))
  assert.ok(hook.includes('readPasswordsFromBrowsers(passwordBrowsers)'))
  assert.ok(hook.includes('planImport(read.imported, existingPasswords)'))

  // No cap anywhere: the importer asks for everything.
  assert.ok(!platform.includes('limit'))
  assert.doesNotMatch(setup + settings, /importDefaultBrowserPasswords\(\d/)
  assert.match(rust, /limit: Option<usize>,\s*browser: Option<String>/)

  // Firefox is recognised but never offered as a direct password import in Settings.
  assert.ok(settings.includes('filter((source) => !source.csvOnly)'))
})
