# Starts a Nebula build with WebView2's own network log switched on, leaves it alone for a while, closes it and reports
# where the browser connected (scripts/webview2-net-audit.mjs does the reading).
#
# Use a build with its own identity (tauri.dev.conf.json or tauri.perf.conf.json) and its own target folder: the
# build starts from a fresh profile and must not be the installed Nebula, which would hand the start over to the
# running one (single instance) and measure nothing.
#
#   powershell -File scripts/webview2-net-audit.ps1 -Exe <path to the .exe> [-Minutes 10] [-OutDir <folder>]
param(
  [Parameter(Mandatory = $true)] [string]$Exe,
  [int]$Minutes = 10,
  [string]$OutDir = (Join-Path $env:TEMP 'nebula-net-audit'),
  # Pages to open once the app is up. They go through a second start of the same exe, which hands the address to the
  # running one (single instance), the way a link from another app does. Needs a profile that finished the first-run setup.
  [string[]]$Urls = @(),
  [int]$UrlGapSeconds = 45
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Exe)) { throw "Executable not found: $Exe" }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$log = Join-Path $OutDir "netlog-$stamp.json"
if ($log -match '\s') { throw "The log path must not contain spaces: $log" }

# Nebula keeps whatever is already in this variable and adds its own switch, so the log switch gets through.
$previous = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = ("$previous --log-net-log=$log --net-log-capture-mode=Default").Trim()

$process = $null
try {
  $process = Start-Process -FilePath $Exe -PassThru
  Write-Host "Started $Exe (pid $($process.Id)); the log is $log"
  Write-Host "Leave it alone for $Minutes minutes. Finishing the first-run screens in the first minute is fine."

  $deadline = (Get-Date).AddMinutes($Minutes)

  if ($Urls.Count -gt 0) {
    Start-Sleep -Seconds 30
    foreach ($url in $Urls) {
      if ($process.HasExited -or (Get-Date) -ge $deadline) { break }
      Write-Host "Opening $url"
      $handoff = Start-Process -FilePath $Exe -ArgumentList $url -PassThru
      [void]$handoff.WaitForExit(20000)
      Start-Sleep -Seconds $UrlGapSeconds
    }
  }

  while ((Get-Date) -lt $deadline -and -not $process.HasExited) {
    Start-Sleep -Seconds 15
  }
}
finally {
  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $previous
  if ($process -and -not $process.HasExited) {
    # Close the window first so that the browser can finish its log; stop it only if it does not leave.
    [void]$process.CloseMainWindow()
    if (-not $process.WaitForExit(20000)) { Stop-Process -Id $process.Id -Force }
  }
}

Start-Sleep -Seconds 3
if (-not (Test-Path $log)) { throw "No net-log was written. WebView2 did not accept --log-net-log: $log" }

$size = [math]::Round((Get-Item $log).Length / 1KB)
Write-Host "Net-log: $size KB"

$json = Join-Path $OutDir "report-$stamp.json"
node (Join-Path $PSScriptRoot 'webview2-net-audit.mjs') $log --json $json
Write-Host "Report data: $json"
