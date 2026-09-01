import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('normal session persistence is controlled by restoreTabsOnStartup only', () => {
  const shellSource = readFileSync(
    new URL('../src/components/BrowserShell/BrowserShell.tsx', import.meta.url),
    'utf8',
  )
  const settingsSource = readFileSync(
    new URL('../src/core/nebulaSettings.ts', import.meta.url),
    'utf8',
  )
  const browserSource = readFileSync(
    new URL('../src/platform/tauriBrowser.ts', import.meta.url),
    'utf8',
  )

  assert.doesNotMatch(shellSource, /privacy\.clearOnExit/)
  assert.doesNotMatch(settingsSource, /clearOnExit/)
  assert.doesNotMatch(browserSource, /clearOnExit/)

  assert.match(
    shellSource,
    /if\s*\(\s*settings\.browsing\.restoreTabsOnStartup\s*\)\s*\{/,
  )
  assert.match(
    shellSource,
    /!settings\.browsing\.restoreTabsOnStartup[\s\S]{0,220}SHORTCUT_POSITIONS_KEY/,
  )
  assert.match(
    shellSource,
    /!settings\.browsing\.restoreTabsOnStartup[\s\S]{0,220}SHORTCUT_FOLDERS_KEY/,
  )
})

test('restore-session UI owns tabs, folders, and Semi-Lunar layout', () => {
  const panelSource = readFileSync(
    new URL('../src/components/SettingsPanel/SettingsPanel.tsx', import.meta.url),
    'utf8',
  )
  const chromeSource = readFileSync(
    new URL('../src/ChromeApp.tsx', import.meta.url),
    'utf8',
  )

  assert.match(panelSource, /t\('settingsRestoreSession'\)/)
  assert.match(panelSource, /t\('settingsRestoreSessionHint'\)/)
  assert.doesNotMatch(panelSource, /Remember icon layout/)
  assert.doesNotMatch(panelSource, /Remember folders/)
  assert.doesNotMatch(panelSource, /clearOnExit/)

  assert.match(
    chromeSource,
    /useShortcutFolders\([\s\S]{0,180}visibleShortcuts,[\s\S]{0,120}settings\.browsing\.restoreTabsOnStartup,[\s\S]{0,80}semiLunarShortcuts/,
  )
  assert.match(
    chromeSource,
    /rememberLayout=\{settings\.browsing\.restoreTabsOnStartup\}/,
  )
})
