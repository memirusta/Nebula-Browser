import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { PasswordStepFlowTracker } from '../src/core/passwordStepFlow.ts'
import { matchPasswordsForUrl } from '../src/core/passwordMatch.ts'
import { buildPasswordFillScript } from '../src/core/passwordBridgeScript.ts'

test('password save survives a post-submit redirect and stays out of site DOM', () => {
  const tracker = new PasswordStepFlowTracker(5 * 60_000)
  const now = 2_000_000

  tracker.captureIdentity({
    shortcutId: 'tab-a',
    origin: 'https://login.example.com',
    username: 'user@example.com',
    receivedAt: now,
  })
  tracker.captureSubmission({
    shortcutId: 'tab-a',
    origin: 'https://login.example.com',
    url: 'https://login.example.com/password',
    username: '',
    password: 'secret',
    receivedAt: now + 100,
  })

  assert.deepEqual(
    tracker.takeSubmission(
      'tab-a',
      'https://app.example.net/after-login',
      now + 250,
    ),
    {
      shortcutId: 'tab-a',
      url: 'https://login.example.com/password',
      username: 'user@example.com',
      password: 'secret',
      usernameOrigins: ['https://login.example.com'],
      passwordOrigins: ['https://login.example.com'],
    },
  )

  const bridge = readFileSync(
    new URL('../src/hooks/usePasswordBridge.ts', import.meta.url),
    'utf8',
  )
  const shell = readFileSync(
    new URL('../src/components/BrowserShell/BrowserShell.tsx', import.meta.url),
    'utf8',
  )

  assert.match(bridge, /tickPasswordBridge\(tabId\)/)
  assert.match(bridge, /offerRef\.current\?\.mode === 'fill'/)
  assert.match(shell, /<PasswordSavePrompt/)
  assert.match(shell, /<PasswordFillPrompt/)
  assert.match(shell, /passwordPromptOffer !== null/)
})

test('Microsoft login aliases share one credential realm without weakening HTTPS boundaries', () => {
  const saved = [
    {
      id: 'microsoft',
      label: 'login.live.com',
      url: 'https://login.live.com/oauth20_authorize.srf?client_id=other',
      username: 'user@example.com',
      password: 'secret',
    },
  ]

  assert.equal(
    matchPasswordsForUrl(
      'https://login.live.com/oauth20_authorize.srf?client_id=test&scope=openid',
      saved,
    ).length,
    1,
  )
  assert.equal(
    matchPasswordsForUrl(
      'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      saved,
    ).length,
    1,
  )
  assert.equal(
    matchPasswordsForUrl('http://login.microsoftonline.com/common', saved).length,
    0,
  )
  assert.equal(matchPasswordsForUrl('https://evil.microsoftonline.com/', saved).length, 0)
})

test('split login username step can surface and fill a saved account before the password step', () => {
  const bridgeScript = readFileSync(
    new URL('../src/core/passwordBridgeScript.ts', import.meta.url),
    'utf8',
  )
  const bridge = readFileSync(
    new URL('../src/hooks/usePasswordBridge.ts', import.meta.url),
    'utf8',
  )
  const shell = readFileSync(
    new URL('../src/components/BrowserShell/BrowserShell.tsx', import.meta.url),
    'utf8',
  )

  assert.match(bridgeScript, /hasUsernameField/)
  assert.match(bridgeScript, /loginfmt/)
  assert.match(bridgeScript, /hasCredentialAction/)
  assert.match(bridgeScript, /return 'username'/)
  assert.match(bridge, /poll\.hasPasswordField && !poll\.hasUsernameField/)
  assert.match(bridge, /fillTarget: poll\.hasPasswordField/)
  assert.match(bridge, /filledUsernameRef/)
  assert.match(shell, /<PasswordFillPrompt/)
})

test('split-login identity can cross origins without authorizing password fill there', () => {
  const tracker = new PasswordStepFlowTracker(1000)
  tracker.captureIdentity({
    shortcutId: 'tab-a',
    origin: 'https://accounts.example.com',
    username: 'user@example.com',
    receivedAt: 100,
  })
  assert.equal(
    tracker.peekIdentityForUrl(
      'tab-a',
      'https://auth.example.net/password',
      200,
    ),
    'user@example.com',
  )

  const saved = [{
    id: 'split',
    label: 'Example',
    url: 'https://auth.example.net/password',
    username: 'user@example.com',
    password: 'secret',
    usernameOrigins: ['https://accounts.example.com'],
    passwordOrigins: ['https://auth.example.net'],
  }]

  assert.equal(
    matchPasswordsForUrl(
      'https://accounts.example.com/sign-in',
      saved,
      'username',
    ).length,
    1,
  )
  assert.equal(
    matchPasswordsForUrl(
      'https://accounts.example.com/sign-in',
      saved,
      'password',
    ).length,
    0,
  )
  assert.equal(
    matchPasswordsForUrl(
      'https://auth.example.net/password',
      saved,
      'password',
    ).length,
    1,
  )
  assert.equal(
    matchPasswordsForUrl(
      'https://unrelated.example.org/login',
      saved,
      'either',
    ).length,
    0,
  )
})

test('saved split-login origins are checked alongside the primary credential URL', () => {
  const saved = [{
    id: 'split',
    label: 'Example',
    url: 'https://example.com/account',
    username: 'user@example.com',
    password: 'secret',
    usernameOrigins: ['https://login.example-id.com'],
    passwordOrigins: ['https://secure.example-id.net'],
  }]

  assert.equal(
    matchPasswordsForUrl('https://example.com/account', saved, 'either').length,
    1,
  )
  assert.equal(
    matchPasswordsForUrl('https://login.example-id.com/start', saved, 'username').length,
    1,
  )
  assert.equal(
    matchPasswordsForUrl('https://secure.example-id.net/password', saved, 'password').length,
    1,
  )
  assert.equal(
    matchPasswordsForUrl('https://login.example-id.com/start', saved, 'password').length,
    0,
  )
})


test('multi-account password prompt requires an explicit account choice', () => {
  const promptSource = readFileSync(
    new URL('../src/components/PasswordFillPrompt/PasswordFillPrompt.tsx', import.meta.url),
    'utf8',
  )

  assert.match(promptSource, /const multipleAccounts = matches\.length > 1/)
  assert.match(promptSource, /event\.key === 'Enter' && !multipleAccounts && first/)
  assert.match(promptSource, /dialogRef\.current\?\.focus\(\)/)
  assert.match(promptSource, /className=\{styles\.accountList\}/)
  assert.match(promptSource, /className=\{styles\.accountRow\}/)
  assert.match(promptSource, /!multipleAccounts && first/)
})


test('selected split-login account auto-fills the password step without reopening chooser', () => {
  const hookSource = readFileSync(
    new URL('../src/hooks/usePasswordBridge.ts', import.meta.url),
    'utf8',
  )

  assert.match(hookSource, /const selectedEntry = matches\.find/)
  assert.match(hookSource, /await acceptFill\(\s*selectedEntry,/)
  assert.match(hookSource, /poll\.hasUsernameField \? 'both' : 'password'/)
  assert.match(hookSource, /await acceptFill[\s\S]*?return[\s\S]*?On a two-step password page/)
})


test('explicit account choice stays sticky until the password step consumes it', () => {
  const hookSource = readFileSync(
    new URL('../src/hooks/usePasswordBridge.ts', import.meta.url),
    'utf8',
  )

  assert.match(hookSource, /rememberExplicitSelection = false/)
  assert.match(hookSource, /if \(rememberExplicitSelection\) \{[\s\S]*?filledUsernameRef\.current = \{/)
  assert.match(
    hookSource,
    /current\.fillTarget,\s*true,\s*\)\.catch/,
  )
  assert.match(hookSource, /const autoFilled = await acceptFill\(/)
  assert.match(hookSource, /if \(autoFilled\) return/)
  assert.match(hookSource, /filledUsernameRef\.current = null/)
})

test('split-login fill scripts never inject an unused credential secret', () => {
  const usernameOnly = buildPasswordFillScript(
    'user@example.com',
    'PASSWORD-MUST-NOT-BE-HERE',
    'username',
  )
  assert.match(usernameOnly, /user@example\.com/)
  assert.doesNotMatch(usernameOnly, /PASSWORD-MUST-NOT-BE-HERE/)

  const passwordOnly = buildPasswordFillScript(
    'USERNAME-MUST-NOT-BE-HERE',
    'secret-password',
    'password',
  )
  assert.doesNotMatch(passwordOnly, /USERNAME-MUST-NOT-BE-HERE/)
  assert.match(passwordOnly, /secret-password/)
})

test('password DOM bridge keeps secrets out of page-global prompt state', () => {
  const bridgeSource = readFileSync(
    new URL('../src/core/passwordBridgeScript.ts', import.meta.url),
    'utf8',
  )

  assert.match(bridgeSource, /var pendingCreds = null/)
  assert.doesNotMatch(bridgeSource, /window\.__nebulaPendingCreds/)
  assert.doesNotMatch(bridgeSource, /window\.__nebulaPwdUserAction/)
  assert.doesNotMatch(bridgeSource, /BridgePromptConfig/)
})

