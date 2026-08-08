# Nebula v1.1.0

Nebula v1.1.0 is a major quality-of-life and stability update focused on browsing history, smarter resource management, crash recovery, accessibility, privacy, and a more complete home experience.

## What's new

### Browsing History
- Added a dedicated History panel.
- Search through visited pages.
- Filter history by today, the last 7 days, the last 30 days, or all time.
- Filter entries by website.
- Remove individual entries or clear filtered/all history.
- Added persistent recently closed tabs.
- Added previous-session restoration support.

### Smarter Memory Management
- Added sleeping tabs using WebView2 suspension.
- Audio-playing tabs remain active.
- Real-time communication sites such as Discord, WhatsApp Web, Slack and Teams are protected.
- Tabs with notification activity or filled forms are protected when appropriate.
- Added adaptive sleeping and unloading based on total system RAM pressure.
- Inactive tabs can be unloaded under higher memory pressure and restored when revisited.

### Crash Recovery
- Nebula now detects unexpected shutdowns.
- Previous tabs can be restored after an unclean exit.
- Normal application shutdowns do not trigger recovery.
- Clear-on-exit privacy settings continue to take priority.

### Home Widgets
- Added Weather, Calendar, Quick Links and Network widgets.
- Improved Notes and Blank widgets.
- Fixed widget layout synchronization and resize/flicker issues.

### Privacy & Content Blocking
- Added bundled uBlock Origin Lite resources.
- Expanded native WebView privacy integration.

### Downloads & Notifications
- Added native download management and Download Manager UI.
- Added notification infrastructure and Notification Panel.

### Keyboard Shortcuts
- Added a dedicated Keyboard Shortcuts section in Settings.
- Ctrl + T now opens Home.
- Ctrl + H now opens History.
- Removed the unnecessary new-tab keyboard shortcut.
- Improved keyboard handling across native WebView2 tabs.

### Accessibility
- Added focus trapping for dialogs and modal panels.
- Focus returns to the originating control after dialogs close.
- Improved accessible labels and dialog semantics.
- Added visible focus indicators and reduced-motion support.
- Added arrow-key navigation for the right toolbar.
- Improved keyboard navigation throughout Nebula.

### Performance Diagnostics
- Added native/frontend transition timing.
- Added WebView2 navigation timing.
- Added performance stress-test and log-summary utilities.
- Improved process and memory diagnostics.

### Release Quality
- Added automated UI/E2E smoke testing.
- Added native smoke tests.
- Added clean-install and upgrade-install validation.
- Added updater validation tools.
- Added release preflight checks.
- Added release test matrix and third-party notices.

## Validation

Nebula v1.1.0 passed:

- Rust cargo check
- Production TypeScript + Vite build
- Automated UI/E2E smoke suite
- Release configuration preflight
- v1.0.0 -> v1.1.0 updater test

## Windows

Nebula currently targets Windows x64 and requires Microsoft Edge WebView2.

The application is not Windows code-signed yet, so Windows SmartScreen may display an Unknown publisher warning when installing manually.

Nebula's built-in updater uses Tauri cryptographic updater signatures to verify downloaded updates.

## SHA-256

Nebula_1.1.0_x64-setup.exe

B16274555882AD92531F590D4AE96927967BC53D66170C9414C31D0AAD61B2FC

---

Full changes: https://github.com/memirusta/Nebula-Browser/compare/v1.0.0...v1.1.0
