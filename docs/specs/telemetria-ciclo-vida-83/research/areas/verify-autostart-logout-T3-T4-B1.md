# Verdict: needs_changes

## Issues
- [blocker] B1b: putting graceful_shutdown_before_exit inside clear_current_user safely covers a session lost mid-recording, and it is a no-op after logout_cleanup
  - Evidence: clear_current_user does not only run on logout. The effect at AuthContext.tsx:108-124 invokes it whenever maityUser?.id is falsy, and that includes the FIRST MOUNT, because useState<MaityUser|null>(null) at L95. database/commands.rs:521 says so itself: 'también dispara al montar AuthContext con maityUser aún null'. The webview reloads in production mid-session: useConversationLive.ts:306 `window.location.reload();` (the analysis watchdog on the conversation detail page), ChunkErrorRecovery.tsx:65/103, ErrorBoundary.tsx:68, and the inline script at app/(main)/layout.tsx:746. Every reload remounts AuthProvider, so clear_current_user runs while the Rust jornada recording keeps going. With B1b, any reload during a jornada would STOP the recording.
  - Fix: Keep the stop out of clear_current_user. Add a separate command (for example session_lost_cleanup) that does the stop and then the compare-and-clear. Invoke it only from the confirmed spontaneous SIGNED_OUT branch of the callback, deferred with setTimeout(0), so there is no await in the callback. Also fix the L108 effect so it only calls clear_current_user and cloud_sync_clear_session on a real Some->None transition (a prevMaityUserIdRef). The reload gap exists today too: it clears current_user_id and the Rust cloud session, and a jornada segment that finalizes in that window returns SegmentOutcome::Failed (service.rs:1288-1292). Keep B1b behind Julio's approval.
- [major] flush_now = loop drain_once inside tokio::time::timeout(budget); DRAIN_LOCK prevents double posting
  - Evidence: drain.rs:97-130: drain_once POSTs the rows one by one and calls mark_as_synced ONCE, after the whole batch. If the timeout cancels the future mid-batch, the rows that already got a 2xx are left unmarked and get POSTed again on the next tick, so platform_logs gets duplicates (up to 49 rows). The mutex does not help, because the problem is cancellation, not concurrency.
  - Fix: Do not cancel drain_once. Pass a deadline into drain_once and check it BETWEEN rows (break and mark what already went out), or mark each row right after its 2xx. Better: a targeted flush. RecordingLogRepository::log_event already returns the row id (Result<i64>, recording_log.rs:19), which emit_event/write_to_outbox discard. Expose a variant that returns the id and a flush_row(id) that POSTs only that row under DRAIN_LOCK.
- [major] auth.logout flushes the new row before the session is released (flush_now 4 s over the oldest-first outbox)
  - Evidence: get_unsynced_logs orders by created_at ASC LIMIT 50 (recording_log.rs:70), and the rows are POSTed serially. With a backlog (a day offline, heartbeats every 5-15 min) 4 s does not reach the newest row. A row rejected with 4xx stays unmarked forever at the head of the queue (drain.rs:111-120). A pass made only of poison rows returns Progress(0), which ends the loop. The attribution fallback via maity_user_id works, but the design goal (upload under the departing user's token) would fail in exactly the offline cases.
  - Fix: Use the targeted flush by row id (see the previous item) for auth.logout, and later for T2's app.exit. Keep the oldest-first loop only as best-effort.
- [major] boot_no_session: getSession() without a session + a persisted marker = session lost
  - Evidence: auth-js 2.93.3 GoTrueClient.js __loadSession ~L1235-1237: `const { data: session, error } = await this._callRefreshToken(...); if (error) { return this._returnResult({ data: { session: null }, error }); }`. This returns session null for ANY refresh error, including network errors. Meanwhile _recoverAndRefresh (~L1918-1925) KEEPS the session in storage when `isAuthRetryableFetchError(error)`. The typical pilot boot (autostart before Wi-Fi is up, access token expired overnight) therefore returns existingSession=null with the session still alive. The spec would emit auth.session_lost and consume the marker, a false positive every morning.
  - Fix: In initialize(), destructure `error` from getSession. Emit boot_no_session only when there is no error, or when the error is not retryable (isAuthRetryableFetchError from @supabase/supabase-js is false). Send error_name/status in the payload. Do not take the marker on a retryable error, so the next real transition or boot decides. navigator.onLine is not a reliable proxy.
- [minor] Call sites passing `surface` are optional; `typeof` normalization defends against onClick={signOut}
  - Evidence: PreferenceSettings.tsx:505 `onClick={signOut}`. After the change to `(surface?: LogoutSurface) => Promise<void>`, React's EventHandler (bivarianceHack) still needs MouseEvent to be assignable to LogoutSurface|undefined, or the reverse, and neither holds. That is a tsc error in `next build`, so the change at that call site is mandatory in commit 1. The runtime normalization is fine, but it never gets to run.
  - Fix: Make the PreferenceSettings.tsx:505 change (`onClick={() => void signOut('settings')}`) mandatory in the B1 commit. Keep the typeof guard for JS callers.
- [minor] SidebarFooterV5 header comment '... No volver a supabase.auth.signOut().' plus a fitness test with /\.auth\s*\.\s*signOut\s*\(/ over src excluding only AuthContext/maity-shared/tests
  - Evidence: The fitness test regex scans raw text, comments included. The proposed comment contains `supabase.auth.signOut()`, so the new test fails against its own fix.
  - Fix: Reword the comment (for example 'no llamar el signOut de supabase directo'), or strip comments before matching in the fitness test.
- [minor] auth.session_lost source='native_refresh_rejected' is a session loss
  - Evidence: cloud_sync/session.rs:226-240: a 400/401 from Rust's refresh happens with the webview ALIVE whenever the Rust copy carries an already-rotated refresh_token. AuthContext.tsx:581-586 says explicitly that the UI does NOT log out on CLOUD_SESSION_EXPIRED. Classifying it as auth.session_lost pollutes the #83 'sesión perdida' class and forces a fragile 5-minute dedupe.
  - Fix: Emit it as a separate event (for example `auth.native_session_expired`, 3 entries), or as a field outside the session_lost class, or leave it out. The #83 SQL should count only webview_signed_out and boot_no_session as a loss.
- [minor] Persist the login marker and the autostart baseline in telemetry.json (reuse STORE_FILE)
  - Evidence: tauri-plugin-store-2.4.2 store.rs:296 `fs::write(&self.path, bytes)?`, a non-atomic write. telemetry.json holds install_id (context.rs:13-14), the device key that T5's SQL correlates on. remember_login would write on EVERY boot, because current_user_id always starts as None, so set_current_user's was_logged_out is true on each process. A cut during the write (the PC-off scenario from B5) truncates the file, and install_id gets regenerated (context.rs:58-66).
  - Fix: Use a separate file (for example telemetry-state.json) for auth_last_user and autostart_last_state. Write only when the value changes (skip remember_login if the same maity_user_id is already stored).
- [minor] T3b: first run only saves the baseline and emits nothing (manual verification: 'first run of 0.2.62 -> NO autostart.changed')
  - Evidence: On a FRESH NSIS install, the boot reconcile (spawned in setup, before the webview) sees Run absent and writes baseline 'disabled'. Then useAutostartBootstrap.ts:76-78 runs enable(), and the proposed reconcile('bootstrap') emits disabled->enabled. Only an upgrade (bootstrap flag already done) emits nothing.
  - Fix: Document it as expected (a real change, trigger=bootstrap) and adjust the manual verification. Otherwise treat trigger 'bootstrap' as a baseline rewrite with no emit.
- [minor] classify_direct falls back to the auto-launch heuristic, so the telemetry and the plugin's is_enabled() always agree
  - Evidence: auto-launch-0.5.0 windows.rs:73-102: enabled = Run has a REG_SZ value (`get_value::<String>`) AND (no StartupApproved, OR len<8, OR the last 8 bytes are zero). The spec classifies [03, 0x11] as disabledByUser (the plugin says enabled), and first byte 03 with len<8 contradicts its own test 'len<8 -> enabled'. It also uses get_raw_value(...).is_ok() for Run instead of the REG_SZ read.
  - Fix: Derive the state with EXACTLY the auto-launch predicate, including the String read of Run. Use the first byte / bytes[4..12] only to extract disabled_at when the state is already disabledByUser. Fix the tests to match.
- [minor] Several file:line citations and commit mechanics
  - Evidence: NSIS_UNINSTALL_SUBKEY is at rival_install.rs:134 (not 133). In commit 1, logout_cleanup gets `surface: Option<String>` but ignores it, which triggers an unused-variable warning. B1b's compare-and-clear leaves a window in which the scheduler loop (30 s tick, has_session still true) can start a new recording between the stop and the clear (UNVERIFIED whether close_owned_segment_for_exit rearms first).
  - Fix: Correct the line. Name the parameter `_surface` or log it in commit 1. If B1b stays, re-check has_session/rearm_at in the scheduler before the clear, or clear first and stop afterwards with the snapshot user id passed explicitly.

## Confirmed claims
- B1 is real: SidebarFooterV5.tsx:36-38 `await supabase.auth.signOut(); navigate('/')`. `supabase` from '@maity/shared' is the same client as '@/lib/supabase' (maity-shared.ts:12,19), so the SIGNED_OUT reaches the listener. That path only runs setMaityUser(null) -> clear_current_user; it never runs logout_cleanup.
- The only direct `.auth.signOut(` calls in frontend/src are AuthContext.tsx:925 and SidebarFooterV5.tsx:37. There are none in maity-shared.
- clear_current_user (database/commands.rs:510-530) only clears state, closes the coach and unloads STT. finalize_segment_native returns Failed without a user (scheduled_recording/service.rs:1288-1292).
- AuthContext.signOut order: logout_cleanup (L905), then cloud_sync_clear_session (L911), then clearing local state (L920-922), then supabase.auth.signOut (L925). isSigningOut makes the listener ignore the SIGNED_OUT (L450-453).
- logout_cleanup (lib.rs:157-169) only runs a 30 s timeout around graceful_shutdown_before_exit (lib.rs:1833) and emits nothing.
- drain.rs has no lock and no public flush. drain_once is private, defers without a CloudSyncState session (L68-74), reads 50 rows oldest-first and marks them only at the end of the batch.
- ESLint: an override already disables no-restricted-syntax for src/shared/maity-shared/** (.eslintrc.json:57-60). The proposed selector matches `supabase.auth.signOut()`.
- auto-launch 0.5.0: is_enabled ANDs in StartupApproved (last 8 bytes zero); enable() rewrites 0x02; disable() only deletes the Run value.
- device.profile on the direct channel maps is_enabled to enabled/disabled with no disabledByUser (logging/commands.rs:430-444). DeviceProfile only derives Serialize and has a single literal (L454).
- startup_task_get_state returns 'unsupported' outside MSIX, and with_mta exists (startup_task.rs:47-61, 92-106). package_signature_kind uses Package::Current() inside with_mta.
- winreg 0.56 has query_info() and get_last_write_time_system() (reg_key.rs:422, reg_key_metadata.rs:57). winreg and chrono are already deps.
- telemetry.json holds only install_id and STORE_FILE is private (context.rs:13-14).
- emit_event signature and the drop when AppState is missing (emit.rs:41-62, 103-110). TelemetryStatus has Ok and Warning.
- AppState is managed synchronously in setup (block_on at lib.rs:696) before the panics block (lib.rs:1060-1066), so a reconcile spawned there can already write to the outbox.
- build.rs only calls tauri_build::build(): custom commands need no ACL entry.
- lint-telemetry checks (b) the TS<->Rust mirror via regex and (f) the backticked name in docs/TELEMETRIA.md; the new names do not trip check (d).
- recording_phase exposes current_phase(), as_str() and is_session_active(). is_recording() is in audio/recording_commands.rs:54.
- The Rust refresh 400/401 branch clears the session and emits CLOUD_SESSION_EXPIRED; the frontend only logs a warn (session.rs:226-240, AuthContext.tsx:584-586).
- auth-js 2.93.3 is the installed version. getSession runs before onAuthStateChange subscribes (AuthContext.tsx:412 vs 446).

## Corrected design notes
1) B1: keep it as designed. Changing PreferenceSettings.tsx:505 to `() => void signOut('settings')` is REQUIRED, because otherwise tsc breaks. Reword the SidebarFooterV5 comment so it does not contain the literal `.auth.signOut(`, which the fitness test would catch.

2) Related fix, recommended before B1b: the AuthContext.tsx:108 effect should call clear_current_user and cloud_sync_clear_session only on a real Some->None transition (a prevMaityUserIdRef), not on mount. Today every webview reload (useConversationLive.ts:306, ChunkErrorRecovery, ErrorBoundary) releases the user and the Rust cloud session while a jornada is recording.

3) B1b, only with Julio's approval: a new command session_lost_cleanup (stop, then compare-and-clear) invoked ONLY from the spontaneous SIGNED_OUT branch via setTimeout(0). Never put it inside clear_current_user.

4) Drain: never cancel drain_once with timeout. Instead:
   - add a deadline checked between rows, or mark each row as soon as its 2xx arrives;
   - add a targeted flush_row(id) under DRAIN_LOCK, using the id that log_event already returns (change write_to_outbox/emit_event to return Option<i64>);
   - auth.logout and T2's app.exit use flush_row.

5) boot_no_session: emit only when getSession returns no error, or a non-retryable error (isAuthRetryableFetchError false). On a retryable error do not consume the marker.

6) native_refresh_rejected: make it a separate event, or leave it out, and keep it outside the 'session lost' class.

7) Persist auth_last_user and autostart_last_state in their own file (for example telemetry-state.json), writing only on change. Reason: plugin-store's save is a non-atomic fs::write, and telemetry.json holds install_id.

8) classify_direct: compute the state with exactly auto-launch's predicate (Run REG_SZ + last 8 bytes); byte 0 / bytes[4..12] are used only for disabled_at. Document that a fresh NSIS install emits autostart.changed disabled->enabled with trigger=bootstrap.

9) Mechanics:
   - NSIS_UNINSTALL_SUBKEY is at rival_install.rs:134;
   - name the placeholder parameter `_surface` in commit 1;
   - lib.rs changes fall under Guardian (backup/ branch) versus 'do not create branches': the orchestrator or Julio decides;
   - UNVERIFIED: whether Package.InstalledDate and the Uninstall\Maity last-write time change on every update in production.