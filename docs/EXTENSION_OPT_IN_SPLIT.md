# Extension isolation as an opt-in: split on first extension, shell state in a Rust-owned store

Status: switch, gate, hydration, rollback and the Settings row are implemented (branch `wip/split-opt-in`); the
extension install path (section 4) and the evil-extension gate are not. See `docs/CURRENT_STATE.md`.

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

## 2a. The migration gate (store as a restore source)

Status: design only. Release N mirrors for daily safety; nothing restores from the store.
The 60 s reconcile is a healing mechanism, not a guarantee: after a burst of writes a mirror can
be seconds behind (a live test with four webviews writing for 15 s needed about 3.5 s to catch up,
because of retry after the rate limit), a window can be hung, and one value can be unmirrorable.
The store becomes a restore source only through the gate below, and the result of the restore is
checked a second time, in the trusted environment.

**Defined terms.** *Content digest*: SHA-256 over the live entries `key -> value`, sorted by key,
each as `len(key) key len(value) value` with UTF-8 and 4-byte big-endian lengths; the same function
in Rust (over the store's live entries) and in the shell (over `localStorage`, minus the excluded
keys). Golden vectors, including non-ASCII, are tested on both sides. *Shell webview*: every
webview the `shell-state-store` capability covers, enumerated natively at the moment of the gate.

**Gate (native coordinator, runs before `pending: "split"` is written; any failure leaves the app in
single mode, nothing restarted, nothing activated, and says which step failed):**

1. **Barrier.** Native opens a barrier with an id and refuses to create new shell windows while it
   is open. It tells every shell webview to join (event with the id).
2. **Drain, per webview.** The shim stops the debounce, sends everything pending with the barrier id
   (barrier batches are exempt from the write rate limit, never from the size caps), waits for the
   answer, then runs a full reconcile (live storage against what the store was told) and sends the
   difference the same way. It acknowledges with `{ barrier id, content digest of its live storage,
   key count, pending: 0, in-flight: 0, unmirrorable keys, writes since the barrier opened }`.
3. **Agreement.** Native needs an acknowledgement from every enumerated webview within 10 s. All
   digests must be equal (they read one storage), and equal to the digest of the store's live
   entries. A key that cannot be mirrored (over the size caps, a value that is not well-formed
   UTF-16, a full store) fails the gate by name: the migration would lose it. No silent skip.
4. **Disk check.** The store is read back from disk through the real load path (DPAPI decrypt,
   checksum, schema) and its digest compared again. The previous copy (`.bak`) must decode too.
5. **Commit.** Native asks every webview once more for `writes since the barrier opened`. If any
   webview wrote, the barrier closes and the gate restarts (at most three rounds). If none did,
   native writes `pending: "split"` together with `{ generation, key count, digest }` and
   relaunches. Writes after this point are lost by design; the window is milliseconds, and step 7
   would notice.
6. **Failure and timeout.** No acknowledgement, a digest mismatch, a skipped key, a failed disk
   check or three busy rounds: the barrier is closed, the shells go back to normal mirroring, the
   notice names the cause, the user stays in single mode and can retry.
7. **Hydration check (second proof).** After the relaunch the trusted shell seeds its fresh
   `localStorage` from the store, computes the digest of what it now holds and reports it. Native
   compares it with the digest recorded at the commit. Equal: `mode: "split"`. Different, or no
   report within 15 s: automatic rollback to single (the old profile was never touched).

**Rules that follow:**

- The store never becomes a restore source on its own age or generation; only a gate that passed in
  this process, for this exact generation and digest, authorises it.
- A store written by a newer schema, a store that failed to load (`.unreadable` exists), or a
  mirror that disabled itself blocks the gate with that reason.
- The periodic reconcile stays, as healing for writes that bypassed the hooks and for ties between
  windows. It is never part of the proof.
- Unmirrorable values are found early, not at migration: the shim reports them in the barrier
  acknowledgement and in the store status, so the settings screen can say "this value will not
  survive the switch" before the user decides to enable an extension.

**Tests the gate needs:** Rust: barrier state machine with fake webviews (all acknowledge; one hung;
one disagrees; one writes after its acknowledgement; a window created during the barrier; three busy
rounds), digest golden vectors, disk-check failures (corrupt primary, corrupt `.bak`, newer schema),
rate-limit exemption only with a live barrier id. TypeScript: the shim drains a backlog that was
rate-limited, reconciles, acknowledges the right digest, counts writes after the acknowledgement,
reports unmirrorable keys. Live (extending `shell-state-store-live-multi.mjs`): four webviews writing
while the gate runs; it must either pass with equal digests or fail cleanly, never pass with a
stale store.

## 3. The switch (single to split)

1. The user enables the first extension. The app asks once, in plain words: Nebula will restart to
   keep extensions away from its own screens; tabs and settings come back.
2. On confirm, one native command (trusted shell only):
   pass the migration gate of section 2a (barrier, drain, equal digests, disk check, commit with the recorded digest),
   mark the run state clean, write `pending: "split"` with the extension to activate, relaunch with
   the process plugin (`relaunch`, as the updater does).
3. On start with `pending: "split"`: create the shell windows in the trusted folder with the
   seed. When the shell reports ready, it sends `shell_isolation_hydrated(digest, keyCount)`.
   Rust checks the digest against the one recorded by the gate (section 2a, step 7); on success it writes `mode: "split"`, clears `pending`, then
   - cleans the residue: a temporary no-IPC webview in the browsing environment at the app's origin
     runs `localStorage.clear()` (origin-scoped, unlike a profile-wide clear), so the shell's old
     data does not stay in the profile extensions run in; and
   - activates the chosen extension through the profile owner.
4. If hydration does not report within 15 s or the digest differs: write `pending: "single"`, relaunch
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

## 4. Extensions: install, activation, and the old trial profile

Status: implemented (`src-tauri/src/extension_activation.rs`); evil-extension acceptance in
`scripts/evil-extension-acceptance.mjs`.

### 4.1 Installing is two halves

- **Getting the package** (download, digest/signature check, the isolated load check in a
  temporary profile of its own, unpacking into `extensions/<id>/`) only writes files. It runs at any
  time, in either environment.
- **Activation** (registering the package with the browsing profile, where the tabs live) is the
  half that starts extension code. It is allowed only when the split is committed
  (`shell_isolation::split_committed()`: shell in its own environment, nothing pending, the hydration
  digest matched). The rule is enforced where the registration happens, in `extension_install::operate`
  (`extension_activation::require_split`): any install or enable that targets the browsing profile's
  owner or the old catalog host is refused with `needs-isolation` while the shell shares the profile. The
  built-in uBO Lite has its own install code and is not subject to it (it does not count as a third-party
  extension).
- An install or enable in the single environment therefore ends with the package ready and a record,
  `extensions/<id>/pending-activation` (`{ action: install | enable }`), and the answer
  `{ installed, enabled: false, pendingActivation: true }`. The shell asks once ("Nebula restarts once;
  the extension turns on after that"), then runs the normal switch (gate, restart, hydration check).
  After the switch is final (right after the hydration report, and again at every start of a committed
  split, to retry) the pending records are activated through the profile owner. A failed activation is
  recorded (`activation-error`), shown, and not retried in a loop.
- Removing a pending-only extension deletes its records and prepared folder; nothing was registered.
- Records per extension: `pending-activation`, `installed-profile` (`browsing` once registered with the
  browsing profile), `activation-error`, `migration-review`.

### 4.2 Extensions installed in the old trial profile (metadata-based migration)

Until now catalog extensions registered with a separate "trial" profile (its own WebView2 environment).
An installed extension without the `installed-profile` marker is a **legacy install**. Profile files are
never copied. The move re-creates the install from what was recorded:

1. Only after the split is final. Legacy extensions stay manageable (status, disable, remove) in the trial
   profile until then; enabling one is refused with `needs-migration`.
2. Fetch the package again from the same allowlisted source. If its digest is not the recorded one
   (`installed-folder`), the store changed it since the user reviewed it: nothing is installed, the
   extension is marked `migration-review` and stays where it is until the user reviews and installs it again.
3. Same checks as an install (isolated load check, package check, folder preparation), then registration
   with the browsing profile through the owner; the previous enabled/disabled state is kept.
4. Remove the old registration from the trial profile (its id is carried from before the install
   rewrote the pointer). The owed removal is recorded (`legacy-cleanup`) before it is attempted. If it
   fails the new install is kept (registered in both profiles does not touch the shell: the trial profile
   is its own environment), nothing is shown as an error, the removal is retried first thing at every later
   start, and the trial profile is not deleted until no removal is owed.
5. When no legacy install is left and no removal is owed, the trial profile's host window and folder are removed.
6. The extension's own data (a login inside it) does not move; the user signs in again.

The trial-site window (`extension_host_browse`) opens in the browsing profile once nothing is legacy, and
only while the split is committed.

### 4.3 Release gate

The evil-extension fixture (content script on every page, `tabs`, `scripting` in the main world,
`debugger`, `cookies`, `declarativeNetRequest`) is installed through the product install path in two runs:
a control, where the harness lets it start in the shared profile with the shell in it, and it must reach the
shell; and the product run, where the install must wait, the switch must make the split final, and only then
does it start, reaching the tabs but none of the shell through any channel. It runs on every dependency
update (`scripts/evil-extension-acceptance.mjs`, harness build with the `split-driver` feature).

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
