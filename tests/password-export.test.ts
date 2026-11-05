import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

test('exporting the passwords is one native command that the shell only asks, never feeds', () => {
  const rust = read('../src-tauri/src/password_export.rs')
  // Where to save is asked first, then Windows Hello, then the vault is read and the file written.
  const dialog = rust.indexOf('.blocking_save_file()')
  const hello = rust.indexOf('verify_blocking(hwnd, message)')
  const load = rust.indexOf('password_vault_load(app)')
  const write = rust.indexOf('std::fs::write(&path, csv)')
  assert.ok(dialog > 0 && hello > dialog && load > hello && write > load, 'save dialog, then Windows Hello, then read, then write')

  // Only the browser shell may ask, and a missing Windows Hello exports nothing.
  assert.match(rust, /trusted_shell\(webview\.label\(\), webview\.window\(\)\.label\(\)\)/)
  assert.match(rust, /RevealFailure::Unavailable => "unavailable"/)

  // The result carries a status, a count and a file name: no password goes back to the shell.
  const result = rust.slice(rust.indexOf('pub struct PasswordExportResult'), rust.indexOf('impl PasswordExportResult'))
  const fields = [...result.matchAll(/^\s{4}([a-z_]+):/gm)].map((match) => match[1])
  assert.deepEqual(fields, ['status', 'count', 'file_name'])
  assert.match(result, /status: &'static str/)

  const platform = read('../src/platform/passwordExport.ts')
  assert.match(platform, /invoke<PasswordExportResult>\('password_export_csv', options\)/)
  assert.doesNotMatch(platform, /password: |entries/, 'the shell does not hand passwords over')

  // The command is registered and allowed, and the verification is the one the reveal already uses.
  assert.match(read('../src-tauri/src/lib.rs'), /password_export::password_export_csv,/)
  assert.match(read('../src-tauri/permissions/webview-commands.toml'), /"password_export_csv"/)
  assert.match(read('../src-tauri/src/password_reveal.rs'), /pub\(crate\) fn verify_blocking\(/)
})

test('the export button warns first and only then asks the native side', () => {
  const section = read('../src/components/SettingsPanel/AccountSettingsSection.tsx')
  const handler = section.slice(section.indexOf('const handleExportPasswords'), section.indexOf('const handleExportPasswords') + 1400)
  assert.ok(handler.indexOf('showAppConfirmation(t(\'accountExportWarning\')') > 0)
  assert.ok(handler.indexOf('showAppConfirmation(') < handler.indexOf('exportPasswordsCsv('), 'the warning comes before the export')
  assert.match(handler, /if \(!accepted\) return/)
  // Nothing to export, nothing to click.
  assert.match(section, /disabled=\{exportingPasswords \|\| entries\.length === 0\}/)
})
