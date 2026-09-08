import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isLocalNetworkHostname,
  resolveNavigationInput,
} from '../src/core/addressNavigation.ts'

test('local network hosts are recognized without treating public IPs as local', () => {
  for (const hostname of [
    'localhost',
    'router.local',
    '127.12.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.254',
    '192.168.1.1',
    '169.254.10.20',
    '[::1]',
    '[fd12:3456::1]',
    '[fe80::1]',
  ]) {
    assert.equal(isLocalNetworkHostname(hostname), true, hostname)
  }

  for (const hostname of [
    '172.15.0.1',
    '172.32.0.1',
    '192.0.2.1',
    '8.8.8.8',
    'example.com',
  ]) {
    assert.equal(isLocalNetworkHostname(hostname), false, hostname)
  }
})

test('scheme-less LAN addresses use HTTP while public sites prefer HTTPS', () => {
  assert.equal(
    resolveNavigationInput('192.168.1.1', 'search:192.168.1.1'),
    'http://192.168.1.1/',
  )
  assert.equal(
    resolveNavigationInput('router.local:8080/admin', 'search:router'),
    'http://router.local:8080/admin',
  )
  assert.equal(
    resolveNavigationInput('[fd12:3456::1]', 'search:ipv6'),
    'http://[fd12:3456::1]/',
  )
  assert.equal(
    resolveNavigationInput('example.com/path', 'search:example'),
    'https://example.com/path',
  )
})

test('explicit HTTP and HTTPS choices are preserved', () => {
  assert.equal(
    resolveNavigationInput('https://192.168.1.1/', 'search:lan'),
    'https://192.168.1.1/',
  )
  assert.equal(
    resolveNavigationInput('http://example.com/', 'search:example'),
    'http://example.com/',
  )
})

test('plain words and sentences remain search queries', () => {
  assert.equal(
    resolveNavigationInput('nebula', 'https://duckduckgo.com/?q=nebula'),
    'https://duckduckgo.com/?q=nebula',
  )
  assert.equal(
    resolveNavigationInput('nebula browser', 'https://www.google.com/search?q=nebula%20browser'),
    'https://www.google.com/search?q=nebula%20browser',
  )
  assert.equal(resolveNavigationInput('   ', 'search:empty'), null)
})
