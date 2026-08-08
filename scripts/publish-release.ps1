# Build signed Nebula installer + latest.json for GitHub Releases.
param(
  [string]$Version,
  [string]$KeyPath = (Join-Path $env:USERPROFILE ".tauri\nebula.key"),
  [string]$KeyPassword,
  [string]$Notes = "Nebula güncellemesi",
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$confPath = Join-Path $root "src-tauri\tauri.conf.json"
$releaseDir = Join-Path $root "release"

function Read-DotEnvValue {
  param(
    [string[]]$Lines,
    [string]$Name
  )
  $match = $Lines | Where-Object { $_ -match "^\s*$([regex]::Escape($Name))\s*=" } | Select-Object -Last 1
  if (-not $match) { return $null }
  return ($match -replace "^\s*$([regex]::Escape($Name))\s*=\s*", "").Trim()
}

function Import-ReleaseGoogleOAuth {
  param([string]$EnvPath)

  if (-not (Test-Path $EnvPath)) {
    Write-Warning ".env bulunamadi ($EnvPath). Google girisi installer'da calismayabilir."
    return
  }

  $lines = Get-Content $EnvPath
  $clientId = Read-DotEnvValue -Lines $lines -Name "VITE_GOOGLE_CLIENT_ID"
  $secret = Read-DotEnvValue -Lines $lines -Name "GOOGLE_CLIENT_SECRET"

  if ($clientId) {
    $env:VITE_GOOGLE_CLIENT_ID = $clientId
    $env:GOOGLE_CLIENT_ID = $clientId
  }
  if ($secret) {
  $env:GOOGLE_CLIENT_SECRET = $secret
} else {
  throw "GOOGLE_CLIENT_SECRET .env icinde bulunamadi."
}
}

if (-not $Version) {
  $pkg = Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json
  $Version = $pkg.version
}

if (-not (Test-Path $KeyPath)) {
  Write-Host "Signing key missing. Run: .\scripts\setup-updater-keys.ps1"
  exit 1
}

$pubPath = "$KeyPath.pub"
if (-not (Test-Path $pubPath)) {
  throw "Public key not found: $pubPath"
}

$pubkey = (Get-Content $pubPath -Raw).Trim()
$conf = Get-Content $confPath -Raw
if ($conf -notmatch [regex]::Escape($pubkey)) {
  Write-Host "Patching tauri.conf.json pubkey..."
  & (Join-Path $PSScriptRoot "setup-updater-keys.ps1") -KeyPath $KeyPath
}

$env:TAURI_SIGNING_PRIVATE_KEY = $KeyPath
if ($PSBoundParameters.ContainsKey('KeyPassword')) {
  $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $KeyPassword
} elseif ($env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
  # keep existing env
} else {
  $secure = Read-Host "Updater key password (Enter if none)" -AsSecureString
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  )
  $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $plain
}

$bundleDir = Join-Path $root "src-tauri\target\x86_64-pc-windows-msvc\release\bundle\nsis"
$expectedName = "Nebula_${Version}_x64-setup.exe"
$expectedPath = Join-Path $bundleDir $expectedName
$expectedSigPath = "$expectedPath.sig"

if (-not $SkipBuild) {
  # Never allow an interrupted or older build of the same version to be reused.
  Remove-Item -LiteralPath $expectedPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $expectedSigPath -Force -ErrorAction SilentlyContinue
  Import-ReleaseGoogleOAuth -EnvPath (Join-Path $root ".env")
  Push-Location $root
  try {
    Write-Host "Building Nebula v$Version (x64)..."
    npm run tauri:build:x64
    if ($LASTEXITCODE -ne 0) {
      throw "Tauri release build failed with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

$setupExe = Get-Item $expectedPath -ErrorAction SilentlyContinue
if (-not $setupExe) {
  throw "Expected NSIS installer not found: $expectedPath"
}
if ($setupExe.Length -le 0) {
  throw "NSIS installer is empty: $expectedPath"
}

$sigPath = "$($setupExe.FullName).sig"
$sigFile = Get-Item $sigPath -ErrorAction SilentlyContinue
if (-not $sigFile -or $sigFile.Length -le 0) {
  throw "Signature file not found: $sigPath (createUpdaterArtifacts enabled?)"
}

$signature = (Get-Content $sigPath -Raw).Trim()
$assetName = "Nebula_${Version}_x64-setup.exe"
$repo = "memirusta/Nebula-Browser"
$downloadUrl = "https://github.com/$repo/releases/download/v$Version/$assetName"

$latest = @{
  version = $Version
  notes = $Notes
  pub_date = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  platforms = @{
    "windows-x86_64" = @{
      signature = $signature
      url = $downloadUrl
    }
  }
} | ConvertTo-Json -Depth 6 -Compress

if (-not (Test-Path $releaseDir)) {
  New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
}

Copy-Item $setupExe.FullName (Join-Path $releaseDir $assetName) -Force
$latestPath = Join-Path $releaseDir "latest.json"
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($latestPath, $latest, $utf8NoBom)

Write-Host ""
Write-Host "Release artifacts:"
Write-Host "  $(Join-Path $releaseDir $assetName)"
Write-Host "  $(Join-Path $releaseDir 'latest.json')"
Write-Host ""
Write-Host "GitHub release v$Version icin yukle:"
Write-Host "  gh release create v$Version release\$assetName release\latest.json --repo memirusta/Nebula-Browser --title `"Nebula v$Version`" --notes `"$Notes`""
Write-Host "  veya mevcut release'e: gh release upload v$Version release\$assetName release\latest.json --repo memirusta/Nebula-Browser --clobber"
