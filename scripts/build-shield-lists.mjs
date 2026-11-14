// Fetches the filter lists the shield ships with and prepares them for its engine.
//
//   node scripts/build-shield-lists.mjs [--offline-from <folder>]
//
// What it does, and why it is needed:
//
// - The engine (adblock-rust) reads the lists' rules but not the preprocessor directives uBlock Origin's lists use
//   (`!#if env_safari` ... `!#endif`, `!#include`). It takes those lines for comments, so every rule inside a condition would apply
//   whatever the condition says (rules for Safari, for phones, for a browser extension that is not this one). The directives are
//   resolved here, for the environment Nebula is, and the lists are written without them.
// - uBlock's main list is published in pieces (`filters.txt` includes `filters-2020.txt` ... `filters-2026.txt`, the general and the
//   mobile ones, the link shorteners). Its `.min.txt` files are the pieces put together, which is what a browser needs. The raw
//   file alone holds about a quarter of the rules, and none of the redirect rules YouTube's player depends on.
//
// The result goes to src-tauri/resources/shield/lists, with a manifest that says where each list came from, when, and the hash of
// what was fetched and of what was written. Run it again to refresh the lists, and commit what it writes.
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * What uBlock's preprocessor tokens are for Nebula: a Chromium (Edge) web view on a computer, with an engine that can hide with a
 * style but cannot filter the HTML of a page. Any token that is not here is false, as it is for uBlock.
 */
export const ENVIRONMENT = {
  env_chromium: true,
  env_edge: true,
  env_firefox: false,
  env_safari: false,
  env_mobile: false,
  env_legacy: false,
  env_experimental: false,
  ext_ublock: false,
  ext_ubol: false,
  ext_abp: false,
  ext_devbuild: false,
  adguard: false,
  cap_html_filtering: false,
  cap_user_stylesheet: true,
  cap_ipaddress: true,
}

/** The value of an expression of tokens, `!`, `&&`, `||` and parentheses. */
export function evaluate(expression, environment = ENVIRONMENT) {
  const tokens = expression.match(/[A-Za-z0-9_]+|&&|\|\||[!()]/g) ?? []
  let at = 0
  const peek = () => tokens[at]
  const or = () => {
    let value = and()
    while (peek() === '||') { at++; const right = and(); value = value || right }
    return value
  }
  const and = () => {
    let value = not()
    while (peek() === '&&') { at++; const right = not(); value = value && right }
    return value
  }
  const not = () => {
    if (peek() === '!') { at++; return !not() }
    return atom()
  }
  const atom = () => {
    const token = tokens[at++]
    if (token === '(') {
      const value = or()
      if (tokens[at++] !== ')') throw new Error(`Missing ) in "${expression}"`)
      return value
    }
    if (token === undefined || /^(&&|\|\||[!)])$/.test(token)) throw new Error(`Unexpected "${token}" in "${expression}"`)
    return environment[token] === true
  }
  const value = or()
  if (at !== tokens.length) throw new Error(`Unexpected "${tokens[at]}" in "${expression}"`)
  return value
}

/**
 * The list without its directives: what is inside a condition that is false is dropped, the conditions themselves go, and so
 * does `!#include` (the pieces are already put together in the `.min` lists).
 */
export function preprocess(text, environment = ENVIRONMENT) {
  const out = []
  const stack = []
  const active = () => stack.every((frame) => frame.active)
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.startsWith('!#if ')) {
      stack.push({ active: evaluate(trimmed.slice(5), environment), condition: trimmed.slice(5) })
    } else if (trimmed === '!#else') {
      if (!stack.length) throw new Error('!#else without !#if')
      stack[stack.length - 1].active = !stack[stack.length - 1].active
    } else if (trimmed === '!#endif') {
      if (!stack.length) throw new Error('!#endif without !#if')
      stack.pop()
    } else if (trimmed.startsWith('!#include ')) {
      continue
    } else if (active()) {
      out.push(line)
    }
  }
  if (stack.length) throw new Error(`Unclosed !#if ${stack[stack.length - 1].condition}`)
  return out.join('\n')
}

/** What is shipped: the file it is written to, where it comes from. */
export const LISTS = [
  { file: 'easylist.txt', url: 'https://easylist.to/easylist/easylist.txt' },
  { file: 'easyprivacy.txt', url: 'https://easylist.to/easylist/easyprivacy.txt' },
  { file: 'ubo-filters.txt', url: 'https://ublockorigin.github.io/uAssets/filters/filters.min.txt' },
  { file: 'ubo-privacy.txt', url: 'https://ublockorigin.github.io/uAssets/filters/privacy.min.txt' },
  { file: 'ubo-unbreak.txt', url: 'https://ublockorigin.github.io/uAssets/filters/unbreak.min.txt' },
  { file: 'ubo-badware.txt', url: 'https://ublockorigin.github.io/uAssets/filters/badware.min.txt' },
  { file: 'pgl.txt', url: 'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=1&mimetype=plaintext' },
]

const sha256 = (text) => createHash('sha256').update(text).digest('hex')

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = resolve('src-tauri/resources/shield/lists')
  const offline = process.argv.indexOf('--offline-from')
  const source = offline >= 0 ? resolve(process.argv[offline + 1]) : null
  mkdirSync(out, { recursive: true })
  const manifest = []
  for (const list of LISTS) {
    let text
    if (source) {
      text = readFileSync(join(source, list.file), 'utf8')
    } else {
      const response = await fetch(list.url)
      if (!response.ok) throw new Error(`${list.url}: ${response.status}`)
      text = await response.text()
    }
    // One newline at the end, whatever the source had.
    const prepared = preprocess(text).replace(/\n*$/, '\n')
    writeFileSync(join(out, list.file), prepared)
    const rules = prepared.split('\n').filter((line) => line && !line.startsWith('!') && !line.startsWith('[')).length
    manifest.push({ file: list.file, url: list.url, fetched: sha256(text), written: sha256(prepared), bytes: prepared.length, rules })
    console.log(`${list.file.padEnd(16)} ${String(prepared.length).padStart(8)} bytes, ${rules} rules`)
  }
  writeFileSync(join(out, 'MANIFEST.json'), JSON.stringify({ environment: ENVIRONMENT, lists: manifest }, null, 2) + '\n')
}
