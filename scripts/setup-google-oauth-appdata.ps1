# Copy the Google OAuth desktop client ID into AppData for installed Nebula builds.
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
$clientId = ($lines | Where-Object { $_ -match '^\s*VITE_GOOGLE_CLIENT_ID\s*=' } | Select-Object -Last 1)

if (-not $clientId) {
  throw "VITE_GOOGLE_CLIENT_ID not found in $SourceEnv"
}

if (-not (Test-Path $targetDir)) {
  New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
}

$desktopId = $clientId -replace '^\s*VITE_GOOGLE_CLIENT_ID\s*=\s*', 'GOOGLE_CLIENT_ID='
$content = @($desktopId)

Set-Content -Path $targetPath -Value $content -Encoding utf8
Write-Host "Wrote Google OAuth config to:"
Write-Host "  $targetPath"
Write-Host "Restart Nebula and try Google sign-in again."
