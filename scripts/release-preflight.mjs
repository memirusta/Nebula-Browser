import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const args = new Set(process.argv.slice(2))
const requireArtifacts = args.has('--require-artifacts')
const requireCurrentManifest = args.has('--require-current-manifest')

let failed = false
const errors = []
const warnings = []
const passes = []

function pass(message) { passes.push(message) }
function warn(message) { warnings.push(message) }
function fail(message) { failed = true; errors.push(message) }
function readJson(rel) { return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')) }
function exists(rel) { return fs.existsSync(path.join(root, rel)) }

const pkg = readJson('package.json')
const tauri = readJson('src-tauri/tauri.conf.json')
const cargoText = fs.readFileSync(path.join(root, 'src-tauri', 'Cargo.toml'), 'utf8')
const cargoVersion = cargoText.match(/^version\s*=\s*"([^"]+)"/m)?.[1]
const version = String(pkg.version ?? '').trim()

if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) fail(`package.json version is not valid semver: ${version || '(empty)'}`)
else pass(`package version ${version}`)

if (tauri.version !== version) fail(`Version mismatch: package.json=${version}, tauri.conf.json=${tauri.version}`)
else pass('package.json and tauri.conf.json versions match')

if (cargoVersion !== version) fail(`Version mismatch: package.json=${version}, Cargo.toml=${cargoVersion ?? '(missing)'}`)
else pass('package.json and Cargo.toml versions match')

const targets = tauri.bundle?.targets
if (!Array.isArray(targets) || !targets.includes('nsis')) fail('tauri.conf.json bundle.targets must include nsis')
else pass('NSIS bundle target enabled')

if (tauri.bundle?.createUpdaterArtifacts !== true) fail('bundle.createUpdaterArtifacts must be true')
else pass('Tauri updater artifacts enabled')

const updater = tauri.plugins?.updater
const pubkey = String(updater?.pubkey ?? '').trim()
const endpoints = Array.isArray(updater?.endpoints) ? updater.endpoints : []
if (!pubkey) fail('Updater public key is missing')
else pass('Updater public key configured')
if (endpoints.length === 0) fail('Updater endpoint is missing')
else if (endpoints.some((u) => !String(u).startsWith('https://'))) fail('All updater endpoints must use HTTPS')
else pass(`Updater endpoint configured (${endpoints[0]})`)

const latestRel = path.join('release', 'latest.json')
if (exists(latestRel)) {
  try {
    const latest = readJson(latestRel)
    const platform = latest.platforms?.['windows-x86_64']
    if (!latest.version) fail('release/latest.json has no version')
    if (!platform?.url) fail('release/latest.json has no windows-x86_64 URL')
    if (!platform?.signature) fail('release/latest.json has no windows-x86_64 signature')
    if (platform?.url && !String(platform.url).startsWith('https://')) fail('latest.json installer URL must use HTTPS')
    if (platform?.url && !String(platform.url).endsWith(`Nebula_${latest.version}_x64-setup.exe`)) {
      fail('latest.json installer filename does not match manifest version')
    }
    if (latest.version === version) pass(`latest.json matches current version ${version}`)
    else if (requireCurrentManifest) fail(`latest.json version ${latest.version} does not match current version ${version}`)
    else warn(`latest.json is ${latest.version}; current source is ${version} (normal before publishing a new release)`)
  } catch (error) {
    fail(`Could not parse release/latest.json: ${error instanceof Error ? error.message : String(error)}`)
  }
} else if (requireCurrentManifest || requireArtifacts) {
  fail('release/latest.json is missing')
} else {
  warn('release/latest.json not found; updater manifest check skipped')
}

const expectedReleaseInstaller = path.join('release', `Nebula_${version}_x64-setup.exe`)
const expectedBundleInstaller = path.join('src-tauri', 'target', 'x86_64-pc-windows-msvc', 'release', 'bundle', 'nsis', `Nebula_${version}_x64-setup.exe`)
const installer = [expectedReleaseInstaller, expectedBundleInstaller].find(exists)
if (installer) {
  const size = fs.statSync(path.join(root, installer)).size
  if (size <= 0) fail(`Installer is empty: ${installer}`)
  else pass(`Installer found: ${installer} (${(size / 1024 / 1024).toFixed(1)} MB)`)
} else if (requireArtifacts) {
  fail(`Installer for ${version} not found in release/ or Tauri bundle output`)
} else {
  warn('Current-version installer not found; build/release artifact checks skipped')
}

console.log('\nNebula release preflight')
for (const p of passes) console.log(`✓ ${p}`)
for (const w of warnings) console.log(`! ${w}`)
for (const e of errors) console.error(`✗ ${e}`)
console.log(`\n${passes.length} passed, ${warnings.length} warning(s), ${errors.length} error(s)`) 
if (failed) process.exit(1)
