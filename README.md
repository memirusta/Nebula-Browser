# Nebula Browser

A distraction-free, privacy-first browser shell — cyber-neural focus space with a frameless glass UI.

Built with **Tauri 2** (native shell) + **React 19** (UI). Uses the platform system WebView: **WebView2** on Windows, **WebKit** on macOS/Linux.

## Features (v0.1.1)

- Frameless home screen with draggable widgets and pinned shortcuts
- Semi-lunar radial dock for quick navigation (home, browsing, overlay)
- Multi-webview browsing on Windows (separate webview per tab)
- First-run onboarding: bookmark import, Google profile sign-in
- Live RAM/CPU widgets (Tauri desktop build)
- Settings for appearance, layout, and overlay frost/blur

## Screenshots

_Add screenshots when publishing the repo._

## Development

**Web prototype (browser only):**

```bash
npm install
cp .env.example .env   # optional: Google sign-in
npm run dev
```

**Desktop (Tauri):**

Requires [Rust](https://rustup.rs/) and **WebView2** on Windows.

```bash
npm install
cp .env.example .env
npm run tauri dev
```

### Google sign-in (optional)

1. Create a **Web application** OAuth client in [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Add **Authorized JavaScript origins:** `http://localhost:5173`
3. Add **Authorized redirect URIs:** `http://localhost:5173`
4. Copy `.env.example` → `.env` and fill in:

```env
VITE_GOOGLE_CLIENT_ID=your-client-id
VITE_GOOGLE_REDIRECT_URI=http://localhost:5173
GOOGLE_CLIENT_SECRET=your-client-secret
```

`GOOGLE_CLIENT_SECRET` is read only by the Rust backend (Tauri), not bundled in the frontend.

## Build (Windows installer)

```bash
npm run tauri:build:x64   # 64-bit Windows
npm run tauri:build:x86   # 32-bit Windows
```

Output: `src-tauri/target/release/bundle/nsis/Nebula_0.1.1_x64-setup.exe`

Zip the installer before sharing over chat apps — raw `.exe` files can get corrupted.

## Architecture

| Webview | Role |
|---------|------|
| `main` | BrowserShell — home, overlay, semi-lunar menu |
| `nebula-chrome` | Custom title bar |
| `nebula-tab-*` | Per-tab site webviews |

See `docs/OZELLIKLER.md` for a feature overview (Turkish).

## Known limitations

- Windows-first; macOS/Linux webview stacking is incomplete
- No built-in password manager yet
- Demo quality — expect rough edges

## License

MIT — see [LICENSE](LICENSE).
