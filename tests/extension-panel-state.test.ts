import assert from 'node:assert/strict'
import test from 'node:test'
import { createExtensionPanelController, type ExtensionPanelState } from '../src/core/extensionPanelState.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}

test('late polling cannot revert a mutation, and actions stay locked through status refresh', async () => {
  const old = deferred<string[]>()
  const latest = deferred<string[]>()
  let reads = 0
  let operations = 0
  let state: ExtensionPanelState<string> | undefined
  const controller = createExtensionPanelController(() => ++reads === 1 ? old.promise : latest.promise, value => { state = value })
  const poll = controller.refresh()
  await controller.refresh()
  assert.equal(reads, 1)
  const mutation = controller.run('claude', async () => { operations++ })
  await Promise.resolve()
  assert.equal(state?.pending, 'claude')
  await controller.run('another', async () => { operations++ })
  await controller.refresh()
  assert.equal(operations, 1)
  assert.equal(reads, 2)
  latest.resolve(['disabled'])
  await mutation
  old.resolve(['enabled'])
  await poll
  assert.deepEqual(state?.items, ['disabled'])
  assert.equal(state?.pending, null)
})

test('polling recovers read failures without erasing an operation failure', async () => {
  const states: ExtensionPanelState<string>[] = []
  let failRead = true
  const controller = createExtensionPanelController(async () => {
    if (failRead) throw new Error('profile unavailable')
    return ['installed']
  }, value => states.push(value))
  await controller.refresh()
  assert.match(states.at(-1)!.error, /profile unavailable/)
  failRead = false
  await controller.refresh()
  assert.equal(states.at(-1)!.error, '')
  await controller.run('claude', async () => { throw new Error('open failed') })
  await controller.refresh()
  assert.match(states.at(-1)!.error, /open failed/)
  await controller.run('claude', async () => {})
  assert.equal(states.at(-1)!.error, '')
})

test('disposed panel ignores late reads and does not refresh after a pending action', async () => {
  for (const duringAction of [false, true]) {
    const pending = deferred<string[]>()
    let reads = 0
    let updates = 0
    const controller = createExtensionPanelController(() => { reads++; return pending.promise }, () => { updates++ })
    const work = duringAction ? controller.run('fixture', () => pending.promise) : controller.refresh()
    controller.dispose()
    const before = updates
    pending.resolve(['late'])
    await work
    await controller.refresh()
    await controller.run('fixture', async () => { assert.fail('disposed action ran') })
    assert.equal(updates, before)
    assert.equal(reads, duringAction ? 0 : 1)
  }
})
