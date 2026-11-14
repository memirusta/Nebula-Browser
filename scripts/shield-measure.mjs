// What a page asks for, what stops it, and what the person sees: the measuring half of the shield work.
//
// A run loads one page in a Nebula build that was started with Chromium's remote debugging switched on, records every request
// the page makes (the Network domain of the DevTools protocol sees a request that was blocked as well as one that went out),
// and, for YouTube, samples whether an advertisement is on the screen. This file holds what can be tested without a browser:
// turning the recorded events into a summary, telling ad-related requests apart, reading the YouTube samples, and comparing
// runs. scripts/shield-measure-run.mjs starts the build and feeds it.
//
// What the numbers mean (so nobody reads more into them than they say):
//   - "attempted" is every request the page made while it was measured, including the ones that were then blocked. It is the
//     nearest thing to "what the page would do with nothing in the way", but a script that was blocked never asked for what
//     it would have asked for next, so a run with nothing blocking can attempt more.
//   - "blocked" is a request that failed with ERR_BLOCKED_BY_CLIENT: something on this side stopped it (an extension's rules or
//     Nebula's own handler). A request the page's own policy refused (a content-security-policy, a cross-origin policy) is
//     counted apart as "refused by policy", and one the network dropped as "failed", so they do not pass for a blocker's work.
//   - A request is "ad-related" by the lists below, which are short and made for YouTube. They say what to look at; the
//     blocked column is what actually happened.
import { ownerOf } from './webview2-net-audit.mjs'

/** Hosts that carry advertising or measurement for it (YouTube and Google's own ad network). */
const AD_HOST_SUFFIXES = [
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'google-analytics.com',
  'googletagmanager.com',
  'googletagservices.com',
  'adservice.google.com',
  'imasdk.googleapis.com',
  'admob.com',
]

/** Paths on a host that also serves content (youtube.com, google.com) where the advertising lives. */
const AD_PATH_PATTERNS = [
  /\/pagead\//i,
  /\/api\/stats\/ads/i,
  /\/api\/stats\/atr/i,
  /\/ptracking/i,
  /\/get_midroll_info/i,
  /[?&]ad_type=/i,
]

const TWO_PART_SUFFIXES = new Set(['co.uk', 'com.tr', 'com.au', 'co.jp', 'com.br', 'org.uk'])

/** example.co.uk for a.b.example.co.uk, example.com for a.example.com. Good enough to tell first party from third. */
export function registrableDomain(host) {
  const labels = String(host).toLowerCase().replace(/\.$/, '').split('.')
  if (labels.length <= 2) return labels.join('.')
  const lastTwo = labels.slice(-2).join('.')
  return TWO_PART_SUFFIXES.has(lastTwo) ? labels.slice(-3).join('.') : lastTwo
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

export function isAdRelated(url) {
  const host = hostOf(url)
  if (!host) return false
  if (AD_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith('.' + suffix))) return true
  return AD_PATH_PATTERNS.some((pattern) => pattern.test(url))
}

/** Who made a request: its kind, and the script that did it (the top of its call stack, or the address it came from). */
export function describeInitiator(initiator) {
  if (!initiator) return null
  const frame = initiator.stack && initiator.stack.callFrames && initiator.stack.callFrames[0]
  return {
    type: initiator.type ?? 'other',
    script: frame ? `${frame.url.slice(0, 110)}${frame.functionName ? ` ${frame.functionName}` : ''}` : (initiator.url ?? '').slice(0, 110),
  }
}

/**
 * Turns the events of the Network domain into one record per request. Feed it every event with `onEvent(method, params)`
 * and read the records with `requests()`.
 */
export function createNetworkRecorder() {
  const byId = new Map()
  const order = []

  function entry(id) {
    let record = byId.get(id)
    if (!record) {
      record = { id, url: '', method: 'GET', type: 'Other', startedAt: 0, status: null, mimeType: '', bytes: 0, initiator: null, shield: false, failed: false, blocked: false, refusedByPolicy: false, blockedReason: '', error: '', fromCache: false, redirectedTo: '' }
      byId.set(id, record)
      order.push(record)
    }
    return record
  }

  return {
    onEvent(method, params) {
      if (!params) return
      switch (method) {
        case 'Network.requestWillBeSent': {
          const previous = byId.get(params.requestId)
          if (previous && params.redirectResponse) {
            // A redirect is the same request id with a new url: keep the first as its own record, ending at the redirect.
            previous.status = params.redirectResponse.status
            previous.redirectedTo = params.request.url
            byId.delete(params.requestId)
            order.splice(order.indexOf(previous), 1, previous)
            byId.set(`${params.requestId}#redirect${order.length}`, previous)
          }
          const record = entry(params.requestId)
          record.url = params.request.url
          record.method = params.request.method
          record.type = params.type ?? 'Other'
          record.startedAt = params.timestamp ?? 0
          record.initiator = describeInitiator(params.initiator)
          break
        }
        case 'Network.responseReceived': {
          const record = entry(params.requestId)
          record.status = params.response.status
          record.mimeType = params.response.mimeType ?? ''
          record.fromCache = Boolean(params.response.fromDiskCache || params.response.fromServiceWorker)
          // Nebula's own shield answers a request it stops with a mark in the headers (it cannot make a request fail the way an
          // extension does), so a request it stopped is counted as blocked, and as the shield's.
          const headers = params.response.headers ?? {}
          if (Object.keys(headers).some((name) => name.toLowerCase() === 'x-nebula-shield')) {
            record.shield = true
            record.blocked = true
          }
          if (!record.url) record.url = params.response.url
          break
        }
        case 'Network.loadingFinished':
          entry(params.requestId).bytes = params.encodedDataLength ?? 0
          break
        case 'Network.loadingFailed': {
          const record = entry(params.requestId)
          record.failed = true
          record.error = params.errorText ?? ''
          record.blockedReason = params.blockedReason ?? ''
          record.blocked = /ERR_BLOCKED_BY_CLIENT/.test(record.error)
          // Refused by something in the page or the browser (CSP, CORP, mixed content ...), which a blocker did not do.
          record.refusedByPolicy = !record.blocked && (/ERR_BLOCKED_BY_(RESPONSE|ADMINISTRATOR|CSP)/.test(record.error) || Boolean(record.blockedReason))
          break
        }
        default:
      }
    },
    requests() {
      return order.filter((record) => record.url && /^https?:/i.test(record.url))
    },
  }
}

function tally(records) {
  return { count: records.length, blocked: records.filter((r) => r.blocked).length, bytes: records.reduce((sum, r) => sum + r.bytes, 0) }
}

/** What the page did, from the records of the recorder. `pageUrl` tells first party from third. */
export function summarizeRequests(requests, pageUrl) {
  const firstParty = registrableDomain(hostOf(pageUrl))
  const hosts = new Map()
  const owners = {}
  const types = {}
  for (const request of requests) {
    const host = hostOf(request.url)
    const entry = hosts.get(host) ?? { host, count: 0, blocked: 0, bytes: 0 }
    entry.count += 1
    entry.blocked += request.blocked ? 1 : 0
    entry.bytes += request.bytes
    hosts.set(host, entry)
    const owner = ownerOf(host)
    owners[owner] = (owners[owner] ?? 0) + 1
    types[request.type] = (types[request.type] ?? 0) + 1
  }
  const thirdParty = requests.filter((r) => registrableDomain(hostOf(r.url)) !== firstParty)
  const adRelated = requests.filter((r) => isAdRelated(r.url))
  const failedOther = requests.filter((r) => r.failed && !r.blocked && !r.refusedByPolicy)
  const reasons = {}
  for (const request of requests.filter((r) => r.failed)) {
    const key = `${request.error || 'failed'}${request.blockedReason ? ` (${request.blockedReason})` : ''}`
    reasons[key] = (reasons[key] ?? 0) + 1
  }
  const videoBytes = requests.filter((r) => /(^|\.)googlevideo\.com$/.test(hostOf(r.url))).reduce((sum, r) => sum + r.bytes, 0)
  return {
    attempted: tally(requests),
    byShield: requests.filter((r) => r.shield).length,
    thirdParty: tally(thirdParty),
    adRelated: { ...tally(adRelated), passed: adRelated.filter((r) => !r.blocked).length },
    failedForOtherReasons: failedOther.length,
    refusedByPolicy: requests.filter((r) => r.refusedByPolicy).length,
    failureReasons: reasons,
    videoBytes,
    hostCount: hosts.size,
    owners,
    types,
    topBlockedHosts: [...hosts.values()].filter((h) => h.blocked > 0).sort((a, b) => b.blocked - a.blocked).slice(0, 12),
    topHosts: [...hosts.values()].sort((a, b) => b.count - a.count).slice(0, 12),
    // What made the requests that were blocked: the same script behind many of them is a lead on who blocked them.
    blockedInitiators: Object.entries(requests.filter((r) => r.blocked).reduce((byScript, r) => {
      const key = r.initiator ? `${r.initiator.type}: ${r.initiator.script}` : 'unknown'
      byScript[key] = (byScript[key] ?? 0) + 1
      return byScript
    }, {})).sort((a, b) => b[1] - a[1]).slice(0, 10),
    adRelatedPassedUrls: adRelated.filter((r) => !r.blocked).slice(0, 25).map((r) => ({ url: r.url.slice(0, 160), status: r.status })),
  }
}

/** Runs in the YouTube page: what is on the screen right now. Returned as a plain object. */
export const YOUTUBE_PROBE = `(() => {
  const player = document.querySelector('.html5-video-player')
  const video = document.querySelector('video.html5-main-video') || document.querySelector('video')
  const response = window.ytInitialPlayerResponse
  return {
    at: Date.now(),
    adShowing: Boolean(player && player.classList.contains('ad-showing')),
    adOverlay: Boolean(document.querySelector('.ytp-ad-player-overlay, .ytp-ad-text, .ytp-ad-preview-container, .ytp-ad-simple-ad-badge')),
    skippable: Boolean(document.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button')),
    videoTime: video ? Math.round(video.currentTime * 10) / 10 : null,
    videoReady: video ? video.readyState : null,
    paused: video ? video.paused : null,
    adPlacementsInResponse: response && Array.isArray(response.adPlacements) ? response.adPlacements.length : null,
    adPlacementKinds: response && Array.isArray(response.adPlacements)
      ? response.adPlacements.map((p) => { const c = p.adPlacementRenderer && p.adPlacementRenderer.config && p.adPlacementRenderer.config.adPlacementConfig; return c ? String(c.kind).replace('AD_PLACEMENT_KIND_', '') : '?' })
      : null,
    playabilityStatus: response && response.playabilityStatus ? response.playabilityStatus.status : null,
    title: document.title.slice(0, 80),
  }
})()`

/**
 * Reads the samples of the probe, taken about once a second. An advertisement is a run of samples with the ad on the screen;
 * how long the person waited for the video is the time from the first sample to the first one where the video is playing
 * with no ad.
 */
export function analyzeYoutubeSamples(samples) {
  const usable = samples.filter((s) => s && typeof s.at === 'number')
  if (usable.length === 0) return { samples: 0, ads: 0, secondsOfAds: 0, secondsToVideo: null, adPlacementsInResponse: null, adPlacementKinds: null, playability: null }
  const start = usable[0].at
  let ads = 0
  let previousShowing = false
  let secondsOfAds = 0
  let secondsToVideo = null
  for (let index = 0; index < usable.length; index++) {
    const sample = usable[index]
    const showing = sample.adShowing || sample.adOverlay
    if (showing && !previousShowing) ads += 1
    if (showing && index > 0) secondsOfAds += (sample.at - usable[index - 1].at) / 1000
    if (secondsToVideo === null && !showing && sample.videoTime !== null && sample.videoTime > 0.5 && sample.paused === false) {
      secondsToVideo = Math.round((sample.at - start) / 100) / 10
    }
    previousShowing = showing
  }
  const withPlacements = usable.find((s) => s.adPlacementsInResponse !== null)
  return {
    samples: usable.length,
    ads,
    secondsOfAds: Math.round(secondsOfAds * 10) / 10,
    secondsToVideo,
    adPlacementsInResponse: withPlacements ? withPlacements.adPlacementsInResponse : null,
    // START = before the video, END = after it, MILLISECONDS = at a time in it: whether an ad should have been seen in the window.
    adPlacementKinds: withPlacements && withPlacements.adPlacementKinds ? withPlacements.adPlacementKinds : null,
    playability: usable.map((s) => s.playabilityStatus).find(Boolean) ?? null,
  }
}

function kb(bytes) {
  return Math.round(bytes / 1024) + ' KB'
}

/** A markdown table putting runs side by side: one column per run (a mode, or a repeat). */
export function renderComparison(runs) {
  const rows = [
    ['requests attempted', (r) => r.network.attempted.count],
    ['of them blocked', (r) => r.network.attempted.blocked],
    ['  by Nebula\'s shield', (r) => r.network.byShield ?? 0],
    ['third-party requests', (r) => r.network.thirdParty.count],
    ['third-party blocked', (r) => r.network.thirdParty.blocked],
    ['ad-related requests', (r) => r.network.adRelated.count],
    ['ad-related blocked', (r) => r.network.adRelated.blocked],
    ['ad-related that went through', (r) => r.network.adRelated.passed],
    ['refused by policy (not a blocker)', (r) => r.network.refusedByPolicy ?? 0],
    ['bytes received', (r) => kb(r.network.attempted.bytes)],
    ['  of which video from googlevideo.com', (r) => kb(r.network.videoBytes ?? 0)],
    ['hosts contacted', (r) => r.network.hostCount],
    ['requests to Microsoft hosts', (r) => r.network.owners.microsoft ?? 0],
  ]
  const hasVideo = runs.some((r) => r.youtube)
  if (hasVideo) {
    rows.push(
      ['ads shown (runs of ad on screen)', (r) => (r.youtube ? r.youtube.ads : '-')],
      ['seconds of ads on screen', (r) => (r.youtube ? r.youtube.secondsOfAds : '-')],
      ['seconds until the video plays', (r) => (r.youtube ? (r.youtube.secondsToVideo ?? 'never') : '-')],
      ['ad placements in the player response', (r) => (r.youtube ? (r.youtube.adPlacementsInResponse ?? '-') : '-')],
      ['  kinds', (r) => (r.youtube && r.youtube.adPlacementKinds ? r.youtube.adPlacementKinds.join(', ') : '-')],
    )
  }
  const header = `| | ${runs.map((r) => r.label).join(' | ')} |`
  const rule = `|---|${runs.map(() => '---').join('|')}|`
  const lines = rows.map(([name, read]) => `| ${name} | ${runs.map((r) => read(r)).join(' | ')} |`)
  return [header, rule, ...lines].join('\n')
}

/** The full text of a report: the comparison, then for each run what was blocked and what ad-related traffic went through. */
export function renderReport(runs, meta = {}) {
  const out = []
  out.push('# Shield measurement')
  out.push('')
  for (const [key, value] of Object.entries(meta)) out.push(`- ${key}: ${value}`)
  out.push('')
  out.push(renderComparison(runs))
  for (const run of runs) {
    out.push('', `## ${run.label}`, '', `Page: ${run.url}`)
    if (run.shield) out.push(run.guard ? "Nebula's own shield was on, and the content blocker (uBlock Origin Lite) was off." : "Nebula's own shield was on.")
    if (run.baseline && !run.guard) out.push('Baseline: the shield and the other protections were off.')
    if ((run.baseline || run.shield) && run.guard) {
      const label = run.baseline ? 'Baseline' : 'Shield run'
      const blocked = run.network.attempted.blocked
      const guard = run.guard ?? { reads: 0, reapplied: 0 }
      if (run.stayedOff === true) out.push(`${label}: the blocker was switched off before anything was opened, read ${guard.reads} times during the run and never found back on; ${blocked} requests were blocked.`)
      else if (run.stayedOff === false) out.push(`${label} NOT clean: the blocker was switched off, but it was found back on ${guard.reapplied} times in ${guard.reads} readings (each time switched off again, but the page ran with it on in between); ${blocked} requests were blocked.`)
      else out.push(`${label} unproven: the blocker was switched off but could not be read during the run; ${blocked} requests were blocked${blocked === 0 ? ' (so it stayed off)' : ' (so it was NOT off)'}.`)
    } else if (run.blocker) {
      out.push(`Blocker on: ${(run.blocker.rulesets ?? []).length} rule sets, ${run.blocker.dynamicRules ?? 0} own rules, ${run.blocker.scripts ?? 0} injected scripts.`)
    }
    if (run.network.topBlockedHosts.length) {
      out.push('', 'Blocked, by host:')
      for (const host of run.network.topBlockedHosts) out.push(`- ${host.host}: ${host.blocked} of ${host.count}`)
    }
    if (run.network.adRelatedPassedUrls.length) {
      out.push('', 'Ad-related requests that went through:')
      for (const item of run.network.adRelatedPassedUrls) out.push(`- ${item.status ?? '?'} ${item.url}`)
    }
    out.push(run.nebulaPrivacy
      ? `Nebula's own settings for this run: ${Object.entries(run.nebulaPrivacy).map(([key, value]) => `${key} = ${value}`).join(', ')}.`
      : "Nebula's own settings: as shipped (WebView2 Tracking Prevention balanced).")
    if ((run.network.blockedInitiators ?? []).length) {
      out.push('', 'Blocked requests were made by:')
      for (const [who, count] of run.network.blockedInitiators) out.push(`- ${count} x ${who}`)
    }
    const reasons = Object.entries(run.network.failureReasons ?? {})
    if (reasons.length) {
      out.push('', 'Requests that failed, by reason:')
      for (const [reason, count] of reasons.sort((a, b) => b[1] - a[1])) out.push(`- ${reason}: ${count}`)
    }
  }
  return out.join('\n')
}
