import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildHomeHistorySuggestions,
  filterHomeWebSuggestions,
  highlightSegments,
  inlineCompletion,
  looksLikeErrorPage,
  queryTerms,
  siteFamily,
  suggestionInitial,
} from '../src/core/homeSearchSuggestions.ts'

const DAY = 24 * 60 * 60 * 1000
let counter = 0

function visit(url: string, title: string, daysAgo = 0, times = 1) {
  const host = new URL(url).hostname.replace(/^www\./, '')
  return Array.from({ length: times }, () => ({
    id: `e${(counter += 1)}`,
    url,
    title,
    host,
    visitedAt: Date.now() - daysAgo * DAY - counter,
  }))
}

const history = (...groups: ReturnType<typeof visit>[]) => groups.flat().sort((a, b) => b.visitedAt - a.visitedAt)
const titles = (list: { title: string }[]) => list.map((s) => s.title)

test('every typed word has to match, in any order, in the title or the address', () => {
  const entries = history(
    visit('https://www.youtube.com/watch?v=77s19jCbjis', 'Kyouki (Creo - Crazy) Super Low Pitch - YouTube', 1),
    visit('https://www.youtube.com/watch?v=NaBF7qsPxWg', 'Luschka - Kami no Kotoba - YouTube', 2),
  )
  assert.deepEqual(titles(buildHomeHistorySuggestions(entries, [], 'kyouki crazy').filter((s) => s.kind === 'history')), [
    'Kyouki (Creo - Crazy) Super Low Pitch - YouTube',
  ])
  assert.equal(buildHomeHistorySuggestions(entries, [], 'crazy kyouki').filter((s) => s.kind === 'history').length, 1)
  assert.deepEqual(buildHomeHistorySuggestions(entries, [], 'kyouki zzzz'), [])
})

test('a site that is gone to every day beats one that matches slightly better but is rarely seen', () => {
  const entries = history(
    visit('https://github.com/', 'GitHub', 0, 30),
    visit('https://gitlab-fan.example/', 'Gitlab fan page', 200, 1),
  )
  const sites = buildHomeHistorySuggestions(entries, [], 'git').filter((s) => s.kind === 'site')
  assert.equal(sites[0].host, 'github.com')
  assert.equal(sites.length, 2)
})

test('the start of an address still wins over a match somewhere inside, at similar use', () => {
  const entries = history(
    visit('https://mail.example.com/', 'Inbox', 3, 5),
    visit('https://example.org/blog/gmail-tips', 'Gmail tips', 3, 5),
  )
  const sites = buildHomeHistorySuggestions(entries, [], 'mail').filter((s) => s.kind === 'site')
  assert.equal(sites[0].host, 'mail.example.com')
})

test('accents and the Turkish dotted and dotless i do not get in the way', () => {
  const entries = history(
    visit('https://tarif.example/cikolata', 'Sıcak çikolata tarifi', 1, 3),
    visit('https://www.instagram.com/', 'Instagram', 1, 4),
  )
  assert.equal(
    buildHomeHistorySuggestions(entries, [], 'sicak cikolata').filter((s) => s.kind === 'history').length,
    1,
  )
  assert.equal(buildHomeHistorySuggestions(entries, [], 'sıcak çikolata').filter((s) => s.kind === 'history').length, 1)
  // "ınstagram" (dotless first letter, as a Turkish keyboard can produce) and "INSTAGRAM" both find it.
  for (const typed of ['ınstagram', 'INSTAGRAM', 'İnstagram']) {
    assert.equal(buildHomeHistorySuggestions(entries, [], typed)[0]?.host, 'instagram.com', typed)
  }
})

test('technical addresses never become suggestions', () => {
  const entries = history(
    visit('http://localhost:3000/', 'Local dev', 0, 9),
    visit('https://app.example.com/oauth/callback?code=1&state=2', 'Signing in', 0, 3),
  )
  assert.deepEqual(buildHomeHistorySuggestions(entries, [], 'local'), [])
  assert.deepEqual(buildHomeHistorySuggestions(entries, [], 'signing'), [])
})

test('what the user searched for before comes back as a search, once, and not when it is what is typed', () => {
  const entries = history(
    visit('https://www.google.com/search?q=kyouki+crazy', 'kyouki crazy - Google Search', 1, 2),
    visit('https://www.google.com/search?q=kyouki+crazy&hl=tr', 'kyouki crazy - Google Search', 1),
    visit('https://www.google.com/search?q=kyoto+weather', 'kyoto weather - Google Search', 5),
  )
  const asked = buildHomeHistorySuggestions(entries, [], 'ky').filter((s) => s.kind === 'query')
  assert.deepEqual(titles(asked).sort(), ['kyoto weather', 'kyouki crazy'])
  assert.equal(buildHomeHistorySuggestions(entries, [], 'kyouki crazy').filter((s) => s.kind === 'query').length, 0)
  // A search page is not offered as a page.
  assert.equal(buildHomeHistorySuggestions(entries, [], 'ky').filter((s) => s.kind === 'history').length, 0)
})

test('web suggestions drop what a past search already offers', () => {
  const entries = history(visit('https://www.google.com/search?q=youtube+music', 'x', 1, 2))
  const local = buildHomeHistorySuggestions(entries, [], 'youtube')
  const web = filterHomeWebSuggestions(['youtube music', 'youtube tv', 'youtube'], local, 'youtube')
  assert.deepEqual(web, ['youtube tv'])
})

test('a site the user goes to is completed after the first letters, like in Chrome and Brave', () => {
  const entries = history(
    visit('https://www.youtube.com/', 'YouTube', 0, 6),
    visit('https://www.youtube.com/watch?v=abc', 'A video', 0, 3),
    visit('https://yandex.com/', 'Yandex', 40, 1),
  )
  assert.deepEqual(inlineCompletion(entries, [], 'you'), { completion: 'tube.com', url: 'https://www.youtube.com/' })
  assert.deepEqual(inlineCompletion(entries, [], 'www.you'), { completion: 'tube.com', url: 'https://www.youtube.com/' })
  assert.deepEqual(inlineCompletion(entries, [], 'https://you'), { completion: 'tube.com', url: 'https://www.youtube.com/' })
  assert.deepEqual(inlineCompletion(entries, [], 'YOU')?.completion, 'tube.com')
  // Once a slash is typed, the page the user goes to most.
  assert.deepEqual(inlineCompletion(entries, [], 'youtube.com/wa'), { completion: 'tch?v=abc', url: 'https://www.youtube.com/watch?v=abc' })
})

test('nothing is completed for a whole address, for words, for a site seen once, or for nothing typed', () => {
  const entries = history(
    visit('https://www.youtube.com/', 'YouTube', 0, 6),
    visit('https://yandex.com/', 'Yandex', 40, 1),
  )
  assert.equal(inlineCompletion(entries, [], 'youtube.com'), null)
  assert.equal(inlineCompletion(entries, [], 'you tube'), null)
  assert.equal(inlineCompletion(entries, [], 'yan'), null, 'seen once')
  assert.equal(inlineCompletion(entries, [], ''), null)
  assert.equal(inlineCompletion(entries, [], 'zzz'), null)
  // A pinned shortcut counts even when it was never visited twice.
  assert.equal(
    inlineCompletion(entries, [{ id: 'p', label: 'Yandex', url: 'https://yandex.com/' }], 'yan')?.completion,
    'dex.com',
  )
})

test('the words that matched are marked, ignoring case and accents, and the pieces add up to the text', () => {
  const marked = (text: string, terms: string[]) => highlightSegments(text, terms).filter((s) => s.match).map((s) => s.text)
  assert.deepEqual(marked('YouTube - youtube.com', ['you']), ['You', 'you'])
  assert.deepEqual(marked('Çikolata tarifi', queryTerms('cik tar')), ['Çik', 'tar'])
  assert.deepEqual(marked('Nothing here', ['zzz']), [])
  for (const [text, terms] of [['İstanbul ışık', ['ist', 'isik']], ['a b', ['a', 'b']], ['', ['x']]] as const) {
    assert.equal(highlightSegments(text, [...terms]).map((s) => s.text).join(''), text)
  }
})

test('five thousand history entries are searched without a noticeable delay', () => {
  const entries = Array.from({ length: 5_000 }, (_, index) => ({
    id: `p${index}`,
    url: `https://site${index % 400}.example.com/page/${index}`,
    title: `Page number ${index} about topic ${index % 37}`,
    host: `site${index % 400}.example.com`,
    visitedAt: Date.now() - (index % 120) * DAY,
  }))
  let started = performance.now()
  buildHomeHistorySuggestions(entries, [], 'topic 12')
  const first = performance.now() - started
  started = performance.now()
  for (let i = 0; i < 20; i += 1) buildHomeHistorySuggestions(entries, [], `topic ${i}`)
  const perKeystroke = (performance.now() - started) / 20
  // Generous bounds: the point is that it is nowhere near a visible delay.
  assert.ok(first < 1_000, `first search ${first.toFixed(0)} ms`)
  assert.ok(perKeystroke < 100, `per keystroke ${perKeystroke.toFixed(1)} ms`)
})

test('the subdomains of one site count as one site: one site row, and one more row at most from that family', () => {
  const entries = history(
    visit('https://www.youtube.com/', 'YouTube', 0, 8),
    visit('https://studio.youtube.com/', 'YouTube İçerik Stüdyosu', 1, 3),
    visit('https://www.youtube.com/watch?v=aaa', 'First video - YouTube', 0, 3),
    visit('https://www.youtube.com/watch?v=bbb', 'Second video - YouTube', 1, 2),
    visit('https://music.youtube.com/', 'YouTube Music', 2, 2),
  )
  const suggestions = buildHomeHistorySuggestions(entries, [], 'youtu')
  assert.equal(suggestions.filter((s) => s.kind === 'site').length, 1, JSON.stringify(titles(suggestions)))
  assert.equal(suggestions.filter((s) => s.kind === 'history').length, 1, 'a family with its site offered gets one more row')
})

test('the site a host belongs to', () => {
  assert.equal(siteFamily('www.youtube.com'), 'youtube.com')
  assert.equal(siteFamily('studio.youtube.com'), 'youtube.com')
  assert.equal(siteFamily('youtube.com'), 'youtube.com')
  assert.equal(siteFamily('shop.example.co.uk'), 'example.co.uk')
  assert.equal(siteFamily('a.b.example.com.tr'), 'example.com.tr')
  assert.equal(siteFamily('192.168.1.1'), '192.168.1.1')
  assert.equal(siteFamily('localhost'), 'localhost')
})

test('a past search is offered only when it begins with what is typed', () => {
  const entries = history(
    visit('https://www.google.com/search?q=how+should+i+record+geometry+dash+for+youtube', 'x - Google Search', 1, 2),
    visit('https://www.google.com/search?q=youtube+music+charts', 'y - Google Search', 2, 2),
  )
  const asked = (typed: string) =>
    titles(buildHomeHistorySuggestions(entries, [], typed).filter((s) => s.kind === 'query'))
  assert.deepEqual(asked('youtu'), ['youtube music charts'], 'not the one that only contains it')
  assert.deepEqual(asked('how sho'), ['how should i record geometry dash for youtube'])
  assert.deepEqual(asked('geometry'), [])
})

test('the letter standing in for an icon is a letter of the site, not punctuation from a title', () => {
  assert.equal(suggestionInitial('youtube.com'), 'Y')
  assert.equal(suggestionInitial('(4) Taşacak Bu Deniz'), 'T')
  assert.equal(suggestionInitial('', '  (!)  ', 'ışık'), 'I')
  assert.equal(suggestionInitial('123.example', ''), 'E')
  assert.equal(suggestionInitial('404'), '4')
  assert.equal(suggestionInitial('()', ''), '•')
})

test('a page whose title says it is an error ranks below real pages, though it still matches', () => {
  assert.equal(looksLikeErrorPage('Oops Page not found! I think you are lost'), true)
  assert.equal(looksLikeErrorPage('404 - Sayfa bulunamadı'), true)
  assert.equal(looksLikeErrorPage('Access Denied'), true)
  assert.equal(looksLikeErrorPage('Top 404 tips for athletes'), true, 'a standalone number in a title counts')
  assert.equal(looksLikeErrorPage('Route 4040 map'), false, 'a number inside another number does not')
  assert.equal(looksLikeErrorPage('YouTube'), false)
  assert.equal(looksLikeErrorPage('Your Proton password reset code - Gmail'), false)

  const entries = history(
    visit('https://portal.example.edu/missing', 'Oops Page not found! I think you are lost', 0, 9),
    visit('https://video.example.org/watch', 'You can do it - motivation video', 1, 2),
  )
  const pages = buildHomeHistorySuggestions(entries, [], 'you').filter((s) => s.kind === 'history')
  assert.equal(pages[0].title, 'You can do it - motivation video')
  assert.equal(pages.length, 2, 'the error page is still offered')
})
