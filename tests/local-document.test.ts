import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { resolveNavigationInput } from '../src/core/addressNavigation.ts'
import {
  OPENABLE_LOCAL_EXTENSIONS,
  isOpenableLocalUrl,
  localDocumentLabel,
  localFileUrlFromInput,
  windowMayOpenLocalFile,
} from '../src/core/localDocument.ts'
import { visitShortcutIdFromUrl } from '../src/core/shortcutFromUrl.ts'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const SEARCH = 'https://www.google.com/search?q=x'

test('a path or a file address typed in the address bar becomes the file address of that document', () => {
  assert.equal(
    localFileUrlFromInput('D:\\Projects\\nebula\\docs\\design\\password-ui-proposal.html'),
    'file:///D:/Projects/nebula/docs/design/password-ui-proposal.html',
  )
  assert.equal(localFileUrlFromInput('d:/Projects/x/index.htm'), 'file:///d:/Projects/x/index.htm', 'forward slashes')
  // Explorer's "Copy as path" adds quotes; a path may contain spaces and characters that need encoding.
  assert.equal(
    localFileUrlFromInput('"C:\\Users\\Mehmet Emir\\Masaüstü\\rapor #1 %50.pdf"'),
    'file:///C:/Users/Mehmet%20Emir/Masa%C3%BCst%C3%BC/rapor%20%231%20%2550.pdf',
  )
  assert.equal(localFileUrlFromInput('\\\\server\\share\\docs\\page.html'), 'file://server/share/docs/page.html', 'network path')
  assert.equal(localFileUrlFromInput('file:///C:/a/b.html'), 'file:///C:/a/b.html')
  assert.equal(localFileUrlFromInput('FILE:///C:/a/B.HTML'), 'file:///C:/a/B.HTML', 'the scheme and the extension are not case sensitive')
})

test('only documents of a known kind open: not programs, scripts, folders or things that are not paths', () => {
  for (const refused of [
    'C:\\Windows\\notepad.exe',
    'C:\\tools\\run.bat',
    'C:\\tools\\run.ps1',
    'C:\\Users\\me\\',
    'C:\\Users\\me\\page',
    'C:\\Users\\me\\link.lnk',
    'file:///C:/Windows/notepad.exe',
    'file:///C:/Users/me/',
    'page.html',
    'docs\\page.html',
    'https://example.com/page.html',
    'example.com',
    '',
  ]) {
    assert.equal(localFileUrlFromInput(refused), null, refused)
  }
  assert.equal(isOpenableLocalUrl('file:///C:/a/page.html'), true)
  assert.equal(isOpenableLocalUrl('file:///C:/a/run.exe'), false)
  assert.equal(isOpenableLocalUrl('https://example.com/page.html'), false)
})

test('the address bar opens local files, and everything else is decided as before', () => {
  assert.equal(
    resolveNavigationInput('D:\\Projects\\nebula\\docs\\design\\password-ui-proposal.html', SEARCH),
    'file:///D:/Projects/nebula/docs/design/password-ui-proposal.html',
  )
  assert.equal(resolveNavigationInput('"C:\\My Docs\\a b.html"', SEARCH), 'file:///C:/My%20Docs/a%20b.html')
  assert.equal(resolveNavigationInput('https://example.com/a', SEARCH), 'https://example.com/a')
  assert.equal(resolveNavigationInput('example.com', SEARCH), 'https://example.com/')
  assert.equal(resolveNavigationInput('localhost:3000', SEARCH), 'http://localhost:3000/')
  assert.equal(resolveNavigationInput('two words', SEARCH), SEARCH)
  assert.equal(resolveNavigationInput('C:\\Windows\\notepad.exe', SEARCH), SEARCH, 'a program is a search, not an open')
})

test('a page may never send a tab to a local file, except a local page to its sibling local pages', () => {
  const file = 'file:///C:/docs/other.html'
  assert.equal(windowMayOpenLocalFile(file, 'https://evil.example/'), false, 'a website')
  assert.equal(windowMayOpenLocalFile(file, null), false, 'a page of unknown address')
  assert.equal(windowMayOpenLocalFile(file, undefined), false)
  assert.equal(windowMayOpenLocalFile(file, 'file:///C:/docs/index.html'), true, 'a local page')
  assert.equal(windowMayOpenLocalFile('file:///C:/Windows/notepad.exe', 'file:///C:/docs/index.html'), false, 'not even from a local page')
  assert.equal(windowMayOpenLocalFile('https://example.com/', 'https://evil.example/'), true, 'web addresses are not affected')
  assert.equal(windowMayOpenLocalFile('not a url', 'https://evil.example/'), true)
})

test('each local file gets its own tab id and is named by its file name', () => {
  const a = visitShortcutIdFromUrl('file:///C:/docs/a.html')
  const b = visitShortcutIdFromUrl('file:///C:/docs/b.html')
  assert.match(a, /^visit-file-/)
  assert.notEqual(a, b)
  assert.equal(visitShortcutIdFromUrl('file:///C:/docs/a.html'), a, 'stable')
  assert.equal(visitShortcutIdFromUrl('https://www.example.com/x'), 'visit-example-com', 'websites are as before')
  assert.equal(localDocumentLabel('file:///C:/My%20Docs/a%20b.html'), 'a b.html')
})

test('the list of openable extensions is the same in the shell and in the native side', () => {
  const rust = read('../src-tauri/src/local_document.rs')
  const block = rust.slice(rust.indexOf('OPENABLE_EXTENSIONS: &[&str] = &['), rust.indexOf('];', rust.indexOf('OPENABLE_EXTENSIONS: &[&str] = &[')))
  const native = [...block.matchAll(/"([a-z0-9]+)"/g)].map((match) => match[1])
  assert.deepEqual([...native].sort(), [...OPENABLE_LOCAL_EXTENSIONS].sort())
  // Nothing that can run is on the list.
  for (const dangerous of ['exe', 'bat', 'cmd', 'ps1', 'js', 'vbs', 'msi', 'lnk', 'scr', 'com', 'jar', 'hta']) {
    assert.ok(!native.includes(dangerous), dangerous)
  }
})

test('the native navigation command accepts a file address only as a checked document, and pages are stopped in the shell', () => {
  const lib = read('../src-tauri/src/lib.rs')
  const navigate = lib.slice(lib.indexOf('fn webview_navigate('), lib.indexOf('async fn webview_close_tab'))
  assert.ok(navigate.includes('"file" => local_document::is_openable_local_url(&parsed)'))
  assert.match(lib, /^mod local_document;/m)

  const shell = read('../src/components/BrowserShell/BrowserShell.tsx')
  const listener = shell.slice(shell.indexOf('() => listenSiteNewWindows('), shell.indexOf('() => listenSiteCloseWindows('))
  assert.ok(listener.includes('windowMayOpenLocalFile('))
  assert.ok(listener.indexOf('windowMayOpenLocalFile(') < listener.indexOf('openUrlInNewTab('), 'asked before a tab is opened')
  assert.ok(listener.indexOf('windowMayOpenLocalFile(') < listener.indexOf('openSitePopup('), 'and before a popup is opened')

  // Windows' "Open with Nebula" hands over a path.
  const external = read('../src-tauri/src/external_open.rs')
  assert.ok(external.includes('crate::local_document::file_url_for_document(value)'))
})
