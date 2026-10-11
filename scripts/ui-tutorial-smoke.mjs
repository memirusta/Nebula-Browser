import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function verifyTutorial({ cdp, load, size, evaluate, key, wait, root }) {
  let checks = 0
  await size(1280, 900)
  await load('tutorial')
  const step = async (index) => {
    await evaluate(`document.querySelectorAll('[data-tutorial-step] nav button')[${index}].click()`)
    await wait('step ' + index, () => evaluate(`document.querySelector('[data-tutorial-step]')?.dataset.tutorialStep === '${index}'`))
  }
  for (const locale of ['tr', 'en', 'de', 'es', 'fr', 'ru', 'it', 'ja', 'id']) {
    await evaluate(`fixture.setLocale(${JSON.stringify(locale)})`)
    await wait('locale', () => evaluate(`document.documentElement.lang === ${JSON.stringify(locale)}`))
    for (const [width, height] of [[1280,900], [700,500], [360,360], [1280,360]]) {
      await size(width, height)
      for (let index = 0; index < 4; index++) {
        await step(index)
        await wait('visible tutorial navigation', () => evaluate(`(() => {
          const panel = document.querySelector('[data-tutorial-step]'), r = panel.getBoundingClientRect();
          const practice = Number(panel.dataset.tutorialStep) < 2;
          const lunarHeight = Math.min(Math.floor(innerHeight * .72), Math.round(Math.min(innerWidth, 1100) * 152/1100));
          if (practice && r.top < lunarHeight + 17) return false;
          panel.querySelector('footer button:last-child').scrollIntoView({block: 'nearest'});
          const button = panel.querySelector('footer button:last-child'), b = button.getBoundingClientRect();
          return r.top >= 15 && r.left >= 15 && r.bottom <= innerHeight - 15 && r.right <= innerWidth - 15 &&
            b.top >= r.top && b.bottom <= r.bottom && panel.scrollWidth <= panel.clientWidth + 1;
        })()`))
        assert.equal(await evaluate('document.querySelectorAll("[aria-current=step]").length'), 1)
        checks++
      }
    }
  }
  await size(1280, 900)
  await evaluate('fixture.setLocale("tr")')
  await step(1)
  await wait('demo tab', () => evaluate('!!document.querySelector("button[aria-label=YouTube]")'))
  assert.equal(await evaluate('document.querySelectorAll("button[aria-label]").length >= 4'), true)
  for (const label of ['Wikipedia', 'Netflix', 'GitHub']) {
    assert.equal(await evaluate(`!!document.querySelector('button[aria-label=${label}]')`), true, `Missing ${label} demo tab`)
  }
  assert.equal(await evaluate(`(() => [...document.querySelectorAll('.tutorialDemoTab img')].every((icon) =>
    icon.src.includes('google.com/s2/favicons')))()`), true, 'Demo tabs do not use the browser favicon source')
  checks += 4
  assert(await evaluate(`(() => {
    const tab = document.querySelector('button[aria-label=YouTube]'), r = tab.getBoundingClientRect();
    return tab.contains(document.elementFromPoint(r.x + r.width/2, r.y + r.height/2));
  })()`), 'The guide blocks the demo tab')
  checks++
  await step(3)
  await wait('real toolbar spotlight', () => evaluate('!!document.querySelector("[data-target=home-toolbar]") && !!document.querySelector("[data-nebula-tutorial=home-toolbar]")'))
  const output = join(root, 'src-tauri/target/ui-tutorial')
  await mkdir(output, { recursive: true })
  for (const index of [0,1,2,3]) {
    await step(index)
    if (index === 0) await cdp.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 640, y: 850 })
    await new Promise((done) => setTimeout(done, index === 0 ? 620 : 220))
    const capture = await cdp.call('Page.captureScreenshot', { format: 'png' })
    await writeFile(join(output, `step-${index + 1}.png`), Buffer.from(capture.data, 'base64'))
  }
  await evaluate('document.querySelector("[data-nebula-tutorial=home-search]").style.display = "none"')
  await step(2)
  assert.equal(await evaluate('!!document.querySelector("[data-target=home-search]")'), false, 'Hidden target received a fake spotlight')
  checks++
  await step(0)
  assert.equal(await evaluate('document.querySelector("footer button").disabled'), true)
  await evaluate('document.querySelector("footer button:last-child").focus()')
  await key('ArrowRight')
  await wait('next step by keyboard', () => evaluate('document.querySelector("[data-tutorial-step]")?.dataset.tutorialStep === "1"'))
  await key('ArrowLeft')
  await wait('previous step by keyboard', () => evaluate('document.querySelector("[data-tutorial-step]")?.dataset.tutorialStep === "0"'))
  checks += 2
  await evaluate('document.querySelector("footer button:last-child").focus()')
  await key('Tab')
  assert(await evaluate('document.activeElement === document.querySelector("[data-tutorial-step] header button")'))
  await key('Escape')
  await wait('tour closes and returns focus', () => evaluate('!document.querySelector("[data-tutorial-step]") && document.activeElement.id === "open"'))
  checks += 3
  await load('tutorial')
  await step(3)
  await evaluate('document.querySelector("footer button:last-child").click()')
  await wait('tour completed', () => evaluate('!document.querySelector("[data-tutorial-step]")'))
  checks++
  console.log('Tutorial screenshots: ' + output)
  return checks
}
