# T2 - app.start / app.exit con motivo + marcador de ciclo de vida (issue #83)

## Summary
Implementation spec for T2. A new module `logging/telemetry/lifecycle.rs` keeps a small marker file in app_data_dir: `lifecycle.json` for release builds, `lifecycle-debug.json` for debug builds, so a dev or smoke-test run cannot overwrite prod's history. It is written with raw std::fs (write to .tmp, then rename; fsync only for exit and intent writes), held behind a std Mutex, and never logs while holding the lock.

At boot the previous marker is read synchronously right after DB init (lib.rs:728). That point is before `panics::import_pending` (lib.rs:1060-1066) deletes `telemetry-panics.jsonl`. A pure function `summarize_prev` derives: prev_version (fallback in release builds: the newest app_version in `recording_logs` written by another process), version_changed, prev_exit_reason/source/detail/clean, prev_uptime_s, downtime_s = now - max(exit.at, last_alive), prev_session_id, prev_panicked, and os_rebooted_since_prev. It then writes the new marker, sends `app.start` to the outbox, and starts a 60 s last_alive ticker.

Exit reasons come from three sources:
- **Our own exit paths.** tray_quit, rival_uninstall and update_store (a new Rust command replaces the JS `exit(0)`) record the reason before exiting.
- **Intents written only to the marker.** update_nsis (via command) and update_store_api (StoreContext). Both paths end the process without a RunEvent::Exit.
- **The event loop.** RunEvent::ExitRequested {code} is now handled; it was not handled before.

I checked tauri 2.11.2 and tao 0.35.2. RunEvent::Exit only comes from tao's Event::LoopDestroyed. On Windows that happens either after ControlFlow::Exit, which runtime-wry only sets after sending ExitRequested (lib.rs:4323-4329, 4361-4372), or on WM_ENDSESSION(TRUE), which sends no ExitRequested (tao event_loop.rs:2384-2390). So "Exit without a prior ExitRequested" means session_end. Its kind comes from a hook that the session-end item (B5) calls, or else from GetSystemMetrics(SM_SHUTTINGDOWN).

In RunEvent::Exit the marker's exit block is written synchronously first, then the app.exit row goes to the outbox, and only after that come the existing graceful stop and DB cleanup. An emit-once guard prevents a second row.

The tray, rival and Store-close paths also push their row immediately, with a 3 s limit. This needs a tokio `DRAIN_LOCK` around `drain_once` and a new `flush_rows(ids)` that posts exactly those outbox rows, using a token only if it is still valid (never refreshing it). No network is used during session end.

Planned as 4 commits.

## Current behavior
- The only app-level RunEvent handling is `if let tauri::RunEvent::Exit`; ExitRequested is not handled, so the exit code and cause are lost. — lib.rs:1786-1787 `.run(|_app_handle, event| { if let tauri::RunEvent::Exit = event {`
- The Exit handler already uses block_on + sqlx on the main thread: graceful stop capped at 30 s, then db_manager.cleanup() closes the pool, then sidecar force kill. — lib.rs:1789-1820 `tauri::async_runtime::block_on(async { if tokio::time::timeout(... from_secs(30), graceful_shutdown_before_exit(_app_handle))` ... `app_state.db_manager.cleanup().await` ... `force_shutdown_sidecar()`
- RunEvent::Exit is produced only by tao Event::LoopDestroyed. — tauri-runtime-wry-2.11.2/src/lib.rs:4192-4193 `Event::LoopDestroyed => { callback(RunEvent::Exit); }`; tauri-2.11.2/src/app.rs:1422-1428 Exit -> callback -> cleanup_before_exit -> restart if restart_on_exit
- The Windows event loop reaches LoopDestroyed only (a) after its GetMessage loop breaks on ControlFlow::ExitWithCode or WM_QUIT, or (b) on WM_ENDSESSION(TRUE). WM_QUERYENDSESSION is not processed and lParam is dropped. — tao-0.35.2/src/platform_impl/windows/event_loop.rs:254-284 (`break 'main code` then `runner.loop_destroyed()`); :2382-2390 `// win32wm::WM_QUERYENDSESSION => {}` / `WM_ENDSESSION => { if wparam.0 == TRUE.0 as usize { subclass_input.event_loop_runner.loop_destroyed(); }`; the handler is thread_event_target_callback (L2307), so it fires once
- runtime-wry sets ControlFlow::Exit only right after ExitRequested: code None when the last window is destroyed, Some(code) for RequestExit from app.exit/restart. This supports the inference: Exit without a prior ExitRequested means WM_ENDSESSION (or a rare stray WM_QUIT). — tauri-runtime-wry lib.rs:4318-4331 `if is_empty { ... callback(RunEvent::ExitRequested { code: None, tx }); ... *control_flow = ControlFlow::Exit`; :4361-4373 `Message::RequestExit(code) => { callback(RunEvent::ExitRequested { code: Some(code), tx }); ... ControlFlow::Exit`; L3205 applies only to run_iteration
- app.exit() goes through request_exit (ExitRequested then Exit). restart/request_restart use RESTART_EXIT_CODE = i32::MAX, which is exported as tauri::RESTART_EXIT_CODE. RunEvent::ExitRequested is non_exhaustive, so the match pattern needs `..`. — tauri app.rs:77 `pub const RESTART_EXIT_CODE: i32 = i32::MAX;`, :574-580 exit, :615-624 request_restart; lib.rs:214 re-export; app.rs:219-232 `#[non_exhaustive] ExitRequested { code: Option<i32>, api }`
- The NSIS updater ends in std::process::exit(0) after its on_before_exit hook (only cleanup_before_exit). No RunEvent fires. — tauri-plugin-updater-2.10.0/src/updater.rs:836-865 `on_before_exit(); ... ShellExecuteW(...); std::process::exit(0);`; lib.rs:108-110 `builder.on_before_exit(move || { app_handle.cleanup_before_exit(); })`
- The Store 'Cerrar Maity para actualizar' button calls plugin-process exit(0), i.e. app.exit(0), after a JS-side recording check. — UpdateDialog.tsx:210-220 `const state = await invoke<RecordingState>('get_recording_state'); if (state?.is_recording) {...return;} ... await exit(0);`; tauri-plugin-process-2.3.1/src/commands.rs:8-10 `app.exit(code)`
- The NSIS update UI uses the combined downloadAndInstall, then relaunch (which is never reached on Windows). — UpdateDialog.tsx:128 `await updateToUse.downloadAndInstall((event) => {`, :174 `await relaunch();`; updateService.ts:356-365 uses separate `update.download()` / `update.install()`
- Tray quit spawns a task: tray state goes to Stopping, then graceful stop capped at 60 s, then app_clone.exit(0). — tray.rs:60-77
- rival_install calls graceful stop, then checkpoint/backup, then launches the orchestrator, then db.cleanup() (pool closed), then handle.exit(0) after 800 ms. — rival_install.rs:78, 83-100, 104 `launch_detached_uninstaller(&info, std::process::id())?;`, 108-110 `db.cleanup().await`, 116-120
- StoreContext install refuses while recording and otherwise runs imp::install on an MTA thread. How Windows closes the app afterwards is unverified. — store_update.rs:164-194 `if crate::audio::recording_commands::is_recording().await { ... RecordingActive }` ... `imp::install(&ctx, &updates)`
- emit_event discards the outbox row id, and drops the event with a warn if AppState is not managed yet. — emit.rs:103-110 `let Some(state) = app.try_state::<crate::state::AppState>() else { log::warn!(...); return; }`; :114-131 `RecordingLogRepository::log_event(...)` result ignored except error; log_event returns `Ok(result.last_insert_rowid())` (recording_log.rs:35)
- drain_once has no mutex. It reads oldest-first up to 50 rows, defers silently with no CloudSyncState session, may refresh the token through get_valid_token, and marks only 2xx rows. — drain.rs:24 `const BATCH_LIMIT: i64 = 50;`, :49-131, :55 `get_unsynced_logs(pool, BATCH_LIMIT)`, :72-74 `let Some(session) = session else { return; };`, :75 `get_valid_token(app)`; recording_log.rs:70 `ORDER BY created_at ASC LIMIT ?`
- get_valid_token may refresh over the network while holding refresh_lock. The pure helper decide_token_action is available for a no-refresh fast path. — session.rs:136-142 `pub fn decide_token_action(expires_at: i64, now: i64) -> TokenAction`; :165-195
- The panic hook appends to app_data_dir/telemetry-panics.jsonl ({ts_ms,message,location}). import_pending is spawned asynchronously at setup; it emits app.error and deletes the file. The file also collects panics from tokio tasks that did not kill the process. — panics.rs:19 `const PANIC_FILE_NAME: &str = "telemetry-panics.jsonl";`, :53-63, :73-111 `let _ = std::fs::remove_file(path);`; lib.rs:1060-1066
- DB init runs first in setup via block_on and always manages AppState. block_on in setup has precedent. — lib.rs:696-698 `tauri::async_runtime::block_on(async { database::setup::initialize_database_on_startup(&_app.handle()).await })`; database/setup.rs:10,47-48; lib.rs:995 block_on(reset_stale_jobs)
- mem_sampler starts late, inside the config spawn after engine/model init, so it is unsuitable as the last_alive clock. — lib.rs:1181 `logging::mem_sampler::start(app_handle_for_config.clone());` inside the spawn started at lib.rs:1078; mem_sampler.rs:258-267 the loop returns on a spawn_blocking join error
- Debug and release share app_data_dir (identifier com.maity.ai), and the smoke test launches the real debug exe and force-kills every maity-desktop process, including an installed prod instance. — manager.rs:97-109 `app_data_dir ... join("meeting_minutes.sqlite")`; scripts/smoke-test-startup.ps1:60 `Start-Process $exe`, :73 `Stop-Process -Id $proc.Id -Force`, :77 `Get-Process -Name 'maity-desktop' | Stop-Process -Force`; memory incident_db_migration_downgrade.md
- The only other Rust exits are the two app.exit(0) calls. The single-instance second instance exits inside plugin setup, before our setup runs. — Grep `.exit(|restart(|process::exit` in src-tauri/src: rival_install.rs:119, tray.rs:76 only; tauri-plugin-single-instance-2.3.7/src/platform_impl/windows.rs:56,94 `.setup(...)` ... `std::process::exit(0);`
- The bridge excludes log records under logging::telemetry, so a log line from the new module cannot loop back as app.error. — rust_error_bridge.rs:282-285 `const OUTBOX_PATH: [&str; 3] = ["app_lib::logging::telemetry", ...`
- lint-telemetry check (d) fails on any "unknown" literal on a line containing 'version' in logging/telemetry Rust files. So prev_version must be null, never 'unknown'. — frontend/scripts/lint-telemetry.js:183-199 `const RE = /['"]unknown['"]/g; ... if (!/version/i.test(text)) continue;`
- windows 0.58 has no Win32_UI_WindowsAndMessaging feature. A raw extern block has precedent. — Cargo.toml:272-295 feature list; console_utils/console_utils.rs:8-16 `#[link(name = "kernel32")] extern "system" { fn AllocConsole() -> i32; ...}`
- `tokio::sync::Mutex::const_new` is available (tokio 1.49), so a static tokio mutex works without OnceLock. — Cargo.lock tokio 1.49.0; tokio-1.49.0/src/sync/mutex.rs:394-395 `#[cfg(not(all(loom, test)))] pub const fn const_new(t: T)`
- sysinfo 0.32 has System::boot_time(), computed from GetTickCount64. — sysinfo-0.32.1/src/common/system.rs:662 `pub fn boot_time() -> u64`; windows/system.rs:64-66 `n.as_secs().saturating_sub(GetTickCount64() / 1_000)`
- SQLite JSON functions are already used in the repo, so json_valid/json_extract work in the fallback query. — src/api/meetings_overview.rs uses json_extract; libsqlite3-sys 0.30.1 (Cargo.lock:3288-3289)

## Design
## Module layout
New file `frontend/src-tauri/src/logging/telemetry/lifecycle.rs`, registered in `logging/telemetry/mod.rs` (`pub mod lifecycle;`). Because it lives under `logging::telemetry`, rust_error_bridge excludes it (rust_error_bridge.rs:282-285). It must never use `log::error!`; use `warn!` at most. It must also never put an `"unknown"` literal on a line containing "version" (lint (d)).

### Statics (all const-initialized; locks are never `.unwrap()`ed)
```rust
static MARKER: std::sync::Mutex<Option<MarkerSlot>> = Mutex::new(None); // MarkerSlot { path: PathBuf, marker: LifecycleMarker }
static PROCESS_STARTED_MS: AtomicU64 = AtomicU64::new(0);
static EXIT_BEGUN: AtomicBool = AtomicBool::new(false);            // emit-once guard
static EXIT_REQUESTED: Mutex<ExitRequestSeen> = Mutex::new(ExitRequestSeen::NotSeen);
static SESSION_END: AtomicU8 = AtomicU8::new(0);                   // 0 none,1 logoff,2 shutdown,3 close_app,4 critical
```
Lock pattern: `MARKER.lock().unwrap_or_else(|e| e.into_inner())`, the same poison recovery used in simple_level_monitor.rs:74-78. No tracing, no await and no allocation-heavy work while a lock is held. Any `warn!` is logged after the guard is dropped.

## (a) Marker file
File name: `pub(crate) fn marker_file_name(debug: bool) -> &'static str { if debug { "lifecycle-debug.json" } else { "lifecycle.json" } }`, called with `cfg!(debug_assertions)`. Debug and release share app_data_dir (manager.rs:97-109). This separation keeps `tauri dev`, `tauri:build:debug` and the smoke test (smoke-test-startup.ps1:60-77) from touching prod's prev_version and exit state.

Nothing else separates the two profiles today. The DB, `telemetry-panics.jsonl` and `telemetry.json` (install_id) stay shared; that is pre-existing and out of scope, and T5 filters by `build`. Mitigations here:
- The recording_logs fallback for prev_version runs only when `!cfg!(debug_assertions)`.
- Panics count toward the previous run only if `ts_ms` falls inside [prev.started_at_ms, prev_end_ms + 60_000]. A debug run's panic after prod exited is therefore not blamed on prod.
- Every app.start/app.exit payload carries `build: "debug"|"release"`.

```rust
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub(crate) struct LifecycleMarker {
  #[serde(default)] pub schema: u32,               // MARKER_SCHEMA = 1
  #[serde(default)] pub proc_session_id: String,   // context::process_session_id()
  #[serde(default)] pub version: String,           // app.package_info().version
  #[serde(default)] pub build: String,             // "release" | "debug"
  #[serde(default)] pub build_channel: String,     // "store" | "direct" (utils::is_running_under_package_identity, same rule as logging/commands.rs:474-478)
  #[serde(default)] pub started_at_ms: u64,
  #[serde(default)] pub last_alive_ms: u64,
  #[serde(default)] pub exit: Option<MarkerExit>,
  #[serde(default)] pub exit_intent: Option<MarkerIntent>,
  #[serde(default)] pub last_autostart_state: Option<String>, // owned by T3; carried forward at boot
}
pub(crate) struct MarkerExit { reason: String, detail: Option<String>, exit_code: Option<i32>, at_ms: u64, recording_active: bool }
pub(crate) struct MarkerIntent { reason: String, detail: Option<String>, target_version: Option<String>, at_ms: u64 }
```
Reasons are stored as String so that a newer version's reason still parses.

Write helper `fn write_atomic(path: &Path, bytes: &[u8], durable: bool) -> io::Result<()>`:
1. Create `path.with_extension("json.tmp")`, then `write_all`.
2. If `durable`, call `f.sync_all()`.
3. `std::fs::rename(tmp, path)` (replaces the target on Windows).

`durable = true` for boot, exit, intent and session-end writes. `false` for the 60 s ticker and the T3 autostart update.

`fn mutate_marker(durable: bool, f: impl FnOnce(&mut LifecycleMarker)) -> Result<(), String>` locks MARKER, applies f, serializes with `serde_json::to_vec`, calls write_atomic, and returns the error string, which the caller logs after the lock is released. If MARKER is None (boot has not run or app_data_dir failed), it is a no-op.

Parse (pure): `pub(crate) enum MarkerRead { Missing, Corrupt, Ok(LifecycleMarker) }` and `pub(crate) fn parse_marker(raw: Option<&str>) -> MarkerRead`. A newer `schema` still parses because unknown fields are ignored and the struct has no `deny_unknown_fields`.

## (b) Boot: `pub fn boot<R: Runtime>(app: &AppHandle<R>)`
Call it synchronously in setup immediately after the DB-init `match` (after lib.rs:728 and before the ffmpeg warm-up at lib.rs:730): `logging::telemetry::lifecycle::boot(_app.handle());`. At that point AppState is managed (setup.rs:47-48), and `panics::install/import_pending` (lib.rs:1060-1066) has not run yet, so the panic file still exists.

Steps:
1. `now_ms`; `PROCESS_STARTED_MS.store(now_ms)`. `dir = app.path().app_data_dir()`; if that fails, return, since nothing can be persisted. `path = dir.join(marker_file_name(cfg!(debug_assertions)))`.
2. `prev = parse_marker(std::fs::read_to_string(&path).ok().as_deref())`.
3. Panic timestamps: `std::fs::read_to_string(dir.join(panics::PANIC_FILE_NAME))`. Make `PANIC_FILE_NAME` `pub(crate)` (panics.rs:19) and add the pure `pub(crate) fn parse_panic_ts(contents: &str) -> Vec<u64>`, which reads `ts_ms` from each JSON line, skips bad lines, and reuses the loop shape of panics.rs:82-91. The file is not modified.
4. Fallback prev_version, only if `prev` is Missing or Corrupt and `!cfg!(debug_assertions)`: `tauri::async_runtime::block_on(RecordingLogRepository::last_app_version_excluding_session(pool, context::process_session_id()))` (precedent: block_on in setup at lib.rs:995). New repo function in recording_log.rs:
```sql
SELECT app_version FROM recording_logs
 WHERE app_version IS NOT NULL AND app_version <> ''
   AND (NOT json_valid(event_data)
        OR json_extract(event_data,'$.ctx.session_id') IS NULL
        OR json_extract(event_data,'$.ctx.session_id') <> ?1)
 ORDER BY id DESC LIMIT 1
```
   The `json_valid` guard is needed because event_data is free text and json_extract errors on malformed JSON. Errors map to None.
5. `os_boot_ms = sysinfo::System::boot_time().checked_mul(1000)` (0 means None).
6. `let summary = summarize_prev(&PrevInput { marker: &prev, now_ms, current_version, panic_ts_ms: &ts, os_boot_ms, fallback_prev_version })` (pure).
7. New marker `{schema:1, proc_session_id, version, build, build_channel, started_at_ms: now_ms, last_alive_ms: now_ms, exit: None, exit_intent: None, last_autostart_state: prev.last_autostart_state (if Ok)}`. Store it in MARKER and write it durable.
8. Spawn `emit_event(app, process_session_id(), catalog::APP_START, summary.to_payload(...), Some(status), None, None)`, where status is `TelemetryStatus::Warning` if `prev_exit_clean == Some(false)` and `TelemetryStatus::Ok` otherwise.
9. `spawn_alive_ticker(app.clone())`.

### `summarize_prev` rules (pure, unit tested)
- `end_ms = exit.at_ms` if an observed exit exists, else `max(last_alive_ms, started_at_ms)`.
- `prev_uptime_s = (end_ms - started_at_ms)/1000`.
- `downtime_s = now - max(exit.at_ms or 0, last_alive_ms)`. If negative, clamp to 0 and set `clock_skew: true`.
- `prev_version`: marker.version (source "marker"), else fallback (source "outbox"), else null. `version_changed = prev_version.map(|v| v != current)`.
- `panics_in_run` = timestamps in [started_at_ms, end_ms + 60_000]. `prev_panicked = !empty`, `prev_panic_count`.
- Exit classification, in precedence order:
  1. `marker.exit` present gives `(reason, detail, source:"observed", clean:true)`. Exception: if `exit.reason == "session_end"` and a fresh intent exists, use `intent.reason` with `detail = exit.detail`. Rationale: a Store deploy may close us through Restart Manager, which arrives as WM_ENDSESSION.
  2. Otherwise, a fresh intent (`intent.at_ms + INTENT_FRESH_MS(600_000) >= last_alive_ms`) gives `(intent.reason, intent.detail, "intent", clean:true)`.
  3. Otherwise, if some panic ts >= `last_alive_ms - 60_000`: `("crash_panic", source "inferred", clean false)`.
  4. Otherwise, if `os_boot_ms > last_alive_ms + 120_000`: `("os_restart_unclean", "inferred", false)`. This means the PC restarted or lost power with no WM_ENDSESSION. Fast Startup may not reset GetTickCount64 (unverified), so this only covers real reboots.
  5. Otherwise `("unclean", "inferred", false)`: killed (Task Manager, smoke test, updater without an intent), native crash, or "Shut down anyway".
  6. If Missing with no fallback: `first_run: true` and all prev_* null. Missing with a fallback (first run of 0.2.62+ after an upgrade): `first_run: false`, prev_version from the outbox, reason null.
- `marker_status`: "ok" | "missing" | "corrupt".

## (c) last_alive
`fn spawn_alive_ticker<R>(app)`: `tauri::async_runtime::spawn(async { loop { tokio::time::sleep(60s).await; let _ = tokio::task::spawn_blocking(|| mutate_marker(false, |m| m.last_alive_ms = now_ms())).await; } })`. This is a dedicated task: mem_sampler starts late (lib.rs:1181) and can stop (mem_sampler.rs:264-267). The write is about 400 bytes per minute with no fsync.

## (d) Exit reasons
```rust
pub enum ExitReason { TrayQuit, RivalUninstall, UpdateStore, UpdateStoreApi, UpdateNsis, Restart, AppExitCall, LastWindowClosed, SessionEnd }
// as_str: tray_quit | rival_uninstall | update_store | update_store_api | update_nsis | restart | app_exit | last_window_closed | session_end
pub(crate) enum ExitRequestSeen { NotSeen, Programmatic(i32), UserInteraction }
pub enum SessionEndKind { Logoff, Shutdown, CloseApp, Critical }   // as_str logoff|shutdown|close_app|critical
pub fn session_end_kind_from_lparam(lparam: isize) -> SessionEndKind // pure: bit 0x1 -> CloseApp, 0x40000000 -> Critical, 0x80000000 -> Logoff, 0 -> Shutdown (check CloseApp, then Logoff, then Critical)
```
Pure classifier (unit tested):
```rust
pub(crate) fn classify_exit(hint: Option<ExitReason>, requested: ExitRequestSeen, session_end: Option<SessionEndKind>, os_shutting_down: bool, fresh_intent: Option<&MarkerIntent>, macos: bool) -> (String /*reason*/, Option<String> /*detail*/, Option<i32> /*code*/)
```
1. `hint` (set by our own paths) wins.
2. `Programmatic(RESTART_EXIT_CODE)` → restart. `Programmatic(c)` → app_exit with code c. `UserInteraction` → last_window_closed: the main window was destroyed (0.2.57 regression class, since lib.rs:925-926 normally prevents close).
3. `NotSeen` → session_end. Detail comes from `session_end` (B5 hook), else `"session_ending"` if `os_shutting_down`, else `"loop_destroyed"`, or `"macos_terminate"` when `cfg!(target_os="macos")`. If `fresh_intent` exists, return the intent's reason and keep the session detail.

Validation of the "NotSeen ⇒ WM_ENDSESSION" inference (all verified):
- runtime-wry sets ControlFlow::Exit only after emitting ExitRequested (lib.rs:4318-4331, 4361-4373; L3205 is run_iteration only).
- tao's loop only ends on ControlFlow::ExitWithCode or WM_QUIT (event_loop.rs:254-284).
- WM_ENDSESSION(TRUE) calls loop_destroyed directly (event_loop.rs:2384-2390, in thread_event_target_callback, so it fires once).
- The residual case (a stray WM_QUIT from third-party code) is reported as `loop_destroyed`.

Hook functions:
- `pub fn note_exit_requested(code: Option<i32>)`: stores `Programmatic(c)` or `UserInteraction` in EXIT_REQUESTED. Sync, and it never calls `prevent_exit`, so behavior is unchanged.
- `pub fn note_session_ending(kind: SessionEndKind)`: for B5's WM_QUERYENDSESSION subclass; safe inside a WndProc (sync, no tracing). It sets SESSION_END and runs `mutate_marker(true, |m| m.exit_intent = Some(MarkerIntent{reason:"session_end", detail: Some(kind), ..}))`. It does not overwrite an existing update_* intent. `pub fn clear_session_ending()` is for WM_ENDSESSION(FALSE).
- `fn os_shutting_down() -> bool`: `#[cfg(windows)] #[link(name = "user32")] extern "system" { fn GetSystemMetrics(n_index: i32) -> i32; }` with `SM_SHUTTINGDOWN = 0x2000`, so no new windows-crate feature is needed (precedent console_utils.rs:8-16). Non-Windows returns false.
- `pub fn record_exit_intent(reason: ExitReason, detail: Option<String>, target_version: Option<String>)`: sync, durable marker write, no outbox. `pub fn clear_exit_intent()`.

### Emit-once exit
```rust
pub(crate) struct ExitRecord { reason: String, detail: Option<String>, exit_code: Option<i32>, at_ms: u64, uptime_s: u64, recording_active: bool, recording_phase: &'static str }
pub fn begin_exit(hint: Option<ExitReason>) -> Option<ExitRecord>
```
Behavior:
- If `EXIT_BEGUN.swap(true)` is already true, return None.
- Read EXIT_REQUESTED and SESSION_END. Call `os_shutting_down()` only when the request is NotSeen.
- Look up the fresh intent from the MARKER snapshot. Run `classify_exit`.
- `recording_phase = crate::audio::recording_phase::current_phase()` (sync, recording_phase.rs:140; `.is_session_active()` L61, `.as_str()` L48).
- `mutate_marker(true, |m| { m.exit = Some(MarkerExit{..}); m.last_alive_ms = at })`.
- Returns the record.

`pub async fn emit_exit_row<R>(app, &ExitRecord) -> Option<i64>` calls `emit::emit_event_with_id(app, process_session_id(), catalog::APP_EXIT, payload, Some(TelemetryStatus::Ok), None, None)`.

### Call sites
1. **lib.rs run closure (lib.rs:1786)** becomes a match:
```rust
.run(|app, event| match event {
  tauri::RunEvent::ExitRequested { code, .. } => logging::telemetry::lifecycle::note_exit_requested(code),
  tauri::RunEvent::Exit => {
     log::info!("Application exiting, cleaning up resources...");
     let exit_rec = logging::telemetry::lifecycle::begin_exit(None); // FIRST: sync marker write
     tauri::async_runtime::block_on(async {
        if let Some(rec) = &exit_rec { logging::telemetry::lifecycle::emit_exit_row(app, rec).await; } // SECOND: outbox, pool still open
        /* existing: graceful stop <=30 s, db cleanup, sidecar — unchanged order (B5 may shorten the stop under session end) */
     });
     log::info!("Application cleanup complete");
  }
  _ => {}
})
```
2. **tray.rs:60-77** `quit`, inside the spawn before `set_tray_state`:
   - `let exit_id = match lifecycle::begin_exit(Some(ExitReason::TrayQuit)) { Some(rec) => lifecycle::emit_exit_row(&app_clone, &rec).await, None => None };`
   - Then the existing graceful stop (≤60 s).
   - Then `if let Some(id) = exit_id { drain::flush_rows(&app_clone, &[id], lifecycle::EXIT_FLUSH_BUDGET).await; }`. The flush runs after the stop so it does not delay saving the recording.
   - Then `app_clone.exit(0)`.
   - The Exit handler's `begin_exit` then returns None.
3. **rival_install.rs:104-110**: after `launch_detached_uninstaller(...)?` succeeds and before step 5 `db.cleanup()`: `if let Some(rec) = begin_exit(Some(RivalUninstall)) { if let Some(id) = emit_exit_row(&app,&rec).await { drain::flush_rows(&app,&[id], EXIT_FLUSH_BUDGET).await; } }`. If the launch fails, nothing is emitted and the app stays alive. Emitting before db.cleanup matters: once the pool is closed the insert would fail.
4. **Store close button**: new command in lifecycle.rs.
```rust
#[tauri::command]
pub async fn exit_for_store_update<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
  if crate::audio::recording_commands::is_recording().await { return Err("recording_active".into()); }
  if let Some(rec) = begin_exit(Some(ExitReason::UpdateStore)) {
     if let Some(id) = emit_exit_row(&app, &rec).await { super::drain::flush_rows(&app, &[id], EXIT_FLUSH_BUDGET).await; }
  }
  app.exit(0);
  Ok(())
}
```
   UpdateDialog.tsx:219-220: replace `await exit(0)` with `await invoke('exit_for_store_update')`. Keep the JS pre-check at L213-218 for the toast. In the catch branch, if the message is `recording_active`, show the same warning toast. Drop `exit` from the import at L15; `relaunch` is still used. `process:default` stays because relaunch uses it.
5. **StoreContext install (store_update.rs:182-190)**: inside the `with_mta` closure, after `updates.Size() > 0` and right before `imp::install(&ctx,&updates)`, call `crate::logging::telemetry::lifecycle::record_exit_intent(ExitReason::UpdateStoreApi, None, None)` (sync, marker only). After the closure, if the outcome is not `Ok(StoreInstallOutcome::Completed)`, call `clear_exit_intent()`. With Completed the intent stays; either Windows kills us, or a later observed exit wins at boot, or the intent goes stale after 10 minutes.
6. **NSIS (coordinate with B2)**: command `lifecycle_record_exit_intent(reason: String, target_version: Option<String>) -> Result<(), String>` accepts only `"update_nsis"` and returns Err otherwise; plus `lifecycle_clear_exit_intent()`. The JS or B2 flow is: `update.download(progress)` → (B2: graceful stop) → `invoke('lifecycle_record_exit_intent', { reason: 'update_nsis', targetVersion })` → `update.install()`. On failure in the catch: `invoke('lifecycle_clear_exit_intent')`. Splitting download from install is required so the intent lands just before `process::exit(0)` (updater.rs:865). If B2 moves the install into Rust, it calls `record_exit_intent(UpdateNsis, None, Some(v))` directly. Intents produce no app.exit row: the installer relaunches the app, and the next app.start reports `prev_exit_reason: "update_nsis"`, `version_changed: true`.
7. Register the three new commands in lib.rs `invoke_handler` near lib.rs:1766-1782. Custom commands need no capability; there is no AppManifest restriction in build.rs.

## (e) Coordination with B5 (session end)
B5 owns the WM_QUERYENDSESSION subclass. It should call `lifecycle::note_session_ending(session_end_kind_from_lparam(lparam))` on QUERYENDSESSION and `clear_session_ending()` on ENDSESSION(FALSE). Without B5, detail falls back to `session_ending` (SM_SHUTTINGDOWN) or `loop_destroyed`. Which session types set SM_SHUTTINGDOWN (logoff vs shutdown vs Restart Manager close_app) is unverified. Whatever bounding B5 adds to the Exit handler must keep `begin_exit` plus `emit_exit_row` as the first two steps; together they take a few ms (one fsync'd ~400 B write plus one SQLite insert).

## (f) Drain mutex and targeted flush (commit 1)
- drain.rs: `static DRAIN_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());`. `drain_once` takes `let _g = DRAIN_LOCK.lock().await;` first. Without it, a flush racing a drain batch would post the same row twice.
- Extract `async fn post_into(client, url, anon_key, token, rows: &[RecordingLog], synced: &mut Vec<i64>)` from the loop at drain.rs:97-122, keeping the same break rules (401/403/0 stop the batch). `drain_once` becomes lock → read → session/token (unchanged, may refresh) → `post_into` → mark.
- New `pub async fn flush_rows<R: Runtime>(app: &AppHandle<R>, ids: &[i64], budget: Duration) -> FlushOutcome` (`enum FlushOutcome { Sent(usize), NoSession, TokenStale, Timeout, Empty, Failed }`):
  1. Lock with `tokio::time::timeout(budget, DRAIN_LOCK.lock())`; on timeout return Timeout.
  2. Load rows with `RecordingLogRepository::get_unsynced_by_ids(pool, ids)`, a new repo function: `SELECT * FROM recording_logs WHERE synced_to_cloud = 0 AND id IN (?,..) ORDER BY id`, placeholders built like mark_as_synced at recording_log.rs:86-96, empty ids returns an empty Vec.
  3. Session from `CloudSyncState::snapshot()`; token from a new `session::token_if_fresh(app) -> Option<String>` that returns the token only if `decide_token_action(expires_at, now) == Reuse` (session.rs:136-142). It never refreshes, because cancelling a refresh mid-request at exit could lose the rotated refresh_token.
  4. `let mut synced = vec![]; let _ = tokio::time::timeout(remaining, post_into(.., &mut synced)).await;` then always `mark_as_synced(pool, &synced)` (local and fast). Accepted residual risk: a request cut off in flight may already have reached the server, and the next drain re-sends it (duplicate row).
  5. Log the outcome at debug after returning.
- `EXIT_FLUSH_BUDGET = Duration::from_secs(3)`. There is no flush during session end: the row stays in the outbox and uploads on next boot.
- emit.rs: `write_to_outbox` returns `Option<i64>` (the `log_event` rowid, recording_log.rs:35). Add `pub async fn emit_event_with_id(...) -> Option<i64>` with the same signature as `emit_event` (emit.rs:41-49). `emit_event` delegates and discards the id, so no existing caller changes.

## (g) block_on inside RunEvent::Exit under WM_ENDSESSION
This is safe for the added work. The existing handler already does `block_on` plus sqlx on the event-loop thread (lib.rs:1789-1813), and it runs on every tray quit. The main thread is not a tokio worker, so `Runtime::block_on` does not panic (setup does the same at lib.rs:696). sqlx-sqlite runs statements on its own connection worker threads, so the insert does not need the main thread.

Hazard (pre-existing, not introduced here): a spawned task that calls a main-thread API through `run_main_thread!` (tauri lib.rs:1081-1093: `run_on_main_thread` + `rx.recv()`) while the main thread waits in block_on would deadlock until the 30 s timeout. `send_user_message` runs inline only when already on the main thread (runtime-wry lib.rs:239-248). The new code calls no window, tray or menu APIs. `ctx_value` → `resolve_install_id` is a OnceLock hit or an in-memory store read.

## (h) Payloads
Column `session_id` = `context::process_session_id()` (as panics.rs:101). Both events have meeting_id None, error None, and ctx injected by emit (`ctx.occurred_at` is the event time). Timestamps are RFC3339 via `chrono::DateTime::<Utc>::from_timestamp_millis(ms).map(|d| d.to_rfc3339())`.

**app.start** — status `ok`, or `warning` when `prev_exit_clean == false`:
```json
{ "lifecycle_schema": 1, "build": "release|debug", "build_channel": "store|direct",
  "started_at_boot": bool /* crate::STARTED_AT_BOOT, lib.rs:89 */, "started_at": ts, "os_boot_at": ts|null,
  "first_run": bool, "marker_status": "ok|missing|corrupt",
  "prev_session_id": str|null, "prev_version": str|null, "prev_version_source": "marker|outbox"|null,
  "version_changed": bool|null, "prev_build": str|null,
  "prev_started_at": ts|null, "prev_last_alive_at": ts|null, "prev_uptime_s": int|null,
  "prev_exit_reason": "tray_quit|rival_uninstall|update_store|update_store_api|update_nsis|restart|app_exit|last_window_closed|session_end|crash_panic|os_restart_unclean|unclean"|null,
  "prev_exit_source": "observed|intent|inferred"|null, "prev_exit_detail": str|null /* logoff|shutdown|close_app|critical|session_ending|loop_destroyed|macos_terminate|<exit code> */,
  "prev_exit_clean": bool|null, "prev_recording_active_at_exit": bool|null,
  "prev_panicked": bool, "prev_panic_count": int, "os_rebooted_since_prev": bool|null,
  "downtime_s": int|null, "clock_skew": bool }
```
**app.exit** — status `ok`:
```json
{ "lifecycle_schema": 1, "reason": "...", "detail": str|null, "exit_code": int|null,
  "uptime_s": int, "recording_active": bool, "recording_phase": str, "build": "release|debug" }
```
Mapping to the issue's names:
- window_close → last_window_closed (the X hides to tray, so an exit here is the regression).
- os_shutdown / logoff → session_end with a detail.
- update_restart → update_nsis / update_store / update_store_api / restart.

Pre-login rows are attributed to whoever logs in next. That is an existing drain property (the RPC uses auth.uid at drain time), acceptable on single-user pilot PCs; T5 documents it.

## Catalog (lint a-g)
- catalog.rs, under "App / salud": `pub const APP_START: &str = "app.start";` and `pub const APP_EXIT: &str = "app.exit";`, with the header comment updated to name `lifecycle.rs` as the emitter.
- telemetry-events.ts: `APP_START: 'app.start',` and `APP_EXIT: 'app.exit',`.
- docs/TELEMETRIA.md inventory table (near L213-218): one row per event with the backticked name (lint (f)). T5 expands the documentation.

## T3 hook
`pub fn swap_last_autostart_state(new: &str) -> Option<String>`: sync, `mutate_marker(false, ..)`, returns the previous value, which boot carried forward. T3 compares states with it.

## Commits
1. `refactor: drenadora de telemetría con mutex y flush dirigido por id` — drain.rs (DRAIN_LOCK, post_into, flush_rows, FlushOutcome), recording_log.rs get_unsynced_by_ids, session.rs token_if_fresh, emit.rs emit_event_with_id, plus tests.
2. `feat: marcador de ciclo de vida y evento app.start con versión y causa del cierre anterior` — lifecycle.rs (marker, write_atomic, parse, summarize_prev, boot, ticker, swap_last_autostart_state), panics.rs (pub(crate) PANIC_FILE_NAME + parse_panic_ts), recording_log.rs last_app_version_excluding_session, lib.rs boot call after L728, catalog/TS/doc APP_START.
3. `feat: evento app.exit con motivo (tray, rival, fin de sesión de Windows) y ExitRequested` — lifecycle.rs (ExitReason, classify_exit, begin_exit, emit_exit_row, note_exit_requested, note_session_ending/clear, session_end_kind_from_lparam, GetSystemMetrics extern), lib.rs run-closure match + Exit ordering, tray.rs, rival_install.rs, catalog/TS/doc APP_EXIT.
4. `feat: intención de salida en updates (Store y NSIS) y cierre para actualizar desde Rust` — lifecycle.rs commands (exit_for_store_update, lifecycle_record_exit_intent, lifecycle_clear_exit_intent) + registration in lib.rs, store_update.rs intent around imp::install, UpdateDialog.tsx (invoke exit_for_store_update; download → intent → install split; B2 may absorb the NSIS part).

Every commit: `pnpm run tauri:build:debug` must exit 0, plus `cargo test --lib logging::telemetry` and `cargo test --lib database::repositories::recording_log` from frontend/src-tauri (cfg(test) is not compiled by the build). Commit 3 changes lib.rs and the command system, so the Guardian protocol requires a backup branch first.

## Files to change
- `frontend/src-tauri/src/logging/telemetry/lifecycle.rs` — NEW. Marker struct/parse/atomic write, boot(), summarize_prev (pure), alive ticker, ExitReason/SessionEndKind/ExitRequestSeen, classify_exit (pure), begin_exit (emit-once), emit_exit_row, note_exit_requested, note_session_ending/clear_session_ending, session_end_kind_from_lparam, os_shutting_down (user32 extern), record_exit_intent/clear_exit_intent, swap_last_autostart_state, commands exit_for_store_update / lifecycle_record_exit_intent / lifecycle_clear_exit_intent, #[cfg(test)] mod tests.
- `frontend/src-tauri/src/logging/telemetry/mod.rs` — Add `pub mod lifecycle;` and one doc line.
- `frontend/src-tauri/src/logging/telemetry/drain.rs` — Static tokio DRAIN_LOCK taken in drain_once. Extract post_into(&mut synced). New pub flush_rows(app, ids, budget) -> FlushOutcome, which uses token_if_fresh (no refresh), a timeout around the lock and the posts, and always marks what was synced.
- `frontend/src-tauri/src/logging/telemetry/emit.rs` — write_to_outbox returns Option<i64>. New pub emit_event_with_id(...) -> Option<i64>. emit_event delegates (signature unchanged).
- `frontend/src-tauri/src/logging/telemetry/panics.rs` — PANIC_FILE_NAME becomes pub(crate). Add pure pub(crate) parse_panic_ts(contents) -> Vec<u64>; import_pending unchanged.
- `frontend/src-tauri/src/logging/telemetry/catalog.rs` — Add APP_START = "app.start" and APP_EXIT = "app.exit" in the App/salud block; update the emitter comment.
- `frontend/src/lib/telemetry-events.ts` — Add APP_START: 'app.start', APP_EXIT: 'app.exit' (mirrors the Rust catalog, lint b).
- `docs/TELEMETRIA.md` — Inventory rows for `app.start` and `app.exit` (lint f); T5 does the full docs and SQL.
- `frontend/src-tauri/src/database/repositories/recording_log.rs` — New get_unsynced_by_ids(pool, ids) and last_app_version_excluding_session(pool, proc_session_id) (json_valid-guarded). Add a #[cfg(test)] module using setup_pool + sqlx::migrate!.
- `frontend/src-tauri/src/cloud_sync/session.rs` — New pub async fn token_if_fresh(app) -> Option<String> using decide_token_action (no refresh), with a test.
- `frontend/src-tauri/src/lib.rs` — Call lifecycle::boot(_app.handle()) right after the DB-init match (after L728). The run closure (L1786) becomes a match: ExitRequested{code,..} -> note_exit_requested; Exit -> begin_exit(None) sync, then emit_exit_row inside block_on BEFORE the existing graceful stop/db cleanup. Register the 3 new commands in invoke_handler (~L1766-1782).
- `frontend/src-tauri/src/tray.rs` — `quit` (L60-77): begin_exit(TrayQuit) + emit_exit_row before the graceful stop, then flush_rows(<=3 s) before app_clone.exit(0).
- `frontend/src-tauri/src/rival_install.rs` — After launch_detached_uninstaller succeeds (L104) and before db.cleanup (L108): begin_exit(RivalUninstall) + emit_exit_row + flush_rows(<=3 s).
- `frontend/src-tauri/src/store_update.rs` — Inside the with_mta closure, record_exit_intent(UpdateStoreApi) just before imp::install; clear_exit_intent() when the outcome is not Completed.
- `frontend/src/components/updates/UpdateDialog.tsx` — handleCloseToUpdate: invoke('exit_for_store_update') instead of exit(0), handling a 'recording_active' error. NSIS: split downloadAndInstall into download() -> invoke('lifecycle_record_exit_intent',{reason:'update_nsis',targetVersion}) -> install(), with lifecycle_clear_exit_intent in the catch (coordinate with B2). Remove the unused `exit` import.
- `frontend/src/components/updates/UpdateDialog.test.tsx` — Update mocks and assertions: the close-to-update path invokes 'exit_for_store_update'; the NSIS path calls download/intent/install in order.

## Commits
- **refactor: drenadora de telemetría con mutex y flush dirigido por id**
  drain.rs: static tokio::sync::Mutex DRAIN_LOCK taken by drain_once (prevents double posts when a flush and a drain overlap); post loop extracted into post_into(&mut synced); new flush_rows(app, ids, budget) -> FlushOutcome (lock with timeout, get_unsynced_by_ids, token_if_fresh without refresh, timeout around the posts, always mark_as_synced). emit.rs: write_to_outbox returns the rowid; new emit_event_with_id. recording_log.rs: get_unsynced_by_ids + tests. session.rs: token_if_fresh + test. No behavior change for existing emitters.
- **feat: marcador de ciclo de vida y evento app.start con versión y causa del cierre anterior** (deps: refactor: drenadora de telemetría con mutex y flush dirigido por id)
  New logging/telemetry/lifecycle.rs: lifecycle.json (release) / lifecycle-debug.json (debug) in app_data_dir written with raw std::fs tmp+rename; boot() runs synchronously after DB init and before panics::import_pending; summarize_prev (pure) computes prev_version (fallback: last recording_logs.app_version from another process, release only), version_changed, prev_exit_reason/source/detail/clean, prev_uptime_s, downtime_s, prev_panicked, os_rebooted_since_prev; 60 s last_alive ticker; swap_last_autostart_state for T3. panics.rs: pub(crate) PANIC_FILE_NAME + parse_panic_ts. recording_log.rs: last_app_version_excluding_session. Catalog APP_START in catalog.rs + telemetry-events.ts + a row in docs/TELEMETRIA.md.
- **feat: evento app.exit con motivo (tray, rival, fin de sesión de Windows) y ExitRequested** (deps: feat: marcador de ciclo de vida y evento app.start con versión y causa del cierre anterior)
  lifecycle.rs: ExitReason, ExitRequestSeen, SessionEndKind + session_end_kind_from_lparam, classify_exit (pure), begin_exit (emit-once guard, sync fsync'd marker write), emit_exit_row, note_exit_requested, note_session_ending/clear_session_ending (hooks for B5), GetSystemMetrics(SM_SHUTTINGDOWN) via a user32 extern. lib.rs: the run closure handles ExitRequested{code,..}; RunEvent::Exit writes the marker first and then the app.exit row, before the graceful stop and db cleanup. tray.rs quit and rival_install.rs emit their reason and flush for <=3 s (rival before db.cleanup). Catalog APP_EXIT (Rust + TS + doc row). A backup branch is needed first (lib.rs, Guardian protocol).
- **feat: intención de salida en updates (Store y NSIS) y cierre para actualizar desde Rust** (deps: feat: evento app.exit con motivo (tray, rival, fin de sesión de Windows) y ExitRequested)
  New commands exit_for_store_update (refuses while recording, emits app.exit update_store + flush <=3 s, then app.exit(0)), lifecycle_record_exit_intent (only 'update_nsis') and lifecycle_clear_exit_intent, registered in lib.rs. store_update.rs: marker-only intent update_store_api around imp::install, cleared when the outcome is not Completed. UpdateDialog.tsx: the Store button invokes exit_for_store_update; NSIS splits download -> intent -> install (coordinate with B2, which may move the install into Rust and call record_exit_intent directly). UpdateDialog.test.tsx updated.

## Tests
- frontend/src-tauri/src/logging/telemetry/lifecycle.rs #[cfg(test)]: parse_marker: None -> Missing; garbage -> Corrupt; a valid v1 JSON roundtrips; a JSON with extra unknown fields and schema 2 still parses into Ok with its known fields; missing optional fields use defaults.
- lifecycle.rs tests: marker_file_name(true) == "lifecycle-debug.json", marker_file_name(false) == "lifecycle.json"; write_atomic roundtrip in a tempfile::tempdir (no .tmp left behind, overwrites the existing file, durable and non-durable).
- lifecycle.rs tests (summarize_prev): Cases: (1) Missing without fallback -> first_run true, all prev null, status ok; (2) Missing with fallback '0.2.61' -> first_run false, prev_version_source 'outbox', version_changed true; (3) observed tray_quit -> clean true, source observed, downtime = now - max(exit.at, last_alive), uptime = exit.at - started; (4) no exit plus a fresh intent update_nsis -> reason update_nsis, source intent, clean true; (5) intent older than last_alive by more than 10 minutes -> ignored -> unclean; (6) no exit plus a panic ts >= last_alive-60s -> crash_panic, prev_panicked true; (7) a panic ts before prev.started_at_ms or after end+60s is not counted; (8) no exit, os_boot > last_alive+120s -> os_restart_unclean, os_rebooted_since_prev true; (9) no exit otherwise -> unclean, status warning; (10) now < last_alive -> downtime 0 and clock_skew true; (11) observed session_end/close_app plus fresh intent update_store_api -> reason update_store_api, detail close_app; (12) Corrupt -> marker_status corrupt and fallback allowed.
- lifecycle.rs tests (classify_exit): The hint wins over everything; Programmatic(i32::MAX) -> restart; Programmatic(0) -> app_exit with code 0; UserInteraction -> last_window_closed; NotSeen plus Some(Logoff) -> session_end/logoff; NotSeen plus os_shutting_down -> session_end/session_ending; NotSeen with nothing -> session_end/loop_destroyed; NotSeen plus a fresh intent -> the intent reason with the session detail.
- lifecycle.rs tests: session_end_kind_from_lparam: 0 -> Shutdown, 0x1 -> CloseApp, 0x80000000 -> Logoff, 0x40000000 -> Critical, 0x80000001 -> CloseApp (precedence).
- lifecycle.rs tests: The app.start / app.exit payload builders never emit an 'unknown' string for version fields (null instead) and always include lifecycle_schema and build; ExitReason::as_str values are all snake_case and unique.
- frontend/src-tauri/src/logging/telemetry/panics.rs tests: parse_panic_ts: multiple lines, blank lines and malformed lines skipped, ts_ms missing -> skipped.
- frontend/src-tauri/src/database/repositories/recording_log.rs #[cfg(test)] (setup_pool max_connections(1) + sqlx::migrate!): get_unsynced_by_ids returns only unsynced rows among the given ids, [] -> empty; last_app_version_excluding_session skips rows whose ctx.session_id equals the current process, tolerates non-JSON event_data and NULL app_version, and returns the newest by id.
- frontend/src-tauri/src/cloud_sync/session.rs tests: The token_if_fresh decision is exercised via decide_token_action (Reuse vs Refresh at the REFRESH_MARGIN_SECS edge); if the helper is split into a pure part, test that part.
- frontend/src-tauri/src/logging/telemetry/drain.rs tests: Pure: FlushOutcome mapping; empty ids -> Empty without touching the network (use a function that selects rows/ids given an input set).
- frontend/src/components/updates/UpdateDialog.test.tsx: Close-to-update invokes 'exit_for_store_update' (not plugin-process exit); a 'recording_active' rejection shows the warning toast; the NSIS flow calls download -> invoke('lifecycle_record_exit_intent', {reason:'update_nsis', targetVersion}) -> install, and on an install error invokes 'lifecycle_clear_exit_intent'.
- frontend/scripts/lint-telemetry.js (pre-build): Must pass with app.start/app.exit in catalog.rs + telemetry-events.ts + backticked in docs/TELEMETRIA.md.

## Risks
- The Exit handler during WM_ENDSESSION gets slower, and Windows shows 'this app is preventing shutdown' or kills the process before the marker is written. → The marker write (one fsync'd ~400 B file) and the single SQLite insert run first, before the existing up-to-30 s graceful stop; no network is used. B5 bounds the stop itself.
- A flush and a drain double-post the same row. → DRAIN_LOCK serializes drain_once and flush_rows; flush_rows selects only unsynced rows by id.
- Timing out at exit cancels a token refresh mid-flight, and the rotated refresh_token is lost. → flush_rows uses token_if_fresh (no refresh); a stale token returns TokenStale and the row uploads on next boot.
- The tray quit, rival and Store-close paths take up to 3 s longer. → The budget is capped at EXIT_FLUSH_BUDGET = 3 s and runs only with a live session and a fresh token; typically 200-500 ms.
- Debug runs or the smoke test corrupt prod's prev_version and exit state (shared app_data_dir). → Separate marker file per profile, fallback query only in release builds, panic time-window filter, and `build` in every payload so T5 SQL filters build='release'.
- The recording_logs fallback returns a debug-run version on dev machines (shared DB). → It is only used on the very first 0.2.62+ release launch (no marker yet) and is tagged prev_version_source='outbox'.
- Intents go stale (download failed, Store install cancelled) and a later crash is misreported as an update. → clear_exit_intent on failure paths; the freshness window is intent.at_ms + 10 min >= last_alive, and an observed exit always wins.
- An emit-once guard consumed by a Rust path whose exit never happens (e.g. app.exit(0) somehow prevented) hides a later real exit. → Nothing calls prevent_exit (behavior unchanged). begin_exit is called only right before a certain exit; exit_for_store_update calls app.exit(0) unconditionally after the recording check.
- Marker write failures (antivirus lock, MSIX virtualization) lose data. → Errors are returned and logged with warn outside the lock; the app never blocks or panics; app.start reports marker_status.
- Modifying lib.rs and the command system (Guardian high-risk). → Backup branch before commit 3; mandatory tauri:build:debug; the match keeps existing Exit logic byte-identical after the two new lines.
- Pre-login app.start rows get attributed to whoever logs in next (drain resolves auth.uid at drain time). → Accepted for single-user pilot PCs; ctx.install_id allows correlation; T5 documents it.

## Manual verification
- Release build (NSIS or MSIX): open Maity, then tray > Quit. Within a few seconds maity.platform_logs has app.exit with reason tray_quit. Reopen: app.start has prev_exit_reason tray_quit, prev_exit_source observed, prev_exit_clean true, and a plausible downtime_s.
- Kill maity-desktop.exe from Task Manager, then reopen: app.start has prev_exit_reason unclean, prev_exit_clean false, status warning.
- Sign out of Windows with Maity running, then sign in (app autostarts): app.start has prev_exit_reason session_end and detail logoff (with B5's subclass) or session_ending/loop_destroyed (without it). The app.exit row arrives after the next login.
- Restart the PC during a manual recording: app.start has prev_exit_reason session_end and prev_recording_active_at_exit true; the recording was saved by the existing backstop.
- Store channel: the 'Cerrar Maity para actualizar' button with no recording produces app.exit update_store in the cloud before the process ends; with a recording active it shows the toast and Maity stays open.
- NSIS channel: update from 0.2.62 to a newer test build. The next app.start has prev_exit_reason update_nsis, version_changed true and prev_version equal to the old version.
- First launch of 0.2.62 over 0.2.61 (no marker): app.start has marker_status missing, prev_version 0.2.61, prev_version_source outbox.
- Run `pnpm run tauri:dev` or the debug smoke test, then open the installed release: %APPDATA%\com.maity.ai\lifecycle.json is unchanged and lifecycle-debug.json exists; release app.start is unaffected.
- Inject a test panic in a dev build: the next start reports crash_panic and prev_panicked true.
- SQL check: select event_type, status, count(*) from maity.platform_logs where event_type in ('app.start','app.exit') group by 1,2 — only ok/warning.

## Open questions
- Should ExitRequested{code: None} (last window destroyed, the 0.2.57 regression class) also call prevent_exit to keep the tray process alive? That changes behavior and is out of T2's scope; for now T2 only records last_window_closed.
- B2 ownership of the NSIS flow: will B2 move the install into Rust (then it calls record_exit_intent(UpdateNsis) directly) or keep JS (then UpdateDialog splits download -> intent -> install)?
- B5: will the WM_QUERYENDSESSION subclass exist in the same release? Without it the session-end detail degrades to session_ending/loop_destroyed.
- Should intents (update_nsis) also emit a flushed app.exit row with kind=intent? The current design says no: the next app.start carries it, and it avoids aborted-intent rows.
- Should the fallback prev_version also be used in debug builds for local testing? Current design: release only.

## Unverified
- How Windows closes the app after a StoreContext install (Restart Manager WM_QUERYENDSESSION with ENDSESSION_CLOSEAPP followed by WM_ENDSESSION, versus a hard terminate). The design handles both (intent plus the session_end override rule).
- Which session types set GetSystemMetrics(SM_SHUTTINGDOWN) (logoff vs shutdown vs Restart Manager close_app).
- Whether Windows Fast Startup resets GetTickCount64 (sysinfo boot_time); os_restart_unclean may therefore only fire on full reboots.
- Whether WM_QUERYENDSESSION reaches a hidden main window that B5 subclasses (it is sent to all top-level windows per Win32 docs, but not tested here).
- Actual time the Exit handler spends under WM_ENDSESSION on pilot hardware (fsync plus SQLite insert expected to be a few ms).