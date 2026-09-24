# Verdict: needs_changes

## Issues
- [major] T4b boot_no_session: 'a boot without a session while a persisted login marker exists' means the session was lost
  - Evidence: auth-js 2.93.3 GoTrueClient.js __loadSession L1207-1237: when the stored access token is expired it calls `_callRefreshToken` and on ANY error returns `{ data: { session: null }, error }`. A retryable/network error does not remove the session: `_recoverAndRefresh` L1920-1926 only calls `_removeSession()` `if (!isAuthRetryableFetchError(error))`, and `_callRefreshToken` L1985-1992 behaves the same way. AuthContext.tsx:412 destructures only `data` and ignores `error`. The pilot's typical case is: PC off overnight, then Windows autostart runs Maity before Wi-Fi is up. The token has expired and the network is down, so getSession returns null while the session is still stored. The spec would then emit a false auth.session_lost every morning and also consume the marker, which hides a real loss that happens later.
  - Fix: In initialize(), read `{ data, error }`. Emit boot_no_session only when `error` is null, or when it is a non-retryable AuthError. Never emit on isAuthRetryableFetchError or when `navigator.onLine === false`. Take the marker only in the branch that actually emits. As an optional extra check, confirm that the auth storage key is really absent from localStorage.
- [major] flush_now loops drain_once inside tokio::time::timeout(budget) and is safe thanks to DRAIN_LOCK
  - Evidence: drain.rs:97-130 posts rows one by one and calls `mark_as_synced` only ONCE at the end of the pass. If timeout() drops the drain_once future after some post_row calls return 2xx but before mark_as_synced, those rows stay `synced_to_cloud = 0` and the next tick posts them again. The result is duplicate rows in maity.platform_logs, which is the exact failure the lock is meant to prevent. There is also head-of-line blocking: rows rejected with 4xx/5xx stay unsynced (L111-120) and the query is oldest-first LIMIT 50 (recording_log.rs:70). If the head of the queue holds rejected rows, a pass reports Progress(0), the loop stops, and the new auth.logout row is never reached.
  - Fix: Do not cancel drain_once. Pass it a deadline and check it between rows (break when it passes), or mark each row as synced right after its 2xx. Better still, make the logout flush post the specific row just written: have write_to_outbox/emit_event return the inserted id, and add a flush_ids(ids, budget) in drain.rs so the single-writer lint check (a) still holds.
- [major] B1b: stopping and saving inside clear_current_user on a spontaneous SIGNED_OUT fixes a data-loss bug
  - Evidence: graceful_shutdown_before_exit (lib.rs:1833-1844) -> close_owned_segment_for_exit (service.rs:393-407) -> close_scheduled, which sets `rearm_at = Some(start_of_next_day(now))` (service.rs:810/841/899). Today current_user_id is checked only when the segment is finalized (service.rs:1288-1292). A user who logs back in before the segment closes therefore gets it saved, and the jornada keeps going. With B1b, any spontaneous session loss (refresh rejected, revoked) ends the jornada for the REST OF THE DAY, even if the user logs back in a minute later. That is a net regression for the #83 goal of recording business days.
  - Fix: Drop B1b from this area, or make it conditional on B4. If kept, it must not go through close_scheduled's next-day rearm. It needs its own rearm policy, for example rearm on the next set_current_user, and Julio's explicit approval. At minimum, document this side effect in the open question.
- [minor] auth.session_lost source='native_refresh_rejected' is a session-loss signal
  - Evidence: cloud_sync/session.rs:226-240 clears ONLY Rust's copy. AuthContext.tsx:581-586 says so explicitly: 'NO forzamos logout de la UI: supabase-js tiene su propio ciclo de refresh y puede seguir vivo'. A 400 often only means supabase-js rotated the refresh token first. Filing it under auth.session_lost adds false positives to the #83 classification, and the proposed 5-min dedupe only works when a webview_signed_out actually follows.
  - Fix: Either drop it, or emit it as a separate event (for example `cloud_sync.session_expired`, which needs its own 3 catalog entries) and keep it out of the 'sesión perdida' class.
- [minor] Classification SQL: attribute via `coalesce(mu.auth_id, pl.user_id)` joining maity.users on id = event_data->>'maity_user_id'
  - Evidence: docs/TELEMETRIA.md:39-40: the RPC 'resuelve `user_id` desde `maity.users WHERE auth_id = auth.uid()`', so platform_logs.user_id is already maity.users.id. The proposed coalesce mixes auth ids with maity ids, which breaks the join (see MEMORY: auth.users.id != maity.users.id).
  - Fix: Use `coalesce((pl.event_data->>'maity_user_id')::uuid, pl.user_id)` with no join to auth_id.
- [minor] classify_direct falls back to the auto-launch heuristic so telemetry and plugin/UI always agree
  - Evidence: auto-launch-0.5.0/src/windows.rs `is_enabled` = `al_enabled && last_eight_bytes_all_zeros(bytes).unwrap_or(true)`, which never looks at byte 0. The spec maps `b[0]==0x03` to disabledByUser even when the last 8 bytes are zero, where the plugin says enabled. Its own tests are inconsistent too: '[03,...,0*8] -> disabledByUser' and 'len<8 -> enabled' contradict the rule that 'None or len<1 -> enabled; b[0]==3 -> disabledByUser'.
  - Fix: Derive `state` exactly as auto-launch does: Run value present as REG_SZ AND (approved None OR len<8 OR last 8 bytes all zero) means enabled. With Run present and a non-zero tail it is disabledByUser; with no Run value it is disabled. Report `approved_first_byte` as a separate raw field, and set disabled_at from bytes 4..12 only when the tail is non-zero. Check Run presence the way the plugin does (`get_value::<String>`), not with get_raw_value.
- [minor] reconcile always persists the new baseline; the login marker is taken before emitting
  - Evidence: emit_event returns () and silently drops the event when AppState is missing (emit.rs:103-110) or when the outbox write fails (emit.rs:126-128). setup.rs manages AppState even on DB-init failure, but a failed pool write still drops the event. If the baseline moves forward after a dropped emit, that autostart change is lost for good. telemetry_auth_session_lost has the same problem: it takes the marker first and then emits.
  - Fix: Add a variant that reports whether the write succeeded (for example `emit_event_checked -> bool`). Advance the baseline and take the marker only when the row is durably in the outbox.
- [minor] autostart.changed trigger 'settings_toggle' is the missing telemetry for Settings toggles
  - Evidence: PreferenceSettings.tsx handleToggleAutostart already calls `Analytics.track('autostart_toggled', {enabled, channel})` on both branches. lib/analytics.ts:41 passes it straight to `platformLogger.log(eventName, ...)`, so it already reaches maity.platform_logs. The spec never mentions this.
  - Fix: Document `autostart_toggled` as the existing source in T5, dedupe the two in the SQL, or drop the settings_toggle trigger and rely on boot/bootstrap reconcile together with autostart_toggled.
- [minor] signOut(surface) from the chat sidebar is safe as-is
  - Evidence: AuthContext.tsx:895-940 stores signOutPromise.current but never checks it on entry, so every call starts a new doSignOut. From the chat footer the handler awaits logout_cleanup (up to 30 s) plus the new flush (up to 4 s) with no feedback, so a second click is likely. That runs two logout_cleanup calls and, with T4, writes two auth.logout rows; the second reports recording_was_active=false and phase 'stopping'.
  - Fix: At the top of signOut: `if (signOutPromise.current) return signOutPromise.current`. Also consider a disabled or pending state on the menu item.
- [minor] The logout flush runs under the leaving user's token with no side effects
  - Evidence: get_valid_token refreshes when fewer than 120 s remain (session.rs:26, 175-194). A refresh rotates the refresh_token and emits CLOUD_SESSION_REFRESHED (L285-294), which AuthContext.tsx:565-570 handles by calling supabase.auth.setSession while signOut is moving on to supabase.auth.signOut(). The auth-js lock probably serializes the two, but this adds a refresh right at the moment of logout, and the event and IPC-response ordering is UNVERIFIED.
  - Fix: For the logout flush, use a reuse-only token path: skip the flush if the token needs a refresh and leave the row, which carries maity_user_id, to the normal drain.
- [minor] Commit 1: Rust accepts `surface: Option<String>` and ignores it
  - Evidence: Tauri maps the command argument's name to the invoke key. Naming the unused parameter `_surface` to silence the unused-variable warning changes the key, and `{ surface }` then silently arrives as None. This is the same silent-None failure CLAUDE.md warns about for snake_case keys.
  - Fix: Keep the parameter named `surface` and write `let _ = &surface;` until commit 4. Minor line corrections: logout_cleanup is at lib.rs:158 and NSIS_UNINSTALL_SUBKEY at rival_install.rs:134.

## Confirmed claims
- B1 confirmed: SidebarFooterV5.tsx:3 imports `supabase` from '@maity/shared', and :36-38 `await supabase.auth.signOut(); navigate('/')`. It is mounted by CombinedSidebar.tsx:5/98.
- The only direct `.auth.signOut(` calls in frontend/src are AuthContext.tsx:925 and SidebarFooterV5.tsx:37. The other logouts use useAuth().signOut: layout.tsx:257, OnboardingAccountBadge.tsx:74, SidebarControls.tsx:64 and PreferenceSettings.tsx:505 (`onClick={signOut}`, which passes the MouseEvent).
- AuthContext.signOut order: isSigningOut=true (L897), logout_cleanup (L905), cloud_sync_clear_session (L911), local clear (L920-922), supabase.auth.signOut (L925). The listener ignores events while isSigningOut is set (L450-453).
- clear_current_user (database/commands.rs:510-530) only clears state, closes the coach and unloads STT; it does not stop the recording. It also fires at mount while maityUser is null.
- logout_cleanup (lib.rs:158-169) runs only the graceful stop with a 30 s timeout and emits no telemetry.
- drain.rs has no lock and no flush API; it defers silently without a CloudSyncState session (L68-74) and marks rows synced only at the end of a pass (L124-130).
- The Rust refresh on 400/401 clears its copy and emits CLOUD_SESSION_EXPIRED (session.rs:226-240); the frontend only logs a warning (AuthContext.tsx:584-586).
- auth-js: getSession awaits initialization, and _recoverAndRefresh/_callRefreshToken remove the session only on non-retryable errors (GoTrueClient.js:1920-1926, 1985-1992).
- auto-launch 0.5.0: is_enabled ANDs the Run key with the StartupApproved tail check; enable() rewrites StartupApproved to 0x02; disable() deletes only the Run value. The plugin's app_name defaults to package_info().name.
- The Tauri CLI 2.9.6 NSIS template writes no InstallDate. Its Uninstall key writes are DisplayIcon/DisplayName/DisplayVersion/HelpLink/InstallLocation/MainBinaryName/Publisher/UninstallString/URLInfoAbout/URLUpdateInfo, plus the DWORDs EstimatedSize/NoModify/NoRepair.
- winreg 0.56 has query_info() and get_last_write_time_system() (a UTC SYSTEMTIME via FileTimeToSystemTime).
- DeviceProfile is built as a literal in only one place (logging/commands.rs:454); autostart_state comes from startup_task_get_state or plugin is_enabled (L430-444).
- telemetry.json holds only install_id (context.rs:13-14), and nothing else in the frontend references it.
- tokio 1.49 Mutex::const_new is available and already used (engine.rs:90); chrono 0.4.43 has DateTime::from_timestamp; TelemetryStatus has Ok and Warning.
- build.rs is a plain tauri_build::build() with no AppManifest, so new custom commands need no capability entries.

## Corrected design notes
Keep B1 as specified: route the button through useAuth().signOut, add the ESLint selector and fitness test, and put the eslint-disable on AuthContext:925. Also add a re-entry guard: signOut should return signOutPromise.current while one is in flight. Name the Rust parameter `surface`, not `_surface`.

Take B1b out of this area. Stopping inside clear_current_user goes through close_scheduled, which rearms for the next day. Today a quick re-login saves the segment; with B1b the jornada is lost for the rest of the day. It needs its own rearm policy (or B4) and Julio's approval.

Drain changes (shared with T2):
- Never wrap drain_once in tokio::time::timeout. Use a deadline checked between rows, or mark each row synced right after its 2xx.
- Give logout a targeted flush of the row it just wrote: have emit return the row id, and add drain::flush_ids(ids, deadline).
- Use a reuse-only token for that flush (no refresh during logout).
- DRAIN_LOCK stays.

auth.session_lost changes:
- boot_no_session fires only when getSession returned `error == null`, or a non-retryable AuthError, AND the marker exists. Never fire on retryable/network errors or when navigator.onLine is false; offline autostart with an expired token is the common pilot case.
- Take the marker only when emitting, and only after the outbox write succeeds.
- native_refresh_rejected is not a session loss. Drop it, or move it to a separate event.

T3 autostart:
- Derive `state` exactly like auto-launch (Run REG_SZ present AND StartupApproved tail zero, or absent / len<8). Report the raw first byte separately, and set disabled_at only when the tail is non-zero.
- Advance the telemetry.json baseline only after a confirmed outbox write.
- Account for the existing `autostart_toggled` analytics event, which already reaches platform_logs through Analytics.track, in the T5 SQL.

T5 SQL attribution: platform_logs.user_id is already maity.users.id. Use `coalesce((event_data->>'maity_user_id')::uuid, pl.user_id)`, not auth_id.

package_installed_at is fine as designed. It is still UNVERIFIED that the NSIS updater rewrites the Uninstall key, and that InstalledDate changes on Store updates.