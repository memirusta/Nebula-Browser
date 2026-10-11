// Runs the Instagram message extractor (the page script in src-tauri/src/site_ui.rs) in a real Chromium on a
// small page that looks like a direct-message thread, and prints what it would report for each new message:
// a plain message, a message right after another one, a real reply (a quoted message inside the bubble)...
//
//   NEBULA_E2E_BROWSER=<chrome.exe> node scripts/instagram-reply-live.mjs [--git <rev>]
//
// The page is served as www.instagram.com (the browser is told to resolve that name to this machine) under
// /direct/t/1/, because the script only wakes up there.
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
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
  ? spawnSync('git', ['show', `${process.argv[gitIndex + 1]}:src-tauri/src/site_ui.rs`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout
  : readFileSync(new URL('../src-tauri/src/site_ui.rs', import.meta.url), 'utf8')
const start = source.indexOf('PROTOCOL_HANDLER_BRIDGE_SCRIPT: &str = r#"')
const end = source.indexOf('"#;', start)
if (start < 0 || end < 0) throw new Error('the page script was not found in site_ui.rs')
const script = source.slice(start + 'PROTOCOL_HANDLER_BRIDGE_SCRIPT: &str = r#"'.length, end)

const html = `<!doctype html><meta charset="utf-8"><title>Direct</title>
<body style="margin:0;font:14px sans-serif">
<main style="position:relative;width:900px;height:700px">
  <h2 style="margin:0;height:56px;line-height:56px;padding-left:20px">Nebula Friend</h2>
  <div id="thread" style="position:absolute;left:0;right:0;top:64px;bottom:90px;overflow:hidden"></div>
  <div contenteditable="true" role="textbox" style="position:absolute;left:20px;right:20px;bottom:20px;height:44px;border:1px solid #888"></div>
</main></body>`

const server = createServer((request, response) => {
  response.setHeader('content-type', 'text/html')
  response.end(html)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port

const profile = mkdtempSync(join(tmpdir(), 'nebula-ig-'))
const chrome = spawn(browser, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--window-size=1000,800', `--host-resolver-rules=MAP www.instagram.com 127.0.0.1`, 'about:blank',
], { stdio: 'ignore' })

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`)
}

try {
  let debugPort = 0
  for (let i = 0; i < 60 && !debugPort; i += 1) {
    await sleep(250)
    const file = join(profile, 'DevToolsActivePort')
    if (existsSync(file)) debugPort = Number.parseInt(readFileSync(file, 'utf8'), 10)
  }
  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()
  const page = targets.find((target) => target.type === 'page')
  const cdp = new Cdp(page.webSocketDebuggerUrl, { callTimeoutMs: 30_000 })
  await cdp.open()
  const run = async (expression) => {
    const r = await cdp.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
    return r.result.value
  }
  await cdp.call('Page.enable')
  // The stub is in place before any page script runs.
  await cdp.call('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__posts = []; window.chrome = { webview: { postMessage: (m) => window.__posts.push(m), addEventListener() {}, removeEventListener() {} } };`,
  })
  await cdp.call('Page.navigate', { url: `http://www.instagram.com:${port}/direct/t/1/` })
  await sleep(1500)
  await run(script)
  await sleep(2600)

  let top = 0
  const openAnotherThread = async () => {
    await run(`history.pushState({}, '', '/direct/t/' + Date.now() + '/')`)
  }
  /** Adds an incoming message (left side) and returns what was reported for it. */
  async function incoming(text, { gap = 6, quoted = null, hiddenReplyWord = false, labelLine = null, quotedSameSize = false, reset = false } = {}) {
    if (reset) {
      await openAnotherThread()
      await run(`document.getElementById('thread').innerHTML = ''`)
      top = 0
      await sleep(2300)
    }
    await run(`window.__posts.length = 0`)
    top += gap
    const label = labelLine ? `<div dir="auto" style="font-size:11px">${labelLine}</div>` : ''
    const quote = quoted
      ? `<div dir="auto" style="font-size:${quotedSameSize ? 14 : 12}px;opacity:.7;border-left:3px solid #aaa;padding-left:6px">${quoted}</div>`
      : ''
    const hidden = hiddenReplyWord ? `<span style="position:absolute;left:-9999px">Reply</span>` : ''
    await run(`(() => {
      const row = document.createElement('div')
      row.style.cssText = 'position:absolute;left:20px;top:${top}px;max-width:400px;background:#eee;padding:8px 12px;border-radius:16px'
      row.innerHTML = ${JSON.stringify(`${label}${quote}<div><div dir="auto">${text}</div></div>${hidden}`)}
      document.getElementById('thread').appendChild(row)
    })()`)
    await sleep(1200)
    const posts = JSON.parse(await run(`JSON.stringify(window.__posts)`))
    const parsed = posts.map((entry) => JSON.parse(entry)).filter((entry) => entry.type === 'nebula-site-notification-content')
    top += await run(`document.getElementById('thread').lastElementChild.getBoundingClientRect().height`)
    return parsed.at(-1) ?? null
  }

  const first = await incoming('Merhaba, nasılsın?')
  check('a first message is reported as a plain message', first?.eventKind === 'message', first ? `${first.eventKind}: ${first.body}` : 'nothing reported')
  const second = await incoming('Bugün akşam müsait misin')
  check('a second message right below the first is a plain message, not a reply', second?.eventKind === 'message', second ? `${second.eventKind}: ${second.body}` : 'nothing reported')
  const third = await incoming('Film izlemeye gidelim mi')
  check('a third message in a row is a plain message', third?.eventKind === 'message', third ? `${third.eventKind}: ${third.body}` : 'nothing reported')
  const far = await incoming('Tamam görüşürüz', { gap: 120 })
  check('a message well below the previous ones is a plain message', far?.eventKind === 'message', far ? `${far.eventKind}: ${far.body}` : 'nothing reported')
  const word = await incoming('Bana cevap ver lütfen')
  check('a message that only contains the word "cevap" is a plain message', word?.eventKind === 'message', word ? `${word.eventKind}: ${word.body}` : 'nothing reported')
  const hidden = await incoming('Bu mesajın yanında gizli bir Reply düğmesi var', { hiddenReplyWord: true })
  check('a message next to a hidden "Reply" action label is a plain message', hidden?.eventKind === 'message', hidden ? `${hidden.eventKind}: ${hidden.body}` : 'nothing reported')
  const reply = await incoming('Evet gidelim', { gap: 140, quoted: 'Film izlemeye gidelim mi' })
  check('a message that quotes another message inside its bubble is a reply', reply?.eventKind === 'reply', reply ? `${reply.eventKind}: ${reply.body}` : 'nothing reported')
  // Consecutive messages of one sender share a group container, as in Instagram's own layout.
  await openAnotherThread()
  await run(`document.getElementById('thread').innerHTML = '<div id="group" style="position:absolute;left:20px;top:10px;width:420px"></div>'`)
  await sleep(2300)
  const grouped = async (text) => {
    await run(`window.__posts.length = 0`)
    await run(`(() => { const row = document.createElement('div'); row.style.cssText = 'margin-top:2px;background:#eee;padding:8px 12px;border-radius:16px;width:max-content;max-width:400px'; row.innerHTML = '<div><div dir="auto">' + ${JSON.stringify(text)} + '</div></div>'; document.getElementById('group').appendChild(row) })()`)
    await sleep(1200)
    const posts = JSON.parse(await run(`JSON.stringify(window.__posts)`)).map((entry) => JSON.parse(entry)).filter((entry) => entry.type === 'nebula-site-notification-content')
    return posts.at(-1) ?? null
  }
  const g1 = await grouped('Selam')
  const g2 = await grouped('Bugün ne yapıyorsun')
  const g3 = await grouped('Haber ver bana')
  check('messages of one sender grouped together: the first is a plain message', g1?.eventKind === 'message', g1 ? `${g1.eventKind}` : 'nothing reported')
  check('the second message in the same group is a plain message, not a reply', g2?.eventKind === 'message', g2 ? `${g2.eventKind}: ${g2.body}` : 'nothing reported')
  check('the third message in the same group is a plain message, not a reply', g3?.eventKind === 'message', g3 ? `${g3.eventKind}: ${g3.body}` : 'nothing reported')
  // Instagram's own look of a reply: a small "<icon> replied to you" line (not a message node), a dim quoted
  // bubble set at the same size as the message, then the message itself.
  const custom = async (html) => {
    await openAnotherThread()
    await run(`document.getElementById('thread').innerHTML = '<div id="group" style="position:absolute;left:20px;top:10px;width:420px"></div>'`)
    await sleep(2300)
    await run(`window.__posts.length = 0`)
    await run(`document.getElementById('group').insertAdjacentHTML('beforeend', ${JSON.stringify(html)})`)
    await sleep(1400)
    const posts = JSON.parse(await run(`JSON.stringify(window.__posts)`)).map((entry) => JSON.parse(entry)).filter((entry) => entry.type === 'nebula-site-notification-content')
    return posts.at(-1) ?? null
  }
  const bubble = 'margin-top:2px;background:#eee;padding:8px 12px;border-radius:16px;width:max-content;max-width:400px'
  const realReply = await custom(`<div style="margin-top:6px"><div style="font-size:12px;color:#888"><svg width="10" height="10"><circle cx="5" cy="5" r="4"/></svg> <span>replied to you</span></div><div style="background:#335;color:#aab;padding:6px 10px;border-radius:12px;width:max-content"><div dir="auto" style="font-size:14px">az bir mesajımı replylasana</div></div><div style="${bubble}"><div dir="auto" style="font-size:14px">.</div></div></div>`)
  check('a reply as Instagram draws it (small label line, quoted bubble at the same size) is a reply', realReply?.eventKind === 'reply', realReply ? `${realReply.eventKind}: ${realReply.body}` : 'nothing reported')
  // The label can carry the sender's name and be set at the size of the message itself.
  const namedLabel = await custom(`<div style="margin-top:6px"><div style="font-size:14px"><span>Mehmet Emir USTA replied to you</span></div><div style="background:#335;color:#aab;padding:6px 10px;border-radius:12px;width:max-content"><div dir="auto" style="font-size:14px">asdads</div></div><div style="${bubble}"><div dir="auto" style="font-size:14px">!</div></div></div>`)
  check('a reply whose label names the sender and is the size of the message is a reply', namedLabel?.eventKind === 'reply', namedLabel ? `${namedLabel.eventKind}: ${namedLabel.body}` : 'nothing reported')
  const saidReplied = await custom(`<div style="${bubble}"><div dir="auto" style="font-size:14px">dün ona replied dedim</div></div><div style="${bubble}"><div dir="auto" style="font-size:14px">neyse</div></div>`)
  check('a message after one that says "replied" in its own words (same size) is a plain message', saidReplied?.eventKind === 'message', saidReplied ? `${saidReplied.eventKind}: ${saidReplied.body}` : 'nothing reported')
  // Old messages must not come back as notifications.
  const collect = async () => JSON.parse(await run(`JSON.stringify(window.__posts)`)).map((entry) => JSON.parse(entry)).filter((entry) => entry.type === 'nebula-site-notification-content')
  const rowHtml = (text) => `<div style="margin-top:2px;background:#eee;padding:8px 12px;border-radius:16px;width:max-content;max-width:400px"><div><div dir="auto">${text}</div></div></div>`
  const texts = ['Birinci eski mesaj', 'İkinci eski mesaj', 'Üçüncü eski mesaj']
  await openAnotherThread()
  await run(`document.getElementById('thread').innerHTML = '<div id="group" style="position:absolute;left:20px;top:80px;width:420px"></div>'`)
  await run(`document.getElementById('group').innerHTML = ${JSON.stringify(texts.map(rowHtml).join(''))}`)
  await sleep(2500)
  await run(`window.__posts.length = 0`)
  // 1. Instagram draws the group again when a new message arrives: every old message is a new element.
  await run(`document.getElementById('group').innerHTML = ${JSON.stringify([...texts, 'Yeni gelen mesaj'].map(rowHtml).join(''))}`)
  await sleep(1500)
  const redrawn = await collect()
  check('when the group is drawn again, only the new message is reported, not the old ones', redrawn.length === 1 && redrawn[0].body === 'Yeni gelen mesaj', JSON.stringify(redrawn.map((entry) => entry.body)))
  // 1b. Drawn again with nothing new (a reaction, a read receipt...) a while later: the last old message must not come back.
  await sleep(6000)
  await run(`window.__posts.length = 0`)
  await run(`document.getElementById('group').innerHTML = ${JSON.stringify([...texts, 'Yeni gelen mesaj'].map(rowHtml).join(''))}`)
  await sleep(1500)
  const same = await collect()
  check('drawn again with nothing new, no old message is reported', same.length === 0, JSON.stringify(same.map((entry) => entry.body)))
  const diagnostics = JSON.parse(await run(`JSON.stringify(window.__posts)`)).map((entry) => JSON.parse(entry)).filter((entry) => entry.type === 'nebula-site-notification-diagnostic')
  check('and the reason it was not reported is said, without any message in it', diagnostics.length >= 1 && diagnostics.every((entry) => entry.reason === 'not-new' && Object.keys(entry).sort().join() === 'detail,origin,reason,type' && entry.detail === ''), JSON.stringify(diagnostics))
  // 2. Older messages are loaded above the existing ones.
  await run(`window.__posts.length = 0`)
  await run(`document.getElementById('group').insertAdjacentHTML('afterbegin', ${JSON.stringify(['Çok eski bir mesaj', 'Daha da eski bir mesaj'].map(rowHtml).join(''))})`)
  await sleep(1500)
  const older = await collect()
  check('older messages loaded above the thread are not reported', older.length === 0, JSON.stringify(older.map((entry) => entry.body)))
  // 3. Another conversation is opened: all of its messages appear at once.
  await run(`window.__posts.length = 0`)
  await run(`history.pushState({}, '', '/direct/t/2/')`)
  await run(`document.getElementById('group').innerHTML = ${JSON.stringify(['Başka sohbet bir', 'Başka sohbet iki', 'Başka sohbet üç'].map(rowHtml).join(''))}`)
  await sleep(1500)
  const switched = await collect()
  check('opening another conversation does not report its existing messages', switched.length === 0, JSON.stringify(switched.map((entry) => entry.body)))
  // 4. A real new message in that conversation, once it has settled, is still reported.
  await sleep(1500)
  await run(`window.__posts.length = 0`)
  await run(`document.getElementById('group').insertAdjacentHTML('beforeend', ${JSON.stringify(rowHtml('Gerçekten yeni mesaj'))})`)
  await sleep(1500)
  const fresh = await collect()
  check('a new message in that conversation is reported', fresh.length === 1 && fresh[0].body === 'Gerçekten yeni mesaj', JSON.stringify(fresh.map((entry) => entry.body)))
  // A long thread that scrolls: messages are appended below and the oldest ones leave the top, and the same
  // short text ("." ) comes again after a while.
  await run(`history.pushState({}, '', '/direct/t/3/')`)
  await run(`document.getElementById('thread').style.overflowY = 'auto'; document.getElementById('thread').innerHTML = '<div id="flow" style="padding:6px 20px"></div>'`)
  const flowRow = (text, mine = false) => `<div style="margin-top:6px;display:flex;${mine ? 'justify-content:flex-end' : ''}"><div style="background:${mine ? '#46f' : '#eee'};padding:8px 12px;border-radius:16px;width:max-content;max-width:400px"><div dir="auto">${text}</div></div></div>`
  await run(`document.getElementById('flow').innerHTML = ${JSON.stringify(Array.from({ length: 16 }, (_, i) => flowRow('Eski mesaj ' + (i + 1), i % 3 === 0)).join(''))}; document.getElementById('thread').scrollTop = 99999`)
  await sleep(2600)
  const append = async (text, mine = false) => {
    await run(`window.__posts.length = 0`)
    await run(`document.getElementById('flow').insertAdjacentHTML('beforeend', ${JSON.stringify(flowRow(text, mine))}); document.getElementById('thread').scrollTop = 99999`)
    await sleep(1500)
    return (await collect()).at(-1) ?? null
  }
  const dot1 = await append('.')
  check('in a long scrolling thread a new "." is reported', dot1?.body === '.', JSON.stringify(dot1?.body))
  await append('Ben cevap yazdım', true)
  await append('ATTIM')
  await sleep(5500)
  const dot2 = await append('.')
  check('the same short text again later (after other messages, the list scrolled) is reported too', dot2?.body === '.', JSON.stringify(dot2?.body))
  await sleep(5500)
  const dot3 = await append('.')
  check('and once more right after, with the same text as the last message', dot3?.body === '.', JSON.stringify(dot3?.body))
  // Instagram keeps a right-aligned status line ("Seen just now") at the very end of the thread: after the
  // last message, whoever wrote it.
  await run(`history.pushState({}, '', '/direct/t/5/')`)
  await run(`document.getElementById('flow').innerHTML = ${JSON.stringify(Array.from({ length: 8 }, (_, i) => flowRow('Mesaj ' + (i + 1), i % 2 === 0)).join(''))}; document.getElementById('thread').scrollTop = 99999`)
  await sleep(2600)
  const statusLine = `<div id="status" style="margin-top:6px;text-align:right;font-size:11px"><span dir="auto">Seen just now</span></div>`
  const appendWithStatus = async (text, mine = false) => {
    await run(`window.__posts.length = 0`)
    await run(`(() => { const flow = document.getElementById('flow'); const old = document.getElementById('status'); if (old) old.remove(); flow.insertAdjacentHTML('beforeend', ${JSON.stringify(flowRow(text, mine))}); flow.insertAdjacentHTML('beforeend', ${JSON.stringify(statusLine)}); document.getElementById('thread').scrollTop = 99999 })()`)
    await sleep(1500)
    return (await collect()).at(-1) ?? null
  }
  await appendWithStatus('Ben yazdım', true)
  const withStatus = await appendWithStatus('Tm')
  check('a new message is reported when a "Seen just now" line sits below it', withStatus?.body === 'Tm', JSON.stringify(withStatus?.body))
  const replyStatus = await appendWithStatus('.')
  check('and the next one, a "." right after, too', replyStatus?.body === '.', JSON.stringify(replyStatus?.body))
  // A friend spams the same short message, and answers the same quoted message again and again.
  await run(`history.pushState({}, '', '/direct/t/6/')`)
  await run(`document.getElementById('flow').innerHTML = ${JSON.stringify(Array.from({ length: 6 }, (_, i) => flowRow('Mesaj ' + (i + 1), i % 2 === 0)).join(''))}; document.getElementById('thread').scrollTop = 99999`)
  await sleep(2600)
  await run(`window.__posts.length = 0`)
  for (let i = 0; i < 6; i += 1) {
    await run(`(() => { const flow = document.getElementById('flow'); const old = document.getElementById('status'); if (old) old.remove(); flow.insertAdjacentHTML('beforeend', ${JSON.stringify(flowRow('.'))}); flow.insertAdjacentHTML('beforeend', ${JSON.stringify(statusLine)}); document.getElementById('thread').scrollTop = 99999 })()`)
    await sleep(1300)
  }
  await sleep(800)
  const spam = await collect()
  check('six "." messages 1.3 s apart are reported as six messages', spam.length === 6, String(spam.length))
  await run(`window.__posts.length = 0`)
  const replyRow = () => `<div style="margin-top:8px"><div style="font-size:12px;color:#888"><svg width="10" height="10"><circle cx="5" cy="5" r="4"/></svg> <span>replied to you</span></div><div style="background:#335;color:#aab;padding:6px 10px;border-radius:12px;width:max-content"><div dir="auto" style="font-size:14px">Bir daha</div></div><div style="margin-top:2px;background:#eee;padding:8px 12px;border-radius:16px;width:max-content"><div dir="auto" style="font-size:14px">.</div></div></div>`
  for (let i = 0; i < 3; i += 1) {
    await run(`(() => { const flow = document.getElementById('flow'); const old = document.getElementById('status'); if (old) old.remove(); flow.insertAdjacentHTML('beforeend', ${JSON.stringify(replyRow())}); flow.insertAdjacentHTML('beforeend', ${JSON.stringify(statusLine)}); document.getElementById('thread').scrollTop = 99999 })()`)
    await sleep(1500)
  }
  const replies = (await collect()).filter((entry) => entry.eventKind === 'reply')
  check('three replies to the same quoted message, 1.5 s apart, are three replies', replies.length === 3, String(replies.length))
  // Reactions (a small emoji under a message) and things that are not text (a reel, a post, a photo, a video).
  const GIF = 'data:image/gif;base64,R0lGODlhAQABAAAAACw='
  const columnRow = (text, mine, badge) => `<div class="row" style="margin-top:8px;display:flex;flex-direction:column;align-items:${mine ? 'flex-end' : 'flex-start'}"><div style="background:${mine ? '#46f' : '#eee'};padding:8px 12px;border-radius:16px;width:max-content;max-width:400px"><div dir="auto" style="font-size:14px">${text}</div></div>${badge ? `<span class="badge" style="margin-top:-4px;margin-${mine ? 'right' : 'left'}:10px;background:#222;border-radius:10px;padding:1px 5px;font-size:13px">${badge}</span>` : ''}</div>`
  const mediaRow = (inner) => `<div style="margin-top:8px;display:flex;justify-content:flex-start">${inner}</div>`
  await openAnotherThread()
  await run(`document.getElementById('flow').innerHTML = ${JSON.stringify(Array.from({ length: 5 }, (_, i) => columnRow('Eski ' + (i + 1), i % 2 === 0, '')).join(''))}; document.getElementById('thread').scrollTop = 99999`)
  await sleep(2600)
  const addRow = async (html, wait = 1500) => {
    await run(`window.__posts.length = 0`)
    await run(`(() => { const flow = document.getElementById('flow'); const old = document.getElementById('status'); if (old) old.remove(); flow.insertAdjacentHTML('beforeend', ${JSON.stringify(html)}); flow.insertAdjacentHTML('beforeend', ${JSON.stringify(statusLine)}); document.getElementById('thread').scrollTop = 99999 })()`)
    await sleep(wait)
    return collect()
  }
  // A message of the user, then the friend reacts to it.
  await addRow(columnRow('Deneme', true, ''))
  await run(`window.__posts.length = 0`)
  await run(`(() => { const rows = document.querySelectorAll('#flow .row'); const row = rows[rows.length - 1]; row.insertAdjacentHTML('beforeend', '<span class="badge" style="margin-top:-4px;margin-right:10px;background:#222;border-radius:10px;padding:1px 5px;font-size:13px">❤️</span>'); })()`)
  await sleep(1500)
  const reacted = await collect()
  check('a heart under the user\'s own message is announced as a reaction, with the message it is about', reacted.length === 1 && reacted[0].eventKind === 'reaction' && reacted[0].body.includes('❤') && reacted[0].body.includes('Deneme') && reacted[0].body.includes('reacted'), JSON.stringify(reacted.map((entry) => [entry.eventKind, entry.body])))
  // The same badge drawn again.
  await run(`window.__posts.length = 0`)
  await run(`(() => { const rows = document.querySelectorAll('#flow .row'); const row = rows[rows.length - 1]; const copy = row.cloneNode(true); row.replaceWith(copy) })()`)
  await sleep(1500)
  check('the same reaction drawn again is not announced again', (await collect()).length === 0)
  // A heart under a message of the friend is the user's own reaction.
  const own = await addRow(columnRow('Arkadaşın mesajı', false, '❤️'))
  check('a heart under the friend\'s message (the user\'s own reaction) is not announced', own.every((entry) => entry.eventKind !== 'reaction'), JSON.stringify(own.map((entry) => [entry.eventKind, entry.body])))
  // Another emoji, another language.
  await run(`document.documentElement.lang = 'tr'`)
  await addRow(columnRow('Merhaba dünya', true, ''))
  await run(`window.__posts.length = 0`)
  await run(`(() => { const rows = document.querySelectorAll('#flow .row'); const row = rows[rows.length - 1]; row.insertAdjacentHTML('beforeend', '<span class="badge" style="margin-top:-4px;margin-right:10px;background:#222;border-radius:10px;padding:1px 5px;font-size:13px">👍</span>'); })()`)
  await sleep(1500)
  const turkish = await collect()
  check('a thumbs-up is announced in the language of the page', turkish.length === 1 && turkish[0].body.includes('👍') && turkish[0].body.includes('Merhaba dünya') && turkish[0].body.includes('tepki verdi'), JSON.stringify(turkish.map((entry) => entry.body)))
  await run(`document.documentElement.lang = 'en'`)
  // Cards and pictures.
  const reel = await addRow(mediaRow(`<a href="/reel/ABC123/" style="display:block"><img src="${GIF}" style="width:200px;height:300px;display:block"></a>`), 1800)
  check('a reel from the friend is announced as a reel', reel.length === 1 && reel[0].eventKind === 'message' && reel[0].body === 'sent a reel', JSON.stringify(reel.map((entry) => [entry.eventKind, entry.body])))
  const post = await addRow(mediaRow(`<a href="/p/XYZ789/" style="display:block"><img src="${GIF}" style="width:200px;height:240px;display:block"></a>`), 1800)
  check('a shared post is announced as a post', post.length === 1 && post[0].body === 'shared a post', JSON.stringify(post.map((entry) => entry.body)))
  const photo = await addRow(mediaRow(`<img src="${GIF}" style="width:220px;height:260px;display:block">`), 1800)
  check('a picture the friend sent is announced as a photo', photo.length === 1 && photo[0].body === 'sent a photo', JSON.stringify(photo.map((entry) => entry.body)))
  const video = await addRow(mediaRow(`<video style="width:220px;height:260px;display:block"></video>`), 1800)
  check('a video the friend sent is announced as a video', video.length === 1 && video[0].body === 'sent a video', JSON.stringify(video.map((entry) => entry.body)))
  // A reel card that Instagram draws as a button with a poster and text on it (no link element, no <img>).
  await sleep(4300)
  await run(`window.__posts.length = 0`)
  const card = await addRow(mediaRow(`<div role="button" style="position:relative;width:250px;height:440px;background-image:url(${GIF});background-size:cover"><span dir="auto" style="position:absolute;top:8px;left:8px">autor</span><span dir="auto" style="position:absolute;top:60px;left:8px">altyazı</span></div>`), 1800)
  check('a card drawn as a background picture is announced as an attachment', card.length === 1 && card[0].body === 'sent an attachment', JSON.stringify(card.map((entry) => entry.body)))
  const notes = JSON.parse(await run(`JSON.stringify(window.__posts)`)).map((entry) => JSON.parse(entry)).filter((entry) => entry.type === 'nebula-site-notification-diagnostic' && entry.reason === 'media-detected')
  check('the log is told what was found and its shape, without any text or name in it', notes.length >= 1 && /^attachment 0:div\[button\]/.test(notes[0].detail) && !notes[0].detail.includes('autor') && !notes[0].detail.includes('altyaz'), JSON.stringify(notes.map((entry) => entry.detail)))
  // The same, with a poster picture, the author and the caption on it and a play icon, as in the real thing.
  await sleep(4300)
  const poster = await addRow(mediaRow(`<div role="button" style="position:relative;width:250px;height:440px"><img src="${GIF}" style="width:250px;height:440px;display:block"><span dir="auto" style="position:absolute;top:8px;left:8px">sanilovesmusic</span><span dir="auto" style="position:absolute;top:40px;left:8px">STALEMATE (GRIEF) on Melodica</span><svg width="24" height="24" style="position:absolute;bottom:8px;left:8px"><circle cx="12" cy="12" r="10"/></svg></div>`), 1800)
  check('a reel card with a poster, the author and a caption is ONE notification and the text on it is not a message', poster.length === 1 && /^sent a (photo|reel|video)$/.test(poster[0].body), JSON.stringify(poster.map((entry) => entry.body)))
  // What the real log showed: cards are one <img> (reel posters 9:16, posts 3:4), with the author on or above it.
  const avatar = `<img src="${GIF}" style="width:32px;height:32px;border-radius:16px;display:block">`
  const friendAvatar = `<img src="${GIF}" style="width:28px;height:28px;border-radius:14px;align-self:flex-end;margin-right:12px">`
  await sleep(4300)
  const reelCard = await addRow(`<div style="margin-top:8px;display:flex;justify-content:flex-start">${friendAvatar}<div style="position:relative;width:200px;height:355px"><img src="${GIF}" style="width:200px;height:355px;display:block"><div style="position:absolute;top:8px;left:8px;display:flex;gap:6px">${avatar}<span dir="auto" style="color:#fff">carterpcs_</span></div><svg width="24" height="24" style="position:absolute;bottom:8px;left:8px"><rect width="24" height="24" rx="6"/></svg></div></div>`, 1800)
  check('a reel poster (9:16) with the author and a play icon on it is announced as a reel, once, with no text of its own', reelCard.length === 1 && reelCard[0].body === 'sent a reel', JSON.stringify(reelCard.map((entry) => entry.body)))
  await sleep(4300)
  const postCard = await addRow(`<div style="margin-top:8px;display:flex;justify-content:flex-start">${friendAvatar}<div style="width:300px;background:#222;border-radius:12px;overflow:hidden"><div style="display:flex;gap:8px;padding:8px">${avatar}<span dir="auto" style="color:#fff">myunwearabledesigns</span></div><img src="${GIF}" style="width:300px;height:398px;display:block"><div dir="auto" style="padding:8px;color:#fff">myunwearabledesigns Will do</div></div></div>`, 1800)
  check('a shared post (author above, caption below) is announced as a post, once, and the author and caption are not messages', postCard.length === 1 && postCard[0].body === 'shared a post', JSON.stringify(postCard.map((entry) => entry.body)))
  await sleep(4300)
  const plainPhoto = await addRow(`<div style="margin-top:8px;display:flex;justify-content:flex-start">${friendAvatar}<img src="${GIF}" style="width:300px;height:533px;display:block;border-radius:12px"></div>`, 1800)
  check('a tall photo with nothing on it, next to the friend\'s avatar, is a photo and not a reel', plainPhoto.length === 1 && plainPhoto[0].body === 'sent a photo', JSON.stringify(plainPhoto.map((entry) => entry.body)))
  const ownPicture = await addRow(`<div style="margin-top:8px;display:flex;justify-content:flex-end"><img src="${GIF}" style="width:220px;height:260px;display:block"></div>`, 1800)
  check('a picture the user sent is not announced', ownPicture.length === 0, JSON.stringify(ownPicture.map((entry) => entry.body)))
  // Opening another conversation that already has a reel and a reaction: nothing is news.
  await openAnotherThread()
  await run(`window.__posts.length = 0`)
  await run(`document.getElementById('flow').innerHTML = ${JSON.stringify(columnRow('Benim', true, '❤️') + mediaRow(`<a href="/reel/OLD/" style="display:block"><img src="${GIF}" style="width:200px;height:300px;display:block"></a>`))}`)
  await sleep(1800)
  check('a conversation that is opened with a reel and a reaction in it does not announce them', (await collect()).length === 0, JSON.stringify((await collect()).map((entry) => entry.body)))
  // If the page is not laid out the way the reader expects (no <main>), messages are still reported.
  await run(`history.pushState({}, '', '/direct/t/4/')`)
  await run(`(() => { const main = document.querySelector('main'); const plain = document.createElement('div'); plain.innerHTML = main.innerHTML; main.replaceWith(plain) })()`)
  await sleep(2600)
  const unknown = await append('Beklenmedik düzende yeni mesaj')
  check('when the page is laid out differently than expected, a new message is still reported', unknown?.body === 'Beklenmedik düzende yeni mesaj', JSON.stringify(unknown?.body))
  const labelled = await incoming('Olur', { reset: true, gap: 40, quoted: 'Sen: Film izlemeye gidelim mi', labelLine: 'Nebula Friend replied to you' })
  check('a message under a "replied to you" label is a reply', labelled?.eventKind === 'reply', labelled ? `${labelled.eventKind}: ${labelled.body}` : 'nothing reported')
  const sameSize = await incoming('Pekala', { reset: true, gap: 40, quoted: 'Önceki mesajım', quotedSameSize: true, labelLine: 'Nebula Friend replied to you' })
  check('a reply whose quoted text is the same size is still a reply when it has the label', sameSize?.eventKind === 'reply', sameSize ? `${sameSize.eventKind}: ${sameSize.body}` : 'nothing reported')
  cdp.ws.close()
} catch (error) {
  check('the run completed', false, String(error?.message ?? error))
} finally {
  chrome.kill()
  server.close()
  await sleep(500)
  rmSync(profile, { recursive: true, force: true })
}
const failed = results.filter((r) => !r.ok)
console.log(failed.length === 0 ? `\nALL CHECKS PASSED (${results.length})` : `\n${failed.length} of ${results.length} CHECK(S) FAILED`)
process.exit(failed.length === 0 ? 0 : 1)
