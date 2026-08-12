param(
  [string]$ExePath = "",
  [string]$ExpectedSha256 = "",
  [int]$StartupTimeoutSeconds = 15,
  [int]$StabilitySeconds = 5
)

$ErrorActionPreference = "Stop"

function Resolve-NebulaExe {
  param(
    [string]$ExplicitPath,
    [string]$RepositoryRoot
  )

  if ($ExplicitPath) {
    $candidate = if ([System.IO.Path]::IsPathRooted($ExplicitPath)) {
      $ExplicitPath
    } else {
      Join-Path $RepositoryRoot $ExplicitPath
    }
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
      throw "Executable not found: $candidate"
    }
    return (Resolve-Path -LiteralPath $candidate).Path
  }

  $candidate = Join-Path $RepositoryRoot "src-tauri\target\x86_64-pc-windows-msvc\release\app.exe"
  if (Test-Path -LiteralPath $candidate -PathType Leaf) {
    return (Resolve-Path -LiteralPath $candidate).Path
  }

  throw "Target-specific Nebula release executable not found: $candidate. Run npm run tauri:build:binary first, or pass -ExePath."
}

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$exe = Resolve-NebulaExe -ExplicitPath $ExePath -RepositoryRoot $repoRoot
$actualSha256 = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash
if ($ExpectedSha256 -and $actualSha256 -ine $ExpectedSha256) {
  throw "Release artifact SHA256 mismatch. Expected $ExpectedSha256 but found $actualSha256 at $exe."
}

Write-Host "Nebula native smoke started."
Write-Host "Executable: $exe"
Write-Host "SHA256: $actualSha256"

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
