import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import type { SavedPassword } from '../src/core/passwordVaultSchema.ts'

type Verification = { verified: boolean; reason?: 'unavailable' | 'cancelled' | 'failed' }

function fixture() {
  const entry: SavedPassword = { id: 'synthetic-id', label: 'Synthetic', username: 'fixture', password: 'synthetic-secret', updatedAt: 1 }
  const requests: ((value: Verification) => void)[] = []
  const copied: string[] = []
  const cells: unknown[] = []
  const effects = new Map<number, { deps: unknown[]; cleanup?: () => void }>()
  let cursor = 0
  let scheduled: (() => void)[] = []
  const windowTarget = new EventTarget()
  const documentTarget = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  const timers = new Map<number, () => void>()
  let timerId = 0
  let locks = 0
  const onLock = () => { locks++ }
  const source = readFileSync(new URL('../src/hooks/usePasswordReveal.ts', import.meta.url), 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exports: Record<string, unknown> = {}
  vm.runInNewContext(output, {
    exports,
    window: windowTarget,
    document: documentTarget,
    setTimeout: (callback: () => void) => { timers.set(++timerId, callback); return timerId },
    clearTimeout: (id: number) => { timers.delete(id) },
    navigator: { clipboard: { writeText: async (text: string) => { copied.push(text) } } },
    require: (id: string) => {
      if (id === '../platform/passwordReveal') return {
        verifyPasswordReveal: () => new Promise<Verification>((resolve) => requests.push(resolve)),
      }
      assert.equal(id, 'react')
      return {
        useState: (initial: unknown) => {
          const index = cursor++
          if (!(index in cells)) cells[index] = initial
          return [cells[index], (value: unknown) => {
            cells[index] = typeof value === 'function' ? value(cells[index]) : value
          }]
        },
        useRef: (current: unknown) => {
          const index = cursor++
          if (!(index in cells)) cells[index] = { current }
          return cells[index]
        },
        useCallback: (callback: unknown, deps: unknown[]) => {
          const index = cursor++
          const prior = cells[index] as { callback: unknown; deps: unknown[] } | undefined
          if (!prior || deps.some((dep, i) => dep !== prior.deps[i])) cells[index] = { callback, deps }
          return (cells[index] as { callback: unknown }).callback
        },
        useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
          const index = cursor++
          const prior = effects.get(index)
          if (!prior || deps.some((dep, i) => dep !== prior.deps[i])) {
            scheduled.push(() => {
              prior?.cleanup?.()
              effects.set(index, { deps, cleanup: effect() || undefined })
            })
          }
        },
      }
    },
  })
  const usePasswordReveal = exports.usePasswordReveal as typeof import('../src/hooks/usePasswordReveal.ts').usePasswordReveal
  let entries = [entry]
  function render(nextEntries = entries) {
    entries = nextEntries
    cursor = 0
    scheduled = []
    const result = usePasswordReveal(entries, 'Synthetic verification message', onLock)
    scheduled.forEach((effect) => effect())
    return result
  }
  return {
    entry, requests, copied, render, windowTarget, documentTarget,
    locks: () => locks,
    expire: () => { const pending = [...timers.values()]; timers.clear(); pending.forEach((callback) => callback()) },
    unmount: () => effects.forEach((effect) => effect.cleanup?.()),
  }
}

for (const reason of ['timeout', 'blur', 'hidden'] as const) {
  test(`revealed passwords and edit authorization close on ${reason}`, async () => {
    const f = fixture()
    const showing = f.render().toggleReveal(f.entry)
    f.requests[0]({ verified: true })
    await showing
    assert.equal(f.render().isRevealed(f.entry), true)
    if (reason === 'timeout') f.expire()
    else if (reason === 'blur') f.windowTarget.dispatchEvent(new Event('blur'))
    else {
      f.documentTarget.visibilityState = 'hidden'
      f.documentTarget.dispatchEvent(new Event('visibilitychange'))
    }
    assert.equal(f.render().isRevealed(f.entry), false)
    assert.equal(f.locks(), 1)
    f.unmount()
  })
}

for (const reason of ['cancelled', 'unavailable', 'failed'] as const) {
  test(`password remains masked and cannot be copied when verification is ${reason}`, async () => {
    const f = fixture()
    const show = f.render().toggleReveal(f.entry)
    f.requests[0]({ verified: false, reason })
    await show
    assert.equal(f.render().isRevealed(f.entry), false)
    const copy = f.render().copyPassword(f.entry)
    f.requests[1]({ verified: false, reason })
    await copy
    assert.deepEqual(f.copied, [])
  })
}

test('show and copy each require verification while hide takes effect immediately', async () => {
  const f = fixture()
  const show = f.render().toggleReveal(f.entry)
  assert.equal(f.render().isRevealed(f.entry), false)
  assert.equal(f.render().pendingId, f.entry.id)
  await f.render().toggleReveal(f.entry)
  assert.equal(f.requests.length, 1, 'a double click must not open another verifier')
  f.requests[0]({ verified: true })
  await show
  assert.equal(f.render().isRevealed(f.entry), true)
  await f.render().toggleReveal(f.entry)
  assert.equal(f.render().isRevealed(f.entry), false)
  assert.equal(f.requests.length, 1)
  const copy = f.render().copyPassword(f.entry)
  assert.deepEqual(f.copied, [])
  f.requests[1]({ verified: true })
  await copy
  assert.deepEqual(f.copied, [f.entry.password])
})

test('late approval cannot reveal or copy a replaced credential', async () => {
  for (const action of ['toggleReveal', 'copyPassword'] as const) {
    const f = fixture()
    const pending = f.render()[action](f.entry)
    const replacement = { ...f.entry, password: 'replacement-secret', updatedAt: 2 }
    f.render([replacement])
    f.requests[0]({ verified: true })
    await pending
    assert.equal(f.render().isRevealed(replacement), false)
    assert.equal(f.render().isRevealed(f.entry), false)
    assert.deepEqual(f.copied, [])
  }
})

test('late approval after closing settings cannot reveal or copy a password', async () => {
  for (const action of ['toggleReveal', 'copyPassword'] as const) {
    const f = fixture()
    const pending = f.render()[action](f.entry)
    f.unmount()
    f.requests[0]({ verified: true })
    await pending
    assert.equal(f.render().isRevealed(f.entry), false)
    assert.deepEqual(f.copied, [])
  }
})
