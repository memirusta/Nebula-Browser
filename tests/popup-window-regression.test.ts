import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function read(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('site popups keep WebView2 opener semantics in a dedicated Nebula window', () => {
  const siteUiNative = read('src-tauri/src/site_ui.rs')
  const popup = read('src/platform/tauriPopup.ts')
  const shell = read('src/components/BrowserShell/BrowserShell.tsx')
  const defaultCapability = read('src-tauri/capabilities/default.json')
  const commandPermissions = read('src-tauri/permissions/webview-commands.toml')
  const lib = read('src-tauri/src/lib.rs')

  assert.match(siteUiNative, /GetDeferral\(\)\?/)
  assert.match(siteUiNative, /SetNewWindow\(&core\)/)
  assert.match(siteUiNative, /WindowFeatures\(\)/)
  assert.match(siteUiNative, /private_mode:/)

  assert.match(popup, /new Window\(windowLabel/)
  assert.match(popup, /decorations:\s*true/)
  assert.match(popup, /maximizable:\s*false/)
  assert.match(popup, /minimizable:\s*false/)
  assert.match(popup, /parent:\s*'main'/)
  assert.match(popup, /theme:\s*'dark'/)
  assert.match(popup, /backgroundColor:\s*\[17,\s*18,\s*20,\s*255\]/)
  assert.doesNotMatch(popup, /popupChromeUrl|chromeOptions|POPUP_CHROME_PREFIX/)
  assert.match(popup, /title:\s*''/)
  assert.match(popup, /closable:\s*true/)
  assert.match(popup, /const contentOptions:[\s\S]*?x:\s*0,[\s\S]*?y:\s*0,[\s\S]*?browserExtensionsEnabled:\s*true/)
  assert.doesNotMatch(
    popup.match(/const contentOptions:[\s\S]*?new Webview\(popupWindow, contentLabel, contentOptions\)/)?.[0] ?? '',
    /url:/,
  )
  assert.match(popup, /site_popup_attach/)
  assert.equal((popup.match(/new Webview\(/g) ?? []).length, 1)

  assert.match(shell, /listenSiteNewWindows\([\s\S]*?openSitePopup/)
  assert.doesNotMatch(
    shell.match(/listenSiteNewWindows\([\s\S]*?\),\n\s*\(\) => listenSiteCloseWindows/)?.[0] ?? '',
    /openUrlInNewTab/,
  )

  assert.match(defaultCapability, /core:window:allow-create/)

  for (const command of [
    'webview_setup_popup_target',
    'site_popup_attach',
    'site_popup_cancel',
    'webview_teardown_popup_target',
  ]) {
    assert.match(lib, new RegExp(`\\b${command}\\b`))
    assert.match(commandPermissions, new RegExp(`"${command}"`))
  }
})
