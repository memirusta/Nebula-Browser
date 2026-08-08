<div align="center">

<h1>
  <img src="src-tauri/icons/icon.png" alt="Nebula Browser Logo" width="42" />
  Nebula Browser
</h1>

<h3>A browser that gets out of your way.</h3>

<p>
A Windows-first desktop browser built around a minimal, spatial interface instead of a traditional always-visible tab bar.
</p>

<p>
Built with <strong>Tauri 2</strong>, <strong>React 19</strong>, <strong>TypeScript</strong>, <strong>Rust</strong>, and <strong>Microsoft WebView2</strong>.
</p>

<a href="https://github.com/memirusta/Nebula-Browser/releases">
  <img src="https://img.shields.io/badge/version-1.2.2-7ec8e3?style=flat-square" alt="Version">
</a>
<a href="https://github.com/memirusta/Nebula-Browser/releases/latest">
  <img src="https://img.shields.io/badge/platform-Windows-0078D4?style=flat-square&logo=windows11&logoColor=white" alt="Windows">
</a>
<a href="https://tauri.app/">
  <img src="https://img.shields.io/badge/Tauri-2-24C8DB?style=flat-square&logo=tauri&logoColor=white" alt="Tauri">
</a>
<a href="https://react.dev/">
  <img src="https://img.shields.io/badge/React-19-20232A?style=flat-square&logo=react&logoColor=61DAFB" alt="React">
</a>

<br><br>

<a href="https://github.com/memirusta/Nebula-Browser/releases/latest"><strong>Download for Windows</strong></a>
&nbsp;Ã‚Â·&nbsp;
<a href="https://drive.google.com/file/d/1D6d9yt8AardaDiC7bjiCk4MJkrXR0XYz/view?usp=sharing"><strong>Watch the demo</strong></a>

<br><br>

<a href="https://drive.google.com/file/d/1D6d9yt8AardaDiC7bjiCk4MJkrXR0XYz/view?usp=sharing">
  <img src="src/assets/demo-thumbnail.png" alt="Nebula Browser demo" width="100%">
</a>

</div>
---

## Meet Nebula

Most desktop browsers still revolve around the same layout: a permanent tab strip, a permanent address bar, and browser chrome that is always there whether you need it or not.

Nebula takes a different approach.

The interface stays out of the way while you browse and appears when you need it. Tabs, shortcuts, folders, previews, search, and navigation are brought together through the **Semi-Lunar interface** Ã¢â‚¬â€ a floating workspace designed to keep browsing fast without permanently filling the screen with controls.

> **Nebula does not try to redesign the web. It redesigns the space around it.**

---

## Ã¢Å“Â¨ Highlights

### ÄŸÅ¸Å’â„¢ Semi-Lunar Navigation

Nebula's signature interface replaces the traditional always-visible tab strip with a floating semi-lunar dock.

Use it to:

- switch between open tabs
- launch saved shortcuts
- organize shortcuts into folders
- preview pages before switching
- close tabs quickly
- jump back home
- access browsing actions without permanent browser chrome

The same Semi-Lunar interface is shared across Home, Browsing, and Overlay modes.

---

### ÄŸÅ¸â€Â Smart Search

Nebula combines local browsing history with live search suggestions.

Supported search engines:

- Google
- DuckDuckGo
- Bing

Visited sites can appear alongside live autocomplete suggestions, giving the search bar both browser-history awareness and real-time search assistance.

---

### ÄŸÅ¸ÂÂ  A Home Screen That Is Actually Yours

Nebula's home screen is a workspace rather than a static new-tab page.

Customize:

- wallpapers
- pinned websites
- search placement and size
- profile placement
- RAM and CPU widgets
- clock appearance
- greeting
- glass, blur, and opacity
- accent colors
- Semi-Lunar size and animation behavior

Home modules can be repositioned without changing the browsing experience.

---

### ÄŸÅ¸â€˜Â Tab Previews

Hover over supported shortcuts and tabs to preview their current browsing session before switching.

It is especially useful when multiple pages are open but you do not want a permanent tab strip occupying screen space.

---

### ÄŸÅ¸â€”â€š Folders

Drag shortcuts together to organize them directly inside the Semi-Lunar dock.

Folders support:

- multiple shortcuts
- renaming
- drag interactions
- individual item removal
- automatic cleanup when members are removed

---

### ÄŸÅ¸â€œÂ¥ Downloads

Nebula includes an integrated download manager with:

- active download progress
- completed downloads
- browser notifications
- quick access from the toolbar

---

### ÄŸÅ¸â€œÅ“ History & Session Recovery

Browsing history is stored locally and integrated directly into Nebula.

Features include:

- recent browsing history
- recently closed tabs
- reopening closed tabs
- previous-session restoration
- crash recovery

---

### ÄŸÅ¸â€Â Password Vault

Nebula includes a local password vault and a browser-side autofill bridge.

Saved credentials can be managed from Settings and used inside supported browsing sessions.

---

### ÄŸÅ¸â€ºÂ¡ Privacy Controls

Nebula includes configurable privacy options for:

- tracking protection
- cookie restrictions
- HTTPS-only browsing
- Global Privacy Control
- clear-on-exit
- private mode
- permission policies
- site exceptions
- custom block lists
- cookie-banner blocking

Nebula also integrates **uBlock Origin** into its desktop browsing environment.

---

### ÄŸÅ¸â€â€ Notifications

Nebula has its own notification center for browser events such as downloads and supported site notifications.

---

### Ã¢Å’Â¨Ã¯Â¸Â Keyboard Navigation

Common browser workflows are available from the keyboard, including:

- new, close, and reopen tab
- next / previous tab
- direct tab switching
- back / forward
- reload
- focus search
- zoom controls
- Home

Shortcut mappings can be viewed and configured from Settings.

---

## ÄŸÅ¸ÂÂ¬ Demo

Watch the full Nebula Browser showcase:

**[Ã¢â€“Â¶ Open the demo video](https://drive.google.com/file/d/1D6d9yt8AardaDiC7bjiCk4MJkrXR0XYz/view?usp=sharing)**

---

## ÄŸÅ¸Â§Â  How Nebula Works

Nebula is built with:

| Layer | Technology |
| --- | --- |
| Desktop shell | Tauri 2 |
| Native backend | Rust |
| Interface | React 19 + TypeScript |
| Bundler | Vite |
| Windows rendering | Microsoft WebView2 |
| Windows installer | NSIS |

Unlike a conventional single-WebView Tauri application, Nebula uses multiple native WebViews on Windows.

### Windows WebView architecture

```text
Ã¢â€Å’Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€Â
Ã¢â€â€š                  Window                     Ã¢â€â€š
Ã¢â€â€š                                             Ã¢â€â€š
Ã¢â€â€š  nebula-chrome                              Ã¢â€â€š
Ã¢â€â€š  Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬  Ã¢â€â€š
Ã¢â€â€š      custom title / browser controls        Ã¢â€â€š
Ã¢â€â€š                                             Ã¢â€â€š
Ã¢â€â€š  main                                       Ã¢â€â€š
Ã¢â€â€š  Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬  Ã¢â€â€š
Ã¢â€â€š  Home / Overlay / Semi-Lunar / UI shell     Ã¢â€â€š
Ã¢â€â€š                                             Ã¢â€â€š
Ã¢â€â€š  nebula-tab-*                               Ã¢â€â€š
Ã¢â€â€š  Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬  Ã¢â€â€š
Ã¢â€â€š          native website WebViews            Ã¢â€â€š
Ã¢â€â€š                                             Ã¢â€â€š
Ã¢â€â€Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€Ëœ
```

Each open browser tab can use its own native WebView.

Nebula dynamically manages their visibility, stacking, and hit regions so native page content and the React interface behave like one application.

---

## ÄŸÅ¸â€œÂ Project Structure

```text
src/
Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ components/
Ã¢â€â€š   Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ BrowserShell/
Ã¢â€â€š   Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ HomeCenter/
Ã¢â€â€š   Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ SemiLunarMenu/
Ã¢â€â€š   Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ SettingsPanel/
Ã¢â€â€š   Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ DownloadManager/
Ã¢â€â€š   Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ HistoryPanel/
Ã¢â€â€š   Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ NotificationPanel/
Ã¢â€â€š   Ã¢â€â€Ã¢â€â‚¬Ã¢â€â‚¬ ...
Ã¢â€â€š
Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ core/
Ã¢â€â€š   Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ browser state
Ã¢â€â€š   Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ settings
Ã¢â€â€š   Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ shortcuts
Ã¢â€â€š   Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ history
Ã¢â€â€š   Ã¢â€â€Ã¢â€â‚¬Ã¢â€â‚¬ bridge logic
Ã¢â€â€š
Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ hooks/
Ã¢â€â€š   Ã¢â€â€Ã¢â€â‚¬Ã¢â€â‚¬ React state + browser integrations
Ã¢â€â€š
Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ platform/
Ã¢â€â€š   Ã¢â€â€Ã¢â€â‚¬Ã¢â€â‚¬ Tauri / native WebView bridge
Ã¢â€â€š
Ã¢â€â€Ã¢â€â‚¬Ã¢â€â‚¬ ChromeApp.tsx

src-tauri/
Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ src/
Ã¢â€â€š   Ã¢â€â€Ã¢â€â‚¬Ã¢â€â‚¬ Rust native browser commands
Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ capabilities/
Ã¢â€Å“Ã¢â€â‚¬Ã¢â€â‚¬ permissions/
Ã¢â€â€Ã¢â€â‚¬Ã¢â€â‚¬ tauri.conf.json
```

---

## ÄŸÅ¸Å¡â‚¬ Installation

### Windows

Download the latest installer from:

**[GitHub Releases](https://github.com/memirusta/Nebula-Browser/releases/latest)**

Nebula currently targets Windows as its primary supported platform.

Microsoft WebView2 is required and is already available on most modern Windows 10 and Windows 11 installations.

---

## ÄŸÅ¸â€ºÂ  Development

### Requirements

You will need:

- Node.js
- npm
- Rust
- Microsoft WebView2 Runtime
- Tauri prerequisites for Windows

Clone the repository:

```bash
git clone https://github.com/memirusta/Nebula-Browser.git
cd Nebula-Browser
npm install
```

Run the desktop browser:

```bash
npm run tauri dev
```

### Web-only UI development

The React interface can also be started without the native browser layer:

```bash
npm run dev
```

Some functionality Ã¢â‚¬â€ including native browser tabs, system statistics, native browsing behavior, and WebView integrations Ã¢â‚¬â€ requires the Tauri application.

---

## ÄŸÅ¸â€œÂ¦ Building

### Windows x64

```bash
npm run tauri:build:x64
```

### Windows x86

```bash
npm run tauri:build:x86
```

### Native binary without installer

```bash
npm run tauri:build:binary
```

Installer bundles are generated using NSIS.

---

## ÄŸÅ¸Â§Âª Testing

Nebula includes smoke, native, clean-install, and release checks.

```bash
npm run test:e2e
npm run test:native-smoke
npm run test:release-smoke
npm run release:preflight
```

Additional Windows install tests are available through the clean-install, upgrade-install, and Windows Sandbox scripts in `scripts/`.

---

## Ã¢Å¡Â Ã¯Â¸Â Current Platform Status

Nebula is currently **Windows-first**.

Its desktop architecture relies heavily on native multi-WebView behavior and Windows-specific WebView2 integration.

The React interface is designed to remain portable, but full native browser-window behavior on macOS and Linux is not yet at feature parity with Windows.

---

## ÄŸÅ¸â€”Âº Roadmap

Nebula is actively evolving. Areas for continued work include:

- browser compatibility improvements
- performance and memory optimization
- expanded privacy tooling
- additional platform support
- continued Semi-Lunar interaction improvements
- further polish around native browser behavior

---

## Ã¢ÂÂ¤Ã¯Â¸Â Why Nebula?

Nebula started from a simple question:

### What if the browser UI disappeared until you actually needed it?

Instead of making another variation of the traditional browser layout, Nebula experiments with a spatial interface where navigation appears around your workflow rather than permanently occupying part of the screen.

That experiment has grown into a browser you can actually use.

---

## License

No open-source license has been published for Nebula yet.

Unless a license is added, the source code remains under its default copyright protections.

---

<div align="center">

### Nebula Browser

**Browse the web. Keep the space.**

Made with Tauri, Rust, React, and an unreasonable amount of glass.

</div>


