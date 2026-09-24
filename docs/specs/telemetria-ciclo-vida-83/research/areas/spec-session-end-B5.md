# B5: detect Windows session end (logoff, shutdown/restart, Restart Manager close-app, critical) and stop blocking power-off while recording

## Summary
Today tao ignores WM_QUERYENDSESSION. On WM_ENDSESSION(TRUE) to its hidden thread-target window it destroys the loop, and tauri fires RunEvent::Exit inside that same message on the main thread. Our Exit handler then blocks there for up to 30 s (graceful_shutdown_before_exit), plus an unbounded DB pool close and sidecar kill. It never learns whether this is a logoff, a shutdown or a Restart Manager close. The graceful path also runs in the wrong order for a session end. It waits up to 120 s for the transcription queue before it flushes the last checkpoint, so Windows kills us first and that tail is lost. For a streaming jornada segment it can also save to SQLite while the SCHEDULED_JORNADA_CLOSED event can't reach the webview (the main thread is blocked), which risks a duplicate meeting from autoRecoverAll at next boot.

The plan has three commits:
(i) A new `session_end` module subclasses the main window HWND in setup() (main thread, the thread that created the window). It records the kind from the WM_QUERYENDSESSION / WM_ENDSESSION lParam, uses GetSystemMetrics(SM_SHUTTINGDOWN) as a fallback, and exposes `observed()` for T2's app.exit reason.
(ii) At WM_QUERYENDSESSION with a recording running, it registers ShutdownBlockReasonCreate("Guardando la grabación de Maity…"), always returns TRUE, and starts a non-destructive early checkpoint. When RunEvent::Exit is a session end, a short-budget path runs instead of the 30 s graceful stop: stop capture, write transcripts.json, flush the final checkpoint only if it can finish, then DB cleanup (1 s) and sidecar kill (0.5 s), and release the block reason. It never merges, never finalizes and never emits. Recovery at next boot is left to the existing paths: the batch orphan pass keyed by process_id, and the streaming IndexedDB autoRecoverAll.
(iii) Checkpoint recovery tolerates a truncated last checkpoint.

## Current behavior
- tao does not handle WM_QUERYENDSESSION at all. On WM_ENDSESSION with wParam TRUE, the thread event-target window destroys the loop and drops lParam (the logoff/close-app/critical flags). — tao-0.35.2/src/platform_impl/windows/event_loop.rs:2382-2391: `// We don't process WM_QUERYENDSESSION yet ...` / `win32wm::WM_ENDSESSION => { if wparam.0 == TRUE.0 as usize { subclass_input.event_loop_runner.loop_destroyed(); } // Note: after we return 0 here, Windows will shut us down LRESULT(0) }`
- The thread event target is a top-level (parentless) WS_EX_TOOLWINDOW|LAYERED|TRANSPARENT window whose style is forced to WS_VISIBLE|WS_POPUP at 0x0 size, subclassed with id 1. Public windows use public_window_callback (id 0), which has no WM_QUERYENDSESSION/WM_ENDSESSION arm and falls through to DefSubclassProc -> window_proc -> DefWindowProcW (returns TRUE for QES). — event_loop.rs:649-689 (create_event_target_window, `(WS_VISIBLE | WS_POPUP).0`), :703-708 and :744-757 (SetWindowSubclass ids THREAD_EVENT_TARGET_SUBCLASS_ID=1 / WINDOW_SUBCLASS_ID=0); Grep for WM_ENDSESSION in event_loop.rs finds only :2384; window.rs:1382-1434 window_proc -> DefWindowProcW.
- loop_destroyed moves the runner to Destroyed, which calls the handler with Event::LoopDestroyed. tauri-runtime-wry maps that to RunEvent::Exit, so it runs synchronously on the main thread inside the WM_ENDSESSION dispatch, with no ExitRequested first. — runner.rs:238-240 `loop_destroyed(&self) { self.move_state_to(RunnerState::Destroyed) }`, :338-340 `(Idle, Destroyed) => { self.call_event_handler(Event::LoopDestroyed) }`; tauri-runtime-wry-2.11.2/src/lib.rs:4192-4194 `Event::LoopDestroyed => { callback(RunEvent::Exit); }`; tauri-2.11.2/src/app.rs:1422-1425 Exit -> callback then cleanup_before_exit.
- Our Exit handler blocks the main thread up to 30 s in graceful_shutdown_before_exit, then runs db_manager.cleanup() (WAL TRUNCATE checkpoint plus pool.close(), which waits for checked-out connections) and force_shutdown_sidecar (awaits the SIDECAR_POOL lock), both without a timeout. — lib.rs:1786-1824: `tauri::async_runtime::block_on(async { if tokio::time::timeout(std::time::Duration::from_secs(30), graceful_shutdown_before_exit(_app_handle)).await.is_err() {...} ... app_state.db_manager.cleanup().await ... summary::summary_engine::force_shutdown_sidecar().await`; database/manager.rs:296-314; summary_engine/client.rs:203-215.
- The manual/streaming stop waits up to 120 s for the transcription task before it saves. The final checkpoint flush and ffmpeg merge (save_recording_only -> stop_and_save -> IncrementalAudioSaver::finalize) come after that wait, with their own 300 s deadlines. So under the 30 s outer timeout at a session end, the final <30 s tail is usually never flushed. — audio/recording_lifecycle.rs:603-663 (`max_timeout = 120s`, cancel at 60s), :701-704 (`timeout(300s, manager.save_recording_only(&app))`); recording_saver.rs:456-459 `saver.finalize().await`; incremental_saver.rs:289-321 (flush_checkpoint then merge_checkpoints), :21 `FINALIZE_ENCODE_TIMEOUT = 300s`.
- For a jornada segment, graceful exit goes through close_scheduled. That calls finalize_segment_native (a SQLite save), then an emit of SCHEDULED_JORNADA_CLOSED that the webview needs in order to mark IndexedDB saved, then notify_jornada_saved, then sets rearm_at to the next day. — scheduled_recording/service.rs:393-407 close_owned_segment_for_exit -> close_scheduled; :846-847 finalize_segment_native; :859-867 emit plus notify; :896-899 `rearm_at = Some(start_of_next_day(now))`; RecordingPostProcessingProvider.tsx:176-183 marks saved only on that event.
- Events emitted from worker threads while the main thread sits in block_on are queued through the event-loop proxy and can't be delivered, and window getters from workers block until the main thread answers. So at session end the IndexedDB 'saved' mark can be lost after Rust already saved, leaving a possible duplicate via autoRecoverAll. Inferred from code; not reproduced. — tauri-runtime-wry lib.rs:235-251 send_user_message (handles inline only on main_thread_id, otherwise proxy send); :197-204 getter! blocks on rx.recv(); docs/REGLAS_AUDIO_GRABACION.md § Recuperación: 'Pendiente conocido ... posible duplicado del que Rust ya guardó'.
- Next-boot recovery already covers an unfinalized recording. Batch rows still in 'recording' with another process_id are orphans: checkpoints are merged, then the row goes pending, gets transcribed and finalized. Streaming recordings are recovered from the IndexedDB WAL plus checkpoints by autoRecoverAll. — audio/transcription/batch/planner.rs:167-169 `row_pid != Some(my_pid) || phase_idle`, :279-302 recover_orphans, :339-355 Merge -> mark_crash_recovery; planner tests :760-774; hooks/useTranscriptRecovery.ts:120-123 (batch records are ghosts), :189-294 recoverMeeting (recover_audio_from_checkpoints + saveMeeting), :306-332 autoRecoverAll.
- A checkpoint killed mid-encode is unreadable, because encodes use -movflags +faststart and write directly to audio_chunk_NNN.mp4. Recovery concatenates every .mp4 with no per-file validation, so one truncated last chunk can fail the whole recovery. — audio/encode.rs:71-72 `"-movflags", "+faststart"`; incremental_saver.rs:175-207 dispatch_checkpoint_encode writes checkpoint_path, :534-540 filters only by extension, :587-611 a concat failure returns status 'failed'.
- Checkpoint encodes take 1-4 s on loaded machines. Only one runs at a time (a 1-permit semaphore), and the normal path uses a non-blocking try_acquire. — incremental_saver.rs:167-174 doc comment ('El FFmpeg encode toma 1-4s en máquinas cargadas'), :217-253 spawn_checkpoint_encode try_acquire_owned, :257-283 acquire_encode_slot/flush_checkpoint.
- setup() runs on the main thread, and the 'main' window is created from config in the same setup() just before our closure. So SetWindowSubclass and ShutdownBlockReasonCreate (both restricted to the creating thread) are legal from setup() and from a subclass proc. — tauri-2.11.2/src/app.rs:1414-1417 (setup inside RuntimeRunEvent::Ready of the event-loop callback), :2513-2524 (windows from config built, then user setup); lib.rs:922-949 existing main-window hook in setup.
- windows 0.58 is used only by maity-desktop. Win32_UI_Shell is already implied by Win32_UI_Shell_PropertiesSystem, so SetWindowSubclass/DefSubclassProc/RemoveWindowSubclass are available now. ShutdownBlockReasonCreate/Destroy need Win32_System_Shutdown, and the WM_*/ENDSESSION_*/GetSystemMetrics/SM_SHUTTINGDOWN items need Win32_UI_WindowsAndMessaging; neither feature is enabled. — Cargo.lock: only `maity-desktop 0.2.61` depends on `windows 0.58`; frontend/src-tauri/Cargo.toml:272-296 (feature list; :293-294 comment 'IInitializeWithWindow ya llega por Win32_UI_Shell'); windows-0.58.0 Cargo.toml:670, :729, :731, :734; UI/Shell/mod.rs:242, :2431, :4538 (ungated); System/Shutdown/mod.rs:98, :107; UI/WindowsAndMessaging/mod.rs:1486 GetSystemMetrics, :3632-3634 ENDSESSION_*, :4774 SM_SHUTTINGDOWN=8192, :5295 WM_ENDSESSION=22, :5383 WM_NCDESTROY=130, :5438 WM_QUERYENDSESSION=17.
- The dependency lint checks only for duplicate crate versions and banned crates, not windows-crate features. — frontend/scripts/lint-cargo-deps.js (the Grep for 'windows' and 'feature' hits only the clap/nnnoiseless notes at :16, :50-51); docs/BUILDING.md:350 lists the checked crates.
- How to get the main window HWND from tauri (windows 0.61 HWND) into windows 0.58 is already solved in the repo. — store_update.rs:78-85 `let hwnd = window.hwnd()...; Ok(hwnd.0 as isize)` and :92 `HWND(hwnd as *mut core::ffi::c_void)`.
- Microsoft semantics: each app should return TRUE from WM_QUERYENDSESSION immediately and do cleanup in WM_ENDSESSION. The UI appears after 5 s. An app with a visible top-level window or a registered reason string can take as long as needed in ES, with the UI after 5 s; in a critical shutdown it gets 30 s. An app with no visible window and no reason gets 5 s and is then terminated. Calling ShutdownBlockReasonCreate in the QES handler and returning TRUE promptly gets the 30 s treatment. ShutdownBlockReasonCreate must be called from the thread that created the HWND. The lParam values are CLOSEAPP 0x1, CRITICAL 0x40000000 and LOGOFF 0x80000000 (a bitmask; 0 means shutdown or restart, which can't be told apart). Restart Manager sends QES and ES with ENDSESSION_CLOSEAPP and then WM_CLOSE. SM_SHUTTINGDOWN (0x2000) is nonzero while the session is shutting down. — learn.microsoft.com: wm-queryendsession, wm-endsession, shutdown-changes-for-windows-vista, previous-versions ms700677 'Application Shutdown Changes in Windows Vista' (Tables 1-2, usage model 3), nf-winuser-shutdownblockreasoncreate (Remarks), rstmgr/guidelines-for-applications, nf-winuser-getsystemmetrics (SM_SHUTTINGDOWN row).
- The tray Quit and rival_install exits go through app.exit/handle.exit, and SM_SHUTTINGDOWN is 0 for them, so they are unaffected and keep the 30 s graceful path. — tray.rs:60-78 (graceful with 60 s timeout, then app_clone.exit(0)); lib.rs:1786-1800.

## Design
## 0. Guardrails for the implementer
- **The Bash guard blocks any command containing the word "shutdown"** (case-insensitive). That covers the Cargo feature `Win32_System_Shutdown`, the names `graceful_shutdown_before_exit` / `force_shutdown_sidecar`, and `ShutdownBlockReason*`. Use the Edit and Grep tools for these. Write commit bodies to a file and use `git commit -F <file>`, or keep the word out of `-m` text (say "apagado" / "fin de sesión"). Don't name any new file or module with that word.
- Protocolo Guardian: commit (ii) touches `lib.rs` and `recording_manager.rs`. Create `backup/2026-09-23-fin-sesion-windows` before it (`git checkout -b ...; git checkout -`). Run `cd frontend && pnpm run tauri:build:debug` (foreground, exit 0) before **each** commit. Run `graphify update .` afterwards.
- No emits, no window getters (`hwnd()`, `inner_size()`…), no tray updates and no toasts inside the session-end exit path. The main thread is blocked in `block_on`, so those calls either queue forever or deadlock until the timeout.

## 1. Where the messages go and on which thread
- The system sends WM_QUERYENDSESSION (QES) to **every top-level window** of the process (serially), then WM_ENDSESSION (ES) to each. Our process has these top-level windows: tao's thread event-target window (the one that triggers `RunEvent::Exit`), `main` (hidden in the tray but still a top-level window), `coach-float`, `recording-widget` and `device-picker`. The WebView2 HWNDs are children of these and don't count.
- Within one app, every window gets QES before any window gets ES. So a subclass on `main` always sees QES **before** tao runs `RunEvent::Exit` (which happens inside the event target's ES). The relative order of the ES messages between `main` and the event target is undefined. The design therefore doesn't depend on seeing ES on `main`: QES records the kind, and `observed()` falls back to `GetSystemMetrics(SM_SHUTTINGDOWN)`.
- Threads involved:
  - **Main/UI thread**: tao message loop; our `subclass_proc` (QES/ES handlers: atomics, a std Mutex, two Win32 calls, one `tauri::async_runtime::spawn`, never blocks); `RunEvent::Exit` handler (`block_on` of the short-budget future, then `release_block_reason()`).
  - **Tokio workers**: the early-checkpoint task spawned at QES; subtasks of the flush.
  - **spawn_blocking pool**: `encode_single_audio` (ffmpeg child).
  - `block_on` polls the future on the main thread. Nothing in the fast path needs the main thread to answer.

## 2. Commit (i): session-end kind detection (feeds T2)
### 2.1 Cargo.toml (`frontend/src-tauri/Cargo.toml`, inside the `windows = { version = "0.58", features = [` list at :272-296)
Add, with comments in the file's style:
- `"Win32_System_Shutdown",        # ShutdownBlockReasonCreate/Destroy (session_end.rs)`
- `"Win32_UI_WindowsAndMessaging", # WM_QUERYENDSESSION/WM_ENDSESSION, ENDSESSION_*, GetSystemMetrics(SM_SHUTTINGDOWN)`

`SetWindowSubclass` / `DefSubclassProc` / `RemoveWindowSubclass` already come with `Win32_UI_Shell`, which `Win32_UI_Shell_PropertiesSystem` implies. No new crate or version enters the tree, so `lint-cargo-deps.js` is unaffected. (Commit (i) needs only WindowsAndMessaging. Add Shutdown in (ii) if you prefer strictly minimal commits.)

### 2.2 New file `frontend/src-tauri/src/session_end.rs`, registered as `pub mod session_end;` next to `pub mod rival_install;` at lib.rs:62
Pure part (compiled on all targets, unit-tested):
```rust
pub const LP_CLOSEAPP: u32 = 0x0000_0001;   // == ENDSESSION_CLOSEAPP
pub const LP_CRITICAL: u32 = 0x4000_0000;   // == ENDSESSION_CRITICAL
pub const LP_LOGOFF:   u32 = 0x8000_0000;   // == ENDSESSION_LOGOFF

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionEndKind { Logoff, SystemPowerOff /* lParam sin LOGOFF/CLOSEAPP: apagado o reinicio, indistinguibles */, CloseApp /* Restart Manager */, Unknown /* solo SM_SHUTTINGDOWN */ }

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionEndSource { QueryEndSession, EndSession, SystemMetric }

#[derive(Debug, Clone, Copy)]
pub struct SessionEndInfo { pub kind: SessionEndKind, pub critical: bool, pub source: SessionEndSource, pub lparam: u32, pub observed_at: std::time::Instant }

pub fn classify_lparam(lparam: u32) -> (SessionEndKind, bool) {
    let critical = lparam & LP_CRITICAL != 0;
    let kind = if lparam & LP_CLOSEAPP != 0 { SessionEndKind::CloseApp }
               else if lparam & LP_LOGOFF != 0 { SessionEndKind::Logoff }
               else { SessionEndKind::SystemPowerOff };
    (kind, critical)
}
impl SessionEndKind {
    /// Contrato con T2 (`app.exit.reason`). Strings estables: van a platform_logs.
    pub fn exit_reason(self) -> &'static str { match self { Logoff => "logoff", SystemPowerOff => "os_shutdown", CloseApp => "os_close_app", Unknown => "os_session_end" } }
    pub fn as_str(self) -> &'static str { /* "logoff"|"power_off"|"close_app"|"unknown" for logs */ }
}

/// Celda testeable (la instancia de producción es un static).
pub struct SessionEndCell { inner: std::sync::Mutex<Option<SessionEndInfo>> }
impl SessionEndCell {
    pub const fn new() -> Self;
    pub fn record(&self, info: SessionEndInfo);            // QES: siempre sobreescribe
    pub fn record_if_absent(&self, info: SessionEndInfo);  // ES(TRUE): no pisa un registro de QES
    pub fn clear(&self);                                   // ES(FALSE): fin de sesión cancelado
    pub fn fresh(&self, now: Instant, ttl: Duration) -> Option<SessionEndInfo>; // None si más viejo que ttl
}
pub const RECORD_TTL: Duration = Duration::from_secs(120);
static CELL: SessionEndCell = SessionEndCell::new();
```
Lock with `if let Ok(mut g) = self.inner.lock()` (never `.unwrap()`, per the repo rule). The TTL protects against a QES that is never followed by ES(FALSE): a later tray Quit must not be classified as `os_shutdown`.

Windows part (`#[cfg(target_os = "windows")] mod imp`):
```rust
use windows::Win32::Foundation::{HWND, WPARAM, LPARAM, LRESULT};
use windows::Win32::UI::Shell::{SetWindowSubclass, DefSubclassProc, RemoveWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{WM_QUERYENDSESSION, WM_ENDSESSION, WM_NCDESTROY, GetSystemMetrics, SM_SHUTTINGDOWN};
const SUBCLASS_ID: usize = 0x4D41_4954; // "MAIT"; tao usa 0 y 1 con otra pfn
static MAIN_HWND: AtomicIsize = AtomicIsize::new(0);

pub fn install(window: &tauri::WebviewWindow) // llamado desde setup() (hilo principal)
```
- `install`: `window.hwnd()` (on the main thread tauri serves the getter inline, tauri-runtime-wry lib.rs:239-248). Convert as store_update.rs:83-84,92 do. Store the value in `MAIN_HWND`, then call `SetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID, 0)`. Log `info!("[session_end] subclass instalado en main")`, or `warn!` if it returns FALSE; never panic.
- `unsafe extern "system" fn subclass_proc(hwnd, msg, wparam, lparam, _id, _ref) -> LRESULT`: wrap the handler body in `std::panic::catch_unwind(AssertUnwindSafe(..))` (a panic across FFI would abort the app). Then **always** `return DefSubclassProc(hwnd, msg, wparam, lparam)` so tao's subclass (id 0) and DefWindowProcW still run. Never return FALSE: we don't veto.
  - `WM_QUERYENDSESSION` → `on_query_end_session(hwnd, lparam.0 as u32)`:
    `CELL.record(SessionEndInfo{ source: QueryEndSession, .. classify_lparam })`, then `info!("[session_end] WM_QUERYENDSESSION kind={} critical={} lparam={:#x} recording={}")`. Commit (ii) adds the recording hook here.
  - `WM_ENDSESSION`: if `wparam.0 == 0` → `CELL.clear()`, `info!("... cancelado")` (commit (ii) also releases the reason). Otherwise → `CELL.record_if_absent(.. source: EndSession ..)`.
  - `WM_NCDESTROY` → `RemoveWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID)`. This is the same pattern tao uses at event_loop.rs:2323-2327.
- `pub fn observed() -> Option<SessionEndInfo>`: returns `CELL.fresh(now, RECORD_TTL)` if set. Otherwise, if `GetSystemMetrics(SM_SHUTTINGDOWN) != 0`, returns `Some(Unknown, critical:false, source: SystemMetric, lparam:0)`. Otherwise `None`. Call it only from the Exit handler.
- Non-Windows: `install` is a no-op and `observed()` returns `None`.

### 2.3 lib.rs wiring
- After the `on_window_event` block (lib.rs:922-949), inside the same `if let Some(main_window)` or a new one: `#[cfg(target_os = "windows")] session_end::install(&main_window);`
- In the Exit handler (lib.rs:1787), as its first statement: `let session_end = session_end::observed();` and log `info!("Application exiting (session_end={:?})", session_end.map(|s| (s.kind.as_str(), s.critical, s.source)))`. **Behavior is unchanged in (i).** The value is passed on to T2's slot (see §4).

## 3. Commit (ii): B5, a short-budget session-end exit
### 3.1 Recording hook at QES (session_end.rs, on the main thread)
In `on_query_end_session`, when `crate::audio::recording_phase::current_phase().is_session_active()` (sync, recording_phase.rs:61-63,140):
1. `ShutdownBlockReasonCreate(HWND(MAIN_HWND), w!("Guardando la grabación de Maity…"))`, then set `static REASON_ACTIVE: AtomicBool`. Log the error without failing if it fails. This is Microsoft's usage model 3: the reason string plus TRUE returned promptly gives us up to 30 s in ES even under a critical shutdown, and names Maity in the UI if we pass 5 s.
2. `tauri::async_runtime::spawn(crate::audio::recording_lifecycle::request_early_checkpoint())`. This is **non-destructive**: recording continues, because another app can still cancel the session end (Microsoft: "Applications should not shut down when they receive WM_QUERYENDSESSION").

`pub fn release_block_reason()` (main thread only): if `REASON_ACTIVE.swap(false)` then `ShutdownBlockReasonDestroy(hwnd)`. Call it on ES(FALSE) (in `subclass_proc`) and at the end of the session-end Exit path.

### 3.2 Early checkpoint (non-destructive)
- `IncrementalAudioSaver::request_early_checkpoint(&mut self)`, in incremental_saver.rs next to `spawn_checkpoint_encode` (:217): `if !self.checkpoint_buffer.is_empty() { self.spawn_checkpoint_encode(); }`. It reuses the try_acquire path, so if an encode is already in flight it's a no-op and the buffer stays. A shorter checkpoint is harmless: concat copy, and `is_anomalous` (:62-67) doesn't look at durations.
- `RecordingSaver::incremental_saver_handle(&self) -> Option<Arc<AsyncMutex<IncrementalAudioSaver>>>` (clone of the field at recording_saver.rs:105) and `RecordingManager::incremental_saver_handle(&self)` (delegates to `self.recording_saver`, field at recording_manager.rs:29).
- `pub(crate) async fn request_early_checkpoint()` in recording_lifecycle.rs: lock `RECORDING_MANAGER` (std Mutex, :24) only long enough to clone the handle, drop the guard, then `handle.lock().await.request_early_checkpoint()`. Never hold the std guard across an await.

### 3.3 Session-end flush (new; no merge, no finalize, no emits)
`IncrementalAudioSaver::flush_for_session_end(&mut self, soft: Instant, hard: Instant) -> SessionEndAudio` (same `Instant` type as `FINALIZE_ENCODE_TIMEOUT` at :21/:293):
1. `self.acquire_encode_slot(soft, "session end")` (:257), which waits for the in-flight encode.
   - `Ok(permit)`: if the buffer is empty, drop the permit and return `SkippedEmpty`. Otherwise record `errs0 = encode_errors.load()`, take the buffer (`take_buffer_for_checkpoint`, :160) and `dispatch_checkpoint_encode(buf, permit)` (:175). Then use `acquire_encode_slot(hard, ..)` as a barrier, so the encode we started finishes. If it timed out, return `FinalTimedOut`. If `encode_errors > errs0`, remove `checkpoints_dir/audio_chunk_{checkpoint_count-1:03}.mp4` if it exists and return `FinalFailed`. Otherwise return `Written`.
   - `Err` (soft expired because the in-flight encode is slow): **don't** start a new encode (the tail is lost). Still wait `acquire_encode_slot(hard, ..)` so the in-flight file isn't truncated, then return `SkippedSlow`.
2. **Never** call `merge_checkpoints` or `remove_dir_all(checkpoints_dir)`. The checkpoints are the recovery source.

`RecordingSaver::flush_for_session_end(&mut self, soft, hard) -> SessionEndAudio`:
- Extract the writer-quiesce prelude of `stop_and_save` (recording_saver.rs:407-446: `is_saving=false`, cancel `writer_shutdown`, sleep 200 ms, join `writer_handle` with a timeout, early `write_transcripts_json`) into a private `async fn quiesce_writer_and_write_transcripts(&mut self, join_timeout: Duration)`. `stop_and_save` calls it with 5 s (unchanged behavior); the session-end path uses `min(1 s, remaining)`.
- Then `timeout_at(hard, saver_arc.lock())`, followed by `saver.flush_for_session_end(soft, hard)`. `NoSaver` if `incremental_saver` is None.
- Don't touch metadata.json, don't emit `RECORDING_SAVED`, don't clear the transcript store.

`RecordingManager::flush_for_session_end(&mut self, soft, hard)` delegates to `self.recording_saver`.

`pub async fn flush_recording_for_session_end(t0: Instant) -> SessionEndFlushReport` in recording_lifecycle.rs, next to `stop_recording_reporting` (:460):
1. `let gate = match StopGate::acquire() { Ok(g) => g, Err(_) => return NotRecording };` (recording_phase.rs:237-246; it handles both Recording and Paused).
2. `let batch = !transcription::engine::active_recording_uses_stt();` (as at :752).
3. Take the manager exactly as at :547-550.
4. `timeout_at(t0 + STREAM_STOP_BUDGET, manager.stop_streams_and_force_flush())` (recording_manager.rs:262-296). On timeout, `warn!` and continue.
5. `manager.flush_for_session_end(t0 + FINAL_ENCODE_SOFT, t0 + HARD_BUDGET).await`.
6. `std::mem::forget(gate)`: the phase **stays `Stopping`**. That way the scheduler can't restart during the last seconds, and `recover_orphans` in this dying process doesn't grab our own batch row (`is_orphan` with the same pid and `phase_idle=false` returns false, planner.rs:167-169). `std::mem::forget(manager)`: the process is ending, and Drop could join capture threads.
7. Deliberately **skipped**: the transcription wait, `live_feedback::stop`, `save_recording_only`, the batch `mark_pending` (the row stays `recording` and becomes an orphan at next boot, because the pid changes), `finalize_segment_native` / `close_scheduled` (so there's no SQLite save that could duplicate the unsaved IndexedDB WAL, and no `rearm_at = start_of_next_day`: after a reboot inside the jornada window, the jornada should restart; coordinate with B4), `app.emit`, `tray::update_tray_menu` and notifications.
8. Return `SessionEndFlushReport { was_recording, mode: "batch"|"streaming", audio: SessionEndAudio, elapsed_ms }` and log it in one `info!`. T2 may copy it into the app.exit payload.

### 3.4 Budgets (constants in session_end.rs, pure)
- `STREAM_STOP_BUDGET = 1500 ms`, `FINAL_ENCODE_SOFT = 2500 ms`, `HARD_BUDGET = 7000 ms` (all measured from Exit start `t0`), `DB_CLEANUP_BUDGET = 1000 ms`, `SIDECAR_BUDGET = 500 ms`.
- Typical total is about 1.5-4 s, under Windows' 5 s UI threshold. The worst case is about 8.5 s, and only happens when an encode that already started has to finish (with the reason string, Windows then shows "Maity: Guardando la grabación…"). That stays within the 30 s a critical shutdown allows.

### 3.5 Exit handler (lib.rs:1786-1824)
```rust
.run(|app, event| {
    if let tauri::RunEvent::Exit = event {
        let session_end = session_end::observed();
        if let Some(se) = session_end {
            log::info!("Exit por fin de sesión de Windows: {} (critical={})", se.kind.as_str(), se.critical);
            // T2 SLOT: marcador de ciclo de vida SÍNCRONO (std::fs) con reason = se.kind.exit_reason() — ANTES del flush,
            // para que un kill del SO a mitad del flush igual deje el motivo.
            let t0 = tokio::time::Instant::now();
            tauri::async_runtime::block_on(async {
                if crate::audio::recording_commands::is_recording().await {
                    let report = crate::audio::recording_lifecycle::flush_recording_for_session_end(t0).await;
                    log::info!("[session_end] flush: {:?}", report);
                }
                if let Some(st) = app.try_state::<state::AppState>() {
                    if tokio::time::timeout(session_end::DB_CLEANUP_BUDGET, st.db_manager.cleanup()).await.is_err() { log::warn!(...) }
                }
                let _ = tokio::time::timeout(session_end::SIDECAR_BUDGET, summary::summary_engine::force_shutdown_sidecar()).await;
            });
            session_end::release_block_reason(); // hilo principal: el que creó la ventana
            log::info!("Application cleanup complete (session end, {} ms)", t0.elapsed().as_millis());
            return;
        }
        // … camino actual SIN cambios (30 s graceful + cleanup + sidecar) …
    }
})
```
The `is_recording()` check is at recording_commands.rs:54-56. The non-session-end exits (tray Quit, rival_install, plugin-process exit, Store "Cerrar para actualizar") keep the existing path byte for byte.

### 3.6 What survives a session end with a recording (the recovery contract)
- **Batch mode**: the checkpoints on disk (all complete; the last one is written or removed), plus the `batch_queue` row in `recording` with our pid. At next boot, `startup_recovery` → `recover_orphans` → `Merge` → `mark_crash_recovery` → transcribe → finalize, once (planner.rs:249-274, :304-355). The IndexedDB record is batch, so it's treated as a ghost and deleted (useTranscriptRecovery.ts:120-133).
- **Streaming mode**: the IndexedDB WAL with the transcripts delivered so far, plus the checkpoints and transcripts.json. At next boot, after login, `autoRecoverAll` → `recover_audio_from_checkpoints` + `saveMeeting` (useTranscriptRecovery.ts:189-332). Loss compared with an ideal full stop: the chunks still queued in the transcription worker (already lost today, beyond the 30 s and Windows' kill). A known product difference: the recovered jornada segment skips `MIN_SEGMENT_WORDS`, as with any crash.

## 4. Commit (iii): recovery tolerates a truncated last checkpoint (safety net for (ii), power cuts and kills)
In incremental_saver.rs `recover_audio_from_checkpoints` (:512-613):
- Extract a pure `fn concat_list(files: &[PathBuf], drop_last: bool) -> String`.
- If `run_ffmpeg_concat` fails and `checkpoint_files.len() > 1`, rewrite `concat_list.txt` without the last (highest-numbered) file and retry once. On success, return `status: "partial"`, `chunk_count - 1`, and a message naming the dropped chunk. Keep the dropped file on disk; never delete it here.
- Callers already accept `partial`: planner.rs:349 and useTranscriptRecovery.ts (the status isn't gated).
- Don't change the 30 s interval or the `.mp4` extension (REGLAS_AUDIO_GRABACION.md § Checkpoints).

## 5. Contract with T2 (another subagent owns T2)
- `session_end::observed()` is read once, as the first statement of RunEvent::Exit.
- `exit_reason()` values are `logoff | os_shutdown | os_close_app | os_session_end`. Suggested extra payload fields: `session_end_critical: bool`, `session_end_source: "query"|"end"|"system_metric"`, `recording_flush: {mode, audio, elapsed_ms}`.
- The marker write must happen **before** the flush (the T2 slot in §3.5) and be synchronous (std::fs, as with panics.rs).
- MSIX update or uninstall of a running package almost certainly kills the process without QES/ES (deployment ForceApplicationShutdown; UNVERIFIED). There's no hook, and T2's `prev_exit_clean=false` plus a changed `prev_version` classifies it.

## 6. Docs (include in (ii))
- New section in `docs/REGLAS_AUDIO_GRABACION.md`: "Fin de sesión de Windows con grabación activa (B5 / #83)". Content: the thread map (§1), the rule that nothing inside `WM_ENDSESSION` may merge, finalize, emit or call a window getter, the budgets, `mem::forget(StopGate)` and why, the recovery contract (§3.6), the fact that QES never stops the recording, and **"no reintroducir el graceful de 30 s en fin de sesión"**.
- One bullet in CLAUDE.md under "Reglas obligatorias del área" (audio) pointing to it.

## Files to change
- `frontend/src-tauri/Cargo.toml` — Add windows 0.58 features "Win32_UI_WindowsAndMessaging" (commit i) and "Win32_System_Shutdown" (commit ii) to the list at :272-296, with comments. Edit tool only (the Bash guard blocks the word).
- `frontend/src-tauri/src/session_end.rs` — NEW. Pure: LP_* constants, SessionEndKind/Source/Info, classify_lparam, exit_reason/as_str, SessionEndCell (record/record_if_absent/clear/fresh with a 120 s TTL), budget constants. Windows: install() (SetWindowSubclass on main, id 0x4D414954), subclass_proc (QES records the kind and, in commit ii, registers the block reason and spawns the early checkpoint; ES(FALSE) clears and releases; ES(TRUE) records if absent; WM_NCDESTROY removes the subclass; always DefSubclassProc; catch_unwind), observed() with SM_SHUTTINGDOWN fallback, release_block_reason(). Non-Windows stubs. Unit tests.
- `frontend/src-tauri/src/lib.rs` — `pub mod session_end;` near :62. In setup, after the main-window hook (:922-949): `#[cfg(windows)] session_end::install(&main_window)`. Exit handler (:1786-1824): read observed() first (commit i: log only); in commit ii add a session-end branch with the T2 slot, flush_recording_for_session_end(t0), DB cleanup (1 s) and sidecar kill (0.5 s) under timeouts, release_block_reason(), return. The existing path is unchanged for every other exit.
- `frontend/src-tauri/src/audio/recording_lifecycle.rs` — Add `request_early_checkpoint()` (clone the saver handle out of RECORDING_MANAGER, then a non-blocking early checkpoint) and `flush_recording_for_session_end(t0) -> SessionEndFlushReport`: StopGate, take the manager, bounded stop_streams_and_force_flush, manager.flush_for_session_end, mem::forget of gate and manager. No emits, finalize, mark_pending or tray update.
- `frontend/src-tauri/src/audio/recording_manager.rs` — Add `incremental_saver_handle()` and `flush_for_session_end(soft, hard)`, both delegating to recording_saver (field at :29).
- `frontend/src-tauri/src/audio/recording_saver.rs` — Extract the writer-quiesce prelude of stop_and_save (:407-446) into a private helper used by stop_and_save (5 s join, same behavior) and by the new `flush_for_session_end(soft, hard)` (short join, early transcripts.json, IncrementalAudioSaver::flush_for_session_end; no metadata, emit or clear). Add `incremental_saver_handle()`.
- `frontend/src-tauri/src/audio/incremental_saver.rs` — Commit ii: `request_early_checkpoint()` (spawn_checkpoint_encode if the buffer is non-empty) and `flush_for_session_end(soft, hard) -> SessionEndAudio` (wait for in-flight; dispatch the final encode only if the slot was acquired before soft; barrier until hard; delete a failed partial last chunk; never merge or clean up). Commit iii: pure `concat_list(files, drop_last)` plus one retry without the last chunk in recover_audio_from_checkpoints, returning status 'partial'.
- `docs/REGLAS_AUDIO_GRABACION.md` — New section 'Fin de sesión de Windows con grabación activa': thread map, forbidden operations inside WM_ENDSESSION, budgets, forget(StopGate), recovery contract, 'no reintroducir el graceful de 30 s'. Commit iii adds a line to § Checkpoints about tolerating a truncated last checkpoint.
- `CLAUDE.md` — One bullet in the audio 'Reglas obligatorias del área' paragraph pointing to the new REGLAS section (commit ii).

## Commits
- **feat(salida): detectar el tipo de fin de sesión de Windows (cierre de sesión, apagado, Restart Manager) para la telemetría de salida**
  Cargo.toml: + Win32_UI_WindowsAndMessaging. New session_end.rs: pure classifier, SessionEndCell with TTL, subclass on the main HWND installed in setup() (records QES, clears on ES(FALSE), record_if_absent on ES(TRUE), removes itself on WM_NCDESTROY, always DefSubclassProc), observed() with SM_SHUTTINGDOWN fallback. lib.rs: pub mod, install() in setup, observed() read and logged at the start of RunEvent::Exit (no behavior change). Unit tests for classify_lparam, exit_reason and the cell. Write the body with git commit -F (it names ShutdownBlock*/Win32_System_*). Refs #83.
- **fix(grabacion): el apagado o cierre de sesión de Windows ya no queda bloqueado 30 s guardando; flush corto y recuperación al arrancar** (deps: feat(salida): detectar el tipo de fin de sesión de Windows (cierre de sesión, apagado, Restart Manager) para la telemetría de salida)
  Backup branch first (Guardian). Cargo.toml: + Win32_System_Shutdown. session_end.rs: ShutdownBlockReasonCreate at QES when recording (returns TRUE, does not veto), release on ES(FALSE) and at the end of Exit, early non-destructive checkpoint spawned at QES, budget constants. incremental_saver/recording_saver/recording_manager/recording_lifecycle: request_early_checkpoint and flush_for_session_end (no merge, finalize, mark_pending or emit; StopGate and manager forgotten). lib.rs: session-end branch in RunEvent::Exit with the T2 slot before the flush, DB and sidecar under timeouts. Docs: REGLAS_AUDIO_GRABACION.md section plus CLAUDE.md bullet. Tests. Refs #83.
- **fix(grabacion): la recuperación de checkpoints tolera un último checkpoint truncado**
  incremental_saver.rs: pure concat_list(files, drop_last); recover_audio_from_checkpoints retries once without the last chunk when the concat fails and returns status 'partial' (the file is kept on disk). This covers session-end kills, power cuts and forced kills in both the planner orphan path and autoRecoverAll. Unit test for concat_list; ignored ffmpeg integration test. One line in REGLAS_AUDIO_GRABACION.md § Checkpoints. Refs #83.

## Tests
- frontend/src-tauri/src/session_end.rs #[cfg(test)]: classify_lparam table: 0 → (SystemPowerOff,false); 0x80000000 → (Logoff,false); 0x1 → (CloseApp,false); 0x40000000 → (SystemPowerOff,true); 0xC0000000 → (Logoff,true); 0x40000001 → (CloseApp,true); 0x80000001 → CloseApp takes precedence. exit_reason strings pinned (logoff/os_shutdown/os_close_app/os_session_end).
- frontend/src-tauri/src/session_end.rs #[cfg(test)]: SessionEndCell on a local instance (not the static): record then fresh returns Some; record_if_absent does not overwrite a QueryEndSession record; clear then fresh returns None; fresh returns None once older than RECORD_TTL (inject `now`).
- frontend/src-tauri/src/session_end.rs #[cfg(all(test, windows))]: LP_CLOSEAPP/LP_CRITICAL/LP_LOGOFF equal windows::Win32::UI::WindowsAndMessaging::ENDSESSION_*; message ids 17/22/130 equal WM_QUERYENDSESSION/WM_ENDSESSION/WM_NCDESTROY (guards against constant drift).
- frontend/src-tauri/src/session_end.rs #[cfg(test)]: Budget invariants: STREAM_STOP_BUDGET < FINAL_ENCODE_SOFT < 5 s (Windows UI threshold) < HARD_BUDGET; HARD_BUDGET + DB_CLEANUP_BUDGET + SIDECAR_BUDGET < 30 s (critical-shutdown ES allowance).
- frontend/src-tauri/src/audio/incremental_saver.rs #[cfg(test)] (no ffmpeg, same style as the existing hold-the-permit test): flush_for_session_end holding the semaphore permit by hand with a soft deadline of ~50 ms and hard ~100 ms: returns SkippedSlow, buffer length and checkpoint_count unchanged, no concat_list.txt or audio.mp4 created, .checkpoints/ untouched. With an empty buffer it returns SkippedEmpty and checkpoint_count is unchanged. request_early_checkpoint with an empty buffer is a no-op; with the permit held it is a no-op and the buffer is preserved.
- frontend/src-tauri/src/audio/recording_saver.rs #[cfg(test)]: stop_and_save behavior unchanged after extracting the quiesce helper: the existing tests (transcripts.json not truncated by the posthumous writer tick, ~:718-790) still pass.
- frontend/src-tauri/src/audio/incremental_saver.rs #[cfg(test)] (commit iii): concat_list(files, false) lists all files in order with `file '...'` lines; concat_list(files, true) omits exactly the last one. #[ignore] integration test (needs ffmpeg on PATH): 3 checkpoints with the last truncated to half its bytes; recover_audio_from_checkpoints returns 'partial' with chunk_count 2 and a playable audio.mp4.
- frontend/src-tauri/src/audio/transcription/batch/planner.rs (existing): is_orphan_tabla (:760-774) already pins 'own row, not Idle' → not an orphan and 'other process' → orphan, which is the guarantee (ii) relies on. Run it; no change needed.
- build: `cd frontend && pnpm run tauri:build:debug` exit 0 before each commit; `cargo test -p maity-desktop session_end incremental_saver recording_saver planner` green.

## Risks
- The hidden main window might not receive WM_QUERYENDSESSION, so the kind isn't recorded and the block reason isn't registered. → observed() falls back to GetSystemMetrics(SM_SHUTTINGDOWN) (kind Unknown) and the short-budget path still runs. The E2E checks the '[session_end] WM_QUERYENDSESSION' log line on both NSIS and MSIX. If it's missing, consider subclassing another always-alive top-level window.
- Starting a stop at QES would kill the recording when another app (Notepad with unsaved text) cancels the session end. → QES is non-destructive: only the kind, the reason string and an early checkpoint via try_acquire. The stop happens only in RunEvent::Exit, which tao fires only on ES(TRUE). ES(FALSE) clears the state and destroys the reason.
- A stale reason string or kind after a canceled session end (Microsoft warns about stale strings). → release_block_reason on ES(FALSE); a 120 s TTL on the recorded kind; ShutdownBlockReasonCreate only while recording.
- The OS terminates us in the middle of the final checkpoint encode, leaving a truncated mp4 that fails the whole recovery concat. → The final encode is dispatched only if the slot was acquired before the soft deadline, and we wait for it (hard 7 s) with the reason string registered, which gives 30 s even under a critical shutdown. A failed encode's file is deleted. Commit (iii) makes recovery retry without the last chunk.
- Duplicate meeting (native save plus IndexedDB auto-recovery) if a finalize ran at session end. → The session-end path never calls finalize_segment_native or close_scheduled. Streaming relies solely on the IndexedDB WAL; batch relies solely on the orphan queue.
- Deadlock: something inside the flush needs the main thread (window getter or run_on_main_thread) while block_on holds it. → The path makes no emits, getters, tray updates or toasts; every step is under timeout_at. stop_streams_and_force_flush is bounded to 1.5 s.
- mem::forget(StopGate) leaves the phase stuck in Stopping if the session end didn't actually end the process. → This path only runs inside RunEvent::Exit, after LoopDestroyed, which can't be undone (runner.rs:371 panics on leaving Destroyed). The process is ending by definition.
- Conflict with T2 and B4 edits to the same Exit handler and scheduler state. → Merge (i) first; T2 fills the marked slot before the flush. The session-end path must not persist 'closed for today' (tell B4).
- The Bash guard blocks commands and commit messages containing the blocked word (Cargo feature and function names). → Use Edit/Grep for those files, and `git commit -F <file>` for bodies that mention them.
- Streaming jornada segments recovered via autoRecoverAll bypass MIN_SEGMENT_WORDS and the jornada naming or notification path. → Same as today's crash recovery; documented in REGLAS. Acceptable versus losing the segment or duplicating it.

## Manual verification
- Build debug (`pnpm run tauri:build:debug`), install the NSIS debug build, log in, start a MANUAL streaming recording, talk about 2 min, then sign out of Windows (Ctrl+Alt+Del > Cerrar sesión). Expect no 'apps preventing sign-out' screen, or only briefly with 'Guardando la grabación de Maity…'. The app log shows '[session_end] WM_QUERYENDSESSION kind=logoff critical=false recording=true', 'Exit por fin de sesión', '[session_end] flush: … audio=Written … elapsed_ms<5000' and 'cleanup complete (session end, N ms)' with N<5000. Sign back in and launch or autostart: the 'Reunión recuperada' toast appears, the meeting has transcripts and audio.mp4, there is exactly one meeting, and .checkpoints is cleaned by recovery.
- Batch build (MAITY_PILOT_BATCH=1 or the batch preference) with the jornada enabled inside its window: restart Windows during a segment. Next boot: the log shows '[batch-planner] fila N huérfana … recuperando' and then 'recuperado de checkpoints'; the segment is transcribed and saved once; a new jornada segment starts (inside the window). No duplicate in Conversaciones.
- Cancel path: start a recording, open Notepad with unsaved text, choose Reiniciar, then press Cancelar on the Windows blocking screen. Maity keeps recording (tray and widget still recording, new checkpoints keep appearing); the log shows 'WM_ENDSESSION(FALSE) … cancelado'. A later tray Quit exits through the normal 30 s graceful path with reason tray_quit, not os_shutdown.
- Sign out with nothing recording: the log shows kind=logoff and the exit completes in about 1 s; no reason string shown.
- Aggressive fleet config: set HKCU\Control Panel\Desktop AutoEndTasks=1 and repeat the manual-recording sign-out. Recovery still works; at most the final tail is lost; no failed recovery (commit iii covers a truncated last chunk).
- Critical or forced: from a user-opened cmd, run the forced restart command with /f /t 0 (type it yourself; the tooling guard blocks that word). Next boot: recovery succeeds; the log shows either kind with critical=true or source=system_metric.
- MSIX: package locally (/store-msix local test) and repeat the first step to confirm the subclass and messages work under package identity.
- Timing: compare the log timestamps from 'Application exiting' to 'cleanup complete' before and after the change (before: up to 30+ s blocked while recording).

## Open questions
- T2 naming: accept the exit_reason values logoff | os_shutdown | os_close_app | os_session_end (the issue listed os_shutdown|logoff only)? And should the flush report go into the app.exit payload?
- Should a jornada segment recovered from IndexedDB after a session end keep the MIN_SEGMENT_WORDS discard rule (needs a frontend change in autoRecoverAll), or is crash-style recovery acceptable?
- Register RegisterApplicationRestart so Windows 11's 'restart apps after sign-in' relaunches Maity after Windows Update reboots? That would overlap with autostart and T3; out of scope unless requested.
- Longer term: encode checkpoints to a temporary name plus an atomic rename, instead of relying on the recovery retry in commit iii? This touches the guarded checkpoint area (#08/#18), so it's a product/owner decision.

## Unverified
- That the hidden (tray) main window receives WM_QUERYENDSESSION and WM_ENDSESSION. Expected from the top-level-window semantics; not tested on this machine.
- Whether Windows counts tao's 0x0 layered WS_VISIBLE thread-target window as a 'visible top-level window'. This decides whether an over-budget app gets the UI after 5 s or is terminated at 5 s when no reason string is registered.
- How MSIX update or uninstall of a running package (and the Store StoreContext install) closes Maity. Likely a forced termination without QES/ES (secondary sources on ForceApplicationShutdown), so B5 does not apply there.
- That ffmpeg's concat demuxer fails, rather than skipping, on a truncated +faststart mp4, and that the ffmpeg child survives until we return from WM_ENDSESSION.
- That the duplicate-meeting risk in today's session-end path happens in practice. Inferred from event delivery while the main thread is blocked; not reproduced.
- AutoEndTasks, WaitToKillAppTimeout (20 s) and HungAppTimeout (5 s) defaults on Windows 11: from third-party sources (Tom's Hardware, ElevenForum), not Microsoft docs.
- That comctl32 calls the most recently installed subclass first. Irrelevant to correctness because both procs chain through DefSubclassProc.
- That calling ShutdownBlockReasonCreate twice (repeated QES) simply updates the string. Guarded with the REASON_ACTIVE flag anyway.
- That stop_streams_and_force_flush does no main-thread-synchronous calls. Bounded by a 1.5 s timeout regardless.
- The SetWindowSubclass cross-thread and WM_NCDESTROY removal rules were taken from memory of the SetWindowSubclass reference, which was not fetched; the removal pattern matches tao event_loop.rs:2323-2327.