# Verdict: needs_changes

## Issues
- [minor] Phase Idle means it is safe to close the pool and exit (the 'Idle guarantees no capture is live' mitigation, and refusal_for_phase as the only gate).
  - Evidence: Work that writes to SQLite keeps running after Rust is back in Idle. (1) Batch mode: audio/transcription/batch/decoder.rs:4-10 runs a single ffmpeg decode that reads the stream in 60 s windows while the transcriber runs, so ffmpeg lives for the whole batch job, with `kill_on_drop(true)` (L117) that `process::exit` never triggers. Rows are marked `status IN ('recording','pending','processing')` (database/repositories/batch_queue.rs:182), and `batch_queue_list_active` is already a command (lib.rs:1639). The pilot builds run batch mode. (2) Streaming mode: useRecordingStop.ts:407/427 does `PROCESSING_TRANSCRIPTS` -> `SAVING 'Saving meeting to database...'` in JS after the Rust stop has completed. The hook closes the pool (`db.cleanup()`) and the process exits in the middle of both. Nothing is lost permanently: the orphan recovery in planner.rs:17-19 re-runs the job on next boot, and IndexedDB autoRecoverAll covers the JS save. But the batch job is thrown away and restarts, and an orphaned ffmpeg.exe can briefly hold the bundled binary while NSIS overwrites it.
  - Fix: Extend the refusal (or add a confirm step). In Rust, after `StartGate::acquire()`, call `BatchQueueRepository::list_active` and refuse if any row is 'processing' for this process. Return a new outcome such as `backgroundWork` with the toast 'Hay una transcripción en proceso; actualiza cuando termine'. In JS, also refuse while RecordingStateContext status is not IDLE (STOPPING/PROCESSING_TRANSCRIPTS/SAVING). Add both cases to the tests. At minimum, write this down in the doc and the risks list as a known gap, not as UNVERIFIED.
- [minor] Hook order: force_shutdown_sidecar (5 s) first, then db.cleanup() (5 s).
  - Evidence: client.rs:83-93 `get_sidecar_pool` re-creates the pool lazily. Once the sidecar is killed, any coach or summary call during the next wait of up to 5 s (the checkpoint plus `pool.close()`, which waits for in-use connections such as the sync worker) can respawn llama-helper.exe. That is exactly the lock NSIS has to avoid. RunEvent::Exit (lib.rs:1802-1818) already uses the safer order: DB first, sidecar last.
  - Fix: Run db.cleanup() (plus the T2 marker) first. Run force_shutdown_sidecar last, right before cleanup_before_exit, so the window for a respawn is only milliseconds before ShellExecuteW + exit. Keep the 5 s timeouts.
- [minor] The command code in direct_update.rs as written.
  - Evidence: The arm `Ok(Err(e)) | Err(_) if false => unreachable!()` does not compile: `e` is bound in only one alternative, which is error E0408. The spec does say to remove it, but the snippet is presented as the file.
  - Fix: Remove the arm from the snippet itself so an implementer does not copy it. The two real failure arms (`Ok(Err(e))` and `Err(join)`, where the tauri JoinHandle yields `tauri::Result`) are enough.
- [minor] after_failed_install -> request_restart when the hook already ran.
  - Evidence: tauri-2.11.2/src/app.rs:1098-1099: cleanup_before_exit carries the doc comment 'You should always exit the tauri app immediately after this function returns and not use any tauri-related APIs.' It clears the resource tables and the tray. After the hook, the plugin runs only ShellExecuteW and process::exit(0) (updater.rs:852-865), so this branch is reachable only through a panic inside our own hook. request_restart after cleanup_before_exit is outside Tauri's contract.
  - Fix: Keep the branch as best effort, but only call cleanup_before_exit when the DB/sidecar part finished without panicking. Wrap exit_cleanup_blocking in catch_unwind and skip cleanup_before_exit on panic, so request_restart still runs on intact Tauri state. Document the remaining edge case.
- [minor] The ESLint guard `CallExpression[callee.property.name=/^(downloadAndInstall|install)$/]`.
  - Evidence: .eslintrc.json no-restricted-syntax (L13-22) applies to every .ts/.tsx except src/shared/maity-shared/** (override at L54-57). `install` is a generic method name, so any future library call such as `something.install()` is flagged with a misleading updater message. Computed access (`update['install']()`) gets around the rule.
  - Fix: Accept the rule, but narrow the message to 'plugin-updater Update.install/downloadAndInstall' and allow `// eslint-disable-next-line` with a reason. Alternatively, use the selector on downloadAndInstall|download|install only where the callee object is typed Update. Also add a vitest fitness test that greps src for `downloadAndInstall(` and `.install(` (the same pattern as layout.test.ts).
- [minor] The test that runs exit_cleanup_blocking(None) from tauri::async_runtime::spawn_blocking inside #[tokio::test(flavor=multi_thread)].
  - Evidence: tauri async_runtime.rs:290-296 spawn_blocking uses Tauri's own global RUNTIME (default_runtime), not the test runtime. The test still passes, but it mutates the process-global EXIT_HOOK_RAN and calls the real force_shutdown_sidecar global (client.rs:203-215), so it is not isolated and can race with a test of after_failed_install.
  - Fix: Use a plain #[test] that calls `std::thread::spawn(|| exit_cleanup_blocking(None)).join()`, which exercises block_on from a non-async thread, or keep spawn_blocking and drop the tokio::test attribute. Mark it #[serial] (or give the flag an injectable parameter) if another test reads EXIT_HOOK_RAN.

## Confirmed claims
- UpdateDialog.tsx:128 `await updateToUse.downloadAndInstall(` and :174 `await relaunch();`. There is no get_recording_state in handleDownloadAndInstall (L95-182), while the Store paths check at L213-217 and L238-242.
- updateService.ts:350-370 downloadAndInstall (`await update.install(); await relaunch();`) has no callers. Grep finds only UpdateDialog.tsx:128 and updateService.ts:364.
- tauri-plugin-updater 2.10.0, updater.rs install_inner: L794 `let updater_type = self.extract(bytes)?;`, L837-840 on_before_exit runs only after extract succeeds and the args are built, ShellExecuteW's result is ignored (L854-863), L865 `std::process::exit(0);` under #[cfg(windows)].
- Updater lib.rs:107-110: the default hook only calls `app_handle.cleanup_before_exit()`. The public `Builder` (L127-134) has no on_before_exit. `UpdaterBuilder::on_before_exit` (updater.rs:288-291) is `Fn() + Send + Sync` and uses `.replace`, so it overrides the default.
- updater_builder() (lib.rs:71-104) carries config/pubkey/headers/target/version_comparator and current_exe_args, so the Rust path has the same settings as JS check(). JS check() is called with no options (updateService.ts:171, UpdateDialog.tsx:73/100).
- `mod commands;` is private (updater lib.rs:23). DownloadEvent's serde shape is `tag=event, content=data`, with camelCase Started{contentLength}/Progress{chunkLength}/Finished (commands.rs:14-26). `DownloadEvent` is exported as a JS type (index.d.ts:78).
- Update: `download` (L652) verifies the signature before returning, `install(&self, bytes)` (L718), and Update is Clone with public version/current_version.
- tauri app.rs:1098-1112 cleanup_before_exit only clears the tray, clears resource tables and hides windows.
- lib.rs:1786-1824: the RunEvent::Exit handler is the only place that does graceful stop + db cleanup + sidecar kill.
- tauri async_runtime.rs:272-275 block_on and :290-296 spawn_blocking both use the global runtime, so block_on from the spawn_blocking thread (not an async context) is valid. Calling install() from an async worker would make block_on in the hook panic, so spawn_blocking is required.
- recording_phase.rs: StartGate::acquire is the Idle->Starting CAS, with the messages 'Recording start already in progress' / 'already in progress' / 'still stopping'. Drop reverts Starting->Idle. StartGate holds `&'static PhaseMachine` (Send). PhaseMachine::new is `pub const fn`, and `current_phase()` and `RecordingPhase::as_str` exist.
- scheduled_recording/service.rs:654-658 treats 'already in progress' as a benign ManualInProgress.
- graceful_shutdown_before_exit (lib.rs:1833) returns early when no session is active, so the macOS `mem::forget(gate)` (phase Starting) does not block RunEvent::Exit.
- state.rs:1 `use crate::database::manager::DatabaseManager;` confirms the type path. manager.rs:296-314 cleanup = TRUNCATE checkpoint + pool.close(). force_shutdown_sidecar is re-exported at summary::summary_engine (mod.rs:15).
- get_recording_state returns a `phase` string (recording_commands.rs:76-99), and the TS RecordingState has `phase?` (recordingService.ts:18), so the JS `phase !== 'idle'` pre-check works.
- build.rs calls plain `tauri_build::build()` with no AppManifest, so app commands need no capability. lint-tauri-acl.js only checks window/dialog/app permission call sites.
- utils::is_running_under_package_identity (utils.rs:14) and utils::is_mac_app_store_build (utils.rs:87) exist and can be called from Rust.
- tray.rs:550 'Check for Updates' -> tray.rs:59/336 only open the dialog. The updater endpoint is GitHub latest.json (tauri.conf.json:161-162), and there is no windows.installMode, so the default is Passive.

## Corrected design notes
Keep the design: a single Rust command `direct_update_install`, with the refusal checked in JS first and in Rust at start and again after the download, the StartGate held as the install lock, its own `on_before_exit` that calls `cleanup_before_exit()` last, and `install()` inside `spawn_blocking` so the sync hook can `block_on`. That design is correct for tauri-plugin-updater 2.10.0 and the call sites.

Changes before implementing:

1. Order inside the hook. Run it in this order: EXIT_HOOK_RAN, then the T2 exit marker (sync fs write, and the awaited emit_event while the DB is open), then db.cleanup() (5 s), then log flush, then force_shutdown_sidecar (5 s), then cleanup_before_exit(). Running the sidecar kill last closes the respawn window through `get_sidecar_pool`'s lazy re-init. Wrap the DB and sidecar steps in catch_unwind, and call cleanup_before_exit only when they did not panic, so after_failed_install -> request_restart does not use Tauri after its documented 'exit immediately' point.

2. Background work that runs while the phase is Idle.
   - After StartGate::acquire, query BatchQueueRepository::list_active (or a count of `status='processing'`) and return a new outcome `backgroundWork` if a batch job is transcribing. Map it in the dialog to 'Hay una transcripción en proceso; actualiza cuando termine.'
   - In JS, also refuse while RecordingStateContext status != IDLE (STOPPING / PROCESSING_TRANSCRIPTS / SAVING in useRecordingStop.ts), because the local-first SQLite save of a streaming recording runs after Rust is Idle.
   - If the team prefers not to block, document it as a known gap: work is recovered by the orphan pass and autoRecoverAll, but it is redone.

3. Remove the non-compiling `if false` arm from the snippet.

4. Tests. Test exit_cleanup_blocking from `std::thread::spawn(...).join()`, not from tokio::test plus tauri spawn_blocking; the latter spins up Tauri's global runtime and touches globals. Add a vitest fitness test that no `downloadAndInstall(` / `.install(` remains in src, as a complement to the broad ESLint selector. Word the ESLint message as specific to plugin-updater.

5. Doc (CANALES_DISTRIBUCION.md B2 section) must also state:
   - never call `Update::install` from an async context: the hook's block_on would panic;
   - on_before_exit replaces the default;
   - the pool must never close before extract() succeeds;
   - B2 only protects binaries >= 0.2.62, and an NSIS GitHub release is needed to reach the stuck 0.2.52 channel.

Everything else stands: the Unsupported guard under MSIX/MAS, the single-flight guard, the Channel with the plugin's serde shape, macOS/Linux request_restart with the gate forgotten, and the backup branch per the Guardian protocol before touching lib.rs.