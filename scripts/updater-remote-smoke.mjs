import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const tauri = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'))
const endpoint = tauri.plugins?.updater?.endpoints?.[0]
if (!endpoint) throw new Error('No updater endpoint configured in tauri.conf.json')

console.log(`Updater endpoint: ${endpoint}`)
const response = await fetch(endpoint, { redirect: 'follow', cache: 'no-store' })
if (!response.ok) throw new Error(`latest.json request failed: HTTP ${response.status}`)
const manifest = await response.json()
const platform = manifest.platforms?.['windows-x86_64']
if (!manifest.version) throw new Error('Remote latest.json has no version')
if (!platform?.url) throw new Error('Remote latest.json has no windows-x86_64 URL')
if (!platform?.signature || String(platform.signature).trim().length < 32) throw new Error('Remote latest.json signature is missing/too short')
if (!String(platform.url).startsWith('https://')) throw new Error('Remote installer URL is not HTTPS')
if (!String(platform.url).endsWith(`Nebula_${manifest.version}_x64-setup.exe`)) throw new Error('Remote installer filename/version mismatch')

console.log(`✓ Manifest version ${manifest.version}`)
console.log('✓ Updater signature present')
console.log(`Checking installer asset: ${platform.url}`)

let assetResponse = await fetch(platform.url, { method: 'HEAD', redirect: 'follow', cache: 'no-store' })
if (!assetResponse.ok || assetResponse.status === 405) {
  assetResponse = await fetch(platform.url, {
    method: 'GET',
    headers: { Range: 'bytes=0-0' },
    redirect: 'follow',
    cache: 'no-store',
  })
}
if (!assetResponse.ok) throw new Error(`Installer asset is not reachable: HTTP ${assetResponse.status}`)
const length = assetResponse.headers.get('content-length')
console.log(`✓ Installer asset reachable${length ? ` (${length} bytes reported)` : ''}`)
console.log('✓ Remote updater contract looks valid')
