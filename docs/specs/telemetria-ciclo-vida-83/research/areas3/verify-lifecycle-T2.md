# Verdict: needs_changes

## Issues
- [major] In RunEvent::Exit, begin_exit + emit_exit_row run first and 'together take a few ms (one fsync'd ~400 B write plus one SQLite insert)'; B5 only has to bound the graceful stop.
  - Evidence: emit_exit_row -> write_to_outbox -> RecordingLogRepository::log_event(state.db_manager.pool(), ...) (emit.rs:114-131) has no timeout. The pool is 4 connections with the sqlx default acquire_timeout of 30 s (manager.rs:19-20 '`acquire_timeout` 30 s', :44-45 pool_options) plus busy_timeout 5 s (manager.rs:37). Under WM_ENDSESSION the recording pipeline, sync worker and batch planner may hold connections or the write lock. In that case the unbounded insert runs before graceful_shutdown_before_exit (lib.rs:1789-1800) and eats the few seconds Windows allows before it kills the process, so the recording save gets pushed out.
  - Fix: Wrap emit_exit_row in tokio::time::timeout of about 750 ms in the Exit handler, and in tray, rival and store paths too, for symmetry. On timeout, rely on the fsync'd marker: app.start already carries prev_exit_*. Treat the marker as the source of truth and the app.exit row as best-effort. State this explicitly so B5's bounding covers it.
- [major] StoreContext path: record_exit_intent(UpdateStoreApi) just before imp::install; an intent is fresh when intent.at_ms + 600_000 >= last_alive_ms; the session_end override uses a fresh intent.
  - Evidence: store_update.rs:182-190: imp::install(&ctx,&updates) runs inside with_mta and blocks through the Store permission dialog, the download and the install ('Windows muestra su propio diálogo de permiso, descarga e instala; al completar cierra Maity', UpdateDialog.tsx doc on handleInstallFromStore). The spec's 60 s ticker keeps advancing last_alive_ms the whole time. A download plus user interaction that takes more than 10 min makes the intent stale before Windows closes the app. The app.start that follows then reports session_end/close_app (looks like a PC or session end) or unclean, not update_store_api.
  - Fix: Do not age intents by last_alive. The marker is per process (rewritten at every boot), so an intent that was not cleared belongs to that run. Either (a) treat any uncleared intent as valid when exit is session_end or missing, or (b) re-stamp intent.at_ms when imp::install returns Completed and have the ticker refresh at_ms while an `in_progress: true` intent exists. Keep clear_exit_intent on every non-Completed outcome, including the Err branch of `outcome`.
- [major] update_nsis intent can only be recorded from JS by splitting download() -> invoke('lifecycle_record_exit_intent') -> install() (or by B2 moving the install to Rust).
  - Evidence: The updater's Windows install calls on_before_exit() before ShellExecuteW + std::process::exit(0) (tauri-plugin-updater-2.10.0/src/updater.rs:837-865). The plugin wires on_before_exit to app_handle.cleanup_before_exit() (updater lib.rs:107-110). cleanup_before_exit clears self.manager.resources_table() (tauri-2.11.2/src/app.rs:1100-1111). The same cleanup runs in the AppHandle::exit fallback (app.rs:574-579), in restart() on the main thread (app.rs:589-592), and after the normal Exit callback (app.rs:1422-1428). services/updateService.ts:350-366 is a second (currently dead) download()+install() path that the spec lists but does not change.
  - Fix: Add a Rust-only backstop. At boot, register a sentinel Resource in app.resources_table() whose Drop, when EXIT_BEGUN is still false, does a durable begin_exit-style marker write with reason 'process_exit_after_cleanup' (or update_nsis if an update intent is pending). Every exit that bypasses RunEvent::Exit then gets recorded no matter which UI path triggered it. Keep the JS intent only to add target_version. Delete or route updateService.downloadAndInstall so no install() call is left without the intent.
- [major] The design classifies the previous exit well enough for the issue's 'PC off / no Windows session' vs 'no signal' categories.
  - Evidence: Laptops in a pilot mostly suspend (lid close or modern standby) rather than shut down. Suspend produces no ExitRequested, no Exit and no app.exit, and heartbeats just stop. The spec's 60 s ticker (design §c) only updates last_alive_ms and never notices wall-clock gaps. CLAUDE.md (#5 of the pilot) says Instant keeps running across suspend on Windows, so tokio::time::sleep(60 s) fires right after resume and the wall-clock delta between ticks equals the suspended time. As written, a day with the PC asleep is indistinguishable from 'no signal (possible uninstall)' in T5 SQL.
  - Fix: In the ticker, compare now_ms with the previous tick. If the gap is more than about 180 s, record {suspended_at, resumed_at, gap_s} in the marker and emit a Rust event (for example `app.resumed`, 3 catalog entries) or add `last_suspend_gap_s` to the next native heartbeat. Otherwise T5 must document that sleep falls into 'no signal'.
- [minor] 'No network is used during session end'; flush_rows avoids refresh so a rotated refresh_token cannot be lost mid-exit.
  - Evidence: write_to_outbox ends with drain_notify().notify_one() (emit.rs:133). The drain loop (drain.rs:36-45) keeps running on the tokio runtime while the main thread sits in block_on for up to 30 s of graceful stop. drain_once calls get_valid_token (drain.rs:75), which can refresh over the network (session.rs:165-195). So the pre-existing drain does post, and may refresh, during session end and tray quit. The new emit wakes it on purpose.
  - Fix: Correct the claim. Optionally add a global EXITING flag, set by begin_exit, that makes drain_once use the no-refresh path (token_if_fresh) or skip the batch entirely.
- [minor] flush_rows typically completes in 200-500 ms and uploads the app.exit row before exit.
  - Evidence: emit_exit_row's notify wakes drain_once, which will hold DRAIN_LOCK across up to BATCH_LIMIT=50 sequential posts ordered oldest-first (drain.rs:24, :55, :97-122; recording_log.rs:70). With any backlog, the app.exit row is the newest and is posted last or not at all, and flush_rows returns Timeout after 3 s.
  - Fix: Have drain_once check a 'priority ids' set (filled by emit_exit_row) and post those first. Otherwise document that the exit row usually uploads on next boot and that the marker/app.start is the reliable carrier.
- [minor] 'No tracing, no await and no allocation-heavy work while a lock is held' and write_atomic via rename is safe.
  - Evidence: mutate_marker, as specified, serializes, writes, fsyncs and renames while holding MARKER. Blocking I/O under the lock is correct for serializing writers but contradicts the stated rule. The main thread (Exit) and a WndProc (note_session_ending) then wait on the ticker's I/O. On Windows, std::fs::rename (MoveFileExW REPLACE_EXISTING) fails with ERROR_ACCESS_DENIED while an AV scanner or the indexer holds the target open without FILE_SHARE_DELETE.
  - Fix: Document that the lock covers the I/O. For durable writes (exit, intent), retry the rename once after ~20 ms and fall back to an in-place write+sync_all of the target, so the exit block is not lost to a transient lock.
- [minor] crash_panic inference: any panic ts >= last_alive-60 s with no observed exit means the process died from that panic.
  - Evidence: The panics.rs hook records every panic, including those in tokio tasks that did not kill the process (the spec says so itself). The JSON line only has {ts_ms,message,location} (panics.rs:53-57). So a non-fatal task panic followed within a minute by a Task Manager kill or native crash is labeled crash_panic.
  - Fix: Add `thread: std::thread::current().name()` to the panic line (sync, allowed in the hook). Classify crash_panic only for a main-thread panic, or mark the rest as `prev_panicked` with reason unclean.
- [minor] os_restart_unclean from sysinfo boot_time (now - GetTickCount64) detects that the PC was turned off.
  - Evidence: sysinfo-0.32.1 windows/system.rs:64-66 derives boot time from GetTickCount64. Win11 Fast Startup (on by default) hibernates the kernel, so uptime does not reset on a normal shutdown (UNVERIFIED on pilot hardware, but widely observed). The rule will rarely fire.
  - Fix: Keep the field, but also store the interactive logon session identity or LogonTime (for example WTSQuerySessionInformation or LsaGetLogonSessionData; this needs an extra windows-crate feature, not a new dependency) in the marker. 'windows_session_changed_since_prev' then catches logoff, shutdown and fast-startup boots even when WM_ENDSESSION was missed.
- [minor] note_session_ending writes a durable 'session_end' intent; clear_session_ending handles WM_ENDSESSION(FALSE).
  - Evidence: The spec only says clear_session_ending is 'for WM_ENDSESSION(FALSE)'. It does not say the session_end exit_intent in the marker gets removed. If that intent stays, a later kill or crash in the same run is reported at boot (rule 2) as session_end with clean=true.
  - Fix: clear_session_ending must reset SESSION_END and also clear the marker's exit_intent (durable write), but only when that intent's reason is session_end.
- [minor] Marker isolation is handled by the debug/release file split.
  - Evidence: Memory and CLAUDE.md say the MSIX redirects AppData, and rival_install.rs:62-64 describes 'virtualización copy-on-write del MSIX'. Whether a packaged process can READ a pre-existing real-AppData file written by the NSIS channel on double-install PCs is UNVERIFIED. The marker already stores build_channel, but summarize_prev never uses it.
  - Fix: In summarize_prev, when prev.build_channel is non-empty and differs from the current channel, set marker_status 'foreign' and ignore prev_* (fall back as for Missing).
- [minor] The alive ticker's errors are logged ('Errors are returned and logged with warn outside the lock').
  - Evidence: Design §c: `let _ = tokio::task::spawn_blocking(|| mutate_marker(false, ...)).await;` discards both the JoinError and the inner Result<(), String>.
  - Fix: Log the first failure and then rate-limit (for example, once per boot per error kind) outside the lock.
- [minor] Catalog/doc work is just two new rows.
  - Evidence: app.open/app.close already exist (catalog.rs:47-48; telemetry-events.ts:44-45; TELEMETRIA.md:213 'arranque / cierre de la ventana main') and are emitted by the webview (layout.tsx:400-423). Prod data (app.close ≈20% of app.open) is exactly the confusion T5 has to resolve.
  - Fix: The TELEMETRIA.md rows for `app.start`/`app.exit` must say that they are process-level and Rust-emitted, and that app.open/app.close are webview mount/unload. T5 SQL must use app.start/app.exit, not app.open/app.close, and use ctx.occurred_at (event time), because app.exit rows from a session end are ingested on the next day's boot.

## Confirmed claims
- lib.rs:1786-1787: the only run handler is `if let tauri::RunEvent::Exit = event`; ExitRequested is not handled.
- lib.rs:1789-1824: the Exit handler does block_on with graceful_shutdown_before_exit capped at 30 s, then db_manager.cleanup(), then force_shutdown_sidecar().
- tauri-runtime-wry-2.11.2 lib.rs:4192-4193: LoopDestroyed -> RunEvent::Exit. :4318-4331: last window Destroyed -> ExitRequested{code:None} then ControlFlow::Exit unless prevented. :4361-4373: RequestExit(code) -> ExitRequested{Some(code)} then ControlFlow::Exit. L3202-3205 is run_iteration only.
- tao-0.35.2 event_loop.rs:254-284: the GetMessage loop breaks on WM_QUIT or ExitWithCode, then loop_destroyed. :2382-2390: WM_QUERYENDSESSION is commented out and WM_ENDSESSION(TRUE) calls loop_destroyed directly with lParam dropped. runner.rs:307 makes Destroyed->Destroyed a no-op (fires once).
- tao create_event_target_window (event_loop.rs:649-688) is a top-level WS_POPUP (not HWND_MESSAGE), so it does receive session-end broadcasts.
- tauri-2.11.2 app.rs: RunEvent and ExitRequested are #[non_exhaustive] (L219-232). exit() uses request_exit, with a fallback to cleanup_before_exit + process::exit (L574-579). request_restart uses RESTART_EXIT_CODE. restart() on the main thread skips the events (L589-592). plugin-process restart calls request_restart and exit calls app.exit (commands.rs).
- tauri-plugin-updater-2.10.0 updater.rs:837-865: on_before_exit then ShellExecuteW then std::process::exit(0). lib.rs:107-110: on_before_exit = cleanup_before_exit.
- UpdateDialog.tsx:128 downloadAndInstall then relaunch (L174). handleCloseToUpdate checks get_recording_state and then calls exit(0) (~L210-220). updateService.ts:350-366 download()+install()+relaunch() has no callers (dead).
- tray.rs:60-77 quit: spawn, set_tray_state Stopping, 60 s graceful stop, app_clone.exit(0).
- rival_install.rs: graceful stop -> checkpoint/backup -> launch_detached_uninstaller -> db.cleanup() -> handle.exit(0) after 800 ms. The orchestrator waits for our PID.
- The only Rust exits are tray.rs:76 and rival_install.rs:119 (no process::exit, restart or destroy elsewhere in src-tauri/src).
- emit.rs:103-110 drops the event with a warn when there is no AppState. log_event returns last_insert_rowid (recording_log.rs:35). The emit_event signature matches emit.rs:41-49.
- drain.rs: single loop, no mutex, BATCH_LIMIT 50, oldest-first, silent defer without a session, get_valid_token may refresh. drain_once has one caller (drain.rs:39).
- session.rs decide_token_action/TokenAction::Reuse exist as described.
- panics.rs: PANIC_FILE_NAME is private (L19), the hook writes {ts_ms,message,location}, and import_pending removes the file. install/import are wired at lib.rs:1060-1066, after the DB-init match (lib.rs:696-724).
- context.rs process_session_id is a OnceLock proc-<ms>-<rand>. The ctx envelope carries session_id and occurred_at.
- rust_error_bridge.rs:282-285 excludes app_lib::logging::telemetry.
- lint-telemetry.js (d) flags 'unknown' literals on lines mentioning version in TS and logging/telemetry Rust files. (f) is a backticked substring search.
- TelemetryStatus has Ok and Warning (status.rs:31,36).
- recording_phase::current_phase() is a sync lock-free read. is_recording() = is_session_active() (Recording|Paused).
- STARTED_AT_BOOT is pub(crate) static at lib.rs:89.
- tokio 1.49 Mutex::const_new is only gated on not(loom,test). sysinfo 0.32 System::boot_time exists. tempfile is a dev-dependency.
- build.rs is plain tauri_build::build() (no AppManifest), so new custom commands need no capability. lint-tauri-acl only checks window/dialog/app permission call sites.
- UpdateDialog.test.tsx mocks '@tauri-apps/plugin-process' { exit, relaunch }.

## Corrected design notes
The overall architecture holds. It uses a per-profile marker in app_data_dir, synchronous boot after DB init and before panics::import_pending, and a pure summarize_prev and classify_exit. RunEvent::ExitRequested is used to tell programmatic exits from WM_ENDSESSION ("Exit without a prior ExitRequested" means session end, and the tao and runtime-wry code confirm this). The Exit handler writes the marker first and the other work comes after. Required changes:

(1) Bound the outbox insert in every exit path with a timeout of about 750 ms. The pool acquire_timeout is 30 s and busy_timeout is 5 s. The fsync'd marker is the reliable carrier; the app.exit row is best-effort.

(2) Do not age intents by last_alive. The marker is rewritten at every boot, so any uncleared intent belongs to the previous run. Alternatively, re-stamp it after imp::install returns Completed and refresh it from the ticker while it is in progress. StoreContext installs can outlast 10 min.

(3) Add a Rust-only backstop: a sentinel Resource registered in app.resources_table() whose Drop, when EXIT_BEGUN is false, writes a durable exit block. cleanup_before_exit runs in the updater's on_before_exit, in the AppHandle::exit fallback and in restart() on the main thread. This covers NSIS updates without depending on the JS split or on B2. Remove or route the dead updateService.downloadAndInstall.

(4) Have the ticker detect wall-clock gaps above about 180 s (suspend/resume) and persist or emit them. Otherwise sleeping laptops land in 'no signal'.

(5) Correct the 'no network at session end' claim. The existing drain is woken by the emit's notify and can refresh the token. Either gate it with an EXITING flag or document it. Prioritize exit ids in drain_once so the flush does not time out behind a 50-row backlog.

(6) Make clear_session_ending also clear a session_end marker intent.

(7) Ignore a marker whose build_channel differs from the current one ('foreign').

(8) Record the panic thread name so that crash_panic is only inferred from a main-thread panic.

(9) Retry the rename once and fall back to an in-place write for durable writes. Rate-limit ticker warnings.

(10) Document app.start/app.exit (process-level, Rust) against app.open/app.close (webview), and state that T5 must use ctx.occurred_at.

Optionally, add the Windows logon-session time to the marker. GetTickCount64 does not reset under Fast Startup (UNVERIFIED on pilot hardware), which makes os_restart_unclean weak.

Commit plan, lint impact (3 catalog entries per event; no Tauri events, no ACL changes, user32 extern without a new windows-crate feature), the Guardian backup before the lib.rs change and the tests listed all stay valid. Add tests for the sentinel-Drop path, the intent-freshness change, the suspend-gap detection and the foreign-channel marker.