param(
  [Parameter(Mandatory=$true)][string]$FromInstaller,
  [Parameter(Mandatory=$true)][string]$ToInstaller,
  [int]$LaunchSeconds = 6,
  [switch]$KeepInstalled
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'release-test-lib.ps1')

if (Get-NebulaInstallEntry) {
  throw 'A Nebula installation already exists. Run the upgrade test in a clean VM/Windows Sandbox.'
}
Assert-NoNebulaProcess

$installed = $false
try {
  Invoke-NebulaInstaller -InstallerPath $FromInstaller
  $fromEntry = Wait-NebulaInstallEntry
  if (-not $fromEntry) { throw 'Old-version installer did not register Nebula.' }
  $installed = $true
  $fromVersion = [string]$fromEntry.DisplayVersion
  $oldExe = Get-NebulaExePath -InstallEntry $fromEntry
  if (-not $oldExe) { throw 'Old-version Nebula.exe not found.' }
  Write-Host "✓ Base version installed: $fromVersion"
  Test-NebulaLaunch -ExePath $oldExe -Seconds 3

  Invoke-NebulaInstaller -InstallerPath $ToInstaller
  $toEntry = Wait-NebulaInstallEntry
  if (-not $toEntry) { throw 'New-version installer did not register Nebula.' }
  $toVersion = [string]$toEntry.DisplayVersion
  if ($fromVersion -and $toVersion -and $fromVersion -eq $toVersion) {
    Write-Warning "DisplayVersion did not change ($toVersion). Make sure the two installers are actually different versions."
  } else {
    Write-Host "✓ Registry version changed: $fromVersion -> $toVersion"
  }
  $newExe = Get-NebulaExePath -InstallEntry $toEntry
  if (-not $newExe) { throw 'Upgraded Nebula.exe not found.' }
  Test-NebulaLaunch -ExePath $newExe -Seconds $LaunchSeconds
  Write-Host '✓ IN-PLACE UPGRADE SMOKE PASS'
} finally {
  if ($installed -and -not $KeepInstalled) {
    Invoke-NebulaUninstall -InstallEntry (Get-NebulaInstallEntry)
  }
}
