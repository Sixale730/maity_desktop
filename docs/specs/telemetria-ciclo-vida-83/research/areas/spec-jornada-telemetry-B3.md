# T1 (jornada state telemetry in heartbeat / device.profile + jornada.settings_changed) + B3 (closed-for-day skip reason after auto-close)

## Summary
B3 is a real bug. All three `close_scheduled` exit paths set `rearm_at = start_of_next_day(now)` (service.rs:810, 841, 899). But the in-window arm of `evaluate_tick` turns any pending rearm into `SkipReason::RearmingNextHour` (service.rs:602), and that reason's message says "se reanudará a la siguiente hora en punto" (service.rs:98-100). It only reaches the user when `auto_close_time` falls before the window's `end_time`, for example closing at 17:00 with a 09-18 window. From the close until 18:00 the loop sits in Armed with the wrong toast, which `prev_skip` shows only once. Fix: turn `rearm_at` into a typed `Rearm { until, cause: RearmCause }` with causes `user_stop | auto_close | rotation_race`, and add `SkipReason::ClosedForDay` ("closed_for_day") with a correct Spanish message. Only the auto-close cause maps to it. T1 plan: publish scheduler state into a process-global `std::sync::Mutex` slot (new module `scheduled_recording/status_snapshot.rs`). This copies the `mem_sampler::LAST_SAMPLE` pattern (mem_sampler.rs:71, 196-202, 293). The heartbeat readers (`get_health_snapshot`, `emit_native_heartbeat`) never touch the `Arc<tokio::RwLock<ScheduledRecordingService>>`, which can be write-locked or read-held for a long time. A pure `idle_reason(RecordingPhase, Option<&JornadaView>)` gives a closed value table aligned with the `recording_start_failed.code` values (`mic_not_found` / `mic_permission_denied`, device_errors.rs:91-92). The heartbeat gets a dynamic `jornada` block plus a top-level `idle_reason`. `device.profile` gets the static config projection. A new event `jornada.settings_changed {from,to,changed}` is emitted from the single chokepoint `update_settings`, with a diff guard. One report-only finding: `CheckNow` calls `Interval::reset()`, which in tokio 1.49 is `reset(Instant::now() + period)` (tokio-1.49.0/src/time/interval.rs:524-526). So "Evaluar ahora" pushes the next evaluation back a full 30 s instead of running it now.

## Current behavior
- The rearm deadline has no cause. After auto-close it stores 'start of next day'. After a user stop, or a lost rotation race, it stores 'next hour'. — service.rs:689 `*shared.rearm_at.write().await = Some(schedule::next_hour_boundary(now));` (user stop in window); service.rs:810/841/899 `*shared.rearm_at.write().await = Some(start_of_next_day(now));` (close_scheduled: other actor stopped first / batch / streaming); service.rs:939 `Some(schedule::next_hour_boundary(now))` (rotation race). Field decl service.rs:252 `rearm_at: Arc<RwLock<Option<NaiveDateTime>>>`.
- Every pending rearm inside the window becomes RearmingNextHour, with a message that is wrong after auto-close (B3) — service.rs:598-605 `if now < until { return (SchedulerPhase::Armed, Some(SkipReason::RearmingNextHour)); }`; message service.rs:98-100 "Grabación de jornada detenida; se reanudará a la siguiente hora en punto."
- B3 only shows when auto-close happens inside the window. With the default 09-18 window and 18:00 close, the window has already ended (half-open [start,end)), so the idle arm runs and there is no skip. — schedule.rs:36-57 is_within_window half-open `now_min < end`; service.rs:667-683 `(false, None)` returns `(SchedulerPhase::Idle, None)`; UI lets auto_close_time be edited independently of end_time (ScheduledRecordingSettings.tsx:318-324).
- The only consumers of the skip-reason strings are the Tauri event and the UI toast. The toast shows `message` only; `reason` is never branched on in TS. — service.rs:1639-1647 emit_skipped `{reason: reason.as_str(), message: reason.message()}`; ScheduledRecordingIndicator.tsx:33-36 `const message = event.payload?.message; if (message) toast.info(message)`; tauri-events.ts:111; events.rs:132. scheduledRecordingService.ts has no reason types (grep 'reason|skipped' = 0 matches). No i18n. Docs: ONBOARDING_Y_GATES.md:23 names `SkipReason::RearmingNextHour`. Rust tests only assert no_input_device/mic_access_denied (service.rs:1915-1928).
- The skip reason exists only inside the loop and is never stored in shared state — service.rs:432 `let mut prev_skip: Option<SkipReason> = None;` ... 447-461 evaluate_tick result -> `*shared.phase.write().await = new_phase;` then emit on change only.
- The outer service lock can be held for a long time, or queued for write. Tokio's RwLock is fair, so a queued writer blocks new readers. A heartbeat that took `state.read().await` could stall behind a graceful exit. — lib.rs:1838-1840 `let service = state.read().await; if service.close_owned_segment_for_exit(app).await` (holds read across stop+finalize); commands.rs:64/70/83/95 `state.write().await` across start()/stop() (stop awaits `tx.send(Stop)`); lib.rs:1376 setup holds write() across initialize() (fs read) + start(). The loop itself never takes the outer lock (it owns a SchedulerShared clone, service.rs:320-323).
- No current write guard on the inner SchedulerShared locks is held across an await (the lock contract is respected), so an extra short read after the phase write is safe — Contract service.rs:235-239; snapshots in own statements at 525, 565, 599, 671, 1673, 1724; `grace_deadline` guard block 529-536 has no await inside.
- `get_health_snapshot` takes no AppHandle. It is built as a struct literal in 3 places. — logging/commands.rs:345-372 `pub async fn get_health_snapshot() -> Result<HealthSnapshot, String>`; literals at 364-371, tests 493-517, 535-548; struct 328-340.
- The native heartbeat builds its own JSON payload, independent of HealthSnapshot — mem_sampler.rs:377-415 `let payload = serde_json::json!({ "reason": "native", "phase": phase.as_str(), ... "performance_tier": serde_json::Value::Null })`; gated mem_sampler.rs:300-301 by should_emit_native_heartbeat && state::has_session.
- The JS heartbeat picks its payload fields explicitly. device.profile is spread once per session. — healthHeartbeatService.ts:211-233 `platformLogger.log('health.heartbeat', { reason, phase: snapshot.phase, ... err_budget: {...} })`; 189-197 `void platformLogger.log('device.profile', { ...this.deviceProfile })`; TS mirrors HealthSnapshot 75-84 and DeviceProfile 108-122. lib/deviceTier.ts:8-10 is an explicitly partial mirror (`DeviceProfileLite`) and needs no change.
- `in_window` currently ignores `enabled` in the status/event APIs; idle_unload uses an enabled-gated 'effective' window — service.rs:371 `let in_window = schedule::active_window_at(now, &settings).is_some();` (get_status) and 1634 (emit_status); schedule.rs:67-72 active_window_at has no enabled check; idle_unload.rs:143-154 `Some(s) if s.enabled => (schedule::active_window_at(now, s).is_some(), ...)`, `_ => (false, None)`.
- update_settings is the only persistence chokepoint. The UI can call it twice for one action, sometimes with identical content. — service.rs:345-358; commands.rs:35-43 and 55-60 both call it; ScheduledRecordingSetupGate.tsx:26-33 setSettings({...enabled:true, configured_by_user:true}) then setEnabled(true) (second call identical); useScheduledRecording.ts markConfigured writes only if !configured_by_user; loop UpdateSettings (service.rs:470-482) only mirrors the same value into memory.
- The rotation-restart failure path throws away its skip reason for one tick — service.rs:1025 `record_start_failure(app, shared, &e, now).await;` result ignored; 1026 returns Armed; evaluate_tick 572-573 `return (phase, None);`. Next tick (<=30 s) reports StartBackoff/kind via check_start_backoff (1667-1712).
- Every pause is user-initiated. There is no automatic pause. — pause_recording callers: tray.rs:208, coach-float/page.tsx:473, recording-widget/page.tsx:259, RecordingControls.tsx:267, recordingService.ts:126; phase machine recording_phase.rs:38-44.
- The recording_start_failed codes the idle reasons should align with — device_errors.rs:89-95 `mic_permission_denied`, `mic_not_found`, `mic_in_use`, `mic_format_unsupported`, `audio_unknown`; recording_lifecycle.rs:207 `let code = super::device_errors::classify_device_error(error).code();`; service.rs:157-164 StartFailureKind::classify maps MicNotFound/MicPermissionDenied/_ .
- CheckNow ('Evaluar ahora') postpones the next tick by a full period instead of evaluating now (report only) — service.rs:483-488 `*shared.start_backoff.write().await = None; tick.reset();`; tokio-1.49.0/src/time/interval.rs:524-526 `pub fn reset(&mut self) { self.delay.as_mut().reset(Instant::now() + self.period); }` vs 556-558 `reset_immediately` = `reset(Instant::now())`. Cargo.lock tokio 1.49.0. UI toasts 'Evaluación de horario solicitada' (ScheduledRecordingSettings.tsx:159) and then reload() reads the stale status.
- Cardinality rule: static device dimensions go only in device.profile. The only exception is performance_tier. — docs/TELEMETRIA.md:386-392 "las dimensiones estáticas (...) van SOLO en `device.profile` (1×/sesión) ... Excepción deliberada: `performance_tier` va en ambos".
- The lint requires 3 entries per new event, and the TS catalog must use one-line entries — scripts/lint-telemetry.js:8-20 checks (b) mirror, (c) dot naming, (f) backticked name in docs/TELEMETRIA.md; telemetry-events.ts:14-16 format note; catalog.rs:44-53 App/salud section.

## Design
## Commit 1 (B3): typed rearm cause + `SkipReason::ClosedForDay`

All changes are in `frontend/src-tauri/src/scheduled_recording/service.rs` unless another file is named.

### Types (place them after `impl SkipReason`, around L117)
```rust
/// Why a rearm is pending. Its message is chosen from here, never from the deadline:
/// a user stop at 23:30 and an auto-close both land on midnight.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum RearmCause { UserStop, AutoClose, RotationRace }
impl RearmCause {
    pub(crate) fn as_str(self) -> &'static str { match self { Self::UserStop => "user_stop", Self::AutoClose => "auto_close", Self::RotationRace => "rotation_race" } }
    /// Pure: the skip reason the user sees while this rearm is pending.
    fn skip_reason(self) -> SkipReason { match self { Self::AutoClose => SkipReason::ClosedForDay, Self::UserStop | Self::RotationRace => SkipReason::RearmingNextHour } }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Rearm { pub(crate) until: NaiveDateTime, pub(crate) cause: RearmCause }
```
`Serialize, Deserialize` are already imported (service.rs:16), and chrono has `features=["serde"]` (Cargo.toml:92). That lets B4 (restart persistence, another area) persist `Rearm` as-is. Tell the B4 owner.

### SkipReason
- Add the variant `ClosedForDay` next to `RearmingNextHour` (L64). Make the enum `pub(crate)` for T1 (L61), plus `pub(crate) fn as_str`.
- `as_str`: `SkipReason::ClosedForDay => "closed_for_day"`.
- `message`: `SkipReason::ClosedForDay => "La jornada de hoy ya se cerró; la grabación se reanudará en tu siguiente horario."` This avoids promising "mañana": `start_of_next_day` is midnight, and the next listed day may be days away.

### Field + write sites
- L252: `rearm_at: Arc<RwLock<Option<Rearm>>>`. Update the doc comments at L250-252 and L257-259: "produce `RearmingNextHour` or `ClosedForDay` depending on `RearmCause`".
- L689: `Some(Rearm { until: schedule::next_hour_boundary(now), cause: RearmCause::UserStop })`.
- L810, L841, L899: `Some(Rearm { until: start_of_next_day(now), cause: RearmCause::AutoClose })`. All three are close_scheduled exits. L806 (user won the StopGate at close time) is still AutoClose, because the close happened de facto, as that comment says.
- L939: `Some(Rearm { until: schedule::next_hour_boundary(now), cause: RearmCause::RotationRace })`.
- Read in window, L598-606:
  ```rust
  let rearm = *shared.rearm_at.read().await;
  if let Some(r) = rearm { if now < r.until { return (SchedulerPhase::Armed, Some(r.cause.skip_reason())); } *shared.rearm_at.write().await = None; }
  ```
  `rearm` is a Copy snapshot in its own statement, so no guard is live when the write runs; the lock contract is kept.
- Read in the idle arm, L670-677: `if let Some(r) = rearm { if now >= r.until { ...= None; } }`.
- L692 keeps returning `RearmingNextHour`, which is right for UserStop.

### Other consumers
- `docs/ONBOARDING_Y_GATES.md:23` becomes: "**No reusar `rearm_at`** para esto: es un `Rearm { until, cause }` que produce `RearmingNextHour` (paro del usuario / carrera de rotación) o `ClosedForDay` (cierre por hora fija), y lo limpia el arm de reposo."
- `ScheduledRecordingSettings.tsx:337-340`, the auto-close hint: append "Tras el cierre, la jornada no vuelve a arrancar hasta el día siguiente." The L205-208 text ("Si la detienes dentro del horario, se reanuda a la siguiente hora en punto.") is correct and stays.
- `ScheduledRecordingIndicator.tsx` needs no change: it shows `message`.
- Nothing in `docs/REGLAS_AUDIO_GRABACION.md` references these strings (grep checked).

### Tests (new `#[cfg(test)] mod rearm_tests` in service.rs)
- `RearmCause::AutoClose.skip_reason() == SkipReason::ClosedForDay`; UserStop and RotationRace give `RearmingNextHour`.
- `SkipReason::ClosedForDay.message()` does not contain "siguiente hora"; `as_str()=="closed_for_day"`.
- `SkipReason::ALL` or a local array of every variant: every `as_str` is unique and non-empty (guards the telemetry contract used in T1).
- `RearmCause` serde round-trip gives "auto_close".

## Commit 2 (T1a): scheduler state + `idle_reason` in `health.heartbeat`

### New module `scheduled_recording/status_snapshot.rs` (add `pub mod status_snapshot;` to mod.rs:9-12)
Design choice: a process-global publication slot rather than a read through `ScheduledRecordingState`. Reason: lib.rs:1839-1840 holds `read()` across a full segment close, and commands.rs:64/70/83/95 take `write()`. Tokio's RwLock is fair, so `read().await` would stall the heartbeat, and `try_read()` would silently drop the field. The slot is a `std::sync::Mutex`, locked only for assignment or clone and never across an await, so readers never block for long. This is the same pattern as `mem_sampler::LAST_SAMPLE` (mem_sampler.rs:71, 196-202, 293-295). Poisoning is handled like mem_sampler (`if let Ok(mut s) = SLOT.lock()`); never `.unwrap()`.

```rust
use std::sync::Mutex;
use chrono::NaiveDateTime;
use crate::audio::recording_phase::RecordingPhase;
use super::service::{SchedulerPhase, SkipReason, RearmCause, Rearm, StartFailureKind};
use super::settings::ScheduledRecordingSettings;
use super::schedule;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct BackoffView { pub kind: StartFailureKind, pub consecutive: u32, pub halted_for_day: bool }

struct Slot { settings: ScheduledRecordingSettings, loop_running: bool, phase: SchedulerPhase,
              skip: Option<SkipReason>, rearm: Option<Rearm>, backoff: Option<BackoffView> }
static SLOT: Mutex<Option<Slot>> = Mutex::new(None);

pub(super) fn publish_settings(s: &ScheduledRecordingSettings)   // initialize() + update_settings(); creates slot {loop_running:false, phase:Disabled, None...} if absent
pub(super) fn publish_loop_running(running: bool)               // start(): true; stop(): false AND phase=Disabled, skip=None, backoff=None
pub(super) fn publish_tick(phase, skip: Option<SkipReason>, rearm: Option<Rearm>, backoff: Option<BackoffView>)
    // IGNORED when slot.loop_running == false: a tick that lands after stop() must not revive the phase
    // (the same race exists today between service.rs:336 and :450; this keeps telemetry consistent).

/// Typed view for the pure function. in_window IGNORES `enabled` (same as ScheduledStatus.in_window,
/// service.rs:371 and emit_status :1634). The "effective" window used by idle_unload.rs:143-154 is
/// `enabled && in_window`. rearm_cause is present only while the rearm is pending (until > now).
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct JornadaView { pub enabled: bool, pub configured_by_user: bool, pub loop_running: bool,
    pub phase: SchedulerPhase, pub in_window: bool, pub skip: Option<SkipReason>,
    pub rearm_cause: Option<RearmCause>, pub rearm_until: Option<NaiveDateTime>, pub backoff: Option<BackoffView> }

pub(crate) fn jornada_view(now: NaiveDateTime) -> Option<JornadaView>   // clone under lock, compute in_window/rearm activity after unlock
pub(crate) fn idle_reason(rec: RecordingPhase, v: Option<&JornadaView>) -> Option<&'static str>  // PURE
pub fn heartbeat_fields(rec: RecordingPhase, now: NaiveDateTime) -> (Option<&'static str>, Option<JornadaTelemetry>)

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct JornadaTelemetry { pub enabled: bool, pub loop_running: bool, pub phase: SchedulerPhase /* lowercase via existing derive service.rs:48-49 */,
    pub in_window: bool, pub skip: Option<&'static str> /* SkipReason::as_str */, pub rearm_cause: Option<&'static str>,
    pub rearm_until: Option<String> /* "%Y-%m-%dT%H:%M:%S" local, same format as next_fire_at service.rs:370 */,
    pub backoff: Option<BackoffTelemetry> }
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct BackoffTelemetry { pub kind: &'static str /* StartFailureKind::code(): mic_not_found|mic_permission_denied|other */, pub consecutive: u32, pub halted_for_day: bool }
```
Visibility changes in service.rs: `SchedulerPhase` is already pub. Make `SkipReason`, `StartFailureKind` (L144), `RearmCause` and `Rearm` `pub(crate)`. Add `StartFailureKind::code(self) -> &'static str { NoInputDevice=>"mic_not_found", MicAccessDenied=>"mic_permission_denied", Other=>"other" }`, which aligns with device_errors.rs:91-92.

### `idle_reason` value table (pure; first match wins)
| recording phase | condition | idle_reason |
|---|---|---|
| recording / starting / stopping | any | `null` (not idle) |
| paused | any | `paused_by_user` (every pause is user-initiated: tray.rs:208, RecordingControls.tsx:267, coach-float, widget) |
| idle | slot absent (first seconds before `initialize`) | `pending` |
| idle | `!enabled && !configured_by_user` | `jornada_unconfigured` |
| idle | `!enabled` | `jornada_off` |
| idle | `!loop_running` (enabled but loop not started/stopped: commands.rs:91-98, failed start) | `scheduler_stopped` |
| idle | `!in_window` | `outside_window` |
| idle | skip `NoSession` | `no_session` |
| idle | skip `RegistrationIncomplete` | `no_registration` |
| idle | skip `ClosedForDay` | `closed_for_day` |
| idle | skip `RearmingNextHour` | `stopped_by_user` |
| idle | skip `NoInputDevice` | `mic_not_found` |
| idle | skip `MicAccessDenied` | `mic_permission_denied` |
| idle | skip `StartBackoff` | `start_backoff` |
| idle | skip `TranscriptionNotReady` | `transcription_not_ready` |
| idle | skip `ManualInProgress` (stale: the manual recording just ended, skip is at most 30 s old) | `pending` |
| idle | no skip, rearm_cause `auto_close` (tick where close_scheduled returned Idle in window) | `closed_for_day` |
| idle | no skip, rearm_cause `user_stop`/`rotation_race` | `stopped_by_user` |
| idle | no skip, backoff kind NoInputDevice / MicAccessDenied | `mic_not_found` / `mic_permission_denied` |
| idle | no skip, backoff Other (e.g. rotation restart failure, service.rs:1025 result discarded) | `start_backoff` |
| idle | otherwise (loop not ticked yet, phase Recording but user just stopped, etc.) | `pending` |

Closed domain: `paused_by_user, jornada_unconfigured, jornada_off, scheduler_stopped, outside_window, no_session, no_registration, closed_for_day, stopped_by_user, mic_not_found, mic_permission_denied, start_backoff, transcription_not_ready, pending`. Expose it as `pub const IDLE_REASONS: &[&str]` so a test can check that each returned value is in the set, and T5's SQL can mirror it.

### Publish call sites in service.rs
- `initialize` (L305): after the write, `status_snapshot::publish_settings(&settings_clone)`. Clone before the move, or read back.
- `start` (L318): after `is_running=true`, `publish_loop_running(true)`.
- `stop` (L336): after `phase=Disabled`, `publish_loop_running(false)`.
- `update_settings` (L353): after the in-memory write, `publish_settings(&settings)`.
- Loop tick (L450): right after `*shared.phase.write().await = new_phase;`, add
  ```rust
  let rearm = *shared.rearm_at.read().await;          // own statement: no guard across awaits
  let backoff = *shared.start_backoff.read().await;   // StartBackoff is Copy (L177)
  status_snapshot::publish_tick(new_phase, skip, rearm, backoff.map(|b| BackoffView { kind: b.kind, consecutive: b.consecutive, halted_for_day: b.halted_for_day }));
  ```
  Store `skip` on EVERY tick, not only on change, so it is cleared when a tick returns None. `prev_skip` stays for the UI-toast dedup.

Deadlock proof: the new code never touches the outer `ScheduledRecordingState`. The inner reads are Copy snapshots in their own statements, taken in the loop task, which is the only regular writer; the one concurrent writer is close_owned_segment_for_exit via close_scheduled, whose writes are single statements. The std Mutex is held only for field assignment or a clone of a ~200-byte settings struct, and nothing inside it can await or panic.

### HealthSnapshot (logging/commands.rs)
- Struct L328-340: add `pub idle_reason: Option<&'static str>` and `pub jornada: Option<crate::scheduled_recording::status_snapshot::JornadaTelemetry>`.
- `get_health_snapshot` L364-371: `let phase = crate::audio::recording_phase::current_phase(); let (idle_reason, jornada) = crate::scheduled_recording::status_snapshot::heartbeat_fields(phase, chrono::Local::now().naive_local());` then `phase: phase.as_str()`, plus the two new fields. No AppHandle is needed, so the command signature is unchanged.
- Test literals L493-517 and L535-548: add the fields. In the first, `idle_reason: Some("outside_window")` and `jornada: Some(JornadaTelemetry{...})`, asserting `v["idle_reason"]=="outside_window"`, `v["jornada"]["phase"]=="idle"`, `v["jornada"]["skip"].is_null()`, and `v["jornada"]["backoff"]["kind"]` in a variant. In the second, `None/None`, asserting `is_null()`.

### Native heartbeat (mem_sampler.rs:384-403)
Inside `json!`: `let (idle_reason, jornada) = crate::scheduled_recording::status_snapshot::heartbeat_fields(phase, chrono::Local::now().naive_local());` then `"idle_reason": idle_reason, "jornada": jornada,`. `phase` is already the function parameter.

### TS (services/healthHeartbeatService.ts)
- Add `interface JornadaTelemetry { enabled: boolean; loop_running: boolean; phase: string; in_window: boolean; skip: string | null; rearm_cause: string | null; rearm_until: string | null; backoff: { kind: string; consecutive: number; halted_for_day: boolean } | null }`.
- In `HealthSnapshot` (L75-84), add `idle_reason: string | null` and `jornada: JornadaTelemetry | null`.
- In the payload pick (L211-233), add `idle_reason: snapshot.idle_reason ?? null, jornada: snapshot.jornada ?? null,`, placed after `phase`.
- Cardinality note in a comment: these are DYNAMIC state, not resource attributes. `jornada.enabled` repeats per beat on purpose, because it changes mid-session and device.profile is emitted once.

### Docs (docs/TELEMETRIA.md)
- Heartbeat jsonc (L260-288): add `"idle_reason": "outside_window | … (closed table) | null"` and `"jornada": { enabled, loop_running, phase, in_window /* ignores enabled */, skip, rearm_cause, rearm_until, backoff }`, with the note "null before initialize".
- Table row L216: mention `idle_reason` + `jornada`.
- Cardinality paragraph L386-392: add a sentence that `jornada.*` is dynamic scheduler state (≈250 B/beat), not a static dimension, so it does not use the `performance_tier` exception.

## Commit 3 (T1b): config in `device.profile` + `jornada.settings_changed`

### Projection (status_snapshot.rs)
```rust
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct JornadaConfig { pub enabled: bool, pub configured_by_user: bool,
  pub windows: Vec<ScheduleWindow> /* first 3 */, pub windows_count: usize,
  pub auto_close_enabled: bool, pub auto_close_time: String, pub hourly_rotation_enabled: bool,
  pub grace_period_minutes: u32, pub notify_on_start: bool }
impl From<&ScheduledRecordingSettings> for JornadaConfig { … windows.iter().take(3).cloned() … }
pub fn config_projection() -> Option<JornadaConfig>          // from SLOT.settings
pub(crate) fn changed_fields(a: &JornadaConfig, b: &JornadaConfig) -> Vec<&'static str>  // PURE, field names in declaration order
```
Excluded on purpose: `respect_manual_recording` and `catch_up_on_start` (never read by the scheduler), `check_interval_seconds`, `meeting_name_template` (free text) and `settings_schema_version`. Add `PartialEq` to the `ScheduleWindow` derive (settings.rs:97). The UI edits only `windows[0]` (ScheduledRecordingSettings.tsx:57-59), so the cap of 3 is for hand-edited JSON.

### device.profile (logging/commands.rs)
- `DeviceProfile` struct L400-424: add `pub jornada: Option<crate::scheduled_recording::status_snapshot::JornadaConfig>`, with a doc comment: the config at emission time (1× per session); changes arrive via `jornada.settings_changed`; `None` means the service is not initialized yet.
- `get_device_profile` L454-482: `jornada: crate::scheduled_recording::status_snapshot::config_projection(),`.
- `logging/incident.rs:327` serializes the whole profile into the consented incident bundle, so the jornada config rides along automatically. That is acceptable: local, consented data.
- TS `DeviceProfile` (healthHeartbeatService.ts:108-122): add `jornada: { enabled: boolean; configured_by_user: boolean; windows: { days_of_week: number[]; start_time: string; end_time: string }[]; windows_count: number; auto_close_enabled: boolean; auto_close_time: string; hourly_rotation_enabled: boolean; grace_period_minutes: number; notify_on_start: boolean } | null`. The `{...profile}` spread carries it and needs no change. `lib/deviceTier.ts` is a partial mirror and gets no change.

### New event `jornada.settings_changed`
- Catalog: `catalog.rs`, new section before App/salud: `// ── Jornada: cambio de configuración (emisor: Rust, scheduled_recording/service.rs::update_settings) ──` then `pub const JORNADA_SETTINGS_CHANGED: &str = "jornada.settings_changed";`. TS `telemetry-events.ts` gets the same one-line entry: `JORNADA_SETTINGS_CHANGED: 'jornada.settings_changed',`.
- Doc: a row in the "Ciclo de vida de grabación" table near L145 (or a small "Jornada" table): `| \`jornada.settings_changed\` | \`update_settings\` persistió una configuración cuya proyección cambió (diff guard: el gate y el toggle llaman 2×) | \`from\`, \`to\` (JornadaConfig), \`changed\` (lista de campos); \`status\`=\`ok\`; columna \`session_id\` = \`proc-…\` |`.
- Emission in `update_settings` (service.rs:345-358):
  ```rust
  let old = self.shared.settings.read().await.clone();   // own statement, BEFORE save
  save_settings(...).await.map_err(...)?;               // failure => no event (nothing changed)
  *self.shared.settings.write().await = settings.clone();
  status_snapshot::publish_settings(&settings);
  let (from, to) = (JornadaConfig::from(&old), JornadaConfig::from(&settings));
  let changed = status_snapshot::changed_fields(&from, &to);
  if !changed.is_empty() {
      let app = app_handle.clone();
      tauri::async_runtime::spawn(async move {   // fire-and-forget: the caller may hold the outer read() (commands.rs:41,56)
          crate::logging::telemetry::emit::emit_event(&app, crate::logging::telemetry::context::process_session_id(),
              crate::logging::telemetry::catalog::JORNADA_SETTINGS_CHANGED,
              serde_json::json!({ "from": from, "to": to, "changed": changed }),
              Some(crate::logging::telemetry::status::TelemetryStatus::Ok), None, None).await;
      });
  }
  if let Some(tx) = &self.command_tx { … }   // unchanged
  ```
  `AppHandle<R>` is Send + 'static (tauri-runtime-2.11.2/src/lib.rs:402 `Runtime<T>: … + 'static`; precedent service.rs:311-323). Payload is ≈0.5 KB. Diff outcomes: the gate (setSettings then setEnabled) gives 1 event, since the 2nd call is identical. The Settings toggle gives 1 event (plus 1 for `configured_by_user` only the first time). "Guardar horario" gives 1 event. The emitter session id is `process_session_id()`, same as `emit_segment_discarded` (service.rs:1369).
- Known limitation, documented in the doc row: the drainer resolves `user_id` at drain time (drain.rs), which is the same for every outbox event.

## Report-only (no commit in this area)
- `CheckNow` → `tick.reset()` delays evaluation 30 s (tokio interval.rs:524-526). The fix would be `tick.reset_immediately()` (interval.rs:556-558) at service.rs:487. Without it, `reload()` after "Evaluar ahora" (ScheduledRecordingSettings.tsx:158-160) always reads the pre-evaluation status.
- Optional follow-up: have `rotate_scheduled` return `(SchedulerPhase, Option<SkipReason>)` so the reason from service.rs:1025 and the race reason at :939 surface on the same tick. Not needed for telemetry, because the table falls back to backoff/rearm.

## Commit ordering
1. B3. 2. T1a (depends on 1: RearmCause and the pub(crate) SkipReason). 3. T1b (depends on 2: the status_snapshot module). Each commit must pass `pnpm run tauri:build:debug` with exit 0 (CLAUDE.md §2) before committing. Run `graphify update .` after. No lib.rs, pipeline or engine change, so no backup branch is needed under Guardian §1.

## Files to change
- `frontend/src-tauri/src/scheduled_recording/service.rs` — B3: add RearmCause/Rearm types; `rearm_at: Option<Rearm>` (L252); update the 5 write sites (L689, L810, L841, L899, L939) and 2 read sites (L598-606, L670-677); add SkipReason::ClosedForDay with as_str/message; update doc comments L250-259; new rearm_tests. T1a: make SkipReason/StartFailureKind/RearmCause/Rearm pub(crate); add StartFailureKind::code(); publish_* calls in initialize (L305), start (L318), stop (L336), update_settings (L353) and after the phase write in the loop (L450). T1b: diff-guarded jornada.settings_changed emit in update_settings (spawned).
- `frontend/src-tauri/src/scheduled_recording/status_snapshot.rs` — NEW (T1a/T1b): static Mutex<Option<Slot>> publication; publish_settings/publish_loop_running/publish_tick; JornadaView, jornada_view(now); PURE idle_reason(RecordingPhase, Option<&JornadaView>) + IDLE_REASONS const; JornadaTelemetry/BackoffTelemetry (Serialize); heartbeat_fields(rec, now); JornadaConfig projection + From<&ScheduledRecordingSettings>, config_projection(), PURE changed_fields(); unit tests.
- `frontend/src-tauri/src/scheduled_recording/mod.rs` — T1a: `pub mod status_snapshot;`
- `frontend/src-tauri/src/scheduled_recording/settings.rs` — T1b: add PartialEq to the ScheduleWindow derive (L97).
- `frontend/src-tauri/src/logging/commands.rs` — T1a: HealthSnapshot gains idle_reason + jornada (L328-340), get_health_snapshot fills them via heartbeat_fields (L364-371), update both test literals + assertions (L493-553). T1b: DeviceProfile gains `jornada: Option<JornadaConfig>` (L400-424) filled in get_device_profile (L454-482).
- `frontend/src-tauri/src/logging/mem_sampler.rs` — T1a: emit_native_heartbeat payload adds "idle_reason" and "jornada" from heartbeat_fields(phase, now) (L384-403).
- `frontend/src-tauri/src/logging/telemetry/catalog.rs` — T1b: `pub const JORNADA_SETTINGS_CHANGED: &str = "jornada.settings_changed";` in a new Jornada section.
- `frontend/src/lib/telemetry-events.ts` — T1b: one-line entry `JORNADA_SETTINGS_CHANGED: 'jornada.settings_changed',`.
- `frontend/src/services/healthHeartbeatService.ts` — T1a: JornadaTelemetry interface; HealthSnapshot gains idle_reason/jornada; heartbeat payload picks both. T1b: DeviceProfile interface gains `jornada` config object | null.
- `frontend/src/components/scheduled-recording/ScheduledRecordingSettings.tsx` — B3: auto-close hint (L337-340) adds 'Tras el cierre, la jornada no vuelve a arrancar hasta el día siguiente.'
- `docs/ONBOARDING_Y_GATES.md` — B3: L23 describes rearm_at as Rearm{until,cause} producing RearmingNextHour or ClosedForDay.
- `docs/TELEMETRIA.md` — T1a: heartbeat jsonc + table row L216 + cardinality paragraph L386-392 document idle_reason (closed value list) and the jornada block (in_window ignores enabled). T1b: device.profile row L215 adds `jornada` (since 0.2.62); new row for `jornada.settings_changed` (backticked name satisfies lint check f).

## Commits
- **fix: la jornada cerrada por hora fija avisa que reanuda en el siguiente horario, no a la siguiente hora**
  B3. `rearm_at` pasa a `Option<Rearm { until, cause: RearmCause }>` (user_stop | auto_close | rotation_race); los 5 escritores (service.rs:689, 810, 841, 899, 939) declaran su causa. Nueva `SkipReason::ClosedForDay` ("closed_for_day", mensaje "La jornada de hoy ya se cerró; la grabación se reanudará en tu siguiente horario."), producida solo por la causa AutoClose en el arm de ventana (service.rs:598-606); el paro del usuario y la carrera de rotación siguen en RearmingNextHour. Tests puros de mapeo causa→razón, unicidad de as_str y round-trip serde de RearmCause. Actualiza docs/ONBOARDING_Y_GATES.md:23, los comentarios de SchedulerShared y el texto de cierre automático en ScheduledRecordingSettings.tsx. Build: pnpm run tauri:build:debug exit 0 + cargo test scheduled_recording.
- **feat: estado de la jornada e idle_reason en health.heartbeat (JS y nativo)** (deps: fix: la jornada cerrada por hora fija avisa que reanuda en el siguiente horario, no a la siguiente hora)
  T1a. Nuevo módulo scheduled_recording/status_snapshot.rs: slot global std::sync::Mutex (patrón LAST_SAMPLE de mem_sampler) publicado por initialize/start/stop/update_settings y por el tick del loop justo tras escribir la fase (última SkipReason en cada tick, Rearm vigente, back-off). Los lectores nunca tocan el RwLock del servicio (lib.rs:1839 lo retiene de lectura durante un cierre y los comandos lo toman de escritura). Función pura idle_reason(RecordingPhase, vista) con dominio cerrado (paused_by_user, jornada_unconfigured, jornada_off, scheduler_stopped, outside_window, no_session, no_registration, closed_for_day, stopped_by_user, mic_not_found, mic_permission_denied, start_backoff, transcription_not_ready, pending). HealthSnapshot gana idle_reason + jornada (3 literales + tests), emit_native_heartbeat los incluye y healthHeartbeatService.ts los recoge. Documentado en docs/TELEMETRIA.md (in_window ignora enabled; lo efectivo es enabled && in_window, igual que idle_unload::window_context).
- **feat: configuración de jornada en device.profile y evento jornada.settings_changed** (deps: feat: estado de la jornada e idle_reason en health.heartbeat (JS y nativo))
  T1b. Proyección JornadaConfig (enabled, configured_by_user, windows[≤3] + windows_count, auto_close_enabled/time, hourly_rotation_enabled, grace_period_minutes, notify_on_start) en DeviceProfile (Rust + TS). Nuevo evento jornada.settings_changed {from, to, changed} emitido desde update_settings, el único punto de persistencia, con diff guard sobre la proyección (el gate y el toggle llaman dos veces), en una task aparte, status ok, session_id de proceso. Las 3 entradas del lint: catalog.rs, telemetry-events.ts y docs/TELEMETRIA.md. ScheduleWindow deriva PartialEq.

## Tests
- frontend/src-tauri/src/scheduled_recording/service.rs (new mod rearm_tests): RearmCause::AutoClose.skip_reason()==ClosedForDay; UserStop/RotationRace give RearmingNextHour; ClosedForDay.message() does not contain 'siguiente hora' and as_str=='closed_for_day'; all SkipReason variants have unique non-empty as_str; RearmCause serializes as 'auto_close' and round-trips.
- frontend/src-tauri/src/scheduled_recording/status_snapshot.rs (mod tests): Table test of idle_reason covering every row of the value table, including: recording/starting/stopping gives None; paused gives paused_by_user; None view gives pending; disabled+unconfigured gives jornada_unconfigured; disabled gives jornada_off; enabled but !loop_running gives scheduler_stopped; out of window with rearm_cause auto_close still gives outside_window; each SkipReason maps as specified; ManualInProgress gives pending; no skip + rearm auto_close gives closed_for_day; no skip + backoff Other gives start_backoff. Every returned value is in IDLE_REASONS.
- frontend/src-tauri/src/scheduled_recording/status_snapshot.rs (mod tests): jornada_view: in_window computed with active_window_at, ignoring enabled; rearm_cause present only while now < until; publish_tick ignored once publish_loop_running(false) has run (late-tick race). Use a local Slot helper, or reset SLOT at test start, and keep the tests serial in one #[test] to avoid cross-test interference on the static.
- frontend/src-tauri/src/scheduled_recording/status_snapshot.rs (mod tests): changed_fields: identical configs give empty (the diff guard for the double UI call); enabled toggle gives ["enabled"]; windows edit gives ["windows"]; JornadaConfig::from caps windows at 3 with windows_count=len; the serialized keys are fixed (golden key set).
- frontend/src-tauri/src/logging/commands.rs mod health_snapshot_tests: Update both literals; assert v["idle_reason"], v["jornada"]["phase"] (lowercase), v["jornada"]["skip"] null, v["jornada"]["backoff"]["kind"]; with None both serialize as null.
- frontend/src/services/healthHeartbeatService.test.ts: Optional: mock invoke to return a snapshot with idle_reason/jornada and assert platformLogger.log('health.heartbeat') payload carries both. The current file only tests shouldEmitHeartbeat.
- pre-build lints: node scripts/lint-telemetry.js passes (catalog mirror + doc backtick for jornada.settings_changed); full pnpm run tauri:build:debug exit 0 per commit.

## Risks
- A tick that lands after stop() re-publishes a stale phase (the same race exists for shared.phase between service.rs:336 and :450) → publish_tick is a no-op when slot.loop_running==false; start() sets loop_running=true before spawning the loop.
- The static slot makes tests share state across threads → Keep the core logic in pure fns (idle_reason, changed_fields, a view builder taking a Slot by value). Test those directly; limit static tests to a single serial #[test].
- Heartbeat `jornada` block adds ~250 B per beat (~100 beats/day/user) → It is dynamic state, not a static dimension, so it is compatible with the TELEMETRIA.md:386-392 rule. Static config goes only to device.profile + settings_changed. Document it in the cardinality paragraph.
- skip/in_window skew up to one tick (30 s) at window edges or right after a stop yields transient values → `pending` absorbs the transients. T5's day classification should aggregate over the day's idle heartbeats (mode or priority), not a single beat.
- Night windows: start_of_next_day after a 06:00 auto-close also suppresses that evening's 22:00 window (pre-existing behavior, not introduced here) → The ClosedForDay message avoids promising a time. Raise as an open question; out of scope for B3.
- Making SkipReason/StartFailureKind pub(crate) widens visibility → Only status_snapshot (a sibling module) consumes them; no Tauri/serde exposure beyond as_str/code strings.
- jornada config lands inside the consented incident bundle via incident.rs:327 → Local user data, already consented; the fields are schedule times only (no meeting_name_template).

## Manual verification
- B3: in Settings set window 09:00-18:00 and auto-close at a time 2-3 minutes from now with grace 0; start the jornada. At close, check the recording closes and the toast (the in-window arm on the next tick) reads 'La jornada de hoy ya se cerró; la grabación se reanudará en tu siguiente horario.', not 'siguiente hora en punto'.
- B3 regression: inside the window, stop the jornada recording from the UI. The toast must still say 'se reanudará a la siguiente hora en punto'.
- T1a: with DevTools, call invoke('get_health_snapshot') in the window after auto-close. Check idle_reason=='closed_for_day', jornada.rearm_cause=='auto_close', jornada.rearm_until is tomorrow 00:00:00, jornada.in_window==true.
- T1a: toggle the jornada off, then call get_health_snapshot: idle_reason=='jornada_off', jornada.loop_running==false, jornada.phase=='disabled'. Pause a recording: idle_reason=='paused_by_user'.
- T1a native: minimize to tray for >20 min (or temporarily lower JS_HEARTBEAT_SILENCE in a local build). Check the recording_logs outbox row for health.heartbeat reason=native contains idle_reason and jornada.
- T1b: first login shows device.profile in platform_logs with a `jornada` object. Change the window in Settings and save: exactly one jornada.settings_changed row with changed=["windows"]. Run the activation gate: one row, not two.
- All: `node scripts/lint-telemetry.js` green; `pnpm run tauri:build:debug` exit 0 after each commit; `graphify update .`.

## Open questions
- Should CheckNow switch to `tick.reset_immediately()` (service.rs:487)? Today 'Evaluar ahora' waits a full check_interval (30 s) before evaluating, and the UI's immediate reload() shows stale status. I was asked to report this only; it would be a one-line fix commit if approved.
- Should the heartbeat `jornada.skip` keep the legacy UI strings (no_input_device, mic_access_denied, registration_incomplete), or also use code-aligned names? This spec keeps the existing as_str for `skip` (UI event compatibility) and uses code-aligned names only in `idle_reason` and `backoff.kind`.
- Night shifts: after an auto-close at the end of a 22:00-06:00 window, start_of_next_day (service.rs:714-718) suppresses the same evening's window. Is that intended, or should the rearm deadline be the next window's start (schedule::next_fire_at)? Out of B3 scope.
- Coordinate with the B4 owner: the persisted rearm/backoff state should reuse `Rearm {until, cause}` (already Serialize/Deserialize) so that after a restart idle_reason keeps reporting closed_for_day/stopped_by_user.
- Should `rotate_scheduled` return its skip reason (service.rs:1025 and :939 are discarded for one tick)? Not needed for telemetry correctness; it would add an extra UI toast after a rotation restart failure.

## Unverified
- I have not run any build or test (read-only task). Compile details are unverified: const `Mutex::new(None)` for a non-const struct inside an Option (valid on std >= 1.63, but the toolchain version was not checked), and the `pub(crate)` visibility of the types.
- UNVERIFIED that no code outside scheduled_recording/ constructs or pattern-matches SchedulerShared.rearm_at. I grepped for rearm_at, RearmingNextHour and SkipReason across the repo and found only service.rs and ONBOARDING_Y_GATES.md, but I did not check macro-generated code.
- UNVERIFIED that no SQL query in the web repo, docs/*.sql or the piloto-analisis skill already reads a `jornada` or `idle_reason` key in heartbeat event_data (T5 owns the SQL).
- UNVERIFIED how Windows orders the heartbeat against the scheduler's first tick right after process start. The table maps that case to `pending`.
- UNVERIFIED that the rotation-race path (service.rs:935-940) actually happens in production. It is reasoned from code only.