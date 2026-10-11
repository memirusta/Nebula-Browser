import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import type { HistoryEntry } from '../src/core/browsingHistory.ts'

test('a visit in another window cannot restore deleted history or lose a competing visit', async () => {
  let stored: HistoryEntry[] = [{ id: 'old', url: 'https://old.example', host: 'old.example', title: 'old', visitedAt: 1 }]
  const locks = new Map<string, Promise<unknown>>()
  const source = readFileSync(new URL('../src/core/browsingHistoryMutations.ts', import.meta.url), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const createWindow = () => {
    const exports = {}
    vm.runInNewContext(output, {
      exports,
      navigator: { locks: { request: (key: string, operation: () => void) => {
        const result = (locks.get(key) ?? Promise.resolve()).then(operation)
        locks.set(key, result.catch(() => undefined))
        return result
      } } },
      require: (id: string) => {
        if (id === '../platform/runtime') return { isTauri: true }
        assert.equal(id, './browsingHistory')
        return {
          BROWSING_HISTORY_KEY: 'history', CLOSED_TABS_KEY: 'closed',
          loadBrowsingHistory: () => structuredClone(stored),
          persistBrowsingHistory: (entries: HistoryEntry[]) => { stored = structuredClone(entries) },
        }
      },
    })
    return exports as typeof import('../src/core/browsingHistoryMutations.ts')
  }
  const first = createWindow()
  const second = createWindow()
  const entry = (id: string): HistoryEntry => ({ id, url: `https://${id}.example`, host: `${id}.example`, title: id, visitedAt: 2 })
  await Promise.all([
    first.updateBrowsingHistory(() => []),
    second.updateBrowsingHistory((current) => [entry('second'), ...current]),
    first.updateBrowsingHistory((current) => [entry('first'), ...current]),
  ])
  assert.deepEqual(stored.map((item) => item.id).sort(), ['first', 'second'])
})
