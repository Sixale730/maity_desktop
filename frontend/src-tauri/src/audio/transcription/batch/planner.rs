// audio/transcription/batch/planner.rs
//
// Planificador HÍBRIDO de la transcripción por lote (F2): decide CUÁNDO correr
// los jobs de `batch_transcription_queue` — al cerrar el segmento si hay
// memoria/CPU libre (política #22), y si no, difiere (reintento cada 5 min,
// drenaje a fin de jornada, o el siguiente arranque). Nunca pierde audio: un
// job que no puede correr simplemente espera.
//
// **Tarea propia** arrancada en `lib.rs` junto a `audio_retention` (mismo
// criterio: el tick del scheduler solo corre con jornada habilitada, el worker
// de cloud_sync se gatea por sesión, y el `mem_sampler` no debe cargar con
// trabajo ajeno a su timing).
//
// **Single-flight**: este loop es el ÚNICO consumidor de `pending` (y el
// `claim` del repo es un mutex por fila) — jamás dos jobs de lote a la vez.
//
// En F2 nadie INSERTA filas todavía (los disparadores llegan en F3): el
// planner arranca, recupera huérfanos si los hubiera y espera señales.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use log::{info, warn};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::sync::Notify;

use crate::audio::recording_phase::{self, RecordingPhase};
use crate::database::repositories::batch_queue::BatchQueueRepository;
use crate::logging::telemetry::status::TelemetryStatus;
use crate::logging::mem_sampler::{self, PressureLevel};

use super::transcriber::transcribe_folder;

/// Headroom exigido para CARGAR Parakeet y transcribir: el pico transitorio de
/// carga ronda 1.3 GB (auditoría #02/#22) más margen. **Calibrar con la
/// medición F0c** (ciclo login→logout en máquina de 5-6 GB).
pub(crate) const BATCH_HEADROOM_MB: u64 = 1800;
/// Con el modelo YA residente no hay pico de carga: solo el working set de la
/// inferencia por chunks.
pub(crate) const BATCH_HEADROOM_WARM_MB: u64 = 400;
/// Por encima de esto la máquina está para el usuario, no para transcribir.
const CPU_MAX_PCT: f32 = 80.0;
/// Reintentos por job antes de `failed` (el audio queda en disco).
const MAX_ATTEMPTS: i64 = 5;
/// Pista libre al arranque: `autoRecoverAll` y la init de motores van primero
/// (mismo delay que `audio_retention`).
const STARTUP_DELAY: Duration = Duration::from_secs(120);
/// Tick de reintento cuando el gate difirió o llegó un fallo transitorio.
const RETRY_TICK: Duration = Duration::from_secs(5 * 60);

static NOTIFY: LazyLock<Notify> = LazyLock::new(Notify::new);
/// Modo drenaje: procesar FIFO hasta vaciar ignorando el gate (salvo
/// `Critical`). Lo piden el cierre de jornada (F3) y el arranque con backlog.
static DRAIN: AtomicBool = AtomicBool::new(false);
/// Latch del evento `stt.batch_deferred`: una fila por episodio de deferral
/// (misma razón consecutiva no re-emite), no una por tick.
static DEFER_LATCH: Mutex<Option<&'static str>> = Mutex::new(None);

/// Señal "hay un job nuevo en pending" (la llaman los disparadores de F3).
pub fn notify_enqueued() {
    NOTIFY.notify_one();
}

/// Señal de drenaje (fin de jornada / arranque con backlog).
pub fn request_drain() {
    DRAIN.store(true, Ordering::SeqCst);
    NOTIFY.notify_one();
}

// ────────────────────────────────────────────────────────────────────────────
// Gate híbrido — política PURA, tabulada en tests
// ────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy)]
pub(crate) struct GateInputs {
    pub pressure: PressureLevel,
    /// `None` antes del primer tick del sampler (fail-open).
    pub sys_avail_mb: Option<u64>,
    pub cpu_pct: Option<f32>,
    /// Con el modelo residente el headroom exigido baja (no hay pico de carga).
    pub model_loaded: bool,
    /// Fase de grabación distinta de `Idle`.
    pub recording_active: bool,
    /// `true` = la grabación activa es streaming (consume el motor).
    pub recording_uses_stt: bool,
    pub drain: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum GateDecision {
    Go,
    /// Razón para `stt.batch_deferred`.
    Defer(&'static str),
}

pub(crate) fn required_headroom_mb(model_loaded: bool) -> u64 {
    if model_loaded {
        BATCH_HEADROOM_WARM_MB
    } else {
        BATCH_HEADROOM_MB
    }
}

/// Decisión de tomar (o no) el siguiente job.
///
/// - Con una grabación STREAMING activa siempre difiere (el motor y la máquina
///   son de la grabación en vivo) — también en drain.
/// - En drain solo `Critical` difiere: el objetivo es vaciar la cola.
/// - Normal: presión `Normal`, headroom suficiente y CPU < 80 %.
/// - `None` en avail/cpu = sin datos del sampler todavía → fail-open (coherente
///   con `pressure_level()`, que devuelve `Normal` antes del primer tick).
pub(crate) fn gate(i: &GateInputs) -> GateDecision {
    if i.recording_active && i.recording_uses_stt {
        return GateDecision::Defer("streaming_active");
    }
    if i.drain {
        if i.pressure >= PressureLevel::Critical {
            return GateDecision::Defer("pressure");
        }
        return GateDecision::Go;
    }
    if i.pressure > PressureLevel::Normal {
        return GateDecision::Defer("pressure");
    }
    if let Some(avail) = i.sys_avail_mb {
        if avail < required_headroom_mb(i.model_loaded) {
            return GateDecision::Defer("headroom");
        }
    }
    if let Some(cpu) = i.cpu_pct {
        if cpu > CPU_MAX_PCT {
            return GateDecision::Defer("cpu");
        }
    }
    GateDecision::Go
}

// ────────────────────────────────────────────────────────────────────────────
// Tarea
// ────────────────────────────────────────────────────────────────────────────

pub fn spawn<R: Runtime>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        run(app).await;
    });
}

async fn run<R: Runtime>(app: AppHandle<R>) {
    tokio::time::sleep(STARTUP_DELAY).await;
    startup_recovery(&app).await;
    loop {
        tokio::select! {
            _ = NOTIFY.notified() => {}
            _ = tokio::time::sleep(RETRY_TICK) => {}
        }
        process_queue(&app).await;
    }
}

fn db_pool<R: Runtime>(app: &AppHandle<R>) -> Option<sqlx::SqlitePool> {
    let state = app.try_state::<crate::state::AppState>()?;
    Some(state.db_manager.pool().clone())
}

async fn current_user<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    let state = app.try_state::<crate::state::AppState>()?;
    state.current_user_id().await
}

/// Recuperación post-crash al arranque: `processing` abandonado → `pending`;
/// filas `recording` huérfanas → fusionar checkpoints → `pending` con
/// `trigger_kind='crash_recovery'`; carpeta desaparecida → `failed`.
///
/// Si hay una grabación ACTIVA se salta la pasada entera: la fila `recording`
/// de esa grabación es legítima y en F2 no hay forma de distinguirla por
/// carpeta (el disparador que registra la carpeta activa llega en F3). Las
/// filas quedan para el siguiente arranque — nunca se pierde nada.
async fn startup_recovery<R: Runtime>(app: &AppHandle<R>) {
    let Some(pool) = db_pool(app) else {
        warn!("[batch-planner] AppState no disponible al arranque; sin recuperación");
        return;
    };

    match BatchQueueRepository::reset_processing(&pool).await {
        Ok(0) => {}
        Ok(n) => info!("[batch-planner] {} job(s) 'processing' abandonados → pending", n),
        Err(e) => warn!("[batch-planner] reset_processing falló: {}", e),
    }

    if recording_phase::current_phase() != RecordingPhase::Idle {
        info!("[batch-planner] grabación activa al arranque: recuperación de huérfanos pospuesta");
    } else {
        let orphans = match BatchQueueRepository::recording_rows(&pool).await {
            Ok(rows) => rows,
            Err(e) => {
                warn!("[batch-planner] no se pudieron listar filas 'recording': {}", e);
                Vec::new()
            }
        };
        for job in orphans {
            recover_orphan(&pool, &job).await;
        }
    }

    // Backlog al arranque (pendientes diferidos de la sesión anterior): drenar.
    if let Some(user) = current_user(app).await {
        match BatchQueueRepository::pending_count(&pool, &user).await {
            Ok(n) if n > 0 => {
                info!("[batch-planner] {} job(s) pendientes al arranque: drenaje", n);
                request_drain();
            }
            Ok(_) => {}
            Err(e) => warn!("[batch-planner] pending_count falló: {}", e),
        }
    }
}

async fn recover_orphan(pool: &sqlx::SqlitePool, job: &crate::database::models::BatchQueueJob) {
    let folder = Path::new(&job.folder_path);
    if !folder.exists() {
        warn!("[batch-planner] carpeta desaparecida, job {} → failed: {}", job.id, job.folder_path);
        let _ = BatchQueueRepository::fail_permanent(pool, job.id, "folder_missing").await;
        return;
    }
    if folder.join("audio.mp4").exists() {
        // El merge ya había corrido (crash post-finalize del audio): listo.
        let _ = BatchQueueRepository::mark_crash_recovery(pool, job.id).await;
        info!("[batch-planner] job {} recuperado (audio.mp4 ya fusionado)", job.id);
        return;
    }
    // Fusionar los checkpoints que hayan quedado (reusa el comando de la
    // recuperación clásica; sample rate legacy, el fn lo ignora).
    match crate::audio::incremental_saver::recover_audio_from_checkpoints(
        job.folder_path.clone(),
        48_000,
    )
    .await
    {
        Ok(status) if status.status == "success" || status.status == "partial" => {
            let _ = BatchQueueRepository::mark_crash_recovery(pool, job.id).await;
            info!(
                "[batch-planner] job {} recuperado de checkpoints ({}, {} chunks)",
                job.id, status.status, status.chunk_count
            );
        }
        Ok(status) => {
            warn!(
                "[batch-planner] job {} sin audio recuperable ({}): failed",
                job.id, status.status
            );
            let _ = BatchQueueRepository::fail_permanent(
                pool,
                job.id,
                &format!("recovery_{}", status.status),
            )
            .await;
        }
        Err(e) => {
            warn!("[batch-planner] recuperación del job {} falló: {}", job.id, e);
            let _ = BatchQueueRepository::fail(pool, job.id, &e, MAX_ATTEMPTS).await;
        }
    }
}

async fn collect_gate_inputs() -> GateInputs {
    GateInputs {
        pressure: mem_sampler::pressure_level(),
        sys_avail_mb: mem_sampler::last_sys_avail_mb(),
        cpu_pct: mem_sampler::last_cpu_pct(),
        model_loaded: crate::audio::transcription::engine::any_local_engine_loaded().await,
        recording_active: recording_phase::current_phase() != RecordingPhase::Idle,
        recording_uses_stt: crate::audio::transcription::engine::active_recording_uses_stt(),
        drain: DRAIN.load(Ordering::SeqCst),
    }
}

/// Procesa jobs hasta vaciar la cola o hasta que el gate difiera.
async fn process_queue<R: Runtime>(app: &AppHandle<R>) {
    let Some(pool) = db_pool(app) else { return };
    let Some(user) = current_user(app).await else {
        // Sin sesión el STT no calienta (fail-closed): los jobs esperan.
        return;
    };

    let mut processed_any = false;
    loop {
        let job = match BatchQueueRepository::next_pending(&pool, &user).await {
            Ok(Some(j)) => j,
            Ok(None) => break,
            Err(e) => {
                warn!("[batch-planner] next_pending falló: {}", e);
                break;
            }
        };

        let inputs = collect_gate_inputs().await;
        match gate(&inputs) {
            GateDecision::Defer(reason) => {
                emit_deferred_latched(app, reason, inputs.pressure).await;
                if reason == "pressure" && inputs.drain {
                    // Critical en pleno drain: soltar el modo drenaje, el
                    // tick de 5 min lo retomará cuando la presión baje.
                    DRAIN.store(false, Ordering::SeqCst);
                }
                return;
            }
            GateDecision::Go => clear_defer_latch(),
        }

        if !BatchQueueRepository::claim(&pool, job.id).await.unwrap_or(false) {
            continue;
        }
        emit_status(app, &job.folder_path, None, "processing", Some(&job.trigger_kind));

        info!(
            "[batch-planner] job {} ({}, intento {}): {}",
            job.id,
            job.trigger_kind,
            job.attempts + 1,
            job.folder_path
        );
        let result = transcribe_folder(app, Path::new(&job.folder_path), "transcripts.json").await;
        processed_any = true;
        match result {
            Ok(metrics) => {
                // transcripts.json escrito: finalizar por el MISMO camino que el
                // streaming headless (SQLite + outbox cloud + descarte por umbral
                // según origen — manual NUNCA descarta).
                use crate::scheduled_recording::service::SegmentOutcome;
                match finalize_job(app, &job).await {
                    SegmentOutcome::Saved(meeting_id) => {
                        let _ = BatchQueueRepository::complete(&pool, job.id, "done").await;
                        emit_status(app, &job.folder_path, Some(&meeting_id), "ready", Some(&job.trigger_kind));
                        emit_batch_job(app, &job.trigger_kind, TelemetryStatus::Ok, job.attempts + 1, Some(&metrics), "saved").await;
                    }
                    SegmentOutcome::Discarded => {
                        let _ = BatchQueueRepository::complete(&pool, job.id, "discarded").await;
                        emit_status(app, &job.folder_path, None, "discarded", Some(&job.trigger_kind));
                        emit_batch_job(app, &job.trigger_kind, TelemetryStatus::Ok, job.attempts + 1, Some(&metrics), "discarded").await;
                    }
                    SegmentOutcome::Failed => {
                        let _ = BatchQueueRepository::fail(&pool, job.id, "finalize_failed", MAX_ATTEMPTS).await;
                        let terminal = job.attempts + 1 >= MAX_ATTEMPTS;
                        emit_status(app, &job.folder_path, None, if terminal { "failed" } else { "pending" }, Some(&job.trigger_kind));
                        emit_batch_job(app, &job.trigger_kind, TelemetryStatus::Error, job.attempts + 1, None, "finalize_failed").await;
                    }
                }
            }
            Err(e) => {
                warn!("[batch-planner] job {} falló: {}", job.id, e);
                let _ = BatchQueueRepository::fail(&pool, job.id, &e, MAX_ATTEMPTS).await;
                let terminal = job.attempts + 1 >= MAX_ATTEMPTS;
                emit_status(app, &job.folder_path, None, if terminal { "failed" } else { "pending" }, Some(&job.trigger_kind));
                emit_batch_job(app, &job.trigger_kind, TelemetryStatus::Error, job.attempts + 1, None, "transcribe_failed").await;
            }
        }
    }

    // Cola vacía: fin del drenaje y, si trabajamos, soltar el modelo (#02).
    DRAIN.store(false, Ordering::SeqCst);
    if processed_any {
        let outcome = crate::audio::transcription::engine::unload_stt(app, "batch_done").await;
        info!("[batch-planner] cola vacía, unload: {:?}", outcome);
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Telemetría (contrato de 3 entradas: catalog.rs + telemetry-events.ts + doc)
// ────────────────────────────────────────────────────────────────────────────

/// Finaliza un job cuyo `transcripts.json` ya está en disco, reusando el mismo
/// finalize headless del scheduler. El origen (`trigger_kind` de la fila,
/// sellado al ARRANCAR el segmento) decide la política: los segmentos de
/// jornada aplican `MIN_SEGMENT_WORDS`; los manuales nunca descartan.
async fn finalize_job<R: Runtime>(
    app: &AppHandle<R>,
    job: &crate::database::models::BatchQueueJob,
) -> crate::scheduled_recording::service::SegmentOutcome {
    let meeting_name = read_meeting_name(&job.folder_path);
    let started_at = job
        .segment_started_at
        .as_deref()
        .and_then(|s| chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S").ok())
        .unwrap_or_else(|| chrono::Local::now().naive_local());
    let (trigger, enforce): (&'static str, bool) = match job.trigger_kind.as_str() {
        "manual" => ("manual", false),
        "auto_close" => ("auto_close", true),
        _ => ("rotation", true),
    };
    crate::scheduled_recording::service::finalize_segment_native(
        app,
        &job.folder_path,
        &meeting_name,
        started_at,
        trigger,
        enforce,
    )
    .await
}

/// Nombre de la reunión desde `metadata.json` (el saver lo escribe al arrancar);
/// fallback: el nombre de la carpeta. `pub(crate)`: lo reusa
/// `database::batch_queue_commands` para proyectar las filas de la cola en la UI.
pub(crate) fn read_meeting_name(folder_path: &str) -> String {
    let meta = Path::new(folder_path).join("metadata.json");
    std::fs::read_to_string(&meta)
        .ok()
        .and_then(|c| serde_json::from_str::<serde_json::Value>(&c).ok())
        .and_then(|v| v.get("meeting_name").and_then(|n| n.as_str()).map(str::to_string))
        .unwrap_or_else(|| {
            Path::new(folder_path)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "Reunión".to_string())
        })
}

/// Evento gemelo `batch-transcription-status` para la UI (F4 lo consume).
/// `trigger` (aditivo, F4) es el `trigger_kind` de la fila — solo para los
/// textos del provider ("Transcripción lista" manual vs jornada silenciosa);
/// el stop lo emite `null` porque no relee la fila.
fn emit_status<R: Runtime>(
    app: &AppHandle<R>,
    folder_path: &str,
    meeting_id: Option<&str>,
    status: &str,
    trigger: Option<&str>,
) {
    let _ = app.emit(
        crate::events::BATCH_TRANSCRIPTION_STATUS,
        serde_json::json!({
            "meetingId": meeting_id,
            "folderPath": folder_path,
            "status": status,
            "trigger": trigger,
        }),
    );
}

async fn emit_batch_job<R: Runtime>(
    app: &AppHandle<R>,
    trigger: &str,
    status: TelemetryStatus,
    attempts: i64,
    metrics: Option<&super::transcriber::BatchMetrics>,
    outcome: &str,
) {
    let payload = match metrics {
        Some(m) => serde_json::json!({
            "trigger": trigger,
            "attempts": attempts,
            "outcome": outcome,
            "audio_secs": m.audio_secs,
            "voiced_secs": m.voiced_secs,
            "wall_ms": m.wall_ms,
            "rtf": m.rtf,
            "words": m.words,
            "segments": m.segments,
        }),
        None => serde_json::json!({ "trigger": trigger, "attempts": attempts, "outcome": outcome }),
    };
    crate::logging::telemetry::emit::emit_event(
        app,
        crate::logging::telemetry::context::process_session_id(),
        crate::logging::telemetry::catalog::STT_BATCH_JOB,
        payload,
        Some(status),
        None,
        None,
    )
    .await;
}

/// `stt.batch_deferred` con latch: la MISMA razón consecutiva no re-emite
/// (un episodio de presión de horas sería una tormenta de filas cada 5 min).
async fn emit_deferred_latched<R: Runtime>(
    app: &AppHandle<R>,
    reason: &'static str,
    level: PressureLevel,
) {
    let should_emit = match DEFER_LATCH.lock() {
        Ok(mut latch) => {
            if *latch == Some(reason) {
                false
            } else {
                *latch = Some(reason);
                true
            }
        }
        Err(_) => false,
    };
    if !should_emit {
        return;
    }
    info!("[batch-planner] job diferido: {} (presión {})", reason, level.as_str());
    crate::logging::telemetry::emit::emit_event(
        app,
        crate::logging::telemetry::context::process_session_id(),
        crate::logging::telemetry::catalog::STT_BATCH_DEFERRED,
        serde_json::json!({ "reason": reason, "level": level.as_str() }),
        Some(TelemetryStatus::Ok),
        None,
        None,
    )
    .await;
}

fn clear_defer_latch() {
    if let Ok(mut latch) = DEFER_LATCH.lock() {
        *latch = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn libre() -> GateInputs {
        GateInputs {
            pressure: PressureLevel::Normal,
            sys_avail_mb: Some(4000),
            cpu_pct: Some(20.0),
            model_loaded: false,
            recording_active: false,
            recording_uses_stt: true,
            drain: false,
        }
    }

    #[test]
    fn gate_tabla() {
        use GateDecision::*;
        let casos: [(&str, GateInputs, GateDecision); 14] = [
            ("máquina libre", libre(), Go),
            (
                "presión Elevated difiere",
                GateInputs { pressure: PressureLevel::Elevated, ..libre() },
                Defer("pressure"),
            ),
            (
                "presión Critical difiere",
                GateInputs { pressure: PressureLevel::Critical, ..libre() },
                Defer("pressure"),
            ),
            (
                "headroom insuficiente sin modelo (1.7 GB < 1800)",
                GateInputs { sys_avail_mb: Some(1700), ..libre() },
                Defer("headroom"),
            ),
            (
                "1.7 GB alcanza con el modelo YA residente",
                GateInputs { sys_avail_mb: Some(1700), model_loaded: true, ..libre() },
                Go,
            ),
            (
                "ni 300 MB con modelo residente",
                GateInputs { sys_avail_mb: Some(300), model_loaded: true, ..libre() },
                Defer("headroom"),
            ),
            ("CPU 90 % difiere", GateInputs { cpu_pct: Some(90.0), ..libre() }, Defer("cpu")),
            (
                "sin datos del sampler: fail-open",
                GateInputs { sys_avail_mb: None, cpu_pct: None, ..libre() },
                Go,
            ),
            (
                "grabación streaming activa SIEMPRE difiere",
                GateInputs { recording_active: true, recording_uses_stt: true, ..libre() },
                Defer("streaming_active"),
            ),
            (
                "grabación en modo lote no bloquea",
                GateInputs { recording_active: true, recording_uses_stt: false, ..libre() },
                Go,
            ),
            (
                "drain ignora headroom y CPU",
                GateInputs {
                    drain: true,
                    sys_avail_mb: Some(500),
                    cpu_pct: Some(95.0),
                    ..libre()
                },
                Go,
            ),
            (
                "drain ignora Elevated",
                GateInputs { drain: true, pressure: PressureLevel::Elevated, ..libre() },
                Go,
            ),
            (
                "drain NO ignora Critical",
                GateInputs { drain: true, pressure: PressureLevel::Critical, ..libre() },
                Defer("pressure"),
            ),
            (
                "drain con streaming activo difiere igual",
                GateInputs {
                    drain: true,
                    recording_active: true,
                    recording_uses_stt: true,
                    ..libre()
                },
                Defer("streaming_active"),
            ),
        ];
        for (nombre, inputs, esperado) in casos {
            assert_eq!(gate(&inputs), esperado, "{}", nombre);
        }
    }

    #[test]
    fn headroom_por_estado_del_modelo() {
        assert_eq!(required_headroom_mb(false), BATCH_HEADROOM_MB);
        assert_eq!(required_headroom_mb(true), BATCH_HEADROOM_WARM_MB);
        assert!(BATCH_HEADROOM_MB > BATCH_HEADROOM_WARM_MB);
    }
}
