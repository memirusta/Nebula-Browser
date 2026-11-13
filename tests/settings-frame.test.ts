import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))

function block(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`)
  assert.ok(start >= 0, `${selector} block`)
  return css.slice(start, css.indexOf('\n}', start))
}

test('Settings fill the window: the menu at the left, the content beside it, no dimmed backdrop', () => {
  const css = read('src/components/SettingsPanel/SettingsPanel.module.css')

  const panel = block(css, '.panel')
  assert.match(panel, /inset: var\(--title-bar-height, 0px\) 0 0 0;/)
  assert.match(panel, /grid-template-columns: var\(--nav-w\) minmax\(0, 1fr\);/)
  assert.match(panel, /border-radius: 0;/)
  // The colour of the theme over a blurred copy of the background, not a fixed dark glass.
  assert.match(panel, /color-mix\(in srgb, var\(--nebula-void\) 72%, transparent\)/)
  assert.match(block(css, '.backdrop'), /display: none;/)
})

test('the menu and the content take the colours of the theme and open with a short animation', () => {
  const css = read('src/components/SettingsPanel/SettingsPanel.module.css')

  assert.match(block(css, '.navItemActive'), /background: var\(--nebula-surface\);/)
  assert.match(block(css, '.navItem:hover'), /background: var\(--nebula-soft\);/)
  assert.match(block(css, '.nav'), /border-right: 1px solid var\(--nebula-glass-border\);/)
  assert.match(css, /--nav-w: 288px;/)
  assert.match(css, /\.panelEnter \{\s+animation: settingsIn 550ms/)
  assert.match(css, /\.panelEnter \.navItem \{\s+animation: settingsItemIn 450ms[\s\S]*?calc\(var\(--i, 0\) \* 40ms \+ 160ms\)/)
  // A screen taller than the window scrolls inside the content, whose rows stay a readable width.
  assert.match(block(css, '.contentBody'), /overflow-y: auto;/)
  // The cards stay a readable width: the body's side padding makes the column 960px wide (see below).
  assert.match(block(css, '.contentBody'), /50vw - 480px - var\(--nav-w\)/)

  // Each menu item knows its place for the stagger.
  assert.match(read('src/components/SettingsPanel/SettingsPanel.tsx'), /settingsCategories\.map\(\(cat, index\) => \([\s\S]*?style=\{\{ '--i': index \} as CSSProperties\}/)
})

test('the menu and the controls use the font of the theme, not the system font of a bare button', () => {
  const css = read('src/components/SettingsPanel/SettingsPanel.module.css')
  assert.match(css, /\.panel button,\s+\.panel input,\s+\.panel select,\s+\.panel textarea \{\s+font-family: inherit;\s+\}/)
})

test('the menu has line icons and the brand, the Appearance settings are in titled cards, the content is wide', () => {
  const panel = read('src/components/SettingsPanel/SettingsPanel.tsx')
  assert.match(panel, /<SettingsNavIcon id=\{cat\.id\} \/>/)
  assert.match(panel, /<img src="\/nebula-app-logo\.png"/)
  for (const key of ['general', 'wallpaper', 'glass', 'colors', 'lunar']) {
    assert.ok(panel.includes(`<SettingGroup title={groupCopy.${key}}>`), `group ${key}`)
  }

  // Every category has an icon, and no icon is an emoji or a text glyph any more.
  const icons = read('src/components/SettingsPanel/SettingsNavIcon.tsx')
  for (const id of ['appearance', 'home', "'semi-lunar'", 'shortcuts', 'account', 'privacy', 'extensions', 'notifications', 'about']) {
    assert.ok(icons.includes(`${id}:`), `icon for ${id}`)
  }

  // The group titles exist in the nine languages.
  const copy = read('src/components/SettingsPanel/settingsGroupCopy.ts')
  for (const lang of ['en', 'tr', 'es', 'de', 'fr', 'id', 'ru', 'it', 'ja']) {
    assert.match(copy, new RegExp(`\n  ${lang}: \\{\n    general:`), lang)
  }

  const css = read('src/components/SettingsPanel/SettingsPanel.module.css')
  assert.match(block(css, '.groupBody'), /border-radius: 18px;/)
  // No picture behind the settings: the person's wallpaper shows through the panel instead.
  assert.doesNotMatch(css, /crab-nebula|\.panel::before/)
  // An off toggle has a visible track, and its thumb stays centred inside the border.
  assert.match(block(css, '.toggle'), /border: 1px solid var\(--nebula-field-border\);/)
  assert.match(block(css, '.toggleThumb'), /top: 2px;\s+left: 2px;/)
})

test('the Home, Semi-Lunar, Privacy and Notifications settings are in titled cards, every row in exactly one', () => {
  const panel = read('src/components/SettingsPanel/SettingsPanel.tsx')
  const copy = read('src/components/SettingsPanel/settingsGroupCopy.ts')

  const plan: Record<string, string[]> = {
    home: ['layout', 'widgets', 'profile', 'session'],
    'semi-lunar': ['behavior', 'animation', 'size', 'overlay'],
    privacy: ['protection', 'permissions', 'privateMode', 'data'],
    notifications: ['alerts', 'siteAlerts'],
  }
  for (const [category, titles] of Object.entries(plan)) {
    const start = panel.indexOf(`case '${category}':\n      return (\n        <>\n`)
    assert.ok(start >= 0, category)
    const end = panel.indexOf('        </>\n      )\n', start)
    const body = panel.slice(start, end)
    for (const title of titles) {
      assert.ok(body.includes(`<SettingGroup title={groupCopy.${title}}>`), `${category}: ${title}`)
      // The title exists in all nine languages.
      assert.equal(copy.split(`    ${title}: '`).length - 1, 9, `${title} in nine languages`)
    }
    // The reset rows stay together at the end in a card without a title, and every row is inside a card.
    assert.ok(body.trimEnd().endsWith('</SettingGroup>'), `${category}: ends with a card`)
    assert.match(body, /<SettingGroup>\n[\s\S]*Reset/)
    assert.doesNotMatch(body.replace(/<SettingGroup[\s\S]*?<\/SettingGroup>/g, ''), /<Setting(Toggle|Select|Range|Color|Text)Row/, `${category}: a row outside a card`)
  }
})

test('the title stays at the left, the cards are one 960px column in the middle, and the background is the wallpaper behind the panel', () => {
  const css = read('src/components/SettingsPanel/SettingsPanel.module.css')
  // The title is next to the menu; only the cards are centred (a friend of the author found this the nicest).
  assert.match(block(css, '.contentHeader'), /padding: 34px var\(--side-pad\) 18px;/)
  // 960px wide and centred: a wider window gets more empty space at the sides, not longer rows.
  // In the middle of the window, not of the space beside the menu: the left padding puts the edge at 50vw - 480px.
  assert.match(block(css, '.contentBody'), /padding-left: max\(var\(--side-pad\), calc\(50vw - 480px - var\(--nav-w\)\)\);/)
  assert.match(block(css, '.contentBody'), /padding-right: max\(\s+var\(--side-pad\),\s+calc\(100vw - var\(--nav-w\) - 960px - max\(var\(--side-pad\), calc\(50vw - 480px - var\(--nav-w\)\)\)\)/)
  // Rows are not split into columns, and no picture sits behind the settings.
  assert.doesNotMatch(css, /column-count/)
  assert.doesNotMatch(css, /crab-nebula|\.panel::before/)
  assert.match(block(css, '.rangeControl'), /width: min\(260px, 42vw\);/)
})

test('Appearance opens with the settings people change most, chosen by looking: theme, wallpaper and accent colour', () => {
  const panel = read('src/components/SettingsPanel/SettingsPanel.tsx')
  const appearance = panel.slice(panel.indexOf("case 'appearance':"), panel.indexOf("case 'home':"))
  assert.match(appearance, /<AppearanceHero[\s\S]*?onTheme=\{\(v\) => onUpdate\('appearance', 'theme', v\)\}[\s\S]*?onAccent=\{\(v\) => onUpdate\('appearance', 'accentColor', v\)\}/)
  // The theme is no longer a dropdown row; what is left in General is the language and the web page darkening.
  assert.doesNotMatch(appearance.slice(0, appearance.indexOf('<SettingAdvanced')), /label=\{t\('theme'\)\}/)

  const hero = read('src/components/SettingsPanel/AppearanceHero.tsx')
  for (const theme of ['dark', 'light', 'forest']) assert.ok(hero.includes(`id: '${theme}'`), theme)
  for (const preset of ['nebula', 'aurora', 'midnight', 'liquid']) assert.ok(hero.includes(`id: '${preset}'`), preset)
  // The first accent is the theme's own, which is what the default accent colour means.
  assert.match(hero, /const ACCENTS = \[DEFAULT_ACCENT_COLOR,/)
  assert.match(hero, /aria-pressed=\{selected\}/)

  // The wallpaper tiles take the look of the light theme too, and stop moving for reduced motion.
  const css = read('src/components/SettingsPanel/AppearanceHero.module.css')
  assert.match(css, /:global\(\[data-theme='light'\]\) \.wallpaperTile \{/)
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*?animation: none/)
})

test('the many sliders and timings sit in a closed "Advanced" section, in nine languages', () => {
  const panel = read('src/components/SettingsPanel/SettingsPanel.tsx')
  const appearance = panel.slice(panel.indexOf("case 'appearance':"), panel.indexOf("case 'home':"))
  const advanced = appearance.slice(appearance.indexOf('<SettingAdvanced'), appearance.indexOf('</SettingAdvanced>'))
  for (const key of ['wallpaper', 'glass', 'colors', 'lunar']) assert.ok(advanced.includes(`groupCopy.${key}`), `Appearance advanced: ${key}`)

  const lunar = panel.slice(panel.indexOf("case 'semi-lunar':"), panel.indexOf("case 'shortcuts':"))
  const lunarAdvanced = lunar.slice(lunar.indexOf('<SettingAdvanced'), lunar.indexOf('</SettingAdvanced>'))
  for (const key of ['animation', 'size', 'overlay']) assert.ok(lunarAdvanced.includes(`groupCopy.${key}`), `Semi-Lunar advanced: ${key}`)
  // What is used every day stays outside it.
  assert.ok(!lunarAdvanced.includes('groupCopy.behavior'))

  // A native details element: closed until opened, keyboard and screen reader friendly.
  assert.match(read('src/components/SettingsPanel/SettingControls.tsx'), /<details className=\{styles\.advanced\}>/)
  const copy = read('src/components/SettingsPanel/settingsGroupCopy.ts')
  for (const key of ['advanced', 'accentDefault', 'ownImage', 'ownVideo']) assert.equal(copy.split(`    ${key}: `).length - 1, 9, `${key} in nine languages`)
})

test('holding a slider steps the panel aside so the change is seen on the real screen', () => {
  const panel = read('src/components/SettingsPanel/SettingsPanel.tsx')
  assert.match(panel, /const \[peeking, setPeeking\] = useState\(false\)/)
  assert.match(panel, /closest\?\.\('input\[type="range"\]'\)\) setPeeking\(true\)/)
  for (const type of ['pointerup', 'pointercancel', 'blur']) assert.ok(panel.includes(`'${type}', stop`), type)
  assert.match(panel, /\$\{peeking \? styles\.panelPeek : ''\}/)

  const css = read('src/components/SettingsPanel/SettingsPanel.module.css')
  assert.match(block(css, '.panelPeek'), /background: transparent;/)
  // The row that is being dragged stays, everything else almost disappears.
  assert.match(css, /\.panelPeek \.groupBody > \*:has\(input\[type='range'\]:active\) \{\s+opacity: 1;/)
})

test('Account is three tabs - Profile, Nebula Sync, Passwords - that all stay in the page, and the password deep link opens its tab', () => {
  const account = read('src/components/SettingsPanel/AccountSettingsSection.tsx')
  assert.match(account, /useState<'profile' \| 'sync' \| 'passwords'>/)
  // Each page is hidden, not removed: the hidden CSV file input and the open modals keep working from any tab.
  for (const id of ['profile', 'sync', 'passwords']) {
    assert.ok(account.includes(`hidden={tab !== '${id}'}`), `${id} panel`)
  }
  // The Sync tab exists only for a Google account; the sync card is not on the Profile page any more.
  assert.match(account, /account\?\.provider === 'google' && account\.email \? \[\['sync', 'Nebula Sync'\]\] : \[\]/)
  const profile = account.slice(account.indexOf("hidden={tab !== 'profile'}"), account.indexOf("hidden={tab !== 'sync'}"))
  assert.doesNotMatch(profile, /<GoogleSyncSettings/)
  assert.match(account, /hidden=\{tab !== 'sync'\}>\s+\{account\?\.provider === 'google' && account\.email && \(\s+<GoogleSyncSettings/)

  // The password prompts ask for the Passwords tab; a page that is open hears it, one opened for it reads it.
  const request = read('src/components/SettingsPanel/accountTabRequest.ts')
  assert.match(request, /export function requestPasswordsTab/)
  assert.match(request, /export function consumePasswordsTabRequest/)
  assert.match(account, /consumePasswordsTabRequest\(\) \? 'passwords' : 'profile'/)
  assert.match(account, /heading\?\.focus\(\{ preventScroll: true \}\)/)
  const panel = read('src/components/SettingsPanel/SettingsPanel.tsx')
  assert.match(panel, /requestedPasswordsTab\.current\.add\(passwordSettingsRequest\)\s+requestPasswordsTab\(\)/)

  const css = read('src/components/SettingsPanel/SettingsPanel.module.css')
  assert.match(css, /\.accountPanel\[hidden\] \{\s+display: none;/)
  // The label of the first tab exists in the nine languages.
  assert.equal(read('src/components/SettingsPanel/settingsGroupCopy.ts').split('    accountProfile: ').length - 1, 9)
})

test('a failed password import tells the person why in every language, instead of a bare "failed"', () => {
  const account = read('src/components/SettingsPanel/AccountSettingsSection.tsx')
  // The native reason (Turkish) is kept for Turkish; elsewhere an import that cannot work says to use the CSV export,
  // and any other failure keeps the reason next to the general message.
  assert.match(account, /needsCsvFor\(error\)\s+\? t\('gsImportNeedsCsv'\)/)
  assert.match(account, /`\$\{t\('accountImportFailed'\)\} \(\$\{nativeMessage\}\)`/)
  assert.match(read('src/core/googleAccountSetup.ts'), /export function needsCsvFor/)
})

test('holding a Semi-Lunar slider shows the Semi-Lunar menu open, although it is hidden while Settings is open', () => {
  // The Settings panel says when a slider of the Semi-Lunar page is held.
  const panel = read('src/components/SettingsPanel/SettingsPanel.tsx')
  assert.match(panel, /const lunarPeek = peeking && activeId === 'semi-lunar'/)
  assert.match(panel, /onLunarPeekChange\?\.\(lunarPeek\)\s+return \(\) => onLunarPeekChange\?\.\(false\)/)

  // The shell lets the menu show while it is held, and tells the menu's own webview to open.
  const shell = read('src/components/BrowserShell/BrowserShell.tsx')
  assert.match(shell, /\(settingsOpen && !settingsLunarPeek\) \|\|/)
  assert.match(shell, /onLunarPeekChange=\{setSettingsLunarPeek\}/)
  assert.match(shell, /emitSettingsLunarPeek\(settingsOpen && settingsLunarPeek\)/)

  const bridge = read('src/core/nebulaBridge.ts')
  assert.match(bridge, /const SETTINGS_LUNAR_PEEK_EVENT = 'nebula-settings-lunar-peek'/)
  assert.match(bridge, /export async function emitSettingsLunarPeek/)
  assert.match(bridge, /export function listenSettingsLunarPeek/)

  // The menu's webview opens its menu while the slider is held, and not for any other page of Settings.
  const chrome = read('src/ChromeApp.tsx')
  assert.match(chrome, /listenSettingsLunarPeek\(setSettingsLunarPeek\)/)
  assert.match(chrome, /forceOpen=\{browsingDownloadPanelOpen \|\| privateInfoOpen \|\| extensionsOpen \|\| settingsLunarPeek\}/)
  // The menu stays open while the slider is held; it is not opened and closed in a loop.
  assert.doesNotMatch(chrome, /lunarPeekOpen/)
})
