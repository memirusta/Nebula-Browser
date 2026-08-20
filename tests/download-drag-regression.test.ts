import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8')

test('completed downloads expose native drag-out through an id-only command', () => {
  const coreSource = read('../src/core/download.ts')
  const managerSource = read('../src/components/DownloadManager/DownloadManager.tsx')
  const nativeSource = read('../src-tauri/src/download_manager.rs')
  const libSource = read('../src-tauri/src/lib.rs')
  const permissionsSource = read('../src-tauri/permissions/webview-commands.toml')

  assert.match(coreSource, /invoke\('download_start_drag', \{ id \}\)/)
  assert.doesNotMatch(coreSource, /download_start_drag[^\n]*filePath/)

  assert.match(managerSource, /draggable=\{completed\}/)
  assert.match(managerSource, /startDownloadDrag\(item\.id\)/)
  assert.match(managerSource, /event\.preventDefault\(\)/)

  assert.match(nativeSource, /fn start_download_drag\(app: AppHandle, id: String\)/)
  assert.match(nativeSource, /finished_download_path\(&id\)/)
  assert.match(nativeSource, /SHCreateItemFromParsingName/)
  assert.match(nativeSource, /SHDoDragDrop/)

  assert.match(libSource, /fn download_start_drag\(app: tauri::AppHandle, id: String\)/)
  assert.match(permissionsSource, /"download_start_drag"/)
})
