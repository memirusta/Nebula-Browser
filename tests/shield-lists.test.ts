import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { ENVIRONMENT, evaluate, LISTS, preprocess } from '../scripts/build-shield-lists.mjs'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('a condition is read the way uBlock reads it: unknown tokens are false, ! && || and parentheses work', () => {
  assert.equal(evaluate('env_chromium'), true)
  assert.equal(evaluate('env_firefox'), false)
  assert.equal(evaluate('!env_safari'), true)
  assert.equal(evaluate('env_chromium && !ext_ubol'), true)
  assert.equal(evaluate('env_firefox || env_safari'), false)
  assert.equal(evaluate('(env_firefox || env_chromium) && !env_mobile'), true)
  assert.equal(evaluate('a_token_nobody_knows'), false)
  assert.equal(evaluate('!a_token_nobody_knows'), true)
  assert.throws(() => evaluate('env_chromium &&'))
  assert.throws(() => evaluate('(env_chromium'))
  assert.equal(evaluate('env_firefox', { ...ENVIRONMENT, env_firefox: true }), true, 'the environment can be given')
})

test('what is inside a condition that is false is dropped, the directives go, and nesting and else work', () => {
  const list = [
    '! Title: Test',
    'always.example##.a',
    '!#if env_safari',
    'safari.example##.b',
    '!#endif',
    '!#if env_chromium',
    'chromium.example##.c',
    '!#if env_mobile',
    'chromium-mobile.example##.d',
    '!#else',
    'chromium-desktop.example##.e',
    '!#endif',
    '!#endif',
    '!#if !cap_html_filtering',
    'fallback.example##.f',
    '!#endif',
    '!#include filters-2026.txt',
    'last.example##.g',
  ].join('\n')
  const out = preprocess(list).split('\n')
  assert.deepEqual(out, ['! Title: Test', 'always.example##.a', 'chromium.example##.c', 'chromium-desktop.example##.e', 'fallback.example##.f', 'last.example##.g'])
  assert.throws(() => preprocess('!#if env_chromium\nx##.y'), /Unclosed/)
  assert.throws(() => preprocess('!#endif'), /without/)
})

test('the lists that ship hold no directive, are the put-together ones, and are the ones the manifest says', () => {
  const manifest = JSON.parse(read('src-tauri/resources/shield/lists/MANIFEST.json')) as {
    lists: Array<{ file: string; url: string; written: string; rules: number }>
  }
  assert.deepEqual(manifest.lists.map((list) => list.file), LISTS.map((list) => list.file))
  for (const entry of manifest.lists) {
    // The manifest hashes the text as it was written, with a line feed at the end of a line; a checkout that turns line ends into
    // carriage return and line feed (as on Windows) must not make a file that was not edited look edited.
    const text = read(`src-tauri/resources/shield/lists/${entry.file}`).replace(/\r\n/g, '\n')
    assert.doesNotMatch(text, /^!#/m, `${entry.file} still has a directive`)
    // The manifest says what was written; an edited or half-updated file is seen here.
    assert.equal(createHash('sha256').update(text).digest('hex'), entry.written, entry.file)
  }
  // uBlock's main list is only its core when its pieces are not put together (about a quarter of the rules).
  const main = manifest.lists.find((list) => list.file === 'ubo-filters.txt')!
  assert.ok(main.rules > 20000, `${main.rules} rules`)
  assert.match(main.url, /filters\.min\.txt$/)
  assert.match(read('src-tauri/resources/shield/lists/ubo-filters.txt'), /redirect=doubleclick_instream_ad_status\.js/)
})
