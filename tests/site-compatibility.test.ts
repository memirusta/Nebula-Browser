import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  addSiteException,
  hostHasSiteException,
  siteCompatibilityTarget,
} from '../src/core/siteCompatibility.ts'

function read(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('compatibility targets accept only HTTP sites', () => {
  assert.deepEqual(
    siteCompatibilityTarget('https://Account.Example.com/path'),
    {
      url: 'https://account.example.com/path',
      hostname: 'account.example.com',
    },
  )
  assert.equal(siteCompatibilityTarget('file:///C:/secret.txt'), null)
  assert.equal(siteCompatibilityTarget('javascript:alert(1)'), null)
  assert.equal(siteCompatibilityTarget('not a url'), null)
})

test('compatibility exceptions cover the selected host and its subdomains only', () => {
  assert.equal(hostHasSiteException('a.example.com', 'example.com'), true)
  assert.equal(hostHasSiteException('example.com.attacker.test', 'example.com'), false)
  assert.equal(
    addSiteException('existing.test', 'www.example.com'),
    'existing.test, www.example.com',
  )
  assert.equal(
    addSiteException('example.com', 'a.example.com'),
    'example.com',
  )
})

test('failed navigations offer the retry without protections only when the person asks, and keep it only if it worked', () => {
  const shell = read('src/components/BrowserShell/BrowserShell.tsx')
  const nativeErrorPage = read('src-tauri/src/tab_error_page.rs')

  assert.match(nativeErrorPage, /nebula-site-compatibility-request/)
  assert.match(nativeErrorPage, /matches!\(parsed\.scheme\(\), "http" \| "https"\)/)
  assert.match(shell, /listenSiteCompatibilityRequests/)
  // The exception is added for the trial and the person is asked again, in the app's own dialog, once the site loaded.
  assert.match(shell, /showAppConfirmation\(copy\.worked, title/)
  assert.match(shell, /await setBrowsePrivacyOptions[\s\S]*?updateCategory\('privacy', 'siteExceptions', siteExceptions\)/)
})
