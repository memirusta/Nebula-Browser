import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const args = process.argv.slice(2)
const traceOption = args.find((arg) => arg.startsWith('--trace='))
const csvPaths = args.filter((arg) => !arg.startsWith('--'))

if (csvPaths.length === 0) {
  console.error('Usage: node scripts/perf-benchmark-summary.mjs <sample.csv> [...] [--trace=<native-tab-transitions.jsonl>]')
  process.exit(1)
}

const tracePath = traceOption?.slice('--trace='.length) || path.join(
  process.env.LOCALAPPDATA ?? os.homedir(),
  'com.nebula.browser',
  'logs',
  'native-tab-transitions.jsonl',
)

function csvFields(line) {
  const fields = []
  let field = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        field += '"'
        i += 1
      } else {
        quoted = !quoted
      }
    } else if (char === ',' && !quoted) {
      fields.push(field)
      field = ''
    } else {
      field += char
    }
  }
  fields.push(field)
  return fields
}

function number(value) {
  if (value === '' || value == null) return null
  const parsed = Number(String(value).replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function percentile(values, fraction) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]
}

function rounded(value) {
  return value == null ? null : Math.round(value * 10) / 10
}

const trace = fs.existsSync(tracePath)
  ? fs.readFileSync(tracePath, 'utf8').split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line)] } catch { return [] }
    })
  : []

let matchedTraceEvents = 0
const summaries = csvPaths.map((csvPath) => {
  const lines = fs.readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean)
  const header = csvFields(lines.shift() ?? '')
  const rows = lines.map((line) => Object.fromEntries(csvFields(line).map((value, index) => [header[index], value])))
  if (rows.length === 0) throw new Error(`No samples in ${csvPath}`)

  const first = rows[0]
  const start = Date.parse(first.RootStartedAt)
  const sampleStart = Date.parse(first.Timestamp)
  const sampleEnd = Date.parse(rows.at(-1).Timestamp)
  const events = trace.filter((event) => {
    const timestamp = number(event.hostTimestampMs)
    return timestamp != null && timestamp >= start && timestamp <= sampleEnd
  })
  matchedTraceEvents += events.length
  const allActivations = events.filter((event) =>
    event.stage === 'browser.activation' && event.status === 'ok' &&
    typeof event.shortcutId === 'string' && number(event.durationMs) != null,
  ).sort((left, right) => number(left.hostTimestampMs) - number(right.hostTimestampMs))
  const existingTabIds = new Set(allActivations.filter((event) =>
    number(event.hostTimestampMs) < sampleStart,
  ).map((event) => event.shortcutId))
  const activations = []
  let lastActivatedTabId = null
  for (const event of allActivations) {
    const isDuringSample = number(event.hostTimestampMs) >= sampleStart
    if (first.Phase === 'switching' && isDuringSample &&
        existingTabIds.has(event.shortcutId) && lastActivatedTabId !== event.shortcutId) {
      activations.push(number(event.durationMs))
    }
    lastActivatedTabId = event.shortcutId
  }
  const frontendReady = events.find((event) => event.stage === 'performance.frontend-ready' && event.status === 'ok')
  const shellUsable = events.find((event) =>
    (event.stage === 'mode.home' || event.stage === 'mode.browsing') && event.status === 'ok',
  )
  const firstTab = events.find((event) => event.stage === 'browser.activation' && event.status === 'ok')
  const values = (key) => rows.map((row) => number(row[key])).filter((value) => value != null)
  const cpu = values('NebulaTreeCpuPercent')
  const result = {
    file: path.basename(csvPath),
    label: first.Label,
    tabs: number(first.TabCount) || null,
    phase: first.Phase,
    samples: rows.length,
    privateMedianMB: rounded(percentile(values('NebulaTreePrivateMB'), 0.5)),
    workingSetMedianMB: rounded(percentile(values('NebulaTreeRamMB'), 0.5)),
    privatePeakMB: rounded(percentile(values('NebulaTreePrivateMB'), 1)),
    webView2PrivateMedianMB: rounded(percentile(values('WebView2TreePrivateMB'), 0.5)),
    webView2ProcessesMedian: percentile(values('WebView2ProcessCount'), 0.5),
    cpuMeanPercent: rounded(cpu.length ? cpu.reduce((sum, value) => sum + value, 0) / cpu.length : null),
    switchCount: activations.length,
    switchP50Ms: rounded(percentile(activations, 0.5)),
    switchP95Ms: rounded(percentile(activations, 0.95)),
    processToFrontendReadyMs: (first.Phase === 'startup' || first.Phase === 'uncontrolled') && frontendReady ? rounded(number(frontendReady.hostTimestampMs) - start) : null,
    processToShellUsableMs: (first.Phase === 'startup' || first.Phase === 'uncontrolled') && shellUsable ? rounded(number(shellUsable.hostTimestampMs) - start) : null,
    processToFirstTabMs: first.Phase === 'startup' && firstTab ? rounded(number(firstTab.hostTimestampMs) - start) : null,
    executable: first.RootExecutablePath,
  }
  return result
})

console.table(summaries)
const liveOneTab = summaries.find((result) => result.tabs === 1 && result.phase === 'live')
if (liveOneTab) {
  console.table(summaries.filter((result) => result.phase === 'live' && result.tabs > 1).map((result) => ({
    tabs: result.tabs,
    additionalPrivateMBPerTab: rounded((result.privateMedianMB - liveOneTab.privateMedianMB) / (result.tabs - 1)),
  })))
}
if (trace.length === 0) console.warn(`No transition log found at ${tracePath}; startup and switch timings are unavailable.`)
else if (matchedTraceEvents === 0) {
  console.warn('No timing events match these process runs. Build the frontend with VITE_NEBULA_TRANSITION_LOG=1 before capturing startup or tab-switch timings.')
}
