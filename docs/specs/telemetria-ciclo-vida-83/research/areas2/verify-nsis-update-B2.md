# Verdict: needs_changes

## Issues
- [major] The StartGate taken from Idle PROVES no session is live, so installing at phase Idle is safe and graceful_shutdown_before_exit is not needed. The only risks while idle are ffmpeg and batch work (UNVERIFIED).
  - Evidence: recording_lifecycle.rs:741 `Skipping database save in Rust - frontend will save after all transcripts received`. recording_lifecycle.rs:795 `drop(stop_gate)` (Stopping->Idle) runs BEFORE :797 emits RECORDING_STOPPED. After that, useRecordingStop.ts:407-459 does the streaming save while the phase is already Idle (`setStatus(RecordingStatus.PROCESSING_TRANSCRIPTS…)`, `setStatus(RecordingStatus.SAVING…)`, `storageService.saveMeeting(...)`). Streaming is the default for every non-pilot build, and the NSIS channel is one of them: recording_preferences.rs:53-55 `if pilot_batch_build() { "batch" } else { "streaming" }`. In batch mode the planner transcribes after Idle. Its ffmpeg decoder uses `.kill_on_drop(true)` (batch/decoder.rs:117), which never fires under std::process::exit because no destructors run. The job is revived at boot (batch_queue.rs:194 reset_processing), but a live ffmpeg.exe child can still hold binaries/ffmpeg.exe (tauri.windows.conf.json externalBin) while NSIS overwrites it. UpdateDialog cannot read the JS SAVING status: UpdateCheckProvider sits OUTSIDE RecordingStateProvider (app/(main)/layout.tsx:834 vs :544 inside AppContent).
  - Fix: Refuse (outcome `postProcessing`, same UX) while post-stop work is in flight. JS: useRecordingStop sets a module-level flag (a tiny lib store, NOT a React context) from RECORDING_STOPPED until COMPLETED/IDLE/ERROR, and the dialog pre-check reads it together with the phase. Rust (authority, checked at start AND right after StartGate::acquire): refuse if batch_transcription_queue has a row in `processing` (or the planner reports a claimed job). If you keep the kill approach, also kill live ffmpeg children in the hook. Add both to the tests and to the E2E: stop a streaming recording, then immediately click 'Descargar e Instalar'.
- [minor] The ESLint guard (no .install()/.downloadAndInstall() calls from JS) is enough to keep the unsafe path closed.
  - Evidence: tauri.conf.json:73 grants `"updater:default"`, and tauri-plugin-updater-2.10.0/permissions/default.toml includes `allow-install` and `allow-download-and-install`. The plugin still registers commands::install/download_and_install (updater lib.rs:232-237). Any `invoke('plugin:updater|download_and_install')`, or a future dependency or copy-paste, bypasses the member-call selector.
  - Fix: In the main capability of tauri.conf.json, replace `updater:default` with `updater:allow-check`. JS still needs check() for the availability probe. This is a hard ACL guard for every platform. Keep the ESLint rule as the explanatory message. The change is valid in the base config because the rule should apply everywhere.
- [minor] `after_failed_install` handles the hook-ran-but-alive case safely.
  - Evidence: The spec does `Err(join) => { drop(gate); after_failed_install(&app); ... }`. Dropping the gate first moves Starting->Idle (recording_phase.rs:213-222) BEFORE request_restart. In that window the scheduler's 30 s tick can win the StartGate and start a recording against a pool that db.cleanup() already closed.
  - Fix: Check EXIT_HOOK_RAN first. If it is true, `std::mem::forget(gate)` (the phase stays Starting and blocks starts) and call request_restart. Drop the gate only when the hook did NOT run.
- [minor] The Busy single-flight guard covers double clicks and second windows, so the dialog state stays consistent.
  - Evidence: UpdateDialog.tsx:57-65: the effect on `[open, updateInfo]` resets `setIsDownloading(false)`/`setProgress(null)` whenever updateInfo changes. The tray 'Check for Updates' (UpdateCheckProvider.tsx:85-88 `checkForUpdates(true); setShowDialog(true)`) replaces updateInfo in the middle of a download. The dialog then shows 'Descargar e Instalar' again while Rust is still downloading, and the first invoke's Channel keeps calling setProgress on a hidden bar. About.tsx also mounts its own UpdateDialog instance.
  - Fix: Track the in-flight invoke in a ref (or a module-level flag) and skip the reset while it is set. Keep Busy as the Rust backstop.
- [minor] The proposed vitest cases (refusal, invoke of direct_update_install, outcome mapping) work with the existing mocks plus `Channel`.
  - Evidence: UpdateDialog.test.tsx:15 mocks `check: vi.fn(async () => null)`. With null, the open-time effect sets `setError('Actualización ya no disponible')` (UpdateDialog.tsx:77), and the 'Descargar e Instalar' button only renders when `!error` (L535). None of the new cases can click it. Also, EXIT_HOOK_RAN is a process-global static: the spawn_blocking test sets it and would interfere with any after_failed_install test that runs in parallel.
  - Fix: In the github-channel describe, mock check to resolve `{ available: true, version: '0.2.62', downloadAndInstall: spy }`. Reset EXIT_HOOK_RAN inside the same test, or make the flag injectable (pass an &AtomicBool) and follow the leaked_machine pattern of recording_phase.rs tests.
- [minor] The command code sketch is implementable as written.
  - Evidence: The arm `Ok(Err(e)) | Err(_) if false => unreachable!()` does not compile, because `e` is not bound in every alternative. The spec says to remove it, but that needs to be explicit for a Sonnet implementer.
  - Fix: Drop the dummy arm and write the two failure arms explicitly, using the gate order from the issue above.

## Confirmed claims
- tauri-plugin-updater-2.10.0/src/updater.rs:794 `let updater_type = self.extract(bytes)?;` runs before :837-840 `on_before_exit()`. After that come :854-863 ShellExecuteW (result ignored) and :865 `std::process::exit(0);`, all Windows-only.
- updater.rs:289-290 `pub fn on_before_exit<F: Fn() + Send + Sync + 'static>` uses `.replace(Arc::new(f))`, so it REPLACES the default hook set in updater lib.rs:107-110, which only calls `app_handle.cleanup_before_exit()`.
- The plugin Builder (updater lib.rs:127-134) has no on_before_exit, so option (c) cannot be configured at lib.rs:638.
- tauri-2.11.2/src/app.rs cleanup_before_exit only clears the tray icons and the resource tables and hides windows. It never stops a recording, closes the DB or kills the sidecar.
- lib.rs:1786-1824 RunEvent::Exit is the only place that does graceful_shutdown + db cleanup + force_shutdown_sidecar, and process::exit skips it.
- UpdateDialog.tsx:128 `downloadAndInstall` + :174 `relaunch()` has no recording check. The Store paths do check, at :213-217 and :238-242.
- updateService.downloadAndInstall (updateService.ts:350-370) has no callers. The only `.install(`/`downloadAndInstall(` call sites are UpdateDialog.tsx:128 and updateService.ts:364.
- recording_phase.rs:61-63 is_session_active excludes Starting and Stopping. StartGate::acquire is an Idle->Starting CAS whose Err(Starting) message is 'Recording start already in progress', and its Drop reverts Starting->Idle. The scheduler treats 'already in progress' as a benign ManualInProgress (service.rs:654-658).
- DatabaseManager is #[derive(Clone)] at crate::database::manager (database/mod.rs `pub mod manager`, state.rs:1). checkpoint() and cleanup() exist at manager.rs:240 and :296.
- force_shutdown_sidecar (summary_engine/client.rs:203) returns anyhow Result and takes the global pool through a tokio Mutex; get_sidecar_pool re-inits it lazily.
- tauri::async_runtime::block_on from a spawn_blocking thread is valid; tauri's own safe_block_on (async_runtime.rs:301-316) uses the same pattern. The app never calls async_runtime::set.
- The Channel fetch command is exempt from ACL (webview/mod.rs:1823-1826). build.rs is a plain tauri_build::build() with no AppManifest, so app commands need no permission.
- The plugin DownloadEvent serde shape is `#[serde(tag="event", content="data")]` with camelCase Started/Progress fields. The JS type DownloadEvent is exported from @tauri-apps/plugin-updater (index.d.ts:78), and Channel exists in @tauri-apps/api/core.
- Update::download verifies the signature internally (updater.rs:712). Update::install is sync (updater.rs:718), Update is Clone + Send, and updater_builder() carries config, headers and current_exe_args.
- utils::is_running_under_package_identity and utils::is_mac_app_store_build exist and are cfg-safe on every platform. lib.rs:1769 is `store_update::store_install_updates`, and `pub mod database;` is lib.rs:44.
- The JS check() in updateService/UpdateDialog passes no options (no headers, timeout or proxy), so the Rust updater_builder().check() is equivalent.
- No script or test cross-checks generate_handler, so adding a command breaks no lint. lint-tauri-acl only covers window/dialog/app call sites.

## Corrected design notes
Keep the core design: one Rust command, direct_update_install. It checks the platform, runs a single-flight guard and the phase check, calls updater_builder().on_before_exit(own hook), then does check -> download over a Channel -> StartGate::acquire -> install inside spawn_blocking. The hook does sidecar kill (5 s) + db.cleanup (5 s) + log flush, and calls cleanup_before_exit() last. The plugin runs the hook only after a successful extract(). The claims about the plugin, the phases and the runtime all hold.

Required changes:
(1) Phase Idle does not mean the post-stop work is finished. In streaming mode, which is the NSIS default, the JS save of the meeting (PROCESSING_TRANSCRIPTS/SAVING, useRecordingStop.ts:407-459) runs AFTER drop(stop_gate) (recording_lifecycle.rs:795). In batch mode the planner transcribes after Idle, with an ffmpeg child that kill_on_drop does not reap under process::exit. Add a refusal outcome `postProcessing`:
- JS pre-check reads a module-level "post-stop in flight" flag. useRecordingStop sets it from RECORDING_STOPPED until the terminal status. It cannot be a context, because UpdateCheckProvider is outside RecordingStateProvider.
- Rust, at start AND right after the StartGate, refuses if batch_transcription_queue has a row in `processing` (or the planner has a claimed job).
- Optionally, also kill live ffmpeg children in the hook.
(2) Replace `updater:default` with `updater:allow-check` in the main capability (tauri.conf.json:73). This is the hard guard; the ESLint rule stays as documentation.
(3) On the failure path, check EXIT_HOOK_RAN BEFORE dropping the gate. If the hook ran, mem::forget the gate and call request_restart, so no start can race a closed pool.
(4) Guard the dialog's reset effect with an in-flight ref, so a tray re-check does not reset the UI while Rust is downloading.
(5) Tests:
- In the github describe, mock check() to return an available Update, or the button never renders.
- Isolate or reset EXIT_HOOK_RAN.
- Add cases for phase 'stopping', for the post-stop-in-flight flag, and for a Rust refusal when a batch job is `processing`.
- E2E: stop a streaming recording, then immediately click install: expect a refusal, and the meeting saved in SQLite.

Unchanged and still correct: the Guardian backup branch before touching lib.rs, the 2-line lib.rs wiring, and the docs in CANALES_DISTRIBUCION.md plus CLAUDE.md. Also unchanged: T2 hooks the exit intent (reason update_restart) inside the hook before db.cleanup(), and it only protects from 0.2.62 onward, which needs a GitHub release.