param(
  [string]$ExePath = "",
  [int]$StartupTimeoutSeconds = 15,
  [int]$StabilitySeconds = 5
)

$ErrorActionPreference = "Stop"

function Resolve-NebulaExe {
  param([string]$ExplicitPath)

  if ($ExplicitPath) {
    if (-not (Test-Path $ExplicitPath)) { throw "Executable not found: $ExplicitPath" }
    return (Resolve-Path $ExplicitPath).Path
  }

  $release = Join-Path (Get-Location) "src-tauri\target\release"
  $known = @(
    (Join-Path $release "app.exe"),
    (Join-Path $release "Nebula.exe"),
    (Join-Path $release "nebula.exe")
  )
  foreach ($candidate in $known) {
    if (Test-Path $candidate) { return (Resolve-Path $candidate).Path }
  }

  if (Test-Path $release) {
    $candidate = Get-ChildItem $release -File -Filter *.exe |
      Where-Object { $_.DirectoryName -notmatch "\\deps$" } |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1
    if ($candidate) { return $candidate.FullName }
  }

  throw "Nebula release executable not found. Run npm run tauri:build:binary first, or pass -ExePath."
}

$exe = Resolve-NebulaExe $ExePath
Write-Host "Nebula native smoke started."
Write-Host "Executable: $exe"

$process = Start-Process -FilePath $exe -PassThru
try {
  $deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
  $windowReady = $false

  do {
    Start-Sleep -Milliseconds 250
    $process.Refresh()
    if ($process.HasExited) {
      throw "Nebula exited during startup with exit code $($process.ExitCode)."
    }
    if ($process.MainWindowHandle -ne 0) {
      $windowReady = $true
      break
    }
  } while ((Get-Date) -lt $deadline)

  if (-not $windowReady) {
    throw "Nebula did not create a top-level window within $StartupTimeoutSeconds seconds."
  }

  Write-Host "[PASS] Main window created. PID: $($process.Id)"
  Start-Sleep -Seconds $StabilitySeconds
  $process.Refresh()
  if ($process.HasExited) {
    throw "Nebula crashed during the $StabilitySeconds-second stability window."
  }
  Write-Host "[PASS] Process remained alive for $StabilitySeconds seconds."
  Write-Host "Nebula native smoke: PASS"
}
finally {
  if ($process -and -not $process.HasExited) {
    try {
      $null = $process.CloseMainWindow()
      if (-not $process.WaitForExit(3000)) { Stop-Process -Id $process.Id -Force }
    } catch {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
  }
}
