import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { extname, join, normalize, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp, rm } from 'node:fs/promises'
import net from 'node:net'
import { Cdp, pollUntil } from './e2e-cdp.mjs'

const root = resolve(process.cwd())
const distDir = join(root, 'dist')
const timeoutMs = Number(process.env.NEBULA_E2E_TIMEOUT_MS || 20_000)
let fatalBrowserError = null

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

async function freePort() {
  return new Promise((resolvePromise, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolvePromise(port))
    })
  })
}

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
}

async function startStaticServer() {
  assert(
    existsSync(join(distDir, 'index.html')),
    'dist/index.html bulunamadı. Önce npm run build çalıştır.',
  )

  const port = await freePort()

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(
        req.url || '/',
        `http://${req.headers.host || '127.0.0.1'}`,
      )

      let pathname = decodeURIComponent(url.pathname)
      if (pathname === '/') pathname = '/index.html'

      const candidate = normalize(join(distDir, pathname))

      if (!candidate.startsWith(normalize(distDir))) {
        res.writeHead(403).end('Forbidden')
        return
      }

      let file = candidate

      try {
        const info = await stat(file)
        if (info.isDirectory()) file = join(file, 'index.html')
      } catch {
        // SPA fallback for client-side paths.
        file = join(distDir, 'index.html')
      }

      const body = await readFile(file)

      res.writeHead(200, {
        'content-type':
          mime[extname(file).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-store',
      })

      res.end(body)
    } catch (error) {
      res.writeHead(500).end(String(error))
    }
  })

  await new Promise((resolvePromise) =>
    server.listen(port, '127.0.0.1', resolvePromise),
  )

  return { server, port }
}

function firstExisting(paths) {
  return paths.find((path) => path && existsSync(path)) || null
}

function findBrowser() {
  if (process.env.NEBULA_E2E_BROWSER) {
    assert(
      existsSync(process.env.NEBULA_E2E_BROWSER),
      `NEBULA_E2E_BROWSER bulunamadı: ${process.env.NEBULA_E2E_BROWSER}`,
    )

    return process.env.NEBULA_E2E_BROWSER
  }

  if (process.platform === 'win32') {
    const pf = process.env.ProgramFiles
    const pfx86 = process.env['ProgramFiles(x86)']
    const local = process.env.LOCALAPPDATA

    const known = firstExisting([
      pf && join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      pfx86 &&
        join(pfx86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      local &&
        join(local, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),

      pf && join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      pfx86 &&
        join(pfx86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      local &&
        join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ])

    if (known) return known

    for (const command of ['msedge', 'chrome']) {
      const found = spawnSync('where', [command], {
        encoding: 'utf8',
      })

      if (found.status === 0) {
        return found.stdout.trim().split(/\r?\n/)[0]
      }
    }
  } else {
    for (const command of [
      'chromium',
      'chromium-browser',
      'google-chrome',
      'microsoft-edge',
    ]) {
      const found = spawnSync('which', [command], {
        encoding: 'utf8',
      })

      if (found.status === 0) return found.stdout.trim()
    }
  }

  throw new Error(
    'Edge/Chrome/Chromium bulunamadı. NEBULA_E2E_BROWSER ile tarayıcı yolunu belirt.',
  )
}

async function waitForJson(url, deadline = Date.now() + timeoutMs) {
  let lastError

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)

      if (response.ok) {
        return await response.json()
      }
    } catch (error) {
      lastError = error
    }

    await sleep(120)
  }

  throw new Error(
    `CDP hazır olmadı: ${url}${lastError ? ` (${lastError})` : ''}`,
  )
}

async function poll(
  label,
  fn,
  deadline = Date.now() + timeoutMs,
) {
  return pollUntil(label, fn, deadline, () => fatalBrowserError)
}

async function run() {
  let server
  let browser
  let cdp
  let profileDir
  let shuttingDown = false

  try {
    const started = await startStaticServer()
    server = started.server

    const browserPath = findBrowser()
    const debugPort = await freePort()
    profileDir = await mkdtemp(join(tmpdir(), 'nebula-e2e-'))
    const appUrl = `http://127.0.0.1:${started.port}/`

    const browserArgs = [
      '--headless=new',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      '--window-size=1440,1000',
      appUrl,
    ]

    if (
      process.platform !== 'win32' &&
      typeof process.getuid === 'function' &&
      process.getuid() === 0
    ) {
      browserArgs.splice(1, 0, '--no-sandbox')
    }

    browser = spawn(browserPath, browserArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    browser.on('error', (error) => {
      if (shuttingDown) return
      fatalBrowserError = error
      cdp?.abort(error)
    })
    browser.on('exit', (code, signal) => {
      if (shuttingDown) return
      fatalBrowserError = new Error(
        `Browser exited before smoke completion (code=${code}, signal=${signal || 'none'}).`,
      )
      cdp?.abort(fatalBrowserError)
    })

    const targets = await poll('browser target', async () => {
      try {
        const list = await waitForJson(
          `http://127.0.0.1:${debugPort}/json/list`,
          Date.now() + 500,
        )

        return (
          list.find(
            (target) =>
              target.type === 'page' &&
              target.webSocketDebuggerUrl &&
              target.url?.startsWith(appUrl),
          ) || null
        )
      } catch {
        return null
      }
    })

    cdp = new Cdp(targets.webSocketDebuggerUrl, {
      callTimeoutMs: timeoutMs,
    })

    await cdp.open()
    await cdp.call('Runtime.enable')
    await cdp.call('Page.enable')

    await poll('app navigation', () =>
      cdp.eval(
        `location.href.startsWith(${JSON.stringify(appUrl)})`,
      ),
    )

    await poll('localStorage availability', () =>
      cdp.eval(`
        (() => {
          try {
            localStorage.getItem('nebula-e2e-probe')
            return true
          } catch {
            return false
          }
        })()
      `),
    )

    // Skip onboarding so the smoke suite always reaches the normal browser shell.
    await cdp.eval(`
      (() => {
        localStorage.setItem(
          'nebula-onboarding-complete-v1',
          '1'
        )
        return true
      })()
    `)

    await cdp.call('Page.reload', {
      ignoreCache: true,
    })

    await sleep(250)

    await poll('Nebula root render', () =>
      cdp.eval(
        `Boolean(document.querySelector('#root')?.children.length)`,
      ),
    )

    const bodyText = await cdp.eval(
      `document.body.innerText`,
    )

    assert(
      typeof bodyText === 'string' &&
        bodyText.trim().length > 0,
      'Nebula UI boş render oldu.',
    )

    console.log('✓ App shell render')

    // ----------------------------------------------------------------
    // HISTORY
    // ----------------------------------------------------------------

    await poll('History toolbar button', () =>
      cdp.eval(`
        Boolean(
          [...document.querySelectorAll('button')].find(
            (b) =>
              ['Geçmiş', 'History'].includes(
                b.getAttribute('aria-label') || ''
              )
          )
        )
      `),
    )

    await cdp.eval(`
      (() => {
        const b = [...document.querySelectorAll('button')].find(
          (el) =>
            ['Geçmiş', 'History'].includes(
              el.getAttribute('aria-label') || ''
            )
        )

        b?.focus()
        b?.click()

        return Boolean(b)
      })()
    `)

    await poll('History dialog open', () =>
      cdp.eval(`
        Boolean(
          document.querySelector(
            '[role="dialog"][aria-labelledby="history-dialog-title"]'
          )
        )
      `),
    )

    console.log('✓ History opens')

    const historySearchFocused = await poll(
      'History search focus',
      () =>
        cdp.eval(`
          (() => {
            const d = document.querySelector(
              '[role="dialog"][aria-labelledby="history-dialog-title"]'
            )

            return Boolean(
              d &&
              d.contains(document.activeElement) &&
              document.activeElement?.tagName === 'INPUT'
            )
          })()
        `),
    )

    assert(
      historySearchFocused,
      'History açıldığında arama alanı odaklanmadı.',
    )

    console.log('✓ History initial keyboard focus')

    await cdp.eval(`
      (() => {
        const d = document.querySelector(
          '[role="dialog"][aria-labelledby="history-dialog-title"]'
        )

        const f = d
          ? [
              ...d.querySelectorAll(
                'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
              ),
            ]
          : []

        f[f.length - 1]?.focus()

        return f.length
      })()
    `)

    await cdp.call('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Tab',
      code: 'Tab',
      windowsVirtualKeyCode: 9,
    })

    await cdp.call('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Tab',
      code: 'Tab',
      windowsVirtualKeyCode: 9,
    })

    const historyTrapped = await cdp.eval(`
      (() => {
        const d = document.querySelector(
          '[role="dialog"][aria-labelledby="history-dialog-title"]'
        )

        return Boolean(
          d?.contains(document.activeElement)
        )
      })()
    `)

    assert(
      historyTrapped,
      'History içinde Tab odağı modal dışına kaçtı.',
    )

    console.log('✓ History focus trap')

    await cdp.call('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
    })

    await cdp.call('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
    })

    await poll(
      'History dialog close',
      async () =>
        !(await cdp.eval(`
          Boolean(
            document.querySelector(
              '[role="dialog"][aria-labelledby="history-dialog-title"]'
            )
          )
        `)),
    )

    await poll('History focus restore', () =>
      cdp.eval(`
        ['Geçmiş', 'History'].includes(
          document.activeElement?.getAttribute?.('aria-label') || ''
        )
      `),
    )

    console.log(
      '✓ History closes with Escape + restores focus',
    )

    // ----------------------------------------------------------------
    // SETTINGS
    // ----------------------------------------------------------------

    await cdp.eval(`
      (() => {
        const b = [...document.querySelectorAll('button')].find(
          (el) =>
            ['Ayarlar', 'Settings'].includes(
              el.getAttribute('aria-label') || ''
            )
        )

        b?.focus()
        b?.click()

        return Boolean(b)
      })()
    `)

    await poll('Settings dialog open', () =>
      cdp.eval(`
        Boolean(
          document.querySelector(
            '[role="dialog"][aria-label="Ayarlar"], [role="dialog"][aria-label="Settings"]'
          )
        )
      `),
    )

    await poll('Settings focus enters dialog', () =>
      cdp.eval(`
        (() => {
          const d = document.querySelector(
            '[role="dialog"][aria-label="Ayarlar"], [role="dialog"][aria-label="Settings"]'
          )

          return Boolean(
            d?.contains(document.activeElement)
          )
        })()
      `),
    )

    console.log('✓ Settings opens + keyboard focus')

    // ----------------------------------------------------------------
// SHORTCUTS SETTINGS
// ----------------------------------------------------------------

const shortcutsOpened = await cdp.eval(`
  (() => {
    const d = document.querySelector(
      '[role="dialog"][aria-label="Ayarlar"], [role="dialog"][aria-label="Settings"]'
    )

    if (!d) return false

    const buttons = [...d.querySelectorAll('button')]

    const b = buttons.find((el) => {
      const text = (el.textContent || '')
        .replace(/\\s+/g, ' ')
        .trim()
        .toLocaleLowerCase('tr-TR')

      const aria = (el.getAttribute('aria-label') || '')
        .replace(/\\s+/g, ' ')
        .trim()
        .toLocaleLowerCase('tr-TR')

      return (
        text.includes('kısayol') ||
        text.includes('shortcut') ||
        aria.includes('kısayol') ||
        aria.includes('shortcut')
      )
    })

    if (!b) return false

    b.click()
    return true
  })()
`)

assert(
  shortcutsOpened,
  'Ayarlar içinde Klavye Kısayolları kategorisi bulunamadı.',
)

await poll('Keyboard shortcuts settings', () =>
  cdp.eval(`
    (() => {
      const d = document.querySelector(
        '[role="dialog"][aria-label="Ayarlar"], [role="dialog"][aria-label="Settings"]'
      )

      if (!d) return false

      /*
       * Keycap'ler Ctrl + T'yi örneğin:
       *
       * Ctrl
       * +
       * T
       *
       * şeklinde innerText'e verebilir.
       *
       * Bu nedenle boşlukları tamamen kaldırıyoruz.
       */
      const text = (d.innerText || '')
        .replace(/\\s+/g, '')
        .toLowerCase()

      const hasCtrlT = text.includes('ctrl+t')
      const hasCtrlH = text.includes('ctrl+h')
      const hasCtrlN = text.includes('ctrl+n')

      return hasCtrlT && hasCtrlH && !hasCtrlN
    })()
  `),
)

console.log('✓ Keyboard shortcuts reference')

    // ----------------------------------------------------------------
    // ACCESSIBLE BUTTON NAMES
    // ----------------------------------------------------------------

    const unnamedButtons = await cdp.eval(`
      [...document.querySelectorAll('button')].filter((b) => {
        const style = getComputedStyle(b)

        if (
          style.display === 'none' ||
          style.visibility === 'hidden'
        ) {
          return false
        }

        return !(
          b.getAttribute('aria-label') ||
          b.getAttribute('aria-labelledby') ||
          b.getAttribute('title') ||
          b.textContent?.trim()
        )
      }).length
    `)

    assert(
      unnamedButtons === 0,
      `Erişilebilir adı olmayan görünür buton sayısı: ${unnamedButtons}`,
    )

    console.log(
      '✓ Visible buttons have accessible names',
    )

    await cdp.call('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
    })

    await cdp.call('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
    })

    await poll(
      'Settings dialog close',
      async () =>
        !(await cdp.eval(`
          Boolean(
            document.querySelector(
              '[role="dialog"][aria-label="Ayarlar"], [role="dialog"][aria-label="Settings"]'
            )
          )
        `)),
    )

    await poll('Settings focus restore', () =>
      cdp.eval(`
        ['Ayarlar', 'Settings'].includes(
          document.activeElement?.getAttribute?.('aria-label') || ''
        )
      `),
    )

    console.log(
      '✓ Settings closes + restores focus',
    )

    await sleep(150)

    // ----------------------------------------------------------------
    // CRASH RECOVERY
    // ----------------------------------------------------------------

    // Simulate an unclean previous run and a two-tab session,
    // then reload the app.
    await cdp.eval(`
      (() => {
        const now = Date.now()

        // Page.reload is only the transport for this fixture. Suppress the
        // app's graceful pagehide/beforeunload cleanup so the reload models an
        // unclean renderer exit instead of deleting or overwriting the session.
        const suppressGracefulExit = (event) => event.stopImmediatePropagation()
        window.addEventListener('beforeunload', suppressGracefulExit, true)
        window.addEventListener('pagehide', suppressGracefulExit, true)

        localStorage.setItem(
          'nebula-browser-run-state-v1',
          JSON.stringify({
            version: 1,
            launchId: 'e2e-old-run',
            startedAt: now - 30000,
            cleanExit: false,
          })
        )

        localStorage.setItem(
          'nebula-current-browser-session-v1',
          JSON.stringify({
            id: 'e2e-session',
            savedAt: now - 5000,
            activeTabId: 'e2e-tab-1',
            tabs: [
              {
                id: 'e2e-tab-1',
                url: 'https://example.com/',
                title: 'Example',
              },
              {
                id: 'e2e-tab-2',
                url: 'https://example.org/',
                title: 'Example Org',
              },
            ],
          })
        )

        const protectedKeys = new Set([
          'nebula-browser-run-state-v1',
          'nebula-current-browser-session-v1',
        ])
        const originalSetItem = Storage.prototype.setItem
        const originalRemoveItem = Storage.prototype.removeItem
        Storage.prototype.setItem = function (key, value) {
          if (this === localStorage && protectedKeys.has(String(key))) return
          return originalSetItem.call(this, key, value)
        }
        Storage.prototype.removeItem = function (key) {
          if (this === localStorage && protectedKeys.has(String(key))) return
          return originalRemoveItem.call(this, key)
        }

        return true
      })()
    `)

    await cdp.call('Page.reload', {
      ignoreCache: true,
    })

    await sleep(250)

    await poll('Crash fixture survives unclean reload', () =>
      cdp.eval(`
        (() => {
          const run = JSON.parse(
            localStorage.getItem('nebula-browser-run-state-v1') || 'null'
          )
          const session = JSON.parse(
            localStorage.getItem('nebula-current-browser-session-v1') || 'null'
          )
          return run?.launchId !== 'e2e-old-run' && session?.id === 'e2e-session'
        })()
      `),
    )

    await poll('Crash recovery alert', () =>
      cdp.eval(`
        Boolean(
          document.querySelector('[role="alertdialog"]')
        )
      `),
    )

    const recoveryText = await cdp.eval(`
      document.querySelector('[role="alertdialog"]')
        ?.innerText || ''
    `)

    assert(
      /2/.test(recoveryText),
      'Crash recovery sekme sayısını göstermedi.',
    )

    console.log('✓ Crash recovery prompt')

    const restoreFocused = await cdp.eval(`
      document.activeElement?.tagName === 'BUTTON' &&
      /restore|geri yükle/i.test(
        document.activeElement?.innerText || ''
      )
    `)

    assert(
      restoreFocused,
      'Crash recovery Restore butonu ilk odak değil.',
    )

    console.log('✓ Crash recovery keyboard focus')

    await cdp.call('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Tab',
      code: 'Tab',
      windowsVirtualKeyCode: 9,
    })

    await cdp.call('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Tab',
      code: 'Tab',
      windowsVirtualKeyCode: 9,
    })

    const recoveryTrapped = await cdp.eval(`
      document
        .querySelector('[role="alertdialog"]')
        ?.contains(document.activeElement) === true
    `)

    assert(
      recoveryTrapped,
      'Crash recovery Tab odağı dialog dışına kaçtı.',
    )

    console.log('✓ Crash recovery focus trap')

    await cdp.eval(`
      (() => {
        const dialog = document.querySelector('[role="alertdialog"]')
        const restore = Array.from(dialog?.querySelectorAll('button') || [])
          .find((button) => /geri yükle|restore/i.test(button.innerText || ''))
        restore?.click()
        return Boolean(restore)
      })()
    `)

    await poll('Crash recovery restore closes prompt', () =>
      cdp.eval(`!document.querySelector('[role="alertdialog"]')`),
    )
    await poll('Crash recovery restores both tabs', () =>
      cdp.eval(`
        document.querySelectorAll(
          'iframe[title="Example"], iframe[title="Example Org"]'
        ).length === 2
      `),
    )
    assert(
      await cdp.eval(`Boolean(document.querySelector('iframe[title="Example"]:not([hidden])'))`),
      'Crash recovery aktif sekmeyi geri yüklemedi.',
    )

    console.log('✓ Crash recovery Restore restores tabs and active tab')

    // Exercise the other destructive choice with a distinct session. The
    // dismissed tabs must not be opened automatically.
    await cdp.eval(`
      (() => {
        const now = Date.now()
        const suppressGracefulExit = (event) => event.stopImmediatePropagation()
        window.addEventListener('beforeunload', suppressGracefulExit, true)
        window.addEventListener('pagehide', suppressGracefulExit, true)
        localStorage.setItem(
          'nebula-browser-run-state-v1',
          JSON.stringify({
            version: 1,
            launchId: 'e2e-dismiss-old-run',
            startedAt: now - 30000,
            cleanExit: false,
          })
        )
        localStorage.setItem(
          'nebula-current-browser-session-v1',
          JSON.stringify({
            id: 'e2e-dismiss-session',
            savedAt: now - 5000,
            activeTabId: 'e2e-dismiss-tab',
            tabs: [{
              id: 'e2e-dismiss-tab',
              url: 'https://example.net/',
              title: 'Dismiss Fixture',
            }],
          })
        )
        const protectedKeys = new Set([
          'nebula-browser-run-state-v1',
          'nebula-current-browser-session-v1',
        ])
        const originalSetItem = Storage.prototype.setItem
        const originalRemoveItem = Storage.prototype.removeItem
        Storage.prototype.setItem = function (key, value) {
          if (this === localStorage && protectedKeys.has(String(key))) return
          return originalSetItem.call(this, key, value)
        }
        Storage.prototype.removeItem = function (key) {
          if (this === localStorage && protectedKeys.has(String(key))) return
          return originalRemoveItem.call(this, key)
        }
        return true
      })()
    `)
    await cdp.call('Page.reload', { ignoreCache: true })
    await poll('Crash recovery dismiss prompt', () =>
      cdp.eval(`Boolean(document.querySelector('[role="alertdialog"]'))`),
    )
    assert(
      await cdp.eval(`
        (() => {
          const dialog = document.querySelector('[role="alertdialog"]')
          const dismiss = Array.from(dialog?.querySelectorAll('button') || [])
            .find((button) => /şimdi değil|not now/i.test(button.innerText || ''))
          dismiss?.click()
          return Boolean(dismiss)
        })()
      `),
      'Crash recovery Dismiss butonu bulunamadı.',
    )
    await poll('Crash recovery dismiss closes prompt', () =>
      cdp.eval(`!document.querySelector('[role="alertdialog"]')`),
    )
    assert(
      !(await cdp.eval(`Boolean(document.querySelector('iframe[title="Dismiss Fixture"]'))`)),
      'Dismiss edilen crash session sekmesi açıldı.',
    )

    console.log('✓ Crash recovery Dismiss leaves fixture tabs closed')

    console.log('\nNebula UI/E2E smoke: PASS')
  } finally {
    shuttingDown = true
    cdp?.close()

    if (browser && !browser.killed) {
      browser.kill()
    }

    if (server) {
      await new Promise((resolvePromise) =>
        server.close(resolvePromise),
      )
    }

    if (profileDir) {
      await rm(profileDir, {
        recursive: true,
        force: true,
      }).catch(() => undefined)
    }
  }
}

run().catch((error) => {
  console.error('\nNebula UI/E2E smoke: FAIL')
  console.error(error?.stack || error)
  process.exitCode = 1
})
