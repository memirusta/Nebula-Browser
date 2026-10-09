// Runs the cookie banner shield (the "site protection" script in src-tauri/src/webview_privacy.rs) in a real
// Chromium on small pages: real consent banners must be hidden, and ordinary dialogs of a site (a product
// detail window with an option called "Cookie", a footer link to a privacy page, "izleme" in a menu...) must
// stay. The shield reads the script straight from the Rust source.
//
//   NEBULA_E2E_BROWSER=<chrome.exe> node scripts/cookie-shield-live.mjs [--git <rev>]
//
// With --git the script of that revision is used instead of the working tree's (to see the old behaviour).
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { Cdp } from './e2e-cdp.mjs'

const browser = process.env.NEBULA_E2E_BROWSER
if (!browser) {
  console.error('set NEBULA_E2E_BROWSER to a Chrome/Edge executable')
  process.exit(2)
}
const gitIndex = process.argv.indexOf('--git')
const source = gitIndex > 0
  ? spawnSync('git', ['show', `${process.argv[gitIndex + 1]}:src-tauri/src/webview_privacy.rs`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout
  : readFileSync(new URL('../src-tauri/src/webview_privacy.rs', import.meta.url), 'utf8')
const start = source.indexOf('r#"(() => {')
const end = source.indexOf('})();"#;', start)
if (start < 0 || end < 0) throw new Error('the shield script was not found in webview_privacy.rs')
const shield = source.slice(start + 3, end + '})();'.length).replace('__NEBULA_COOKIE_SHIELD_ENABLED__', 'true')

const profile = mkdtempSync(join(tmpdir(), 'nebula-shield-'))
const chrome = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`)
}

const bigList = Array.from({ length: 14 }, (_, i) => `<li>Option ${i + 1}</li>`).join('')
const dialog = (inner, extra = '') =>
  `<div id="sut" role="dialog" aria-modal="true" style="position:fixed;left:200px;top:60px;width:600px;height:640px;background:#111;color:#fff;${extra}">${inner}</div>`
/** Each case: the markup, and whether the shield must hide #sut (true) or leave it (false). */
const cases = [
  // Real consent surfaces: hidden.
  ['a known banner id', true, `<div id="cookie-banner" style="position:fixed;bottom:0;left:0;right:0;height:90px">We use cookies. <button>Accept all</button></div>`],
  ['a dialog headed with the word cookies', true, dialog(`<h2>This site uses cookies</h2><p>We and our partners store and access information on your device.</p><button>Accept</button><button>Settings</button>`)],
  ['a Turkish consent dialog', true, dialog(`<h2>Çerez tercihleriniz</h2><p>Sitemizde deneyiminizi iyileştirmek için çerezler kullanıyoruz.</p><button>Kabul et</button><button>Reddet</button>`)],
  ['a compact privacy notice with preferences', true, `<div id="sut" style="position:fixed;bottom:10px;left:100px;width:600px;height:120px;background:#222;color:#fff"><p>We value your privacy and use tracking technologies. <a href="#">Manage preferences</a></p><button>Accept</button><button>Settings</button></div>`],
  ['a dialog whose id says consent', true, dialog(`<p>Choose what you want to share.</p><button>Continue</button>`).replace('id="sut"', 'id="sut" data-x="1"').replace('role="dialog"', 'role="dialog" aria-label="Cookie consent"')],
  ['a banner that mentions cookies on its second line', true, dialog(`<h2>Hoş geldiniz</h2><p>Sitemiz çerez kullanır.</p><button>Kabul et</button>`)],
  ['a banner that talks about cookies several times in a long text', true, dialog(`<h2>Notice</h2><p>${'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(6)}</p><p>Çerezler hakkında bilgi, çerez politikası ve çerez tercihleri.</p><button>Kabul et</button>`)],
  // Ordinary dialogs of a site: left alone.
  ['a product dialog with a side option called Cookie', false, dialog(`<h2>Ürün Detayları</h2><p>440 TL</p><p>1. Sandviç Seçimi</p><select><option>Tavukburger</option><option>Cookie</option></select><p>Malzemeler: lütfen çıkarmak istediğiniz malzemeleri seçiniz</p><ul>${bigList}</ul><button>Hızlı Sipariş</button><button>Sepete Ekle</button>`)],
  ['a product dialog that mentions order tracking (izleme) once', false, dialog(`<h2>Ürün Detayları</h2><p>1. Sandviç Seçimi</p><ul>${bigList}</ul><p>Sipariş izleme için hesabınıza giriş yapın.</p><button>Sepete Ekle</button>`)],
  ['a dialog with a privacy policy link in its footer', false, dialog(`<h2>Sepetiniz</h2><ul>${bigList}</ul><p>Toplam 390 TL</p><button>Siparişi tamamla</button><a href="#">Gizlilik Politikası</a>`)],
  ['a dialog with Continue and Settings buttons and the word cookie deep inside', false, dialog(`<h2>Profil ayarları</h2><ul>${bigList}</ul><p>${'Ayarlarınızı buradan değiştirebilirsiniz. '.repeat(8)} Favori tatlı: cookie.</p><button>Continue</button><button>Settings</button>`)],
]

try {
  let port = 0
  for (let i = 0; i < 60 && !port; i += 1) {
    await sleep(250)
    const file = join(profile, 'DevToolsActivePort')
    if (existsSync(file)) port = Number.parseInt(readFileSync(file, 'utf8'), 10)
  }
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const page = targets.find((target) => target.type === 'page')
  const cdp = new Cdp(page.webSocketDebuggerUrl, { callTimeoutMs: 30_000 })
  await cdp.open()
  const run = async (expression) => {
    const r = await cdp.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
    return r.result.value
  }
  await cdp.call('Page.enable')
  for (const [name, mustHide, markup] of cases) {
    await cdp.call('Page.navigate', { url: 'about:blank' })
    await sleep(300)
    await run(shield)
    await run(`document.body.style.margin = '0'; document.body.innerHTML = ${JSON.stringify(markup.replace('id="cookie-banner"', 'id="cookie-banner" id-x="1"'))}; true`)
    await sleep(1200)
    const reason = await run(`document.getElementById('sut')?.getAttribute('data-nebula-cookie-reason') ?? null`)
    const hidden = await run(`(() => { const e = document.getElementById('sut') || document.getElementById('cookie-banner'); return !e || getComputedStyle(e).display === 'none' })()`)
    check(`${mustHide ? 'hidden' : 'left alone'}: ${name}`, hidden === mustHide, hidden ? `it was hidden (${reason})` : 'it stayed visible')
  }
  cdp.ws.close()
} catch (error) {
  check('the run completed', false, String(error?.message ?? error))
} finally {
  chrome.kill()
  await sleep(500)
  rmSync(profile, { recursive: true, force: true })
}
const failed = results.filter((r) => !r.ok)
console.log(failed.length === 0 ? `\nALL CHECKS PASSED (${results.length})` : `\n${failed.length} of ${results.length} CHECK(S) FAILED`)
process.exit(failed.length === 0 ? 0 : 1)
