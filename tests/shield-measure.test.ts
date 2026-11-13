import assert from 'node:assert/strict'
import test from 'node:test'

import {
  analyzeYoutubeSamples,
  createNetworkRecorder,
  isAdRelated,
  registrableDomain,
  renderComparison,
  summarizeRequests,
} from '../scripts/shield-measure.mjs'

function fire(recorder: ReturnType<typeof createNetworkRecorder>, id: string, url: string, outcome: 'ok' | 'blocked' | 'network', bytes = 0) {
  recorder.onEvent('Network.requestWillBeSent', { requestId: id, request: { url, method: 'GET' }, type: 'Script', timestamp: 1 })
  if (outcome === 'ok') {
    recorder.onEvent('Network.responseReceived', { requestId: id, response: { status: 200, mimeType: 'text/javascript', url } })
    recorder.onEvent('Network.loadingFinished', { requestId: id, encodedDataLength: bytes })
  } else {
    recorder.onEvent('Network.loadingFailed', { requestId: id, errorText: outcome === 'blocked' ? 'net::ERR_BLOCKED_BY_CLIENT' : 'net::ERR_CONNECTION_RESET' })
  }
}

test('a request that something on this side stopped is told apart from one the network dropped', () => {
  const recorder = createNetworkRecorder()
  fire(recorder, '1', 'https://www.youtube.com/watch?v=abc', 'ok', 5000)
  fire(recorder, '2', 'https://googleads.g.doubleclick.net/pagead/id', 'blocked')
  fire(recorder, '3', 'https://example.org/x.js', 'network')
  const [page, ad, lost] = recorder.requests()
  assert.equal(page.blocked, false)
  assert.equal(ad.blocked, true)
  assert.equal(lost.failed && !lost.blocked, true)
  const summary = summarizeRequests(recorder.requests(), 'https://www.youtube.com/watch?v=abc')
  assert.equal(summary.attempted.count, 3)
  assert.equal(summary.attempted.blocked, 1)
  assert.equal(summary.failedForOtherReasons, 1)
  assert.equal(summary.attempted.bytes, 5000)
})

test('a redirect keeps both requests, and requests that are not http are left out', () => {
  const recorder = createNetworkRecorder()
  recorder.onEvent('Network.requestWillBeSent', { requestId: 'r', request: { url: 'https://a.test/', method: 'GET' }, type: 'Document', timestamp: 1 })
  recorder.onEvent('Network.requestWillBeSent', { requestId: 'r', request: { url: 'https://b.test/', method: 'GET' }, type: 'Document', timestamp: 2, redirectResponse: { status: 302 } })
  recorder.onEvent('Network.requestWillBeSent', { requestId: 'd', request: { url: 'data:text/plain,hi', method: 'GET' }, type: 'Other', timestamp: 3 })
  const requests = recorder.requests()
  assert.deepEqual(requests.map((r) => [r.url, r.status, r.redirectedTo]), [['https://a.test/', 302, 'https://b.test/'], ['https://b.test/', null, '']])
})

test('first party and third party are told apart by the registrable domain', () => {
  assert.equal(registrableDomain('www.youtube.com'), 'youtube.com')
  assert.equal(registrableDomain('i.ytimg.com'), 'ytimg.com')
  assert.equal(registrableDomain('shop.example.co.uk'), 'example.co.uk')
  const recorder = createNetworkRecorder()
  fire(recorder, '1', 'https://www.youtube.com/a', 'ok')
  fire(recorder, '2', 'https://rr1---sn.googlevideo.com/videoplayback', 'ok')
  fire(recorder, '3', 'https://static.doubleclick.net/instream/ad_status.js', 'blocked')
  const summary = summarizeRequests(recorder.requests(), 'https://www.youtube.com/')
  assert.equal(summary.thirdParty.count, 2)
  assert.equal(summary.thirdParty.blocked, 1)
})

test('advertising is recognised by the host or by the path on a host that also serves content', () => {
  assert.equal(isAdRelated('https://googleads.g.doubleclick.net/pagead/ads?x=1'), true)
  assert.equal(isAdRelated('https://www.youtube.com/api/stats/ads?ver=2'), true)
  assert.equal(isAdRelated('https://www.youtube.com/pagead/viewthroughconversion/1'), true)
  assert.equal(isAdRelated('https://www.youtube.com/watch?v=abc'), false)
  assert.equal(isAdRelated('https://i.ytimg.com/vi/abc/hqdefault.jpg'), false)
  // A connectivity check and plain telemetry are not advertising.
  assert.equal(isAdRelated('https://www.google.com/generate_204'), false)
  assert.equal(isAdRelated('https://www.youtube.com/youtubei/v1/log_event'), false)
})

test('the ad-related traffic that went through is listed, so what a blocker missed can be read off', () => {
  const recorder = createNetworkRecorder()
  fire(recorder, '1', 'https://googleads.g.doubleclick.net/pagead/a', 'blocked')
  fire(recorder, '2', 'https://www.youtube.com/api/stats/ads?x=1', 'ok', 300)
  const summary = summarizeRequests(recorder.requests(), 'https://www.youtube.com/')
  assert.equal(summary.adRelated.count, 2)
  assert.equal(summary.adRelated.blocked, 1)
  assert.equal(summary.adRelated.passed, 1)
  assert.deepEqual(summary.adRelatedPassedUrls.map((item: { status: number }) => item.status), [200])
})

test('the samples of the YouTube probe become ads shown, seconds of ads and seconds until the video plays', () => {
  const base = 1_000_000
  const sample = (second: number, patch: Record<string, unknown>) => ({
    at: base + second * 1000, adShowing: false, adOverlay: false, videoTime: null, paused: true, adPlacementsInResponse: 2, playabilityStatus: 'OK', ...patch,
  })
  const samples = [
    sample(0, {}),
    sample(1, { adShowing: true, videoTime: 0.2, paused: false }),
    sample(2, { adShowing: true, videoTime: 1.2, paused: false }),
    sample(3, { adShowing: true, videoTime: 2.2, paused: false }),
    sample(4, { videoTime: 0.1, paused: false }),
    sample(5, { videoTime: 1.1, paused: false }),
    sample(6, { adOverlay: true, videoTime: 2, paused: false }),
    sample(7, { videoTime: 3, paused: false }),
  ]
  const result = analyzeYoutubeSamples(samples)
  assert.equal(result.ads, 2)
  assert.equal(result.secondsOfAds, 4)
  assert.equal(result.secondsToVideo, 5)
  assert.equal(result.adPlacementsInResponse, 2)
  assert.equal(result.playability, 'OK')
  // Nothing sampled is not "no ads": it says so.
  assert.deepEqual(analyzeYoutubeSamples([]), { samples: 0, ads: 0, secondsOfAds: 0, secondsToVideo: null, adPlacementsInResponse: null, adPlacementKinds: null, playability: null })
  // A video that never played without an ad on it has no "seconds until".
  assert.equal(analyzeYoutubeSamples([sample(0, { adShowing: true }), sample(1, { adShowing: true })]).secondsToVideo, null)
})

test('runs are put side by side with one column each, and the video rows appear only when a run has a video', () => {
  const network = {
    attempted: { count: 100, blocked: 30, bytes: 2048 },
    thirdParty: { count: 40, blocked: 25, bytes: 0 },
    adRelated: { count: 10, blocked: 8, bytes: 0, passed: 2 },
    hostCount: 12,
    owners: { microsoft: 3 },
  }
  const table = renderComparison([
    { label: 'current', url: 'u', network, youtube: { ads: 1, secondsOfAds: 6, secondsToVideo: 9, adPlacementsInResponse: 3 } },
    { label: 'other', url: 'u', network },
  ])
  assert.match(table, /\| \| current \| other \|/)
  assert.match(table, /\| requests attempted \| 100 \| 100 \|/)
  assert.match(table, /\| ads shown \(runs of ad on screen\) \| 1 \| - \|/)
  assert.doesNotMatch(renderComparison([{ label: 'x', url: 'u', network }]), /ads shown/)
})

test('a request that Nebula\'s own shield answered is counted as blocked, and as the shield\'s', () => {
  const recorder = createNetworkRecorder()
  recorder.onEvent('Network.requestWillBeSent', { requestId: '1', request: { url: 'https://ads.example/a.js', method: 'GET' }, type: 'Script', timestamp: 1 })
  recorder.onEvent('Network.responseReceived', { requestId: '1', response: { status: 200, mimeType: 'text/javascript', url: 'https://ads.example/a.js', headers: { 'X-Nebula-Shield': 'blocked' } } })
  recorder.onEvent('Network.loadingFinished', { requestId: '1', encodedDataLength: 0 })
  recorder.onEvent('Network.requestWillBeSent', { requestId: '2', request: { url: 'https://site.example/app.js', method: 'GET' }, type: 'Script', timestamp: 2 })
  recorder.onEvent('Network.responseReceived', { requestId: '2', response: { status: 200, mimeType: 'text/javascript', url: 'https://site.example/app.js', headers: { 'content-type': 'text/javascript' } } })
  const summary = summarizeRequests(recorder.requests(), 'https://site.example/')
  assert.equal(summary.attempted.blocked, 1)
  assert.equal(summary.byShield, 1)
})
