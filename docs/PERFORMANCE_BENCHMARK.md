# Nebula WebView2 performance benchmark

Use the **local source build** for both sides of a comparison. Record the commit, dirty-file snapshot, binary path and version, Windows and WebView2 Runtime versions, machine RAM, display resolution, and the exact site list. Keep the same profile, extensions, network, and tab order across runs. Do not compare the September 15 CSVs or an installed binary with a new source build as a before/after result.

The collector samples Nebula's process tree, checks child creation times to avoid reused parent PIDs, and records total/private WebView2 memory, working set, process count, system RAM pressure, and interval CPU. The first CPU sample is intentionally blank. `TabCount=0` means the tab count is unknown, not a verified zero-tab session. The transition log supplies activation and startup events; the summary computes tab-switch P50/P95 only for a controlled `switching` sample. It can contain browsing URLs, so keep the raw log local and share only the aggregate output. Aggregate working set can double-count shared pages across processes; use private bytes as the main memory comparison.

## Capture

1. Build and start the exact binary under test. Set `VITE_NEBULA_TRANSITION_LOG=1` **when building the frontend** for startup and tab-switch timings; this is a Vite build-time flag, so setting it only when launching `app.exe` has no effect. For an isolated WebView2 UDF, pass `--config src-tauri/tauri.perf.conf.json` to the Tauri build. It changes the app identifier; verify the resulting WebView2 process command lines point to `com.nebula.browser.perf` before opening benchmark tabs. Record the PID. Do not close an existing user session just to benchmark; use a separate controlled session when available.
2. Open the same 1, 5, 10 and 20 test URLs in the same order. `scripts/perf-local-server.mjs` serves 20 static pages on separate localhost origins for a repeatable tab-overhead baseline. Run a realistic site mix separately. Keep audio, downloads, and notification sites out of the ordinary-tab scenario; measure those exceptions separately. Wait for each activation to complete before sending the next URL; rapid second-instance bursts can leave tabs unactivated.
3. For each tab count, collect a 60-second `live` sample after pages settle. Collect `idle` only when network/page activity has stopped. Switch tabs at least 20 times while collecting `switching` so P95 is meaningful.
4. At 5, 10 and 20 tabs, leave all but one in the background. Collect `suspended` after the configured sleep threshold and `discarded` after the unload threshold. Confirm `browser.tab-sleep` and `browser.tab-unload` results in the transition log; a timer firing alone is not proof that WebView2 suspended or closed.
5. Repeat after a cold app start with session restore enabled. Record process-to-frontend-ready and process-to-first-tab separately. The former is only an app-shell milestone; the latter may include site/network time.

Build the isolated fixture from the repository root:

```powershell
$env:VITE_NEBULA_TRANSITION_LOG = '1'
npm.cmd run tauri:build:binary -- --config src-tauri/tauri.perf.conf.json
```

Keep the local server running in a separate terminal:

```powershell
node scripts/perf-local-server.mjs
```

Start the isolated app binary, then pass the listed URLs to subsequent `app.exe` invocations. Verify the UDF path and successful activation count before labeling a sample. In another terminal (change PID and paths):

```powershell
pwsh -NoProfile -File scripts/perf-stress.ps1 -RootPid 12345 -Label candidate-10-live -TabCount 10 -Phase live -DurationSeconds 60 -OutputPath src-tauri/target/perf/candidate-10-live.csv
node scripts/perf-benchmark-summary.mjs src-tauri/target/perf/candidate-10-live.csv
```

Pass all CSV paths to the summary script for a single table. Use `--trace=<path>` when the transition log is elsewhere. It reports the median private/working set, peak private memory, WebView2 process count, mean interval CPU, switch P50/P95 for the `switching` phase, and process-to-startup events for `startup` or `uncontrolled`. Switch timing excludes tabs that were first activated during the sample and repeat activations of the same tab. `processToShellUsableMs` is the first completed Home or browsing mode transition; page/network readiness may take longer. `processToFirstTabMs` appears only for `startup`. `null` means the timing event was not captured, rather than zero milliseconds.

The 1-tab to N-tab private-memory slope is an observed marginal cost for that site mix, not an intrinsic cost of a WebView. Different sites, site isolation, GPU allocation, extensions, and system cache can change it. Compare like phases and at least three cold-start runs per candidate before drawing a performance conclusion.

For binary and installer size, measure the exact built `app.exe` and NSIS artifact with `Get-Item ... | Select-Object Name,Length`. The release profile already sets thin LTO, one codegen unit, size optimization, abort panic, and symbol stripping. Changes to those settings should follow measured runtime work.
