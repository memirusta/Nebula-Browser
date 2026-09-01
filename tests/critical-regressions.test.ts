import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

import {
  allSettledOrThrow,
  LatestPerKeyRunner,
} from '../src/core/latestPerKey.ts'
import { KeyedLifecycleQueue } from '../src/core/keyedLifecycleQueue.ts'
import {
  browserTabsReducer,
  initialBrowserTabsState,
} from '../src/core/browserTabsReducer.ts'
import {
  prewarmCreationIsCurrent,
  prewarmProfileMatches,
  shouldKeepPrewarmedWebview,
} from '../src/core/prewarmProfile.ts'
import {
  parsePasswordVault,
  serializePasswordVault,
} from '../src/core/passwordVaultSchema.ts'
import { runFactoryReset } from '../src/core/factoryResetFlow.ts'
import { RequestEpoch } from '../src/core/requestEpoch.ts'
import { registerListenerGroup } from '../src/core/listenerGroup.ts'
import { GoogleBrowserSessionTracker } from '../src/core/googleBrowserSession.ts'
import { withWorkingState } from '../src/core/workingState.ts'
import { parsePasswordCsv } from '../src/core/passwordCsv.ts'
import { PasswordStepFlowTracker } from '../src/core/passwordStepFlow.ts'
import {
  decryptSyncText,
  encryptSyncText,
  mergeSyncedPasswords,
} from '../src/core/googleSyncCrypto.ts'
import { resetHomeMenuStorageOnce } from '../src/core/homeMenuStorage.ts'
import { SingleFlightPoll } from '../src/core/singleFlightPoll.ts'
import { searchShortcutIdentity } from '../src/core/searchShortcutIdentity.ts'
import { waitForTauriCreated } from '../src/platform/tauriCreationWait.ts'
import { debounce } from '../src/platform/debounce.ts'
import { Cdp, pollUntil } from '../scripts/e2e-cdp.mjs'
import {
  hostsMatchForPassword,
  matchPasswordsForUrl,
} from '../src/core/passwordMatch.ts'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  readyState = 0
  listeners = new Map<string, Set<(event: { data?: string; error?: Error }) => void>>()

  constructor(_url: string) {
    FakeWebSocket.instances.push(this)
    queueMicrotask(() => {
      this.readyState = 1
      this.emit('open', {})
    })
  }

  addEventListener(type: string, listener: (event: { data?: string; error?: Error }) => void) {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: (event: { data?: string; error?: Error }) => void) {
    this.listeners.get(type)?.delete(listener)
  }

  send(_payload: string) {}

  close() {
    this.readyState = 3
    this.emit('close', {})
  }

  emit(type: string, event: { data?: string; error?: Error }) {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

test('CDP pending calls reject on connection close and per-call timeout', async () => {
  const closingCdp = new Cdp('ws://closing', {
    callTimeoutMs: 1_000,
    WebSocketImpl: FakeWebSocket,
  })
  await closingCdp.open()
  const pendingOnClose = closingCdp.call('Runtime.evaluate')
  FakeWebSocket.instances.at(-1)?.close()
  await assert.rejects(pendingOnClose, /CDP connection closed/)

  const timeoutCdp = new Cdp('ws://timeout', {
    callTimeoutMs: 10,
    WebSocketImpl: FakeWebSocket,
  })
  await timeoutCdp.open()
  await assert.rejects(timeoutCdp.call('Page.enable'), /timed out: Page\.enable/)
  timeoutCdp.close()
})

test('poll bounds an awaited callback and surfaces browser failure', async () => {
  await assert.rejects(
    pollUntil('hung callback', () => new Promise(() => {}), Date.now() + 20),
    /Timeout: hung callback/,
  )
  await assert.rejects(
    pollUntil(
      'browser exit',
      async () => false,
      Date.now() + 1_000,
      () => new Error('browser crashed'),
    ),
    /browser crashed/,
  )
})

test('request epoch rejects a response captured for the previous tab', () => {
  const epoch = new RequestEpoch<string | null>('tab-a')
  const tabARequest = epoch.capture()
  epoch.sync('tab-b')
  const tabBRequest = epoch.capture()

  assert.equal(epoch.isCurrent(tabARequest), false)
  assert.equal(epoch.isCurrent(tabBRequest), true)
  epoch.sync('tab-b')
  assert.equal(epoch.isCurrent(tabBRequest), true)
})

test('listener group rolls back partial registration and cleanup is idempotent', async () => {
  const events: string[] = []
  await assert.rejects(
    registerListenerGroup([
      async () => () => events.push('dispose-first'),
      async () => { throw new Error('second listener failed') },
      async () => {
        events.push('third-registered')
        return () => events.push('dispose-third')
      },
    ]),
    /second listener failed/,
  )
  assert.deepEqual(events, ['dispose-first'])

  const dispose = await registerListenerGroup([
    async () => () => events.push('dispose-a'),
    async () => () => events.push('dispose-b'),
  ])
  dispose()
  dispose()
  assert.deepEqual(events.slice(-2), ['dispose-b', 'dispose-a'])
})

test('Google browser session becomes linked only after a terminal sign-in URL', () => {
  const tracker = new GoogleBrowserSessionTracker()
  const signInUrl =
    'https://accounts.google.com/v3/signin/identifier?Email=user%40example.com'

  assert.equal(tracker.register('helper-tab', signInUrl), true)
  assert.equal(
    tracker.complete('helper-tab', 'https://accounts.google.com/v3/signin/challenge'),
    null,
  )
  assert.equal(tracker.has('helper-tab'), true)
  assert.equal(
    tracker.complete('helper-tab', 'https://myaccount.google.com/'),
    'user@example.com',
  )
  assert.equal(tracker.has('helper-tab'), false)
})

test('working state always clears when an async task rejects', async () => {
  const states: boolean[] = []
  await assert.rejects(
    withWorkingState(
      (working) => states.push(working),
      async () => { throw new Error('merge failed') },
    ),
    /merge failed/,
  )
  assert.deepEqual(states, [true, false])
})

test('crash-recovery chrome suppression ignores stale async visibility work', () => {
  const chromeSource = readFileSync(
    new URL('../src/platform/tauriChromeWebview.ts', import.meta.url),
    'utf8',
  )
  const shellSource = readFileSync(
    new URL('../src/components/BrowserShell/BrowserShell.tsx', import.meta.url),
    'utf8',
  )

  assert.match(chromeSource, /chromeVisibilityRequestSequence/)
  assert.match(
    chromeSource,
    /requestSequence !== chromeVisibilityRequestSequence/,
  )
  assert.match(chromeSource, /if \(chromeVisibilitySuppressed\)/)
  assert.match(
    chromeSource,
    /if \(!webview\) \{[\s\S]{0,180}await showChromeWebview\(SEMI_LUNAR_HIT_ZONE_HEIGHT\)/,
  )
  assert.match(
    chromeSource,
    /await stackBrowsingChromeAboveBrowser\(getActiveBrowseTabId\(\)\)/,
  )
  assert.match(shellSource, /setChromeWebviewSuppressed\([\s\S]*crashRecoveryOpen/)
  assert.match(shellSource, /setCrashRecoveryOpen\([\s\r\n]*false/)
})

test('WebView2 persistent storage permission has a readable Nebula label', () => {
  const nativeSource = readFileSync(
    new URL('../src-tauri/src/site_ui.rs', import.meta.url),
    'utf8',
  )
  const promptSource = readFileSync(
    new URL('../src/components/SiteUiPrompt/SiteUiPrompt.tsx', import.meta.url),
    'utf8',
  )

  assert.match(nativeSource, /13 => \"persistent-storage\"/)
  assert.match(promptSource, /'persistent-storage': 'kalıcı depolama'/)
  assert.match(promptSource, /'persistent-storage': 'persistent storage'/)
  assert.match(promptSource, /permissionKind === 'unknown'/)
})
test('native shortcut and chrome-bounds commands remain in the Tauri ACL', () => {
  const permissionSource = readFileSync(
    new URL('../src-tauri/permissions/webview-commands.toml', import.meta.url),
    'utf8',
  )

  for (const command of [
    'webview_set_shortcut_bindings',
    'webview_set_chrome_bounds',
  ]) {
    assert.match(
      permissionSource,
      new RegExp(`"${command}"`),
      `${command} must be callable by the trusted shell`,
    )
  }
})

test('UI E2E smoke does not depend on Windows GPU availability', () => {
  const source = readFileSync(
    new URL('../scripts/e2e-smoke.mjs', import.meta.url),
    'utf8',
  )

  assert.match(source, /'--headless=new'/)
  assert.match(source, /'--disable-gpu'/)
  assert.match(source, /'--disable-software-rasterizer'/)
  assert.match(source, /process\.platform === 'win32'[\s\S]{0,500}'--no-sandbox'/)
  assert.match(source, /--host-resolver-rules=MAP example\.com 0\.0\.0\.0/)
})

test('release smoke pins and hashes the target-specific release artifact', () => {
  const nativeSmokeSource = readFileSync(
    new URL('../scripts/native-smoke.ps1', import.meta.url),
    'utf8',
  )
  const releaseSmokeSource = readFileSync(
    new URL('../scripts/release-smoke.ps1', import.meta.url),
    'utf8',
  )

  for (const source of [nativeSmokeSource, releaseSmokeSource]) {
    assert.match(
      source,
      /target\\x86_64-pc-windows-msvc\\release\\app\.exe/,
    )
    assert.match(source, /Get-FileHash[^\r\n]+SHA256/)
  }
  assert.match(nativeSmokeSource, /ExpectedSha256/)
  assert.match(releaseSmokeSource, /-ExpectedSha256 \$artifactSha256/)
})

test('desktop OAuth keeps PKCE and supplies the native client secret to token requests', () => {
  const oauthSource = readFileSync(
    new URL('../src-tauri/src/google_oauth.rs', import.meta.url),
    'utf8',
  )
  const syncSource = readFileSync(
    new URL('../src-tauri/src/google_sync.rs', import.meta.url),
    'utf8',
  )
  const publishSource = readFileSync(
    new URL('../scripts/publish-release.ps1', import.meta.url),
    'utf8',
  )

  assert.match(oauthSource, /code_challenge_method=S256/)
  assert.match(oauthSource, /GOOGLE_CLIENT_SECRET/)
  assert.match(oauthSource, /\("client_secret", client_secret\)/)
  assert.match(syncSource, /\("client_secret", client_secret\)/)
  assert.match(publishSource, /GOOGLE_CLIENT_SECRET/)
})

test('privacy writes are serialized and catch up to the latest revision', async () => {
  let snapshot = { revision: 0, value: 'balanced' }
  let activeWrites = 0
  let maxActiveWrites = 0
  const firstWrite = deferred()
  const firstWriteStarted = deferred()
  const applied: string[] = []

  const runner = new LatestPerKeyRunner(
    () => ({ ...snapshot }),
    async (_label: string, value: string) => {
      activeWrites += 1
      maxActiveWrites = Math.max(maxActiveWrites, activeWrites)
      applied.push(value)
      if (value === 'balanced') {
        firstWriteStarted.resolve()
        await firstWrite.promise
      }
      activeWrites -= 1
    },
  )

  const olderRun = runner.run('nebula-tab-a')
  await firstWriteStarted.promise
  snapshot = { revision: 1, value: 'strict' }
  const newerRun = runner.run('nebula-tab-a')
  firstWrite.resolve()

  await Promise.all([olderRun, newerRun])
  assert.deepEqual(applied, ['balanced', 'strict'])
  assert.equal(maxActiveWrites, 1)
})

test('privacy writes for different tabs do not block each other', async () => {
  const gate = deferred()
  const bothStarted = deferred()
  const started = new Set<string>()
  const runner = new LatestPerKeyRunner(
    () => ({ revision: 0, value: 'strict' }),
    async (label: string) => {
      started.add(label)
      if (started.size === 2) bothStarted.resolve()
      await gate.promise
    },
  )

  const first = runner.run('nebula-tab-a')
  const second = runner.run('nebula-tab-b')
  await bothStarted.promise
  assert.deepEqual(started, new Set(['nebula-tab-a', 'nebula-tab-b']))
  gate.resolve()
  await Promise.all([first, second])
})

test('privacy invalidation waits for an older write before reapplying to a reused label', async () => {
  const firstWrite = deferred()
  const firstWriteStarted = deferred()
  const applied: string[] = []
  const runner = new LatestPerKeyRunner(
    () => ({ revision: 0, value: 'strict' }),
    async (label: string) => {
      applied.push(label)
      if (applied.length === 1) {
        firstWriteStarted.resolve()
        await firstWrite.promise
      }
    },
  )

  const oldWebview = runner.run('nebula-tab-reused')
  await firstWriteStarted.promise
  runner.invalidate('nebula-tab-reused')
  const newWebview = runner.run('nebula-tab-reused')
  firstWrite.resolve()

  await Promise.all([oldWebview, newWebview])
  assert.deepEqual(applied, ['nebula-tab-reused', 'nebula-tab-reused'])
})

test('privacy batch attempts every tab and rejects when any native apply fails', async () => {
  const attempted: string[] = []
  const apply = async (label: string, shouldFail: boolean) => {
    attempted.push(label)
    if (shouldFail) throw new Error(`filter setup failed for ${label}`)
  }

  await assert.rejects(
    allSettledOrThrow(
      [apply('nebula-tab-a', true), apply('nebula-tab-b', false)],
      'privacy apply failed',
    ),
    (error: unknown) =>
      error instanceof AggregateError &&
      error.errors.length === 1 &&
      error.message.includes('1 failure(s)'),
  )
  assert.deepEqual(attempted, ['nebula-tab-a', 'nebula-tab-b'])
})

test('tab lifecycle close invalidates older work and runs after it', async () => {
  const queue = new KeyedLifecycleQueue<string>()
  const firstStarted = deferred()
  const releaseFirst = deferred()
  const events: string[] = []

  const preparing = queue.run('tab-a', async (lease) => {
    events.push('prepare:start')
    firstStarted.resolve()
    await releaseFirst.promise
    events.push(lease.isCurrent() ? 'prepare:current' : 'prepare:stale')
  })
  await firstStarted.promise

  queue.invalidate('tab-a')
  const closing = queue.run('tab-a', async (lease) => {
    events.push(lease.isCurrent() ? 'close:current' : 'close:stale')
  })
  releaseFirst.resolve()

  await Promise.all([preparing, closing])
  assert.deepEqual(events, ['prepare:start', 'prepare:stale', 'close:current'])
})

test('tab lifecycle state is released only after queued work becomes idle', async () => {
  const queue = new KeyedLifecycleQueue<string>()
  const firstStarted = deferred()
  const releaseFirst = deferred()
  const events: string[] = []

  const first = queue.run('tab-a', async () => {
    events.push('first:start')
    firstStarted.resolve()
    await releaseFirst.promise
    events.push('first:end')
  })
  await firstStarted.promise

  const second = queue.run('tab-a', async () => {
    events.push('second')
  })
  const releasing = queue.releaseWhenIdle('tab-a')

  assert.equal(queue.size, 1)
  releaseFirst.resolve()
  assert.equal(await releasing, true)
  await Promise.all([first, second])

  assert.deepEqual(events, ['first:start', 'first:end', 'second'])
  assert.equal(queue.size, 0)
})

test('long tab sessions do not retain lifecycle state for closed tab ids', async () => {
  const queue = new KeyedLifecycleQueue<string>()

  for (let index = 0; index < 2_000; index += 1) {
    const key = `closed-tab-${index}`
    await queue.run(key, async () => undefined)
    assert.equal(await queue.releaseWhenIdle(key), true)
  }

  assert.equal(queue.size, 0)
})

test('two rapid tab closes reduce from current state without resurrecting a tab', () => {
  const open = (id: string) => ({
    type: 'open-or-switch' as const,
    shortcut: { id, label: id, url: `https://${id}.example` },
    reload: false,
    activate: true,
  })

  let state = browserTabsReducer(initialBrowserTabsState, open('first'))
  state = browserTabsReducer(state, open('second'))
  state = browserTabsReducer(state, { type: 'close', shortcutId: 'first' })
  state = browserTabsReducer(state, { type: 'close', shortcutId: 'second' })

  assert.deepEqual(state.tabs, [])
  assert.equal(state.activeTabId, null)
})

test('prewarmed webviews are adopted only for the mode they were created with', () => {
  assert.equal(prewarmProfileMatches(false, true), false)
  assert.equal(prewarmProfileMatches(true, true), true)
  assert.equal(prewarmProfileMatches(null, false), false)
  assert.equal(prewarmCreationIsCurrent(4, 5, true, true), false)
  assert.equal(prewarmCreationIsCurrent(5, 5, false, true), false)
  assert.equal(prewarmCreationIsCurrent(5, 5, true, true), true)
  assert.equal(shouldKeepPrewarmedWebview(84), true)
  assert.equal(shouldKeepPrewarmedWebview(85), false)
  assert.equal(shouldKeepPrewarmedWebview(Number.NaN), false)
})

test('failed tab, prewarm and popup setup paths unwind native integrations', () => {
  const native = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8')
  const browser = readFileSync(new URL('../src/platform/tauriBrowser.ts', import.meta.url), 'utf8')

  assert.match(
    native,
    /fn webview_setup_tab_error_pages[\s\S]*?if result\.is_err\(\) \{[\s\S]*?teardown_tab_webview_integrations\(&app, &label\)/,
  )
  assert.match(
    native,
    /fn webview_setup_popup_target[\s\S]*?if result\.is_err\(\) \{[\s\S]*?teardown_popup_webview_integrations\(&app, &label\)/,
  )
  assert.match(
    browser,
    /configurePopupBrowseWebview[\s\S]*?catch \(error\) \{[\s\S]*?webview_teardown_popup_target/,
  )
  assert.match(
    browser,
    /browser\.prewarm\.close-after-error[\s\S]*?destroyTabWebview\(label\)/,
  )
})

test('Tauri creation waits release the opposite listener on success and timeout', async () => {
  type Handler = (event: { event: string; id: number; payload: unknown }) => void
  const handlers = new Map<string, Set<Handler>>()
  const target = {
    async once<T>(event: string, handler: (value: { event: string; id: number; payload: T }) => void) {
      const listeners = handlers.get(event) ?? new Set<Handler>()
      listeners.add(handler as Handler)
      handlers.set(event, listeners)
      return () => listeners.delete(handler as Handler)
    },
  }
  const emit = (event: string, payload?: unknown) => {
    for (const handler of [...(handlers.get(event) ?? [])]) {
      handler({ event, id: 1, payload })
    }
  }

  const created = waitForTauriCreated(target, 'test target', 100)
  await Promise.resolve()
  emit('tauri://created')
  await created
  assert.equal(handlers.get('tauri://created')?.size, 0)
  assert.equal(handlers.get('tauri://error')?.size, 0)

  const failed = waitForTauriCreated(target, 'failed target', 100)
  await Promise.resolve()
  emit('tauri://error')
  await assert.rejects(failed, /failed target create error/)
  assert.equal(handlers.get('tauri://created')?.size, 0)
  assert.equal(handlers.get('tauri://error')?.size, 0)

  await assert.rejects(
    waitForTauriCreated(target, 'timed target', 1),
    /timed target create timeout/,
  )
  assert.equal(handlers.get('tauri://created')?.size, 0)
  assert.equal(handlers.get('tauri://error')?.size, 0)
})

test('cancelled debounced layout work cannot apply stale geometry', async () => {
  let calls = 0
  const applyLayout = debounce(() => {
    calls += 1
  }, 1)

  applyLayout()
  applyLayout.cancel()
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(calls, 0)
})

test('password matching never downgrades an HTTPS credential to HTTP', () => {
  assert.equal(
    hostsMatchForPassword('http://example.com/login', 'https://example.com/login'),
    false,
  )
  assert.equal(
    hostsMatchForPassword('https://www.example.com/login', 'https://example.com/account'),
    true,
  )
  assert.equal(
    hostsMatchForPassword('https://example.com:8443', 'https://example.com'),
    false,
  )
  assert.equal(
    hostsMatchForPassword('https://example.com:443/login', 'https://example.com/account'),
    true,
  )
  assert.deepEqual(
    matchPasswordsForUrl('http://example.com/login', [
      {
        id: 'https-only',
        label: 'Example',
        url: 'https://example.com/login',
        username: 'alice',
        password: 'secret',
      },
    ]),
    [],
  )
})

test('password vault preserves long secrets and rejects corrupt payloads', () => {
  const password = 'long-secret-'.repeat(80)
  const entry = {
    id: 'long-password',
    label: 'Example',
    url: 'https://example.com',
    username: 'alice',
    password,
    updatedAt: 1_700_000_000_000,
  }

  const loaded = parsePasswordVault(serializePasswordVault([entry]))
  assert.equal(loaded[0]?.password, password)
  assert.equal(loaded[0]?.password.length, password.length)
  assert.throws(() => parsePasswordVault('{not-json'))
  assert.throws(() =>
    parsePasswordVault(JSON.stringify([{ ...entry, password: 42 }])),
  )
})

test('factory reset waits for browser profiles, vault, and Google Sync credential before storage reload', async () => {
  const events: string[] = []
  await runFactoryReset({
    clearBrowserProfiles: async () => {
      events.push('profiles:start')
      await Promise.resolve()
      events.push('profiles:done')
    },
    clearPasswordVault: async () => {
      events.push('vault:start')
      await Promise.resolve()
      events.push('vault:done')
    },
    clearGoogleSyncCredential: async () => {
      events.push('google-sync:start')
      await Promise.resolve()
      events.push('google-sync:done')
    },
    clearShellStorage: () => events.push('storage:clear'),
    reloadShell: () => events.push('shell:reload'),
  })

  assert.deepEqual(events, [
    'profiles:start',
    'profiles:done',
    'vault:start',
    'vault:done',
    'google-sync:start',
    'google-sync:done',
    'storage:clear',
    'shell:reload',
  ])
})


test('password CSV parser preserves quoted multiline fields and escaped quotes', () => {
  const csv = [
    'name,url,username,password,note',
    '"Example, Inc.",https://example.com,alice,"line one',
    'line two with ""quotes""",ignored',
    'Simple,https://simple.example,bob,secret,ignored',
  ].join('\r\n')

  const imported = parsePasswordCsv(csv)
  assert.equal(imported.length, 2)
  assert.deepEqual(imported[0], {
    label: 'Example, Inc.',
    url: 'https://example.com',
    username: 'alice',
    password: 'line one\r\nline two with "quotes"',
  })
  assert.equal(imported[1]?.password, 'secret')
  assert.deepEqual(
    parsePasswordCsv('name,url,username,password\nBroken,https://example.com,a,"unterminated'),
    [],
  )
})

test('home-menu migration preserves migratable pins and current browse sessions', () => {
  const values = new Map<string, string>([
    ['nebula-pinned-shortcuts-v5', '{"schemaVersion":2,"pins":[]}'],
    ['nebula-pinned-shortcuts-v4', '["migrate-pin"]'],
    ['nebula-browse-sessions-v2', '{"keep":"session"}'],
    ['nebula-pinned-shortcuts-v3', '["legacy"]'],
    ['nebula-browse-sessions-v1', '{"legacy":true}'],
  ])
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }

  resetHomeMenuStorageOnce(storage)

  assert.equal(values.get('nebula-pinned-shortcuts-v5'), '{"schemaVersion":2,"pins":[]}')
  assert.equal(values.get('nebula-pinned-shortcuts-v4'), '["migrate-pin"]')
  assert.equal(values.get('nebula-browse-sessions-v2'), '{"keep":"session"}')
  assert.equal(values.get('nebula-pinned-shortcuts-v3'), '["legacy"]')
  assert.equal(values.has('nebula-browse-sessions-v1'), false)
  assert.equal(values.get('nebula-home-menu-reset-v1'), '1')
})

test('single-flight polling coalesces visibility retriggers without overlap', async () => {
  const gate = deferred()
  const started: number[] = []
  let active = 0
  let maxActive = 0
  let scheduled: (() => void) | null = null

  const poll = new SingleFlightPoll(
    async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      started.push(started.length + 1)
      if (started.length === 1) await gate.promise
      active -= 1
    },
    (run) => { scheduled = run },
  )

  poll.trigger()
  poll.trigger()
  poll.trigger()
  gate.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.deepEqual(started, [1, 2])
  assert.equal(maxActive, 1)
  assert.equal(typeof scheduled, 'function')
  poll.stop()
})

test('search shortcut IDs distinguish punctuation-sensitive queries', () => {
  const cpp = searchShortcutIdentity('google', 'c++')
  const csharp = searchShortcutIdentity('google', 'c#')
  const plain = searchShortcutIdentity('google', 'hello world')
  const cafe = searchShortcutIdentity('google', 'cafe')
  const accentedCafe = searchShortcutIdentity('google', 'café')

  assert.notEqual(cpp, csharp)
  assert.notEqual(cafe, accentedCafe)
  assert.match(cpp, /^search-google-c-/)
  assert.match(csharp, /^search-google-c-/)
  assert.equal(plain, 'search-google-hello-world')
})

test('native transition logging is production opt-in and size bounded', () => {
  const frontend = readFileSync(
    new URL('../src/platform/tauriTransitionLog.ts', import.meta.url),
    'utf8',
  )
  const native = readFileSync(
    new URL('../src-tauri/src/lib.rs', import.meta.url),
    'utf8',
  )

  assert.match(frontend, /import\.meta\.env\.DEV\s*\|\|\s*import\.meta\.env\.VITE_NEBULA_TRANSITION_LOG === '1'/)
  assert.match(frontend, /!isTauri \|\| !transitionLoggingEnabled/)
  assert.match(native, /MAX_TRANSITION_LOG_BYTES/)
  assert.match(native, /native-tab-transitions\.jsonl\.1/)
})


test('blocking modal surfaces trap focus and browser shortcuts cannot close their tab', () => {
  const browserShell = readFileSync(
    new URL('../src/components/BrowserShell/BrowserShell.tsx', import.meta.url),
    'utf8',
  )
  assert.match(browserShell, /siteSurfaceActive\s*\|\|\s*getAppDialogsSnapshot\(\)\.length > 0/)

  for (const relativePath of [
    '../src/components/AppDialog/AppDialogHost.tsx',
    '../src/components/SiteUiPrompt/SiteUiPrompt.tsx',
    '../src/components/PrintDialog/PrintDialog.tsx',
    '../src/components/DeveloperTools/DeveloperTools.tsx',
  ]) {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
    assert.match(source, /useModalFocusTrap\(/)
    assert.match(source, /tabIndex=\{-1\}/)
  }
})

test('window.print routes to the Nebula print surface and keeps native print settings', () => {
  const nativeSiteUi = readFileSync(
    new URL('../src-tauri/src/site_ui.rs', import.meta.url),
    'utf8',
  )
  const nativeControls = readFileSync(
    new URL('../src-tauri/src/webview_controls.rs', import.meta.url),
    'utf8',
  )
  const browserShell = readFileSync(
    new URL('../src/components/BrowserShell/BrowserShell.tsx', import.meta.url),
    'utf8',
  )
  const browserPlatform = readFileSync(
    new URL('../src/platform/tauriBrowser.ts', import.meta.url),
    'utf8',
  )
  const printDialog = readFileSync(
    new URL('../src/components/PrintDialog/PrintDialog.tsx', import.meta.url),
    'utf8',
  )
  const printStyles = readFileSync(
    new URL('../src/components/PrintDialog/PrintDialog.module.css', import.meta.url),
    'utf8',
  )

  assert.match(nativeSiteUi, /Object\.defineProperty\(window, 'print'/)
  assert.match(nativeSiteUi, /type: 'nebula-print-request'/)
  assert.match(nativeSiteUi, /SITE_PRINT_REQUEST_EVENT/)
  assert.match(browserShell, /listenSitePrintRequests/)
  assert.match(browserShell, /printBrowseWebview/)
  assert.match(browserPlatform, /webview_print_preview/)
  assert.match(printDialog, /renderBrowsePrintPreview/)
  assert.match(printDialog, /className=\{styles\.previewDocument\}/)
  assert.match(printDialog, /pageRanges:[\s\S]*?pageRanges\.trim\(\)/)
  assert.match(printDialog, /backgrounds,[\s\S]*?headersAndFooters/)
  assert.match(printStyles, /height:\s*calc\(100dvh - 32px\)/)
  assert.match(printStyles, /\.previewDocument[\s\S]*height:\s*100%/)
  assert.match(nativeControls, /PrintToPdfStream/)
  assert.match(nativeControls, /read_pdf_stream/)
  assert.match(nativeControls, /disable_pdf_link_annotations\(&mut bytes\)/)
  assert.match(nativeControls, /SetPageWidth/)
  assert.match(nativeControls, /SetMarginTop/)
  assert.match(nativeControls, /SetPageRanges/)
  assert.match(nativeControls, /SetShouldPrintBackgrounds/)
})

test('browser zoom is shortcut-only and Ctrl+wheel uses the native zoom path', () => {
  const toolbar = readFileSync(
    new URL('../src/components/RightToolbar/RightToolbar.tsx', import.meta.url),
    'utf8',
  )
  const lunarMenu = readFileSync(
    new URL('../src/components/SemiLunarMenu/SemiLunarMenu.tsx', import.meta.url),
    'utf8',
  )
  const shortcuts = readFileSync(
    new URL('../src/core/browserShortcuts.ts', import.meta.url),
    'utf8',
  )
  const chromeApp = readFileSync(
    new URL('../src/ChromeApp.tsx', import.meta.url),
    'utf8',
  )
  const chromeStyles = readFileSync(
    new URL('../src/ChromeApp.module.css', import.meta.url),
    'utf8',
  )
  const chromeWebview = readFileSync(
    new URL('../src/platform/tauriChromeWebview.ts', import.meta.url),
    'utf8',
  )
  const nativeSiteUi = readFileSync(
    new URL('../src-tauri/src/site_ui.rs', import.meta.url),
    'utf8',
  )
  const nativeControls = readFileSync(
    new URL('../src-tauri/src/webview_controls.rs', import.meta.url),
    'utf8',
  )
  const browserShell = readFileSync(
    new URL('../src/components/BrowserShell/BrowserShell.tsx', import.meta.url),
    'utf8',
  )
  const siteZoom = readFileSync(
    new URL('../src/core/siteZoom.ts', import.meta.url),
    'utf8',
  )

  assert.doesNotMatch(toolbar, /zoomPercent/)
  assert.doesNotMatch(lunarMenu, /lunarZoomControl/)
  assert.match(shortcuts, /'zoom-in': \['Ctrl\+\+', 'Ctrl\+='\]/)
  assert.match(shortcuts, /'zoom-out': \['Ctrl\+-'\]/)
  assert.match(shortcuts, /'zoom-reset': \['Ctrl\+0'\]/)
  assert.match(nativeSiteUi, /addEventListener\('wheel'/)
  assert.match(nativeSiteUi, /type: 'nebula-zoom-request'/)
  assert.match(nativeSiteUi, /event\.deltaY < 0 \? 'in' : 'out'/)
  assert.match(chromeApp, /listenZoomIndicator/)
  assert.match(chromeApp, /zoomIndicatorPercent}%/)
  assert.match(chromeApp, /'zoom-out'/)
  assert.match(chromeApp, /'zoom-reset'/)
  assert.match(chromeApp, /'zoom-in'/)
  assert.match(chromeStyles, /\.zoomIndicator/)
  assert.match(chromeStyles, /min-width:\s*184px/)
  assert.match(chromeWebview, /chromeOverlayMinimumLogicalHeight/)
  assert.match(nativeControls, /Result<f64, String>/)
  assert.match(nativeControls, /Ok\(factor\)/)
  assert.match(nativeControls, /webview_set_zoom/)
  assert.match(siteZoom, /nebula-site-zoom-v1/)
  assert.match(siteZoom, /parsed\.origin/)
  assert.match(siteZoom, /Math\.abs\(factor - 1\)/)
  assert.match(browserShell, /siteZoomFactor\(tab\.url\)/)
  assert.match(browserShell, /rememberSiteZoom/)
  assert.match(browserShell, /settings\.privacy\.privateMode/)
})

test('supported app locales drive regional formatting and native UI copy', () => {
  const clock = readFileSync(
    new URL('../src/hooks/useSystemStats.ts', import.meta.url),
    'utf8',
  )
  const localeCore = readFileSync(
    new URL('../src/core/locale.ts', import.meta.url),
    'utf8',
  )
  const spanishMessages = readFileSync(
    new URL('../src/core/localeMessages.es.ts', import.meta.url),
    'utf8',
  )
  const germanMessages = readFileSync(
    new URL('../src/core/localeMessages.de.ts', import.meta.url),
    'utf8',
  )
  const additionalMessages = readFileSync(
    new URL('../src/core/localeMessages.additional.ts', import.meta.url),
    'utf8',
  )
  const italianJapaneseMessages = readFileSync(
    new URL('../src/core/localeMessages.it-ja.ts', import.meta.url),
    'utf8',
  )
  const localeHook = readFileSync(
    new URL('../src/hooks/useLocale.tsx', import.meta.url),
    'utf8',
  )
  const tauriLocale = readFileSync(
    new URL('../src/platform/tauriLocale.ts', import.meta.url),
    'utf8',
  )
  const nativeErrorPage = readFileSync(
    new URL('../src-tauri/src/tab_error_page.rs', import.meta.url),
    'utf8',
  )
  const permissions = readFileSync(
    new URL('../src-tauri/permissions/webview-commands.toml', import.meta.url),
    'utf8',
  )

  assert.match(clock, /const \{ locale \} = useLocale\(\)/)
  assert.match(clock, /getIntlLocale\(locale\)/)
  assert.match(clock, /toLocaleTimeString\(dateLocale/)
  assert.match(clock, /toLocaleDateString\(dateLocale/)
  assert.match(localeCore, /SUPPORTED_LOCALES = \['tr', 'en', 'es', 'de', 'fr', 'id', 'ru', 'it', 'ja'\]/)
  assert.match(localeCore, /language\.startsWith\('es'\)/)
  assert.match(localeCore, /language\.startsWith\('de'\)/)
  assert.match(localeCore, /language\.startsWith\('fr'\)/)
  assert.match(localeCore, /language\.startsWith\('id'\)/)
  assert.match(localeCore, /language\.startsWith\('ru'\)/)
  assert.match(localeCore, /language\.startsWith\('it'\)/)
  assert.match(localeCore, /language\.startsWith\('ja'\)/)
  assert.match(localeCore, /intlLocale: 'es-ES'/)
  assert.match(localeCore, /intlLocale: 'de-DE'/)
  assert.match(localeCore, /intlLocale: 'fr-FR'/)
  assert.match(localeCore, /intlLocale: 'id-ID'/)
  assert.match(localeCore, /intlLocale: 'ru-RU'/)
  assert.match(localeCore, /intlLocale: 'it-IT'/)
  assert.match(localeCore, /intlLocale: 'ja-JP'/)
  assert.match(localeCore, /if \(locale === 'es'\) return ES_LOCALE_MESSAGES\[key\]/)
  assert.match(localeCore, /if \(locale === 'de'\) return DE_LOCALE_MESSAGES\[key\]/)
  assert.match(localeCore, /if \(locale === 'fr'\) return FR_LOCALE_MESSAGES\[key\]/)
  assert.match(localeCore, /if \(locale === 'id'\) return ID_LOCALE_MESSAGES\[key\]/)
  assert.match(localeCore, /if \(locale === 'ru'\) return RU_LOCALE_MESSAGES\[key\]/)
  assert.match(localeCore, /if \(locale === 'it'\) return IT_LOCALE_MESSAGES\[key\]/)
  assert.match(localeCore, /if \(locale === 'ja'\) return JA_LOCALE_MESSAGES\[key\]/)
  assert.match(spanishMessages, /satisfies Record<LocaleMessageKey, string>/)
  assert.match(germanMessages, /satisfies Record<LocaleMessageKey, string>/)
  assert.match(additionalMessages, /satisfies Record<LocaleMessageKey, AdditionalLocaleTuple>/)
  assert.match(italianJapaneseMessages, /satisfies Record<LocaleMessageKey, ItalianJapaneseTuple>/)
  assert.match(localeHook, /syncNativeUiLocale\(locale\)/)
  assert.match(localeHook, /listenUiLocaleChanges/)
  assert.match(localeHook, /isNebulaLocale\(next\)/)
  assert.match(tauriLocale, /nebula-ui-locale-changed/)
  assert.match(tauriLocale, /emit\(UI_LOCALE_CHANGED_EVENT, locale\)/)
  assert.match(nativeErrorPage, /This site can't be reached/)
  assert.match(nativeErrorPage, /Bu siteye ulaşılamıyor/)
  assert.match(nativeErrorPage, /No se puede acceder a este sitio/)
  assert.match(nativeErrorPage, /Diese Website ist nicht erreichbar/)
  assert.match(nativeErrorPage, /Ce site est inaccessible/)
  assert.match(nativeErrorPage, /Situs ini tidak dapat dijangkau/)
  assert.match(nativeErrorPage, /Не удаётся открыть этот сайт/)
  assert.match(nativeErrorPage, /Questo sito non è raggiungibile/)
  assert.match(nativeErrorPage, /このサイトにアクセスできません/)
  assert.doesNotMatch(nativeErrorPage, /navigator\.language/)
  assert.match(permissions, /"webview_set_ui_locale"/)
})

test('flat locale catalogs cover every message key and preserve interpolation placeholders', () => {
  const evaluateMap = (relativePath: string, exportName: string): Record<string, string | { en: string }> => {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
    const output = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText
    const exports: Record<string, unknown> = {}
    const sandbox = { exports, module: { exports } }
    vm.runInNewContext(output, sandbox)
    return sandbox.exports[exportName] as Record<string, string | { en: string }>
  }
  const base = evaluateMap('../src/core/localeMessages.ts', 'LOCALE_MESSAGES')
  const spanish = evaluateMap('../src/core/localeMessages.es.ts', 'ES_LOCALE_MESSAGES')
  const german = evaluateMap('../src/core/localeMessages.de.ts', 'DE_LOCALE_MESSAGES')
  const french = evaluateMap('../src/core/localeMessages.additional.ts', 'FR_LOCALE_MESSAGES')
  const indonesian = evaluateMap('../src/core/localeMessages.additional.ts', 'ID_LOCALE_MESSAGES')
  const russian = evaluateMap('../src/core/localeMessages.additional.ts', 'RU_LOCALE_MESSAGES')
  const italian = evaluateMap('../src/core/localeMessages.it-ja.ts', 'IT_LOCALE_MESSAGES')
  const japanese = evaluateMap('../src/core/localeMessages.it-ja.ts', 'JA_LOCALE_MESSAGES')
  const baseKeys = Object.keys(base).sort()
  const placeholders = (value: string) =>
    [...value.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((match) => match[1]).sort()

  assert.ok(baseKeys.length > 600)
  for (const [localeName, catalog] of [
    ['Spanish', spanish],
    ['German', german],
    ['French', french],
    ['Indonesian', indonesian],
    ['Russian', russian],
    ['Italian', italian],
    ['Japanese', japanese],
  ] as const) {
    assert.deepEqual(Object.keys(catalog).sort(), baseKeys)
    for (const key of baseKeys) {
      const baseValue = base[key]
      const localizedValue = catalog[key]
      assert.equal(typeof localizedValue, 'string', `${key} must have ${localeName} text`)
      assert.deepEqual(
        placeholders(typeof baseValue === 'string' ? baseValue : baseValue.en),
        placeholders(localizedValue as string),
        `${key} must preserve placeholders in ${localeName}`,
      )
    }
  }
})

test('two-step password flow carries username within the same tab and records role origins', () => {
  const tracker = new PasswordStepFlowTracker(5 * 60_000)
  const now = 1_000_000

  assert.equal(tracker.captureIdentity({
    shortcutId: 'tab-a',
    origin: 'https://example.com',
    username: 'user@example.com',
    receivedAt: now,
  }), true)
  assert.equal(tracker.captureSubmission({
    shortcutId: 'tab-a',
    origin: 'https://example.com',
    url: 'https://example.com/login/password',
    username: '',
    password: 'correct horse battery staple',
    receivedAt: now + 1000,
  }), true)

  assert.deepEqual(
    tracker.takeSubmission('tab-a', 'https://example.com/dashboard', now + 1500),
    {
      shortcutId: 'tab-a',
      url: 'https://example.com/login/password',
      username: 'user@example.com',
      password: 'correct horse battery staple',
      usernameOrigins: ['https://example.com'],
      passwordOrigins: ['https://example.com'],
    },
  )
})

test('two-step password identity stays tab/TTL-bound and split origins remain role-scoped', () => {
  const wrongTab = new PasswordStepFlowTracker(1000)
  wrongTab.captureIdentity({
    shortcutId: 'tab-a',
    origin: 'https://example.com',
    username: 'user@example.com',
    receivedAt: 100,
  })
  wrongTab.captureSubmission({
    shortcutId: 'tab-b',
    origin: 'https://example.com',
    url: 'https://example.com/password',
    username: '',
    password: 'secret',
    receivedAt: 200,
  })
  assert.equal(
    wrongTab.takeSubmission('tab-b', 'https://example.com/password', 300),
    null,
  )

  const mismatchedSource = new PasswordStepFlowTracker(1000)
  assert.equal(mismatchedSource.captureSubmission({
    shortcutId: 'tab-a',
    origin: 'https://example.com',
    url: 'https://evil.example/password',
    username: 'user@example.com',
    password: 'secret',
    receivedAt: 200,
  }), false)

  const splitOrigin = new PasswordStepFlowTracker(1000)
  splitOrigin.captureIdentity({
    shortcutId: 'tab-a',
    origin: 'https://accounts.example.com',
    username: 'user@example.com',
    receivedAt: 100,
  })
  splitOrigin.captureSubmission({
    shortcutId: 'tab-a',
    origin: 'https://auth.example.net',
    url: 'https://auth.example.net/password',
    username: '',
    password: 'secret',
    receivedAt: 200,
  })
  assert.deepEqual(
    splitOrigin.takeSubmission('tab-a', 'https://auth.example.net/password', 300),
    {
      shortcutId: 'tab-a',
      url: 'https://auth.example.net/password',
      username: 'user@example.com',
      password: 'secret',
      usernameOrigins: ['https://accounts.example.com'],
      passwordOrigins: ['https://auth.example.net'],
    },
  )

  const expired = new PasswordStepFlowTracker(1000)
  expired.captureIdentity({
    shortcutId: 'tab-a',
    origin: 'https://example.com',
    username: 'user@example.com',
    receivedAt: 100,
  })
  expired.captureSubmission({
    shortcutId: 'tab-a',
    origin: 'https://example.com',
    url: 'https://example.com/password',
    username: '',
    password: 'secret',
    receivedAt: 200,
  })
  assert.equal(
    expired.takeSubmission('tab-a', 'https://example.com/password', 1500),
    null,
  )
})

test('password save survives post-submit cross-origin navigation and stays out of site DOM', () => {
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

  assert.deepEqual(tracker.takeSubmission('tab-a', 'https://app.example.net/after-login', now + 250), {
    shortcutId: 'tab-a',
    url: 'https://login.example.com/password',
    username: 'user@example.com',
    password: 'secret',
    usernameOrigins: ['https://login.example.com'],
    passwordOrigins: ['https://login.example.com'],
  })

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
  assert.match(shell, /passwordSaveOffer &&/)
})

test('native password-step bridge captures the identity and password-only submit phases', () => {
  const source = readFileSync(
    new URL('../src-tauri/src/site_ui.rs', import.meta.url),
    'utf8',
  )
  assert.match(source, /nebula-password-step-identity/)
  assert.match(source, /nebula-password-step-submit/)
  assert.match(source, /event\.isTrusted/)
})



test('Google sync password payload round-trips with local encryption and rejects the wrong secret', async () => {
  const entries = [
    {
      id: 'pw-1',
      label: 'Example',
      url: 'https://example.com',
      username: 'user@example.com',
      password: 'secret-value',
      updatedAt: 1234,
    },
  ]
  const plaintext = JSON.stringify(entries)
  const encrypted = await encryptSyncText(plaintext, 'correct sync secret')
  assert.equal(encrypted.algorithm, 'AES-256-GCM')
  assert.equal(encrypted.kdf, 'PBKDF2-SHA256')
  assert.doesNotMatch(encrypted.ciphertext, /secret-value/)
  assert.deepEqual(
    JSON.parse(await decryptSyncText(encrypted, 'correct sync secret')),
    entries,
  )
  await assert.rejects(
    decryptSyncText(encrypted, 'wrong sync secret'),
    /incorrect|damaged/i,
  )
})

test('Google sync password merge keeps the newest credential for each origin and username', () => {
  const local = [
    {
      id: 'local-old',
      label: 'Example old',
      url: 'https://example.com',
      username: 'user@example.com',
      password: 'old',
      updatedAt: 10,
    },
    {
      id: 'local-only',
      label: 'Local',
      url: 'https://local.example',
      username: 'local',
      password: 'keep',
      updatedAt: 20,
    },
  ]
  const remote = [
    {
      id: 'remote-new',
      label: 'Example new',
      url: 'https://example.com',
      username: 'USER@example.com',
      password: 'new',
      updatedAt: 30,
    },
  ]
  const merged = mergeSyncedPasswords(local, remote)
  assert.equal(merged.length, 2)
  assert.equal(merged.find((entry) => entry.url === 'https://example.com')?.password, 'new')
  assert.equal(merged.find((entry) => entry.url === 'https://local.example')?.password, 'keep')
})

test('Google sync bundle and native bridge stay pinned to versioned appDataFolder storage', () => {
  const bundleSource = readFileSync(
    new URL('../src/core/googleSync.ts', import.meta.url),
    'utf8',
  )
  const nativeSync = readFileSync(
    new URL('../src-tauri/src/google_sync.rs', import.meta.url),
    'utf8',
  )
  const nativeOAuth = readFileSync(
    new URL('../src-tauri/src/google_oauth.rs', import.meta.url),
    'utf8',
  )
  const permissions = readFileSync(
    new URL('../src-tauri/permissions/webview-commands.toml', import.meta.url),
    'utf8',
  )

  assert.match(bundleSource, /schemaVersion: 1/)
  assert.match(bundleSource, /nebula-google-sync-preferences-v1/)
  assert.match(nativeSync, /appDataFolder/)
  assert.match(nativeSync, /nebula-sync-v1\.json/)
  assert.match(nativeOAuth, /https:\/\/www\.googleapis\.com\/auth\/drive\.appdata/)
  assert.match(nativeOAuth, /access_type=offline/)
  assert.match(permissions, /"google_sync_pull"/)
  assert.match(permissions, /"google_sync_push"/)
})


test('settings destructive confirmations use Nebula app dialogs instead of browser-native confirm', () => {
  const syncSettings = readFileSync(
    new URL('../src/components/SettingsPanel/GoogleSyncSettings.tsx', import.meta.url),
    'utf8',
  )
  const settingsPanel = readFileSync(
    new URL('../src/components/SettingsPanel/SettingsPanel.tsx', import.meta.url),
    'utf8',
  )

  assert.match(syncSettings, /showAppConfirmation\(t\('syncRestoreConfirm'\), t\('syncTitle'\)\)/)
  assert.doesNotMatch(syncSettings, /window\.confirm\(/)
  assert.match(settingsPanel, /showAppConfirmation\([\s\S]*clearBrowsingDataConfirm[\s\S]*clearBrowsingData/)
  assert.doesNotMatch(settingsPanel, /window\.confirm\(/)
})

test('browsing downloads reuse transfer telemetry in a compact row', () => {
  const source = readFileSync(
    new URL('../src/components/DownloadManager/DownloadManager.tsx', import.meta.url),
    'utf8',
  )
  const css = readFileSync(
    new URL('../src/components/DownloadManager/DownloadManager.module.css', import.meta.url),
    'utf8',
  )

  assert.doesNotMatch(source, /variant !== 'home'/)
  assert.match(source, /variant === 'browsing' \? styles\.transferMetaCompact/)
  assert.match(source, /const showSize = variant === 'home' \|\| item\.state !== 'in_progress'/)
  assert.match(css, /\.transferMetaCompact\s*\{/)
})

test('Nebula owns password UX and WebView2 native password stores stay disabled', () => {
  const brandingSource = readFileSync(
    new URL('../src-tauri/src/webview_branding.rs', import.meta.url),
    'utf8',
  )
  const privacySource = readFileSync(
    new URL('../src-tauri/src/webview_privacy.rs', import.meta.url),
    'utf8',
  )
  const shellSource = readFileSync(
    new URL('../src/components/BrowserShell/BrowserShell.tsx', import.meta.url),
    'utf8',
  )
  const bridgeSource = readFileSync(
    new URL('../src/core/passwordBridgeScript.ts', import.meta.url),
    'utf8',
  )

  assert.match(brandingSource, /SetIsPasswordAutosaveEnabled\(false\)/)
  assert.match(brandingSource, /SetIsGeneralAutofillEnabled\(false\)/)
  assert.match(privacySource, /SetIsPasswordAutosaveEnabled\(false\)/)
  assert.match(privacySource, /SetIsGeneralAutofillEnabled\(false\)/)
  assert.doesNotMatch(brandingSource, /SetIsPasswordAutosaveEnabled\(true\)/)
  assert.doesNotMatch(privacySource, /SetIsPasswordAutosaveEnabled\(true\)/)
  assert.match(
    shellSource,
    /usePasswordBridge\(\{[\s\S]*?enabled:\s*[\s\S]*?isBrowsing[\s\S]*?isTauri,/,
  )
  assert.doesNotMatch(bridgeSource, /nebula-pwd-banner/)
  assert.doesNotMatch(bridgeSource, /renderPrompt/)
})

test('sensitive device usage is source-validated and visible in browsing chrome', () => {
  const siteUi = readFileSync(
    new URL('../src-tauri/src/site_ui.rs', import.meta.url),
    'utf8',
  )
  const fullscreen = readFileSync(
    new URL('../src-tauri/src/tab_fullscreen.rs', import.meta.url),
    'utf8',
  )
  const chrome = readFileSync(
    new URL('../src/ChromeApp.tsx', import.meta.url),
    'utf8',
  )
  const usage = readFileSync(
    new URL('../src/core/sensitiveFeatureUsage.ts', import.meta.url),
    'utf8',
  )

  assert.match(siteUi, /validated_web_message_source\(&sender, &args\)/)
  assert.match(siteUi, /message_url != top_level_url/)
  assert.match(siteUi, /nebula-sensitive-feature-usage/)
  assert.match(siteUi, /mediaDevices\.getUserMedia/)
  assert.match(siteUi, /mediaDevices\.getDisplayMedia/)
  assert.match(siteUi, /liveDisplayTracks/)
  assert.match(siteUi, /track\.addEventListener\('ended'/)
  assert.match(siteUi, /Object\.defineProperty\(geolocation, 'watchPosition'/)
  assert.match(fullscreen, /validated_web_message_source\(&webview, &args\)/)
  assert.match(fullscreen, /nebula-fullscreen-state-changed/)
  assert.match(usage, /startsWith\('nebula-tab-'\)/)
  assert.match(chrome, /listenSensitiveFeatureUsage/)
  assert.match(chrome, /privacyIndicator/)
  assert.match(chrome, /sensitiveUsageSummary\.screen/)
})

test('getDisplayMedia delegates to the native WebView2 picker and tracks its tab lifetime', () => {
  const siteUi = readFileSync(
    new URL('../src-tauri/src/site_ui.rs', import.meta.url),
    'utf8',
  )
  const usage = readFileSync(
    new URL('../src/core/sensitiveFeatureUsage.ts', import.meta.url),
    'utf8',
  )
  const chrome = readFileSync(
    new URL('../src/ChromeApp.tsx', import.meta.url),
    'utf8',
  )

  const nativeStart = siteUi.indexOf('Observe getDisplayMedia')
  const nativeEnd = siteUi.indexOf('let script_app', nativeStart)
  assert.ok(nativeStart >= 0 && nativeEnd > nativeStart)
  const nativeHandler = siteUi.slice(nativeStart, nativeEnd)

  assert.match(nativeHandler, /core\.cast::<ICoreWebView2_27>\(\)/)
  assert.match(nativeHandler, /ScreenCaptureStartingEventHandler::create/)
  assert.match(nativeHandler, /add_ScreenCaptureStarting/)
  assert.match(nativeHandler, /native-picker-delegated/)
  assert.doesNotMatch(nativeHandler, /SetCancel|SetHandled/)
  assert.match(siteUi, /remove_ScreenCaptureStarting/)

  const displayStart = siteUi.indexOf(
    "typeof mediaDevices.getDisplayMedia === 'function'",
  )
  const displayEnd = siteUi.indexOf(
    "if (typeof MediaStreamTrack !== 'undefined'",
    displayStart,
  )
  assert.ok(displayStart >= 0 && displayEnd > displayStart)
  const displayWrapper = siteUi.slice(displayStart, displayEnd)
  assert.match(displayWrapper, /nativeGetDisplayMedia\(constraints\)\.then/)
  assert.match(displayWrapper, /trackDevice\(track, 'screen'\)/)
  assert.doesNotMatch(displayWrapper, /\.catch\(/)
  assert.match(siteUi, /liveDisplayTracks\.clear\(\)/)
  assert.match(siteUi, /source-tab-closed/)
  assert.doesNotMatch(siteUi, /visibilitychange[\s\S]*?liveDisplayTracks\.clear/)
  assert.match(usage, /screen: boolean/)
  assert.match(chrome, /t\('privacyScreenInUse'\)/)
})

test('transition logs redact secrets and Store updater absence is automated', () => {
  const native = readFileSync(
    new URL('../src-tauri/src/lib.rs', import.meta.url),
    'utf8',
  )
  const transitionLog = readFileSync(
    new URL('../src/platform/tauriTransitionLog.ts', import.meta.url),
    'utf8',
  )
  const storeAudit = readFileSync(
    new URL('../scripts/store-updater-audit.mjs', import.meta.url),
    'utf8',
  )

  assert.match(native, /sanitize_transition_log_value\(entry, None\)/)
  assert.match(native, /"password"[\s\S]*"token"[\s\S]*"authorization"/)
  assert.match(native, /"\[redacted\]"/)
  assert.doesNotMatch(transitionLog, /errorStack:/)
  assert.doesNotMatch(transitionLog, /JSON\.stringify\(error\)/)
  assert.match(storeAudit, /@tauri-apps\/plugin-updater/)
  assert.match(storeAudit, /tauri-plugin-updater/)
  assert.match(storeAudit, /createUpdaterArtifacts/)
  assert.match(storeAudit, /AppUpdatePrompt/)
})
