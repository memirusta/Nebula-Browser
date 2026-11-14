import assert from 'node:assert/strict'
import test from 'node:test'
import { nativeTabFailureMessage } from '../src/core/nativeTabFailure.ts'

test('native Rust errors keep their diagnostics next to the general explanation', () => {
  const result = nativeTabFailureMessage({ errorValue: 'Could not create the web view: access denied' }, 'tr')
  assert.match(result.message, /Sayfa başlatılamadı/)
  assert.match(result.message, /access denied/)
})

test('ordinary navigation failures do not blame protection', () => {
  const result = nativeTabFailureMessage({ errorMessage: 'webview create timeout' }, 'en')
  assert.match(result.message, /webview create timeout/)
  assert.doesNotMatch(result.message, /ad-blocking/)
  assert.doesNotMatch(nativeTabFailureMessage(null, 'en').message, /undefined|null/)
})

test('unexpected values are not stringified and error text is bounded', () => {
  assert.doesNotMatch(nativeTabFailureMessage({ errorValue: { token: 'secret' } }, 'en').message, /secret|object/)
  assert.ok(nativeTabFailureMessage({ errorMessage: 'x'.repeat(5000) }, 'en').message.length < 1200)
})
