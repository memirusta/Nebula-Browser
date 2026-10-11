import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { assessExtensionCompatibility, assessExtensionManifest } from '../src/core/extensionCompatibility.ts'

const root = fileURLToPath(new URL('../', import.meta.url))
const args = process.argv.slice(2)
const options = {}
for (let i = 0; i < args.length; i += 2) {
  if (!['--runtime-version', '--manifest', '--packages', '--output'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) {
    throw new Error('Usage: npm run extensions:check -- [--runtime-version VERSION] [--manifest FILE] [--packages FILE] [--output DIRECTORY]')
  }
  options[args[i]] = args[i + 1]
}
const load = async path => JSON.parse(await readFile(path, 'utf8'))
const catalog = await load(resolve(root, 'src/core/extensionDiscoveryCatalog.json'))
const registry = await load(resolve(root, 'src/core/extensionPackages.json'))
const runtime = options['--runtime-version']
const results = catalog.entries.map(entry => ({
  id: entry.id, name: entry.name, version: entry.version,
  report: assessExtensionCompatibility(entry, runtime),
}))
const packages = []
if (options['--packages']) {
  const evidence = await load(resolve(options['--packages']))
  if (!Array.isArray(evidence)) throw new Error('Invalid package evidence')
  for (const item of evidence) {
    const registered = registry.find(p => p.id === item.id && p.version === item.version && p.sha256 === item.sha256)
    if (!registered) throw new Error('Package evidence does not match the current registry')
    packages.push({ id: item.id, version: item.version, sha256: item.sha256,
      packageIntegrity: item.packageIntegrity, manifestFiles: item.manifestFiles,
      report: assessExtensionManifest(item.manifest, runtime) })
  }
}
if (options['--manifest']) {
  const manifest = await load(resolve(options['--manifest']))
  packages.push({ id: 'local-manifest', version: manifest.version,
    packageIntegrity: 'not-run', manifestFiles: 'not-run', report: assessExtensionManifest(manifest, runtime) })
}
const counts = Object.fromEntries(['blocked', 'review', 'candidate'].map(status => [status, results.filter(r => r.report.status === status).length]))
const output = resolve(options['--output'] || resolve(root, 'src-tauri/target/extension-compatibility'))
await mkdir(output, { recursive: true })
await writeFile(resolve(output, 'report.json'), JSON.stringify({ schemaVersion: 1, checkedAt: new Date().toISOString(),
  catalogFetchedAt: catalog.fetchedAt, runtimeVersion: runtime ?? null, counts, results, packages }, null, 2) + '\n')
const escape = text => String(text).replaceAll('|', '\\|').replace(/[\r\n]/g, ' ')
const lines = [
  '# Extension compatibility preflight', '',
  'Static analysis only. Candidate means no static blocker was found; it does not mean compatible.',
  'Store metadata is incomplete. Real packages may declare additional UI and runtime requirements.',
  'Permission access is reported separately from compatibility. No extension code is run by this command.', '',
  `Catalog: ${results.length}; blocked: ${counts.blocked}; review: ${counts.review}; candidate: ${counts.candidate}.`, '',
  '| Extension | Version | Status | Findings |', '| --- | --- | --- | --- |',
  ...results.map(r => `| ${escape(r.name)} | ${escape(r.version)} | ${r.report.status} | ${r.report.issues.map(i => `${i.code}${i.optional ? ' (optional)' : ''}: ${escape(i.details.join(', '))}`).join('; ')} |`),
  '', '## Actual package manifests', '',
  ...packages.map(p => `- ${p.id} ${p.version}: ${p.report.status}; integrity=${p.packageIntegrity}; files=${p.manifestFiles}; findings=${p.report.issues.map(i => i.code).join(', ') || 'none'}`),
  '', 'Real WebView2 load/enable/remove and functionality tests must be recorded separately for each exact package version and runtime.', '',
]
await writeFile(resolve(output, 'report.md'), lines.join('\n'))
console.log(`Checked ${results.length} catalog entries: ${JSON.stringify(counts)}. Actual manifests: ${packages.length}.`)
console.log(`Report: ${resolve(output, 'report.md')}`)
if (packages.some(p => p.report.status === 'blocked')) process.exitCode = 1
