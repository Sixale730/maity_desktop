# T3 autostart.changed + package_installed_at, T4 auth.logout / auth.session_lost, B1 logout del sidebar del chat (issue #83)

## Summary
B1 is confirmed. The chat sidebar footer calls supabase.auth.signOut() directly, so logout_cleanup never runs and an active recording loses its segment, because finalize_segment_native needs current_user_id. The fix routes the button through useAuth().signOut and adds an ESLint guard plus a fitness test. The only other direct call site is AuthContext itself. The web repo deleted shell-v5 (b0f8de1e), so the desktop copy is already an adapted fork and cannot drift from the web.

T4 uses the existing order in signOut: logout_cleanup runs before cloud_sync_clear_session. Rust therefore still holds the cloud session and can emit auth.logout and flush it before the session is cleared. The flush needs a serialized drain, which T2 also needs. auth.session_lost has three sources. The first is the webview SIGNED_OUT event when the user did not start the logout. The second is a boot without a session while a persisted login marker exists; auth-js drops dead sessions inside initialize(), before our listener subscribes, so the listener alone would miss this case. The third is Rust's own refresh being rejected with 400/401. Every payload carries maity_user_id, because a row drained later is attributed to whoever logs in next.

T3 corrects one premise. auto-launch 0.5.0 already reads StartupApproved\Run: is_enabled() returns false when Task Manager disabled the entry, so the Settings toggle is already correct. The real gap is telemetry: 'disabled' and 'disabledByUser' look the same, and enable() silently overwrites the Task Manager choice with 0x02. The design reads the Run key and StartupApproved with winreg on the direct channel and reports 'disabledByUser' plus disabled_at (the FILETIME in bytes 4..12). A baseline saved in telemetry.json drives autostart.changed; on first run it only saves the baseline and emits nothing. package_installed_at comes from Package.Current().InstalledDate() under MSIX ("installed or last updated", per Microsoft docs). On the direct channel it comes from the last-write time of the NSIS Uninstall key, because the Tauri CLI 2.9.6 NSIS template writes no InstallDate (verified in the CLI binary).

## Current behavior
- B1: the chat sidebar logout bypasses AuthContext.signOut and logout_cleanup — frontend/src/shared/components/shell-v5/SidebarFooterV5.tsx:3 `import { supabase, useAvatarWithDefault } from '@maity/shared';` and :36-38 `const handleLogout = async () => { await supabase.auth.signOut(); navigate('/'); };`. Mounted by CombinedSidebar (shell-v5/CombinedSidebar.tsx:5), which MaityChatLayout.tsx:2/224 uses, rendered by app/(main)/chat/page.tsx:24.
- Consequence of B1: the SIGNED_OUT listener clears the user without stopping the recording, so a jornada segment is not saved — AuthContext.tsx:446-486 callback -> setMaityUser(null) (L485); the effect at L108-124 invokes clear_current_user + cloud_sync_clear_session. database/commands.rs:510-530 clear_current_user only clears state and unloads STT; it does not stop the recording. scheduled_recording/service.rs:1288-1292 `let Some(user_id) = state.current_user_id().await else { warn!("... sin usuario logueado; segmento queda local-only ..."); return SegmentOutcome::Failed; }`
- The only direct supabase.auth.signOut() call sites in the desktop are AuthContext and SidebarFooterV5 — grep over frontend/src: contexts/AuthContext.tsx:925 and shared/components/shell-v5/SidebarFooterV5.tsx:37. None in src/shared/maity-shared. The other logouts already go through useAuth().signOut: layout.tsx:257, OnboardingAccountBadge.tsx:74, PreferenceSettings.tsx:505 (`onClick={signOut}` passes the MouseEvent as the first argument), SidebarControls.tsx:64.
- useUser is a shim over AuthContext and does not expose signOut — frontend/src/contexts/UserContext.tsx: `export function useUser(): UserContextValue { const { maityUser, isLoading, retryFetchMaityUser } = useAuth(); ... }` returns {userProfile, loading, refreshUser}
- The web repo deleted shell-v5, and its shell-v6 still calls supabase.auth.signOut directly (not a problem on the web, which has no logout_cleanup) — C:\maity: `git log -- src/shared/components/shell-v5/SidebarFooterV5.tsx` -> b0f8de1e `chore(shell-v5): remove legacy shell module`. C:\maity/src/shared/components/shell-v6/SidebarFooter.tsx:53-55 `await supabase.auth.signOut(); navigate('/');`. CombinedSidebar.tsx in the desktop already says 'Versión simplificada del CombinedSidebar de la web'.
- In AuthContext.signOut, logout_cleanup runs BEFORE cloud_sync_clear_session and supabase.auth.signOut, so the Rust session is still alive during logout_cleanup — AuthContext.tsx:905 `await invoke('logout_cleanup')`, :911 `await invoke('cloud_sync_clear_session')`, :920-922 clear local state, :925 `await supabase.auth.signOut()`. isSigningOut.current=true (L897) makes the listener ignore the SIGNED_OUT that this logout produces (L450-453).
- logout_cleanup only runs the graceful stop; it emits no telemetry — frontend/src-tauri/src/lib.rs:157-169 `async fn logout_cleanup<R: Runtime>(app: AppHandle<R>) -> Result<(), String> { if tokio::time::timeout(Duration::from_secs(30), graceful_shutdown_before_exit(&app)).await.is_err() { log::warn!(...) } Ok(()) }`; registered at lib.rs:1604.
- The drain has no lock and no flush API; it defers when there is no CloudSyncState session and takes the 50 oldest rows — logging/telemetry/drain.rs:35-45 run loop; :49 `async fn drain_once` (private) with no mutex; :71-76 `let Some(session) = session else { return; };`; repositories/recording_log.rs:70 `... WHERE synced_to_cloud = 0 ORDER BY created_at ASC LIMIT ?`
- platformLogger (JS) posts straight to the RPC through supabase-js, so it cannot report a lost session; only the Rust outbox survives it — frontend/src/lib/platformLogger.ts:100 `await supabase.schema('public').rpc('insert_platform_log', {...})`
- A session lost AT BOOT never reaches the listener: auth-js removes it inside initialize(), and getSession awaits that before we subscribe — auth-js 2.93.3 GoTrueClient.js:1092 `async getSession() { await this.initializePromise; ...`; :1909/:1922 `_recoverAndRefresh` -> `await this._removeSession()`; :2082 `_notifyAllSubscribers('SIGNED_OUT', null)`. AuthContext.tsx:412 `await supabase.auth.getSession()` runs BEFORE `supabase.auth.onAuthStateChange(...)` at L446.
- While the app is running, auth-js emits SIGNED_OUT when a refresh fails with a non-retryable error — GoTrueClient.js:1985-1992 `if (isAuthError(error)) { ... if (!isAuthRetryableFetchError(error)) { await this._removeSession(); }`
- The Rust refresh already detects invalid_grant, clears its copy and only emits a UI event; the frontend just logs a warning — cloud_sync/session.rs refresh(): `if status == BAD_REQUEST || status == UNAUTHORIZED { ... *guard = None; ... app.emit(events::CLOUD_SESSION_EXPIRED, json!({})) ... return Err(ERR_SESSION_EXPIRED...)`; AuthContext.tsx:584-586 `subs.on(TauriEvent.CLOUD_SESSION_EXPIRED, () => { logger.warn(...) })`
- T3 premise CORRECTED: auto-launch 0.5.0 already reads StartupApproved; is_enabled() returns false when Task Manager disabled the entry, and enable() overwrites the override with 0x02 — auto-launch-0.5.0/src/windows.rs: `static TASK_MANAGER_OVERRIDE_REGKEY = "SOFTWARE\\...\\Explorer\\StartupApproved\\Run"`; `is_enabled`: `Ok(al_enabled && task_manager_enabled.unwrap_or(true))`; `task_manager_enabled` -> `last_eight_bytes_all_zeros(bytes)`; `enable()` writes Run and `set_raw_value(&self.app_name, REG_BINARY [0x02,0,...])`. `disable()` only deletes the Run value (StartupApproved stays). The local registry confirms this: StartupApproved\Run\Maity = {2,0,0,0...} while Run has no Maity entry.
- On the direct channel the Run value name is 'Maity' — tauri-plugin-autostart-2.5.1/src/lib.rs:178-182 `app_name = self.app_name.unwrap_or_else(|| &app.package_info().name)`; lib.rs:641-644 init without app_name; tauri-codegen-2.6.2/src/context.rs:268 package_name = product_name; tauri.conf.json:3 `"productName": "Maity"`.
- device.profile.autostart_state on the direct channel cannot tell 'disabled' (turned off in the app) from 'disabledByUser' (Task Manager) — logging/commands.rs:430-444: under 'unsupported', `match app.autolaunch().is_enabled() { Ok(true) => "enabled", Ok(false) => "disabled", Err(_) => "unknown" }`
- The direct-channel Settings toggle already shows off when Task Manager disabled autostart, and turning it on re-enables autostart silently (unlike MSIX, where the app cannot re-enable it) — PreferenceSettings.tsx:121 `isAutostartEnabled()` (plugin -> auto-launch is_enabled with the StartupApproved AND); :166-172 enableAutostart(); the disabledByUser warning exists only for `isPackaged` (L399).
- StartupApproved format: 02 00.. = enabled; 03 00 00 00 + 8-byte FILETIME = disabled (the disable date) — Web: Nutanix blog 'Windows OS Optimization Essentials, Part 4' / tenforums (search result). Other first-byte values (0x06/0x07/0x01 as seen for Docker) are UNVERIFIED.
- The Tauri NSIS template does NOT write InstallDate to the Uninstall key — @tauri-apps/cli-win32-x64-msvc 2.9.6 .node: grep 'InstallDate' = 0; it only writes DisplayIcon, DisplayName, DisplayVersion, HelpLink, InstallLocation, MainBinaryName, Publisher, UninstallString, URLInfoAbout, URLUpdateInfo. Key: rival_install.rs:133 `NSIS_UNINSTALL_SUBKEY = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\Maity"` (HKCU, then HKLM).
- Package.InstalledDate is available with the features already enabled and returns 'installed or last updated' — windows-0.58.0/src/Windows/ApplicationModel/mod.rs:1684 `pub fn InstalledDate(&self) -> Result<Foundation::DateTime>` with no extra cfg; Foundation/mod.rs:2371 `pub struct DateTime { pub UniversalTime: i64 }`; learn.microsoft.com Package.InstalledDate: 'Gets the date on which the application package was installed or last updated.'
- The MSIX WinRT pattern with COM MTA already exists and is used in get_device_profile — startup_task.rs `pub(crate) async fn with_mta<T,F>(f: F)`; logging/commands.rs:446-449 `crate::startup_task::with_mta(|| Ok(crate::utils::package_signature_kind())).await`
- winreg 0.56 exposes the key's last-write time — winreg-0.56.0/src/reg_key.rs:422 `pub fn query_info(&self) -> io::Result<RegKeyMetadata>`; reg_key_metadata.rs:57 `get_last_write_time_system() -> SYSTEMTIME` (the FileTime inner is pub(crate); the chrono feature is not enabled).
- telemetry.json is the telemetry store; today it only holds install_id — logging/telemetry/context.rs:13-14 `const STORE_FILE: &str = "telemetry.json"; const INSTALL_ID_KEY: &str = "install_id";` (private).
- DeviceProfile is built in exactly one place, and the TS mirror spreads it as-is into device.profile — logging/commands.rs:454 (the only `DeviceProfile {` literal); services/healthHeartbeatService.ts:108-122 interface; :191-192 `this.deviceProfile = await invoke<DeviceProfile>('get_device_profile'); void platformLogger.log('device.profile', { ...this.deviceProfile })`
- The app has no ACL manifest for custom commands (new commands need no capability) — src-tauri/build.rs contains no AppManifest/commands(; lint-tauri-acl.js only checks window/dialog/app calls.

## Design
## 0. Coordination with other areas

- **Drain flush (shared with T2).** If T2 lands `drain::flush_now` first, reuse it and skip Commit 3. Otherwise Commit 3 adds it and T2 reuses it.
- **DeviceProfile / healthHeartbeatService.ts.** T1 also adds fields here. Take the most recent version and add fields without reordering.
- **Catalog.** Each new name needs 3 entries (`telemetry-events.ts`, `catalog.rs`, a row in `docs/TELEMETRIA.md`), in the same commit that emits it. `lint-telemetry.js` checks (b) and (f).
- **Store.** Everything is persisted in `telemetry.json` (tauri-plugin-store). In `logging/telemetry/context.rs:13`, change `const STORE_FILE` to `pub(crate) const STORE_FILE` so the key is not duplicated.

---

## 1. B1 — the chat sidebar logout goes through AuthContext.signOut

**`frontend/src/shared/components/shell-v5/SidebarFooterV5.tsx`**
- L3: `import { useAvatarWithDefault } from '@maity/shared';` (remove `supabase`).
- New: `import { useAuth } from '@/contexts/AuthContext';`
- In the component: `const { signOut } = useAuth();`
- `handleLogout = async () => { await signOut('chat_sidebar'); navigate('/'); };`
- Add a header comment: "ADAPTACIÓN DESKTOP: la web borró shell-v5 (Sixale730/maity b0f8de1e); aquí el logout DEBE pasar por AuthContext.signOut → logout_cleanup (guarda la grabación activa antes de soltar current_user_id). No volver a supabase.auth.signOut()."

**`frontend/src/contexts/AuthContext.tsx`**
- Signature: `signOut: (surface?: LogoutSurface) => Promise<void>`.
  - Export `type LogoutSurface = 'settings' | 'sidebar' | 'chat_sidebar' | 'onboarding_badge' | 'account_error' | 'unknown'`.
  - Inside, normalize: `const s = typeof surface === 'string' ? surface : 'unknown'`. This defends against `onClick={signOut}`, which passes a MouseEvent.
- L905: `await invoke('logout_cleanup', { surface: s })`.
- L925: add `// eslint-disable-next-line no-restricted-syntax -- único logout autorizado: logout_cleanup corre antes` above `supabase.auth.signOut()`.

**Call sites (optional, for the `surface` field):**
- `PreferenceSettings.tsx:505` → `onClick={() => void signOut('settings')}`
- `SidebarControls.tsx:64` → `'sidebar'`
- `OnboardingAccountBadge.tsx:74` → `'onboarding_badge'`
- `app/(main)/layout.tsx:257` → `'account_error'`

**`frontend/.eslintrc.json`** — add a 4th selector to `no-restricted-syntax`:
```json
{"selector":"CallExpression[callee.property.name='signOut'][callee.object.property.name='auth']",
 "message":"Nada de supabase.auth.signOut() directo: usa useAuth().signOut(surface). Solo AuthContext hace el signOut, DESPUÉS de logout_cleanup (guarda la grabación activa; sin eso el segmento de jornada se pierde por falta de current_user_id). Ver docs/NUBE_CUENTAS_SYNC.md."}
```
The existing `src/shared/maity-shared/**` override already disables the rule there.

**Test:** fitness test `frontend/src/contexts/authSignOut.fitness.test.ts`. It walks `src/**/*.{ts,tsx}`, excluding `*.test.*`, `src/shared/maity-shared/**` and `contexts/AuthContext.tsx`. It fails if any file matches `/\.auth\s*\.\s*signOut\s*\(/`. This is the same style as `app/(main)/layout.test.ts`.

**Docs:** `docs/NUBE_CUENTAS_SYNC.md` — one line: "todo logout pasa por `AuthContext.signOut` (ESLint + fitness test)".

---

## 2. B1b (hardening, same bug class) — a lost session mid-recording saves before releasing the user

**Problem.** A spontaneous SIGNED_OUT (refresh rejected, session revoked) → the effect at `AuthContext.tsx:108-124` → `clear_current_user`. The recording keeps going without a user, and the segment ends up `Failed` (`service.rs:1288`).

**Fix in `database/commands.rs:510` `clear_current_user`:**
1. Before clearing:
   ```rust
   let snapshot = state.current_user_id().await;
   if crate::audio::recording_commands::is_recording().await && snapshot.is_some() {
       let _ = tokio::time::timeout(Duration::from_secs(30), crate::graceful_shutdown_before_exit(&app)).await;
   }
   ```
2. **Compare-and-clear:**
   ```rust
   let mut g = state.current_user_id.write().await;
   if *g == snapshot { *g = None; } else { info!("clear_current_user: otro login ganó durante el stop; no se limpia"); return Ok(()); }
   ```
   `registration_completed` is cleared only in that same branch.
3. Idempotent: after logout_cleanup, `is_recording()` is false and this is a no-op.

**Open question:** this is a user-visible behavior change. It needs Julio's approval and could be dropped from the plan.

---

## 3. Serialized drain + bounded flush (shared with T2)

In **`logging/telemetry/drain.rs`**:
```rust
static DRAIN_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
async fn drain_once<R: Runtime>(app: &AppHandle<R>) -> DrainPass { let _g = DRAIN_LOCK.lock().await; ... }
enum DrainPass { Empty, Deferred, Progress(usize) }   // Deferred = no session / token / 401 / network
pub async fn flush_now<R: Runtime>(app: &AppHandle<R>, budget: Duration) -> bool
```
- **`flush_now`:** loops `drain_once` inside `tokio::time::timeout(budget)` while it returns `Progress(n)` with n>0. It returns true when it reaches `Empty`. It is needed because the outbox drains oldest first in batches of 50, and the new row is the newest.
- **Why the mutex:** without it, a flush concurrent with the 30 s tick reads the same unsynced rows and posts them twice (the row is only marked after the 2xx).
- `run()` ignores the return value.

---

## 4. T4a — `auth.logout`

**New module `frontend/src-tauri/src/logging/telemetry/auth.rs`** (declared in `logging/telemetry/mod.rs`):
```rust
const LOGIN_MARKER_KEY: &str = "auth_last_user";   // in telemetry.json: {"maity_user_id": "...", "since": rfc3339}
pub(crate) fn remember_login<R>(app: &AppHandle<R>, maity_user_id: &str)       // store.set + save; never fails
pub(crate) fn take_login_marker<R>(app: &AppHandle<R>) -> Option<String>        // reads + deletes + save
pub(crate) async fn emit_logout<R>(app, p: LogoutFacts)
pub(crate) struct LogoutFacts { surface: String, maity_user_id: Option<String>, recording_was_active: bool,
    recording_phase: &'static str, stop_timed_out: bool, stop_ms: u64 }
pub(crate) fn logout_payload(f: &LogoutFacts) -> serde_json::Value   // pure, tested
const SURFACES: [&str; 6] = ["settings","sidebar","chat_sidebar","onboarding_badge","account_error","unknown"];  // anything else → "unknown"
```

**`lib.rs:157` `logout_cleanup(app, surface: Option<String>)`:**
1. `let phase = crate::audio::recording_phase::current_phase(); let was_active = phase.is_session_active();`
2. `let maity_user_id = app.try_state::<AppState>()` → `current_user_id().await` (fallback: `CloudSyncState::user_id()`).
3. `let t0 = Instant::now();` → existing timeout(30 s, graceful_shutdown_before_exit) → `stop_timed_out`.
4. `logging::telemetry::auth::emit_logout(&app, LogoutFacts{...}).await;`
   - Calls `emit_event(app, process_session_id(), catalog::AUTH_LOGOUT, payload, Some(TelemetryStatus::Ok), None, None)`.
5. `let flushed = logging::telemetry::drain::flush_now(&app, Duration::from_secs(4)).await;` then `log::info!` with the result.
6. `let _ = take_login_marker(&app);`. A user logout is not a lost session.
7. `Ok(())`. Never fails, as today.

**Payload:**
```json
{ "reason": "user", "surface": "...", "maity_user_id": "...|null",
  "recording_was_active": bool, "recording_phase": "idle|recording|paused|...",
  "stop_timed_out": bool, "stop_ms": n }
```
The rows go out under the token of the user who is leaving, because the flush runs BEFORE `cloud_sync_clear_session` (verified order, `AuthContext.tsx:905→911`). If the flush fails (offline), the row stays in the outbox and would be attributed to the next login. `maity_user_id` in the payload fixes that in SQL: `coalesce(mu.auth_id, pl.user_id)` joining `maity.users` on `id = event_data->>'maity_user_id'`.

**`database/commands.rs:457` `set_current_user`:** inside `if was_logged_out { ... }` call `crate::logging::telemetry::auth::remember_login(&app, &user_id);`.

**Catalog:** `pub const AUTH_LOGOUT: &str = "auth.logout";` in `catalog.rs` under a new block `// ── Sesión (emisor: Rust, logging/telemetry/auth.rs) ──`. Twin `AUTH_LOGOUT: 'auth.logout',` in `telemetry-events.ts`. A row in `TELEMETRIA.md` (App / salud table, marked "emisor Rust").

---

## 5. T4b — `auth.session_lost`

**New command** in `logging/telemetry/auth.rs`, registered in `lib.rs` `generate_handler!` next to `logout_cleanup`:
```rust
#[tauri::command]
pub async fn telemetry_auth_session_lost<R: Runtime>(app: AppHandle<R>, source: String,
    expires_at: Option<i64>, online: Option<bool>) -> Result<(), String>
```
- `source` ∈ {`webview_signed_out`, `boot_no_session`}; anything else → return Ok without emitting.
- `let marker = take_login_marker(&app);`
- `if !should_emit_session_lost(&source, marker.is_some()) { return Ok(()) }`. Pure rule: `boot_no_session` requires a marker (without one it is a first run or follows a clean logout); `webview_signed_out` always emits.
- **Payload:**
  ```json
  { "source": ..., "maity_user_id": marker.or(current_user_id),
    "expired": expires_at.map(|e| e <= now),
    "expires_at": ..., "online": ...,
    "recording_was_active": current_phase().is_session_active() }
  ```
- `status = Some(TelemetryStatus::Warning)`, `session_id = process_session_id()`, meeting None.
- **No flush:** there is no session, so the row waits in the outbox until the next `cloud_sync_set_session` (drain.rs:71-76). That is why `maity_user_id` goes in the payload.

**`AuthContext.tsx` (keep the synchronous-callback rule):**
- **Refs:**
  - `const maityUserIdRef = useRef<string|null>(null)`, updated at the top of the effect at L108: `maityUserIdRef.current = maityUser?.id ?? null`.
  - `const lastExpiresAtRef = useRef<number|null>(null)`, updated wherever a session is set: L422 and inside the callback when `newSession` is non-null (`newSession.expires_at ?? null`).
- **Inside the callback,** after the `isSigningOut` guard (L450) and before `setSession`:
  ```ts
  if (event === 'SIGNED_OUT' && !newSession) {
    const expiresAt = lastExpiresAtRef.current
    const online = typeof navigator !== 'undefined' ? navigator.onLine : null
    lastExpiresAtRef.current = null
    setTimeout(() => {
      void invoke('telemetry_auth_session_lost', { source: 'webview_signed_out', expiresAt, online })
        .catch((e) => logger.warn('[Auth] session_lost telemetry falló:', e))
    }, 0)
  }
  ```
  No `await` inside the callback (ESLint rule `onAuthStateChange AwaitExpression`), and the IPC is deferred to a macrotask.
- **In `initialize()`,** after the `getSession` try (L412-425): if `!existingSession && isMounted`, then `void invoke('telemetry_auth_session_lost', { source: 'boot_no_session', expiresAt: null, online: navigator.onLine }).catch(...)`. This is outside the callback, so there is no lock problem.
- **Suggested pure helper:** `frontend/src/lib/authSessionLost.ts`
  - `export function sessionLostSource(event: string, hasNewSession: boolean, isSigningOut: boolean): 'webview_signed_out' | null`
  - The callback uses it, and it is unit-tested.

**Native Rust refresh rejected** (`cloud_sync/session.rs`, inside the `BAD_REQUEST || UNAUTHORIZED` branch, after `*guard = None`):
- Capture `current.user_id` before clearing.
- `tauri::async_runtime::spawn` of `crate::logging::telemetry::auth::emit_native_refresh_rejected(app.clone(), user_id, status.as_u16())`.
  - Payload: `source: "native_refresh_rejected"`, `http_status`, `maity_user_id`, `recording_was_active`. Status Warning.
- It does NOT touch the marker: the webview may still be alive.
- It runs only once per loss, because the next `get_valid_token` returns `ERR_NO_SESSION` without refreshing.

**Catalog:** `AUTH_SESSION_LOST` = `'auth.session_lost'` (3 entries). The doc explains the 3 `source` values and how to dedupe `native_refresh_rejected` + `webview_signed_out` within the same minute.

---

## 6. T3a — real autostart state on the direct channel (+ `disabled_at`)

**New module `frontend/src-tauri/src/autostart_state.rs`** (`mod autostart_state;` in lib.rs):
```rust
#[derive(Debug, Clone, serde::Serialize, PartialEq)]
pub struct AutostartSnapshot { pub state: String, pub disabled_at: Option<String>, pub mechanism: &'static str } // startup_task|run_key|plugin
pub async fn current<R: Runtime>(app: &AppHandle<R>) -> AutostartSnapshot
```

**`current` logic:**
1. `crate::startup_task::startup_task_get_state().await`:
   - `Ok(s) if s != "unsupported"` → `{state: s, None, "startup_task"}`.
   - `Err` → `{"unknown", None, "startup_task"}`.
2. `cfg(windows)` and not packaged → `read_direct_windows(&app.package_info().name)`. Plain registry reads, no COM; no async needed (microseconds).
3. Other OS → the plugin as today (`app.autolaunch().is_enabled()` → enabled/disabled/unknown, mechanism "plugin").

**`read_direct_windows(name)`** (winreg, HKCU):
- `run_present = open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Run").get_raw_value(name).is_ok()`
- `approved = open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run").get_raw_value(name).ok().map(|v| v.bytes)`
- `let (state, at) = classify_direct(run_present, approved.as_deref());`
- `disabled_at = at.and_then(utils::filetime_ticks_to_rfc3339)`
- Error opening Run → `unknown`.

**Pure function `classify_direct(run_present: bool, approved: Option<&[u8]>) -> (&'static str, Option<u64>)`:**
- `!run_present` → `("disabled", None)`. Turned off in the app (plugin `disable()` deletes the Run value and leaves StartupApproved stale; confirmed on Julio's PC).
- `None` or `len < 1` → `("enabled", None)`.
- `b[0] == 0x02` → `("enabled", None)`.
- `b[0] == 0x03` → `("disabledByUser", filetime_le(b[4..12]) if len>=12 && != 0)`.
- Any other value → auto-launch heuristic (last 8 bytes zero ⇒ enabled, otherwise disabledByUser with filetime). The telemetry and the plugin's `is_enabled()` (which drives the UI) then always agree.

**New pure helper in `utils.rs`:** `pub fn filetime_ticks_to_rfc3339(ticks: u64) -> Option<String>`
- secs = ticks/10_000_000 − 11_644_473_600, which must be > 0.
- `chrono::DateTime::from_timestamp(secs as i64, 0).map(|d| d.to_rfc3339())`.
- Also used for the WinRT `DateTime.UniversalTime` (same epoch and units).

**`logging/commands.rs:427` `get_device_profile`:**
- Replace the block at L430-444 with `let autostart = crate::autostart_state::current(&app).await;`.
- `autostart_state: autostart.state.clone()`.
- New fields in `DeviceProfile` (L400):
  - `pub autostart_disabled_at: Option<String>`
  - `pub autostart_mechanism: &'static str`
- TS mirror `healthHeartbeatService.ts:108-122`:
  - `autostart_disabled_at: string | null`
  - `autostart_mechanism: string`
- **Doc semantics:** on the direct channel, `disabledByUser` means the app CAN re-enable it (plugin `enable()` rewrites 0x02); under MSIX it cannot.

**New command `autostart_get_state(app) -> AutostartSnapshot`** (registered in lib.rs). In `PreferenceSettings.tsx`:
- In the L118 effect, when `!packaged`, also call `invoke<AutostartSnapshot>('autostart_get_state')` → `setDirectState(s.state)`.
- In the JSX (L399), next to the MSIX hint: `{!isPackaged && directState === 'disabledByUser' && <span className="block mt-2 text-amber-500 text-xs">Lo desactivaste desde el Administrador de tareas de Windows; si lo activas aquí se vuelve a habilitar.</span>}`.
- `checked` stays on the plugin (already false in that case).

---

## 7. T3b — `autostart.changed`

In **`autostart_state.rs`**:
```rust
const LAST_STATE_KEY: &str = "autostart_last_state";   // telemetry.json: {"state": "...", "mechanism": "...", "at": rfc3339}
static RECONCILE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
pub async fn reconcile<R: Runtime>(app: &AppHandle<R>, trigger: &'static str)
pub(crate) fn decide_change(prev: Option<&str>, cur: &str) -> Option<(String, String)>   // pure: None if prev None (first run → baseline only) or prev==cur
#[tauri::command] pub async fn autostart_reconcile<R: Runtime>(app: AppHandle<R>, trigger: String) -> Result<(), String>  // allowlist: settings_toggle|bootstrap, other → "unknown"
```

**`reconcile`:**
1. lock → `let snap = current(app).await;`
2. read prev from `app.store(STORE_FILE)`.
3. `if let Some((from,to)) = decide_change(prev_state, &snap.state)` → emit.
   - `emit_event(app, process_session_id(), catalog::AUTOSTART_CHANGED, json!({from, to, trigger, mechanism: snap.mechanism, prev_mechanism, disabled_at: snap.disabled_at, prev_seen_at}), Some(TelemetryStatus::Ok), None, None)`
4. Always persist `{state, mechanism, at: now}` if something changed (or it is the first run), then `save()`.
5. **Store errors:** `log::warn` and return without emitting (conservative: no store means no baseline).

**Call sites:**
- **`lib.rs` setup,** right after the panics block (lib.rs:1060-1066; AppState already exists after lib.rs:696):
  `{ let h = _app.handle().clone(); tauri::async_runtime::spawn(async move { autostart_state::reconcile(&h, "boot").await; }); }`
- **`PreferenceSettings.tsx` `handleToggleAutostart`:** after each successful branch (MSIX L145-158, plugin L168-172) add `void invoke('autostart_reconcile', { trigger: 'settings_toggle' }).catch(() => {})`.
- **`hooks/useAutostartBootstrap.ts` after `await enable()` (L77):** `void invoke('autostart_reconcile', { trigger: 'bootstrap' }).catch(() => {})`. Otherwise the first-run change is only seen at the next boot and attributed to `boot`.
- **Why migrating from 0.2.61 does not produce a false event:** there is no baseline, so it is only written.
- **MSIX limitation:** a Task Manager change made while the app is running is seen at the next boot (`trigger: boot`). On the direct channel `disabled_at` gives the real date; under MSIX `disabled_at` is null.

**Catalog:** `AUTOSTART_CHANGED` = `'autostart.changed'` (3 entries).

---

## 8. T3c — `package_installed_at`

**`utils.rs`:** `pub fn package_installed_at() -> Option<(String, &'static str)>` returning (rfc3339, source).
- **Packaged (Windows):**
  - `windows::ApplicationModel::Package::Current().and_then(|p| p.InstalledDate())`
  - → `filetime_ticks_to_rfc3339(dt.UniversalTime as u64)`, source `"package"`.
  - Err → `log::warn` + None.
- **Windows not packaged:** for hive in [HKCU, HKLM], `open_subkey(crate::rival_install::NSIS_UNINSTALL_SUBKEY)` → `query_info()` → `get_last_write_time_system()`.
  - SYSTEMTIME (UTC) → `chrono::NaiveDate::from_ymd_opt(..).and_hms_opt(..)`.
  - → `DateTime<Utc>` rfc3339, source `"nsis_uninstall_key"`.
  - Missing key (dev) → None.
  - Make `NSIS_UNINSTALL_SUBKEY` `pub(crate)` (rival_install.rs:133).
- **Other OS:** None.

**`get_device_profile`:** compute together with signature_kind in the same `with_mta` (windows):
```rust
let (signature_kind, installed) = crate::startup_task::with_mta(|| Ok((crate::utils::package_signature_kind(), crate::utils::package_installed_at()))).await.unwrap_or((Some("unknown"), None));
```
- New fields: `pub package_installed_at: Option<String>`, `pub package_installed_at_source: Option<&'static str>`.
- TS mirror: `string | null`.
- **Semantics (doc):** "fecha de instalación O ÚLTIMA ACTUALIZACIÓN de la versión que corre" on both channels. `app.start.prev_version` (T2) plus a change in `package_installed_at` confirms an update. No catalog entry needed (these are fields, not events). Add a row to TELEMETRIA.md in the `device.profile` description, "Desde 0.2.62".

---

## 9. Classification SQL (input for T5)

- **Day with no app start + `autostart_state` in {disabled, disabledByUser}** (last `device.profile` or `autostart.changed.to` before the day) → "autostart apagado: la app no arrancó con la PC" (a sub-cause of "app cerrada/no abierta").
- **`auth.logout` on the day with no later login** (`app.open`/`device.profile`) → "cerró sesión" (a new, separate class; with `surface`).
- **`auth.session_lost`** → "sesión perdida (no la inició el usuario)".
  - Attribute by `event_data->>'maity_user_id'` joined to `maity.users.id`, not by `pl.user_id`.
  - Dedupe `native_refresh_rejected` + `webview_signed_out` less than 5 min apart.

## Files to change
- `frontend/src/shared/components/shell-v5/SidebarFooterV5.tsx` — B1: useAuth().signOut('chat_sidebar') instead of supabase.auth.signOut(); remove the supabase import; header comment marking it a desktop adaptation.
- `frontend/src/contexts/AuthContext.tsx` — B1: signOut(surface?) with typeof normalization, invoke('logout_cleanup', {surface}), eslint-disable-next-line on L925. T4b: maityUserIdRef/lastExpiresAtRef refs; SIGNED_OUT branch in the callback with a setTimeout(0) to invoke('telemetry_auth_session_lost'); boot_no_session in initialize().
- `frontend/.eslintrc.json` — B1: no-restricted-syntax selector against `*.auth.signOut(` outside AuthContext.
- `frontend/src/contexts/authSignOut.fitness.test.ts` — B1: new fitness test (no .auth.signOut( outside AuthContext/maity-shared/tests).
- `frontend/src/components/settings/PreferenceSettings.tsx` — B1: onClick={() => void signOut('settings')}. T3: autostart_get_state for the direct-channel disabledByUser hint; autostart_reconcile('settings_toggle') after each toggle.
- `frontend/src/components/Sidebar/SidebarControls.tsx` — B1 (surface): signOut('sidebar').
- `frontend/src/components/Onboarding/OnboardingAccountBadge.tsx` — B1 (surface): signOut('onboarding_badge').
- `frontend/src/app/(main)/layout.tsx` — B1 (surface): signOut('account_error') at L257.
- `frontend/src/lib/authSessionLost.ts` — T4b: pure helper sessionLostSource(event, hasNewSession, isSigningOut) + test authSessionLost.test.ts.
- `frontend/src-tauri/src/database/commands.rs` — B1b: clear_current_user runs graceful stop <=30 s when recording, then compare-and-clear. T4: set_current_user calls auth::remember_login on the None->Some transition.
- `frontend/src-tauri/src/logging/telemetry/drain.rs` — Shared with T2: DRAIN_LOCK, DrainPass, pub flush_now(app, budget) -> bool.
- `frontend/src-tauri/src/logging/telemetry/auth.rs` — New: login marker (remember_login/take_login_marker), emit_logout + LogoutFacts + pure logout_payload, command telemetry_auth_session_lost + pure should_emit_session_lost, emit_native_refresh_rejected; tests.
- `frontend/src-tauri/src/logging/telemetry/mod.rs` — `pub mod auth;`
- `frontend/src-tauri/src/logging/telemetry/context.rs` — STORE_FILE -> pub(crate).
- `frontend/src-tauri/src/logging/telemetry/catalog.rs` — AUTH_LOGOUT, AUTH_SESSION_LOST, AUTOSTART_CHANGED.
- `frontend/src/lib/telemetry-events.ts` — Twins AUTH_LOGOUT: 'auth.logout', AUTH_SESSION_LOST: 'auth.session_lost', AUTOSTART_CHANGED: 'autostart.changed' (one line each).
- `frontend/src-tauri/src/lib.rs` — logout_cleanup(app, surface: Option<String>) with phase snapshot, emit_logout, flush_now(4 s), take_login_marker; register telemetry_auth_session_lost, autostart_state::autostart_get_state, autostart_state::autostart_reconcile; `mod autostart_state;`; spawn reconcile("boot") after the panics block (~L1066).
- `frontend/src-tauri/src/cloud_sync/session.rs` — T4b: in the 400/401 refresh branch, spawn auth::emit_native_refresh_rejected(user_id, status).
- `frontend/src-tauri/src/autostart_state.rs` — New: AutostartSnapshot, current(), read_direct_windows (winreg Run + StartupApproved), pure classify_direct, reconcile + pure decide_change + RECONCILE_LOCK, commands autostart_get_state/autostart_reconcile; tests.
- `frontend/src-tauri/src/utils.rs` — Pure filetime_ticks_to_rfc3339; package_installed_at() (MSIX InstalledDate / NSIS Uninstall key last-write); tests for the converter.
- `frontend/src-tauri/src/rival_install.rs` — NSIS_UNINSTALL_SUBKEY -> pub(crate).
- `frontend/src-tauri/src/logging/commands.rs` — get_device_profile uses autostart_state::current; DeviceProfile gains autostart_disabled_at, autostart_mechanism, package_installed_at, package_installed_at_source; with_mta computes signature_kind + installed_at together.
- `frontend/src/services/healthHeartbeatService.ts` — DeviceProfile interface: the 4 new fields.
- `frontend/src/hooks/useAutostartBootstrap.ts` — T3b: autostart_reconcile('bootstrap') after enable().
- `docs/TELEMETRIA.md` — Rows for `auth.logout`, `auth.session_lost`, `autostart.changed` (lint check f); new device.profile fields 'Desde 0.2.62'; direct vs MSIX disabledByUser semantics; attribution by maity_user_id.
- `docs/NUBE_CUENTAS_SYNC.md` — Rule: every logout goes through AuthContext.signOut (ESLint + fitness); session_lost marker.

## Commits
- **fix(auth): el logout del sidebar del chat pasa por logout_cleanup y guarda la grabación**
  SidebarFooterV5 -> useAuth().signOut('chat_sidebar'); signOut(surface?) with typeof normalization and invoke('logout_cleanup', {surface}) (Rust accepts surface: Option<String> and ignores it until the next commit); callers pass their surface; ESLint no-restricted-syntax against .auth.signOut( + eslint-disable on AuthContext:925; fitness test authSignOut.fitness.test.ts; line in docs/NUBE_CUENTAS_SYNC.md. Build tauri:build:debug + pnpm lint + vitest.
- **fix(auth): una sesión perdida a media grabación guarda el segmento antes de soltar al usuario** (deps: fix(auth): el logout del sidebar del chat pasa por logout_cleanup y guarda la grabación)
  clear_current_user: if a recording is active, graceful_shutdown_before_exit <=30 s, then compare-and-clear of current_user_id (does not clear if another login won during the stop). Needs Julio's approval (behavior change).
- **refactor(telemetria): drenado serializado con candado y flush acotado del outbox**
  drain.rs: DRAIN_LOCK (tokio Mutex const_new), drain_once returns DrainPass, pub flush_now(app, budget) loops while there is progress. SKIP if T2 already landed it.
- **feat(telemetria): auth.logout desde logout_cleanup con flush antes de soltar la sesión** (deps: refactor(telemetria): drenado serializado con candado y flush acotado del outbox)
  logging/telemetry/auth.rs (marker remember_login/take_login_marker, emit_logout, pure logout_payload + tests); logout_cleanup: phase snapshot, stop, emit, flush_now(4 s), take marker; set_current_user calls remember_login; STORE_FILE pub(crate); 3 catalog entries AUTH_LOGOUT.
- **feat(telemetria): auth.session_lost cuando la sesión se cae sin que el usuario la cierre** (deps: feat(telemetria): auth.logout desde logout_cleanup con flush antes de soltar la sesión)
  Command telemetry_auth_session_lost (sources webview_signed_out|boot_no_session, pure rule should_emit_session_lost + tests); AuthContext: refs, SIGNED_OUT branch with setTimeout(0) (no await), boot_no_session in initialize(); lib/authSessionLost.ts + test; cloud_sync/session.rs emits native_refresh_rejected; 3 catalog entries AUTH_SESSION_LOST.
- **feat(telemetria): el autostart del canal directo distingue el apagado desde el Administrador de tareas**
  autostart_state.rs (current, read_direct_windows over Run + StartupApproved, pure classify_direct + tests); utils::filetime_ticks_to_rfc3339 + tests; get_device_profile uses current() and adds autostart_disabled_at/autostart_mechanism; command autostart_get_state + direct-channel hint in PreferenceSettings; TS mirror; doc row.
- **feat(telemetria): autostart.changed contra la línea base persistida en telemetry.json** (deps: feat(telemetria): el autostart del canal directo distingue el apagado desde el Administrador de tareas)
  reconcile(trigger) with RECONCILE_LOCK and pure decide_change (first run = baseline only) + tests; spawn at boot in setup; command autostart_reconcile from PreferenceSettings (settings_toggle) and useAutostartBootstrap (bootstrap); 3 catalog entries AUTOSTART_CHANGED.
- **feat(telemetria): package_installed_at en device.profile (MSIX InstalledDate / llave NSIS)** (deps: feat(telemetria): el autostart del canal directo distingue el apagado desde el Administrador de tareas)
  utils::package_installed_at (Package.Current().InstalledDate() under MSIX; last-write of Uninstall\Maity HKCU/HKLM on the direct channel); NSIS_UNINSTALL_SUBKEY pub(crate); DeviceProfile + TS mirror package_installed_at/_source; computed in the same with_mta as signature_kind; doc 'Desde 0.2.62'.

## Tests
- frontend/src/contexts/authSignOut.fitness.test.ts: Walks src/**/*.{ts,tsx} (excluding *.test.*, src/shared/maity-shared/**, contexts/AuthContext.tsx) and fails if any file matches /\.auth\s*\.\s*signOut\s*\(/. Must fail against the current SidebarFooterV5.tsx.
- frontend/src/lib/authSessionLost.test.ts: sessionLostSource: SIGNED_OUT+null+!signingOut -> 'webview_signed_out'; SIGNED_OUT during isSigningOut -> null; TOKEN_REFRESHED/INITIAL_SESSION -> null; SIGNED_OUT with a session -> null.
- frontend/src-tauri/src/logging/telemetry/auth.rs (mod tests): logout_payload keeps reason='user', unknown surface -> 'unknown', recording_was_active/stop_timed_out are carried through; should_emit_session_lost: boot_no_session without marker -> false, with marker -> true, webview_signed_out -> true, unknown source -> false.
- frontend/src-tauri/src/logging/telemetry/drain.rs (mod tests): If it can be done without HTTP: flush_now with no session returns false within budget (use the existing in-memory setup_pool harness if AppState can be instantiated; otherwise mark as a manual test).
- frontend/src-tauri/src/autostart_state.rs (mod tests): classify_direct: run absent -> disabled; approved None -> enabled; [02,0*11] -> enabled; [03,0,0,0,+FILETIME] -> disabledByUser with ticks; [03,...,0*8] -> disabledByUser with None; unknown first byte with non-zero last 8 bytes -> disabledByUser (auto-launch parity); len<8 -> enabled. decide_change: None->x = None; x->x = None; enabled->disabledByUser = Some.
- frontend/src-tauri/src/utils.rs (mod tests): filetime_ticks_to_rfc3339: 116444736000000000 -> 1970-01-01T00:00:00+00:00 boundary (returns None if secs<=0 per the rule), a known 2026 FILETIME -> expected date; 0 -> None.
- frontend/src-tauri/src/logging/commands.rs health_snapshot_tests: If any test serializes DeviceProfile, add the 4 keys to the TS contract (a test that the new keys exist in the JSON).

## Risks
- B1b changes behavior: a spontaneous SIGNED_OUT mid-jornada now stops and saves the recording (before, it kept recording and lost the segment). A fast re-login could race with the clear. → Compare-and-clear of current_user_id; separate commit that can be dropped; ask Julio before applying it.
- flush_now adds up to 4 s to logout (on top of the <=30 s stop). → 4 s budget; flush_now never propagates errors; if it fails the row stays in the outbox with maity_user_id for later attribution.
- Double posting if the tick drain and flush_now run concurrently (today there is no lock). → DRAIN_LOCK in drain_once (Commit 3), shared with T2 so it is not duplicated.
- Rows emitted with no session (session_lost, pre-login) are attributed to whoever logs in next (auth.uid() at drain time). → maity_user_id in the payload + the join documented in TELEMETRIA.md / T5 SQL.
- Adding an await inside the onAuthStateChange callback would bring back the auth-js deadlock (incident 2026-09-10). → Only setTimeout(() => void invoke(...), 0); the existing ESLint rule catches any AwaitExpression; the logic lives in a pure helper.
- StartupApproved first-byte values other than 02/03 (Docker shows 0x01 on Julio's PC) could be misclassified. → Fallback to the auto-launch 0.5.0 heuristic (last 8 bytes), so telemetry never contradicts what the plugin and the UI report.
- Merge conflict in DeviceProfile / healthHeartbeatService.ts with T1 (jornada fields) and in drain.rs with T2. → Rebase each commit on the latest main; fields are appended at the end of the struct; Commit 3 is conditional.
- Protocol Guardian: changing lib.rs and the Tauri command system is on the list that requires a backup/ branch, which conflicts with 'do not create branches without being asked'. → The orchestrator/Julio decides; say so explicitly in the report.
- autostart_reconcile at boot runs before the session exists; the event waits in the outbox and is attributed to the next login. → Normally the same user; the payload carries no identity, but install_id in ctx lets SQL correlate by device.

## Manual verification
- B1: open /chat, start a manual recording (or wait for a jornada segment), log out from the chat sidebar footer -> the log shows 'logout_cleanup' + 'Segmento de jornada cerrado y guardado antes de salir' (or the manual stop) and the conversation shows up in the list after logging back in.
- T4a: log out from Settings with network -> maity.platform_logs has an `auth.logout` row with surface='settings', recording_was_active matching, created_at seconds after the click, and user_id of the user who left (not the next one).
- T4b boot: log in, close from the tray, invalidate the session (revoke it in Supabase Auth or delete the refresh token), reopen -> login screen; after logging in, an `auth.session_lost` source='boot_no_session' row with the correct maity_user_id. Reopen without logging in after a clean logout -> no row.
- T4b live: with the app open, revoke the session in Supabase and force a refresh (`__pollDebug.forceTokenRefresh()`) -> `auth.session_lost` source='webview_signed_out'; the UI does NOT freeze (no deadlock).
- T3a (NSIS channel): Task Manager > Startup apps > Maity disabled -> restart -> device.profile.autostart_state='disabledByUser', autostart_disabled_at = the time of the change; Settings shows the amber hint; turning the toggle on -> StartupApproved\Run\Maity starts with 02 again.
- T3b: first run of 0.2.62 -> telemetry.json gets autostart_last_state and NO autostart.changed; toggle in Settings -> `autostart.changed` with trigger='settings_toggle'; disable in Task Manager and reboot -> trigger='boot'.
- T3c: under MSIX (installed from the Store or a sideloaded MSIX) device.profile.package_installed_at matches the Get-AppxPackage install/update date; NSIS -> source='nsis_uninstall_key'; dev -> null.
- pnpm run tauri:build:debug exit 0 after EACH commit (pre-build runs lint-telemetry.js: catalog mirror and backticked doc rows); pnpm lint; pnpm test; cargo test for autostart_state/auth/utils; `graphify update .` at the end.

## Open questions
- B1b (stop/save the recording inside clear_current_user when the session is lost mid-recording): apply it or leave it out? It changes behavior and is outside the letter of B1.
- Keep the `surface` parameter in signOut (touches 4 extra call sites) or only emit reason='user'?
- Is the `auth.session_lost` source='native_refresh_rejected' (Rust copy expired while the UI may still be alive) worth it, or is it noise for the #83 classification?
- Should the direct-channel toggle respect a Task Manager disable (ask before overwriting 0x02) instead of re-enabling silently as auto-launch does today?
- Coordination: who lands drain::flush_now first (T2 or T4)? The spec assumes whoever goes first adds it.

## Unverified
- StartupApproved first-byte values other than 0x02 (enabled) and 0x03 (disabled + FILETIME). 0x06/0x07/0x01 (0x01 seen for Docker Desktop on Julio's PC) have no confirmed meaning; the design falls back to auto-launch's heuristic.
- That a Tauri NSIS update (updater passive install) rewrites the Uninstall\Maity key (so its last-write time equals the last update). Not tested; there is no NSIS install on this PC.
- That Package.InstalledDate changes on Store updates in production (the Microsoft doc says 'installed or last updated'; the only listed exception is Visual Studio deployment).
- The exact SIGNED_OUT timing when a refresh fails while the app is running, beyond the code read (GoTrueClient.js:1985-1992); not reproduced.
- That an invoke without await inside setTimeout(0) from the onAuthStateChange callback cannot interfere with the auth-js lock (it is not supabase-js, so by design no; not tested).
- That RecordingPhase exposes as_str() suitable for the payload (current_phase().as_str() is used in logging/commands.rs HealthSnapshot, so it should be; not re-checked in recording_phase.rs).