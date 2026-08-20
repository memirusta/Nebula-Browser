import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = path.resolve(process.cwd(), process.argv[2] ?? '.')
const failures = []
const passes = []

function read(relativePath) {
  const absolutePath = path.join(root, relativePath)
  return fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, 'utf8') : ''
}

function fail(message) {
  failures.push(message)
}

function pass(message) {
  passes.push(message)
}

const packageJson = JSON.parse(read('package.json') || '{}')
const dependencies = {
  ...(packageJson.dependencies ?? {}),
  ...(packageJson.devDependencies ?? {}),
}
if ('@tauri-apps/plugin-updater' in dependencies) {
  fail('package.json contains @tauri-apps/plugin-updater')
} else {
  pass('JavaScript updater dependency is absent')
}

const packageLock = read('package-lock.json')
if (packageLock.includes('@tauri-apps/plugin-updater')) {
  fail('package-lock.json contains @tauri-apps/plugin-updater')
} else {
  pass('JavaScript lockfile is updater-free')
}

const cargoToml = read('src-tauri/Cargo.toml')
const cargoLock = read('src-tauri/Cargo.lock')
if (/tauri-plugin-updater/i.test(cargoToml) || /name\s*=\s*"tauri-plugin-updater"/i.test(cargoLock)) {
  fail('Rust manifests contain tauri-plugin-updater')
} else {
  pass('Rust manifests are updater-free')
}

const tauriConfigText = read('src-tauri/tauri.conf.json')
let tauriConfig = {}
try {
  tauriConfig = JSON.parse(tauriConfigText)
} catch (error) {
  fail(`tauri.conf.json is invalid: ${error instanceof Error ? error.message : String(error)}`)
}
if (tauriConfig.bundle?.createUpdaterArtifacts) {
  fail('bundle.createUpdaterArtifacts must be absent or false')
}
if (tauriConfig.plugins?.updater) {
  fail('plugins.updater must be absent')
}
if (!tauriConfig.bundle?.createUpdaterArtifacts && !tauriConfig.plugins?.updater) {
  pass('Tauri updater configuration is absent')
}

const runtimeFiles = [
  'src-tauri/src/lib.rs',
  'src-tauri/capabilities/default.json',
  'src-tauri/capabilities/desktop.json',
  'src/App.tsx',
  'src/components/SettingsPanel/SettingsPanel.tsx',
]
const forbiddenRuntimePatterns = [
  /tauri_plugin_updater/i,
  /updater:default/i,
  /AppUpdatePrompt/,
  /AboutUpdateSection/,
  /core\/appUpdater/,
]
for (const relativePath of runtimeFiles) {
  const source = read(relativePath)
  for (const pattern of forbiddenRuntimePatterns) {
    if (pattern.test(source)) fail(`${relativePath} matches forbidden updater marker ${pattern}`)
  }
}
if (!failures.some((message) => runtimeFiles.some((file) => message.startsWith(file)))) {
  pass('Runtime registration, capability, and UI are updater-free')
}

const forbiddenPaths = [
  'src/core/appUpdater.ts',
  'src/components/AppUpdatePrompt',
  'src/components/SettingsPanel/AboutUpdateSection.tsx',
  'scripts/updater-remote-smoke.mjs',
]
for (const relativePath of forbiddenPaths) {
  if (fs.existsSync(path.join(root, relativePath))) {
    fail(`Store runtime must not contain ${relativePath}`)
  }
}
if (!forbiddenPaths.some((relativePath) => fs.existsSync(path.join(root, relativePath)))) {
  pass('Updater-only source files are absent')
}

console.log(`\nStore updater audit: ${root}`)
for (const message of passes) console.log(`PASS ${message}`)
for (const message of failures) console.error(`FAIL ${message}`)
console.log(`\n${passes.length} passed, ${failures.length} failed`)
if (failures.length > 0) process.exit(1)
