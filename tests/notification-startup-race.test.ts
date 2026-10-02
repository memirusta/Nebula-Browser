import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

test('a live notification during subscription cannot skip older buffered notifications', async () => {
  const effects: (() => unknown)[] = []
  const received: string[] = []
  const cursors: (number | null)[] = []
  const event = (sequence: number) => ({
    id: String(sequence), sequence, origin: 'https://example.com', title: 'Synthetic',
    body: 'Synthetic body', timestampMs: sequence,
  })
  const modules: Record<string, unknown> = {
    react: {
      useState: (value: unknown) => [typeof value === 'function' ? value() : value, () => {}],
      useRef: (current: unknown) => ({ current }),
      useCallback: (callback: unknown) => callback,
      useMemo: (factory: () => unknown) => factory(),
      useEffect: (effect: () => unknown) => { effects.push(effect) },
    },
    '@tauri-apps/api/event': {},
    '../platform/runtime': { isTauri: false },
    './useLocale': { useLocale: () => ({ t: (key: string) => key }) },
    '../core/storageSync': { persistLocalStorage() {}, useStorageSync() {} },
    '../core/notificationHistory': {
      NOTIFICATION_HISTORY_CHANGED: 'history-changed',
      changeNotificationHistory: async (change: { type: string; items?: { id: string }[] }) => {
        if (change.type === 'add') received.push(...change.items!.map((item) => item.id))
      },
    },
    '../core/notification': {
      loadNotifications: () => [], loadSiteNotificationPermissions: () => ({}),
      normalizeNotificationOrigin: (origin: string) => origin,
      normalizeNotificationTargetUrl: () => null,
      notificationHost: () => 'example.com', notificationSiteName: () => 'Example',
      listenSiteNotifications: async (receive: (payload: ReturnType<typeof event>) => void) => {
        receive(event(3))
        return () => {}
      },
      replaySiteNotifications: async (after: number | null) => {
        cursors.push(after)
        return [event(1), event(2), event(3)].filter((item) => item.sequence > (after ?? 0))
      },
    },
  }
  const source = readFileSync(new URL('../src/hooks/useNotifications.ts', import.meta.url), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports = {}
  vm.runInNewContext(output, {
    exports, window: new EventTarget(),
    require: (id: string) => { assert.ok(id in modules, id); return modules[id] },
  })
  const hook = exports as typeof import('../src/hooks/useNotifications.ts')
  hook.useNotifications([], true, false)
  const cleanups = effects.map((effect) => effect())
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.deepEqual(cursors, [null])
  assert.deepEqual([...new Set(received)].sort(), ['1', '2', '3'])
  cleanups.forEach((cleanup) => { if (typeof cleanup === 'function') cleanup() })
})
