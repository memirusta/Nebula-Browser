# Extension Lab

An isolated Nebula instance for trying extensions live. It has its own app identifier (`com.nebula.browser.extensionlab`), so it has its own AppData folder, WebView2 profile, settings and extension profile. Your normal Nebula profile is never read or written, and both can run at the same time.

What is **not** isolated (neither touches your data, but you should know):

- The taskbar identity (AppUserModelID) is hard-coded to `com.nebula.browser` in `media_session.rs`, so the lab window can group under the same taskbar button as your normal Nebula.
- `lib.rs` reads (never writes) `%LOCALAPPDATA%\com.nebula.browser\.env`, the Google OAuth client configuration of the normal install.

The lab is **not** a release build. It is a debug build with a separate identity, and the extensions are installed through the same code the Extensions UI uses. Do not sign in to real accounts, and do not make the lab your default browser.

## Commands

From the repository root (PowerShell):

```powershell
.\scripts\extension-lab.ps1 status      # what exists right now
.\scripts\extension-lab.ps1 setup       # download + install the lab extensions (idempotent)
.\scripts\extension-lab.ps1 build       # build the lab app (debug, separate identity)
.\scripts\extension-lab.ps1 run         # start it
.\scripts\extension-lab.ps1 diagnose    # run installed extensions and record what they report (lab app closed)
.\scripts\extension-lab.ps1 diagnose -Ids <store-id>,<store-id>   # choose extensions (default: Claude)
.\scripts\extension-lab.ps1 reset -Yes  # delete the lab profile and start over
```

`setup` uses the `extension-native-smoke` test `native_extension_lab_setup`, which needs a normal Windows desktop session. It is safe to run again: already-installed extensions are skipped, failed ones are retried. The per-extension result is written to `src-tauri/target/extension-lab-setup.json`.

### Run `setup` and `run` from the same terminal

A process started from a packaged (MSIX) app, such as the Microsoft Store PowerShell, Windows Terminal or the Claude desktop app, has its writes under `%LOCALAPPDATA%` redirected into that package's private store. A lab profile created by `setup` in one context is therefore **invisible** to a lab started from another context (for example a double-click on `app.exe` in Explorer).

The script records the context `setup` ran in and refuses `run` from a different one. Always use the script for both steps, from the same terminal. `status` shows both contexts. This was found the hard way: the first automated setup (run from inside the Claude desktop app) wrote 380 MB into the Claude package's store instead of the real profile, and was deleted.

## The extensions

Chosen from `docs/EXTENSION_CAPABILITY_SCAN.md`: the extensions that ask the host for the most features, leaving out any that need a companion desktop app, plus Claude by request. Claude does declare `nativeMessaging`, so its desktop-app features cannot work; it is here to test the toolbar click and side panel.

`Secure Exam Proctor` is deliberately not included: it is lockdown software that restricts and monitors the browser, which is not appropriate for a feature test.

## How to test live

1. `.\scripts\extension-lab.ps1 run`
2. In the lab window, open any website tab (for example `https://example.com`) so the Semi-Lunar is in browsing mode.
3. Click the **puzzle** button in the Semi-Lunar's left group, next to the lock icon. The installed extensions are listed.
4. Click **Try this site with extensions**. The page opens in a separate window that shares the extension profile. Toolbar clicks act on that window's tab.
5. For each extension, click its primary button:
   - **Open controls**: opens the declared popup.
   - **Click toolbar action · Beta**: for extensions whose icon has no popup. If the extension opens a side panel in response, Nebula opens it in its own window.
6. Note what happened (below).

Known limits to keep in mind while testing:

- A toolbar click from Nebula does not grant `activeTab` the way a browser toolbar does, so extensions that rely on it may open but be unable to read the page.
- `chrome.commands` (keyboard shortcuts), the right-click menu items extensions register, and extension notifications are not bridged into Nebula yet.
- `nativeMessaging` needs the vendor's desktop app and will not work here.

## Diagnosing an extension

`diagnose` runs the real installed extension against a small local page in the lab profile and writes `src-tauri/target/extension-lab-diagnose.json`. Close the lab app first: the diagnosis needs the profile to itself. It restarts the worker, performs the toolbar click the way the Extensions panel does, opens the side panel page if there is one, and records the worker's and the panel's console messages and exceptions (only the extension's own). It also repeats the click from a **stopped** worker, the cold path the first click in the app takes.

It shows what an extension did, not whether it is right: a click that "dispatched" with no error can still do nothing visible.

## Where to look when something fails

- The Extensions panel shows the error text under the extension.
- `%LOCALAPPDATA%\com.nebula.browser.extensionlab\logs\native-tab-transitions.jsonl` has `ui.watchdog.*` and window events.
- Right-click inside an extension window and choose Inspect to see its console.

## Results

Live results from the first session (2026-10-01, trial window on YouTube, school network, no sign-ins):

**Installed** is what `setup` reported on 2026-10-01 when run from a normal terminal: all 13 installed. It says only that the package passed Nebula's checks and was registered, not that it works. (A first run from inside the Claude desktop app failed for five of them with `Access is denied`; that did not reproduce in a normal terminal, so it was a property of that packaged context, not of the extensions. The exact cause there was not established.) Fill in the other columns as you test (`ok` / `opens, no effect` / `error: …` / `not tested`).

| Extension | Installed (automated) | Primary action | Side panel | Notes |
| --- | --- | --- | --- | --- |
| Claude | installed | toolbar click opens the side panel | login screen renders in the diagnosis | Live session showed "Can't reach the Claude extension"; not reproduced since the cold-start fix, so it needs a live re-check. An early hypothesis (`chrome.commands` undefined) was wrong |
| Bitwarden | installed | popup opens, shows the privacy-permission prompt and the setup screen | not tested | The permission prompt renders correctly in Nebula |
| Windscribe VPN | installed | popup UI works | n/a | Its sign-up link opened a managed `windscribe.com` window; blocked by the school network (`ERR_NAME_NOT_RESOLVED`) |
| Save to Google Drive | installed | toolbar click runs its flow, then fails at sign-in | n/a | **Cause found:** it calls `chrome.identity.getAuthToken`, which WebView2 does not support (`This API is not supported on Microsoft Edge`) |
| LastPass | installed | not tested (asks for login) | n/a |  |
| Norton Safe Search | installed | toolbar click: nothing visible | n/a | Cause unknown. `browserAction` is MV2-only; the other namespaces it references are provided when it declares their permissions |
| Sider | installed | toolbar click opens the side panel (fixed: it sets `openPanelOnActionClick`, which the click did not read) | opens, shows its UI | Verified with the real extension from a warm and a cold worker |
| Keepa | installed | not tested (asks for login) | n/a |  |
| Imageye | installed | toolbar click opens the side panel (same fix as Sider) | opens ("Found 0 images") | Verified with the real extension |
| Ghostery | installed | popup opens but says "nothing to do on this page" | n/a | The popup does not see the site tab: it opens in its own window, so "the current tab" is not the site |
| Honey | installed | popup opens (PayPal Rewards, asks to log in) | n/a |  |
| Authenticator | installed | popup opens ("No accounts") | n/a | Layout is cut off on the right side |
| Apollo.io | installed | stuck loading | n/a | Possibly the school network; not confirmed |

A failed registration now reports which step failed (`Isolated load check failed`, `Package check failed`, `Could not prepare the extension folder`, `Registration failed`).
