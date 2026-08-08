param(
  [string]$InstallerPath,
  [int]$LaunchSeconds = 8,
  [switch]$KeepInstalled
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
. (Join-Path $PSScriptRoot 'release-test-lib.ps1')

$installer = Resolve-NebulaInstaller -Root $root -InstallerPath $InstallerPath
$existing = Get-NebulaInstallEntry
if ($existing) {
  throw "A Nebula installation already exists (version $($existing.DisplayVersion)). This test intentionally refuses to overwrite a real installation. Use a clean VM/Windows Sandbox."
}
Assert-NoNebulaProcess

$installed = $false
try {
  Invoke-NebulaInstaller -InstallerPath $installer
  $entry = Wait-NebulaInstallEntry
  if (-not $entry) { throw 'Installer finished but Nebula did not appear in Windows uninstall registry.' }
  $installed = $true
  Write-Host "✓ Registered Nebula version: $($entry.DisplayVersion)"
  $exe = Get-NebulaExePath -InstallEntry $entry
  if (-not $exe) { throw 'Nebula.exe could not be found after installation.' }
  Write-Host "✓ Installed executable: $exe"
  Test-NebulaLaunch -ExePath $exe -Seconds $LaunchSeconds
  Write-Host '✓ CLEAN INSTALL SMOKE PASS'
} finally {
  if ($installed -and -not $KeepInstalled) {
    $entry = Get-NebulaInstallEntry
    Invoke-NebulaUninstall -InstallEntry $entry
  }
}
