import assert from 'node:assert/strict'
import test from 'node:test'
import { createExtensionCatalogStatus, type ExtensionCatalogStatus } from '../src/core/extensionCatalogStatus.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('a batch started before an operation cannot undo it, but a later profile read can', async () => {
  const before = deferred<Record<string, string>>()
  const after = deferred<Record<string, string>>()
  let reads = 0
  let state: ExtensionCatalogStatus<string> | undefined
  const controller = createExtensionCatalogStatus(() => ++reads === 1 ? before.promise : after.promise, value => { state = value })
  const first = controller.refresh()
  controller.setStatus('claude', 'removed')
  before.resolve({ claude: 'enabled', mcafee: 'enabled' })
  await first
  assert.deepEqual(state?.statuses, { claude: 'removed', mcafee: 'enabled' })
  const second = controller.refresh()
  after.resolve({ claude: 'disabled' })
  await second
  assert.deepEqual(state?.statuses, { claude: 'disabled' })
})

test('out-of-order focus refreshes cannot restore stale entries or old errors', async () => {
  const old = deferred<Record<string, string>>()
  const fresh = deferred<Record<string, string>>()
  let reads = 0
  let state: ExtensionCatalogStatus<string> | undefined
  const controller = createExtensionCatalogStatus(() => ++reads === 1 ? old.promise : fresh.promise, value => { state = value })
  const first = controller.refresh()
  const second = controller.refresh()
  fresh.resolve({ other: 'enabled' })
  await second
  old.reject(new Error('old profile failure'))
  await first
  assert.deepEqual(state, { statuses: { other: 'enabled' }, failed: false })
})

test('failed refresh retains known statuses and a successful retry clears the failure', async () => {
  let fail = true
  let state: ExtensionCatalogStatus<string> | undefined
  const controller = createExtensionCatalogStatus(async () => {
    if (fail) throw new Error('profile unavailable')
    return { extension: 'disabled' }
  }, value => { state = value })
  controller.setStatus('extension', 'enabled')
  await controller.refresh()
  assert.deepEqual(state, { statuses: { extension: 'enabled' }, failed: true })
  fail = false
  await controller.refresh()
  assert.deepEqual(state, { statuses: { extension: 'disabled' }, failed: false })
})

test('closed settings discard late profile and operation responses', async () => {
  const pending = deferred<Record<string, string>>()
  let updates = 0
  const controller = createExtensionCatalogStatus(() => pending.promise, () => { updates++ })
  const work = controller.refresh()
  controller.dispose()
  pending.resolve({ extension: 'enabled' })
  await work
  controller.setStatus('extension', 'disabled')
  await controller.refresh()
  assert.equal(updates, 0)
})
