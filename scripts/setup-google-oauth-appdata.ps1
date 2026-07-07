# Copy Google OAuth secret into AppData for installed Nebula builds.
param(
  [string]$SourceEnv = (Join-Path (Split-Path $PSScriptRoot -Parent) ".env")
)

$ErrorActionPreference = "Stop"
$targetDir = Join-Path $env:LOCALAPPDATA "com.nebula.browser"
$targetPath = Join-Path $targetDir ".env"

if (-not (Test-Path $SourceEnv)) {
  throw "Source .env not found: $SourceEnv"
}

$lines = Get-Content $SourceEnv
$secret = ($lines | Where-Object { $_ -match '^\s*GOOGLE_CLIENT_SECRET\s*=' } | Select-Object -Last 1)
$clientId = ($lines | Where-Object { $_ -match '^\s*VITE_GOOGLE_CLIENT_ID\s*=' } | Select-Object -Last 1)

if (-not $secret) {
  throw "GOOGLE_CLIENT_SECRET not found in $SourceEnv"
}

if (-not (Test-Path $targetDir)) {
  New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
}

$content = @($secret)
if ($clientId) {
  $desktopId = $clientId -replace '^\s*VITE_GOOGLE_CLIENT_ID\s*=\s*', 'GOOGLE_CLIENT_ID='
  $content = @($desktopId, $secret)
}

Set-Content -Path $targetPath -Value $content -Encoding utf8
Write-Host "Wrote Google OAuth config to:"
Write-Host "  $targetPath"
Write-Host "Restart Nebula and try Google sign-in again."
