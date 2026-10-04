// Live check that the split's marker file is never mistaken for "the user is back in the single
// environment". The trusted folder holds the shell's own data; it may only be removed when a marker
// that was really read says single. A marker that is locked by another program, damaged or missing
// must leave the folder (and a locked marker also the file) exactly as they are.
//
// Needs a real Nebula build with its own identity (tauri.perf.conf.json); the identity's data folders
// are RESET. Never run it against a normal installation's identity.
//
//   node scripts/shell-isolation-marker-live.mjs <path-to-app.exe>
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const exe = process.argv[2]
if (!exe) {
  console.error('usage: node scripts/shell-isolation-marker-live.mjs <app.exe>')
  process.exit(2)
}
const local = join(process.env.LOCALAPPDATA, 'com.nebula.browser.perf')
const trusted = join(local, 'trusted')
const sentinel = join(trusted, 'sentinel.txt')
const markerFile = join(local, 'shell-isolation.json')
const ps = (script) => spawnSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' })
const results = []
const check = (name, ok, detail = '') => {
  results.push(Boolean(ok))
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`)
}
const killAll = () =>
  ps(`Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '${exe.split('/').join('\\')}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`)

const marker = (mode) =>
  JSON.stringify({ schema: 1, mode, pending: null, attempts: 0, expected: null, notice: null, changedAt: 1 })

function prepare(markerText) {
  killAll()
  rmSync(local, { recursive: true, force: true })
  mkdirSync(trusted, { recursive: true })
  writeFileSync(sentinel, 'the shell data')
  if (markerText !== null) writeFileSync(markerFile, markerText)
}

async function run(name, markerText, { lockSeconds = 0, expectTrusted, expectMarkerUnchanged = false }) {
  prepare(markerText)
  const before = markerText === null ? null : readFileSync(markerFile, 'utf8')
  let locker = null
  if (lockSeconds > 0) {
    // Another program holds the marker open without sharing it, as a scanner or a backup tool can.
    locker = spawn('powershell', [
      '-NoProfile',
      '-Command',
      `$f=[IO.File]::Open('${markerFile}','Open','Read','None'); Start-Sleep -Seconds ${lockSeconds}; $f.Close()`,
    ], { stdio: 'ignore' })
    await sleep(2000)
  }
  const app = spawn(exe, [], { stdio: 'ignore' })
  try {
    await sleep(12_000)
    check(`${name}: the app is running`, !app.killed && app.exitCode === null)
    check(
      `${name}: trusted folder ${expectTrusted ? 'is kept' : 'is removed'}`,
      existsSync(sentinel) === expectTrusted,
      `sentinel ${existsSync(sentinel) ? 'present' : 'gone'}`,
    )
    if (expectMarkerUnchanged) {
      // Wait for the other program to let go, then compare.
      let after = null
      for (let i = 0; i < 20 && after === null; i += 1) {
        try {
          after = readFileSync(markerFile, 'utf8')
        } catch {
          await sleep(1000)
        }
      }
      check(`${name}: the marker file was not rewritten`, after === before)
    }
  } finally {
    killAll()
    locker?.kill()
  }
}

await run('locked marker (split installation)', marker('split'), {
  lockSeconds: 20,
  expectTrusted: true,
  expectMarkerUnchanged: true,
})
await run('damaged marker', 'not json', { expectTrusted: true })
await run('missing marker', null, { expectTrusted: true })
await run('marker says split', marker('split'), { expectTrusted: true })
await run('marker says single (control: hygiene still happens)', marker('single'), { expectTrusted: false })

// The killed browser processes can still hold files for a moment.
await sleep(3000)
rmSync(local, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
const failed = results.filter((ok) => !ok).length
console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`)
process.exit(failed === 0 ? 0 : 1)
