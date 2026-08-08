$ErrorActionPreference = 'Stop'

function Get-NebulaInstallEntry {
  $paths = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )
  foreach ($path in $paths) {
    $entry = Get-ItemProperty $path -ErrorAction SilentlyContinue |
      Where-Object { $_.DisplayName -eq 'Nebula' -or $_.DisplayName -like 'Nebula *' } |
      Select-Object -First 1
    if ($entry) { return $entry }
  }
  return $null
}

function Wait-NebulaInstallEntry {
  param([int]$TimeoutSeconds = 20)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $entry = Get-NebulaInstallEntry
    if ($entry) { return $entry }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  return $null
}

function Get-NebulaExePath {
  param($InstallEntry)
  $candidates = New-Object System.Collections.Generic.List[string]
  if ($InstallEntry.InstallLocation) {
    $candidates.Add((Join-Path $InstallEntry.InstallLocation 'Nebula.exe'))
  }
  if ($InstallEntry.DisplayIcon) {
    $icon = [string]$InstallEntry.DisplayIcon
    $icon = $icon.Trim('"') -replace ',\d+$', ''
    $candidates.Add($icon)
  }
  $candidates.Add((Join-Path $env:LOCALAPPDATA 'Nebula\Nebula.exe'))
  $candidates.Add((Join-Path $env:LOCALAPPDATA 'Programs\Nebula\Nebula.exe'))
  if ($env:ProgramFiles) { $candidates.Add((Join-Path $env:ProgramFiles 'Nebula\Nebula.exe')) }

  foreach ($candidate in ($candidates | Select-Object -Unique)) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }
  return $null
}

function Assert-NoNebulaProcess {
  $running = Get-Process -Name 'Nebula' -ErrorAction SilentlyContinue
  if ($running) { throw 'Nebula is already running. Close it before running the release install test.' }
}

function Invoke-NebulaInstaller {
  param([Parameter(Mandatory=$true)][string]$InstallerPath)
  $resolved = (Resolve-Path -LiteralPath $InstallerPath).Path
  Write-Host "Installing: $resolved"
  $process = Start-Process -FilePath $resolved -ArgumentList '/S' -Wait -PassThru
  if ($process.ExitCode -ne 0 -and $process.ExitCode -ne 3010) {
    throw "Installer failed with exit code $($process.ExitCode)"
  }
}

function Test-NebulaLaunch {
  param(
    [Parameter(Mandatory=$true)][string]$ExePath,
    [int]$Seconds = 8
  )
  Write-Host "Launching: $ExePath"
  $process = Start-Process -FilePath $ExePath -PassThru
  try {
    $deadline = (Get-Date).AddSeconds($Seconds)
    $windowSeen = $false
    while ((Get-Date) -lt $deadline) {
      Start-Sleep -Milliseconds 400
      try { $process.Refresh() } catch {}
      if ($process.HasExited) { throw "Nebula exited early with code $($process.ExitCode)" }
      if ($process.MainWindowHandle -ne 0) { $windowSeen = $true }
    }
    if (-not $windowSeen) { throw 'Nebula stayed alive but no main window was detected.' }
    Write-Host '✓ Nebula window opened and remained stable.'
  } finally {
    if (-not $process.HasExited) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      $process.WaitForExit(5000) | Out-Null
    }
  }
}

function Invoke-NebulaUninstall {
  param($InstallEntry)
  if (-not $InstallEntry -or -not $InstallEntry.UninstallString) {
    Write-Warning 'Uninstall entry not found; leaving installation in place.'
    return
  }
  $raw = [string]$InstallEntry.UninstallString
  $exe = $null
  $args = ''
  if ($raw -match '^\s*"([^"]+)"\s*(.*)$') {
    $exe = $Matches[1]
    $args = $Matches[2]
  } elseif ($raw -match '^\s*(\S+)\s*(.*)$') {
    $exe = $Matches[1]
    $args = $Matches[2]
  }
  if (-not $exe) { throw "Could not parse uninstall command: $raw" }
  if ($exe -match '(?i)msiexec(\.exe)?$') {
    if ($args -notmatch '(?i)/q') { $args = "$args /qn /norestart" }
  } elseif ($args -notmatch '(?i)(^|\s)/S(\s|$)') {
    $args = "$args /S"
  }
  Write-Host 'Uninstalling test installation...'
  $p = Start-Process -FilePath $exe -ArgumentList $args.Trim() -Wait -PassThru
  if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) {
    Write-Warning "Uninstaller returned $($p.ExitCode)"
  }
}

function Resolve-NebulaInstaller {
  param([string]$Root, [string]$InstallerPath)
  if ($InstallerPath) { return (Resolve-Path -LiteralPath $InstallerPath).Path }
  $patterns = @(
    (Join-Path $Root 'release\Nebula_*_x64-setup.exe'),
    (Join-Path $Root 'src-tauri\target\x86_64-pc-windows-msvc\release\bundle\nsis\Nebula_*_x64-setup.exe')
  )
  $files = foreach ($pattern in $patterns) { Get-ChildItem -Path $pattern -File -ErrorAction SilentlyContinue }
  $latest = $files | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $latest) { throw 'No x64 Nebula NSIS installer found. Build/publish a release or pass -InstallerPath.' }
  return $latest.FullName
}
