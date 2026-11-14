import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

// What runs in a page is read here as a function, to be sure that it is one; what it does to a page was tried in a browser (see
// docs/SHIELD.md), as no page is made here.
const runtime = read('src-tauri/resources/shield/procedural.js')

test('the part of a page that runs the hiding rules is one function, and leaves alone what it is given nothing of', () => {
  const run = vm.runInNewContext(runtime, { document: {}, window: {} }) as (filters: unknown) => unknown
  assert.equal(typeof run, 'function')
  assert.equal(run([]), undefined, 'no rules, nothing done')
  assert.equal(run(null), undefined)
  assert.equal(run('not a list'), undefined)
})

test('every operator the engine can give is one the page runs, and the actions are too', () => {
  const rust = read('src-tauri/src/shield.rs')
  assert.match(rust, /include_str!\("\.\.\/resources\/shield\/procedural\.js"\)/)
  // The engine's own list (adblock::CosmeticFilterOperator, in kebab case), so that a new one with an update of the engine is noticed.
  for (const operator of ['css-selector', 'has-text', 'matches-attr', 'matches-css', 'matches-css-before', 'matches-css-after', 'matches-path', 'min-text-length', 'upward', 'xpath']) {
    assert.ok(runtime.includes(`'${operator}'`), `${operator} is run`)
  }
  for (const action of ['remove', 'style', 'remove-attr', 'remove-class']) assert.ok(runtime.includes(`case '${action}'`), `${action} is run`)
  // The engine only gives these when it is made with its CSS validation, which is off by default.
  assert.match(read('src-tauri/Cargo.toml'), /adblock = \{[^}]*"css-validation"/)
})

test('it never acts on the page itself, only on rules that start from a selector or a path, and each rule remembers its own', () => {
  assert.match(runtime, /element === root \|\| element === body \|\| element === document\.head \|\| \(body && element\.contains\(body\)\)/)
  assert.match(runtime, /chain\[0\]\.type !== 'css-selector' && chain\[0\]\.type !== 'xpath'/)
  assert.match(runtime, /done: new WeakSet\(\)/)
  // A page that changes all the time is looked at less often, and not at all before there is a page to look at.
  assert.match(runtime, /Math\.min\(2000, delay \* 2\)/)
  assert.match(runtime, /new MutationObserver\(schedule\)/)
  assert.doesNotMatch(runtime, /eval\(|new Function|innerHTML|fetch\(|XMLHttpRequest/, 'no code made of text, no request')
})
