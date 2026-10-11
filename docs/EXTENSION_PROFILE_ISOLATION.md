# Running extensions in normal tabs: isolating the Nebula shell

Status: research and design, 2026-10-02. No code for this exists yet.

## The problem

Extensions run in a separate "trial" WebView2 profile, so a VPN such as Windscribe
works in an extension window but not in a normal tab (measured live: the same site
opened through "Try this site with extensions" used the VPN, the normal tab did not).

The obvious fix, installing extensions into the profile the tabs use, puts them in the
same profile as the Nebula shell (Home, toolbar, settings, password vault UI), which is
served from `http://tauri.localhost` and can call Tauri commands.

## What a malicious or compromised extension could do in the shell

Established from the code (not tested against WebView2):

- `password_vault_load` returns the whole decrypted vault JSON to the caller. The
  capability `password-vault` grants it to the webviews `main` and `nebula-window-*`.
- `allow-nebula-webview-commands` is broad: navigation, downloads, clearing browsing data,
  factory reset, window creation.
- The CSP (`script-src 'self'`) stops `<script>` injection but not
  `chrome.scripting.executeScript` in the MAIN world.
- The shell DOM shows history, tab titles and settings, which an isolated-world content
  script can read without any Tauri access.
- Match pattern `<all_urls>` covers http(s); `http://localhost/*` is a valid pattern
  (Chrome docs). `http://tauri.localhost` is therefore expected to be covered. Not yet
  measured in WebView2; the spike below measures it with a control.

Moving the vault out of reach (below, "Independent hardening") reduces the damage but does
not close the class: the DOM and the other commands stay reachable.

## What other browsers and Microsoft do

- Chrome, Edge, Firefox: the browser UI lives on privileged schemes (`chrome://`,
  `edge://`, `about:`) that the extension system refuses to touch. Nebula cannot copy this:
  Tauri on Windows serves the shell over http(s).
- Microsoft's own WebView2Browser sample uses two WebView2 environments with different user
  data folders, one for the UI and one for all content tabs, "to isolate UI from web
  content".
- WebView2 multi-profile support (named profiles inside one user data folder) gives each
  profile its own cookies, storage and extensions, and shares one browser process. Microsoft
  says the older approach (a user data folder per control) "consumed more system resources
  including memory, CPU footprint, and disk space".

## Facts about WebView2 that shape the design

- Extensions are persisted per profile (WebView2 Extensions spec). A shell in its own profile
  never has an extension installed.
- `AreBrowserExtensionsEnabled` and `additionalBrowserArguments` are environment options. Two
  webviews on one data folder with different values fail with `ERROR_INVALID_STATE`
  (0x8007139F). Our shell and tabs keep identical options, so this does not bite.
- The spec says nothing about extensions and host-app pages, or InPrivate.

## What Tauri 2.11 actually lets us do (read from the source, locked versions)

Correction of an earlier assumption: `dataDirectory` is not just a parameter.

- Given through JS (`new Webview(..., { dataDirectory })`) or `tauri.conf.json`, the path
  must be relative and is resolved to `%LOCALAPPDATA%\<webview label>\<path>`
  (`tauri/src/webview/mod.rs`, `from_config`). Every label gets its own folder. The shell is
  several webviews (`main`, `nebula-chrome`, `nebula-window-*`, `nebula-chrome-*`) that share
  one `localStorage`, so they would stop sharing it.
- Only the Rust builder accepts an absolute `data_directory`. Tabs, the chrome webview and
  popups are created from JS today, the main window from the config.
- Tauri 2.11 and 2.12 have no profile support. Open: PR #16054 (maps `dataStoreIdentifier`
  to a WebView2 profile name on Windows; about 10 lines in `tauri-runtime-wry`) and issue
  #9285 (opened 2024). The JS option `dataStoreIdentifier` and the config field
  `data_store_identifier` already exist and are ignored on Windows.
- `wry` 0.56 has `with_profile_name`, but also removed the `protocol` feature that
  `tauri-runtime-wry` 2.11.4 enables, and `tauri-runtime-wry` 2.11.4 pins wry 0.55.
  Tauri 2.12 moves to `windows` 0.62 and `webview2-com` 0.39; this project's native code
  uses `windows` 0.61, so upgrading Tauri is a large change of its own.

## Options

| | A. Named profile for the shell | B. Separate data folder for the shell | C. Extension tabs in the extension profile |
|---|---|---|---|
| Idea | Shell webviews get one profile name; tabs and extensions stay in the default profile | Shell webviews on an absolute data folder of their own | Keep today's profile split; open tabs inside the extension profile on request |
| Isolation | Extensions never installed in the shell profile | Same, strongest process separation | Shell untouched |
| Extra processes | None (one browser process) | A second browser process tree | One already exists |
| Tauri changes | Vendored `tauri-runtime-wry` patched like PR #16054 plus wry bump | None to dependencies; create the main window, chrome webview and popups from Rust | Create tabs from Rust |
| Site logins | Kept (tabs stay put) | Kept | Separate cookies; sign in again |
| Shell data | Moves: copy `Local Storage` once, before the first window | Moves: same | Stays |
| Main risk | Patched dependency; Tauri may rename the attribute in v3 | Startup semantics of the main window (AGENTS.md: F11, restore, maximize) | Logins and cookies not shared with normal tabs |

The shell holds only `localStorage` (39 files, 93 call sites, no IndexedDB), so its move is a
one-time copy of the `Local Storage` folder, not a rewrite.

## Independent hardening (worth doing under any option)

Do not give the shell plaintext secrets: native code fills the page, the shell learns only
that a login exists for a site, and revealing a password keeps requiring Windows Hello
(`password_verify_reveal` already does). It shrinks the damage but is not a boundary.

Rejected: serving the shell from a non-http scheme (not possible with Tauri on Windows);
rewriting extension manifests to exclude the shell (match patterns cannot exclude hosts, and
changing packages is a last resort); fetching passwords from Drive (the threat is the shell
being able to ask for plaintext, not where it is stored).

## Recommended order

1. Spike, outside the repo's main tree, answering with measurements (include a control):
   1. Does a content script run on the shell origin with the shell in the default profile?
      (Expected yes: this confirms the risk.)
   2. With the shell in a named profile, does the same extension stay out of the shell and
      keep working in tabs?
   3. Do shell and tabs coexist in one window (layout, focus, z-order, drag, F11, minimize
      and restore)?
   4. Does a copied `Local Storage` folder show up in the shell's new profile?
   5. Does a vendored `tauri-runtime-wry` with wry 0.56.1 build and run with this app?
   6. What does a second environment cost in memory (for option B)?
2. If A passes, adopt it; if the dependency patch is too fragile, B.
3. Move extensions to the default profile, reinstall the catalog extensions there, remove the
   trial profile concept and the extra catalog host.

## Sources

- Microsoft, WebView2Browser sample: https://learn.microsoft.com/en-us/microsoft-edge/webview2/samples/webview2browser
- Microsoft, multiple profiles under one user data folder: https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/multi-profile-support
- WebView2 Extensions spec: https://github.com/MicrosoftEdge/WebView2Feedback/blob/main/specs/Extensions.md
- Chrome match patterns: https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns
- Tauri PR 16054: https://github.com/tauri-apps/tauri/pull/16054
- Tauri issue 9285: https://github.com/tauri-apps/tauri/issues/9285
- Tauri issue 11144 (browser args need separate data directories): https://github.com/tauri-apps/tauri/issues/11144
- wry changelog: https://github.com/tauri-apps/wry/blob/dev/CHANGELOG.md

## Second opinion and revised recommendation (2026-10-02)

An independent review (a second AI model, working from the same sources and the repo summary)
was compared with the notes above. Where it changed the plan:

- **Rejected: blocking the shell with Edge's `ExtensionSettings` / `runtime_blocked_hosts`.**
  Microsoft states that "Policies for Microsoft Edge don't apply to the WebView2 Runtime and
  WebView2 apps. This is by design." (Enterprise management of WebView2). Even where a registry
  value seemed to work it would not be a documented boundary.
- **Rejected: Tauri 3 alpha.** `tauri-runtime-wry` 3.0.0-alpha.4 (2026-10-01) uses wry 0.57, but
  its Windows code does not map `data_store_identifier` to a profile either; PR #16054 is still
  open. Moving to an alpha, wry 0.57, `windows` 0.62 and `webview2-com` 0.39 for one feature is
  the wrong trade.
- **Rejected: copying `Local Storage/leveldb` into another folder.** Microsoft documents only
  "shut down all sessions, move the contents of the UDF, start with the new path", and one UDF
  can have at most one session. A partial LevelDB copy is not a supported migration. Migrate at
  application level instead: read the shell's `localStorage` through the old profile once and
  write it into the new one, or better, give the shell state a Rust-owned copy (JSON or SQLite)
  that is loaded on start. That also removes the dependency on a Chromium profile database.
- **Changed recommendation: option B first** (two real environments, shell and browsing). The
  trusted environment is created with `AreBrowserExtensionsEnabled = false`, so it cannot run an
  extension at all, rather than merely having none installed, and the extension can never see the
  shell through `chrome.tabs`, `chrome.debugger` or `scripting` because it is a different browser
  process. This also avoids the open question below. Named profiles (option A) become a later
  optimisation once PR #16054 ships in a stable Tauri.
- **Cost is smaller than first stated.** Today there are already two user data folders (the
  default one and `extension-browsing-profile`). Under B the default folder keeps tabs and
  extensions, the shell gets its own, and the extension-only folder goes away. Microsoft warns
  against "too many" folders at once; two is the same count as now. It still has to be measured:
  confirm that all tabs share one `BrowserProcessId` and the shell has another.
- **Tabs are not touched.** Tabs and popup content are created from JS with no `dataDirectory`,
  which Tauri resolves to `%LOCALAPPDATA%\<identifier>`: the folder they already use. Only the
  shell webviews move: `main` (config), `nebula-chrome` (JS today), `nebula-popup-chrome-*`, and
  the workspace windows (already Rust, `browser_workspace.rs`). The webviews of one shell must use
  the same absolute folder and the same environment options (`ERROR_INVALID_STATE` otherwise).
  If `main` stays config-created, its relative `dataDirectory` resolves under
  `%LOCALAPPDATA%\main\<path>`; the Rust-created shell webviews would then point at that same
  absolute path.

### Not yet proven (the second opinion agrees; do not ship on reasoning alone)

- A content script, `scripting.executeScript`, `chrome.tabs.query`, `chrome.debugger` and a
  `declarativeNetRequest` rule on `*://tauri.localhost/*` all reach the shell when it shares the
  profile. No bug report found; WebView2 issue #3855 shows extensions seeing other WebView2
  instances in the same context, which points the same way.
- Under B none of them reaches the shell. A named profile (option A) has no Microsoft statement
  that an extension in profile A cannot see profile B's webviews; B does not need one.

### Evidence from this repo (commit 860e4fb)

- Capabilities use only `webviews:` labels (`default.json`: `main`, `nebula-chrome`,
  `nebula-window-*`, `nebula-chrome-*`; `password-vault.json`: `main`, `nebula-window-*`;
  `desktop.json`: `main`, `nebula-window-*`; `popup-chrome.json`: `nebula-popup-chrome-*`). None
  uses `windows:`, which would also cover child webviews. Tab webviews (`nebula-tab-*`), popup
  windows and content (`nebula-popup-window-*`, `nebula-popup-content-*`) and the Google sign-in
  window (`nebula-google-oauth-*`) match nothing, so they have no IPC.
- `nebula-window-*` is created only by `browser_workspace::create_window` (Rust, app UI).
- `localStorage`: 39 files, 122 mentions, 93 `localStorage.` call sites; no IndexedDB outside
  DeveloperTools.
- Hardening noted: the Google sign-in window is built with `browser_extensions_enabled(true)`,
  so extensions can run on Google's credential pages like on any tab; decide whether to turn it
  off. Keep every window opened from web content (`window.open`) in the browsing environment.
  Never navigate a trusted webview to a remote URL (add `on_navigation` guards to the shell).

### Release gate to add

An "evil extension" fixture asking for `<all_urls>`, `scripting`, `tabs`, `debugger` and
`declarativeNetRequest`, with a sentinel (`window.__NEBULA_TRUSTED_SHELL__`) in the shell DOM. The
test must show it can act on a browsing tab and can neither enumerate, inject into, nor attach to
`main`, the chrome webview or Home. Run it with a control (shell in the browsing environment:
expected to fail) so a passing result means something, and on every dependency update.

### Revised spike (supersedes the list above for option B)

1. Control: shell in the same environment as the evil extension: all five channels reach it.
2. Shell on its own folder with extensions disabled: none reaches it; tabs still work.
3. One window with both environments: layout, focus, z-order, drag, F11, minimize/restore.
4. Process count: all tabs share one browser process, the shell another.
5. State: shell `localStorage` restored from the application-level copy into a fresh shell folder.
6. Memory: base cost of the shell environment against today's two-folder setup.

## Spike results, stage 1 (2026-10-02)

Code: `D:\Projects\nebula-spike` (detached worktree of 860e4fb, nothing committed, main tree
untouched). Test file `src-tauri/src/shell_isolation_spike_native_test.rs`; raw reports in its
`src-tauri/target/shell-isolation-*.json`. Real WebView2 152.x on Windows 11, debug build, shell =
the embedded app served at `http://tauri.localhost/` with a sentinel in its DOM and in `window`.
The "evil" extension asks for `<all_urls>`, `tabs`, `scripting`, `debugger`,
`declarativeNetRequest`, `cookies`, with a content script on every page.

An early control run was invalid: in a debug build `WebviewUrl::App` points at the dev server
(`localhost:5173`), so the "shell" was an error page. The harness now clears `build.dev_url`.
The valid runs below use the real `tauri.localhost` page.

### Does the evil extension reach the shell?

| Channel | Control: shell and tabs in one folder | Split: shell in its own folder, extensions off |
|---|---|---|
| Content script runs on the shell page | **yes** | no |
| Content script reads the shell DOM sentinel | **yes** | no |
| `chrome.tabs.query` lists the shell | **yes** | no |
| `scripting.executeScript` (MAIN world) reads the sentinel | **yes** | no |
| `chrome.debugger` attaches and reads the sentinel | **yes** | no |
| `declarativeNetRequest` rule blocks a fetch on the shell origin | **yes** (fetch blocked) | no (`status:500` from the app itself) |
| Same channels against a normal tab (probe works) | yes | yes |
| Process of shell and tab | one browser process | two browser processes |

The control confirms the risk is real: today's layout lets an extension read and script the
trusted shell by every route tried. The split layout closes all of them, as expected from two
browser processes.

### InPrivate and environment mismatch

- An InPrivate webview in the extensions-ON folder is **extension-free**: its page loaded and ran its
  own script, the extension's content script did not run and its blocking rule did not apply
  (`status:200`, against `blocked` in a normal tab), and `tabs.query` does not list it.
  (Positive control: the page's own `window.__dnr_probe` was read back.)
- A webview with extensions OFF in a folder that already runs with extensions ON is **broken**:
  `add_child` returns Ok, the page never runs (script channel closed), and there is no browser
  process for it. So the Google sign-in window cannot be "extensions off" in the browsing folder;
  it needs InPrivate there (no persistent Google cookies for tabs) or the shell folder.

### Processes and memory (3 tabs, real app as shell, each layout run twice)

| Layout | Processes | Working set, tree | Browser processes |
|---|---|---|---|
| One folder: shell and 3 tabs (a user who never uses extensions) | 11 | 580, 583 MB | 1 |
| Split: shell folder + browsing folder (the proposal) | 16 | 841, 841 MB | 2 |
| Today with the catalog host open: one folder plus the extension folder | 17 | 887, 886 MB | 2 |

The earlier claim that the split costs the same as today holds only for users who already opened
the extension catalog. For a user who never does, the split adds 5 processes and about 260 MB
(about 45% on this small setup). Working-set sums double count shared pages and these are small
pages in a debug build, so read them as relative. A named profile (option A) would share one
browser process and is the way to get that back once Tauri exposes it.

### Not yet measured

Layout, focus, z-order, drag, F11 and minimize/restore with the two environments in the real app
(children of different folders were created and loaded in one window, nothing more); the shell's
`localStorage` mirror; 20-tab behaviour; the effect of `AreBrowserExtensionsEnabled=false` on
anything the shell uses.

## Spike results, stage 2: the real app (2026-10-02)

Same worktree (`D:\Projects\nebula-spike`, detached from 860e4fb, nothing committed). The real app
runs with a switch (`NEBULA_SPIKE_SPLIT=1`): the config windows are created in Rust, so the main
webview is in the trusted folder with extensions off; the overlay webview (`nebula-chrome`) is created
by a new native command; workspace windows and the Google sign-in window use the trusted folder; tabs
and popup content stay as they are (JS-created, default folder, extensions on). A driver inside the
app (`NEBULA_SPIKE_DRIVER`) opens tabs through the same path as a second launch with links and
drives minimize/restore, popups, tab walking and closing with real keys (sent only while a Nebula
window is in the foreground). Isolated test identity (`com.nebula.browser.perf`), release build,
Windows 11, one 1920x1080 monitor at 100%.

### What broke first, and why it matters for the design

With only the shell moved, no tab webview ever appeared. The transition log said
`browser.webview.ensure-ublock ... The request is not supported. (0x80070032)`: the built-in uBlock
install and status calls run through "the profile of the window label" (`main`), and `main` is now in
an environment where extensions are off (`AddBrowserExtension` returns `ERROR_NOT_SUPPORTED`). Every
tab activation failed. The same pattern is in the native privacy and permission code. Fix used in the
spike: `shell_split::profile_webview` maps a shell label to a hidden `extension-browse-host` webview in
the browsing environment, and 7 call sites go through it (3 in `ublock_extension.rs`, 4 in
`webview_privacy.rs`).

Not yet audited and likely to need the same treatment: `webview_controls::webview_process_snapshot`
(asks `main` for its environment's processes, so it would list only the shell's), `site_ui.rs:2119` and
`context_menu.rs:403` (profile access, probably per tab), and the extension host and catalog code,
which must move to the browse host. Also pre-existing and unrelated: the shell logs "Failed to apply
browser privacy settings" for tabs that have no webview yet, in both modes.

### Measured (split against the unchanged app, same driver)

| Check | One environment (today) | Split (shell trusted, tabs default) |
|---|---|---|
| Shell and overlay webviews | default folder, browser process P1 | trusted folder, process P1 |
| Tabs and popup content | default folder, process P1 | default folder, process P2 (all tabs share it) |
| Tab opens, chrome overlay above it, tab fills the window | yes | yes |
| Minimize and restore x5 (tab above shell, fills it, overlay above tab, one visible tab) | 5/5 | 5/5 |
| `window.open` popup: window and content created, content in the tab process, content gone after close | yes | yes |
| Real F11, enter then exit (4 runs each) | enter 3/4; exit within 8 s 0/4 (extra press needed) | enter 4/4 in 0.3 s; exit 4/4 in 0.3 s |
| Walk many tabs with Ctrl+Tab, close with Ctrl+W | 14 live tab webviews; closing stalls at about 12 | 18 live tab webviews; closing stalls at about 11 |
| Google sign-in window | default folder | trusted folder, extensions off, cookie survives an app restart, IPC refused ("not allowed by ACL") |

The F11 and Ctrl+W differences are in the unchanged app too, so they are not caused by the split;
the split did not make them worse. They look like pre-existing behaviour worth a separate look
(F11 exit and closing the last tabs), measured here only because the same driver exposed it.

The pre-existing problems found while building the driver, in case they are real: the "Nebula closed
unexpectedly, restore your tabs" dialog blocks opening new tabs until dismissed (caused here by the
driver exiting the app with a forced exit).

### Not measured, still open

- Display scaling other than 100% and mixed-DPI monitors (this machine has one monitor at 100%): needs
  a manual pass at 125% and 150%.
- Real use of the keyboard focus after restore (the driver reports the focused webview as empty in both
  modes after a restore, so nothing is concluded).
- The opt-in flow (no change until the first extension is enabled, then migrate the shell state,
  restart, and enable extensions in the browsing environment), the Rust-owned versioned copy of the
  shell's `localStorage`, moving the extension host to the browse host, and the rest of the call-site
  audit above. In this stage the shell's state in the trusted folder was seeded by copying the test
  profile's `Local Storage` folder; that is test setup, not a migration.
- Memory with equal tab counts in both modes (the walks reached different numbers of live tabs). The
  earlier small-page measurement (+5 processes, about +260 MB for the second environment) still stands.

## Spike results, stage 3: profile-owner audit and abstraction (2026-10-02)

Spike worktree `D:\Projects\nebula-spike`; nothing committed.

### Audit: every browser-profile access, and whether it assumed `main`

Scanned all non-test sources for WebView2 profile, environment, cookie, extension and
profile-folder access, and for lookups of `main` or of a caller-supplied window label.

| Where | What it does | Assumed main/caller label? | Now |
|---|---|---|---|
| `ublock_extension.rs` status, install, remove-stale | extensions of the profile | **yes** (`ensureUblockProfile(window label)`) | `browser_profile::owner` |
| `webview_privacy.rs` clear browsing data, non-default permissions, reset a permission, clear site permissions | profile data and permissions | **yes** (label from JS) | owner; the label is accepted on the wire and ignored |
| `webview_privacy.rs` factory reset | wipe every environment | iterated all webviews | owner ensured first; each webview's own profile, by design |
| `webview_privacy.rs` storage usage | size of the browser data | read `app_data_dir()` (Roaming): **wrong folder, always reported 0** | owner's real folder: now reports 94 MB / 34 MB cache |
| `webview_privacy.rs` `apply` | privacy settings of ONE tab | no (strict tab/popup label guard) | unchanged |
| `webview_controls.rs` process snapshot | WebView2 processes | **yes** (`main`, so only the shell's environment) | shell and owner environments, merged |
| `webview_controls.rs` print settings (2) | printing for one tab | no (that tab's own environment) | unchanged |
| `site_ui.rs` private-mode check, `context_menu.rs` setup | profile of the tab that raised the event | no | unchanged |
| `extension_host.rs` list, open, click, extension window folder | "regular profile" extensions | **yes** (caller's window label; folder read from the caller's webview) | owner label and owner folder; the folder helper is gone |
| `extension_install.rs` package manage | registered packages | **yes** (`webview.window().label()`) | owner |
| `extension_runtime.rs` version read | runtime version | any webview works | owner label passed |
| catalog host and trial windows | separate extension profile | no: own folder, own host | unchanged; folds into the owner when extensions move to the browsing profile |
| `google_sync`, vault, wallpaper | files under `app_data_dir` | not browser profile | unchanged |

`browser_profile.rs` is now the single place: a leased `ProfileOwner` (hidden, no capability, no
Tauri bridge, `about:blank` only, in the browsing environment, never `main`), plus a separately
named `shell_webview` for the two jobs that really are about the shell's environment. The 7 label
hacks of stage 2 are gone; profile-level functions no longer take a label.

Guard: `tests/browser-profile-owner.test.ts` (7 tests). It fails on the pre-refactor sources
(6 of 7 red, run against the main tree) and passes on the refactor.

### Measured on the real app

- Owner: not visible; `__TAURI_INTERNALS__` undefined (no bridge, stronger than an ACL refusal);
  a navigation attempt stays on `about:blank`; same browser process as a tab; default folder;
  not among the shell window's children; no capability matches its label; lifecycle treats it as
  background.
- Every profile operation called with the shell label (`main`) lands on the browsing profile in
  both modes: uBlock status, site-permission clearing, extension enumeration, storage usage,
  process snapshot (two browser processes in split, one today).
- Cost: the first version kept the owner alive: about one renderer process and 35 to 65 MB for every
  user, extensions or not. It is now leased: it exists while an operation holds it and for 60 s
  after, then it is destroyed (744 to 689 MB and 12 to 11 processes today; 929 to 864 MB and 16 to 15 in
  split) and the next operation recreates it and works.

### DPI and layout smoke

`scripts/spike-dpi-smoke.ps1` in the spike worktree (eight PASS/FAIL checks, prints the scale
factor the app saw). At 100% (1920x1080): split 8/8. Today's single environment: 4/6; F11 fails
there (it did in every earlier run too: enter missed once, exit within 8 s missed 3 of 4), so it is a
pre-existing problem, not caused by the split. 125% and 150% are not run: changing the display
scale is a system setting that has to be done by the user; the script is one command per scale.

### Also found

- The "restore your tabs, Nebula closed unexpectedly" dialog blocks opening tabs until dismissed;
  the app's own forced exit leaves the marker (`nebula-browser-run-state-v1`, `cleanExit`).
- Today the built-in uBO Lite is installed in the same profile as the shell, so even without user
  extensions its content scripts match `http://tauri.localhost`. The split removes that too.
- **The shell is an extension target by design today.** uBO Lite (vendored) asks for
  `<all_urls>`, `scripting` and `userScripts`, and one content script (`nebula-ready.js`) matches
  `*://tauri.localhost/*` on purpose: the shell reads `data-nebula-ublock-ready` from its own page
  (`waitForUblockRules`, 4 s timeout) to know the rules are loaded. In the split the shell has no
  extensions, so that signal never arrives. Effect: only when uBO was installed in this session
  (`installedNow`) the shell waits the full 4 s once instead of until ready, and the "rules loaded
  before the first page" guarantee is gone. Needs a native readiness check (ask uBO's service worker
  through the browsing environment, using the worker plumbing `extension_worker` already has) before
  the split ships.
