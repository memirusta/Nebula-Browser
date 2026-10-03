import { createServer } from 'node:http'
import { readFile, stat, writeFile, mkdir } from 'node:fs/promises'
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
let browserDiagnostics = ''

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

async function buildTabSearchFixture() {
  const [{ build }, { default: react }] = await Promise.all([
    import('vite'),
    import('@vitejs/plugin-react'),
  ])
  const entry = join(root, 'scripts', '__e2e-tab-search-fixture.tsx')
  const source = `
    import { createElement as h, Fragment, useState } from 'react'
    import { createRoot } from 'react-dom/client'
    import { LocaleProvider } from ${JSON.stringify(join(root, 'src/hooks/useLocale.tsx').replaceAll('\\', '/'))}
    import { TabSearch } from ${JSON.stringify(join(root, 'src/components/TabSearch/TabSearch.tsx').replaceAll('\\', '/'))}
    import { SettingsPanel } from ${JSON.stringify(join(root, 'src/components/SettingsPanel/SettingsPanel.tsx').replaceAll('\\', '/'))}
    import { SiteContextMenu } from ${JSON.stringify(join(root, 'src/components/SiteContextMenu/SiteContextMenu.tsx').replaceAll('\\', '/'))}
    import { ExtensionsPanel } from ${JSON.stringify(join(root, 'src/components/ExtensionsPanel/ExtensionsPanel.tsx').replaceAll('\\', '/'))}
    import { SemiLunarMenu } from ${JSON.stringify(join(root, 'src/components/SemiLunarMenu/SemiLunarMenu.tsx').replaceAll('\\', '/'))}
    import { ExtensionInstallControls } from ${JSON.stringify(join(root, 'src/components/SettingsPanel/ExtensionInstallControls.tsx').replaceAll('\\', '/'))}
    import { EXTENSION_CATALOG } from ${JSON.stringify(join(root, 'src/core/extensionCatalog.ts').replaceAll('\\', '/'))}
    import { NEBULA_PASSWORD_SETTINGS_COMMAND_ID } from ${JSON.stringify(join(root, 'src/platform/tauriContextMenu.ts').replaceAll('\\', '/'))}
    import { DEFAULT_NEBULA_SETTINGS } from ${JSON.stringify(join(root, 'src/core/nebulaSettings.ts').replaceAll('\\', '/'))}
    import { DEFAULT_WALLPAPER_CONFIG } from ${JSON.stringify(join(root, 'src/core/wallpaperConfig.ts').replaceAll('\\', '/'))}
    import ${JSON.stringify(join(root, 'src/styles/global.css').replaceAll('\\', '/'))}
    function PasswordFixture() {
      const [menu, setMenu] = useState(true)
      const [open, setOpen] = useState(false)
      const [request, setRequest] = useState(0)
      const noop = () => {}
      return h(Fragment, null,
        h('button', { id: 'fixture-password-menu', onClick: () => setMenu(true) }, 'Password menu'),
        menu && h(SiteContextMenu, {
          request: { id: 'password', tabLabel: 'nebula-tab-test', x: 30, y: 30, items: [{
            commandId: NEBULA_PASSWORD_SETTINGS_COMMAND_ID, name: 'nebula-import-passwords',
            label: 'Native English label', kind: 'command', enabled: true, children: [],
          }] },
          onSelect: command => {
            setMenu(false)
            if (command === NEBULA_PASSWORD_SETTINGS_COMMAND_ID) { setRequest(n => n + 1); setOpen(true) }
          },
        }),
        h(SettingsPanel, { open, passwordSettingsRequest: request, onClose: () => setOpen(false),
          anchor: null, settings: DEFAULT_NEBULA_SETTINGS, wallpaperConfig: DEFAULT_WALLPAPER_CONFIG,
          account: null, notificationSites: [], notificationSitePermissions: {}, shortcutBindings: {},
          onUpdate: noop, onAccountChange: noop, onAccountSignOut: noop, onReopenOnboarding: noop,
        }),
      )
    }
    function ExtensionFixture() {
      const [open, setOpen] = useState(false)
      const [privateTab, setPrivateTab] = useState(false)
      const [settings, setSettings] = useState(false)
      const [request, setRequest] = useState(0)
      const noop = () => {}
      return h(Fragment, null,
        h('button', {id:'fixture-private', onClick:()=>setPrivateTab(value=>!value), style:{position:'absolute',top:600}}, 'Private'),
        h(SemiLunarMenu, {shortcuts:[],dockItemIds:[],folders:[],onCreateFolder:()=>null,onAddToFolder:()=>false,
          onRenameFolder:noop,onNavigate:noop,mode:'browsing',shellViewMode:'browsing',onHomeClick:noop,
          forceOpen:true,extensionsOpen:open,onExtensionsClick:()=>setOpen(value=>!value)}),
        open && h(ExtensionsPanel, {top:140,privateTab,activeUrl:'https://example.com/',onClose:()=>setOpen(false),
          onManage:()=>{setOpen(false);setRequest(value=>value+1);setSettings(true)}}),
        h('div', {id:'fixture-install',style:{position:'absolute',top:650,width:500}},
          h(ExtensionInstallControls, {entry:EXTENSION_CATALOG.find(entry=>entry.id==='bitwarden'),knownStatus:{installed:false,enabled:false}})),
        h(SettingsPanel, {open:settings,extensionsSettingsRequest:request,onClose:()=>setSettings(false),
          anchor:null,settings:DEFAULT_NEBULA_SETTINGS,wallpaperConfig:DEFAULT_WALLPAPER_CONFIG,
          account:null,notificationSites:[],notificationSitePermissions:{},shortcutBindings:{},
          onUpdate:noop,onAccountChange:noop,onAccountSignOut:noop,onReopenOnboarding:noop}),
      )
    }
    function Fixture() {
      const [tabs, setTabs] = useState(() => Array.from({ length: 20 }, (_, i) => ({
        shortcutId: 'list-' + i, title: 'List fixture ' + i,
        url: 'https://example.com/list-' + i, favicon: '', isMuted: false,
      })))
      const [selected, setSelected] = useState('')
      const [open, setOpen] = useState(true)
      return h(Fragment, null,
        h('output', { id: 'fixture-selection' }, selected),
        h('button', { id: 'fixture-open', onClick: () => setOpen(true) }, 'Open'),
        open && h(TabSearch, {
          tabs, activeTabId: 'list-0', onSelect: setSelected,
          onClose: () => setOpen(false),
          onCloseTab: id => setTabs(current => current.filter(tab => tab.shortcutId !== id)),
          onToggleMute: id => setTabs(current => current.map(tab =>
            tab.shortcutId === id ? { ...tab, isMuted: !tab.isMuted } : tab)),
        }),
      )
    }
    createRoot(document.getElementById('root')).render(h(LocaleProvider, null,
      h(location.search.includes('extensions') ? ExtensionFixture : location.search.includes('password') ? PasswordFixture : Fixture)))
  `
  // TabSearch normally lives in the separate Tauri chrome WebView. Bundle the
  // real component in memory rather than pretending its native bridge exists.
  const bundle = await build({
    configFile: false,
    root,
    logLevel: 'silent',
    plugins: [react(), {
      name: 'nebula-tab-search-e2e-fixture',
      // Relative imports are otherwise resolved by Vite's own resolver before
      // this hook runs, which silently bundled the real (non-Tauri) extension
      // host instead of the fixture below.
      enforce: 'pre',
      resolveId(id, importer) {
        if (id === entry) return entry
        if (importer && /(?:ExtensionsPanel|ExtensionInstallControls)\.tsx$/.test(importer)) {
          if (id.endsWith('/platform/extensionDownload')) return '\0extension-host-fixture'
          if (id.endsWith('/platform/runtime')) return '\0extension-runtime-fixture'
        }
      },
      load(id) {
        if (id === entry) return source
        if (id === '\0extension-runtime-fixture') return 'export const isTauri = true'
        if (id === '\0extension-host-fixture') return `
          let items = [
            // Keep these records aligned with InstalledExtension in
            // src/platform/extensionDownload.ts; missing fields silently change
            // which buttons and limitations the real panel renders.
            {id:'dark-reader',enabled:true,version:'4.9.130',iconDataUrl:null,hasPopup:true,hasOptions:true,hasSidePanel:false,primaryView:'popup',runsInProfile:false,requiresNativeApp:false,needsActionHost:false,needsSidePanel:false,isolatedProfile:false,metadataAvailable:true},
            {id:'bitwarden',enabled:true,version:'1.0',iconDataUrl:null,hasPopup:false,hasOptions:false,hasSidePanel:false,primaryView:null,runsInProfile:false,requiresNativeApp:false,needsActionHost:true,needsSidePanel:true,isolatedProfile:true,metadataAvailable:true},
          ];
          window.__extensionActions=[];
          export async function installedExtensions(){return items.map(item=>({...item}))}
          export async function openExtension(id,kind){window.__extensionActions.push({id,action:kind})}
          export async function clickExtension(id){window.__extensionActions.push({id,action:'click'});return {dispatched:true,hasListener:true,openPanelOnActionClick:false,tabId:1,tabUrl:'https://example.com/',sidePanelRequested:false,sidePanelPath:null,error:null}}
          export async function browseWithExtensions(url){window.__extensionActions.push({action:'browse',url})}
          export async function extensionRuntimeVersion(){return '152.0.4191.66'}
          export async function manageExtension(id,action,expectedSha256){
            if(action==='status')return {installed:false,enabled:false};
            window.__extensionActions.push({id,action,expectedSha256});
            if(action==='remove')items=items.filter(item=>item.id!==id);
            else if(action==='enable'||action==='disable')items=items.map(item=>item.id===id?{...item,enabled:action==='enable'}:item);
            return {installed:action!=='remove',enabled:action!=='remove'&&action!=='disable'};
          }
          export async function downloadExtension(id){
            window.__extensionActions.push({id,action:'download'});
            return {path:'C:/fixture/extension.zip',version:'1.0',bytes:100,compatibility:{runtimeVersion:'152.0.4191.66',
              manifest:{manifest_version:3,name:'Fixture',version:'1.0',permissions:['storage','tabs','notifications'],host_permissions:['https://example.com/*'],commands:{toggle:{suggested_key:{default:'Ctrl+E'}}}},
              loadTest:'passed',functionalityTest:'not-run',source:'chrome-web-store-crx',sourceId:'a'.repeat(32),sha256:'b'.repeat(64)}};
          }
        `
      },
    }],
    build: {
      write: false,
      minify: false,
      cssMinify: false,
      rollupOptions: { input: entry, output: { entryFileNames: 'fixture.js' } },
    },
  })
  const files = new Map()
  const stylesheets = []
  for (const output of bundle.output) {
    files.set(`/__e2e-tab-search/${output.fileName}`, output.type === 'chunk' ? output.code : output.source)
    if (output.fileName.endsWith('.css')) stylesheets.push(`<link rel="stylesheet" href="./${output.fileName}">`)
  }
  files.set('/__e2e-tab-search/index.html', `<!doctype html><html><head>${stylesheets.join('')}</head><body><div id="root"></div><script type="module" src="./fixture.js"></script></body></html>`)
  return files
}

async function startStaticServer() {
  assert(
    existsSync(join(distDir, 'index.html')),
    'dist/index.html bulunamadı. Önce npm run build çalıştır.',
  )

  const port = await freePort()
  const tabSearchFixture = await buildTabSearchFixture()

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(
        req.url || '/',
        `http://${req.headers.host || '127.0.0.1'}`,
      )

      let pathname = decodeURIComponent(url.pathname)
      if (pathname === '/') pathname = '/index.html'
      if (tabSearchFixture.has(pathname)) {
        res.writeHead(200, {
          'content-type': mime[extname(pathname)] || 'application/octet-stream',
          'cache-control': 'no-store',
        }).end(tabSearchFixture.get(pathname))
        return
      }

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
      // Chrome 151+ can terminate the headless process when GPU startup is
      // unavailable on a Windows desktop session. The smoke suite exercises
      // application behavior, not GPU composition, so keep the harness on the
      // deterministic software path.
      '--disable-gpu',
      '--disable-software-rasterizer',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      '--host-resolver-rules=MAP example.com 0.0.0.0,MAP example.org 0.0.0.0,MAP example.net 0.0.0.0',
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

    if (process.platform === 'win32') {
      // The managed Windows test host already runs Chrome inside a restricted
      // job. A second nested Chromium sandbox can terminate its GPU/renderer
      // children with STATUS_ACCESS_DENIED. This process loads only the local
      // test server and uses a disposable profile.
      browserArgs.splice(2, 0, '--no-sandbox')
    }

    browser = spawn(browserPath, browserArgs, {
      stdio: ['ignore', 'ignore', 'pipe'],
    })

    browser.stderr?.setEncoding('utf8')
    browser.stderr?.on('data', (chunk) => {
      browserDiagnostics = `${browserDiagnostics}${chunk}`.slice(-12_000)
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
        localStorage.setItem(
          'nebula-browsing-history-v1',
          JSON.stringify({
            version: 1,
            entries: [{
              id: 'e2e-keyboard-confirmation',
              url: 'https://example.com/',
              title: 'Keyboard confirmation fixture',
              host: 'example.com',
              visitedAt: Date.now(),
            }],
          })
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

    // Real keyboard activation must honor the focused confirmation button.
    // This history belongs only to the disposable browser profile above.
    const openClearHistoryConfirmation = async () => {
      const opened = await cdp.eval(`
        (() => {
          const history = document.querySelector(
            '[role="dialog"][aria-labelledby="history-dialog-title"]'
          )
          const clear = [...(history?.querySelectorAll('button') || [])].find(
            (button) => ['Geçmişi temizle', 'Clear history'].includes(button.textContent.trim())
          )
          clear?.focus()
          clear?.click()
          return Boolean(clear)
        })()
      `)
      assert(opened, 'History temizleme düğmesi bulunamadı.')
      await poll('History clear confirmation', () => cdp.eval(`
        Boolean(document.querySelector('[aria-labelledby="nebula-app-dialog-title"]'))
      `))
      await poll('History confirmation initial focus', () => cdp.eval(`
        document.querySelector('[aria-labelledby="nebula-app-dialog-title"] button:last-child') === document.activeElement
      `))
    }
    const pressDialogKey = async (key, windowsVirtualKeyCode, modifiers = 0) => {
      for (const type of ['keyDown', 'keyUp']) {
        await cdp.call('Input.dispatchKeyEvent', {
          type,
          key,
          code: key,
          windowsVirtualKeyCode,
          modifiers,
          // Chromium needs Enter's text to emit keypress and perform native
          // button activation; keyDown alone only exercises JS key handlers.
          ...(key === 'Enter' && type === 'keyDown' ? { text: '\r' } : {}),
        })
      }
    }
    const historyEntryCount = () => cdp.eval(`
      JSON.parse(localStorage.getItem('nebula-browsing-history-v1') || '{"entries":[]}').entries.length
    `)

    await openClearHistoryConfirmation()
    await pressDialogKey('Tab', 9)
    assert(await cdp.eval(`
      document.querySelector('[aria-labelledby="nebula-app-dialog-title"] button:first-child') === document.activeElement
    `), 'Üst onay diyaloğunda Tab İptal düğmesine geçmedi.')
    await pressDialogKey('Tab', 9, 8)
    assert(await cdp.eval(`
      document.querySelector('[aria-labelledby="nebula-app-dialog-title"] button:last-child') === document.activeElement
    `), 'Üst onay diyaloğunda Shift+Tab Onayla düğmesine dönmedi.')
    await pressDialogKey('Tab', 9)
    await pressDialogKey('Enter', 13)
    await poll('Cancel confirmation with Enter', () => cdp.eval(`
      !document.querySelector('[aria-labelledby="nebula-app-dialog-title"]')
    `))
    assert(await historyEntryCount() === 1, 'İptal düğmesine odaklı Enter geçmişi sildi.')

    await openClearHistoryConfirmation()
    await pressDialogKey('Escape', 27)
    await poll('Escape closes only the uppermost confirmation', () => cdp.eval(`
      !document.querySelector('[aria-labelledby="nebula-app-dialog-title"]') &&
      Boolean(document.querySelector('[aria-labelledby="history-dialog-title"]'))
    `))
    assert(await historyEntryCount() === 1, 'Escape ile kapatılan onay geçmişi sildi.')

    await openClearHistoryConfirmation()
    await pressDialogKey('Enter', 13)
    await poll('Confirm history clear with Enter', async () => await historyEntryCount() === 0)
    console.log('✓ Nested confirmation Tab, Shift+Tab, Escape and Enter preserve the chosen action')

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

    assert(await cdp.eval(`(() => {
      const button = [...document.querySelectorAll('[role="dialog"] nav button')]
        .find(el => /Eklentiler|Extensions/.test(el.textContent || ''))
      button?.focus()
      button?.click()
      return Boolean(button)
    })()`), 'Extensions category is missing')
    await poll('Extension catalog', () => cdp.eval(`
      document.querySelectorAll('[data-extension-explorer] article').length === 200
    `))
    if (process.env.NEBULA_E2E_CAPTURE_EXTENSIONS === '1') {
      await sleep(250) // Capture after the settings entrance transition settles.
      const screenshot = await cdp.call('Page.captureScreenshot', { format: 'png' })
      const artifactDir = join(root, 'src-tauri', 'target')
      await mkdir(artifactDir, { recursive: true })
      await writeFile(join(artifactDir, 'nebula-extensions-preview.png'), Buffer.from(screenshot.data, 'base64'))
    }
    assert(await cdp.eval(`(() => {
      const reports = [...document.querySelectorAll('[data-extension-compatibility]')]
      const first = reports[0]
      first?.querySelector('summary')?.click()
      return reports.length === 200 && first?.open && first.querySelectorAll('li').length > 0 &&
        !reports.some(report => /Nebula ile doğrulandı|Verified with Nebula/.test(report.textContent))
    })()`), 'Each extension needs an expandable preflight report without unearned verification')
    await cdp.eval(`document.querySelector('[data-extension-explorer] input').focus()`)
    await cdp.call('Input.insertText', { text: 'dark reader' })
    await poll('Extension text search', () => cdp.eval(`
      document.querySelectorAll('[data-extension-explorer] article').length === 1 &&
      document.querySelector('[data-extension-explorer] article h3')?.textContent === 'Dark Reader'
    `))
    await cdp.eval(`document.querySelector('[data-extension-category="privacy"]').click()`)
    await poll('Extension empty state', () => cdp.eval(`
      document.querySelectorAll('[data-extension-explorer] article').length === 0
    `))
    await cdp.eval(`document.querySelector('[data-extension-explorer] > div:last-child button').click()`)
    await poll('Extension filters reset', () => cdp.eval(`
      document.querySelectorAll('[data-extension-explorer] article').length === 200
    `))
    assert(await cdp.eval(`(() => {
      const links = [...document.querySelectorAll('[data-extension-explorer] article a')]
      return links.length === 200 && links.every(link => {
        const host = new URL(link.href).hostname
        return host === 'chromewebstore.google.com' || ['bitwarden.com', 'darkreader.org', 'sponsor.ajay.app', 'languagetool.org'].includes(host)
      })
    })()`), 'Extension cards must link to a known official or Chrome Web Store page')
    assert(await cdp.eval(`(() => {
      const section = document.querySelector('[data-extension-explorer]')
      const download = section.querySelector('[data-extension-download="sponsorblock"]')
      const install = section.querySelector('[data-extension-install="sponsorblock"]')
      const darkInstall = section.querySelector('[data-extension-install="dark-reader"]')
      const darkDownload = section.querySelector('[data-extension-download="dark-reader"]')
      return section.querySelectorAll('[data-extension-install]').length === 200 &&
        section.querySelectorAll('[data-extension-download]').length === 200 &&
        darkInstall?.disabled === true && darkDownload?.disabled === true &&
        install?.disabled === true && download?.disabled === true &&
        !/Discovery preview|Keşif önizlemesi/.test(section.textContent)
    })()`), 'Extension downloads require the desktop runtime and the preview badge must be removed')
    console.log('✓ Extension discovery search, category filter, empty state and reset')

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


    const shortcutKey = async (key, code, virtualKey, modifiers = 0) => {
      await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key, code,
        windowsVirtualKeyCode: virtualKey, modifiers, ...(key === 'Enter' ? { text: '\r' } : {}) })
      await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key, code,
        windowsVirtualKeyCode: virtualKey, modifiers })
    }
    const focusShell = () => cdp.eval(`
      document.body.tabIndex = -1; document.body.focus(); true
    `)
    await cdp.call('Page.navigate', { url: `${appUrl}__e2e-tab-search/index.html` })
    await cdp.call('Emulation.setDeviceMetricsOverride', {
      width: 900, height: 440, deviceScaleFactor: 1, mobile: false,
    })
    await poll('tab search fixture and initial input focus', () => cdp.eval(`
      document.querySelectorAll('[role="listbox"] [role="option"]').length === 20 &&
      document.querySelector('[role="dialog"] input') === document.activeElement
    `))
    await shortcutKey('ArrowUp', 'ArrowUp', 38)
    await poll('last tab scrolls into short viewport', () => cdp.eval(`
      (() => {
        const list = document.querySelector('[role="listbox"]')
        const selected = list?.querySelector('[aria-selected="true"]')
        if (!list || !selected || !selected.textContent.includes('List fixture 19')) return false
        const l = list.getBoundingClientRect(), r = selected.getBoundingClientRect()
        return list.scrollTop > 0 && r.top >= l.top - 1 && r.bottom <= l.bottom + 1 &&
          l.bottom <= window.innerHeight && l.height > 0
      })()
    `))
    await cdp.eval(`document.querySelector('[role="listbox"] [aria-selected="true"] button:last-child').focus()`)
    await shortcutKey('Enter', 'Enter', 13)
    await poll('native Enter closes only the chosen tab and selection survives', () => cdp.eval(`
      document.querySelectorAll('[role="listbox"] [role="option"]').length === 19 &&
      document.querySelector('[role="listbox"] [aria-selected="true"]')?.textContent.includes('List fixture 18') &&
      document.querySelector('#fixture-selection')?.textContent === ''
    `))
    await cdp.eval(`document.querySelector('[role="dialog"] input').focus()`)
    await shortcutKey('Enter', 'Enter', 13)
    await poll('Enter activates clamped selection', () => cdp.eval(`
      !document.querySelector('[role="listbox"]') &&
      document.querySelector('#fixture-selection')?.textContent === 'list-18'
    `))
    await cdp.eval(`document.querySelector('#fixture-open').click()`)
    await poll('tab search reopens', () => cdp.eval(`Boolean(document.querySelector('[role="listbox"]'))`))
    await cdp.eval(`document.querySelector('[role="option"]').querySelectorAll('button')[1].focus()`)
    await shortcutKey('Enter', 'Enter', 13)
    assert(await cdp.eval(`
      document.querySelector('[role="option"]')?.textContent.includes('🔇') &&
      document.querySelector('#fixture-selection')?.textContent === 'list-18'
    `), 'Mute button Enter switched tabs instead of muting the focused tab.')
    console.log('✓ Tab search short viewport, wrap scrolling, deletion selection and native action buttons')
    await cdp.call('Emulation.clearDeviceMetricsOverride')

    await cdp.call('Page.navigate', { url: `${appUrl}__e2e-tab-search/index.html?password` })
    for (let attempt = 0; attempt < 2; attempt++) {
      await poll('password import context menu', () => cdp.eval(`
        [...document.querySelectorAll('button')].some(button => /Kayıtlı şifreleri kasaya aktar|Import saved passwords to vault/.test(button.textContent))
      `))
      await cdp.eval(`
        [...document.querySelectorAll('button')].find(button => /Kayıtlı şifreleri kasaya aktar|Import saved passwords to vault/.test(button.textContent)).click()
      `)
      await poll('password settings focused and visible', () => cdp.eval(`
        (() => {
          const target = document.querySelector('[data-password-settings]')
          const rect = target?.getBoundingClientRect()
          return target === document.activeElement && rect?.top > 0 && rect.bottom < innerHeight &&
            !!document.querySelector('input[type=file][accept=".csv,text/csv"]')
        })()
      `))
      if (attempt === 0) {
        // Navigate away before reopening: each import request must target the vault again.
        await cdp.eval(`document.querySelector('[role="dialog"] nav button').click()`)
        await shortcutKey('Escape', 'Escape', 27)
        await poll('password settings closed', () => cdp.eval(`!document.querySelector('[role="dialog"]')`))
        await cdp.eval(`document.querySelector('#fixture-password-menu').click()`)
      }
    }
    console.log('✓ Password import menu opens and refocuses the real vault import section')

    await cdp.call('Page.navigate', { url: `${appUrl}__e2e-tab-search/index.html?extensions` })
    await poll('Semi-Lunar extension button', () => cdp.eval(`!!document.querySelector('[data-nebula-extensions-toggle]')`))
    await cdp.eval(`document.querySelector('[data-nebula-extensions-toggle]').click()`)
    await poll('installed extensions panel', () => cdp.eval(`
      document.querySelectorAll('[data-installed-extension]').length === 2
    `))
    // Extensions are just their logo (like Chrome's extensions menu): the name is a
    // tooltip, a click runs the extension and a right click opens the details.
    assert(await cdp.eval(`(() => {
      const tile = document.querySelector('[data-installed-extension="bitwarden"]')
      const button = tile?.querySelector('[data-extension-primary="bitwarden"]')
      return !!button && button.getAttribute('title') === 'Bitwarden' &&
        !document.querySelector('[data-extension-detail]') &&
        tile.getBoundingClientRect().width <= 40 && !/Bitwarden/.test(tile.textContent)
    })()`), 'Installed extensions must be bare logos with the details collapsed')
    // A small box under its button (not a wide window in the middle), sized by
    // how many extensions it holds and kept inside the window.
    assert(await cdp.eval(`(() => {
      const panel = document.querySelector('#nebula-extensions-panel').getBoundingClientRect()
      const button = document.querySelector('[data-nebula-extensions-toggle]').getBoundingClientRect()
      const expectedLeft = Math.min(Math.max(button.left, 12), innerWidth - panel.width - 12)
      return panel.width <= 200 && panel.top >= button.bottom &&
        Math.abs(panel.left - expectedLeft) <= 2 && panel.right <= innerWidth
    })()`), 'The extensions box must be small and sit under its button')
    await cdp.eval(`document.querySelector('[data-extension-primary="bitwarden"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))`)
    await poll('extension details', () => cdp.eval(`
      /trial profile|deneme profili/i.test(document.querySelector('[data-extension-detail="bitwarden"]')?.textContent || '')
    `))
    // An action without a popup now has a real entry point: Nebula emulates the
    // toolbar click. It is labelled Beta with the activeTab caveat, and the old
    // "WebView2 does not expose this" limitation text is gone for it.
    assert(await cdp.eval(`(() => {
      const item = document.querySelector('[data-extension-detail="bitwarden"]')
      const text = item?.textContent || ''
      return !!item?.querySelector('[data-extension-click="bitwarden"]') &&
        /emulates this extension|taklit eder/.test(text) &&
        !/does not expose this extension|araç çubuğu tıklaması WebView2/.test(text)
    })()`), 'An action-only extension must offer the Beta toolbar click with its caveat')
    await cdp.eval(`document.querySelector('[data-extension-click="bitwarden"]').click()`)
    await poll('toolbar click reaches the host', () => cdp.eval(`window.__extensionActions.some(item => item.id === 'bitwarden' && item.action === 'click')`))
    // Clicking an icon does what the toolbar icon does: dark-reader has a popup.
    await cdp.eval(`document.querySelector('[data-extension-primary="dark-reader"]').click()`)
    await poll('extension popup action', () => cdp.eval(`window.__extensionActions.some(item => item.id === 'dark-reader' && item.action === 'popup')`))
    await cdp.eval(`document.querySelector('#nebula-extensions-panel [data-extensions-manage]').click()`)
    await poll('extension manage opens settings category', () => cdp.eval(`
      document.querySelector('[data-extension-explorer]') && !document.querySelector('#nebula-extensions-panel')
    `))
    await shortcutKey('Escape', 'Escape', 27)
    await cdp.eval(`document.querySelector('[data-extension-install="bitwarden"]').click()`)
    await poll('generic install review', () => cdp.eval(`
      document.querySelector('[data-extension-review="bitwarden"]')?.textContent.includes('storage') &&
      window.__extensionActions.some(item => item.id === 'bitwarden' && item.action === 'download')
    `))
    // The review names what will not work, before anything is installed.
    assert(await cdp.eval(`(() => {
      const review = document.querySelector('[data-extension-review="bitwarden"]')
      const heading = review?.querySelector('[data-extension-gaps="bitwarden"]')
      const list = heading?.nextElementSibling?.textContent || ''
      return !!heading && /notifications/.test(list) && /Toggle|toggle/.test(list) && /not (?:supported|shown)|desteklenmiyor|gösterilmiyor/.test(list)
    })()`), 'The install review must list the features that do not work yet')
    const installReview = await cdp.eval(`(() => {
      const review = document.querySelector('[data-extension-review="bitwarden"]')
      const install = [...review.querySelectorAll('button')].find(button => /Install|Kur/.test(button.textContent))
      install.click()
      return true
    })()`)
    assert(installReview, 'Generic package review did not offer installation')
    await poll('review digest reaches install', () => cdp.eval(`
      window.__extensionActions.some(item => item.id === 'bitwarden' && item.action === 'install' && item.expectedSha256 === 'b'.repeat(64))
    `))
    await cdp.eval(`document.querySelector('[data-nebula-extensions-toggle]').click()`)
    await cdp.eval(`document.querySelector('#fixture-private').click()`)
    await poll('private extension restriction', () => cdp.eval(`
      /unavailable in private tabs|özel sekmelerde kullanılamaz/.test(document.querySelector('#nebula-extensions-panel')?.textContent || '')
    `))
    console.log('✓ Semi-Lunar extension menu, trial-profile disclosure, management route, reviewed install and private restriction')

    // Restore normal tabs while the preference for NEW tabs is private.
    const seeded = await cdp.call('Page.addScriptToEvaluateOnNewDocument', { source: `
      (() => {
        const settings = JSON.parse(localStorage.getItem('nebula-settings-v1') || '{}')
        settings.browsing = { ...settings.browsing, restoreTabsOnStartup: true }
        settings.privacy = { ...settings.privacy, privateMode: true }
        localStorage.setItem('nebula-settings-v1', JSON.stringify(settings))
        localStorage.removeItem('nebula-browser-run-state-v1')
        localStorage.removeItem('nebula-current-browser-session-v1')
        localStorage.setItem('nebula-current-browser-session-v2', JSON.stringify({
          schemaVersion: 2, id: 'remaining-bugs-fixture', savedAt: Date.now(),
          windows: [{ windowId: 'main', activeTabId: 'list-0',
            tabs: Array.from({ length: 20 }, (_, i) => ({
              tabId: 'list-' + i, shortcutId: 'list-' + i,
              title: 'List fixture ' + i, url: 'https://example.com/list-' + i, favicon: '',
            })),
          }],
        }))
      })()
    ` })
    await cdp.call('Page.navigate', { url: appUrl })
    await poll('normal tabs restore with private default', () => cdp.eval(`
      Boolean(document.querySelector('iframe[src*="/list-0"]'))
    `))
    await cdp.call('Page.removeScriptToEvaluateOnNewDocument', { identifier: seeded.identifier })

    await focusShell()
    await shortcutKey('t', 'KeyT', 84, 2)
    await poll('Home search for private navigation', () => cdp.eval(`
      (() => {
        const input = document.querySelector('[data-nebula-tutorial="home-search"] input')
        if (!input || input.getBoundingClientRect().width === 0) return false
        input.focus()
        return true
      })()
    `))
    await cdp.call('Input.insertText', { text: 'https://example.com/secret-private?token=nebula-private-fixture' })
    await shortcutKey('Enter', 'Enter', 13)
    await poll('private page opens', () => cdp.eval(`
      Boolean(document.querySelector('iframe[src*="secret-private"]'))
    `))
    const noPrivateStorage = () => cdp.eval(`
      !Object.values(localStorage).some(value => value.includes('secret-private') || value.includes('nebula-private-fixture'))
    `)
    assert(await noPrivateStorage(), 'A new private tab wrote its URL to localStorage.')
    await cdp.eval(`
      (() => {
        const settings = JSON.parse(localStorage.getItem('nebula-settings-v1'))
        settings.privacy.privateMode = false
        localStorage.setItem('nebula-settings-v1', JSON.stringify(settings))
        window.dispatchEvent(new StorageEvent('storage', { key: 'nebula-settings-v1' }))
        return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))
      })()
    `)
    await focusShell()
    await shortcutKey('w', 'KeyW', 87, 2)
    await poll('private tab closes after preference change', () => cdp.eval(`
      !document.querySelector('iframe[src*="secret-private"]')
    `))
    assert(await noPrivateStorage(), 'Closing an existing private tab after mode change persisted its data.')
    assert(await cdp.eval(`
      JSON.parse(localStorage.getItem('nebula-current-browser-session-v2')).windows[0].tabs.length === 20
    `), 'Normal session tabs were lost while private tabs were filtered.')
    console.log('✓ Private tab history/session/close stay private across a mode change; normal tabs remain')

    await focusShell()
    await shortcutKey('t', 'KeyT', 84, 2)
    await poll('Home for extension settings', () => cdp.eval(`!!document.querySelector('[data-nebula-tutorial="home-search"] input')`))
    await cdp.eval(`(() => {
      const button = [...document.querySelectorAll('button')].find(el => ['Ayarlar', 'Settings'].includes(el.getAttribute('aria-label')))
      button?.focus(); button?.click()
    })()`)
    await poll('Settings for extension navigation', () => cdp.eval(`!!document.querySelector('[role="dialog"] nav')`))
    await cdp.eval(`(() => {
      const button = [...document.querySelectorAll('[role="dialog"] nav button')].find(el => /Eklentiler|Extensions/.test(el.textContent || ''))
      button?.focus(); button?.click()
    })()`)
    await poll('Extension website link', () => cdp.eval(`!!document.querySelector('[data-extension-explorer] article a')`))
    await cdp.eval(`(() => {
      const card = [...document.querySelectorAll('[data-extension-explorer] article')]
        .find(article => article.querySelector('h3')?.textContent === 'Bitwarden')
      card?.querySelector('a')?.click()
    })()`)
    await poll('Extension website activates and closes settings', () => cdp.eval(`
      !document.querySelector('[data-extension-explorer]') &&
      !!document.querySelector('iframe[src^="https://bitwarden.com/download/"]')
    `))
    console.log('✓ Extension website opens in the foreground and closes Settings')

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
  if (browserDiagnostics.trim()) {
    console.error('\nBrowser diagnostics:')
    console.error(browserDiagnostics.trim())
  }
  process.exitCode = 1
})
