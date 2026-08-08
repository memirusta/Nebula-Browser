import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const explicitPath = process.argv[2]
const defaultPath = process.platform === 'win32'
  ? path.join(process.env.LOCALAPPDATA ?? '', 'com.nebula.browser', 'logs', 'native-tab-transitions.jsonl')
  : path.join(os.homedir(), '.local', 'share', 'com.nebula.browser', 'logs', 'native-tab-transitions.jsonl')
const logPath = explicitPath || defaultPath

if (!logPath || !fs.existsSync(logPath)) {
  console.error(`Performance log not found: ${logPath || '(empty path)'}`)
  console.error('Pass the JSONL path explicitly: node scripts/perf-log-summary.mjs "C:\\...\\native-tab-transitions.jsonl"')
  process.exit(1)
}

const rows = fs.readFileSync(logPath, 'utf8')
  .split(/\r?\n/)
  .filter(Boolean)
  .flatMap((line) => {
    try { return [JSON.parse(line)] } catch { return [] }
  })

function percentile(sorted, p) {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))
  return sorted[index]
}

const groups = new Map()
for (const row of rows) {
  if (typeof row.durationMs !== 'number' || !Number.isFinite(row.durationMs)) continue
  const stage = typeof row.stage === 'string' ? row.stage : '(unknown)'
  const group = groups.get(stage) ?? { durations: [], errors: 0 }
  group.durations.push(row.durationMs)
  if (row.status === 'error') group.errors += 1
  groups.set(stage, group)
}

const summary = [...groups.entries()].map(([stage, group]) => {
  const durations = group.durations.sort((a, b) => a - b)
  const sum = durations.reduce((total, value) => total + value, 0)
  return {
    stage,
    count: durations.length,
    avgMs: Math.round((sum / durations.length) * 10) / 10,
    p50Ms: Math.round(percentile(durations, 0.5) * 10) / 10,
    p95Ms: Math.round(percentile(durations, 0.95) * 10) / 10,
    maxMs: Math.round(durations.at(-1) * 10) / 10,
    errors: group.errors,
  }
}).sort((a, b) => b.p95Ms - a.p95Ms)

console.log(`Nebula performance summary: ${logPath}`)
console.log(`Parsed ${rows.length} JSONL records; ${summary.length} timed stages.\n`)
console.table(summary)

const navigation = rows.filter((row) => row.stage === 'performance.navigation' && typeof row.durationMs === 'number')
if (navigation.length > 0) {
  const durations = navigation.map((row) => row.durationMs).sort((a, b) => a - b)
  const failures = navigation.filter((row) => row.status === 'error').length
  console.log('\nNavigation summary')
  console.table([{
    count: durations.length,
    avgMs: Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10,
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    maxMs: durations.at(-1),
    failures,
  }])
}
