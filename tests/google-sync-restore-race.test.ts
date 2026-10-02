import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { mergeSyncedPasswords } from '../src/core/googleSyncCrypto.ts'
import * as passwordMatch from '../src/core/passwordMatch.ts'
import * as passwordVaultSchema from '../src/core/passwordVaultSchema.ts'
import type { SavedPassword } from '../src/core/passwordVaultSchema.ts'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

function loadModule(relativePath: string, dependencies: Record<string, unknown>) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const exports: Record<string, unknown> = {}
  vm.runInNewContext(output, {
    exports,
    module: { exports },
    require: (name: string) => {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`)
      return dependencies[name]
    },
    crypto,
    Event,
    window: new EventTarget(),
    localStorage: { removeItem() {} },
  })
  return exports
}

function credential(id: string): SavedPassword {
  return {
    id,
    label: id,
    url: `https://${id}.example`,
    username: id,
    password: `synthetic-${id}`,
    updatedAt: 1,
  }
}

function sharedVault(initial: SavedPassword[]) {
  let stored: string | null = JSON.stringify(initial)
  let conflicts = 0
  const createWindow = () => loadModule('../src/core/passwordVault.ts', {
    '@tauri-apps/api/core': {
      invoke: async (command: string, args?: { json: string; expectedJson: string | null }) => {
        if (command === 'password_vault_load') return stored
        assert.equal(command, 'password_vault_save')
        if (stored !== args!.expectedJson) { conflicts++; return false }
        stored = args!.json
        return true
      },
    },
    '../platform/runtime': { isTauri: true },
    './passwordMatch': passwordMatch,
    './passwordVaultSchema': passwordVaultSchema,
  }) as typeof import('../src/core/passwordVault.ts')
  return { createWindow, read: () => passwordVaultSchema.parsePasswordVault(stored), conflicts: () => conflicts }
}

test('independent windows preserve both concurrent additions through compare-and-save', async () => {
  const f = sharedVault([credential('original')])
  const first = f.createWindow()
  const second = f.createWindow()
  await Promise.all([first.loadPasswordVault(), second.loadPasswordVault()])
  await Promise.all([first.addPasswordEntry(credential('first')), second.addPasswordEntry(credential('second'))])
  assert.deepEqual(f.read().map((item) => item.username).sort(), ['first', 'original', 'second'])
  assert.ok(f.conflicts() > 0, 'the fixture must exercise a native compare failure')
})

test('a competing edit cannot overwrite the edit that committed first', async () => {
  const original = credential('original')
  const f = sharedVault([original])
  const first = f.createWindow()
  const second = f.createWindow()
  await Promise.all([first.loadPasswordVault(), second.loadPasswordVault()])
  const results = await Promise.all([
    first.editPasswordEntry(original.id, original.updatedAt, { ...original, password: 'first' }),
    second.editPasswordEntry(original.id, original.updatedAt, { ...original, password: 'second' }),
  ])
  assert.equal(results.filter((result) => result.updated).length, 1)
  assert.equal(f.read()[0].password, results[0].updated ? 'first' : 'second')
})

test('moving a password to another origin revokes both learned origin lists', async () => {
  const original = { ...credential('original'), usernameOrigins: ['https://login.example'], passwordOrigins: ['https://old.example'] }
  const f = sharedVault([original])
  const vault = f.createWindow()
  await vault.editPasswordEntry(original.id, original.updatedAt, { ...original, url: 'https://new.example', password: 'new-secret' })
  const saved = f.read()[0]
  assert.equal(passwordMatch.passwordEntryMatchesUrl('https://old.example', saved), false)
  assert.equal(passwordMatch.passwordEntryMatchesUrl('https://login.example', saved), false)
  assert.equal(passwordMatch.passwordEntryMatchesUrl(original.url!, saved), false)
  assert.equal(passwordMatch.passwordEntryMatchesUrl('https://new.example', saved), true)
})

test('editing only the path keeps learned split-login origins', async () => {
  const original = { ...credential('original'), passwordOrigins: ['https://login.example'] }
  const f = sharedVault([original])
  await f.createWindow().editPasswordEntry(original.id, original.updatedAt, { ...original, url: original.url + '/signin' })
  assert.equal(passwordMatch.passwordEntryMatchesUrl('https://login.example', f.read()[0]), true)
})

for (const operation of ['add', 'remove'] as const) {
  test(`sync restore preserves a concurrent password ${operation}`, async () => {
    const existing = credential('existing')
    const remote = credential('remote')
    let stored = JSON.stringify([existing])
    let reads = 0
    const restoreReadStarted = deferred()
    const resumeRestoreRead = deferred()
    const effects: string[] = []

    const vault = loadModule('../src/core/passwordVault.ts', {
      '@tauri-apps/api/core': {
        invoke: async (command: string, args?: { json: string; expectedJson: string | null }) => {
          if (command === 'password_vault_load') {
            const snapshot = stored
            reads += 1
            // Initialization reads once. Pause the actual restore read after
            // taking its snapshot, so a racing mutation can be scheduled.
            if (reads === 2) {
              restoreReadStarted.resolve()
              await resumeRestoreRead.promise
            }
            return snapshot
          }
          assert.equal(command, 'password_vault_save')
          if (stored !== args!.expectedJson) return false
          stored = args!.json
          effects.push('vault-save')
          return true
        },
      },
      '../platform/runtime': { isTauri: true },
      './passwordMatch': passwordMatch,
      './passwordVaultSchema': passwordVaultSchema,
    }) as typeof import('../src/core/passwordVault.ts')

    const restore = loadModule('../src/core/googleSyncRestore.ts', {
      './passwordVault': vault,
      './googleSignIn': {},
      '../platform/googleSync': {},
      './googleSync': {
        decryptSyncedPasswords: async () => [remote],
        mergeSyncedPasswords,
        applyGoogleSyncStorage: () => effects.push('storage'),
        saveGoogleSyncPreferences: () => effects.push('preferences'),
        saveGoogleSyncLastSuccess: () => effects.push('success'),
      },
    }) as typeof import('../src/core/googleSyncRestore.ts')

    const restoring = restore.applyGoogleSyncRestore({
      bundle: {
        schemaVersion: 1,
        updatedAt: 1,
        deviceId: 'synthetic-device',
        categories: { passwords: true, bookmarks: false, settings: false },
        storage: {},
        passwords: {
          version: 1,
          algorithm: 'AES-256-GCM',
          kdf: 'PBKDF2-SHA256',
          iterations: 600_000,
          salt: 'synthetic-salt',
          iv: 'synthetic-iv',
          ciphertext: 'synthetic-ciphertext',
        },
      },
      preferences: { passwords: true, bookmarks: false, settings: false },
      syncPassword: 'synthetic-sync-password',
    })

    await restoreReadStarted.promise
    const changing = operation === 'add'
      ? vault.addPasswordEntry(credential('new-local'))
      : vault.removePasswordEntry(existing.id)

    // Let the concurrent operation reach its first native await. A restore
    // outside mutationChain would now allow that write to overtake its read.
    await new Promise<void>((resolve) => setImmediate(resolve))
    resumeRestoreRead.resolve()
    await Promise.all([restoring, changing])

    const final = passwordVaultSchema.parsePasswordVault(stored)
    assert.deepEqual(
      final.map((entry) => entry.username).sort(),
      operation === 'add' ? ['existing', 'new-local', 'remote'] : ['remote'],
    )
    assert.equal(effects[0], 'vault-save')
    assert.ok(effects.includes('success'))
  })
}
