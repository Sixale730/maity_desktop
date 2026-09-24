//! Update del canal de descarga directa (NSIS) — B2 de #83.
//!
//! Por qué existe: en Windows `tauri_plugin_updater::Update::install` termina en
//! `std::process::exit(0)` (`tauri-plugin-updater-2.10.0/src/updater.rs:865`)
//! justo después de lanzar el instalador con `ShellExecuteW`. Ese `exit` se
//! salta el handler `RunEvent::Exit` de `lib.rs`: no se guarda la grabación, no
//! se hace checkpoint ni cierre del pool de SQLite y `llama-helper.exe` queda
//! vivo bloqueando al instalador. Antes el JS llamaba `downloadAndInstall()` sin
//! revisar siquiera si había una grabación en curso.
//!
//! Este módulo es el ÚNICO camino de instalación del canal NSIS
//! (`direct_update_install`):
//! - se niega bajo MSIX (#71: las actualizaciones las da la Store) y en la Mac
//!   App Store (`Unsupported`), con otra instalación en vuelo (`Busy`), con
//!   cualquier fase de grabación distinta de `Idle` (`RecordingActive`) y con
//!   jobs de lote en `processing` (`PostProcessing`);
//! - descarga con progreso por `Channel` (misma forma serde que el
//!   `DownloadEvent` privado del plugin), toma el `StartGate` para que ningún
//!   arranque entre durante la instalación y llama `install` DENTRO de
//!   `spawn_blocking` (el `block_on` del hook entraría en pánico en un worker
//!   async);
//! - la limpieza vive en un `on_before_exit` propio que el plugin llama SOLO
//!   tras un `extract()` exitoso (updater.rs:794 y después :837-840): registra
//!   `app.exit` `update`/`nsis` (marcador durable + fila del outbox con flush de
//!   2 s), cierra el pool con checkpoint, vacía el log, mata el sidecar y hace
//!   `cleanup_before_exit()`. Nuestro hook REEMPLAZA al default del plugin
//!   (que solo hacía `cleanup_before_exit`), por eso se llama a mano.
//!
//! Nunca corre bajo MSIX ni en la Mac App Store. En macOS/Linux el plugin no
//! llama `on_before_exit`: `install` regresa `Ok` y aquí se pide el reinicio.

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{ipc::Channel, AppHandle, Manager};
use tauri_plugin_updater::UpdaterExt;

use crate::audio::recording_phase::{self, RecordingPhase, StartGate};
use crate::database::manager::DatabaseManager;
use crate::logging::telemetry::{drain, lifecycle};

/// Progreso de la descarga hacia el webview. Misma forma que el `DownloadEvent`
/// privado del plugin (`commands.rs:14-26`) para que el JS reuse su tipo
/// `DownloadEvent` y el `switch (event.event)`.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "event", content = "data")]
pub enum DirectUpdateEvent {
    #[serde(rename_all = "camelCase")]
    Started { content_length: Option<u64> },
    #[serde(rename_all = "camelCase")]
    Progress { chunk_length: usize },
    Finished,
}

/// Resultado de `direct_update_install`. Se serializa a `{kind}` /
/// `{kind:"error", detail}` en camelCase; U2 espeja estos literales en TS
/// (`services/updateService.ts::DirectInstallOutcome`): no cambiarlos.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", content = "detail", rename_all = "camelCase")]
pub enum DirectInstallOutcome {
    /// Instalado sin salir del proceso (macOS/Linux): se pidió el reinicio.
    Restarting,
    /// El servidor ya no anuncia una versión nueva.
    NoUpdate,
    /// Hay una grabación en cualquier fase distinta de `Idle`, o una empezó
    /// durante la descarga (el `StartGate` no se pudo tomar).
    RecordingActive,
    /// Hay jobs de transcripción por lote en `processing`.
    PostProcessing,
    /// Ya hay una instalación en vuelo (single-flight).
    Busy,
    /// MSIX / Mac App Store: las actualizaciones las da la tienda.
    Unsupported,
    Error(String),
}

/// Single-flight del comando: dos diálogos (tray + Ajustes) no descargan ni
/// instalan a la vez.
static INSTALL_IN_FLIGHT: AtomicBool = AtomicBool::new(false);

/// Libera `INSTALL_IN_FLIGHT` en cualquier retorno del comando.
struct InFlightGuard;

impl Drop for InFlightGuard {
    fn drop(&mut self) {
        INSTALL_IN_FLIGHT.store(false, Ordering::SeqCst);
    }
}

/// `true` desde que el hook de salida empezó: a partir de ahí el pool de la DB
/// puede estar cerrado y la app no debe volver a operar con normalidad.
static EXIT_HOOK_RAN: AtomicBool = AtomicBool::new(false);

/// Pura. Solo `Idle` deja instalar: `is_recording()` no cubre `Starting` ni
/// `Stopping`, y `Stopping` (guardando) también debe bloquear.
pub fn refusal_for_phase(phase: RecordingPhase) -> Option<DirectInstallOutcome> {
    match phase {
        RecordingPhase::Idle => None,
        _ => Some(DirectInstallOutcome::RecordingActive),
    }
}

/// Pura. Cualquier job de lote en `processing` bloquea la instalación.
pub fn refusal_for_processing(processing_jobs: i64) -> Option<DirectInstallOutcome> {
    if processing_jobs > 0 {
        Some(DirectInstallOutcome::PostProcessing)
    } else {
        None
    }
}

/// Qué hacer con el `StartGate` si `install` falla.
#[derive(Debug, PartialEq, Eq)]
enum GateOnFailure {
    /// El hook no corrió: nada se cerró, la fase vuelve a `Idle`.
    Drop,
    /// El hook corrió (pool cerrado, sidecar muerto): la fase se queda en
    /// `Starting` para bloquear arranques y se pide el reinicio.
    ForgetAndRestart,
}

/// Pura. Ver [`GateOnFailure`].
fn gate_on_failure(hook_ran: bool) -> GateOnFailure {
    if hook_ran {
        GateOnFailure::ForgetAndRestart
    } else {
        GateOnFailure::Drop
    }
}

/// Pone `flag` en `true` PRIMERO y luego ejecuta `body` bajo `catch_unwind`.
/// Devuelve `true` si `body` terminó sin pánico. El flag llega por parámetro
/// para que los tests usen un `AtomicBool` local y no el static.
fn run_exit_hook(flag: &AtomicBool, body: impl FnOnce()) -> bool {
    flag.store(true, Ordering::SeqCst);
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(body)).is_ok()
}

/// Cuenta los jobs de lote en `processing`. Todas las filas `processing` son de
/// este proceso: al arrancar `BatchQueueRepository::reset_processing` regresa a
/// `pending` lo abandonado. Un error de consulta devuelve 0 (la fase y el JS
/// siguen protegiendo; nunca bloquear los updates para siempre por esto).
async fn processing_batch_jobs(pool: &sqlx::SqlitePool) -> i64 {
    match sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM batch_transcription_queue WHERE status = 'processing'",
    )
    .fetch_one(pool)
    .await
    {
        Ok(n) => n,
        Err(e) => {
            log::warn!(
                "[direct_update] no se pudo contar la cola de lote (se asume 0): {}",
                e
            );
            0
        }
    }
}

/// Hook de salida (síncrono, en el hilo de `spawn_blocking` dentro del
/// `on_before_exit` del plugin, tras un `extract()` exitoso). Orden fijo
/// (contrato §6.1): marcador → fila `app.exit` + flush → DB → log → sidecar.
/// El sidecar va al FINAL: `get_sidecar_pool` lo re-crea de forma perezosa y
/// matarlo antes de esperar la DB abriría una ventana para que reapareciera.
fn exit_cleanup_blocking(app: &AppHandle, db: Option<DatabaseManager>) {
    let ok = run_exit_hook(&EXIT_HOOK_RAN, || {
        // a. Marcador durable PRIMERO (también apaga la drenadora).
        let record = lifecycle::begin_exit(Some(lifecycle::ExitHint::Update { via: "nsis" }));

        // b. Fila del outbox + flush dirigido, DB, log y sidecar.
        tauri::async_runtime::block_on(async {
            if let Some(rec) = record.as_ref() {
                if let Some(id) =
                    lifecycle::emit_exit_row(app, rec, lifecycle::EXIT_ROW_TIMEOUT).await
                {
                    let outcome = drain::flush_row(app, id, Duration::from_secs(2)).await;
                    log::info!("[direct_update] flush de app.exit ({}): {:?}", id, outcome);
                }
            }
            if let Some(db) = db.as_ref() {
                match tokio::time::timeout(Duration::from_secs(5), db.cleanup()).await {
                    Ok(Ok(())) => log::info!("[direct_update] pool de la DB cerrado"),
                    Ok(Err(e)) => log::warn!("[direct_update] cierre de la DB falló: {}", e),
                    Err(_) => log::warn!("[direct_update] cierre de la DB excedió 5 s"),
                }
            }
            log::logger().flush();
            match tokio::time::timeout(
                Duration::from_secs(5),
                crate::summary::summary_engine::force_shutdown_sidecar(),
            )
            .await
            {
                Ok(Ok(())) => {}
                Ok(Err(e)) => log::warn!("[direct_update] no se pudo detener el sidecar: {}", e),
                Err(_) => log::warn!("[direct_update] detener el sidecar excedió 5 s"),
            }
        });

        // c. Sella `done_at_ms` (sin esto el siguiente `app.start` leería una
        //    salida interrumpida).
        lifecycle::finish_exit();
    });

    if ok {
        // Nuestro hook reemplaza al default del plugin, que solo hacía esto.
        app.cleanup_before_exit();
    } else {
        log::warn!(
            "[direct_update] el hook de salida entró en pánico; se omite cleanup_before_exit"
        );
    }
}

/// Falla de `install`: revisa `EXIT_HOOK_RAN` ANTES de soltar el gate.
fn on_failure(app: &AppHandle, gate: StartGate) {
    match gate_on_failure(EXIT_HOOK_RAN.load(Ordering::SeqCst)) {
        GateOnFailure::ForgetAndRestart => {
            // La fase sigue en Starting: bloquea arranques contra un pool cerrado.
            std::mem::forget(gate);
            log::error!(
                "[direct_update] la instalación falló después del hook de salida; reiniciando Maity"
            );
            app.request_restart();
        }
        GateOnFailure::Drop => drop(gate),
    }
}

/// Update del canal directo (NSIS). Ver el doc del módulo.
#[tauri::command]
pub async fn direct_update_install(
    app: AppHandle,
    on_event: Channel<DirectUpdateEvent>,
) -> Result<DirectInstallOutcome, String> {
    // 1) MSIX / Mac App Store: las actualizaciones las da la tienda.
    if crate::utils::is_running_under_package_identity() || crate::utils::is_mac_app_store_build() {
        return Ok(DirectInstallOutcome::Unsupported);
    }

    // 2) Single-flight.
    if INSTALL_IN_FLIGHT.swap(true, Ordering::SeqCst) {
        return Ok(DirectInstallOutcome::Busy);
    }
    let _in_flight = InFlightGuard;

    // 3) Cualquier fase distinta de Idle se niega sin descargar.
    let phase = recording_phase::current_phase();
    if let Some(refusal) = refusal_for_phase(phase) {
        log::warn!(
            "[direct_update] update rechazado: grabación en fase '{}'",
            phase.as_str()
        );
        return Ok(refusal);
    }

    // 4) Post-proceso de lote en curso.
    let db = app
        .try_state::<crate::state::AppState>()
        .map(|s| s.db_manager.clone());
    if let Some(db) = &db {
        if let Some(refusal) = refusal_for_processing(processing_batch_jobs(db.pool()).await) {
            log::warn!("[direct_update] update rechazado: hay jobs de lote en processing");
            return Ok(refusal);
        }
    }

    // 5) Updater con nuestro hook de salida (conserva config, pubkey, modo
    //    Passive y current_exe_args del plugin registrado en lib.rs).
    let hook_app = app.clone();
    let hook_db = db.clone();
    let updater = app
        .updater_builder()
        .on_before_exit(move || exit_cleanup_blocking(&hook_app, hook_db.clone()))
        .build()
        .map_err(|e| e.to_string())?;

    // 6) Check.
    let update = match updater.check().await {
        Ok(Some(update)) => update,
        Ok(None) => return Ok(DirectInstallOutcome::NoUpdate),
        Err(e) => return Ok(DirectInstallOutcome::Error(e.to_string())),
    };
    log::info!(
        "[direct_update] update disponible: {} (actual {})",
        update.version,
        update.current_version
    );

    // 7) Descarga con progreso (la firma se verifica dentro de `download`).
    let chunk_channel = on_event.clone();
    let finish_channel = on_event;
    let mut first = true;
    let bytes = match update
        .download(
            move |chunk_length, content_length| {
                if first {
                    first = false;
                    let _ = chunk_channel.send(DirectUpdateEvent::Started { content_length });
                }
                let _ = chunk_channel.send(DirectUpdateEvent::Progress { chunk_length });
            },
            move || {
                let _ = finish_channel.send(DirectUpdateEvent::Finished);
            },
        )
        .await
    {
        Ok(bytes) => bytes,
        Err(e) => return Ok(DirectInstallOutcome::Error(e.to_string())),
    };

    // 8) Candado de arranque: desde aquí ningún camino de arranque entra
    //    (el scheduler trata "already in progress" como benigno).
    let gate = match StartGate::acquire() {
        Ok(g) => g,
        Err(e) => {
            log::warn!(
                "[direct_update] no se pudo tomar el StartGate tras la descarga: {}",
                e
            );
            return Ok(DirectInstallOutcome::RecordingActive);
        }
    };

    // 9) Re-chequeo del post-proceso con el gate tomado.
    if let Some(db) = &db {
        if let Some(refusal) = refusal_for_processing(processing_batch_jobs(db.pool()).await) {
            log::warn!("[direct_update] update rechazado tras la descarga: jobs de lote en processing");
            drop(gate);
            return Ok(refusal);
        }
    }

    // 10) SIEMPRE en spawn_blocking: el `block_on` del hook entraría en pánico
    //     si `install` corriera en un worker async. En Windows el proceso muere
    //     aquí dentro (`process::exit(0)` del plugin).
    let joined = tauri::async_runtime::spawn_blocking(move || update.install(bytes)).await;

    // 11) Solo macOS/Linux llegan con `Ok(Ok(()))`.
    match joined {
        Ok(Ok(())) => {
            // La fase queda en Starting hasta el reinicio.
            std::mem::forget(gate);
            app.request_restart();
            Ok(DirectInstallOutcome::Restarting)
        }
        Ok(Err(e)) => {
            on_failure(&app, gate);
            Ok(DirectInstallOutcome::Error(e.to_string()))
        }
        Err(join) => {
            on_failure(&app, gate);
            Ok(DirectInstallOutcome::Error(format!(
                "el instalador abortó: {join}"
            )))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::recording_phase::PhaseMachine;
    use serde_json::json;
    use std::sync::Arc;

    fn leaked_machine() -> &'static PhaseMachine {
        Box::leak(Box::new(PhaseMachine::new()))
    }

    #[test]
    fn refusal_for_phase_solo_idle_deja_instalar() {
        assert_eq!(refusal_for_phase(RecordingPhase::Idle), None);
        for phase in [
            RecordingPhase::Starting,
            RecordingPhase::Recording,
            RecordingPhase::Paused,
            RecordingPhase::Stopping,
        ] {
            assert_eq!(
                refusal_for_phase(phase),
                Some(DirectInstallOutcome::RecordingActive),
                "{:?} debe negarse",
                phase
            );
        }
    }

    #[test]
    fn refusal_for_processing_con_jobs() {
        assert_eq!(refusal_for_processing(0), None);
        assert_eq!(
            refusal_for_processing(1),
            Some(DirectInstallOutcome::PostProcessing)
        );
        assert_eq!(
            refusal_for_processing(3),
            Some(DirectInstallOutcome::PostProcessing)
        );
    }

    #[test]
    fn gate_on_failure_segun_el_hook() {
        assert_eq!(gate_on_failure(true), GateOnFailure::ForgetAndRestart);
        assert_eq!(gate_on_failure(false), GateOnFailure::Drop);
    }

    #[test]
    fn outcome_serializa_como_espera_el_js() {
        assert_eq!(
            serde_json::to_value(DirectInstallOutcome::Error("x".into())).unwrap(),
            json!({"kind": "error", "detail": "x"})
        );
        assert_eq!(
            serde_json::to_value(DirectInstallOutcome::RecordingActive).unwrap(),
            json!({"kind": "recordingActive"})
        );
        assert_eq!(
            serde_json::to_value(DirectInstallOutcome::PostProcessing).unwrap(),
            json!({"kind": "postProcessing"})
        );
        assert_eq!(
            serde_json::to_value(DirectInstallOutcome::NoUpdate).unwrap(),
            json!({"kind": "noUpdate"})
        );
    }

    #[test]
    fn evento_serializa_como_el_download_event_del_plugin() {
        assert_eq!(
            serde_json::to_value(DirectUpdateEvent::Started {
                content_length: Some(3)
            })
            .unwrap(),
            json!({"event": "Started", "data": {"contentLength": 3}})
        );
        assert_eq!(
            serde_json::to_value(DirectUpdateEvent::Progress { chunk_length: 5 }).unwrap(),
            json!({"event": "Progress", "data": {"chunkLength": 5}})
        );
        assert_eq!(
            serde_json::to_value(DirectUpdateEvent::Finished).unwrap(),
            json!({"event": "Finished"})
        );
    }

    #[test]
    fn run_exit_hook_block_on_desde_hilo_no_async() {
        let flag = Arc::new(AtomicBool::new(false));
        let f = flag.clone();
        let ok = std::thread::spawn(move || {
            run_exit_hook(&f, || {
                tauri::async_runtime::block_on(async {
                    tokio::time::sleep(Duration::from_millis(1)).await;
                })
            })
        })
        .join()
        .expect("el hilo no debe entrar en pánico");
        assert!(ok);
        assert!(flag.load(Ordering::SeqCst));
    }

    #[test]
    fn run_exit_hook_con_panico_devuelve_false_y_deja_el_flag() {
        let flag = AtomicBool::new(false);
        let ok = run_exit_hook(&flag, || panic!("pánico de prueba en el hook"));
        assert!(!ok);
        assert!(flag.load(Ordering::SeqCst), "el flag se pone ANTES del body");
    }

    #[test]
    fn start_gate_como_candado_de_la_instalacion() {
        let m = leaked_machine();
        let gate = StartGate::acquire_on(m).expect("desde Idle se toma");
        assert_eq!(m.current(), RecordingPhase::Starting);
        let err = StartGate::acquire_on(m).unwrap_err();
        assert!(err.contains("already in progress"), "{err}");
        drop(gate);
        assert_eq!(m.current(), RecordingPhase::Idle, "drop vuelve a Idle");

        let gate = StartGate::acquire_on(m).unwrap();
        std::mem::forget(gate);
        assert_eq!(
            m.current(),
            RecordingPhase::Starting,
            "forget deja la fase en Starting"
        );
    }

    #[tokio::test]
    async fn processing_batch_jobs_cuenta_solo_processing() {
        use sqlx::sqlite::SqlitePoolOptions;
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect(":memory:")
            .await
            .unwrap();

        // Sin la tabla: 0, sin pánico.
        assert_eq!(processing_batch_jobs(&pool).await, 0);

        sqlx::query(
            "CREATE TABLE batch_transcription_queue (id INTEGER PRIMARY KEY, status TEXT NOT NULL)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO batch_transcription_queue (status) VALUES ('pending'), ('done')")
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(processing_batch_jobs(&pool).await, 0);

        sqlx::query("INSERT INTO batch_transcription_queue (status) VALUES ('processing')")
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(processing_batch_jobs(&pool).await, 1);
    }
}
