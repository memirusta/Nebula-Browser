import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../src-tauri/src/webview_privacy.rs', import.meta.url), 'utf8')
  .split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))

test('the cookie shield hides a dialog only on evidence that it is a consent notice, not on one word anywhere in it', () => {
  // Whole words, not parts of other words ("izleme" inside "gözleme" or a menu side called Cookie).
  assert.ok(source.includes("const consentWordsEverywhere = new RegExp(consentWordSource, 'g')"))
  assert.ok(source.includes('const speaksOfConsent = (element, text) =>'))
  // Evidence: its own name, its heading (first two lines), or several mentions.
  const evidence = source.slice(source.indexOf('const speaksOfConsent'), source.indexOf('const state = {'))
  assert.ok(evidence.includes('consentWords.test(name)'))
  assert.ok(evidence.includes('.slice(0, 2)'))
  assert.ok(evidence.includes('found.length >= 3'))
  // The generic root check and the compact notice check both go through it, on what is seen (innerText).
  assert.ok(source.includes("if (text.length > 2500 || !speaksOfConsent(element, text)) return false;"))
  assert.ok(source.includes("if (text.length > 2500 || !speaksOfConsent(current, text)) {"))
  assert.doesNotMatch(source, /element\.innerText \|\| element\.textContent \|\| ''\s*\n\s*if \(!consentWords\.test/)
  // A hidden element says why, so a wrongly hidden dialog can be traced.
  assert.ok(source.includes("element.setAttribute('data-nebula-cookie-reason'"))
  assert.ok(source.includes("element.removeAttribute('data-nebula-cookie-reason')"))
})
