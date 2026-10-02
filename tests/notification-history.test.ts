import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

function fixture() {
  let stored: Array<{ id: string; tabLabel?: string; read?: boolean; body?: string }> = []
  const deleted = new Set<string>()
  const replay = new Map<string, unknown>()
  const privateTabs = new Set(['private-tab'])
  let queue: Promise<unknown> = Promise.resolve()
  let failDelete = false
  const code = ts.transpileModule(readFileSync(new URL('../src/core/notificationHistory.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const openWindow = () => {
    const exports: Record<string, any> = {}
    vm.runInNewContext(code, {
      exports, Event: class {}, window: { dispatchEvent() {} },
      localStorage: { getItem: () => stored.length ? JSON.stringify(stored) : null },
      navigator: { locks: { request: (_: string, work: () => Promise<void>) => {
        const result = queue.then(work)
        queue = result.catch(() => undefined)
        return result
      } } },
      require: (name: string) => {
        if (name === '../platform/runtime') return { isTauri: true }
        if (name === '@tauri-apps/api/event') return { emit: async () => {} }
        if (name === './storageSync') return {
          persistLocalStorage: (_: string, value: string) => { stored = JSON.parse(value) },
          removeLocalStorage: () => { stored = [] },
        }
        if (name === './notification') return {
          loadNotifications: () => JSON.parse(JSON.stringify(stored)),
          MAX_STORED_NOTIFICATIONS: 200, NOTIFICATION_STORE_KEY: 'history',
        }
        if (name === '@tauri-apps/api/core') return { invoke: async (command: string, args: any) => {
          if (command === 'notification_history_allowed_ids') {
            return args.items.filter((item: any) => !deleted.has(item.id) && !privateTabs.has(item.tabLabel)).map((item: any) => item.id)
          }
          assert.equal(command, 'notification_history_forget')
          if (failDelete) throw new Error('Native deletion failed')
          const ids = args.all ? [...args.ids, ...replay.keys()] : args.ids
          for (const id of ids) { deleted.add(id); replay.delete(id) }
        } }
        throw new Error(`Unexpected dependency: ${name}`)
      },
    })
    return exports.changeNotificationHistory as (change: any) => Promise<void>
  }
  return { openWindow, replay, read: () => stored, failDelete: () => { failDelete = true } }
}

test('private site and download messages never enter persistent notification history', async () => {
  const f = fixture()
  await f.openWindow()({ type: 'add', items: [
    { id: 'site-private', tabLabel: 'private-tab', body: 'secret' },
    { id: 'download-private', tabLabel: 'private-tab', body: 'private filename' },
    { id: 'site-public', tabLabel: 'normal-tab', body: 'normal' },
  ] })
  assert.deepEqual(f.read().map((item) => item.id), ['site-public'])
})

test('deletion survives late replay, repeated download updates and a new window', async () => {
  const f = fixture()
  const first = f.openWindow()
  const items = [{ id: 'site-1', body: 'old message' }, { id: 'download-1', body: 'old file' }]
  await first({ type: 'add', items })
  f.replay.set('site-1', items[0])
  await first({ type: 'remove', id: 'site-1' })
  await first({ type: 'remove', id: 'download-1' })
  await f.openWindow()({ type: 'add', items })
  assert.deepEqual(f.read(), [])
  assert.equal(f.replay.size, 0)
})

test('clear also removes buffered events that have not reached the center yet', async () => {
  const f = fixture()
  f.replay.set('pending-site', { body: 'buffered content' })
  await f.openWindow()({ type: 'remove' })
  await f.openWindow()({ type: 'add', items: [{ id: 'pending-site' }, { id: 'new-site' }] })
  assert.equal(f.replay.size, 0)
  assert.deepEqual(f.read().map((item) => item.id), ['new-site'])
})

test('competing windows cannot overwrite a completed deletion with a stale list', async () => {
  const f = fixture()
  const a = f.openWindow()
  const b = f.openWindow()
  await a({ type: 'add', items: [{ id: 'old', body: 'remove me' }] })
  await Promise.all([
    a({ type: 'remove', id: 'old' }),
    b({ type: 'add', items: [{ id: 'old' }, { id: 'new' }] }),
    a({ type: 'read', read: true }),
  ])
  assert.deepEqual(f.read().map((item) => item.id), ['new'])
  assert.equal(f.read()[0].read, true)
})

test('a failed native deletion leaves the visible stored record intact', async () => {
  const f = fixture()
  const update = f.openWindow()
  await update({ type: 'add', items: [{ id: 'keep-until-deleted' }] })
  f.failDelete()
  await assert.rejects(update({ type: 'remove' }), /Native deletion failed/)
  assert.equal(f.read().length, 1)
})
