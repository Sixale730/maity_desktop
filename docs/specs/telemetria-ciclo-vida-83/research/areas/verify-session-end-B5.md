# Verdict: needs_changes

## Issues
- [major] classify_lparam: a lParam with ENDSESSION_CLOSEAPP means Restart Manager ('os_close_app'), and it takes precedence over LOGOFF.
  - Evidence: ExitWindowsEx docs (learn.microsoft.com, fetched): 'EWX_RESTARTAPPS ... Shuts down the system and then restarts it ... These application[s] receive the WM_QUERYENDSESSION message with lParam set to the ENDSESSION_CLOSEAPP value.' So a whole-system restart (Windows Update restarts typically use restart-apps) can arrive as CLOSEAPP. The spec would then record reason=os_close_app for a PC reboot, and T5's SQL would put that day in the wrong bucket instead of 'PC off'.
  - Fix: Tell the two apart with GetSystemMetrics(SM_SHUTTINGDOWN), read in the QES handler and again in observed(). CLOSEAPP with SM_SHUTTINGDOWN != 0 means the session or system is ending: map it to os_shutdown, or to logoff when the LOGOFF bit is set, and keep a close_app=true field. CLOSEAPP with SM_SHUTTINGDOWN == 0 is a real Restart Manager close (os_close_app). Add both cases to the classify tests, which then take (lparam, shutting_down).
- [major] 'mem::forget(StopGate) ... the phase stays Stopping' is enough to keep the scheduler from acting during the last seconds. The session-end path writes no rearm_at, so after a reboot inside the window the jornada restarts.
  - Evidence: The scheduler loop keeps running on tokio workers while the main thread sits in block_on. evaluate_tick reads `is_rec = is_recording_active_fn()` (service.rs:513), which is false in Stopping (recording_lifecycle.rs:47-48). In branch (true, Some(_)) it then runs `*shared.rearm_at.write().await = Some(schedule::next_hour_boundary(now)); shared.owned.store(false..)` and returns RearmingNextHour (service.rs:686-692). In branch (false, Some) it tries to start; StartGate fails with 'still stopping' (recording_phase.rs:184-185), which feeds record_start_failure / back-off. Today that state is in memory only. B4 is about to persist rearm and back-off, and would then write 'rearm next hour' or a back-off to disk, so the jornada would not restart after the reboot. A rotation already in flight (phase Stopping → drop(stop_gate) → Idle) can also START a new segment during Exit. That leaves a new batch row with our pid and zero checkpoints, which the planner marks fail_permanent('recovery_none') (planner.rs:335-337) as a visible failed item.
  - Fix: Add `session_end::SESSION_ENDING: AtomicBool`, set as the first statement of the session-end Exit branch. That branch is irreversible, which is not true of QES. The scheduler tick returns early without mutating shared state when it is set. The start funnel (initialize_recording / StartGate callers) refuses to start while it is set. B4's persistence writer must skip writes while it is set. Add a unit test on evaluate_tick with the flag set.
- [major] Risk mitigation: 'This path only runs inside RunEvent::Exit, after LoopDestroyed ... The process is ending by definition.'
  - Evidence: For a plain Restart Manager close (CLOSEAPP while SM_SHUTTINGDOWN == 0) Windows does not kill the process after WM_ENDSESSION returns. tao keeps pumping: run_return's GetMessageW loop (event_loop.rs:255-280) only breaks on ExitWithCode, and loop_destroyed has already moved the runner to Destroyed. The next event that goes through runner.send_event → move_state_to (runner.rs:224) hits `(Destroyed, _) => panic!("cannot move state from Destroyed")` (runner.rs:371) inside an extern "system" wndproc, which aborts the process. The other outcome is a zombie that keeps running with capture stopped, the manager forgotten and the phase stuck in Stopping. Either way panics.rs records a spurious app.error at next boot, and T2 would see prev_exit_clean=false. This part of tao is pre-existing; the spec's fast path makes the zombie state worse (the StopGate is forgotten).
  - Fix: At the end of the session-end branch, when the process is not guaranteed to be killed (kind CloseApp and SM_SHUTTINGDOWN == 0), call `app.cleanup_before_exit()`, flush the logger and `std::process::exit(0)` instead of returning into a Destroyed loop. The alternative for CloseApp is to skip mem::forget and run the normal graceful path, since RM gives no 5 s kill. Document which option was chosen. Whether RM sends WM_CLOSE afterwards is UNVERIFIED.
- [major] 'stop_streams_and_force_flush is bounded to 1.5 s regardless' and 'every step is under timeout_at'.
  - Evidence: block_on polls the future on the main thread, and tokio's timeout_at can only fire at an .await. stop_streams_and_force_flush calls the synchronous `self.stream_manager.stop_streams()` (recording_manager.rs:280), which does cpal `stream.pause()` + `drop(stream)` (stream.rs:320-333; the cpal WASAPI drop joins its thread). The flush also takes the std Mutex RECORDING_MANAGER.lock() on the main thread. A slow driver or a contended lock blocks the main thread with no bound, inside WM_ENDSESSION, which is the exact B5 symptom.
  - Fix: Run the whole flush with `tauri::async_runtime::spawn(flush_recording_for_session_end(t0))` and do `block_on(tokio::time::timeout_at(hard, join_handle))` on the main thread. Synchronous blocking then happens on a worker, and the main-thread wait is really bounded. Drop the '1.5 s regardless' wording from the spec, the docs and the unverified list.
- [major] Budgets: 'The worst case is about 8.5 s ... within the 30 s a critical shutdown allows' (HARD_BUDGET 7 s, plus a test pinning HARD_BUDGET > 5 s).
  - Evidence: The 30 s / 'as long as needed' allowance in the spec's own evidence requires a registered reason string or a visible top-level window. The reason is registered only in the QES handler. When no QES is observed on main, nothing is registered: ExitWindowsEx docs (fetched) say 'EWX_FORCE ... the system does not send the WM_QUERYENDSESSION message', and the same applies if the hidden main window misses it (listed as unverified). Main is usually hidden in the tray, and whether tao's 0x0 WS_VISIBLE target counts as visible is UNVERIFIED. So the spec's own rule of '5 s and then terminated' applies, and an ~8.5 s path gets killed mid-encode or mid-cleanup.
  - Fix: Make the budget adaptive. If observed().source != QueryEndSession or the reason is not active, use a total budget of about 4 s (for example STREAM 1 s / SOFT 1.5 s / HARD 3 s / DB 0.5 s / sidecar 0.3 s). Try ShutdownBlockReasonCreate at the start of the Exit branch; this is legal on the main thread, but whether it extends the ES allowance is UNVERIFIED. Change the budget test to assert the no-reason total < 5 s.
- [major] Registering ShutdownBlockReasonCreate at QES and returning TRUE gives extra time and shows the UI only if we go past 5 s ('Expect no "apps preventing sign-out" screen, or only briefly').
  - Evidence: The ShutdownBlockReasonCreate reference (fetched) says it 'Indicates that the system cannot be shut down and sets a reason string to be displayed' and that it should be called 'as they begin an operation that cannot be interrupted'. Nothing there says a registered reason plus TRUE avoids the blocking screen. If Windows lists every app with an active reason, every shutdown during a jornada would show the full-screen 'Maity is preventing shutdown' UI. Pilot users would then click 'Shut down anyway', which terminates immediately and turns B5 into a worse, user-visible regression. The usage-model-3 claim comes from a legacy Vista page and is not re-verified for Windows 11. UNVERIFIED either way.
  - Fix: Move the reason-string work into its own commit and gate it (a const or setting). Run the logoff/restart E2E on Windows 11, both NSIS and MSIX, with and without the reason, before enabling it. If the screen appears every time, register the reason only when the flush is expected to exceed the budget, or drop it and rely on the adaptive fast path.
- [minor] Exit branch: `if is_recording().await { flush }`. Any other phase is treated as not recording, and then DB cleanup runs with a 1 s budget.
  - Evidence: is_recording() is Recording|Paused only (recording_commands.rs:54-56). A normal stop or a jornada rotation already in flight is in Stopping, running stop_recording_reporting / close_scheduled on workers (transcription wait up to 120 s, merge, finalize_segment_native). The fast path skips it and then closes the pool (db_manager.cleanup()) under that finalize or mark_pending. That can turn a finalize that would have committed into a failed write, with Windows killing the process right after.
  - Fix: If current_phase() == Stopping at Exit, skip db cleanup, or wait bounded for the phase to reach Idle within the same small budget. Document that an in-flight stop is left to next-boot recovery (orphan pass / autoRecoverAll).
- [minor] The early checkpoint at QES is harmless and reduces tail loss.
  - Evidence: Only one encode runs at a time (encode_slots Semaphore(1), incremental_saver.rs:94,133). ES usually follows QES within milliseconds to seconds, and encodes take 1-4 s on loaded machines (:167-169). The early encode then holds the slot when flush_for_session_end runs acquire_encode_slot(soft = t0+2.5 s), so the final encode is often skipped (SkippedSlow). The early checkpoint mostly moves the loss from 'last checkpoint to Exit' to 'QES to Exit', and it pushes a HARD_BUDGET-length wait onto the main-thread path. The README estimate (`chunks * 30`, :557) also becomes less accurate; that part is harmless.
  - Fix: Keep the early checkpoint, but have the Exit fast path skip the barrier wait when the in-flight encode is the early one and the remaining buffer is small (for example under 2 s of audio). Or skip the early checkpoint when the buffer holds under about 5 s. Record the case in SessionEndAudio.
- [minor] docs/REGLAS_AUDIO_GRABACION.md § Recuperación ('Pendiente conocido ... posible duplicado del que Rust ya guardó') is cited as evidence of a session-end duplicate risk.
  - Evidence: REGLAS_AUDIO_GRABACION.md:76 is about the rotation race in markMeetingAsSaved/sessionStorage, not about event delivery while the main thread is blocked at session end. The session-end duplicate stays inferred.
  - Fix: Cite line 76 as an analogous race only, and keep the session-end duplicate marked UNVERIFIED/inferred.
- [minor] Test: 'Budget invariants: ... FINAL_ENCODE_SOFT < 5 s (Windows UI threshold) < HARD_BUDGET'.
  - Evidence: This test pins the design to always allow going past the 5 s no-reason kill threshold (see the budget issue above).
  - Fix: Replace it with two invariants: total budget with reason < 30 s, and total budget without reason < 5 s.

## Confirmed claims
- tao 0.35.2 does not handle WM_QUERYENDSESSION (only a comment at event_loop.rs:2382-2383). WM_ENDSESSION with wParam TRUE calls loop_destroyed() and returns LRESULT(0) (event_loop.rs:2384-2392); lParam is dropped.
- loop_destroyed moves the runner to Destroyed and calls Event::LoopDestroyed (runner.rs:238-240, :338-340). tauri-runtime-wry maps it to RunEvent::Exit (lib.rs:4192-4194), and tauri then calls callback plus cleanup_before_exit (app.rs:1422-1428). Any later transition out of Destroyed panics (runner.rs:371).
- EventLoop::run calls process::exit only after run_return's GetMessage loop breaks (event_loop.rs:225-231, 255-287). The loop does not break on the Destroyed state.
- The current Exit handler (lib.rs:1786-1824) runs graceful_shutdown_before_exit under a 30 s timeout, then db_manager.cleanup() and force_shutdown_sidecar() with no timeout, all inside block_on on the main thread.
- stop_recording_reporting waits up to 120 s for the transcription task (recording_lifecycle.rs:603-663) before save_recording_only under 300 s (:701-704). FINALIZE_ENCODE_TIMEOUT is 300 s (incremental_saver.rs:21).
- send_user_message handles the message inline on the main thread and otherwise goes through proxy.send_event; getter! blocks on rx.recv() (tauri-runtime-wry lib.rs:196-204, 235-254). So window.hwnd() from setup() on the main thread is fine.
- StopGate::acquire handles both Recording and Paused, and Drop always does Stopping→Idle (recording_phase.rs:237-258). mem::forget therefore does keep the phase in Stopping, and is_session_active() is false in Stopping (:61-63).
- RECORDING_MANAGER is a std Mutex<Option<RecordingManager>> taken with .take() (recording_lifecycle.rs:547-550). RecordingSaver.incremental_saver is Option<Arc<AsyncMutex<IncrementalAudioSaver>>> (recording_saver.rs:105). The stop_and_save quiesce prelude is at :407-446.
- IncrementalAudioSaver's single-permit semaphore, try_acquire in spawn_checkpoint_encode (:217-253), acquire_encode_slot with a deadline (:257-266), and dispatch_checkpoint_encode naming the file from checkpoint_count before incrementing it (:175-179) are as the spec describes, so deleting audio_chunk_{count-1} on failure picks the right file.
- encode_args uses -movflags +faststart and writes directly to the checkpoint path (encode.rs:71-75). recover_audio_from_checkpoints filters only by .mp4 and returns status 'failed' when the concat fails (incremental_saver.rs:534-611). planner.rs:349 accepts 'partial'.
- is_orphan(row_pid, my_pid, phase_idle) = row_pid != Some(my_pid) || phase_idle (planner.rs:167-169), and recover_orphans runs in every loop wake-up (planner.rs:219-231). A row with our own pid in Stopping is skipped.
- useTranscriptRecovery treats transcriptionMode==='batch' records and records with transcriptCount===0 as ghosts (useTranscriptRecovery.ts:120-133). recoverMeeting runs recover_audio_from_checkpoints + saveMeeting + markMeetingSaved + cleanup_checkpoints without gating on status (:189-294).
- windows 0.58 features: Win32_UI_Shell_PropertiesSystem implies Win32_UI_Shell (windows Cargo.toml:731). Win32_System_Shutdown (:670) and Win32_UI_WindowsAndMessaging (:734) are not in frontend/src-tauri/Cargo.toml:272-296.
- store_update.rs:78-92 already converts tauri's HWND into windows 0.58's HWND.
- EWX_FORCE: 'the system does not send the WM_QUERYENDSESSION message' (ExitWindowsEx docs; the doc adds the flag has no effect if terminal services is enabled).
- ShutdownBlockReasonCreate must be called from the thread that created the HWND (Remarks, fetched).

## Corrected design notes
Keep the three-commit structure. Commit (i) needs only the classifier fix; commit (ii) is where most of the changes land.

1. Classification (commit i). `classify(lparam, shutting_down: bool)`:
   - CLOSEAPP with shutting_down → system/session end: Logoff if the LOGOFF bit is set, else SystemPowerOff, with a `close_app: true` flag.
   - CLOSEAPP without shutting_down → CloseApp (a real Restart Manager close).
   - Otherwise the current rules apply.
   - Read SM_SHUTTINGDOWN in the QES/ES handlers and again in observed().
   - Pin the table in tests, including 0x1 with shutting_down=true → os_shutdown.

2. SESSION_ENDING flag (commit ii). Add `AtomicBool` in session_end, set as the FIRST statement of the session-end Exit branch, never at QES.
   - The scheduler tick returns early without touching rearm_at, owned or start_backoff while it is set.
   - initialize_recording / StartGate callers refuse to start while it is set.
   - B4's persistence skips while it is set.
   - Without this, service.rs:686-692 writes 'rearm next hour' during the flush, and a rotation in flight can start a new segment.

3. Main-thread bound. Do `let h = tauri::async_runtime::spawn(flush_recording_for_session_end(t0)); block_on(timeout_at(budget.hard, h))`.
   - Synchronous cpal drops (stream.rs:320-333) and the std RECORDING_MANAGER lock then run on a worker, and the main thread really waits at most `hard`.
   - Put DB cleanup and the sidecar kill each in their own spawn plus a timeout.

4. Adaptive budgets.
   - With reason active and QES observed: STREAM 1.5 / SOFT 2.5 / HARD 7 / DB 1 / SIDECAR 0.5 s.
   - Otherwise: a total of about 4 s (for example 1 / 1.5 / 3 / 0.5 / 0.3).
   - Tests: total with reason < 30 s; total without reason < 5 s.

5. Reason string in its own commit and gated. Do an E2E on Windows 11 (NSIS and MSIX) to learn whether a registered reason makes Windows show the blocking screen on every shutdown. If it does, register it only when the budget will be exceeded, or don't register it.

6. Termination.
   - CloseApp without shutting_down: after the fast path, call `app.cleanup_before_exit(); flush logs; std::process::exit(0)` instead of returning into tao's Destroyed loop. Returning risks the runner.rs:371 panic/abort, a spurious app.error and a zombie with the phase stuck in Stopping. Alternatively, send CloseApp through the normal graceful path, since RM imposes no 5 s kill.
   - Real session ends: returning is fine.

7. Phase Stopping at Exit (a stop or rotation in flight): skip or delay db cleanup (don't close the pool under a finalize) and leave that segment to next-boot recovery. Log it.

8. Early checkpoint. Skip it when the buffer holds under about 5 s. In flush_for_session_end, when the in-flight encode is the early one and the leftover buffer is under about 2 s, don't wait on the barrier past soft.

9. Unchanged from the spec:
   - no emits, getters or tray updates on the fast path;
   - no merge, finalize or mark_pending;
   - mem::forget of gate and manager (safe only together with item 6);
   - commit (iii), the drop-last concat retry returning 'partial'.

10. Docs.
   - The REGLAS section must state the SESSION_ENDING invariant and the spawn+timeout rule ("never run blocking stop code directly inside block_on in WM_ENDSESSION").
   - Cite REGLAS line 76 only as an analogous race.

11. Manual verification. Add:
   - a Windows-Update-style restart (restart-apps / CLOSEAPP while shutting down) checking reason=os_shutdown;
   - a jornada-in-window reboot checking that the scheduler did not write a rearm and that the jornada restarts immediately after boot.