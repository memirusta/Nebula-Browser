import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('Store recovery apology appears once for existing users on only the target release', () => {
  const state = readFileSync(
    new URL('../src/core/storeRecoveryNotice.ts', import.meta.url),
    'utf8',
  )

  assert.match(state, /STORE_RECOVERY_NOTICE_VERSION = '1\.8\.5'/)
  assert.match(state, /appVersion !== STORE_RECOVERY_NOTICE_VERSION/)
  assert.match(state, /getItem\(ONBOARDING_COMPLETE_KEY\) === '1'/)
  assert.match(state, /getItem\(STORE_RECOVERY_NOTICE_SEEN_KEY\) !== '1'/)
  assert.match(state, /setItem\(STORE_RECOVERY_NOTICE_SEEN_KEY, '1'\)/)
})

test('only the Store app mounts the Store recovery apology', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const packageJson = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { dependencies?: Record<string, string> }
  const isStoreTree = !packageJson.dependencies?.['@tauri-apps/plugin-updater']

  if (isStoreTree) {
    assert.match(app, /<StoreRecoveryNotice\s*\/>/)
  } else {
    assert.doesNotMatch(app, /<StoreRecoveryNotice\s*\/>/)
  }
})
