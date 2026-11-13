// Reads a Chromium net-log (the file WebView2 writes when it starts with --log-net-log) and says where the browser
// connected, who asked for it (the browser itself or a page) and who owns the host. Used to measure what Nebula
// sends out while it sits idle, see docs/PRIVACY_AUDIT.md.
//
//   node scripts/webview2-net-audit.mjs <netlog.json> [--json out.json]
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', 'tauri.localhost', 'ipc.localhost', 'asset.localhost'])

const OWNERS = [
  ['microsoft', ['microsoft.com', 'msedge.net', 'bing.com', 'live.com', 'windows.net', 'windows.com', 'office.com', 'office.net', 'msn.com', 'skype.com', 'microsoftonline.com', 'msftconnecttest.com', 'azureedge.net', 'trafficmanager.net', 'edgesuite.net', 'smartscreen.microsoft.com']],
  ['google', ['google.com', 'googleapis.com', 'gstatic.com', 'googleusercontent.com', 'gvt1.com', 'gvt2.com', 'doubleclick.net', 'googlesyndication.com', 'google-analytics.com']],
]

function hostMatches(host, suffix) {
  return host === suffix || host.endsWith('.' + suffix)
}

/** microsoft, google, local, or other. */
export function ownerOf(host) {
  const lower = host.toLowerCase()
  if (LOCAL_HOSTS.has(lower)) return 'local'
  for (const [owner, suffixes] of OWNERS) {
    if (suffixes.some((suffix) => hostMatches(lower, suffix))) return owner
  }
  return 'other'
}

/**
 * The file is written while the browser runs, so a browser that was stopped leaves it cut off in the middle.
 * Keep every complete event and close the document.
 */
export function parseNetLog(text) {
  try {
    return JSON.parse(text)
  } catch {
    const eventsAt = text.indexOf('"events"')
    if (eventsAt < 0) throw new Error('not a net-log: no "events" list')
    const lastEnd = text.lastIndexOf('},\n')
    const lastEndNoComma = text.lastIndexOf('}\n]')
    const cut = Math.max(lastEnd, lastEndNoComma)
    if (cut < eventsAt) throw new Error('net-log has no complete event')
    return JSON.parse(text.slice(0, cut + 1) + ']}')
  }
}

function invert(table) {
  const out = new Map()
  for (const [name, value] of Object.entries(table ?? {})) out.set(value, name)
  return out
}

/** One row per host: how many requests, who made them, the first and last time (seconds after the first event). */
export function analyzeNetLog(text) {
  const log = parseNetLog(text)
  const eventNames = invert(log.constants?.logEventTypes)
  const events = Array.isArray(log.events) ? log.events : []

  const hosts = new Map()
  const resolved = new Map()
  let first = null
  let last = 0

  for (const event of events) {
    const time = Number(event.time)
    if (!Number.isFinite(time)) continue
    if (first === null) first = time
    last = Math.max(last, time)

    const name = eventNames.get(event.type)

    if (name === 'URL_REQUEST_START_JOB' && event.params?.url) {
      let url
      try {
        url = new URL(event.params.url)
      } catch {
        continue
      }
      if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) continue

      const host = url.hostname
      const seconds = Math.round((time - first) / 1000)
      const row = hosts.get(host) ?? {
        host,
        owner: ownerOf(host),
        requests: 0,
        byBrowser: 0,
        byPage: 0,
        firstSeconds: seconds,
        lastSeconds: seconds,
        paths: new Map(),
        methods: new Set(),
      }
      row.requests += 1
      // A request made for a page has the page's origin as its initiator; the browser's own say "not an origin".
      const initiator = event.params.initiator
      if (typeof initiator === 'string' && initiator !== '' && initiator !== 'not an origin') row.byPage += 1
      else row.byBrowser += 1
      row.lastSeconds = seconds
      row.methods.add(event.params.method ?? 'GET')
      const path = url.pathname.length > 60 ? url.pathname.slice(0, 57) + '...' : url.pathname
      row.paths.set(path, (row.paths.get(path) ?? 0) + 1)
      hosts.set(host, row)
    }

    if (name === 'HOST_RESOLVER_DNS_TASK' || name === 'HOST_RESOLVER_MANAGER_JOB') {
      const host = event.params?.host
      // The resolver writes "scheme://host:port" for the connections it serves.
      if (typeof host === 'string') resolved.set(host.replace(/^[a-z]+:\/\//i, '').replace(/:\d+$/, ''), true)
    }
  }

  const rows = [...hosts.values()]
    .map((row) => ({
      host: row.host,
      owner: row.owner,
      requests: row.requests,
      byBrowser: row.byBrowser,
      byPage: row.byPage,
      firstSeconds: row.firstSeconds,
      lastSeconds: row.lastSeconds,
      methods: [...row.methods].sort(),
      topPaths: [...row.paths.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([path, count]) => `${path} x${count}`),
    }))
    .sort((a, b) => b.requests - a.requests)

  const totals = {}
  for (const row of rows) {
    const owner = (totals[row.owner] ??= { hosts: 0, requests: 0, byBrowser: 0 })
    owner.hosts += 1
    owner.requests += row.requests
    owner.byBrowser += row.byBrowser
  }

  const seen = new Set(rows.map((row) => row.host))
  const resolvedOnly = [...resolved.keys()].filter((host) => !seen.has(host) && ownerOf(host) !== 'local').sort()

  return {
    events: events.length,
    seconds: first === null ? 0 : Math.round((last - first) / 1000),
    totals,
    rows,
    resolvedOnly,
  }
}

export function formatReport(result) {
  const lines = []
  lines.push(`events: ${result.events}, covers ${result.seconds} s`)
  lines.push('')
  lines.push('by owner (requests / of which made by the browser itself, no page):')
  for (const owner of ['microsoft', 'google', 'other', 'local']) {
    const row = result.totals[owner]
    if (row) lines.push(`  ${owner.padEnd(10)} ${String(row.hosts).padStart(3)} hosts  ${String(row.requests).padStart(5)} requests  ${String(row.byBrowser).padStart(5)} by the browser`)
  }
  lines.push('')
  lines.push('hosts (owner, requests, by browser/by page, first-last second, top paths):')
  for (const row of result.rows) {
    lines.push(`  ${row.owner.padEnd(9)} ${row.host}  ${row.requests}  ${row.byBrowser}/${row.byPage}  ${row.firstSeconds}-${row.lastSeconds}s  ${row.topPaths.join(', ')}`)
  }
  if (result.resolvedOnly.length > 0) {
    lines.push('')
    lines.push('looked up in DNS but no request seen:')
    for (const host of result.resolvedOnly) lines.push(`  ${ownerOf(host).padEnd(9)} ${host}`)
  }
  return lines.join('\n')
}

function main() {
  const args = process.argv.slice(2)
  const file = args.find((arg) => !arg.startsWith('--'))
  if (!file) {
    console.error('usage: node scripts/webview2-net-audit.mjs <netlog.json> [--json out.json]')
    process.exit(2)
  }
  const result = analyzeNetLog(readFileSync(file, 'utf8'))
  console.log(formatReport(result))
  const jsonAt = args.indexOf('--json')
  if (jsonAt >= 0 && args[jsonAt + 1]) writeFileSync(args[jsonAt + 1], JSON.stringify(result, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
