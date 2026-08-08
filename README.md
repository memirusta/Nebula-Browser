```md
<div align="center">

# 🌌 Nebula Browser

### A browser that gets out of your way.

A Windows-first desktop browser built around a minimal, spatial interface instead of a traditional tab bar.

Powered by **Tauri 2**, **React 19**, **Rust**, and **WebView2**.

[![Version](https://img.shields.io/badge/version-1.1.1-7ec8e3)](https://github.com/memirusta/Nebula-Browser/releases)
[![Platform](https://img.shields.io/badge/platform-Windows-0078D4)](https://github.com/memirusta/Nebula-Browser/releases)
[![Tauri](https://img.shields.io/badge/Tauri-2-FFC131)](https://tauri.app/)
[![React](https://img.shields.io/badge/React-19-61DAFB)](https://react.dev/)

<br>

**[Download Nebula](https://github.com/memirusta/Nebula-Browser/releases/latest)** ·
**[Watch the Demo](https://drive.google.com/file/d/1D6d9yt8AardaDiC7bjiCk4MJkrXR0XYz/view?usp=sharing)**

</div>

---

## Meet Nebula

Most browsers revolve around the same layout:

tabs at the top, an address bar underneath, and browser chrome permanently taking up space.

Nebula takes a different approach.

The interface stays out of the way while you browse and appears only when you need it. Navigation, tabs, shortcuts, folders and previews live inside the **Semi-Lunar interface** — a floating radial workspace designed to keep browsing fast without filling the screen with controls.

> Nebula is not trying to redesign the web.
> It is trying to redesign the space around it.

---

## ✨ Highlights

### 🌙 Semi-Lunar Navigation

Nebula's signature interface replaces the traditional always-visible tab strip with a floating semi-lunar dock.

Use it to:

- switch between open tabs
- launch shortcuts
- organize shortcuts into folders
- preview pages before switching
- close tabs quickly
- return home without persistent browser chrome

The same Semi-Lunar interface is shared across Home, Browsing and Overlay modes.

---

### 🔎 Smart Search

Search combines local browser history with live search suggestions.

Supported search engines:

- Google
- DuckDuckGo
- Bing

Nebula can surface visited sites first while also providing live autocomplete suggestions from the selected search engine.

---

### 🏠 A Home Screen That Is Actually Yours

The home screen is a workspace rather than a static new-tab page.

Customize:

- wallpapers
- pinned websites
- search placement and size
- profile placement
- RAM and CPU widgets
- clock appearance
- greeting
- glass and blur effects
- accent colors
- Semi-Lunar dimensions and animations

Home modules can be repositioned without changing the browsing experience.

---

### 👁 Tab Previews

Hover over supported shortcuts and tabs to preview their current browsing session before switching.

Useful when multiple pages are open but you do not want a permanent tab strip taking space.

---

### 🗂 Folders

Drag shortcuts together to create folders directly inside the Semi-Lunar dock.

Folders support:

- multiple shortcuts
- rename
- drag interactions
- individual item removal
- automatic cleanup when members are removed

---

### 📥 Downloads

Nebula includes a native download manager with:

- active download progress
- completed downloads
- notification integration
- quick access from the browser toolbar

---

### 📜 History & Session Recovery

Browsing history is stored locally and integrated directly into Nebula.

Features include:

- recent browsing history
- recently closed tabs
- reopening closed tabs
- previous-session restoration
- crash recovery

---

### 🔐 Password Vault

Nebula includes a local password vault and browser-side autofill bridge.

Saved credentials can be managed from Settings and used inside supported browsing sessions.

---

### 🛡 Privacy Controls

Privacy controls include options for:

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

### 🔔 Notifications

Nebula has its own notification center for browser events such as downloads and supported site notifications.

---

### ⌨️ Keyboard Navigation

Common browser workflows are available from the keyboard, including:

- new / close / reopen tab
- next / previous tab
- direct tab switching
- back / forward
- reload
- focus search
- zoom controls
- Home

Shortcut mappings can be viewed and configured from Settings.

---

## 🎬 Demo

> Full Nebula Browser showcase

[![Watch the Nebula demo](assets/demo-thumbnail.png)](DEMO_VIDEO_URL)

---

## 🧠 How Nebula Works

Nebula is built with:

| Layer | Technology |
|---|---|
| Desktop shell | Tauri 2 |
| Native backend | Rust |
| Interface | React 19 + TypeScript |
| Bundler | Vite |
| Windows rendering | Microsoft WebView2 |
| Native installer | NSIS |

Unlike a conventional single-WebView Tauri application, Nebula uses multiple native webviews on Windows.

### Windows WebView Architecture

```text
┌─────────────────────────────────────────────┐
│                  Window                     │
│                                             │
│  nebula-chrome                              │
│  ─────────────────────────────────────────  │
│        custom title / browser controls      │
│                                             │
│  main                                       │
│  ─────────────────────────────────────────  │
│  Home / Overlay / Semi-Lunar / UI shell     │
│                                             │
│  nebula-tab-*                               │
│  ─────────────────────────────────────────  │
│          native website WebViews            │
│                                             │
└─────────────────────────────────────────────┘
```

Each open browser tab can use its own native WebView.

Nebula dynamically manages their visibility, stacking and hit regions so native page content and the React interface behave like one application.

---

## 📁 Project Structure

```text
src/
├── components/
│   ├── BrowserShell/
│   ├── HomeCenter/
│   ├── SemiLunarMenu/
│   ├── SettingsPanel/
│   ├── DownloadManager/
│   ├── HistoryPanel/
│   ├── NotificationPanel/
│   └── ...
│
├── core/
│   ├── settings
│   ├── browser state
│   ├── shortcuts
│   ├── history
│   └── bridge logic
│
├── hooks/
│   └── React state + browser integrations
│
├── platform/
│   └── Tauri / WebView native bridge
│
└── ChromeApp.tsx

src-tauri/
├── src/
│   └── Rust native browser commands
├── capabilities/
├── permissions/
└── tauri.conf.json
```

---

## 🚀 Installation

### Windows

Download the latest installer from:

**[GitHub Releases](https://github.com/memirusta/Nebula-Browser/releases/latest)**

Nebula currently targets Windows as its primary supported platform.

Microsoft WebView2 is required and is already included with most modern Windows 10 and Windows 11 installations.

---

## 🛠 Development

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

Run the browser:

```bash
npm run tauri dev
```

### Web-only UI development

The React interface can also be started without the native browser layer:

```bash
npm run dev
```

Some functionality — including native browser tabs, system statistics and WebView integrations — requires the Tauri application.

---

## 📦 Building

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

## 🧪 Testing

Nebula includes several smoke and release checks.

```bash
npm run test:e2e
npm run test:native-smoke
npm run test:release-smoke
npm run release:preflight
```

Clean-install and upgrade testing scripts are also included for Windows.

---

## ⚠️ Current Platform Status

Nebula is currently **Windows-first**.

The architecture relies heavily on native multi-WebView behavior and Windows-specific WebView2 integration.

The React interface itself is cross-platform, but full macOS and Linux browser-window behavior is not yet at feature parity with Windows.

---

## 🗺 Roadmap

Nebula is actively evolving.

Some areas planned for continued work include:

- further browser compatibility improvements
- performance and memory optimization
- expanded privacy tooling
- additional platform support
- further Semi-Lunar interaction improvements

---

## ❤️ Why Nebula?

Nebula started from a simple idea:

**What if the browser UI disappeared until you actually needed it?**

Instead of making another variation of the traditional browser layout, Nebula experiments with a spatial interface where navigation appears around your workflow rather than permanently occupying part of the screen.

It is still evolving — but that experiment has turned into a browser you can actually use.

---

## License

Nebula currently does not include an open-source license.

Unless a license is added, the source code remains under its default copyright protections.

---

<div align="center">

### Nebula Browser

**Browse the web. Keep the space.**

Made with Tauri, Rust and React.

</div>
```


Bir de önemli detay yakaladım: repoda şu anda **LICENSE dosyası yok**. O yüzden eski README’deki `Copyright (c) Nebula contributors` kısmını olduğu gibi taşımadım. Public repo olması otomatik olarak açık kaynak lisansı vermiyor. İstersen README’den sonra **MIT mi, GPL mi, source-available mı** istediğine karar veririz; ona göre LICENSE ekleriz.
