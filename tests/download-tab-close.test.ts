import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))

test('a tab that was opened only to start a download is closed, and only such a tab', () => {
  // The native side says whether the tab ever finished loading a page.
  const meta = read('src-tauri/src/tab_metadata.rs')
  assert.ok(meta.includes('static PAGE_SHOWN'))
  assert.ok(meta.includes('shown.insert(navigation_complete_label.clone());'))
  assert.ok(meta.includes('shown.remove(label);'))
  const manager = read('src-tauri/src/download_manager.rs')
  assert.ok(manager.includes('tab_shown_page: crate::tab_metadata::tab_has_shown_page(label),'))
  assert.ok(read('src/core/download.ts').includes('tabShownPage?: boolean'))

  // The shell closes it only when it opened it for an address, the tab never showed a page, and once.
  const shell = read('src/components/BrowserShell/BrowserShell.tsx')
  assert.ok(shell.includes('openedForAddressRef.current.add(id)'))
  const effect = shell.slice(shell.indexOf('// A tab opened only to start a download is closed'), shell.indexOf('}, [downloads.items, handleCloseTab])'))
  assert.ok(effect.includes('if (item.tabShownPage !== false) continue'))
  assert.ok(effect.includes('openedForAddressRef.current.has(shortcutId)'))
  assert.ok(effect.includes('closedForDownloadRef.current.has(shortcutId)'))
  assert.ok(effect.includes('void handleCloseTab(shortcutId)'))
})

test('a finished download that has no program is opened with Windows\' "Open with" dialog, and shown in its folder only as a last resort', () => {
  const manager = read('src-tauri/src/download_manager.rs')
  const open = manager.slice(manager.indexOf('unsafe fn open_download_file'), manager.indexOf('fn finished_download_path'))
  assert.ok(open.includes('shell_execute("open", path, None)'))
  assert.ok(open.includes('if needs_open_with(code) {'))
  assert.ok(open.includes('shell_execute("openas", path, None) > 32'))
  assert.ok(open.includes('shell32.dll,OpenAs_RunDLL'))
  assert.ok(open.includes('/select,'))
  // Everything except "the file is gone" (2, 3) is answered with the dialog, not only 27 and 31.
  assert.ok(manager.includes('code <= 32 && !matches!(code, 2 | 3)'))
  // The "open" action goes through it.
  assert.ok(manager.includes('open_download_file(&path)?;'))
})
