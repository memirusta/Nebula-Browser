import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeNetLog, ownerOf, parseNetLog } from '../scripts/webview2-net-audit.mjs'

const constants = { logEventTypes: { URL_REQUEST_START_JOB: 2, HOST_RESOLVER_DNS_TASK: 3, OTHER: 9 } }

function event(time: number, type: number, params: Record<string, unknown>) {
  return { phase: 0, source: { id: 1, type: 1 }, time: String(time), type, params }
}

const complete = {
  constants,
  events: [
    event(1000, 2, { url: 'https://edge.microsoft.com/a/b?secret=1', method: 'GET', initiator: 'not an origin' }),
    event(2000, 2, { url: 'https://edge.microsoft.com/a/b', method: 'GET' }),
    event(3000, 2, { url: 'https://example.com/page', method: 'GET', initiator: 'https://example.com' }),
    event(4000, 2, { url: 'http://tauri.localhost/index.html', method: 'GET', initiator: 'http://tauri.localhost' }),
    event(5000, 2, { url: 'data:text/plain,hello' }),
    event(6000, 3, { host: 'https://update.googleapis.com:443' }),
    event(7000, 9, {}),
  ],
}

test('every request is grouped by host, owner and who made it', () => {
  const result = analyzeNetLog(JSON.stringify(complete))

  assert.equal(result.events, 7)
  assert.equal(result.seconds, 6)

  const microsoft = result.rows.find((row: { host: string }) => row.host === 'edge.microsoft.com')
  assert.equal(microsoft.owner, 'microsoft')
  assert.equal(microsoft.requests, 2)
  assert.equal(microsoft.byBrowser, 2)
  assert.equal(microsoft.byPage, 0)

  const page = result.rows.find((row: { host: string }) => row.host === 'example.com')
  assert.equal(page.byPage, 1)
  assert.equal(page.owner, 'other')

  // Only addresses count, not data: URLs; the query string is not kept.
  assert.equal(result.rows.some((row: { host: string }) => row.host === ''), false)
  assert.deepEqual(microsoft.topPaths, ['/a/b x2'])

  assert.equal(result.totals.microsoft.requests, 2)
  assert.equal(result.totals.local.requests, 1)
  assert.deepEqual(result.resolvedOnly, ['update.googleapis.com'])
})

test('a net-log cut off in the middle keeps its complete events', () => {
  const head = '{"constants":' + JSON.stringify(constants) + ',"events":[\n'
  const body = complete.events.slice(0, 3).map((item) => JSON.stringify(item)).join(',\n') + ',\n'
  const cut = head + body + '{"phase":0,"source":{"id":1,"type":1},"time":"9'

  const parsed = parseNetLog(cut)
  assert.equal(parsed.events.length, 3)
  assert.equal(analyzeNetLog(cut).rows.length, 2)

  assert.throws(() => parseNetLog('not json'))
})

test('hosts are classified by owner', () => {
  assert.equal(ownerOf('config.edge.skype.com'), 'microsoft')
  assert.equal(ownerOf('msedge.api.cdp.microsoft.com'), 'microsoft')
  assert.equal(ownerOf('www.gstatic.com'), 'google')
  assert.equal(ownerOf('tauri.localhost'), 'local')
  assert.equal(ownerOf('127.0.0.1'), 'local')
  assert.equal(ownerOf('github.com'), 'other')
  // A look-alike is not the owner.
  assert.equal(ownerOf('notmicrosoft.com'), 'other')
})
