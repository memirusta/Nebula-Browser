# One-time setup: generate Tauri updater signing keys and patch tauri.conf.json pubkey.
param(
  [string]$KeyPath = (Join-Path $env:USERPROFILE ".tauri\nebula.key")
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$confPath = Join-Path $root "src-tauri\tauri.conf.json"
$keyDir = Split-Path $KeyPath -Parent

if (-not (Test-Path $keyDir)) {
  New-Item -ItemType Directory -Force -Path $keyDir | Out-Null
}

if (-not (Test-Path $KeyPath)) {
  Write-Host "Generating updater signing key at $KeyPath"
  Push-Location $root
  npx tauri signer generate -w $KeyPath -f
  Pop-Location
}

$pubPath = "$KeyPath.pub"
if (-not (Test-Path $pubPath)) {
  throw "Public key not found: $pubPath"
}

$pubkey = (Get-Content $pubPath -Raw).Trim()
$conf = Get-Content $confPath -Raw
$escaped = [regex]::Escape($pubkey)
if ($conf -match '"pubkey"\s*:\s*"([^"]*)"') {
  $conf = $conf -replace '"pubkey"\s*:\s*"[^"]*"', "`"pubkey`": `"$pubkey`""
} else {
  throw "plugins.updater.pubkey not found in tauri.conf.json"
}

Set-Content -Path $confPath -Value $conf -NoNewline
Write-Host "Updated pubkey in tauri.conf.json"
Write-Host "Private key (keep safe, never commit): $KeyPath"
Write-Host "Set before build:"
Write-Host "  `$env:TAURI_SIGNING_PRIVATE_KEY = `"$KeyPath`""
