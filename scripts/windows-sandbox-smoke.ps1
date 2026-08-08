param(
  [string]$InstallerPath
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
. (Join-Path $PSScriptRoot 'release-test-lib.ps1')

$sandboxExe = Join-Path $env:WINDIR 'System32\WindowsSandbox.exe'
if (-not (Test-Path $sandboxExe)) {
  throw 'Windows Sandbox is not available. Enable Windows Sandbox (Windows Pro/Enterprise) or run clean-install-smoke.ps1 inside a clean VM.'
}

$installer = Resolve-NebulaInstaller -Root $root -InstallerPath $InstallerPath
$rootResolved = (Resolve-Path $root).Path.TrimEnd('\\')
$installerResolved = (Resolve-Path $installer).Path
if (-not $installerResolved.StartsWith($rootResolved, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'For Windows Sandbox testing, the installer must be inside the Nebula project folder.'
}
$relativeInstaller = $installerResolved.Substring($rootResolved.Length).TrimStart('\\')
$sandboxInstaller = 'C:\NebulaProject\' + $relativeInstaller

$resultDir = Join-Path $root '.release-test'
New-Item -ItemType Directory -Force -Path $resultDir | Out-Null
$statusPath = Join-Path $resultDir 'status.txt'
$logPath = Join-Path $resultDir 'clean-install.log'
Remove-Item $statusPath, $logPath -Force -ErrorAction SilentlyContinue

$runner = @"
`$ErrorActionPreference = 'Stop'
`$log = 'C:\NebulaResults\clean-install.log'
try {
  & 'C:\NebulaProject\scripts\clean-install-smoke.ps1' -InstallerPath '$sandboxInstaller' *>&1 | Tee-Object -FilePath `$log
  'PASS' | Set-Content -Path 'C:\NebulaResults\status.txt' -Encoding ASCII
} catch {
  (`$_ | Out-String) | Add-Content -Path `$log
  'FAIL' | Set-Content -Path 'C:\NebulaResults\status.txt' -Encoding ASCII
}
Start-Sleep -Seconds 2
shutdown.exe /s /t 0
"@
$runnerPath = Join-Path $resultDir 'sandbox-runner.ps1'
[System.IO.File]::WriteAllText($runnerPath, $runner, (New-Object System.Text.UTF8Encoding($false)))

$escapedRoot = [System.Security.SecurityElement]::Escape($rootResolved)
$escapedResults = [System.Security.SecurityElement]::Escape((Resolve-Path $resultDir).Path)
$config = @"
<Configuration>
  <Networking>Default</Networking>
  <MappedFolders>
    <MappedFolder>
      <HostFolder>$escapedRoot</HostFolder>
      <SandboxFolder>C:\NebulaProject</SandboxFolder>
      <ReadOnly>true</ReadOnly>
    </MappedFolder>
    <MappedFolder>
      <HostFolder>$escapedResults</HostFolder>
      <SandboxFolder>C:\NebulaResults</SandboxFolder>
      <ReadOnly>false</ReadOnly>
    </MappedFolder>
  </MappedFolders>
  <LogonCommand>
    <Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\NebulaResults\sandbox-runner.ps1</Command>
  </LogonCommand>
</Configuration>
"@
$configPath = Join-Path $resultDir 'nebula-clean-install.wsb'
[System.IO.File]::WriteAllText($configPath, $config, (New-Object System.Text.UTF8Encoding($false)))

Write-Host 'Starting a disposable Windows Sandbox clean-install test...'
$proc = Start-Process -FilePath $sandboxExe -ArgumentList ('"' + $configPath + '"') -PassThru
$proc.WaitForExit()

if (-not (Test-Path $statusPath)) {
  throw "Sandbox closed without a test result. Check: $logPath"
}
$status = (Get-Content $statusPath -Raw).Trim()
if ($status -ne 'PASS') {
  Write-Host (Get-Content $logPath -Raw)
  throw 'WINDOWS SANDBOX CLEAN INSTALL FAIL'
}
Write-Host (Get-Content $logPath -Raw)
Write-Host '✓ WINDOWS SANDBOX CLEAN INSTALL PASS'
