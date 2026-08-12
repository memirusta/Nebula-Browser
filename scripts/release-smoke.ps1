param(
  [int]$StartupTimeoutSeconds = 15,
  [int]$StabilitySeconds = 5
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$artifact = Join-Path $repoRoot "src-tauri\target\x86_64-pc-windows-msvc\release\app.exe"

function Invoke-NpmScript {
  param([string]$Name)

  & npm.cmd run $Name
  if ($LASTEXITCODE -ne 0) {
    throw "npm script '$Name' failed with exit code $LASTEXITCODE."
  }
}

Push-Location $repoRoot
try {
  Invoke-NpmScript "test:e2e"
  Invoke-NpmScript "tauri:build:binary"

  if (-not (Test-Path -LiteralPath $artifact -PathType Leaf)) {
    throw "Expected release artifact was not produced: $artifact"
  }

  $resolvedArtifact = (Resolve-Path -LiteralPath $artifact).Path
  $artifactSha256 = (Get-FileHash -LiteralPath $resolvedArtifact -Algorithm SHA256).Hash
  Write-Host "Release smoke artifact: $resolvedArtifact"
  Write-Host "Release smoke SHA256: $artifactSha256"

  & (Join-Path $PSScriptRoot "native-smoke.ps1") `
    -ExePath $resolvedArtifact `
    -ExpectedSha256 $artifactSha256 `
    -StartupTimeoutSeconds $StartupTimeoutSeconds `
    -StabilitySeconds $StabilitySeconds
} finally {
  Pop-Location
}
