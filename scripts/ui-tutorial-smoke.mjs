import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// The Next / Finish button of the bubble that is lit. (`footer button:last-child` would also match the last dot of the nav.)
const NEXT = '[data-tutorial-step] footer > button:last-child'

export async function verifyTutorial({ cdp, load, size, evaluate, key, wait, root, base }) {
  let checks = 0
  await size(1280, 900)
  await load('tutorial')
  const step = async (index) => {
    await evaluate(`document.querySelectorAll('[data-tutorial-step] nav button')[${index}].click()`)
    await wait('step ' + index, () => evaluate(`document.querySelector('[data-tutorial-step]')?.dataset.tutorialStep === '${index}'`))
    // The bubbles of the other steps are drawn at once; whatever the number, one is lit and it is the one that has the buttons.
    await wait('placed', () => evaluate(`document.querySelectorAll('[data-tutorial-step]').length === 1 &&
      document.querySelectorAll('section[data-active="true"]').length === 1 &&
      getComputedStyle(document.querySelector('section[data-active="true"]')).visibility !== 'hidden'`))
  }
  for (const locale of ['tr', 'en', 'de', 'es', 'fr', 'ru', 'it', 'ja', 'id']) {
    await evaluate(`fixture.setLocale(${JSON.stringify(locale)})`)
    await wait('locale', () => evaluate(`document.documentElement.lang === ${JSON.stringify(locale)}`))
    for (const [width, height] of [[1280,900], [700,500], [360,360], [1280,360]]) {
      await size(width, height)
      for (let index = 0; index < 6; index++) {
        await step(index)
        await wait('visible tutorial navigation', () => evaluate(`(() => {
          const panel = document.querySelector('[data-tutorial-step]'), r = panel.getBoundingClientRect();
          const practice = Number(panel.dataset.tutorialStep) < 2;
          const lunarHeight = Math.min(Math.floor(innerHeight * .72), Math.round(Math.min(innerWidth, 1100) * 152/1100));
          if (practice && r.top < lunarHeight + 17) return false;
          panel.querySelector('footer > button:last-child').scrollIntoView({block: 'nearest'});
          const button = panel.querySelector('footer > button:last-child'), b = button.getBoundingClientRect();
          return r.top >= 15 && r.left >= 15 && r.bottom <= innerHeight - 15 && r.right <= innerWidth - 15 &&
            b.top >= r.top && b.bottom <= r.bottom && panel.scrollWidth <= panel.clientWidth + 1;
        })()`))
        assert.equal(await evaluate('document.querySelectorAll("[aria-current=step]").length'), 1)
        checks++
      }
    }
  }

  // The steps after the first are on the screen together on a wide window, one by one on a narrow one; the first is alone.
  await evaluate('fixture.setLocale("en")')
  await size(1920, 1080)
  await step(1)
  await wait('five bubbles', () => evaluate('document.querySelectorAll("section[data-active]").length === 5'))
  await new Promise((done) => setTimeout(done, 600)) // the bubbles glide to their places (320 ms)
  assert.equal(await evaluate('document.querySelectorAll("section[data-active=false][aria-hidden=true]").length'), 4, 'the other four are dimmed and out of the way of a screen reader')
  assert.equal(await evaluate(`(() => [...document.querySelectorAll('section[data-active]')].every((s) => {
    const r = s.getBoundingClientRect(); return r.left >= 15 && r.top >= 15 && r.right <= innerWidth - 15 && r.bottom <= innerHeight - 15 })())`), true)
  assert.equal(await evaluate(`(() => {
    const boxes = [...document.querySelectorAll('section[data-active]')].map((s) => s.getBoundingClientRect());
    return boxes.every((a, i) => boxes.every((b, j) => j <= i || a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top));
  })()`), true, 'the bubbles do not land on one another')
  checks += 4
  await step(0)
  assert.equal(await evaluate('document.querySelectorAll("section[data-active]").length'), 1, 'the first step is shown alone')
  await size(700, 500)
  await step(1)
  assert.equal(await evaluate('document.querySelectorAll("section[data-active]").length'), 1, 'a narrow window shows only the current bubble')
  checks += 2

  // Going on lights the next bubble; the menu is a webview of its own, so it dims itself when the step is not about it.
  await size(1920, 1080)
  await step(1)
  assert.equal(await evaluate('/tutorialDimmed/.test(document.querySelector("nav").className)'), false)
  await evaluate(`document.querySelector(${JSON.stringify(NEXT)}).click()`)
  await wait('next step is lit', () => evaluate('document.querySelector("[data-tutorial-step]")?.dataset.tutorialStep === "2"'))
  assert.equal(await evaluate('/tutorialDimmed/.test(document.querySelector("nav").className)'), true)
  assert.equal(await evaluate('/rootExpanded/.test(document.querySelector("nav").className)'), true, 'the menu stays open')
  assert.equal(await evaluate('document.activeElement === document.querySelector("[data-tutorial-step] footer > button:last-child")'), true, 'focus goes to the lit bubble')
  checks += 4

  await size(1280, 900)
  await evaluate('fixture.setLocale("tr")')
  await step(1)
  await wait('demo tab', () => evaluate('!!document.querySelector("button[aria-label=YouTube]")'))
  for (const label of ['YouTube', 'Wikipedia', 'Netflix', 'GitHub']) {
    assert.equal(await evaluate(`!!document.querySelector('button[aria-label=${label}]')`), true, `Missing ${label} demo tab`)
  }
  // The icon is what the machine kept, or else the address the favicon is fetched from, or the app's own mark.
  assert.equal(await evaluate(`(() => ['YouTube', 'Wikipedia', 'Netflix', 'GitHub'].every((label) => {
    const src = document.querySelector('button[aria-label=' + label + '] img')?.getAttribute('src') ?? '';
    return src.startsWith('data:image/') || src.includes('google.com/s2/favicons') || src.endsWith('/nebula-app-logo.png');
  }))()`), true, 'Demo tabs show an icon')
  checks += 5
  assert(await evaluate(`(() => {
    const tab = document.querySelector('button[aria-label=YouTube]'), r = tab.getBoundingClientRect();
    return tab.contains(document.elementFromPoint(r.x + r.width/2, r.y + r.height/2));
  })()`), 'The guide blocks the demo tab')
  checks++
  await step(4)
  await wait('real toolbar spotlight', () => evaluate('!!document.querySelector("[data-target=home-toolbar]") && !!document.querySelector("[data-nebula-tutorial=home-toolbar]")'))
  // The gear of Settings is pressed by a finger: the dot is on it.
  assert.equal(await evaluate(`(() => {
    const dot = document.querySelector('[class*=_tap_]'), gear = document.querySelector('[data-nebula-tutorial=home-settings]');
    if (!dot || !gear) return false;
    const a = dot.getBoundingClientRect(), b = gear.getBoundingClientRect();
    return Math.abs(a.left + a.width / 2 - b.left - b.width / 2) < 2 && Math.abs(a.top + a.height / 2 - b.top - b.height / 2) < 2;
  })()`), true, 'the finger is on the gear')
  // The widgets at the left edge have the bubble on their right, and the statement about the shield points at nothing.
  await step(3)
  assert.equal(await evaluate('document.querySelector("section[data-active=true]").dataset.side'), 'right')
  await step(5)
  assert.equal(await evaluate('!document.querySelector("[data-target]")'), true, 'the shield has nothing to be lit: the whole screen is dimmed')
  checks += 3
  // The menu is a webview above the window and lights itself: no hole and no ring are drawn around it.
  await step(1)
  assert.equal(await evaluate('!document.querySelector("[data-target=semi-lunar]")'), true, 'nothing is drawn behind the menu')
  checks += 2
  const output = join(root, 'src-tauri/target/ui-tutorial')
  await mkdir(output, { recursive: true })
  await size(1920, 1080)
  for (const index of [0,1,2,3,4,5]) {
    await step(index)
    if (index === 0) await cdp.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 960, y: 1000 })
    await new Promise((done) => setTimeout(done, index === 0 ? 620 : 520))
    const capture = await cdp.call('Page.captureScreenshot', { format: 'png' })
    await writeFile(join(output, `step-${index + 1}.png`), Buffer.from(capture.data, 'base64'))
  }
  await size(1280, 900)
  await evaluate('document.querySelector("[data-nebula-tutorial=home-search]").style.display = "none"')
  await step(2)
  assert.equal(await evaluate('!!document.querySelector("[data-target=home-search]")'), false, 'Hidden target received a fake spotlight')
  checks++
  await step(0)
  assert.equal(await evaluate('document.querySelector("[data-tutorial-step] footer > button").disabled'), true)
  await evaluate(`document.querySelector(${JSON.stringify(NEXT)}).focus()`)
  await key('ArrowRight')
  await wait('next step by keyboard', () => evaluate('document.querySelector("[data-tutorial-step]")?.dataset.tutorialStep === "1"'))
  await key('ArrowLeft')
  await wait('previous step by keyboard', () => evaluate('document.querySelector("[data-tutorial-step]")?.dataset.tutorialStep === "0"'))
  checks += 2
  await evaluate(`document.querySelector(${JSON.stringify(NEXT)}).focus()`)
  await key('Tab')
  assert(await evaluate('document.activeElement === document.querySelector("[data-tutorial-step] header button")'))
  await key('Escape')
  await wait('tour closes and returns focus', () => evaluate('!document.querySelector("[data-tutorial-step]") && document.activeElement.id === "open"'))
  checks += 3
  await load('tutorial')
  await step(5)
  await evaluate(`document.querySelector(${JSON.stringify(NEXT)}).click()`)
  await wait('tour completed', () => evaluate('!document.querySelector("[data-tutorial-step]")'))
  checks++

  // The opening scene of the first tour: the menu was open when the tour began (the home page's default) and is closed for it;
  // the scene waits for the menu to be opened, then the tour goes on with the tabs.
  await size(1280, 900)
  await evaluate('window.fixture = undefined')
  await cdp.call('Page.navigate', { url: `${base}/?panel=tutorial&intro=1&late=1` })
  await wait('fixture', () => evaluate('!!window.fixture && !!document.querySelector("#open")'))
  await evaluate('document.querySelector("#open").click()')
  await wait('menu open before the tour', () => evaluate('/rootExpanded/.test(document.querySelector("nav")?.className ?? "")'))
  await wait('the scene waits', () => evaluate('document.querySelector("[role=dialog][data-state]")?.dataset.state === "waiting"'))
  await wait('menu closed for it', () => evaluate('!/rootExpanded/.test(document.querySelector("nav").className)'))
  await new Promise((done) => setTimeout(done, 1200))
  assert.equal(await evaluate('document.querySelector("[role=dialog][data-state]")?.dataset.state'), 'waiting', 'the scene did not move on by itself')
  assert.equal(await evaluate('!!document.querySelector("[data-tutorial-step]")'), false, 'no bubble while the scene waits')
  await evaluate('document.querySelector("[role=dialog][data-state] button").click()')
  await wait('opening', () => evaluate('document.querySelector("[role=dialog][data-state]")?.dataset.state === "opening" && /rootExpanded/.test(document.querySelector("nav").className)'))
  await wait('the tour goes on with the tabs', () => evaluate('document.querySelector("[data-tutorial-step]")?.dataset.tutorialStep === "1"'))
  checks += 6
  console.log('Tutorial screenshots: ' + output)
  return checks
}
