//! Servicio de grabación programada por jornada.
//!
//! Replica el patrón estructural del Meeting Detector (`meeting_detector/detector.rs`):
//! un struct con estado compartido `Arc<RwLock<_>>` + un canal MPSC de comandos + un loop
//! de fondo con `tokio::select!`. La diferencia clave (arquitectura híbrida): este servicio
//! **arranca/detiene la grabación directamente en Rust** —igual que el tray (fix UX-007)—
//! en vez de delegar al frontend, para funcionar con la ventana minimizada. Los eventos
//! hacia el frontend son best-effort, solo para sincronizar la UI.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use anyhow::Result;
use chrono::{Duration, Local, NaiveDateTime};
use log::{error, info, warn};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::sync::{mpsc, RwLock};
use tokio::time::{interval, Duration as TokioDuration};

use crate::events;

use super::schedule;
use super::settings::{load_settings, save_settings, ScheduledRecordingSettings};

/// Fase del scheduler. Ortogonal a la fase de grabación (`recording_phase`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SchedulerPhase {
    Disabled,
    Idle,
    Armed,
    Recording,
    Grace,
    Stopping,
}

/// Razón por la que una ventana arranca pero se omite.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SkipReason {
    ManualInProgress,
    TranscriptionNotReady,
    RearmingNextHour,
}

impl SkipReason {
    fn as_str(self) -> &'static str {
        match self {
            SkipReason::ManualInProgress => "manual_in_progress",
            SkipReason::TranscriptionNotReady => "transcription_not_ready",
            SkipReason::RearmingNextHour => "rearming_next_hour",
        }
    }

    fn message(self) -> &'static str {
        match self {
            SkipReason::ManualInProgress => {
                "Hay una grabación manual en curso; se respeta y no se inicia la jornada."
            }
            SkipReason::TranscriptionNotReady => {
                "El motor de transcripción no está listo; se reintentará automáticamente."
            }
            SkipReason::RearmingNextHour => {
                "Grabación de jornada detenida; se reanudará a la siguiente hora en punto."
            }
        }
    }
}

/// Comandos hacia el loop de fondo.
#[derive(Debug)]
pub enum SchedulerCommand {
    Stop,
    UpdateSettings(ScheduledRecordingSettings),
    CheckNow,
}

/// Estado que comparten el servicio y su loop de fondo.
#[derive(Clone)]
struct SchedulerShared {
    settings: Arc<RwLock<ScheduledRecordingSettings>>,
    is_running: Arc<RwLock<bool>>,
    phase: Arc<RwLock<SchedulerPhase>>,
    /// `true` si la grabación ACTIVA fue iniciada por este scheduler (ownership, §9).
    owned: Arc<AtomicBool>,
    /// Instante en que arrancó la grabación que poseemos (para calcular el cierre por hora fija
    /// de forma robusta a turnos noche). `None` cuando no poseemos ninguna grabación.
    owned_since: Arc<RwLock<Option<NaiveDateTime>>>,
    /// Instante hasta el cual NO se debe (re)arrancar una grabación programada: re-arme tras un
    /// paro manual (siguiente hora en punto) o supresión tras el cierre por hora fija (día sig.).
    rearm_at: Arc<RwLock<Option<NaiveDateTime>>>,
    /// Límite del periodo de gracia del cierre por hora fija (None salvo en fase Grace).
    grace_deadline: Arc<RwLock<Option<NaiveDateTime>>>,
}

impl SchedulerShared {
    fn new() -> Self {
        Self {
            settings: Arc::new(RwLock::new(ScheduledRecordingSettings::default())),
            is_running: Arc::new(RwLock::new(false)),
            phase: Arc::new(RwLock::new(SchedulerPhase::Disabled)),
            owned: Arc::new(AtomicBool::new(false)),
            owned_since: Arc::new(RwLock::new(None)),
            rearm_at: Arc::new(RwLock::new(None)),
            grace_deadline: Arc::new(RwLock::new(None)),
        }
    }
}

/// Estado expuesto al frontend (`get_scheduled_recording_status`).
#[derive(Debug, Clone, Serialize)]
pub struct ScheduledStatus {
    pub phase: SchedulerPhase,
    pub running: bool,
    pub enabled: bool,
    pub in_window: bool,
    pub next_fire_at: Option<String>,
}

/// Servicio de grabación programada.
pub struct ScheduledRecordingService {
    shared: SchedulerShared,
    command_tx: Option<mpsc::Sender<SchedulerCommand>>,
}

impl ScheduledRecordingService {
    pub fn new() -> Self {
        Self {
            shared: SchedulerShared::new(),
            command_tx: None,
        }
    }

    /// Carga settings persistidos en el estado compartido.
    pub async fn initialize<R: Runtime>(&mut self, app_handle: &AppHandle<R>) -> Result<()> {
        let settings = load_settings(app_handle).await.unwrap_or_default();
        *self.shared.settings.write().await = settings;
        info!("Scheduled recording service initialized");
        Ok(())
    }

    /// Arranca el loop de fondo (idempotente: no-op si ya corre).
    pub async fn start<R: Runtime + 'static>(&mut self, app_handle: AppHandle<R>) -> Result<()> {
        if *self.shared.is_running.read().await {
            return Ok(());
        }

        let (tx, rx) = mpsc::channel::<SchedulerCommand>(32);
        self.command_tx = Some(tx);
        *self.shared.is_running.write().await = true;

        let shared = self.shared.clone();
        tokio::spawn(async move {
            run_scheduler_loop(app_handle, shared, rx).await;
        });

        info!("Scheduled recording loop spawned");
        Ok(())
    }

    /// Detiene el loop de fondo. No detiene una grabación en curso (eso lo decide el loop).
    pub async fn stop(&mut self) {
        *self.shared.is_running.write().await = false;
        if let Some(tx) = &self.command_tx {
            let _ = tx.send(SchedulerCommand::Stop).await;
        }
        self.command_tx = None;
        *self.shared.phase.write().await = SchedulerPhase::Disabled;
        info!("Scheduled recording loop stopped");
    }

    pub async fn get_settings(&self) -> ScheduledRecordingSettings {
        self.shared.settings.read().await.clone()
    }

    /// Persiste settings, actualiza el estado compartido y notifica al loop.
    pub async fn update_settings<R: Runtime>(
        &self,
        app_handle: &AppHandle<R>,
        settings: ScheduledRecordingSettings,
    ) -> Result<(), String> {
        save_settings(app_handle, &settings)
            .await
            .map_err(|e| format!("Failed to save scheduled recording settings: {}", e))?;
        *self.shared.settings.write().await = settings.clone();
        if let Some(tx) = &self.command_tx {
            let _ = tx.send(SchedulerCommand::UpdateSettings(settings)).await;
        }
        Ok(())
    }

    pub async fn is_running(&self) -> bool {
        *self.shared.is_running.read().await
    }

    pub async fn get_status(&self) -> ScheduledStatus {
        let settings = self.shared.settings.read().await.clone();
        let phase = *self.shared.phase.read().await;
        let running = *self.shared.is_running.read().await;
        let now = Local::now().naive_local();
        let next_fire_at =
            schedule::next_fire_at(now, &settings).map(|d| d.format("%Y-%m-%dT%H:%M:%S").to_string());
        let in_window = schedule::active_window_at(now, &settings).is_some();
        ScheduledStatus {
            phase,
            running,
            enabled: settings.enabled,
            in_window,
            next_fire_at,
        }
    }

    pub async fn check_now(&self) -> Result<()> {
        if let Some(tx) = &self.command_tx {
            tx.send(SchedulerCommand::CheckNow)
                .await
                .map_err(|e| anyhow::anyhow!("Failed to send check command: {}", e))?;
        }
        Ok(())
    }
}

impl Default for ScheduledRecordingService {
    fn default() -> Self {
        Self::new()
    }
}

/// Loop principal del scheduler. Evalúa el reloj contra las ventanas en cada tick.
async fn run_scheduler_loop<R: Runtime>(
    app: AppHandle<R>,
    shared: SchedulerShared,
    mut command_rx: mpsc::Receiver<SchedulerCommand>,
) {
    let mut tick = {
        let s = shared.settings.read().await;
        interval(TokioDuration::from_secs(s.check_interval_seconds.max(5) as u64))
    };

    // Monitor de procesos para la señal de actividad del periodo de gracia (D4).
    let mut process_monitor = crate::meeting_detector::process_monitor::ProcessMonitor::new();

    // Cambios locales solo para detectar transiciones (evita re-emitir el mismo evento).
    let mut prev_phase: Option<SchedulerPhase> = None;
    let mut prev_skip: Option<SkipReason> = None;

    info!("Scheduled recording loop started");

    loop {
        tokio::select! {
            _ = tick.tick() => {
                if !*shared.is_running.read().await {
                    break;
                }

                let settings = shared.settings.read().await.clone();
                // Wall-clock absoluto: robusto ante sleep/suspend y DST (§11).
                let now = Local::now().naive_local();

                let (new_phase, skip) =
                    evaluate_tick(&app, &shared, &settings, now, &mut process_monitor).await;

                *shared.phase.write().await = new_phase;

                if prev_phase != Some(new_phase) {
                    emit_status(&app, new_phase, &settings, now);
                    prev_phase = Some(new_phase);
                }
                if prev_skip != skip {
                    if let Some(reason) = skip {
                        emit_skipped(&app, reason);
                    }
                    prev_skip = skip;
                }
            }

            Some(cmd) = command_rx.recv() => {
                match cmd {
                    SchedulerCommand::Stop => {
                        info!("Scheduled recording loop received stop");
                        break;
                    }
                    SchedulerCommand::UpdateSettings(new_settings) => {
                        let old = shared.settings.read().await.check_interval_seconds;
                        if new_settings.check_interval_seconds != old {
                            tick = interval(TokioDuration::from_secs(
                                new_settings.check_interval_seconds.max(5) as u64,
                            ));
                        }
                        *shared.settings.write().await = new_settings;
                        info!("Scheduled recording settings updated");
                    }
                    SchedulerCommand::CheckNow => {
                        tick.reset();
                    }
                }
            }
        }
    }

    info!("Scheduled recording loop ended");
}

/// Evalúa una iteración y ejecuta los efectos (arranque/paro/notificación).
/// Devuelve la nueva fase + una eventual razón de omisión (para los eventos del loop).
async fn evaluate_tick<R: Runtime>(
    app: &AppHandle<R>,
    shared: &SchedulerShared,
    settings: &ScheduledRecordingSettings,
    now: NaiveDateTime,
    process_monitor: &mut crate::meeting_detector::process_monitor::ProcessMonitor,
) -> (SchedulerPhase, Option<SkipReason>) {
    if !settings.enabled {
        shared.owned.store(false, Ordering::SeqCst);
        *shared.owned_since.write().await = None;
        return (SchedulerPhase::Disabled, None);
    }

    let active = schedule::active_window_at(now, settings).cloned();
    let is_rec = crate::audio::recording_commands::is_recording_active_fn();
    let owned = shared.owned.load(Ordering::SeqCst);

    // --- Cierre por hora fija (opt-in, Incremento 3). Aplica a NUESTRA grabación esté o no en
    // ventana, porque depende de un instante ABSOLUTO (no del borde de la ventana). Reutiliza el
    // periodo de gracia: si a la hora de cierre sigue una reunión abierta, espera hasta el margen.
    if owned && is_rec && settings.auto_close_enabled {
        let owned_since = *shared.owned_since.read().await;
        if let Some(close_at) =
            owned_since.and_then(|since| schedule::auto_close_at(since, &settings.auto_close_time))
        {
            if now >= close_at {
                let deadline = {
                    let mut guard = shared.grace_deadline.write().await;
                    if guard.is_none() {
                        *guard =
                            Some(close_at + Duration::minutes(settings.grace_period_minutes as i64));
                    }
                    guard.expect("grace_deadline just set")
                };
                let still_active =
                    settings.grace_period_minutes > 0 && process_monitor.is_meeting_active();

                if now >= deadline || !still_active {
                    info!(
                        "[scheduled] cierre por hora fija {} (past_deadline={}, still_active={})",
                        settings.auto_close_time,
                        now >= deadline,
                        still_active
                    );
                    stop_scheduled(app).await;
                    shared.owned.store(false, Ordering::SeqCst);
                    *shared.owned_since.write().await = None;
                    *shared.grace_deadline.write().await = None;
                    // Suprimir el re-arranque por el resto del día (no re-grabar tras el cierre).
                    *shared.rearm_at.write().await = Some(start_of_next_day(now));
                    return (SchedulerPhase::Idle, None);
                }
                return (SchedulerPhase::Grace, None);
            }
        }
    }

    // --- Rotación por hora (Incremento 4, opt-in). Como el cierre por hora fija, actúa sobre
    // NUESTRA grabación por un instante ABSOLUTO, pero SOLO dentro de la ventana: en overtime
    // el cierre lo maneja `auto_close`. Deriva la frontera de `owned_since`, así que no añade
    // estado nuevo y es robusto a sleep/suspend (un salto de horas dispara UNA sola rotación).
    if owned && is_rec && settings.hourly_rotation_enabled {
        if let Some(since) = *shared.owned_since.read().await {
            if schedule::should_rotate(since, now, active.is_some(), settings.hourly_rotation_enabled) {
                info!(
                    "[scheduled] rotación por hora: cerrando segmento (arranque {}) @ {}",
                    since, now
                );
                let phase = rotate_scheduled(app, shared, settings, since, now).await;
                return (phase, None);
            }
        }
    }

    match (owned, active.as_ref()) {
        // Dentro de ventana y NO somos dueños de una grabación → intentar arrancar.
        (false, Some(_)) => {
            // ¿Re-arme pendiente (paro manual reciente o supresión por cierre)? No arrancar aún.
            {
                let rearm = *shared.rearm_at.read().await;
                if let Some(until) = rearm {
                    if now < until {
                        return (SchedulerPhase::Armed, Some(SkipReason::RearmingNextHour));
                    }
                    *shared.rearm_at.write().await = None;
                }
            }

            // Respetar cualquier grabación que no iniciamos nosotros (manual / tray) (D3).
            if is_rec {
                return (SchedulerPhase::Armed, Some(SkipReason::ManualInProgress));
            }

            // Arranque autónomo (ruta Rust-directa, igual que el tray).
            let meeting_name = render_segment_name(settings, now);
            match crate::audio::recording_commands::start_recording_with_meeting_name(
                app.clone(),
                Some(meeting_name),
            )
            .await
            {
                Ok(()) => {
                    shared.owned.store(true, Ordering::SeqCst);
                    *shared.owned_since.write().await = Some(now);
                    *shared.grace_deadline.write().await = None;
                    if settings.notify_on_start {
                        notify_started(app).await;
                    }
                    // La jornada arranca headless (ruta nativa), así que la UI no
                    // se entera. Al auto-arrancar en background mostramos el
                    // coach-float para que el usuario VEA que está grabando —
                    // respetando su preferencia de visibilidad (si lo desactivó
                    // a propósito en Settings, no se lo imponemos). Cerrar con la
                    // X no persiste `false`, así que el caso normal reaparece.
                    if crate::coach::commands::coach_float_get_visibility_pref(app.clone()).await {
                        if let Err(e) =
                            crate::coach::commands::open_floating_coach(app.clone(), None).await
                        {
                            warn!("[scheduled] no se pudo abrir el coach-float: {}", e);
                        }
                    }
                    info!("[scheduled] grabación de jornada iniciada (ruta nativa)");
                    (SchedulerPhase::Recording, None)
                }
                Err(e) if e.contains("already in progress") => {
                    // Carrera: alguien arrancó justo antes. Tratar como manual.
                    (SchedulerPhase::Armed, Some(SkipReason::ManualInProgress))
                }
                Err(e) => {
                    warn!("[scheduled] no se pudo iniciar la grabación: {}", e);
                    (SchedulerPhase::Armed, Some(SkipReason::TranscriptionNotReady))
                }
            }
        }

        // Fuera de toda ventana y sin grabación nuestra → reposo.
        (false, None) => {
            // Limpiar el re-arme SOLO si ya venció (no borrar la supresión del cierre por hora fija).
            {
                let rearm = *shared.rearm_at.read().await;
                if let Some(until) = rearm {
                    if now >= until {
                        *shared.rearm_at.write().await = None;
                    }
                }
            }
            *shared.grace_deadline.write().await = None;
            (SchedulerPhase::Idle, None)
        }

        // Somos dueños y seguimos dentro de la ventana.
        (true, Some(_)) => {
            if !is_rec {
                // El usuario detuvo NUESTRA grabación dentro del horario → re-armar a la sig. hora.
                *shared.rearm_at.write().await = Some(schedule::next_hour_boundary(now));
                shared.owned.store(false, Ordering::SeqCst);
                *shared.owned_since.write().await = None;
                (SchedulerPhase::Armed, Some(SkipReason::RearmingNextHour))
            } else {
                (SchedulerPhase::Recording, None)
            }
        }

        // Somos dueños pero la ventana terminó. Incremento 3: ya NO se auto-detiene; la grabación
        // sigue hasta el paro manual (o hasta el cierre por hora fija, evaluado arriba).
        (true, None) => {
            if !is_rec {
                // El usuario la detuvo (fuera de ventana) → soltar ownership e ir a reposo.
                shared.owned.store(false, Ordering::SeqCst);
                *shared.owned_since.write().await = None;
                (SchedulerPhase::Idle, None)
            } else {
                (SchedulerPhase::Recording, None)
            }
        }
    }
}

/// Medianoche del día siguiente a `now` (suprime el re-arranque tras el cierre por hora fija).
fn start_of_next_day(now: NaiveDateTime) -> NaiveDateTime {
    (now.date() + Duration::days(1))
        .and_hms_opt(0, 0, 0)
        .unwrap_or(now)
}

/// Renderiza el nombre de reunión a partir de la plantilla.
fn render_meeting_name(template: &str, now: NaiveDateTime) -> String {
    template
        .replace("{date}", &now.format("%Y-%m-%d").to_string())
        .replace("{time}", &now.format("%H:%M").to_string())
}

/// Nombre del segmento de jornada. Igual que `render_meeting_name`, pero cuando la rotación por
/// hora está activa y la plantilla no incluye `{time}`, añade la hora en punto (" HH:00") para
/// que los segmentos horarios se distingan en la lista de conversaciones. Con rotación apagada
/// el nombre queda idéntico al histórico (sin cambios para usuarios que no rotan).
fn render_segment_name(settings: &ScheduledRecordingSettings, ts: NaiveDateTime) -> String {
    let base = render_meeting_name(&settings.meeting_name_template, ts);
    if settings.hourly_rotation_enabled && !settings.meeting_name_template.contains("{time}") {
        format!("{} {}", base, ts.format("%H:00"))
    } else {
        base
    }
}

/// Detiene la grabación de jornada (ruta nativa). Devuelve el resultado del `stop_recording`.
/// El `save_path` es ignorado por `stop_recording` (`_args`), pero se construye por compatibilidad.
async fn stop_current_recording<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let save_path = app
        .path()
        .app_data_dir()
        .ok()
        .map(|dir| {
            dir.join(format!(
                "scheduled-{}.wav",
                Local::now().format("%Y-%m-%dT%H-%M-%S")
            ))
            .to_string_lossy()
            .to_string()
        })
        .unwrap_or_else(|| "scheduled-recording.wav".to_string());

    crate::audio::recording_commands::stop_recording(
        app.clone(),
        crate::audio::recording_commands::RecordingArgs { save_path },
    )
    .await
}

/// Detiene la grabación de jornada y dispara el post-procesado del frontend (como el tray).
/// Usado por el cierre por hora fija / fin de día: emite `recording-stop-complete` para que el
/// frontend guarde local + sync + navegue.
async fn stop_scheduled<R: Runtime>(app: &AppHandle<R>) {
    match stop_current_recording(app).await {
        Ok(()) => {
            // Igual que el tray: el frontend hace el guardado local + sync cloud.
            if let Err(e) = app.emit(events::RECORDING_STOP_COMPLETE, true) {
                warn!("[scheduled] no se pudo emitir recording-stop-complete: {}", e);
            }
        }
        Err(e) => error!("[scheduled] stop_recording falló: {}", e),
    }
}

/// Rota el segmento por hora (Incremento 4): cierra el segmento actual y arranca uno nuevo, SIN
/// navegar ni resetear la UI a "detenido". Secuencial y seguro: `stop_recording` deja la fase en
/// `Idle` antes de retornar, así el `StartGate` del nuevo arranque no colisiona. Devuelve la fase
/// resultante (`Recording` si re-arrancó, `Armed` si el re-arranque falló y hay que reintentar).
async fn rotate_scheduled<R: Runtime>(
    app: &AppHandle<R>,
    shared: &SchedulerShared,
    settings: &ScheduledRecordingSettings,
    owned_since: NaiveDateTime,
    now: NaiveDateTime,
) -> SchedulerPhase {
    // 1. Capturar el folder ANTES del stop: `stop_recording` hace `take()` del manager, así que
    //    después `get_meeting_folder_path()` devolvería None.
    let folder = crate::audio::recording_commands::get_meeting_folder_path()
        .await
        .ok()
        .flatten();
    // Re-render determinista del nombre con el que arrancó el segmento que cerramos.
    let closing_name = render_segment_name(settings, owned_since);

    // 2. Detener el segmento actual (finaliza audio.mp4 + transcripts.json en el folder).
    if let Err(e) = stop_current_recording(app).await {
        error!("[scheduled] rotación: stop_recording falló: {}", e);
        // El segmento parcial queda en disco; seguimos intentando re-arrancar abajo.
    }

    // 3. Guardado LOCAL headless del segmento cerrado (no depende del buffer del frontend).
    let meeting_id = match folder.as_deref() {
        Some(f) => finalize_segment_native(app, f, &closing_name).await,
        None => {
            warn!("[scheduled] rotación: sin folder del segmento; no se guarda a DB");
            None
        }
    };

    // 4. Evento para que el frontend (si está vivo) resetee su buffer y encole la sync del
    //    segmento cerrado, SIN navegar. Best-effort, como el resto del scheduler.
    if let Err(e) = app.emit(
        events::SCHEDULED_SEGMENT_ROTATED,
        serde_json::json!({ "meetingId": meeting_id, "meetingName": closing_name }),
    ) {
        warn!("[scheduled] no se pudo emitir scheduled-segment-rotated: {}", e);
    }

    // 5. Arrancar el nuevo segmento (nombre re-renderizado con la hora actual).
    let new_name = render_segment_name(settings, now);
    match crate::audio::recording_commands::start_recording_with_meeting_name(
        app.clone(),
        Some(new_name),
    )
    .await
    {
        Ok(()) => {
            shared.owned.store(true, Ordering::SeqCst);
            *shared.owned_since.write().await = Some(now);
            *shared.grace_deadline.write().await = None;
            info!("[scheduled] rotación por hora: nuevo segmento iniciado @ {}", now);
            SchedulerPhase::Recording
        }
        Err(e) => {
            // No se pudo re-arrancar (ej. transcripción no lista): soltar ownership. El próximo
            // tick `(false, Some)` reintenta arranque inmediato (sin rearm_at), auto-sanando.
            warn!("[scheduled] rotación: fallo al re-arrancar el segmento: {}", e);
            shared.owned.store(false, Ordering::SeqCst);
            *shared.owned_since.write().await = None;
            SchedulerPhase::Armed
        }
    }
}

/// Guarda a SQLite el segmento recién cerrado leyendo su `transcripts.json` (headless, sin
/// depender del buffer de React ni de la ventana viva). Devuelve el `meeting_id` creado, o `None`
/// si no hay transcripts, no hay usuario logueado, o falla la lectura/parseo. NO encola la sync a
/// la nube: eso lo hace el frontend vía `scheduled-segment-rotated` (best-effort).
async fn finalize_segment_native<R: Runtime>(
    app: &AppHandle<R>,
    folder_path: &str,
    meeting_name: &str,
) -> Option<String> {
    let json_path = std::path::Path::new(folder_path).join("transcripts.json");
    let content = match tokio::fs::read_to_string(&json_path).await {
        Ok(c) => c,
        Err(e) => {
            warn!("[scheduled] no se pudo leer {}: {}", json_path.display(), e);
            return None;
        }
    };

    let parsed: serde_json::Value = serde_json::from_str(&content).ok()?;
    let raw_segments = parsed.get("segments").and_then(|v| v.as_array())?;
    if raw_segments.is_empty() {
        info!("[scheduled] segmento sin transcripts; no se guarda a DB");
        return None;
    }

    // Mapear el shape de transcripts.json (recording_saver::TranscriptSegment, con `display_time`)
    // al shape que espera el repositorio (api::models::TranscriptSegment, con `timestamp`).
    let segments: Vec<crate::api::models::TranscriptSegment> = raw_segments
        .iter()
        .filter_map(|s| {
            Some(crate::api::models::TranscriptSegment {
                id: s.get("id")?.as_str()?.to_string(),
                text: s.get("text").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                timestamp: s
                    .get("display_time")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                audio_start_time: s.get("audio_start_time").and_then(|v| v.as_f64()),
                audio_end_time: s.get("audio_end_time").and_then(|v| v.as_f64()),
                duration: s.get("duration").and_then(|v| v.as_f64()),
                source_type: s
                    .get("source_type")
                    .and_then(|v| v.as_str())
                    .map(|x| x.to_string()),
            })
        })
        .collect();

    if segments.is_empty() {
        warn!("[scheduled] segmento con transcripts inválidos; no se guarda a DB");
        return None;
    }

    // Extraer usuario + pool y SOLTAR el guard de State antes del await largo del guardado
    // (evita mantener `State<AppState>` vivo cruzando el await dentro de la task del scheduler).
    let (user_id, pool) = {
        let state = match app.try_state::<crate::state::AppState>() {
            Some(s) => s,
            None => {
                warn!("[scheduled] AppState no inicializado; no se guarda el segmento");
                return None;
            }
        };
        let user_id = state.current_user_id().await?; // sin usuario => no se guarda (privacidad)
        (user_id, state.db_manager.pool().clone()) // SqlitePool es Arc: clonar es barato
    };

    match crate::database::repositories::transcript::TranscriptsRepository::save_transcript(
        &pool,
        meeting_name,
        &segments,
        Some(folder_path.to_string()),
        None,
        &user_id,
        None,
    )
    .await
    {
        Ok(mid) => {
            info!(
                "[scheduled] segmento guardado a DB: {} ({} segmentos)",
                mid,
                segments.len()
            );
            Some(mid)
        }
        Err(e) => {
            error!("[scheduled] fallo al guardar segmento a DB: {}", e);
            None
        }
    }
}

/// Notificación al usuario (best-effort).
async fn notify_started<R: Runtime>(app: &AppHandle<R>) {
    let notif_state = app.state::<crate::NotificationManagerState<R>>();
    if let Err(e) = crate::notifications::commands::show_recording_started_notification(
        app,
        &notif_state,
        Some("Grabación de jornada".to_string()),
    )
    .await
    {
        warn!("[scheduled] notificación falló: {}", e);
    }
}

fn emit_status<R: Runtime>(
    app: &AppHandle<R>,
    phase: SchedulerPhase,
    settings: &ScheduledRecordingSettings,
    now: NaiveDateTime,
) {
    let next = schedule::next_fire_at(now, settings).map(|d| d.format("%Y-%m-%dT%H:%M:%S").to_string());
    let _ = app.emit(
        events::SCHEDULED_RECORDING_STATUS,
        serde_json::json!({
            "phase": phase,
            "next_fire_at": next,
            "in_window": schedule::active_window_at(now, settings).is_some(),
        }),
    );
}

fn emit_skipped<R: Runtime>(app: &AppHandle<R>, reason: SkipReason) {
    let _ = app.emit(
        events::SCHEDULED_RECORDING_SKIPPED,
        serde_json::json!({
            "reason": reason.as_str(),
            "message": reason.message(),
        }),
    );
}
