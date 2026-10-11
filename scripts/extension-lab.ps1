# Extension Lab: an isolated Nebula instance for trying extensions live.
#
# It uses its own app identifier (com.nebula.browser.extensionlab), so it has its
# own AppData folder, WebView2 profile, settings and extension profile. Your
# normal Nebula profile is never read or written.
#
#   .\scripts\extension-lab.ps1 status          what exists right now
#   .\scripts\extension-lab.ps1 setup           download + install the lab extensions
#   .\scripts\extension-lab.ps1 build           build the lab app (debug, separate identity)
#   .\scripts\extension-lab.ps1 run             start the lab app
#   .\scripts\extension-lab.ps1 diagnose         run installed extensions and record what they report
#   .\scripts\extension-lab.ps1 audit          open every page of every installed extension and check its window
#   .\scripts\extension-lab.ps1 audit -Ids bitwarden   the same, for extensions whose name contains the text
#   .\scripts\extension-lab.ps1 reset -Yes      delete the lab profile and start over
param(
  [ValidateSet('status', 'setup', 'build', 'run', 'diagnose', 'audit', 'reset')]
  [string]$Action = 'status',
  [switch]$Yes,
  # run: start without the evidence trace (see extension_trace.rs)
  [switch]$NoTrace,
  # diagnose: comma-separated Chrome Web Store ids (default: Claude); audit: part of an extension's name
  [string]$Ids = ''
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$tauri = Join-Path $repo 'src-tauri'
$identifier = 'com.nebula.browser.extensionlab'
$profile = Join-Path $env:LOCALAPPDATA $identifier
$exe = Join-Path $tauri 'target\debug\app.exe'
$contextMarker = Join-Path $tauri 'target\extension-lab-context.txt'

# A process started from a packaged (MSIX) app, such as the Microsoft Store
# PowerShell, Windows Terminal or the Claude desktop app, has its writes under
# %LOCALAPPDATA% redirected into that package's private store. The profile
# `setup` creates is then invisible to a process started from any other context
# (for example a double-click in Explorer). Setup and run must share a context.
Add-Type -Namespace Nebula -Name Pkg -MemberDefinition '[DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern int GetCurrentPackageFullName(ref int length, System.Text.StringBuilder name);' -ErrorAction SilentlyContinue
function Get-PackageContext {
  $length = 0
  if ([Nebula.Pkg]::GetCurrentPackageFullName([ref]$length, $null) -ne 122) { return 'unpackaged' }
  $name = New-Object System.Text.StringBuilder $length
  [void][Nebula.Pkg]::GetCurrentPackageFullName([ref]$length, $name)
  return $name.ToString()
}

function Show-Status {
  Write-Host "This terminal: $(Get-PackageContext)"
  if (Test-Path $contextMarker) { Write-Host "Setup ran in:  $((Get-Content $contextMarker -Raw).Trim())" }
  Write-Host "Lab app:$(if (Test-Path $exe) { "$exe ($((Get-Item $exe).LastWriteTime))" } else { 'not built (run: build)' })"
  Write-Host "Lab profile:  $(if (Test-Path $profile) { $profile } else { 'not created yet (run: setup)' })"
  $installed = Join-Path $profile 'extensions'
  if (Test-Path $installed) {
    $count = @(Get-ChildItem $installed -Directory -ErrorAction SilentlyContinue).Count
    Write-Host "Installed:    $count extension folders under $installed"
  }
  $running = Get-Process -Name app -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe }
  Write-Host "Running:      $(if ($running) { "yes (PID $($running.Id))" } else { 'no' })"
}

switch ($Action) {
  'status' { Show-Status }
  'setup' {
    Push-Location $tauri
    try {
      cargo test --offline --features extension-native-smoke native_extension_lab_setup -- --ignored --nocapture
      if ($LASTEXITCODE -eq 0) {
        Get-PackageContext | Set-Content -Path $contextMarker -Encoding utf8
        Write-Host "Setup finished in context: $(Get-PackageContext). Start the lab from THIS terminal: .\scripts\extension-lab.ps1 run"
      }
    } finally { Pop-Location }
  }
  'build' {
    Push-Location $repo
    try {
      # Host-triple debug build: reuses the already-compiled dependencies and never
      # touches the release app.exe of a running normal Nebula.
      npx.cmd tauri build --debug --no-bundle --config src-tauri/tauri.extensionlab.conf.json
    } finally { Pop-Location }
    Show-Status
  }
  'run' {
    if (-not (Test-Path $exe)) { throw "Lab app not built. Run: .\scripts\extension-lab.ps1 build" }
    if (-not (Test-Path $contextMarker)) { throw 'Run setup first: .\scripts\extension-lab.ps1 setup' }
    $setupContext = (Get-Content $contextMarker -Raw).Trim()
    if ($setupContext -ne (Get-PackageContext)) {
      throw "Setup ran in '$setupContext' but this terminal is '$(Get-PackageContext)'. The lab profile is not visible from here. Run setup again from this terminal, or run the lab from the terminal where setup ran."
    }
    # Evidence trace of what extension pages and their frames report (see
    # extension_trace.rs). Only this launched process inherits the variable.
    $trace = Join-Path $profile 'extension-trace.log'
    New-Item -ItemType Directory -Force -Path $profile | Out-Null
    if (-not $NoTrace) { $env:NEBULA_EXTENSION_TRACE = $trace }
    $labApp = $null
    try { $labApp = Start-Process -FilePath $exe -PassThru } finally { Remove-Item Env:NEBULA_EXTENSION_TRACE -ErrorAction SilentlyContinue }
    # Records the lab's memory (the app and every WebView2 process it started) every
    # 10 seconds, so a spike can be traced to a process. It stops when the app exits.
    $memoryLog = Join-Path $profile 'lab-memory.log'
    Start-Process -FilePath (Get-Process -Id $PID).Path -WindowStyle Hidden -ArgumentList @(
      '-NoProfile', '-File', (Join-Path $PSScriptRoot 'extension-lab-memory.ps1'), '-AppPid', $labApp.Id, '-Log', $memoryLog
    ) | Out-Null
    Write-Host "Started the Extension Lab ($identifier). Your normal Nebula is unaffected."
    Write-Host "Extension trace: $(if ($NoTrace) { 'off' } else { $trace })"
    Write-Host "Memory log:      $memoryLog"
  }
  'diagnose' {
    if (-not (Test-Path $contextMarker)) { throw 'Run setup first: .\scripts\extension-lab.ps1 setup' }
    $setupContext = (Get-Content $contextMarker -Raw).Trim()
    if ($setupContext -ne (Get-PackageContext)) {
      throw "Setup ran in '$setupContext' but this terminal is '$(Get-PackageContext)'. The lab profile is not visible from here."
    }
    if (Get-Process -Name app -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe }) {
      throw 'Close the Extension Lab app first: the diagnosis needs the profile to itself.'
    }
    if ($Ids) { $env:NEBULA_LAB_DIAGNOSE = $Ids }
    Push-Location $tauri
    try {
      cargo test --offline --features extension-native-smoke native_extension_lab_diagnose -- --ignored --nocapture
      Write-Host "Report: $(Join-Path $tauri 'target\extension-lab-diagnose.json')"
    } finally { Pop-Location; Remove-Item Env:NEBULA_LAB_DIAGNOSE -ErrorAction SilentlyContinue }
  }
  'audit' {
    # A generic check of extension windows (popup, options, side panel) against rules
    # that must hold for ANY extension: frameless popups, no scroll bars on a page
    # that fits, nothing cut off, no empty space, the page drew something. It works on
    # COPIES in a temporary profile, so it is safe while nothing else uses the lab.
    $extensions = Join-Path $profile 'extensions'
    if (-not (Test-Path $extensions)) { throw 'No extensions installed yet. Run setup first.' }
    $env:NEBULA_AUDIT_EXTENSIONS_DIR = $extensions
    if ($Ids) { $env:NEBULA_AUDIT_ONLY = $Ids }
    Push-Location $tauri
    try {
      cargo test --offline --features extension-native-smoke native_extension_pages_audit -- --ignored --nocapture
      Write-Host "Report: $(Join-Path $tauri 'target\extension-pages-audit.json')"
    } finally {
      Pop-Location
      Remove-Item Env:NEBULA_AUDIT_EXTENSIONS_DIR -ErrorAction SilentlyContinue
      Remove-Item Env:NEBULA_AUDIT_ONLY -ErrorAction SilentlyContinue
    }
  }
  'reset' {
    if ($profile -notmatch [regex]::Escape($identifier) + '$') { throw 'Refusing to delete an unexpected path.' }
    if (-not $Yes) { throw "This deletes $profile. Re-run with -Yes to confirm." }
    $running = Get-Process -Name app -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe }
    if ($running) { throw 'Close the Extension Lab app first.' }
    if (Test-Path $profile) { Remove-Item -LiteralPath $profile -Recurse -Force }
    Write-Host 'Lab profile deleted.'
  }
}
