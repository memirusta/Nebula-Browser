# WebView2 extension API surface (measured)

Measured 2026-10-01 on WebView2 runtime **154.0.4258.37**. These are facts from a real runtime, not from documentation.

## How to reproduce

From `src-tauri`, in a normal Windows desktop session (hidden windows, temporary profile, no user data):

```powershell
cargo test --offline --features extension-native-smoke native_extension_api_surface -- --ignored --nocapture
```

The test installs an owned MV3 fixture (`src/extension_api_surface_fixture.rs`: service worker, popup, offscreen page), runs probes inside the worker, and writes `src-tauri/target/extension-api-surface.json`. It records outcomes and asserts nothing about which APIs exist, so a runtime change shows up as different output rather than a failure.

## What the service worker gets

| Area | Result |
| --- | --- |
| `storage`, `alarms`, `contextMenus`, `cookies`, `downloads`, `history`, `bookmarks`, `notifications`, `management`, `permissions`, `identity` (`getRedirectURL`, `launchWebAuthFlow` present), `declarativeNetRequest.updateDynamicRules`, `webRequest`/`webNavigation` listeners, `runtime.getPlatformInfo` | Present and callable |
| `action.setBadgeText/getBadgeText` | Works |
| `sidePanel.setOptions`, `getOptions`, `setPanelBehavior` | Work; state is kept (`getOptions` returned the path that was set) |
| `sidePanel.open()` | Rejected: "may only be called in response to a user gesture" (Chrome's rule) |
| `offscreen.createDocument` / `hasDocument` | Work; the offscreen page loaded and messaged the worker |
| `runtime.sendNativeMessage` | API present; fails with "Specified native messaging host not found" because no host is registered |
| `chrome.commands` | Present when the manifest declares a `commands` key (see Gating below). Shortcuts are listed but Nebula does not bind them to keys |
| `tabs.query`, `windows.getAll` | See the tabs of the profile the extension is installed in. With only the host's own `about:blank` window open they list that; once a real http page is loaded in the same profile, `tabs.query` returns it (id, title, status, window id) |
| `scripting.executeScript`, content scripts, `tabs.sendMessage` | Work against a real http tab in the same profile (script result returned, content script ran and messaged the worker, message round trip). Rejected for `about:blank`, as in Chrome |
| `sidePanel.open` | The property is writable and configurable, so a call made while handling a click can be intercepted |
| `chrome.webview` | Not exposed to the worker |

## Gating: most namespaces depend on permissions and manifest keys

A namespace is only defined for an extension that asks for it, as in Chrome: `privacy`, `proxy`, `browsingData`, `idle`, `tabGroups`, `tabCapture`, `system.*` and others need their permission, `commands` and `omnibox` need their manifest key. The first version of this probe did not declare them and wrongly reported about 35 namespaces as missing. The fixture now declares every gating permission and key. With them, on 154.0.4258.37, **46 of the 58 probed namespaces are defined natively**. The ones that stay undefined are `browserAction` and `pageAction` (MV2 only, undefined in Chrome MV3 too), `devtools` (devtools pages only), `certificateProvider`, `documentScan`, `enterprise`, `platformKeys`, `printerProvider`, `printing`, `processes` and `dns` (ChromeOS or developer channel), and **`userScripts`**, the one real gap for a desktop MV3 extension.

Consequence for compatibility work: do not read "an extension references `chrome.X`" as "WebView2 lacks X". Check the extension's declared permissions first.

## The host can reach the service worker without patching

Through the **in-process** DevTools channel of a WebView the host already owns (an extension popup window), with no remote debugging port and no change to the extension package:

1. `Target.getTargets` lists the extension's `service_worker` target (plus its popup page and offscreen `background_page`).
2. `Target.attachToTarget {flatten: true}` returns a session.
3. `Runtime.evaluate` through `CallDevToolsProtocolMethodForSession` runs in the worker.
4. `chrome.action.onClicked` exposes `dispatch`, is writable and configurable; calling `dispatch(tab)` from step 3 fired the extension's own registered listener (`onClicked.fired` recorded `tabId 1`).

So the toolbar-click event, which WebView2 gives the host no way to raise, can be raised by Nebula. The tab object passed is fabricated by the caller; mapping it to a real Nebula tab is separate work.

## Not established

- Which tabs an extension sees depends on the WebView2 profile: only pages in the profile the extension is installed in. Nebula's normal tabs are in a different profile, so catalog extensions do not see them.
- Idle termination timing. A stopped worker is woken by the click and the host waits until `chrome` and `setTimeout` exist in it before running anything: a just-started worker is listed as a target before its global scope is complete.
- `activeTab` grants: a dispatched click does not grant `activeTab` the way Chrome's toolbar click does.
- Anything about extensions other than this fixture.

## Security note

`Runtime.evaluate` in an extension worker is arbitrary code execution inside that extension. It must stay a native host capability limited to specific, validated operations (for example "dispatch a click for this installed extension"), never a generic passthrough reachable from web content or extension pages.
