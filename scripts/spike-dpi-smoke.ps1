# DPI smoke for the split shell (spike). Run it once per Windows display scale:
#   Settings > System > Display > Scale: 100%, 125%, 150%   (then run this again)
#
#   .\scripts\spike-dpi-smoke.ps1                 split shell (the proposal)
#   .\scripts\spike-dpi-smoke.ps1 -Mode baseline  today's single environment, for comparison
#
# It starts the spike build under its own test identity (com.nebula.browser.perf; your
# normal Nebula and its profile are not touched), opens tabs, minimizes and restores the
# window five times, opens a popup, toggles F11 with the real key, and prints one
# PASS/FAIL line per check together with the scale factor the app actually saw.
# Keep the machine idle for about two minutes: it brings its own window to the front and
# sends keys only while that window is in the foreground.
param(
  [ValidateSet('split', 'baseline')][string]$Mode = 'split',
  [string]$Exe = (Join-Path $PSScriptRoot '..\src-tauri\target\x86_64-pc-windows-msvc\release\app.exe')
)
$ErrorActionPreference = 'Stop'
$Exe = (Resolve-Path $Exe).Path
$dismiss = Join-Path $env:TEMP 'nebula-spike-dismiss.js'
@"
(() => {
  const button = [...document.querySelectorAll('button')].find((b) => /Not now|Şimdi değil|Hayır/i.test(b.textContent || ''));
  if (button) { button.click(); return 'dismissed'; }
  return 'no-dialog';
})()
"@ | Set-Content -Path $dismiss -Encoding utf8
$out = Join-Path $env:TEMP "nebula-spike-dpi-$Mode.json"
if (Test-Path $out) { Remove-Item $out -Force }
$env:NEBULA_SPIKE_DRIVER = 'dpi'; $env:NEBULA_SPIKE_OUT = $out
$env:NEBULA_SPIKE_SCRIPTS = $PSScriptRoot; $env:NEBULA_SPIKE_SPLIT = $(if ($Mode -eq 'split') { '1' } else { '0' })
$env:NEBULA_SPIKE_PHASES = 'startup,eval,tabs3,minrestore,popup,f11'
$env:NEBULA_SPIKE_EVAL = $dismiss; $env:NEBULA_SPIKE_EVAL_WAIT = '1'; $env:NEBULA_SPIKE_EVAL_GAP = '2'
$process = Start-Process -FilePath $Exe -PassThru
if (-not $process.WaitForExit(300000)) { Stop-Process -Id $process.Id -Force; Write-Host 'The run did not finish in 5 minutes.' }
foreach ($name in 'NEBULA_SPIKE_DRIVER', 'NEBULA_SPIKE_OUT', 'NEBULA_SPIKE_SCRIPTS', 'NEBULA_SPIKE_SPLIT', 'NEBULA_SPIKE_PHASES', 'NEBULA_SPIKE_EVAL', 'NEBULA_SPIKE_EVAL_WAIT', 'NEBULA_SPIKE_EVAL_GAP') { Set-Item "Env:$name" $null }
if (-not (Test-Path $out)) { throw 'No report was written.' }
$r = Get-Content $out -Raw | ConvertFrom-Json

function Check([string]$name, $ok, [string]$detail = '') {
  '{0,-4} {1}{2}' -f $(if ($ok) { 'PASS' } else { 'FAIL' }), $name, $(if ($detail) { "  ($detail)" } else { '' })
}
$scale = $r.startup.startup.window.scale
"Mode: $Mode    scale factor seen by the app: $scale ($([math]::Round($scale * 100))%)    monitor: $($r.startup.startup.window.monitorPhysical -join 'x')"
Check 'a tab opens above the shell and fills it' ($r.tabs3.threeTabs.zTopToBottom.Count -gt 0 -and $r.minrestore.settledInvariants.tabVisible -and $r.minrestore.settledInvariants.tabFillsMain -and $r.minrestore.settledInvariants.tabAboveMain)
Check 'the chrome overlay is above the tab' ([bool]$r.minrestore.settledInvariants.chromeAboveTab)
$held = @($r.minrestore.cycles | Where-Object { $_.invariantsHold }).Count
Check 'minimize and restore x5 keep the layout' ($held -eq 5) "$held/5"
Check 'the popup opens and closes cleanly' ($r.popup.contentCreated -and $r.popup.contentGoneAfterClose)
Check 'F11 enters full screen' ([bool]$r.f11.entered) "$([math]::Round($r.f11.enterSeconds, 1))s via $($r.f11.enteredVia)"
Check 'F11 leaves full screen and the layout is back' ([bool]($r.f11.exited -and $r.f11.invariantsOffHold)) "$([math]::Round($r.f11.exitSeconds, 1))s"
if ($Mode -eq 'split') {
  $u = $r.startup.startup.facts.main.udf
  Check 'the shell runs in the trusted environment' ($u -match 'trusted') $u
  Check 'the popup content is in the browsing environment' ($r.popup.facts.udf -notmatch 'trusted') $r.popup.facts.udf
}
Write-Host "Full report: $out"
