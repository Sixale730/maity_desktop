# Verdict: needs_changes

## Issues
- [blocker] "All three close_scheduled exit paths set rearm_at = start_of_next_day" are auto-close, so L810/841/899 get `RearmCause::AutoClose`. The spec also tells the B4 owner to persist `Rearm` as-is.
  - Evidence: close_scheduled has a second caller that is not auto-close. service.rs:393-407 `close_owned_segment_for_exit` calls `close_scheduled(app, &self.shared, &settings, since, now).await`. That is invoked from lib.rs:1838-1840 `graceful_shutdown_before_exit`, which runs on logout_cleanup (lib.rs:157-161), tray quit (tray.rs:69), RunEvent::Exit (lib.rs:1795, which also covers the Windows power-off path of B5) and rival_install.rs:78. Every one of these sets rearm_at = start_of_next_day at service.rs:810/841/899. Under the spec they would all be tagged AutoClose. Logout mid-jornada followed by a re-login in the window would then show 'La jornada de hoy ya se cerró' and heartbeat idle_reason='closed_for_day', and the jornada would be suppressed for the rest of the day, including for a different user logging in on the same PC. If B4 persists this Rearm as the spec suggests, a reboot or tray-quit at 11:00 would suppress recording for the whole remaining day after restart. That is a missed-recording (data loss) regression.
  - Fix: Add a trigger parameter to close_scheduled, for example `enum CloseTrigger { AutoClose, AppExitOrLogout }`, passed from evaluate_tick (L547) and from close_owned_segment_for_exit (L405). Only AutoClose writes `Rearm{cause: AutoClose}`. AppExitOrLogout should leave rearm unset, or use a distinct non-persisted cause. Also clear any rearm on logout so the next user is not affected. Tell the B4 owner explicitly: never persist a rearm produced by an exit path, and add a test that the exit trigger does not produce AutoClose.
- [major] B3 is visible only when auto_close_time falls before the window's end_time. The night-shift suppression is pre-existing and out of scope, and the new message 'se reanudará en tu siguiente horario' is correct.
  - Evidence: Night window 22:00-06:00. The default auto_close for this window is derived as '06:00' (settings.rs derive_auto_close_time). Hourly rotation resets owned_since, so auto_close_at(Tue 05:00,'06:00') = Tue 06:00 (schedule.rs:126-135). The close at Tue 06:00 sets rearm = Wed 00:00 (service.rs:714-718, 899). 06:00 is outside the half-open window, so the idle arm keeps the rearm (L672-675, now < until). At Tue 22:00, a listed day, the in-window arm hits the rearm (L599-602). Today that toasts 'siguiente hora en punto'. With the spec it would toast 'se reanudará en tu siguiente horario' and heartbeat 'closed_for_day', yet 22:00 IS the next horario, and recording only resumes at 00:00. So night-shift users with default settings lose 2 h every night, and they get a wrong message both before and after the fix.
  - Fix: In the same B3 commit, compute the AutoClose deadline from the schedule instead of midnight: `until = schedule::next_fire_at(now, settings).unwrap_or(start_of_next_day(now))`. next_fire_at returns the first window start strictly after now (schedule.rs:139-172). This keeps day-shift behaviour (tomorrow 09:00 vs midnight: equivalent) and fixes night shifts, and the 'siguiente horario' message becomes true. Add a table test covering a 22:00-06:00 window. Also align the ScheduledRecordingSettings.tsx hint, which currently says 'hasta el día siguiente' and would be wrong for night shifts.
- [major] idle_reason maps skip `TranscriptionNotReady` to `transcription_not_ready`, and backoff kind Other to `start_backoff`/'other', aligned with recording_start_failed codes
  - Evidence: TranscriptionNotReady is produced for every StartFailureKind::Other (service.rs:167-173, record_start_failure returns kind.skip_reason() at L1761). Other is every AudioStartError except MicNotFound and MicPermissionDenied (service.rs:157-163). That includes MicInUse ('mic_in_use', device_errors.rs:93), MicFormatUnsupported and Unknown. So a mic held exclusively by another app would be reported in telemetry as 'transcription_not_ready'. ONBOARDING_Y_GATES.md:18 documents exactly this pathology ('etiquetaba todo Err como TranscriptionNotReady — una razón equivocada que además se auto-justificaba'). The issue's acceptance class 'no mic/permission' would miss mic_in_use.
  - Fix: Store the classified AudioStartError code in StartBackoff, for example a `code: &'static str` from classify_device_error(raw).code() in record_start_failure. Expose it as backoff.code in JornadaTelemetry. In idle_reason, map TranscriptionNotReady and Other to `start_failed:<code>` or to a separate closed value set (mic_in_use, mic_format_unsupported, audio_unknown, start_failed_other). Never emit `transcription_not_ready` unless the error really is the engine.
- [minor] The idle_reason table puts `skip StartBackoff → start_backoff` before the backoff-kind rows
  - Evidence: While MicAccessDenied escalates (attempts 1-4, 60/120/300/900 s ≈ 23 min, service.rs:136, 208-214), check_start_backoff returns SkipReason::StartBackoff and not the kind (L1676-1681). The table therefore reports `start_backoff` for about 23 minutes before switching to mic_permission_denied. Per-beat classification of permission problems is diluted.
  - Fix: When skip == StartBackoff and a backoff is present, return the backoff kind's code (mic_permission_denied / mic_not_found / the code of the other issue). Keep `start_backoff` only when no kind is known.
- [minor] The jornada.settings_changed diff guard compares against the in-memory settings read before save, and the resulting events are exact
  - Evidence: Both callers hold only the OUTER read() (commands.rs:41, 56), and read guards are shared. So set_scheduled_recording_settings and markConfigured / setEnabled can run update_settings concurrently. `old` can be stale, which can duplicate or merge diffs. Separately, publish_settings runs before the loop's UpdateSettings clears start_backoff (service.rs:480), so the slot shows a stale backoff for up to one tick.
  - Fix: Accept this and document it as best-effort, or serialize update_settings with a small tokio Mutex inside the service, held across save + diff (it is not the outer lock, so the heartbeat readers are unaffected). In publish_settings, also clear the slot's backoff to mirror L480.
- [minor] The late-tick guard (publish_tick ignored when loop_running == false) keeps telemetry consistent
  - Evidence: stop() followed quickly by start() (set_scheduled_recording_enabled false→true) spawns a new loop and sets loop_running=true while the old loop may still be inside evaluate_tick. The old loop then passes the guard and publishes a stale phase. The same race exists for shared.phase (service.rs:331-336 vs 450).
  - Fix: Give each loop a generation counter: start() increments it, the loop captures it, and publish_tick(gen, ...) is ignored when gen != current. Or document the race as the same pre-existing race.

## Confirmed claims
- rearm_at writers are service.rs:689 (user stop, next_hour_boundary), 810/841/899 (close_scheduled, start_of_next_day) and 939 (rotation race); the readers are 599-605 and 671-676; the field is at L252.
- The SkipReason::RearmingNextHour message says 'se reanudará a la siguiente hora en punto' (service.rs:98-100).
- The skip reason is loop-local (prev_skip L432, 456-461) and is only emitted via emit_skipped {reason, message} (L1639-1647). ScheduledRecordingIndicator.tsx:33 uses only `message`.
- The loop owns a SchedulerShared clone (L320-323) and never takes the outer ScheduledRecordingState lock. lib.rs:1839-1840 holds the outer read() across close_owned_segment_for_exit. commands.rs takes write() across start()/stop(). Setup holds write() across initialize() + start() (lib.rs:1376-1393).
- get_health_snapshot takes no AppHandle (logging/commands.rs:346). HealthSnapshot is Serialize-only and is built as a literal in 3 places (364, 493, 535). DeviceProfile is constructed only in get_device_profile (454) and is also serialized by incident.rs:327.
- emit_native_heartbeat builds its own json! (mem_sampler.rs:377-415) and is gated by should_emit_native_heartbeat && has_session (300-301). LAST_SAMPLE is a static std Mutex<Option<..>> = Mutex::new(None) (mem_sampler.rs:71), so the const-init pattern already compiles in this toolchain.
- The JS heartbeat picks its fields explicitly and device.profile spreads the profile once per session (healthHeartbeatService.ts:189-233).
- Every pause is user-initiated: pause_recording is reached only from tray.rs:208, coach-float, recording-widget, RecordingControls and recordingService.
- tokio is 1.49.0 (Cargo.lock), and Interval::reset() is `reset(Instant::now() + self.period)` (interval.rs:524-526). So CheckNow at service.rs:487 postpones evaluation by one full period; reset_immediately exists (556-558).
- update_settings (service.rs:345-358) is the only caller of save_settings for this file. The activation gate (ScheduledRecordingSetupGate.tsx:26-33) calls setSettings and then setEnabled, which hits update_settings again with identical content.
- emit_event is generic over R: Runtime and takes session_id: &str (emit.rs:41-49). process_session_id() returns &'static str. TelemetryStatus::Ok exists. lint-telemetry check (f) is a backtick substring search in docs/TELEMETRIA.md.
- active_window_at ignores `enabled` (schedule.rs:67-72), while idle_unload::window_context gates on s.enabled (idle_unload.rs:143-154).
- chrono has features=["serde"] (Cargo.toml:92), so Rear­m {until: NaiveDateTime} can derive Serialize/Deserialize.

## Corrected design notes
Keep the overall shape. B3 goes in its own commit with a typed Rearm {until, cause}. T1a publishes into a process-global std::sync::Mutex slot, so heartbeat readers never touch the outer tokio RwLock. T1b adds the config projection plus a diff-guarded jornada.settings_changed. The corrections below are required.

(1) close_scheduled gets a trigger parameter.
- Callers: evaluate_tick at L547 passes CloseTrigger::AutoClose; close_owned_segment_for_exit at L405 passes CloseTrigger::AppExitOrLogout.
- Only AutoClose writes Rearm{cause: AutoClose}.
- The exit/logout trigger clears ownership and does NOT write a same-day suppression. Clear rearm_at, or at most use a non-persisted cause.
- logout_cleanup should additionally leave no rearm behind for the next user.
- Tell the B4 owner: persist only rearms whose cause is UserStop, AutoClose or RotationRace, and never one produced by an exit path. Otherwise a mid-day reboot or tray-quit (which also goes through the RunEvent::Exit / WM_ENDSESSION path of B5) suppresses the jornada for the rest of the day.

(2) Compute the AutoClose deadline from the schedule: `schedule::next_fire_at(now, settings).unwrap_or(start_of_next_day(now))`.
- This replaces start_of_next_day at the three close_scheduled sites.
- It fixes the night-shift case (22:00-06:00 with the default derived auto_close 06:00). There the current suppression until midnight eats 22:00-00:00 every night. The same case is where B3's wrong toast also appears without any custom auto_close time.
- Add schedule table tests for a day window and a night window.
- Word the hint text in ScheduledRecordingSettings.tsx to match ('hasta tu siguiente horario', not 'el día siguiente').

(3) Do not reuse the legacy `TranscriptionNotReady` label in the new telemetry.
- Add `code: &'static str` (AudioStartError::code()) to StartBackoff in record_start_failure.
- Expose `backoff.code` (mic_not_found | mic_permission_denied | mic_in_use | mic_format_unsupported | audio_unknown | other) in the heartbeat's jornada block.
- In idle_reason, map TranscriptionNotReady/Other to a code-derived value, e.g. `mic_in_use` or `start_failed`, never to `transcription_not_ready`.
- When skip == StartBackoff and a backoff kind is known, report the kind's code instead of `start_backoff`.
- Update IDLE_REASONS and the T5 SQL accordingly.

(4) Optional hardening.
- Add a loop generation counter so a stale tick from a stopped loop cannot publish after a quick stop→start.
- Clear the slot's backoff inside publish_settings to mirror the loop's UpdateSettings (service.rs:480).
- Document the jornada.settings_changed diff as best-effort under concurrent update_settings calls, or serialize update_settings with an inner tokio Mutex that is not the outer lock.

(5) Keep as report-only / open question: CheckNow should use tick.reset_immediately() (service.rs:487).

Commit order stays B3 → T1a → T1b. Each commit needs pnpm run tauri:build:debug exit 0 plus `cargo test scheduled_recording` and `node scripts/lint-telemetry.js`.