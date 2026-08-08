# Nebula Release Test Matrix

This is the release-gate sequence for Windows builds.

## 1. Before building/publishing

```powershell
npm run release:preflight
npm run test:release-smoke
```

`release:preflight` checks version consistency across `package.json`, `tauri.conf.json`, and `Cargo.toml`, plus NSIS/updater configuration.

## 2. Build updater-signed release artifacts

Use the existing release script:

```powershell
.\scripts\publish-release.ps1 -Version 1.0.1 -Notes "..."
```

Then require the generated installer and current manifest:

```powershell
node scripts/release-preflight.mjs --require-artifacts --require-current-manifest
```

## 3. Truly clean Windows installation

Preferred when Windows Sandbox is available:

```powershell
npm run test:clean-sandbox
```

The sandbox is disposable. Nebula is silently installed, launched, checked for an actual window/early crash, uninstalled, and the sandbox shuts down. The log is written to `.release-test/clean-install.log`.

On Windows Home or a VM instead:

```powershell
npm run test:clean-install -- -InstallerPath ".\release\Nebula_1.0.1_x64-setup.exe"
```

The local clean-install script intentionally aborts if Nebula is already installed, so it will not overwrite a real development/user installation.

## 4. Installer upgrade scenario

Keep two installer versions and run this inside a clean VM:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\upgrade-install-smoke.ps1 `
  -FromInstaller ".\release\Nebula_1.0.0_x64-setup.exe" `
  -ToInstaller ".\release\Nebula_1.0.1_x64-setup.exe"
```

This verifies old install -> launch -> new installer over old install -> launch.

## 5. After publishing the GitHub release

```powershell
npm run test:updater-remote
```

This verifies the public `latest.json`, updater signature field, versioned NSIS URL, and that the release asset is reachable.

## 6. Final in-app updater test (manual gate)

Do this once for release candidates because it verifies the real Tauri updater UI path:

1. Install the previous public Nebula version.
2. Keep a harmless piece of state (for example a setting or pinned site).
3. Publish the new release and `latest.json`.
4. Open Nebula and trigger/check the update prompt.
5. Install the update from Nebula.
6. Confirm Nebula relaunches on the new version.
7. Confirm the saved state is still present.
8. Confirm Settings -> About reports the new version.

The remote smoke test covers the server/manifest contract; this last test covers the full updater plugin + relaunch + state-preservation path.
