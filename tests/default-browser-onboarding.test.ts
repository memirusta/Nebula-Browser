import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

function source(path: string): string {
  return readFileSync(
    new URL(path, import.meta.url),
    'utf8',
  )
}

test('onboarding runs welcome, profile, backup, import, home screen, default browser, done in that order', () => {
  const onboarding =
    source('../src/core/onboarding.ts')

  const wizard =
    source('../src/components/Onboarding/OnboardingWizard.tsx')

  const order = [
    'welcome',
    'profile',
    'restore',
    'bookmarks',
    'home',
    'defaultBrowser',
    'done',
  ].map((step) => onboarding.indexOf(`'${step}'`))

  assert.ok(order.every((index) => index >= 0))
  assert.deepEqual(order, [...order].sort((a, b) => a - b))
  assert.doesNotMatch(onboarding, /\n\s*'googleLink',/)
  assert.doesNotMatch(onboarding, /\n\s*'syncRestore',/)
  assert.match(wizard, /step ===\s*'profile'/)
  assert.match(wizard, /<OnboardingProfileStep/)
  assert.match(wizard, /<OnboardingSyncRestoreStep/)
  assert.match(wizard, /<OnboardingHomeStep/)
  assert.match(wizard, /<OnboardingDefaultBrowserStep/)
  assert.match(wizard, /<OnboardingDoneStep/)
})

test('the backup screen is only part of the flow when a Nebula Sync backup was found', () => {
  const wizard =
    source('../src/components/Onboarding/OnboardingWizard.tsx')

  const restore =
    source('../src/components/Onboarding/OnboardingSyncRestoreStep.tsx')

  // The backup is looked for in the background once a Google account is linked on the profile screen,
  // and the screen only exists in the list of steps while there is one to restore.
  assert.match(wizard, /probeGoogleSyncRestore\(\s*googleEmail,?\s*\)/)
  assert.match(wizard, /item !==\s*'restore' \|\|\s*backup\.phase ===\s*'ready'/)
  assert.match(wizard, /bundle=\{\s*backup\.bundle\s*\}/)

  // Restoring reloads the app and resumes on the import screen, which now comes after it.
  assert.match(restore, /saveOnboardingResumeStep\('bookmarks'\)/)
  assert.doesNotMatch(restore, /saveOnboardingResumeStep\(\s*'defaultBrowser'/)
})

test('every screen puts its buttons in the footer the wizard keeps at the bottom of the window', () => {
  const wizard =
    source('../src/components/Onboarding/OnboardingWizard.tsx')

  const actions =
    source('../src/components/Onboarding/OnboardingActions.tsx')

  const css =
    source('../src/components/Onboarding/OnboardingWizard.module.css')

  assert.match(actions, /createPortal\(/)
  assert.match(wizard, /ref=\{\s*setFooter\s*\}/)

  for (const screen of [
    'OnboardingWelcomeStep',
    'OnboardingProfileStep',
    'OnboardingSyncRestoreStep',
    'OnboardingImportStep',
    'OnboardingHomeStep',
    'OnboardingDefaultBrowserStep',
    'OnboardingDoneStep',
  ]) {
    assert.match(
      source(`../src/components/Onboarding/${screen}.tsx`),
      /<OnboardingActions/,
      `${screen} must draw its buttons through OnboardingActions`,
    )
  }

  // Back at the left, the rest at the right, with no line above them.
  const footer = css.slice(css.indexOf('.footer {'), css.indexOf('.footerSpacer'))
  assert.match(footer, /left: calc\(var\(--side-w\) \+ var\(--back-l\)\)/)
  assert.match(footer, /right: var\(--btn-r\)/)
  assert.doesNotMatch(footer, /border/)
})

test('Windows installer registers Nebula as a browser candidate without touching UserChoice', () => {
  const config =
    source('../src-tauri/tauri.conf.json')

  const hooks =
    source('../src-tauri/windows/hooks.nsh')

  assert.match(
    config,
    /"installMode"\s*:\s*"currentUser"/,
  )

  assert.match(
    config,
    /"installerHooks"\s*:\s*"\.\/windows\/hooks\.nsh"/,
  )

  assert.match(
    hooks,
    /Software\\RegisteredApplications/,
  )

  assert.match(
    hooks,
    /Nebula\.Url\.Http/,
  )

  assert.match(
    hooks,
    /Nebula\.Url\.Https/,
  )

  assert.doesNotMatch(
    hooks,
    /UserChoice/,
  )
})

test('external HTTP links are queued and opened as dedicated new tabs', () => {
  const cargo =
    source('../src-tauri/Cargo.toml')

  const lib =
    source('../src-tauri/src/lib.rs')

  const external =
    source('../src-tauri/src/external_open.rs')

  const frontend =
    source('../src/platform/externalOpen.ts')

  const shell =
    source('../src/components/BrowserShell/BrowserShell.tsx')

  const main =
    source('../src/main.tsx')

  assert.match(
    cargo,
    /tauri-plugin-single-instance/,
  )

  assert.match(
    lib,
    /tauri_plugin_single_instance::init/,
  )

  assert.match(
    external,
    /PENDING_EXTERNAL_URLS/,
  )

  assert.match(
    external,
    /nebula-external-url-pending/,
  )

  assert.doesNotMatch(
    external,
    /nebula-chrome-action/,
  )

  assert.match(
    frontend,
    /take_pending_open_urls/,
  )

  assert.match(
    frontend,
    /nebula-external-url-pending/,
  )

  assert.match(
    shell,
    /listenExternalUrlPending/,
  )

  assert.match(
    shell,
    /takePendingExternalUrls/,
  )

  assert.match(
    shell,
    /openUrlInNewTab\s*\(\s*url/,
  )

  assert.doesNotMatch(
    main,
    /flushPendingExternalUrls/,
  )
})

test('the first-run screens cover the whole window: Semi-Lunar and the right-edge buttons are hidden while they are open', () => {
  const shell = source('../src/components/BrowserShell/BrowserShell.tsx').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))
  const suppress = shell.slice(
    shell.indexOf('void setChromeWebviewSuppressed('),
    shell.indexOf('const [\n    homeEditMode,'),
  )

  // Settings hide the menu too, except while a Semi-Lunar slider is held (so the change can be seen on the menu).
  assert.match(suppress, /\(settingsOpen && !settingsLunarPeek\) \|\|\s*onboardingOpen \|\|/)
  assert.match(suppress, /\n\s*onboardingOpen,\n/)
  // The state is declared before the effect that reads it.
  assert.ok(shell.indexOf('onboardingOpen,\n    setOnboardingOpen,') < shell.indexOf('void setChromeWebviewSuppressed('))
})

test('the first-run screens bundle Plus Jakarta Sans locally, with its licence', () => {
  const css = source('../src/components/Onboarding/OnboardingWizard.module.css')

  for (const file of [
    'plus-jakarta-sans-latin-wght-normal.woff2',
    'plus-jakarta-sans-latin-ext-wght-normal.woff2',
    'PlusJakartaSans-OFL.txt',
  ]) {
    assert.equal(existsSync(new URL(`../src/assets/fonts/${file}`, import.meta.url)), true, file)
  }

  assert.match(css, /font-family: 'Plus Jakarta Sans';/)
  assert.ok(css.includes("url('../../assets/fonts/plus-jakarta-sans-latin-wght-normal.woff2')"))
  assert.ok(css.includes("url('../../assets/fonts/plus-jakarta-sans-latin-ext-wght-normal.woff2')"))
  // Nothing is loaded from the network.
  assert.doesNotMatch(css, /https?:\/\//)
})

test('light or dark is chosen on the first screen and becomes the app theme', () => {
  const welcome = source('../src/components/Onboarding/OnboardingWelcomeStep.tsx')
  const wizard = source('../src/components/Onboarding/OnboardingWizard.tsx')
  const css = source('../src/components/Onboarding/OnboardingWizard.module.css')
  const shell = source('../src/components/BrowserShell/BrowserShell.tsx')
    .split(String.fromCharCode(13, 10))
    .join(String.fromCharCode(10))

  // Under the language: two radio choices, and what is shown as chosen is applied when the person goes on.
  assert.match(welcome, /role="radiogroup"/)
  assert.match(welcome, /type="radio"/)
  assert.match(welcome, /onSchemeChange\(scheme\)\s*\n\s*\n\s*onContinue\(\)/)

  // The screens show the chosen theme, or Windows' mode while none was chosen.
  assert.match(wizard, /data-scheme=\{\s*scheme\s*\}/)
  assert.match(wizard, /theme === 'light'/)
  assert.match(wizard, /systemDark\s*\?\s*'dark'\s*:\s*'light'/)

  // The shell writes it to the app's own theme setting.
  assert.match(shell, /updateCategory\(\s*'appearance',\s*'theme',\s*theme,\s*\)/)

  // The dark look follows that choice, not the media query.
  assert.match(css, /\.root\[data-scheme='dark'\] \{/)
  assert.doesNotMatch(css, /@media \(prefers-color-scheme/)
})
