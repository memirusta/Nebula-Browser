# Nebula Browser

A distraction-free, privacy-first browser shell — cyber-neural focus space with a frameless glass UI.

Built with **Tauri 2** (native shell) + **React 19** (UI). Uses the platform system WebView: **WebView2** on Windows, **WebKit** on macOS/Linux.

## Features (demo)

- Frameless home screen with draggable widgets and pinned shortcuts
- Semi-lunar radial dock for quick navigation (home, browsing, overlay)
- Multi-webview browsing on Windows (separate webview per tab)
- Quick menu overlay (search + pinned shortcuts over the active tab)
- Live RAM/CPU widgets (Tauri desktop build)
- Settings for appearance, layout, and overlay frost/blur

## Architecture

```
src/
├── components/
│   ├── BrowserShell/       # Main shell (home, browsing, overlay)
│   ├── SemiLunarMenu/      # Radial half-moon navigation (portaled to body)
│   ├── HomeCenter/         # Home view, pinned shortcuts, search
│   ├── TitleBar/           # Custom window controls
│   └── ...
├── platform/               # Tauri webview stack, browsing mode, shell layout
├── core/                   # Types, bridge IPC, settings, dock logic
└── ChromeApp.tsx           # Chrome webview entry (#chrome) — title bar only

src-tauri/                  # Rust native shell + custom webview commands
```

### Multi-webview (Windows desktop)

| Webview | Role |
|---------|------|
| `main` | BrowserShell — home, overlay, semi-lunar menu, orchestration |
| `nebula-chrome` | Custom title bar (window controls, quick-menu button) |
| `nebula-tab-*` | Per-tab site webviews (stacked below the chrome strip) |

The semi-lunar menu lives on **`main`**, not in the chrome webview. A single persistent `SemiLunarMenu` instance is portaled to `document.body` and shared across home, browsing, and overlay modes (shortcut positions sync via `localStorage`).

IPC between chrome and main uses `nebulaBridge` events (`nebula-chrome-action`, `open-quick-menu`, etc.).

On Windows, `SetWindowRgn` clips the main shell webview to a thin strip below the title bar so clicks pass through to tab webviews. Floating UI (context menus, folder panels) temporarily expands that region.

## Development

**Web prototype (browser only):**

```bash
npm install
npm run dev
```

Opens the UI in a normal browser. Tab content uses iframes instead of native webviews.

**Desktop (Tauri):**

Requires [Rust](https://rustup.rs/) and **WebView2** on Windows ([runtime](https://developer.microsoft.com/microsoft-edge/webview2/)).

```bash
npm install
npm run tauri dev
```

## Build & install (Windows demo)

Generate app icons once (from the project logo):

```bash
npx tauri icon public/icon-square.svg
```

Build installers (64-bit and 32-bit Windows):

```bash
npm run tauri:build:x64   # most PCs (64-bit Windows)
npm run tauri:build:x86   # older 32-bit Windows
```

Installer output:

```
release/Nebula_0.1.1_x64-setup.exe   # 64-bit Windows 10/11
release/Nebula_0.1.1_x86-setup.exe   # 32-bit Windows
```

**Which installer?** On the target PC open **Settings → System → About** and check **System type**:
- **64-bit** → `Nebula_0.1.1_x64-setup.exe`
- **32-bit** → `Nebula_0.1.1_x86-setup.exe`

If you see *“Bu uygulama bilgisayarınızda çalışamıyor”*, you likely need the other architecture.

**Sharing the file:** Zip the installer before sending (WhatsApp/email can corrupt `.exe` files). Send the `.zip`, then extract on the target PC.

WebView2 is required (usually preinstalled on Windows 11; Windows 10 may need the [Evergreen bootstrapper](https://developer.microsoft.com/microsoft-edge/webview2/)).

## Project backup

Latest integration snapshot: `C:\Users\mehme\Projects\nebula-backup-2026-07-07`  
(Excludes `node_modules`, `src-tauri\target`, `dist`, `.git`)

## Known limitations

- No persistent address bar while browsing (overlay search shows the active URL only)
- Windows-first; macOS/Linux webview stacking is not fully implemented
- Demo quality — expect rough edges in edge cases

## License

Private / demo — not published to a package registry.
