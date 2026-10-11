# Extension capability scan (static)

Generated 2026-10-01 from in-memory reads of public Chrome Web Store packages. No extension code was executed and no package was installed or kept on disk.

## Scope and limits

- **Sample:** 199 packages read successfully out of 200 attempted (catalog: 200). 1 failed on network errors and are listed at the end. The sample is the **most-used** extensions (every one has at least 1,000,000 users) and is skewed towards large vendors.
- **Signal:** a feature counts when the package *code* calls the API (text search over its JavaScript), except `nativeMessaging`, which uses the *declared permission*: searching code for `connectNative` also matches bundled polyfill tables and over-counted it by 23 (64 by code vs 41 declared).
- **"Needs" does not mean "broken".** It lists what the extension asks the host for. Whether WebView2 already provides each API is a separate measurement that this scan does not make.
- Categories are the catalog's own `sourceCategory` field (Chrome Web Store sub-category), not a judgement. Groups with fewer than 5 extensions are marked with `*`; their cells are indications, not percentages to rely on.

## What the packages ask for, by category

Cells are `extensions needing it / extensions in the category`; `·` means none.

| Category | n | action.onClicked | offscreen | sidePanel | nativeMessaging | identity | tabs | windows | scripting | declarativeNetRequest | webRequest | contextMenus | downloads | notifications |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| productivity/workflow | 69 | 16/69 | 11/69 | 7/69 | 26/69 | 6/69 | 37/69 | 19/69 | 24/69 | 21/69 | 18/69 | 14/69 | 7/69 | 7/69 |
| productivity/tools | 37 | 14/37 | 6/37 | 6/37 | 8/37 | 2/37 | 24/37 | 9/37 | 16/37 | 17/37 | 5/37 | 8/37 | 5/37 | 10/37 |
| make_chrome_yours/privacy | 26 | 3/26 | 7/26 | 1/26 | 9/26 | 2/26 | 17/26 | 10/26 | 19/26 | 15/26 | 13/26 | 6/26 | 4/26 | 5/26 |
| productivity/developer | 20 | 2/20 | 4/20 | 3/20 | 5/20 | 2/20 | 10/20 | 6/20 | 9/20 | 4/20 | 5/20 | 1/20 | 4/20 | 1/20 |
| make_chrome_yours/accessibility | 17 | 3/17 | 4/17 | 1/17 | 8/17 | 1/17 | 11/17 | 8/17 | 11/17 | 3/17 | 2/17 | 4/17 | 2/17 | 4/17 |
| lifestyle/social | 6 | 2/6 | · | · | 1/6 | · | 6/6 | 3/6 | 1/6 | 1/6 | · | · | 1/6 | · |
| make_chrome_yours/functionality | 6 | 2/6 | · | 1/6 | 1/6 | · | 4/6 | 2/6 | 3/6 | 2/6 | 1/6 | 1/6 | · | · |
| productivity/education | 5 | 2/5 | 1/5 | 1/5 | · | 1/5 | 4/5 | 1/5 | 3/5 | 1/5 | 1/5 | 2/5 | 1/5 | · |
| lifestyle/fun * | 4 | 2/4 | · | · | · | 1/4 | 4/4 | · | 2/4 | · | 1/4 | 1/4 | · | 1/4 |
| lifestyle/shopping * | 3 | 2/3 | 2/3 | 1/3 | · | 1/3 | 3/3 | 3/3 | 1/3 | 1/3 | 1/3 | 1/3 | · | 1/3 |
| productivity/communication * | 3 | · | · | 1/3 | · | · | 2/3 | 2/3 | 2/3 | 1/3 | · | 1/3 | · | 1/3 |
| lifestyle/art * | 2 | 1/2 | · | 2/2 | · | · | 2/2 | · | 2/2 | 1/2 | 1/2 | · | 2/2 | · |
| lifestyle/entertainment * | 1 | · | · | · | · | · | 1/1 | 1/1 | 1/1 | · | 1/1 | · | · | · |
| **all** | **199** | **49/199** | **35/199** | **24/199** | **58/199** | **16/199** | **125/199** | **64/199** | **94/199** | **67/199** | **49/199** | **39/199** | **26/199** | **30/199** |

Column meaning: `action.onClicked` = Toolbar click (no popup); `offscreen` = Hidden offscreen document; `sidePanel` = Dynamic side panel; `nativeMessaging` = Companion desktop app (permission); `identity` = Sign-in / OAuth helper; `tabs` = Open/alter tabs; `windows` = Open/alter windows; `scripting` = Inject scripts; `declarativeNetRequest` = Network rules; `webRequest` = Observe/alter requests; `contextMenus` = Right-click menu items; `downloads` = Downloads; `notifications` = Notifications.

## Which categories depend on each feature

### action.onClicked — Toolbar click (no popup) (49 of 199)

- **productivity/workflow** (16): Adobe Acrobat: PDF edit, convert, sign tools, AdBlock — block ads across the web, Chrome Remote Desktop, Adblock Plus - free ad blocker …
- **productivity/tools** (14): Claude, Zotero Connector, Microsoft Bing Search for Chrome, Norton Safe Search …
- **make_chrome_yours/accessibility** (3): 360 Internet Protection, PDF-XChange, Turn Off the Lights
- **make_chrome_yours/privacy** (3): Online Security, NordPass® Password Manager & Digital Vault, Avast Online Security & Privacy
- **make_chrome_yours/functionality** (2): IDM Integration Module, OneTab
- **lifestyle/shopping** (2): Honey: Automated Coupons & Rewards, Keepa - Amazon Price Tracker
- **productivity/education** (2): Equatio - Math made digital, Language Reactor
- **lifestyle/social** (2): WA Web Plus by Elbruz Technologies, Google Mail Checker
- **lifestyle/fun** (2): Stylish - Custom themes for any website, My Doodle
- **productivity/developer** (2): Chromebook Recovery Utility, Clear Cache
- **lifestyle/art** (1): Image Downloader

### offscreen — Hidden offscreen document (35 of 199)

- **productivity/workflow** (11): Adobe Acrobat: PDF edit, convert, sign tools, Application Launcher For Drive (by Google), Endpoint Verification, LastPass: Free Password Manager …
- **make_chrome_yours/privacy** (7): uBlock Origin Lite, VPN for Chrome: NordVPN proxy protection, NordPass® Password Manager & Digital Vault, Bitwarden Password Manager …
- **productivity/tools** (6): Claude, Video Download Helper, Sider: Chat with all AI: GPT-5, Claude, DeepSeek, Gemini, Grok, Google Input Tools …
- **make_chrome_yours/accessibility** (4): Volume Master, Honorlock, Volume Booster, Secure Exam Proctor
- **productivity/developer** (4): ColorZilla, Clear Cache, User-Agent Switcher for Chrome, Stylus
- **lifestyle/shopping** (2): Honey: Automated Coupons & Rewards, Keepa - Amazon Price Tracker
- **productivity/education** (1): Google Translate

### sidePanel — Dynamic side panel (24 of 199)

- **productivity/workflow** (7): Adobe Acrobat: PDF edit, convert, sign tools, MetaMask, Video Downloader Professional, Phantom …
- **productivity/tools** (6): Claude, Video Download Helper, Sider: Chat with all AI: GPT-5, Claude, DeepSeek, Gemini, Grok, Immersive Translate: AI Web, PDF & Video Translator …
- **productivity/developer** (3): Meta Ads Data Advisor, Tag Assistant, Cookie-Editor
- **lifestyle/art** (2): Image Downloader, Image downloader - Imageye
- **make_chrome_yours/privacy** (1): Bitwarden Password Manager
- **productivity/communication** (1): Quillbot: AI Writing Assistant with Humanizer, Paraphraser & AI Detector
- **make_chrome_yours/accessibility** (1): Secure Exam Proctor
- **lifestyle/shopping** (1): Coupert - Automatic Coupon Finder & Cashback
- **productivity/education** (1): Language Reactor
- **make_chrome_yours/functionality** (1): ChatbotsPlace: All-in-One AI Sidebar (ChatGPT, Claude & Gemini)

### nativeMessaging — Companion desktop app (permission) (58 of 199)

- **productivity/workflow** (26): Adobe Acrobat: PDF edit, convert, sign tools, Application Launcher For Drive (by Google), Chrome Remote Desktop, Microsoft Single Sign On …
- **make_chrome_yours/privacy** (9): McAfee® WebAdvisor, Imprivata Enterprise Access Management, Online Security, Malwarebytes Browser Guard …
- **productivity/tools** (8): 迅雷下载支持, Claude, WPS PDF - Read, Edit, Fill, Convert, and AI Chat PDF with Ease, AnyDoc Translator - Translate Web and PDF …
- **make_chrome_yours/accessibility** (8): 360 Internet Protection, 네이버 동영상 플러그인, INISAFE CrossWeb EX, Контур.Расширение …
- **productivity/developer** (5): TouchEn PC보안 확장, TrendAI™ Toolbar for Enterprise, SentinelOne, Take Webpage Screenshots Entirely - FireShot …
- **lifestyle/social** (1): Cisco Webex Extension
- **make_chrome_yours/functionality** (1): IDM Integration Module

### identity — Sign-in / OAuth helper (16 of 199)

- **productivity/workflow** (6): Adobe Acrobat: PDF edit, convert, sign tools, Endpoint Verification, Nexthink, Google Keep Chrome Extension …
- **productivity/tools** (2): Claude, IE Tab
- **make_chrome_yours/privacy** (2): Malwarebytes Browser Guard, Authenticator
- **productivity/developer** (2): Meta Ads Data Advisor, Stylus
- **lifestyle/fun** (1): Return YouTube Dislike
- **make_chrome_yours/accessibility** (1): Read Aloud: A Text to Speech Voice Reader
- **productivity/education** (1): Equatio - Math made digital
- **lifestyle/shopping** (1): Coupert - Automatic Coupon Finder & Cashback

## How many extensions depend on each feature alone

This counts **dependency**, not missing support. Measured on WebView2 154 (docs/EXTENSION_API_SURFACE.md): `offscreen`, `identity`, the `sidePanel` configuration API and `commands` are provided natively when the extension declares them, and Nebula supplies the toolbar click (`action.onClicked`). The one thing the browser cannot provide is the vendor's desktop application behind `nativeMessaging`.

Extensions whose *only* dependency among `action.onClicked`, `offscreen`, `sidePanel`, `nativeMessaging`, `identity` is the feature in the row:

| Feature | Needs it | Needs only it |
|---|---|---|
| `action.onClicked` | 49 | 26 |
| `offscreen` | 35 | 20 |
| `sidePanel` | 24 | 11 |
| `nativeMessaging` | 58 | 42 |
| `identity` | 16 | 3 |
| none of the five | | 62 (31%) |

`nativeMessaging` extensions need their own companion desktop application; Nebula cannot provide that. Extensions in the "none" row depend on none of these five features, which does **not** mean they work: whether they do is shown only by running them (docs/EXTENSION_LAB.md).

## Failed downloads

- WPS浏览器助手：文档在线阅读编辑 (2,000,000 users): `RuntimeError: not a CRX`

Every failure so far is a network-level error (connection reset, TLS handshake timeout, read timeout, DNS lookup failure); none is a missing or malformed package. The cause is **not determined**: it may be server-side throttling, an unstable local connection, or both. DNS resolved normally when checked afterwards, so the DNS failures were transient. Failed packages are retried, not guessed at.
