// Live check of the browsing layout's self-repair, on a real Nebula build with its own identity
// (tauri.perf.conf.json; its data folders are reset). A real tab is opened (a second instance hands a URL
// to the running one, like a user's link), then Windows' view of the layout is corrupted natively the way a
// stale frame offset would (hosts shifted 8 px up) and NOTHING else happens: no focus, no resize. Before the
// layout audit nothing noticed it; now every case must be put right within a few seconds.
//
//   node scripts/layout-audit-live.mjs <path-to-app.exe>
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const exe = process.argv[2]
if (!exe) {
  console.error('usage: node scripts/layout-audit-live.mjs <app.exe>')
  process.exit(2)
}
const local = join(process.env.LOCALAPPDATA, 'com.nebula.browser.perf')
const ps = (script) => spawnSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
const win32 = `
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices;
public class W {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  public static uint ForegroundPid() { uint p; GetWindowThreadProcessId(GetForegroundWindow(), out p); return p; }
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  public static IntPtr Top(uint pid) { IntPtr f = IntPtr.Zero; EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p != pid) return true; var c = new StringBuilder(128); GetClassName(h, c, 128); if (c.ToString() == "Tauri Window") { var t = new StringBuilder(128); GetWindowText(h, t, 128); if (t.ToString() == "Nebula") { f = h; return false; } } return true; }, IntPtr.Zero); return f; }
  // Direct children that are webview hosts, top of z-order first.
  public static string Children(uint pid) {
    var sb = new StringBuilder(); IntPtr top = Top(pid); if (top == IntPtr.Zero) return "no window";
    RECT t; GetWindowRect(top, out t); sb.Append("top:" + t.L + "," + t.T + "," + (t.R - t.L) + "," + (t.B - t.T) + ";");
    int i = 0;
    EnumChildWindows(top, (ch, l) => { if (GetParent(ch) != top) return true; var cc = new StringBuilder(128); GetClassName(ch, cc, 128); if (cc.ToString() == "WRY_WEBVIEW") { RECT q; GetWindowRect(ch, out q); sb.Append("wv" + i + ":" + q.L + "," + q.T + "," + (q.R - q.L) + "," + (q.B - q.T) + ";"); i++; } return true; }, IntPtr.Zero);
    return sb.ToString();
  }
  // Moves every webview host of the given height by (dx, dy) in parent coordinates (the window is maximized: client origin = screen 0,0).
  public static int ShiftByHeight(uint pid, int height, int dx, int dy) {
    IntPtr top = Top(pid); int moved = 0;
    EnumChildWindows(top, (ch, l) => { if (GetParent(ch) != top) return true; var cc = new StringBuilder(128); GetClassName(ch, cc, 128); if (cc.ToString() == "WRY_WEBVIEW") { RECT q; GetWindowRect(ch, out q); if (q.B - q.T == height && q.L > -100) { SetWindowPos(ch, IntPtr.Zero, q.L + dx, q.T + dy, q.R - q.L, q.B - q.T, 0x14); moved++; } } return true; }, IntPtr.Zero);
    return moved;
  }
}
"@
`
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`)
}
const measure = (pid) => ps(`${win32}; [W]::Children(${pid})`).stdout.trim()
/** Webview hosts as [x, y, width, height] in window client coordinates, parked (far off-screen) ones left out. */
const hosts = (text) =>
  text
    .split(';')
    .filter((part) => part.startsWith('wv'))
    .map((part) => part.split(':')[1].split(',').map(Number))
    .filter(([x]) => x > -100)
const killAll = () =>
  ps(`Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '${exe.split('/').join(String.fromCharCode(92))}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`)

async function scenario(name, shiftedHeights) {
  killAll()
  await sleep(2000)
  rmSync(local, { recursive: true, force: true })
  const page = createServer((request, response) => {
    response.setHeader('content-type', 'text/html')
    response.end('<!doctype html><title>Tall</title><body style="margin:0"><div style="background:#fa0;height:60px">TOP</div><div style="height:3000px">tall</div></body>')
  })
  await new Promise((resolve) => page.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${page.address().port}/`
  const first = spawn(exe, [], { stdio: 'ignore' })
  const pid = first.pid
  try {
    await sleep(9000)
    ps(`${win32}; [W]::ShowWindow([W]::Top(${pid}), 3) | Out-Null`)
    // A link from outside; if the running app was not ready for it yet, hand it over again.
    spawn(exe, [url], { stdio: 'ignore' })
    let normal = []
    for (let waited = 0; waited < 30_000; waited += 1000) {
      await sleep(1000)
      normal = hosts(measure(pid))
      if (normal.length >= 3) break
      if (waited === 12_000) spawn(exe, [url], { stdio: 'ignore' })
    }
    await sleep(2000)
    normal = hosts(measure(pid))
    check(`${name}: a site is shown (overlay strip, tab and shell are laid out)`, normal.length >= 3 && normal.some(([, , , height]) => height === 10), JSON.stringify(normal))
    const moved = shiftedHeights
      .map((height) => ps(`${win32}; [W]::ShiftByHeight(${pid}, ${height}, 0, -8)`).stdout.trim())
      .join(',')
    const broken = hosts(measure(pid))
    check(`${name}: the layout really is wrong now`, broken.some(([, y]) => y === -8), `${JSON.stringify(broken)} moved ${moved}`)
    let healedAfter = null
    const started = Date.now()
    while (Date.now() - started < 10_000) {
      await sleep(500)
      const now = hosts(measure(pid))
      if (now.length >= 3 && now.every(([x, y]) => x === 0 && y === 0)) {
        healedAfter = Date.now() - started
        break
      }
    }
    check(
      `${name}: with no event at all, Windows' layout is put right`,
      healedAfter !== null,
      healedAfter === null ? JSON.stringify(hosts(measure(pid))) : `${(healedAfter / 1000).toFixed(1)}s`,
    )
    const final = hosts(measure(pid))
    check(
      `${name}: sizes are right again (strip 10 px, tab and shell fill the client area)`,
      final.some(([, , , height]) => height === 10) && final.filter(([, , width, height]) => width === 1920 && height === 1032).length >= 2,
      JSON.stringify(final),
    )
  } finally {
    killAll()
    page.close()
  }
}

await scenario('overlay and tab', [10, 1032])
await scenario('overlay only', [10])
await scenario('tab only', [1032])
const failed = results.filter((r) => !r.ok)
console.log(failed.length === 0 ? '\nALL CHECKS PASSED' : `\n${failed.length} CHECK(S) FAILED`)
process.exit(failed.length === 0 ? 0 : 1)
