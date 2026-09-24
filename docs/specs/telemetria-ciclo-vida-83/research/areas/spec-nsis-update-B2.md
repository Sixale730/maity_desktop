# B2 — El updater NSIS (descarga directa) sale sin guardar la grabación y sin comprobar si hay una grabando

## Summary
Hoy el canal de descarga directa actualiza con `Update.downloadAndInstall()` de @tauri-apps/plugin-updater 2.10.0, llamado desde UpdateDialog.tsx:128. En Windows el plugin termina con `std::process::exit(0)` (updater.rs:865): antes solo ejecuta su propio hook `on_before_exit`, que corre `cleanup_before_exit` (updater lib.rs:108-110; limpia tray y resources y oculta ventanas). Por eso NUNCA se ejecuta nuestro handler de RunEvent::Exit (lib.rs:1786-1824), y con él se pierden el stop con guardado de la grabación, el checkpoint WAL con cierre del pool y el kill del sidecar llama-helper. Tampoco se comprueba si hay una grabación, a diferencia de las dos rutas Store. No existe instalación automática silenciosa: todas las rutas (arranque, foco, tray, Ajustes > Acerca de) solo abren el UpdateDialog, y `updateService.downloadAndInstall` es código muerto (sin llamadores). La opción (c) tal como estaba planteada no existe: `tauri_plugin_updater::Builder` (lib.rs:128-239) no expone `on_before_exit`. Solo lo expone el `UpdaterBuilder`, y ahí es un `Fn()` síncrono. Diseño elegido, (a)+(b) hecho en Rust: un comando nuevo `direct_update_install` hace check, descarga (con progreso por Channel), se niega si la fase de grabación no es Idle y toma el `StartGate` para bloquear arranques concurrentes. Después llama a `update.install()` dentro de `spawn_blocking`, con un `on_before_exit` propio que cierra sidecar y pool y registra la intención de salida. Ese hook se ejecuta solo cuando `extract()` ya tuvo éxito, así que un fallo antes del instalador deja la app intacta (pool abierto, gate liberado). El frontend comprueba la grabación antes de descargar, con la misma UX que la Store. Todo va en un solo commit.

## Current behavior
- The only live install path is UpdateDialog.handleDownloadAndInstall, which calls the plugin's downloadAndInstall and then relaunch(), with no recording check. — frontend/src/components/updates/UpdateDialog.tsx:128 `await updateToUse.downloadAndInstall((event) => {`; L174 `await relaunch();`. There is no get_recording_state call in L95-182, while the Store paths do check: L213-217 and L238-242 `if (state?.is_recording) { ... toast.warning('Hay una grabación en curso...` 
- updateService.downloadAndInstall has no callers (dead code), but it is a second unsafe path waiting to be used. — frontend/src/services/updateService.ts:350-370 `await update.download(); ... await update.install(); await relaunch();`. Grepping `updateService.downloadAndInstall` / `.install(` across src finds only its definition (updateService.ts:364) and UpdateDialog.tsx:128.
- There is no silent auto-install. Startup, foreground, tray and About only open the dialog, so the user always clicks "Descargar e Instalar". — UpdateCheckProvider.tsx:63-72 `onUpdateAvailable: (_info) => { ... handleShowDialog(); }`; L85-88 tray `checkForUpdates(true); setShowDialog(true);`; tray.rs:59 `"check_updates" => check_updates_handler(app)` -> tray.rs:340 dispatches `check-updates-from-tray`; About.tsx:53-56 `checkForUpdates(true) ... setShowUpdateDialog(true)`; useUpdateCheck.ts only checks.
- The installed versions are JS @tauri-apps/plugin-updater 2.10.0 (it has separate download() and install()), Rust tauri-plugin-updater 2.10.0, and tauri-plugin-process 2.3.1. — node_modules/@tauri-apps/plugin-updater/package.json `"version": "2.10.0"`; dist-js/index.d.ts:69-73 `download(...)`, `install(): Promise<void>`, `downloadAndInstall(...)`; Cargo.lock:6865-6866 `tauri-plugin-updater` `2.10.0`, :6823-6824 `tauri-plugin-process` `2.3.1`; src-tauri/Cargo.toml:204 `tauri-plugin-updater = "2.10.0"`.
- On Windows install always ends in std::process::exit(0). The only thing run first is on_before_exit, and only AFTER extract() succeeded. The ShellExecuteW return value is ignored. — tauri-plugin-updater-2.10.0/src/updater.rs:794 `let updater_type = self.extract(bytes)?;` ... :837-840 `if let Some(on_before_exit) = self.on_before_exit.as_ref() { ... on_before_exit(); }` ... :854-863 `ShellExecuteW(...)` (result not checked) ... :865 `std::process::exit(0);`
- The plugin's default on_before_exit runs only app_handle.cleanup_before_exit(). tauri_plugin_updater::Builder has no on_before_exit, so option (c) cannot be configured at lib.rs:638. The UpdaterBuilder's hook is a sync Fn and REPLACES the default. — updater lib.rs:107-110 `builder = builder.on_before_exit(move || { app_handle.cleanup_before_exit(); });`; lib.rs:127-134 `pub struct Builder { target, pubkey, installer_args, headers, default_version_comparator }` (no hook); updater.rs:288-291 `pub fn on_before_exit<F: Fn() + Send + Sync + 'static>(mut self, f: F) -> Self { self.on_before_exit.replace(Arc::new(f));`
- cleanup_before_exit only clears the tray, clears resource tables and hides windows. There is no recording stop, no DB close and no sidecar kill. — tauri-2.11.2/src/app.rs:1100-1112 `self.manager.tray.icons.lock().unwrap().clear(); self.manager.resources_table().clear(); for (_, window) ... window.hide()`
- Our cleanup lives only in RunEvent::Exit, which process::exit skips. — frontend/src-tauri/src/lib.rs:1786-1821 `if let tauri::RunEvent::Exit = event { ... graceful_shutdown_before_exit ... app_state.db_manager.cleanup().await ... summary::summary_engine::force_shutdown_sidecar().await`
- On macOS/Linux install returns without exiting, and JS relaunch() -> request_restart() fires ExitRequested/Exit, so our Exit handler does run there. But the install itself still happens mid-recording, with no check. — tauri-plugin-process-2.3.1/src/commands.rs:13-14 `pub fn restart(...) { app.request_restart() }`; tauri-2.11.2/src/app.rs:614-621 `request_restart ... request_exit(RESTART_EXIT_CODE)`; the macOS install_inner (updater.rs:1212) has no process::exit (the only exit is :865, under #[cfg(windows)]).
- Passive NSIS mode with relaunch is the default. The /P /R /UPDATE /ARGS arguments come from the config and from the current exe args set by updater_builder(). — updater config.rs:21-22 `#[default] Passive`, :41 `Self::Passive => &["/P", "/R"]`; updater.rs:808-816 `.chain(once(OsStr::new("/UPDATE"))).chain(once(OsStr::new("/ARGS")))...`; updater lib.rs:86-89 `builder = builder.current_exe_args(args)`; tauri.conf.json:159-164 has no `windows.installMode`.
- is_recording() does NOT cover the Starting/Stopping phases. Stopping (saving/merging in progress) must also block the install. — audio/recording_phase.rs:61-63 `pub fn is_session_active(&self) -> bool { matches!(self, RecordingPhase::Recording | RecordingPhase::Paused) }`; recording_commands.rs:54-56 `is_recording() -> recording_phase::current_phase().is_session_active()`
- StartGate is the single atomic lock for every recording start (Idle->Starting CAS). Holding it blocks all start paths, its Drop reverts to Idle, and the scheduler treats "already in progress" as benign. — recording_phase.rs:164-192 `acquire()` -> `try_transition(Idle, Starting)` with `Err(Starting) => "Recording start already in progress"`; :213-222 Drop reverts `Starting -> Idle`; the only acquirers are recording_lifecycle.rs:264 and :379; scheduled_recording/service.rs:654-658 `Err(e) if e.contains("already in progress") => ... (SchedulerPhase::Armed, Some(SkipReason::ManualInProgress))`
- Reusable helpers exist: checkpoint without closing the pool, cleanup with close, and a sidecar kill with lazy re-init. — database/manager.rs:240-245 `pub async fn checkpoint(&self)` `PRAGMA wal_checkpoint(TRUNCATE)`; :296-314 `pub async fn cleanup(&self)` checkpoint + `self.pool.close().await`; summary/summary_engine/client.rs:203-215 `force_shutdown_sidecar` does `global.take()` + `shutdown_all`, and :83-93 `get_sidecar_pool` lazily re-inits; rival_install.rs:83-89 obtains the manager with `app.try_state::<crate::state::AppState>().map(|s| s.db_manager.clone())`.
- llama-helper exits only on stdin EOF (if it is mid-generation it does not read stdin), and there is no Job Object. After process::exit it can stay alive holding binaries/llama-helper.exe while NSIS tries to overwrite it. — llama-helper/src/main.rs:436-439 `match stdin_lock.read_line(&mut buffer) { ... // EOF reached`; grepping `JobObject|KILL_ON_JOB_CLOSE` in src-tauri/src finds nothing; tauri.conf.json:137 `"externalBin": ["binaries/llama-helper"]`
- block_on inside spawn_blocking is a pattern Tauri itself uses, so a sync hook running on a blocking thread can await our async cleanup. — tauri-2.11.2/src/async_runtime.rs:301-316 `safe_block_on`: `handle.spawn_blocking(move || { tx.send(handle_.block_on(task)).unwrap(); });`; :272-275 `pub fn block_on`
- App commands need no capability (there is no AppManifest in build.rs), and Channel fetch skips the ACL. — grepping `AppManifest` in src-tauri/build.rs finds nothing; tauri-2.11.2/src/webview/mod.rs:1823-1826 `(plugin_command.is_some() || has_app_acl_manifest || !is_local) && request.cmd != crate::ipc::channel::FETCH_CHANNEL_DATA_COMMAND`
- The plugin's DownloadEvent is private (the commands module is not pub), so we need our own enum with the same serde shape. — updater lib.rs:23 `mod commands;`; commands.rs:14-26 `#[serde(tag = "event", content = "data")] pub enum DownloadEvent { #[serde(rename_all = "camelCase")] Started { content_length }, ... Progress { chunk_length }, Finished }`
- The public fields/methods of Update used by the design exist. — updater.rs:601-613 `pub struct Update { ... pub current_version: String, pub version: String`; :652 `pub async fn download<C: FnMut(usize, Option<u64>), D: FnOnce()>`; :718 `pub fn install(&self, bytes: impl AsRef<[u8]>) -> Result<()>`; updater lib.rs:70-71 `impl<R: Runtime, T: Manager<R>> UpdaterExt<R> for T { fn updater_builder(&self) -> UpdaterBuilder`

## Design
## Decision

Combine (a) and (b), with the whole install inside ONE Rust command. JS does not split `download()`/`install()`.
- (a) Refuse while a recording is live, with the same UX as the Store (`toast.warning('Hay una grabación en curso. Detenla antes de actualizar Maity.')`). JS checks BEFORE downloading, and Rust is the authority: it checks again at start and again after the download.
- (b) The cleanup (sidecar kill, WAL checkpoint + pool close, T2 exit intent, log flush, plus the plugin's `cleanup_before_exit`) runs inside our own `on_before_exit`, set with `app.updater_builder().on_before_exit(..)`. The plugin calls that hook only AFTER `extract()` succeeded (updater.rs:794 -> :837), right before ShellExecuteW + exit. That is the true commit point: if check, download, signature verification or extract fails, nothing has been closed yet.
- Why not the JS split with an IPC `prepare_*` in between: the plugin's `DownloadedBytes` resource is private (commands.rs:39), so Rust cannot take over the JS download. Between `prepare` and `install()` there would be an IPC window where the scheduler (30 s tick) can start a recording, and the pool would have to be closed BEFORE knowing whether extract succeeds.
- Why (c) as proposed does not apply: `tauri_plugin_updater::Builder` (lib.rs:638) has no `on_before_exit`. Only the per-call `UpdaterBuilder` has it.
- `graceful_shutdown_before_exit` is not called: the StartGate taken from Idle PROVES no session is live (Idle->Starting CAS). A stop-and-update flow is out of scope; it is an open question.

## New file `frontend/src-tauri/src/direct_update.rs`

```rust
//! Updater del canal de descarga directa (NSIS/MSI en Windows; .app/AppImage fuera).
//! En Windows `Update::install` termina en `std::process::exit(0)` (tauri-plugin-updater
//! 2.10 updater.rs:865): RunEvent::Exit (lib.rs) NO corre. Por eso la limpieza vive en
//! un `on_before_exit` propio, que el plugin llama sólo tras `extract()` exitoso.
//! Nunca bajo MSIX (#71) ni en Mac App Store.
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{ipc::Channel, AppHandle, Manager};
use tauri_plugin_updater::UpdaterExt;
use crate::audio::recording_phase::{self, RecordingPhase, StartGate};

/// Same serde shape as the plugin's private DownloadEvent (commands.rs:14-26), so the
/// JS handler keeps its `switch (event.event)` and can reuse the `DownloadEvent` type.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "event", content = "data")]
pub enum DirectUpdateEvent {
    #[serde(rename_all = "camelCase")] Started { content_length: Option<u64> },
    #[serde(rename_all = "camelCase")] Progress { chunk_length: usize },
    Finished,
}

/// Same style as StoreInstallOutcome (store_update.rs:39-51): `{kind, detail}` in camelCase.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", content = "detail", rename_all = "camelCase")]
pub enum DirectInstallOutcome {
    /// macOS/Linux: installed, and request_restart was triggered (on Windows success never returns).
    Restarting,
    NoUpdate,
    /// Phase != Idle at start, or a recording started during the download.
    RecordingActive,
    /// Another call is already in progress (double click / two windows).
    Busy,
    /// MSIX or Mac App Store: this updater never runs there.
    Unsupported,
    Error(String),
}

static INSTALL_IN_FLIGHT: AtomicBool = AtomicBool::new(false);
/// Set by the hook: from here on the pool may already be closed.
static EXIT_HOOK_RAN: AtomicBool = AtomicBool::new(false);
struct InFlightGuard;
impl Drop for InFlightGuard { fn drop(&mut self) { INSTALL_IN_FLIGHT.store(false, Ordering::SeqCst); } }

/// Pure. Only Idle allows installing (Starting/Stopping do not count as is_recording, but block too).
pub fn refusal_for_phase(phase: RecordingPhase) -> Option<DirectInstallOutcome> {
    (phase != RecordingPhase::Idle).then_some(DirectInstallOutcome::RecordingActive)
}

/// Sync. Runs on the spawn_blocking thread, inside the plugin's on_before_exit.
/// block_on is valid here (same pattern as tauri async_runtime.rs:301-316 safe_block_on).
pub(crate) fn exit_cleanup_blocking(db: Option<crate::database::manager::DatabaseManager>) {
    EXIT_HOOK_RAN.store(true, Ordering::SeqCst);
    tauri::async_runtime::block_on(async move {
        // T2 (if it already landed): record exit intent HERE, before closing the DB, e.g.
        // crate::logging::lifecycle::record_exit_intent_sync(&app, "update_restart");
        // Sync std::fs write, like panics.rs. RunEvent::Exit will not write the marker on this path.
        let five = std::time::Duration::from_secs(5);
        match tokio::time::timeout(five, crate::summary::summary_engine::force_shutdown_sidecar()).await {
            Ok(Err(e)) => log::warn!("[direct_update] kill del sidecar falló: {e}"),
            Err(_) => log::warn!("[direct_update] kill del sidecar excedió 5s"),
            _ => {}
        }
        if let Some(db) = db {
            if tokio::time::timeout(five, db.cleanup()).await.is_err() {
                log::warn!("[direct_update] cleanup de DB excedió 5s; WAL con synchronous=NORMAL no pierde commits ante salida de proceso");
            }
        }
    });
    log::logger().flush();
}

#[tauri::command]
pub async fn direct_update_install(
    app: AppHandle,
    on_event: Channel<DirectUpdateEvent>,
) -> Result<DirectInstallOutcome, String> {
    if crate::utils::is_running_under_package_identity() || crate::utils::is_mac_app_store_build() {
        return Ok(DirectInstallOutcome::Unsupported);
    }
    if INSTALL_IN_FLIGHT.swap(true, Ordering::SeqCst) { return Ok(DirectInstallOutcome::Busy); }
    let _in_flight = InFlightGuard;

    if let Some(refusal) = refusal_for_phase(recording_phase::current_phase()) {
        log::warn!("[direct_update] rechazado: fase {}", recording_phase::current_phase().as_str());
        return Ok(refusal);
    }

    let db = app.try_state::<crate::state::AppState>().map(|s| s.db_manager.clone()); // pattern from rival_install.rs:83-85
    let hook_app = app.clone();
    let updater = app
        .updater_builder()            // keeps config, pubkey, installMode Passive (/P /R), current_exe_args
        .on_before_exit(move || {     // REPLACES the default (updater lib.rs:108-110) -> call cleanup_before_exit explicitly
            log::info!("[direct_update] on_before_exit: sidecar + DB antes del instalador");
            exit_cleanup_blocking(db.clone());
            hook_app.cleanup_before_exit(); // tray/resources/hide, same as the plugin default
        })
        .build()
        .map_err(|e| e.to_string())?;

    let update = match updater.check().await {
        Ok(Some(u)) => u,
        Ok(None) => return Ok(DirectInstallOutcome::NoUpdate),
        Err(e) => return Ok(DirectInstallOutcome::Error(e.to_string())),
    };
    log::info!("[direct_update] descargando {} (actual {})", update.version, update.current_version);

    let mut first = true;
    let bytes = match update
        .download(
            |chunk_length, content_length| {
                if first { first = false; let _ = on_event.send(DirectUpdateEvent::Started { content_length }); }
                let _ = on_event.send(DirectUpdateEvent::Progress { chunk_length });
            },
            || { let _ = on_event.send(DirectUpdateEvent::Finished); },
        )
        .await
    {
        Ok(b) => b, // signature already verified inside download (updater.rs:712)
        Err(e) => return Ok(DirectInstallOutcome::Error(e.to_string())),
    };

    // A recording may have started during the download (scheduler). Take the start lock:
    // from here on NO start path gets in (recording_lifecycle.rs:264/379).
    let gate = match StartGate::acquire() {
        Ok(g) => g,
        Err(e) => { log::warn!("[direct_update] grabación iniciada durante la descarga: {e}"); return Ok(DirectInstallOutcome::RecordingActive); }
    };

    log::info!("[direct_update] instalando {}", update.version);
    let joined = tauri::async_runtime::spawn_blocking(move || update.install(bytes)).await;
    match joined {
        Ok(Ok(())) => {
            // macOS/Linux only (Windows does not return). Keep the phase in Starting until the
            // restart; RunEvent::Exit then does the normal cleanup.
            std::mem::forget(gate);
            app.request_restart();
            Ok(DirectInstallOutcome::Restarting)
        }
        Ok(Err(e)) | Err(_) if false => unreachable!(),
        Ok(Err(e)) => { drop(gate); after_failed_install(&app); Ok(DirectInstallOutcome::Error(e.to_string())) }
        Err(join) => { drop(gate); after_failed_install(&app); Ok(DirectInstallOutcome::Error(format!("el instalador abortó: {join}"))) }
    }
}

/// If the hook already ran (pool closed) and we are still alive (panic after the hook),
/// the app cannot use the DB: restart so the pool reopens. Otherwise nothing was closed.
fn after_failed_install(app: &AppHandle) {
    if EXIT_HOOK_RAN.swap(false, Ordering::SeqCst) {
        log::error!("[direct_update] el hook de salida corrió pero seguimos vivos: reinicio para reabrir la DB");
        app.request_restart();
    }
}
```
(Remove the dummy `if false` arm when implementing. It is only there to show that the two failure arms are identical.)

Notes:
- `crate::database::manager::DatabaseManager` must be the exact type of `AppState.db_manager` (state.rs:8 `pub db_manager: DatabaseManager`). Confirm the `use` path when implementing.
- `summary::summary_engine::force_shutdown_sidecar` is the path lib.rs:1818 already uses.
- Keep all `on_event.send` errors ignored, as the plugin does.

## Wiring in `frontend/src-tauri/src/lib.rs`
- Module: add `pub mod direct_update;` to the module list (after `pub mod database;`, lib.rs:44).
- Registration: add `direct_update::direct_update_install,` to `generate_handler!`, right after `store_update::store_install_updates,` (lib.rs:1769), with the comment `// Update del canal directo (NSIS): se niega con grabación y cierra DB/sidecar antes del instalador (B2)`.
- lib.rs:638 `tauri_plugin_updater::Builder::new().build()` stays as it is.

## Frontend

### `frontend/src/components/updates/UpdateDialog.tsx`
- Imports:
  - `import { check, type DownloadEvent } from '@tauri-apps/plugin-updater';`, dropping `Update`.
  - `import { exit } from '@tauri-apps/plugin-process';`, dropping `relaunch`.
  - `import { Channel, invoke } from '@tauri-apps/api/core';`
  - `import type { DirectInstallOutcome } from '@/services/updateService';`
- Remove the `update` state (L34) and its `setUpdate(...)` calls. The open-time effect (L57-93) keeps `check()` only as an availability probe:
  - if it returns null, `setError('Actualización ya no disponible')`;
  - the catch stays as it is.
- Rewrite `handleDownloadAndInstall`:
```ts
const handleDownloadAndInstall = async () => {
  // Same UX as the Store (handleCloseToUpdate/handleInstallFromStore). Rust checks again.
  try {
    const state = await invoke<RecordingState>('get_recording_state');
    const busy = state?.phase ? state.phase !== 'idle' : state?.is_recording;
    if (busy) {
      void fileLogger.info('updater_dialog', 'direct-install-refused-recording', { phase: state?.phase });
      toast.warning('Hay una grabación en curso. Detenla antes de actualizar Maity.');
      return;
    }
  } catch { /* Rust is the authority: direct_update_install refuses anyway */ }

  setIsDownloading(true); setError(null); setProgress({ downloaded: 0, total: 0, percentage: 0 });
  let downloaded = 0; let contentLength = 0;
  const onEvent = new Channel<DownloadEvent>();
  onEvent.onmessage = (event) => { /* same switch Started/Progress/Finished as L129-161 */ };
  try {
    void fileLogger.info('updater_dialog', 'direct-install-start', { version: updateInfo?.version });
    const outcome = await invoke<DirectInstallOutcome>('direct_update_install', { onEvent });
    void fileLogger.info('updater_dialog', 'direct-install-result', { ...outcome });
    switch (outcome.kind) {
      case 'restarting': toast.success('Actualización instalada. Maity se reiniciará…'); break; // macOS/Linux
      case 'recordingActive': setIsDownloading(false); toast.warning('Empezó una grabación durante la descarga. Actualiza cuando la detengas.'); break;
      case 'noUpdate': setIsDownloading(false); setError('Actualización ya no disponible'); break;
      case 'busy': setIsDownloading(false); toast.info('La actualización ya se está instalando.'); break;
      case 'unsupported': setIsDownloading(false); setError('Esta instalación se actualiza desde su tienda.'); break;
      case 'error': setIsDownloading(false); setError(outcome.detail || 'Error al descargar o instalar actualización'); toast.error('Actualización fallida: ' + outcome.detail); break;
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    void fileLogger.error('updater_dialog', 'direct-install-failed', { message: errMsg });
    setError(errMsg || 'Error al descargar o instalar actualización'); setIsDownloading(false);
    toast.error('Actualización fallida: ' + errMsg);
  }
};
```
- On Windows success the process dies inside the invoke. NSIS /P /R relaunches the app, so no JS `relaunch()` is needed on any platform.
- Replace the `console.error` in the touched block with `logger.error`, because of ESLint `no-console` allow warn/error (console.error is allowed; optional).

### `frontend/src/services/updateService.ts`
- Delete `downloadAndInstall` (L344-370): dead code and an unsafe path.
- Delete the `relaunch` import (L25) and the `Update` import (L21 becomes `import { check } from '@tauri-apps/plugin-updater';`).
- Update the header comment (L8-9): "descarga + instala vía el comando Rust `direct_update_install` (se niega con grabación; cierra DB/sidecar antes del instalador)".
- Add and export:
  `export type DirectInstallOutcome = { kind: 'restarting' | 'noUpdate' | 'recordingActive' | 'busy' | 'unsupported' } | { kind: 'error'; detail: string };`

### `frontend/.eslintrc.json`, guard
Add to the `no-restricted-syntax` array (L13-22):
```json
{ "selector": "CallExpression[callee.property.name=/^(downloadAndInstall|install)$/]",
  "message": "No instales updates desde JS: en Windows plugin-updater termina en std::process::exit(0) y se salta RunEvent::Exit (grabación sin guardar, DB abierta, llama-helper vivo bloqueando el instalador). Usa invoke('direct_update_install') (B2, docs/CANALES_DISTRIBUCION.md)." }
```
No `.install(` or `downloadAndInstall(` call remains in src after the change (verified by grep before the change: only UpdateDialog.tsx:128 and updateService.ts:364).

### Docs
- `docs/CANALES_DISTRIBUCION.md`: new section `## Updater de descarga directa (NSIS) — B2`. It must cover:
  - on Windows the plugin exits with `process::exit(0)` and skips RunEvent::Exit;
  - the only path is `direct_update_install`;
  - it refuses in any phase != Idle (JS before downloading, Rust at start and after downloading, holding the StartGate);
  - the cleanup lives in its own `on_before_exit`, which replaces the plugin default and so must call `cleanup_before_exit()`, and runs only after a successful `extract()`;
  - never close the pool before that point;
  - if the hook ran and the app is still alive, request_restart;
  - no JS `relaunch()`;
  - the ESLint guard.
- `CLAUDE.md` § "Reglas de canales": one bullet with the same rule and a pointer to the doc.

## Order inside the hook (Windows)
1. `EXIT_HOOK_RAN = true`.
2. T2 exit intent: sync file write, plus `emit_event` awaited while the DB is still open, if T2 defines it.
3. `force_shutdown_sidecar` (5 s): frees llama-helper.exe so NSIS can overwrite it.
4. `db.cleanup()` (5 s): TRUNCATE checkpoint + `pool.close()`.
5. `log::logger().flush()`.
6. `cleanup_before_exit()`: tray icon, resources, hide windows.
7. The plugin then does ShellExecuteW, then `exit(0)`.

## Failure after prepare
- If check, download, signature, gate or extract fails: the hook has NOT run, so the pool is open and the sidecar alive. The gate is dropped (Idle), the in-flight guard is released, and the app keeps running. The dialog shows the error and "Cerrar".
- If a panic happens inside or after the hook: the pool may be closed. `after_failed_install` does `request_restart` so it reopens.
- If ShellExecuteW fails: the plugin ignores it and exits anyway (the app closes without an installer; the user reopens it). This is plugin behavior we cannot fix without a fork; it is documented as a risk.

## Files to change
- `frontend/src-tauri/src/direct_update.rs` — NEW. It holds: the `direct_update_install` command (Channel<DirectUpdateEvent> for progress); the `DirectUpdateEvent` enum (same serde shape as the plugin's DownloadEvent) and `DirectInstallOutcome`; the pure `refusal_for_phase` (only Idle may install); `exit_cleanup_blocking` (sidecar + DB cleanup with 5 s timeouts, log flush, T2 hook point); `after_failed_install`; the INSTALL_IN_FLIGHT and EXIT_HOOK_RAN flags; and unit tests.
- `frontend/src-tauri/src/lib.rs` — Add `pub mod direct_update;` (next to `pub mod database;`, L44). Register `direct_update::direct_update_install` in generate_handler! after `store_update::store_install_updates` (L1769). The updater plugin init (L638) and the RunEvent::Exit handler (L1786-1824) stay unchanged.
- `frontend/src/components/updates/UpdateDialog.tsx` — handleDownloadAndInstall: recording pre-check (phase !== 'idle', Store UX), then `invoke('direct_update_install', { onEvent: Channel })` with the same progress switch, handling each outcome. Remove the `update` state, the `Update` import and `relaunch`; the open-time check() stays only as an availability probe.
- `frontend/src/services/updateService.ts` — Delete the dead method downloadAndInstall (L344-370) and the `relaunch`/`Update` imports. Export the `DirectInstallOutcome` type. Update the header comment for the github channel.
- `frontend/src/components/updates/UpdateDialog.test.tsx` — Add `Channel` to the '@tauri-apps/api/core' mock. New describe 'UpdateDialog — canal directo (NSIS)' covering refusal while recording, the invoke of direct_update_install, the outcome mapping, and that downloadAndInstall is never called.
- `frontend/src-tauri/src/direct_update.rs (tests module)` — #[cfg(test)] refusal_for_phase table; outcome/event serialization; StartGate on a test PhaseMachine; exit_cleanup_blocking from spawn_blocking without panicking.
- `frontend/.eslintrc.json` — New `no-restricted-syntax` entry: selector `CallExpression[callee.property.name=/^(downloadAndInstall|install)$/]`, with a message pointing to direct_update_install.
- `docs/CANALES_DISTRIBUCION.md` — New section 'Updater de descarga directa (NSIS) — B2' with the rules and the reasons.
- `CLAUDE.md` — One bullet in 'Reglas de canales': NSIS updates only via `direct_update_install`, never plugin-updater install from JS; pointer to the doc.

## Commits
- **fix(updater): el update NSIS se niega con grabación en curso y cierra DB y sidecar antes del instalador**
  Rust: new module src-tauri/src/direct_update.rs with the `direct_update_install` command:
- Returns `unsupported` under MSIX / Mac App Store.
- A single-flight guard handles double clicks.
- Refuses when phase != Idle.
- Runs app.updater_builder() with its own on_before_exit: sidecar kill + db.cleanup() with 5 s timeouts, log flush, cleanup_before_exit(), and the hook point for T2's exit intent.
- Then check -> download with progress over a Channel.
- Then StartGate::acquire(); if a recording started during the download it returns recordingActive.
- Then update.install() inside spawn_blocking. On macOS/Linux it forgets the gate and calls request_restart. If install fails it drops the gate, and calls request_restart if the hook already ran.
- Unit tests.

lib.rs: `pub mod direct_update;` plus registration in generate_handler!.

TS:
- UpdateDialog: recording pre-check with the Store UX, invoke with a Channel, outcome mapping; no longer uses downloadAndInstall/relaunch.
- updateService: removes the dead downloadAndInstall and exports the DirectInstallOutcome type.
- UpdateDialog.test.tsx: tests for the direct channel.
- .eslintrc.json: guard against downloadAndInstall/install from JS.

Docs: new section in docs/CANALES_DISTRIBUCION.md and a bullet in CLAUDE.md.

Closing checks:
- pnpm run tauri:build:debug exits 0;
- cargo test direct_update;
- vitest UpdateDialog;
- graphify update .

Guardian protocol: this touches lib.rs / the command system, so create the backup branch backup/2026-09-23-b2-updater-nsis BEFORE editing (and go back to main).

Optional dependency on T2: if T2 lands first, call its sync exit-intent helper (reason update_restart / update_nsis) inside exit_cleanup_blocking before db.cleanup(). If B2 lands first, T2 adds that call. There is no hard dependency.

## Tests
- frontend/src-tauri/src/direct_update.rs #[cfg(test)]: `refusal_for_phase`: Idle -> None; Starting, Recording, Paused and Stopping -> Some(RecordingActive). This documents that Stopping (save in progress) also blocks, even though is_recording() is false.
- frontend/src-tauri/src/direct_update.rs #[cfg(test)]: Serialization. Outcome: `Error("x")` -> {kind:'error', detail:'x'}, `RecordingActive` -> {kind:'recordingActive'}, `NoUpdate` -> {kind:'noUpdate'}. Event: `Started{content_length:Some(3)}` -> {event:'Started', data:{contentLength:3}}, `Progress{chunk_length:5}` -> {event:'Progress', data:{chunkLength:5}}, `Finished` -> {event:'Finished'}. Same shape as the plugin's DownloadEvent, which the JS consumes.
- frontend/src-tauri/src/direct_update.rs #[cfg(test)]: StartGate as the install lock, on a `static TEST_MACHINE: PhaseMachine = PhaseMachine::new()`: acquire_on from Idle succeeds and the phase is Starting; a second acquire_on fails with 'already in progress' (the text the scheduler treats as benign, service.rs:654); dropping the gate returns to Idle. With the machine in Recording, acquire_on fails.
- frontend/src-tauri/src/direct_update.rs #[cfg(test)]: `#[tokio::test(flavor = "multi_thread")]`: `tauri::async_runtime::spawn_blocking(|| exit_cleanup_blocking(None)).await` finishes without panicking (block_on from a blocking thread) and leaves EXIT_HOOK_RAN = true. Reset it at the end. This is the real risk of the hook.
- frontend/src/components/updates/UpdateDialog.test.tsx: New describe 'canal directo (NSIS)' with updateInfo {channel:'github', available:true, version:'0.2.62'}; the core mock adds `Channel: class { onmessage: unknown = null }`. Cases: (1) invoke('get_recording_state') -> {phase:'recording', is_recording:true}: clicking 'Descargar e Instalar' calls toast.warning and invoke is never called with 'direct_update_install'. (2) phase 'stopping' -> also refused. (3) idle + outcome {kind:'error', detail:'boom'} -> 'boom' is shown and toast.error is called. (4) idle + {kind:'recordingActive'} -> toast.warning and the dialog is no longer 'Descargando'. (5) idle -> invoke is called with ('direct_update_install', {onEvent: expect.any(Object)}), and the `downloadAndInstall` spy on the object returned by the mocked check() is NEVER called.
- frontend (pnpm lint): The new ESLint rule passes over src; there are no `.install(` or `downloadAndInstall(` calls left.

## Risks
- The fix lives in the app that is RUNNING the update. Users on <=0.2.61 (NSIS channel stuck at 0.2.52 according to memory) still take the old unsafe path on the update that brings them 0.2.62. B2 only protects from 0.2.62 onward. → Say so in the docs and the release notes. Nothing technical can be done for the old binary, which runs its own code.
- Our on_before_exit REPLACES the plugin default (updater.rs:290 `.replace`). If `hook_app.cleanup_before_exit()` is forgotten, a ghost tray icon and windows are left behind during the install. → Call it explicitly as the last step of the hook, with a comment citing updater lib.rs:108-110. Cover it in the doc.
- If ShellExecuteW fails, the plugin ignores the error and calls exit(0) anyway (updater.rs:854-865). The app closes without installing. → Plugin behavior; there is no hook afterwards. The pool was closed cleanly and the checkpoints are safe, so the user reopens the app. Document it. Fixing it would need a fork or a plugin upgrade.
- A panic inside the hook or after it leaves the app alive with the pool closed. → EXIT_HOOK_RAN + after_failed_install -> app.request_restart() reopens the pool. There is a test for spawn_blocking + block_on without panic.
- Holding the StartGate (phase Starting) makes the scheduler see 'already in progress' during the ~1-3 s of extract. If install fails, the gate is dropped. → The scheduler treats it as benign ManualInProgress (service.rs:654-658). Drop(gate) on every failure branch. On macOS/Linux mem::forget only right before request_restart.
- Other sidecars/processes (ffmpeg from a merge/encode, the batch lote transcription) may be running while idle and lock files or get cut off by the NSIS installer. → Phase Idle guarantees no capture is live. The batch queue has the recurring orphan pass (5fac37d) and the sync queue is persistent. Whether ffmpeg.exe locks the install is UNVERIFIED; if it happens, add an ffmpeg kill to the hook in a later iteration.
- db.cleanup() awaits pool.close(), which waits for connections that are in use (sync worker). It could exceed the timeout. → 5 s timeout. Under WAL + synchronous=NORMAL an app exit does not lose commits (CLAUDE.md #28), so a timeout only skips the tidy close.
- Changing lib.rs / the command system is high-risk under the Guardian protocol. → Create the backup/2026-09-23-b2-updater-nsis branch before editing, then go back to main. The lib.rs change is 2 lines. The debug build must exit 0 before committing.
- No timeout on check()/download(). A hung download leaves the dialog stuck in 'Descargando' (it cannot be closed while downloading). → This is how it already behaves today. Optional: `.timeout(Duration::from_secs(600))` on the UpdaterBuilder. Left as an open question so as not to change the UX without a decision.
- Coordination with T2: on this path RunEvent::Exit never writes the clean-exit marker, so the next app.start could read it as a dirty crash. → exit_cleanup_blocking reserves the T2 hook point (sync marker with reason update_restart/update_nsis) before db.cleanup(). Whichever of B2/T2 lands second wires the call.

## Manual verification
- `cd frontend && pnpm run tauri:build:debug` exits 0 (foreground); `cargo test direct_update` and `pnpm vitest run src/components/updates` pass; `pnpm lint` shows no new errors.
- Direct-channel E2E on a test PC or VM (NOT the dev PC's MSIX; the Store is unaffected by this path). Build an NSIS debug/release with the version TEMPORARILY lowered (do not commit it) below the one in the GitHub latest.json, and install it. Then: (a) start a manual recording, open Ajustes > Acerca de > Buscar actualizaciones > 'Descargar e Instalar': expect the toast 'Hay una grabación en curso…', no download, and fileLogger 'direct-install-refused-recording'. (b) Stop the recording (while it is saving, phase stopping, it must refuse too). (c) Idle: download with a progress bar, the app closes, the NSIS passive installer shows its progress and relaunches Maity with the new version.
- After (c), check in %APPDATA%\com.maity.ai: `meeting_minutes.sqlite-wal` absent or 0 bytes (checkpoint TRUNCATE + close ran); in the old log, the lines '[direct_update] instalando', 'on_before_exit: sidecar + DB antes del instalador' and 'Database connection pool closed'; in Task Manager, no orphaned llama-helper.exe (with the coach warmed up beforehand so the sidecar was alive).
- Race: with jornada enabled and the window active, stop the jornada (rearm next hour) and start the update. If the scheduler starts during the download, it must return recordingActive with no install (toast 'Empezó una grabación durante la descarga…'), and the scheduler must keep recording normally.
- Failure: cut the network during the download (or block github.com): error shown in the dialog, the app keeps running, you can start a recording right away (phase back to Idle), and the DB works (list of conversations loads).
- Tray 'Check for Updates' (tray.rs:550) opens the same dialog and follows the same path.
- macOS (if there is a direct DMG build): same flow; the Rust request_restart relaunches, and RunEvent::Exit runs its normal cleanup.

## Open questions
- Exit-intent name for T2: the issue lists `update_restart`; the task mentions 'update_nsis'. Suggestion: reason `update_restart` plus a `channel: 'nsis'` detail, so the enum stays shared with the Store path (which would also be update_restart). T2 decides.
- Add a 'Detener y actualizar' button (stop + graceful save + install) later, or keep only the refusal (current Store parity)? This spec implements only the refusal.
- Put a timeout (e.g. 600 s) on check/download so the dialog does not hang with no way to close it? It changes current behavior; it was not included.
- Once the fix ships, should the `latest.json` of the GitHub release be regenerated (NSIS channel stuck at 0.2.52 per memory)? Without a GitHub release >=0.2.62, B2 reaches no NSIS user.

## Unverified
- Whether ffmpeg.exe (sidecar bundled in the exe folder) can be running while idle and lock the NSIS overwrite; and whether the Tauri NSIS installer in /UPDATE mode kills processes other than the main exe (the NSIS template was not read: tauri-bundler is not in the cargo registry).
- The exact behavior of the passive NSIS installer when a binary is locked (Retry/Ignore dialog vs silent failure).
- That no consumer (coach/summary) keeps an `Arc<SidecarPool>` clone that would respawn a sidecar between force_shutdown_sidecar and exit. In practice the hook runs milliseconds before exit(0), and while idle the coach is not active.
- The exact `use` path of `DatabaseManager` (state.rs:8 names it; the module path `crate::database::manager::DatabaseManager` is inferred from rival_install.rs using `.checkpoint()`/`.cleanup()`).
- That the logger in use does real buffering (no BufWriter found in logging/); `log::logger().flush()` is harmless either way.
- Real E2E of the NSIS update (needs a lower installed version plus the published latest.json); only static analysis of the plugin source was done.