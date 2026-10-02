# Extension host research — 2026-09-13

## Decision

Use one manifest-driven WebView2 host for the catalog. It resolves a packaged popup first, then a packaged side panel, exposes options separately, and identifies declared background/content-script features without certifying they work. Catalog size is not evidence of compatibility. Do not add extension-specific JavaScript patches.

## How browsers supply the infrastructure

| Implementation | What the browser supplies | Consequence for Nebula |
| --- | --- | --- |
| Chrome | Manifest registration, isolated content scripts, event-driven workers, permissions, tabs/windows, toolbar actions, popup lifecycle and side panel | These are shared services. Extensions call APIs; Chrome does not implement every extension separately. |
| Edge | Chromium extension model with documented API differences and porting/testing guidance | Chromium ancestry helps; compatibility still needs verification. |
| Firefox | WebExtensions with differences in APIs, manifests and execution | A shared format does not guarantee identical behavior. |
| Electron | A documented subset; its documentation says arbitrary Chrome Web Store compatibility is not a goal | Switching to Electron alone does not provide Chrome's extension host. |
| electron-browser-shell | Host integration callbacks for tabs/windows and an action toolbar on top of Electron | A useful architectural example, not a drop-in Tauri dependency. Its GPL/commercial licensing also requires review before reusing code. |
| WebView2 | Profile-level unpacked extension registration, persistence, enumeration, enable and removal | Nebula must supply user entry points. Microsoft explicitly says icon/badge/popup-dependent extensions may load without the necessary UI entry points. |

Sources: [Chromium extension architecture](https://chromium.googlesource.com/chromium/src/+/HEAD/extensions/docs/overview.md), [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [Chrome workers](https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers), [Edge porting](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/port-chrome-extension), [Firefox differences](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Differences_between_API_implementations), [Electron support](https://www.electronjs.org/docs/latest/api/extensions/), [electron-browser-shell host](https://github.com/samuelmaddock/electron-browser-shell/tree/master/packages/electron-chrome-extensions), [WebView2 Profile7 contract](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2profile7?view=webview2-1.0.4129.50).

## The difficult boundary

An action is more than an HTML page. Chrome supports per-tab state, dynamic popup selection, badge updates, user gestures and `action.onClicked`. Opening a declared `default_popup` URL does not dispatch that click event or reproduce an `activeTab` grant. Side panels can also be configured dynamically by a service worker. Nebula may open an existing packaged side-panel page in a Beta controls window, but that does not emulate `chrome.sidePanel.open()` or action dispatch. Sources: [action API](https://developer.chrome.com/docs/extensions/reference/api/action), [sidePanel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel).

A WebView2 feedback report describes an extension UI WebView appearing as the active tab in `chrome.tabs.query`. This is a reported limitation, not a verified contract for every current runtime. We must measure it in our own profile: [WebView2 issue 3855](https://github.com/MicrosoftEdge/WebView2Feedback/issues/3855). The experiment must not spoof native tab IDs or inject privileged Tauri APIs into arbitrary extension code to hide this boundary.

The previous JavaScript `chrome.windows.create` fallback was removed. Its 300 ms race could open a second window after a slow native request, and it returned a fabricated empty result. On WebView2 **152.0.4191.66**, our owned fixture confirms that native `tabs.create`, `windows.create`, their callback forms and `window.open` all raise requests that the host can handle. This verifies opening, not Chrome-equivalent returned Tab/Window objects or all management APIs. The older [WebView2 report 3841](https://github.com/MicrosoftEdge/WebView2Feedback/issues/3841) describes different behavior on runtime 117; it is not the current runtime contract.

Creating two windows synchronously inside nested popup callbacks reproduced a hang. `extension_host_windows.rs` now retains native request deferrals in an STA-local queue and builds one window at a time outside the originating callback. `SetNewWindow` preserves the original request, opener and exact WebView2 environment. Each child gets the same handler for nested popups, HTTP(S)/blank navigation filtering and native close cleanup. Root controls install handlers before loading extension JavaScript. Disabling/removing an extension closes its controls and associated authentication windows. Trial-site windows also use this handler. No extension JavaScript is patched and no Tauri command capability is granted.

The user's Claude 1.0.93 ZIP was inspected locally: its action has a title but no `default_popup`; its worker uses dynamic sidePanel operations. It also requests debugger, nativeMessaging, identity and tab-related capabilities. A successful isolated load therefore does not establish usable Claude support. Declaring Claude compatible would be premature.

Correction to the earlier Claude diagnosis: the screenshot's classic “Log in” button calls an OAuth helper that stores state/PKCE and invokes `chrome.tabs.create` with the authorization URL (`SchedulingFields-CGtzWYmo.js` → `SavedPromptsService-CITUFB33.js`). A different cowork screen invokes `chrome.windows.create`; that was not the screen the user reported. Actual Claude account login and its post-login APIs remain unverified; the owned fixture verifies the shared popup path without using a user's account.

## Nebula UI

- A small puzzle button in Semi-Lunar opens the installed list; the catalog remains in Settings.
- Each installed item uses its packaged manifest icon and has a primary manifest-derived action: open a declared popup, otherwise open a packaged side panel experimentally. When both exist, the panel remains accessible separately. Options, enable/disable and removal remain separate. Declared views must exist within the package. Manifest capability labels describe included features, not verified functionality; disabled items do not display an active-feature message.
- Opening an extension UI uses its actual `chrome-extension://` runtime origin in a separate native window sharing that extension's profile (catalog: isolated trial profile; pinned packages: regular profile). It is an initial controls window, not Chrome-equivalent popup behavior.
- Extension views receive no Nebula/Tauri command capability. Normal installation never switches to a private tab profile. The menu does not launch extensions from private browsing.
- Installation displays the downloaded manifest's requested permissions, site access and host limitations before confirmation. The confirmed digest must match the package installed, including when the store updates between review and installation.
- Show “installed”, “load check passed” and “functionality verified” as separate facts. Missing action/sidePanel integration remains visible.
- Show `nativeMessaging` as a companion-desktop-app dependency. A worker or content script being loaded is not proof that the native product integration is present.

## Verification and next gate

Use disposable profiles and a small owned MV3 fixture to test registration, storage, worker messaging, content scripts, popup origin, native tab targeting, enable/disable and removal. Add real package checks as independent evidence; never infer all-package compatibility from a single fixture.

Offline navigation regression: from `src-tauri`, run `cargo test --offline --features extension-native-smoke native_extension_navigation_contract -- --ignored --nocapture`. Requires a normal Windows desktop session; the restricted sandbox can stall WebView2 startup. The test uses a fresh temporary profile, a fixture authored in this repository and localhost only. It verifies five opening paths without duplicates, shared HttpOnly cookies, hidden windows, nested popups, `window.close` cleanup and disable/removal cleanup. It passed on runtime **152.0.4191.66**. Native fixture success does not certify OAuth providers, `identity`, `activeTab`, debugger or nativeMessaging behavior.

Before claiming broad compatibility: map Nebula's real tab/window lifecycle to extension expectations; implement action events/dynamic state and side panels; test optional permissions, updates, worker restarts, authentication and removal cleanup. If WebView2 cannot expose the needed host hooks, compare a full Chromium browser integration in a separate experiment. Electron and CEF mode choices must be evaluated against those exact requirements, not assumed to solve them.

Current download trust: pinned packages use known hashes; catalog CRX packages come from an HTTPS allowlist of Google's update hosts, with CRX identity/header checks and content digests. The current CRX parser does not independently verify the cryptographic signature. Do not describe a matching digest or successful WebView2 load as a security certification. Automatic updates and arbitrary external CRX/local-folder installation remain outside this prototype.

## Installation failure and removal checks — 2026-09-14

Registration and filesystem persistence are separate operations. If WebView2 adds an extension but Nebula cannot persist its runtime ID, the registration is removed before reporting the installation failure. The mutation guard is retained through that callback; rollback errors are reported rather than treated as success. Disabling preserves installation records. Successful removal clears both runtime-ID and folder-pointer records, including stale records whose native registration has already gone. Cleanup refuses to erase a different/newer runtime ID. Verified package caches remain available for reinstall.

The offline native test now forces ID persistence to fail, compares the actual runtime registration set before and after rollback, and successfully reinstalls afterward. It also asserts that native removal removes the fixture's actual runtime ID, rather than inferring success merely because Nebula's marker disappeared. The temporary profile can include runtime-provided extensions, so the expected baseline is measured instead of assumed empty. The same test verifies disabled-record preservation and stale-record cleanup. It passed on WebView2 152.0.4191.66.
