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
$clientIdLine = ($lines | Where-Object { $_ -match '^\s*VITE_GOOGLE_CLIENT_ID\s*=' } | Select-Object -Last 1)
$clientSecretLine = ($lines | Where-Object { $_ -match '^\s*GOOGLE_CLIENT_SECRET\s*=' } | Select-Object -Last 1)

if (-not $clientIdLine) {
  throw "VITE_GOOGLE_CLIENT_ID not found in $SourceEnv"
}
if (-not $clientSecretLine) {
  throw "GOOGLE_CLIENT_SECRET not found in $SourceEnv"
}

$clientId = ($clientIdLine -replace '^\s*VITE_GOOGLE_CLIENT_ID\s*=\s*', '').Trim()
$clientSecret = ($clientSecretLine -replace '^\s*GOOGLE_CLIENT_SECRET\s*=\s*', '').Trim()

if (-not $clientId) {
  throw "VITE_GOOGLE_CLIENT_ID is empty in $SourceEnv"
}
if (-not $clientSecret) {
  throw "GOOGLE_CLIENT_SECRET is empty in $SourceEnv"
}

if (-not (Test-Path $targetDir)) {
  New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
}

$content = @(
  "GOOGLE_CLIENT_ID=$clientId",
  "GOOGLE_CLIENT_SECRET=$clientSecret"
)

Set-Content -Path $targetPath -Value $content -Encoding utf8
Write-Host "Wrote Google OAuth native config to:"
Write-Host "  $targetPath"
Write-Host "Restart Nebula and try Google sign-in again."
