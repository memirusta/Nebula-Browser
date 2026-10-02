# Extension isolation as an opt-in: split on first extension, shell state in a Rust-owned store

Status: design, 2026-10-02. Follows `EXTENSION_PROFILE_ISOLATION.md` (findings and spike results).
No product code exists for this; the spike lives in a separate worktree.

## Decisions already made

- Two WebView2 environments: the trusted shell (extensions off) and the browsing environment
  (tabs and extensions, extensions on). Google sign-in runs in the trusted environment, persistent,
  extension-free, no IPC.
- Opt-in: until the user enables an extension, the app stays as it is today (one environment).
  Enabling the first extension migrates the shell state, restarts, and only then activates the
  extension in the browsing environment.
- The shell's `localStorage` is mirrored into a Rust-owned, versioned store one release before the
  split ships, so the split never depends on copying a browser profile's files.

## What this design adds to the spike

Spike facts it builds on: the shell in the trusted folder works with tabs, popups, minimize and
restore, F11 and 20 tabs; profile-level native code goes through `browser_profile::owner`; the
owner is leased and costs nothing at rest. Shell state today is `localStorage` only: 19 keys, about
21 KB in a test profile (largest: browsing history, sessions, closed tabs, settings); no IndexedDB.

## 1. Mode

A small file outside every WebView2 profile, read in `run()` before any window exists:

`%LOCALAPPDATA%\<identifier>\shell-isolation.json`
`{ "schema": 1, "mode": "single" | "split", "pending": null | "split" | "single", "generation": N, "changedAt": ... }`

`single` is the default and what every existing user has. The marker is the only thing that
decides where the shell's webviews are created (main window from the config in `single`; created in
Rust with the trusted folder in `split`; see the spike's `shell_split`). An environment variable
can still force a mode for tests.

What counts as "the first extension": a catalog install or enabling a registered package.
The built-in uBO Lite does not (it ships with the app). Note that in `single` mode uBO Lite already
runs in the shell's profile and even in the shell page (see the isolation note); only the split
removes that.

## 2. The shell-state store

A file `shell-state.v1.json` next to the marker:

```
{ "schema": 1, "generation": N, "writtenAt": ...,
  "entries": { "<localStorage key>": { "v": "<value>", "seq": <number> } },
  "checksum": "<sha256 of the canonical entries>" }
```

Rust side (`src-tauri/src/shell_state_store.rs`: one module, one mutex, one writer; implemented in
release N, mirror only):

- File `shell-state.v1.dpapi` in the app's local data folder, DPAPI-protected like the password
  vault (decision 1 below, yes). Atomic replace through the vault's helpers; the previous good copy
  is kept as `.bak`. A file that cannot be read is copied to `.unreadable` and the store starts
  empty; a store written by a newer schema is never overwritten (the mirror disables itself).
- Commands, shell webviews only (capability `shell-state-store.json`: `main`, `nebula-chrome*`,
  `nebula-window-*`; never a tab, popup, the owner or the sign-in window): `shell_store_apply(ops)`
  with ops `{ op: set | remove, key, value?, seq }`, `shell_store_status()` (generation, key count,
  bytes), `shell_store_wipe()`. There is no `clear` over IPC: emptying the store is the native
  wipe, called at the end of the factory reset. A full snapshot command comes with the hydration
  work (N+1); nothing reads the store back in release N.
- Limits: key at most 256 bytes, value at most 2 MB, store at most 8 MB, 512 operations per batch,
  40 writes per 10 s.
- Last writer wins per key by `seq` (`Date.now() * 1000 + counter`). A removal leaves a tombstone
  (newest 512 kept) so a late `set` from another window cannot bring a removed key back. Unchanged
  values are not rewritten. A write that cannot reach the disk changes nothing in memory.
- Not mirrored: `nebula-browser-run-state-v1` (the crash marker of the current run). Everything the
  app keeps out of `localStorage` on purpose (private tabs) is absent by construction.

JS side, an early script injected by Rust into every shell webview (main window, overlay, extra
windows), before the app's own scripts:

- Wraps `setItem`, `removeItem`, `clear` of the page's `localStorage`; queues changes; sends them
  after 400 ms of quiet, on `pagehide`, and on `visibilitychange`.
- On the first start it sends a full snapshot (the initial seed). Every 60 s it compares what it
  last sent with the live values and sends the difference (writes made by other paths).
- Each shell window mirrors its own writes; the store merges them by `seq`.

Hydration, only in `split`: Rust embeds the store's entries into the injected script as a seed
(`window.__NEBULA_SHELL_SEED__`). Before any app code runs, the script writes the seed into the
fresh trusted `localStorage` if its `__nebula_seed_generation` marker differs from the store's
generation, then records the marker. It is synchronous, needs no IPC, and does not exist as a
race with the app's first read.

## 3. The switch (single to split)

1. The user enables the first extension. The app asks once, in plain words: Nebula will restart to
   keep extensions away from its own screens; tabs and settings come back.
2. On confirm, one native command (trusted shell only):
   flush the mirror and verify the store (checksum, and key count equal to the live `localStorage`),
   mark the run state clean, write `pending: "split"` with the extension to activate, relaunch with
   the process plugin (`relaunch`, as the updater does).
3. On start with `pending: "split"`: create the shell windows in the trusted folder with the
   seed. When the shell reports ready, it sends `shell_isolation_hydrated(keyCount)`.
   Rust checks it against the store; on success it writes `mode: "split"`, clears `pending`, then
   - cleans the residue: a temporary no-IPC webview in the browsing environment at the app's origin
     runs `localStorage.clear()` (origin-scoped, unlike a profile-wide clear), so the shell's old
     data does not stay in the profile extensions run in; and
   - activates the chosen extension through the profile owner.
4. If hydration does not report within 15 s or the counts differ: write `pending: "single"`, relaunch
   into the old layout (its data was never touched), show a notice. The store is kept.

Back to single (Settings, "return to the standard mode", only offered when no extension is
enabled): the same steps with the layout reversed (seed the default folder from the store).
One code path, tested in both directions.

Things the switch must not break: single-instance handoff on relaunch (verify in the spike that the
new process is not handed to the dying one), session restore (the explicit clean-exit mark avoids the
"closed unexpectedly" dialog), the Google sign-in cookie (lives in the trusted folder; moving to
split starts with no Google session in the trusted folder: sign-in is repeated once, or the cookie is
copied through the cookie manager during the switch: decision below), pinned shortcuts and
wallpaper (wallpaper files are native; settings come with the seed).

## 4. Extensions after the switch

- Extensions install into the browsing profile through the owner; the separate catalog profile
  and the "try this site" window go away. Existing catalog installs (only the developer's today)
  are re-registered from their folders; their in-extension data (a Windscribe login) lives in the old
  profile and is not carried over.
- uBO Lite readiness: replace the shell content-script signal with a native check against uBO's
  service worker before the split ships (see the isolation note); the shell keeps working
  without it but loses the "rules loaded before the first page" guarantee.
- Release gate: the evil-extension fixture (the five channels) must pass against the real app, with
  its control (shell in the browsing environment) failing, on every dependency update.

## 5. Tests

Rust: store (atomic write, kill during write, corrupt file and `.bak`, caps, concurrent writers,
"never replace non-empty with empty", checksum), marker (every state, bad file), the switch state
machine with a fake relaunch. TypeScript: the shim with a fake `Storage` (wrap, debounce, flush,
reconcile, seed). Native, with the spike driver: start in `split` with a fresh trusted folder and a
store and compare every key; forward and back; two windows writing; hydration timeout falls back;
the 20-tab, popup, F11 and minimize/restore phases in `split` after a switch.

## 6. Release plan

- Release N: the shim and the store, mirror only. No behavior change. First start takes the initial
  snapshot. Proves the store in real use before anything depends on it.
- Release N+1: the marker, the switch, the owner, the readiness check, the separate-profile removal.
  Opt-in, so users who never enable an extension see no difference except the lease-based owner.
- Shipping the mirror and the switch together is possible (the mirror takes its first snapshot at
  start, long before a user enables an extension), but splitting them is cheaper to undo.

## Decisions (2026-10-02)

1. DPAPI protection for the store: yes.
2. Going back to single in the first version: yes, automatic rollback when the switch does not
   verify, and the manual "return to the standard mode" when no extension is enabled.
3. Google session on the switch: the cookies are not migrated. The user signs in once more in the
   trusted environment, where it then persists.
4. The built-in uBO Lite is not an extension for the opt-in.
5. Display scale smoke at 125% and 150% still has to be run by the user before the split ships.
