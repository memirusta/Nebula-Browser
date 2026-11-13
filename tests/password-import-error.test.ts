import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  PASSWORD_IMPORT_LANGUAGES,
  describePasswordImportError,
  parsePasswordImportError,
  passwordImportNeedsCsv,
} from '../src/core/passwordImportError.ts'

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))

const CODES = ['database-missing', 'login-data-missing', 'unreadable', 'app-bound-all', 'app-bound-some', 'undecryptable', 'copy-failed', 'key-unavailable']

test('a code is read from the native message, with what follows it', () => {
  assert.deepEqual(parsePasswordImportError('nebula-import:app-bound-all:12'), { code: 'app-bound-all', details: ['12'] })
  assert.deepEqual(parsePasswordImportError(new Error('nebula-import:app-bound-some:12:5')), { code: 'app-bound-some', details: ['12', '5'] })
  assert.deepEqual(parsePasswordImportError('nebula-import:unreadable'), { code: 'unreadable', details: [] })
  assert.deepEqual(parsePasswordImportError('nebula-import:database-missing:'), { code: 'database-missing', details: [''] })
  // Anything else has no code: a system message, a database error, an unknown code, something that is not text.
  assert.equal(parsePasswordImportError('Veritabanı kopyalanamadı'), null)
  assert.equal(parsePasswordImportError('nebula-import:something-new'), null)
  assert.equal(parsePasswordImportError(undefined), null)
  assert.equal(parsePasswordImportError({ code: 1 }), null)
})

test('the failures that end in "use the CSV export" are told apart from the others', () => {
  for (const code of ['unreadable', 'app-bound-all:3', 'app-bound-some:3:1', 'undecryptable:3']) {
    assert.equal(passwordImportNeedsCsv(`nebula-import:${code}`), true, code)
  }
  for (const code of ['database-missing:brave', 'login-data-missing', 'copy-failed:in use', 'key-unavailable:x']) {
    assert.equal(passwordImportNeedsCsv(`nebula-import:${code}`), false, code)
  }
  assert.equal(passwordImportNeedsCsv('app-bound-v20'), false)
})

test('every failure is put in words in all nine languages, with its numbers filled in', () => {
  assert.deepEqual([...PASSWORD_IMPORT_LANGUAGES].sort(), ['de', 'en', 'es', 'fr', 'id', 'it', 'ja', 'ru', 'tr'])
  for (const locale of PASSWORD_IMPORT_LANGUAGES) {
    for (const code of CODES) {
      const text = describePasswordImportError(locale, `nebula-import:${code}:12:5`)
      assert.ok(text && text.length > 10, `${locale} ${code}`)
      assert.doesNotMatch(text, /[{}]/, `${locale} ${code} has an unfilled placeholder`)
    }
    assert.match(describePasswordImportError(locale, 'nebula-import:app-bound-all:12')!, /12/, `${locale} shows the count`)
    assert.match(describePasswordImportError(locale, 'nebula-import:app-bound-some:12:5')!, /5/, `${locale} shows how many were skipped`)
  }
})

test('a message of the system keeps its colons, and a language without a text falls back to English', () => {
  assert.match(describePasswordImportError('en', 'nebula-import:copy-failed:Access is denied. (os error 5): C:\\x')!, /Access is denied\. \(os error 5\): C:\\x/)
  assert.equal(describePasswordImportError('xx', 'nebula-import:login-data-missing'), describePasswordImportError('en', 'nebula-import:login-data-missing'))
  assert.equal(describePasswordImportError('tr', 'password import failed'), null)
  assert.match(describePasswordImportError('tr', 'nebula-import:app-bound-all:12')!, /12 şifre kaydı/)
})

test('the native side reports these failures as codes, and the window uses them', () => {
  const rust = read('src-tauri/src/browser_passwords.rs')
  for (const code of ['database-missing', 'key-unavailable', 'login-data-missing', 'copy-failed', 'unreadable', 'app-bound-all', 'app-bound-some', 'undecryptable']) {
    assert.ok(rust.includes(`"${code}"`), code)
  }
  // No Turkish sentence is left in what is sent to the window.
  assert.doesNotMatch(rust, /Login Data dosyası bulunamadı|şifre veritabanı bulunamadı|Veritabanı kopyalanamadı|app-bound şifrelemesi/)
  assert.match(read('src/core/googleAccountSetup.ts'), /if \(passwordImportNeedsCsv\(error\)\) return true/)
})
