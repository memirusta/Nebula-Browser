// Builds the scriptlets of the shield from a copy of uBlock Origin's source.
//
//   node scripts/build-shield-resources.mjs <folder that holds uBlock's src/> [--out <file>]
//
// The scriptlets are the bits of JavaScript that the filter lists ask for with `+js(name, arguments)`: they are put in a page
// before its own scripts run, and do things a network rule cannot (take advertising out of YouTube's player data, make `fetch`
// and XHR calls fail for what is on a list, and so on). uBlock Origin keeps them as ES modules that register themselves; this
// imports them in Node, takes the registered list, and writes it in the form the shield's engine reads (adblock-rust's
// `Resource`): the source of each function, base64, with its helpers named as dependencies. The stand-ins that `$redirect=` rules
// serve (a silent script, a one-pixel image) are written beside them, from uBlock's web_accessible_resources.
//
// uBlock Origin is GPL-3.0 like Nebula, so shipping its scriptlets is fine; the lists that call them are in
// src-tauri/resources/shield/lists. Run this again when the lists are updated, and commit the file it writes.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** The `permission` of a resource that only a trusted list may use (adblock-rust's first permission bit). */
const TRUSTED = 1

export function toResources(registered) {
  const resources = []
  for (const details of registered) {
    // uBlock Origin runs some scriptlets (the cookie, storage and attribute ones) in the extension's isolated world. Nebula has no
    // such world, and like Brave's engine it runs every scriptlet in the page's own, where they work the same on the page's DOM,
    // cookies and storage.
    const source = details.fn.toString()
    const isHelper = details.name.endsWith('.fn')
    resources.push({
      name: details.name,
      aliases: details.aliases ?? [],
      kind: { mime: isHelper ? 'fn/javascript' : 'application/javascript' },
      content: Buffer.from(source, 'utf8').toString('base64'),
      ...(details.dependencies?.length ? { dependencies: details.dependencies.filter((name) => typeof name === 'string') } : {}),
      ...(details.requiresTrust ? { permission: TRUSTED } : {}),
    })
  }
  // A dependency that was not registered would be silently dropped by the engine; say so here.
  const names = new Set(resources.map((resource) => resource.name))
  const missing = new Set()
  for (const resource of resources) for (const dependency of resource.dependencies ?? []) if (!names.has(dependency)) missing.add(`${resource.name} -> ${dependency}`)
  return { resources, missing: [...missing] }
}

/** The MIME types adblock-rust knows, by file extension. A file without an extension (uBlock's `empty`) is plain text. */
const MIME_BY_EXTENSION = {
  '.css': 'text/css',
  '.gif': 'image/gif',
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.mp3': 'audio/mp3',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.txt': 'text/plain',
  '.xml': 'text/xml',
  '': 'text/plain',
}

/**
 * uBlock Origin's web-accessible resources (its `redirect-resources.js` map and the files it points to): the stand-ins a `$redirect=`
 * rule serves instead of a blocked script or image (`noop.js`, `1x1.gif`, `google-ima.js`) and the old-style `+js(nofab.js)` lines
 * that run one in the page. `read(file)` gives the bytes of a file of `src/web_accessible_resources`.
 */
export function toRedirectResources(map, read) {
  const resources = []
  for (const [name, details] of map) {
    // The click-to-load page takes parameters in its address: it is a page, not a stand-in, and nothing here serves pages.
    if (details.params) continue
    const mime = MIME_BY_EXTENSION[extname(name).toLowerCase()]
    if (mime === undefined) throw new Error(`No MIME type known for ${name}`)
    const aliases = details.alias === undefined ? [] : Array.isArray(details.alias) ? details.alias : [details.alias]
    resources.push({ name, aliases, kind: { mime }, content: Buffer.from(read(name)).toString('base64') })
  }
  return resources
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  const root = args.find((arg) => !arg.startsWith('--'))
  if (!root) {
    console.error("Give the folder that holds uBlock Origin's src/ (a copy of github.com/gorhill/uBlock).")
    process.exit(1)
  }
  const outIndex = args.indexOf('--out')
  const out = resolve(outIndex >= 0 ? args[outIndex + 1] : 'src-tauri/resources/shield/ubo-scriptlets.json')
  // uBlock's own index (scriptlets.js) imports most of the modules, but not all of them (the cookie and storage scriptlets are
  // among those it leaves out), so every module of the folder is imported and the list is read from where they register.
  const folder = join(resolve(root), 'src/js/resources')
  for (const file of readdirSync(folder).filter((name) => name.endsWith('.js'))) await import(pathToFileURL(join(folder, file)).href)
  const { registeredScriptlets } = await import(pathToFileURL(join(folder, 'base.js')).href)
  const scriptlets = toResources(registeredScriptlets)
  const { default: redirects } = await import(pathToFileURL(join(resolve(root), 'src/js/redirect-resources.js')).href)
  const stubs = toRedirectResources(redirects, (name) => readFileSync(join(resolve(root), 'src/web_accessible_resources', name)))
  const taken = new Set(scriptlets.resources.flatMap((resource) => [resource.name, ...resource.aliases]))
  const clashes = stubs.flatMap((stub) => [stub.name, ...stub.aliases]).filter((name) => taken.has(name))
  if (clashes.length) {
    console.error(`A stand-in has the name of a scriptlet:\n  ${clashes.join('\n  ')}`)
    process.exit(1)
  }
  const resources = [...scriptlets.resources, ...stubs]
  const { missing } = scriptlets
  if (missing.length) {
    console.error(`Dependencies that are not among the scriptlets:\n  ${missing.join('\n  ')}`)
    process.exit(1)
  }
  writeFileSync(out, JSON.stringify(resources))
  const trusted = resources.filter((resource) => resource.permission).length
  console.log(`${scriptlets.resources.length} scriptlets (${trusted} for trusted lists only) and ${stubs.length} stand-ins written to ${out}`)
}
