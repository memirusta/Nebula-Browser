import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8')

test('resume waits for WebView2 StateChanged instead of finalizing its transient cancelled state', () => {
  const nativeSource = read('../src-tauri/src/download_manager.rs')
  const resumeBranch = nativeSource.match(/"resume" => unsafe \{([\s\S]*?)\r?\n\s*\},\r?\n\s*"cancel"/)

  assert.ok(resumeBranch)
  assert.match(resumeBranch[1], /operation\.Resume\(\)/)
  assert.doesNotMatch(resumeBranch[1], /emit_download|finalize_download/)
  assert.match(nativeSource, /Let StateChanged publish[\s\S]*authoritative post-resume state/)
})

test('successful cancellation publishes an authoritative terminal state under UI-thread load', () => {
  const nativeSource = read('../src-tauri/src/download_manager.rs')
  const cancelBranch = nativeSource.match(/"cancel" => unsafe \{([\s\S]*?)\r?\n\s*\},\r?\n\s*"keep"/)

  assert.ok(cancelBranch)
  assert.match(cancelBranch[1], /operation\.Cancel\(\)/)
  assert.match(cancelBranch[1], /payload\.state = "cancelled"/)
  assert.match(cancelBranch[1], /app_for_main\.emit\(DOWNLOAD_EVENT/)
  assert.match(cancelBranch[1], /finalize_download\(&app_for_main, &id, &payload\)/)
  assert.match(nativeSource, /recv_timeout\(Duration::from_secs\(10\)\)/)
})

test('closing a source tab retains its hidden WebView2 download host until terminal state', () => {
  const nativeSource = read('../src-tauri/src/download_manager.rs')
  const commandSource = read('../src-tauri/src/lib.rs')

  assert.match(nativeSource, /struct DownloadLifecycle/)
  assert.match(nativeSource, /deferred_tab_closes: HashSet<String>/)
  assert.match(nativeSource, /fn defer_tab_close_if_active/)
  assert.match(nativeSource, /close_deferred_download_host/)
  assert.match(commandSource, /defer_tab_close_if_active\(&label\)/)
  assert.match(commandSource, /if deferred_for_download[\s\S]*webview\.hide\(\)[\s\S]*return Ok\(\(\)\)/)
  assert.match(nativeSource, /terminalize_lost_download/)
  assert.match(nativeSource, /COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_USER_SHUTDOWN/)
})

test('failed downloads expose retry and retain resumable native operations', () => {
  const coreSource = read('../src/core/download.ts')
  const managerSource = read('../src/components/DownloadManager/DownloadManager.tsx')
  const nativeSource = read('../src-tauri/src/download_manager.rs')

  assert.match(coreSource, /\| 'retry'/)
  assert.match(managerSource, /item\.state === 'interrupted'/)
  assert.match(managerSource, /runAction\(item\.id, 'retry'\)/)
  assert.match(nativeSource, /payload\.state == "interrupted" && !payload\.can_resume/)
  assert.match(nativeSource, /FAILED_DOWNLOADS/)
  assert.match(nativeSource, /operation\.Resume\(\)/)
  assert.match(nativeSource, /webview[\s\S]{0,80}\.navigate\(parsed\)/)
})

test('potentially executable downloads validate signatures before inline Keep or Delete confirmation', () => {
  const coreSource = read('../src/core/download.ts')
  const managerSource = read('../src/components/DownloadManager/DownloadManager.tsx')
  const nativeSource = read('../src-tauri/src/download_manager.rs')

  assert.match(coreSource, /requiresConfirmation: boolean/)
  assert.match(nativeSource, /DANGEROUS_EXTENSIONS/)
  assert.match(nativeSource, /DOWNLOAD_WARNINGS/)
  assert.match(nativeSource, /RISKY_DOWNLOADS/)
  assert.match(nativeSource, /WinVerifyTrust/)
  assert.match(nativeSource, /has_trusted_authenticode_signature/)
  assert.match(nativeSource, /SYNTHETIC_COMPLETIONS/)
  assert.match(nativeSource, /state != COREWEBVIEW2_DOWNLOAD_STATE_COMPLETED && !synthetic_completion/)
  assert.doesNotMatch(nativeSource, /operation_for_emit\.Pause\(\)/)
  assert.doesNotMatch(managerSource, /showAppConfirmation/)
  assert.match(managerSource, /keepConfirmationId/)
  assert.match(managerSource, /downloadKeepAnyway/)
  assert.match(managerSource, /runAction\(item\.id, 'keep'\)/)
  assert.match(managerSource, /runAction\(item\.id, 'delete'\)/)
  assert.match(managerSource, /downloadRiskyFileHint/)
  assert.match(nativeSource, /remove_partial_download_when_released\(downloaded_file\)/)
})
