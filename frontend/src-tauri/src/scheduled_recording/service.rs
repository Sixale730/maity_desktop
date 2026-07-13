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
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::sync::{mpsc, RwLock};
use tokio::time::{interval, Duration as TokioDuration};

use crate::events;

use super::schedule;
use super::settings::{load_settings, save_settings, ScheduledRecordingSettings};

/// Shape idéntico al `TranscriptSegment` que escribe `recording_saver` en `transcripts.json`.
/// Lo mantengo local (en vez de reusar el struct público) para dos motivos: (a) desacoplo el
/// scheduler del layout interno del saver — un cambio allí queda contenido aquí; (b) tengo
/// TODOS los campos (incluye `sequence_id` y `display_time`) para servir a los DOS consumidores
/// downstream sin doble parse: `save_transcript` (mapea a `api::models::TranscriptSegment`) y
/// el payload de sync cloud (usa `sequence_id` como `segment_index`, espejando el frontend).
#[derive(Debug, Deserialize)]
struct RawTranscriptSegment {
    id: String,
    text: String,
    audio_start_time: f64,
    audio_end_time: f64,
    duration: f64,
    display_time: String,
    sequence_id: u64,
    #[serde(default)]
    source_type: Option<String>,
}

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

    // --- Cierre por hora fija (Incremento 3; headless-safe desde el gap #54). Aplica a NUESTRA
    // grabación esté o no en ventana, porque depende de un instante ABSOLUTO (no del borde de la
    // ventana). Reutiliza el periodo de gracia: si a la hora de cierre sigue una reunión abierta,
    // espera hasta el margen. La mutación de estado del scheduler vive DENTRO de
    // `close_scheduled` (todos sus paths de salida limpian ownership/grace y setean rearm).
    if owned && is_rec && settings.auto_close_enabled {
        if let Some(since) = *shared.owned_since.read().await {
            if let Some(close_at) = schedule::auto_close_at(since, &settings.auto_close_time) {
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
                        let phase = close_scheduled(app, shared, settings, since, now).await;
                        return (phase, None);
                    }
                    return (SchedulerPhase::Grace, None);
                }
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

/// Detiene la grabación de jornada (ruta nativa). Devuelve `true` si ESTE caller adquirió
/// el StopGate, `false` si otro actor ya estaba deteniendo/detuvo (stop idempotente) — los
/// flujos de rotación/cierre usan ese bool para NO duplicar el guardado ni pisar la
/// intención del usuario. El `save_path` es ignorado por `stop_recording_reporting`
/// (`_args`), pero se construye por compatibilidad.
async fn stop_current_recording<R: Runtime>(app: &AppHandle<R>) -> Result<bool, String> {
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

    crate::audio::recording_commands::stop_recording_reporting(
        app.clone(),
        crate::audio::recording_commands::RecordingArgs { save_path },
    )
    .await
}

/// Cierre por hora fija / fin de día (gap #54): una rotación SIN re-arranque. Guarda el
/// último segmento de la jornada headless (local + outbox cloud vía
/// `finalize_segment_native`) sin depender del webview: el buffer de React no es durable
/// para una sesión de 8h (un crash del webview + recarga lo vacía aunque la ventana esté
/// visible) y con la ventana al tray el guardado legacy dependía de un webview
/// oculto/throttled.
///
/// Exclusión mutua ESTRUCTURAL con el guardado del frontend: emite
/// `SCHEDULED_JORNADA_CLOSED` (limpiar buffer, sin navegar) XOR `RECORDING_STOP_COMPLETE`
/// (fallback best-effort SOLO cuando el finalize headless no persistió NADA, para que un
/// webview vivo intente el guardado legacy). Nunca ambos: la ruta del frontend genera su
/// propio meeting_id (`early_meeting_id`/UUID), así que un doble guardado duplicaría la
/// reunión — la razón por la que el viejo `stop_scheduled` no podía simplemente sumarle
/// un guardado nativo. Deja el scheduler en reposo con supresión del re-arranque por el
/// resto del día.
async fn close_scheduled<R: Runtime>(
    app: &AppHandle<R>,
    shared: &SchedulerShared,
    settings: &ScheduledRecordingSettings,
    owned_since: NaiveDateTime,
    now: NaiveDateTime,
) -> SchedulerPhase {
    // 1. Capturar el folder ANTES del stop (`stop_recording` hace `take()` del manager) y
    //    re-render determinista del nombre con el que arrancó el segmento que cerramos.
    let folder = crate::audio::recording_commands::get_meeting_folder_path()
        .await
        .ok()
        .flatten();
    let closing_name = render_segment_name(settings, owned_since);

    // 2. Detener el segmento. `Ok(false)` = otro actor (usuario) ganó el StopGate en la
    //    carrera: su path hace el post-procesado completo (guardado + navegación), así que
    //    aquí NO se finaliza (duplicaría la reunión) ni se notifica — solo soltar ownership
    //    y suprimir el re-arranque del día (el cierre ocurrió de facto).
    match stop_current_recording(app).await {
        Ok(false) => {
            info!("[scheduled] cierre: otro actor detuvo primero; su path hace el guardado");
            shared.owned.store(false, Ordering::SeqCst);
            *shared.owned_since.write().await = None;
            *shared.grace_deadline.write().await = None;
            *shared.rearm_at.write().await = Some(start_of_next_day(now));
            return SchedulerPhase::Idle;
        }
        Ok(true) => {}
        Err(e) => {
            // Best-effort: el Drop del StopGate garantiza fase Idle y transcripts.json
            // puede existir en disco; intentar el finalize de todos modos.
            error!("[scheduled] cierre: stop_recording falló: {}", e);
        }
    }

    // 3. Guardado LOCAL headless + outbox cloud (mismo camino que la rotación).
    let meeting_id = match folder.as_deref() {
        Some(f) => finalize_segment_native(app, f, &closing_name).await,
        None => {
            warn!("[scheduled] cierre: sin folder del segmento; no se guarda a DB");
            None
        }
    };

    // 4. Emisión EXCLUYENTE (ver doc-comment). Con `Some`, el frontend solo limpia su
    //    buffer (nunca emitir ADEMÁS el fallback: `clearTranscripts` vaciaría el buffer
    //    antes del flush de `handleRecordingStop` y mataría el guardado legacy). Con
    //    `None` (nada persistido), fallback al flujo legacy completo del webview — que
    //    además notifica por su cuenta, por eso aquí no se duplica el aviso.
    match &meeting_id {
        Some(mid) => {
            if let Err(e) = app.emit(
                events::SCHEDULED_JORNADA_CLOSED,
                serde_json::json!({ "meetingId": mid, "meetingName": closing_name }),
            ) {
                warn!("[scheduled] no se pudo emitir scheduled-jornada-closed: {}", e);
            }
            notify_jornada_saved(app, &closing_name).await;
        }
        None => {
            error!(
                "[scheduled] cierre sin persistencia headless; fallback a webview (si está vivo)"
            );
            if let Err(e) = app.emit(events::RECORDING_STOP_COMPLETE, true) {
                warn!("[scheduled] no se pudo emitir recording-stop-complete: {}", e);
            }
        }
    }

    // 5. Reposo + supresión del re-arranque por el resto del día.
    shared.owned.store(false, Ordering::SeqCst);
    *shared.owned_since.write().await = None;
    *shared.grace_deadline.write().await = None;
    *shared.rearm_at.write().await = Some(start_of_next_day(now));
    SchedulerPhase::Idle
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
    match stop_current_recording(app).await {
        Ok(true) => {}
        Ok(false) => {
            // Race: otro actor (usuario) ganó el StopGate justo en la frontera de hora. Su
            // path hace el post-procesado completo (guardado + navegación); la intención
            // del usuario gana: NO finalize (leería un transcripts.json que el otro path
            // aún está drenando y duplicaría la reunión), NO re-arranque. Mismo estado que
            // el paro manual dentro de ventana: re-armar a la siguiente hora.
            info!("[scheduled] rotación: otro actor detuvo primero; su path guarda");
            shared.owned.store(false, Ordering::SeqCst);
            *shared.owned_since.write().await = None;
            *shared.grace_deadline.write().await = None;
            *shared.rearm_at.write().await = Some(schedule::next_hour_boundary(now));
            return SchedulerPhase::Armed;
        }
        Err(e) => {
            error!("[scheduled] rotación: stop_recording falló: {}", e);
            // El segmento parcial queda en disco; seguimos intentando re-arrancar abajo.
        }
    }

    // 3. Guardado LOCAL headless del segmento cerrado (no depende del buffer del frontend).
    let meeting_id = match folder.as_deref() {
        Some(f) => finalize_segment_native(app, f, &closing_name).await,
        None => {
            warn!("[scheduled] rotación: sin folder del segmento; no se guarda a DB");
            None
        }
    };

    // 4. Evento para que el frontend (si está vivo) resetee su buffer, SIN navegar. La sync
    //    cloud ya la encoló `finalize_segment_native` (headless): este evento SOLO limpia el
    //    buffer de React para que el nuevo segmento arranque limpio y el stop manual final NO
    //    reguarde los segmentos ya rotados como una reunión duplicada.
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

/// Guarda a SQLite el segmento recién cerrado leyendo su `transcripts.json` Y encola los 3 jobs
/// de sync cloud (`save_conversation` → `save_transcript_segments` → `finalize_conversation`)
/// contra el mismo `meeting_id`. Todo headless: sin depender del buffer de React ni de la ventana
/// viva. Devuelve el `meeting_id` creado, o `None` si no hay transcripts, no hay usuario logueado,
/// o falla la lectura/parseo. La brecha original —"el frontend hace la sync via
/// `scheduled-segment-rotated`"— nunca se implementó y era la causa de que los segmentos
/// intermedios rotados quedaran local-only.
///
/// Patrón: Transactional Outbox (Chris Richardson). Fuente de verdad = `transcripts.json` en disco;
/// tanto el guardado local como el encolado a la cola de sync se derivan de la misma lectura, así
/// no divergen. El worker de sync (fuera de este archivo) drena `sync_queue` y publica a Supabase.
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

    // Deserializar UNA vez al shape completo del saver. Los dos consumidores downstream
    // (save_transcript local + payload de sync cloud) leen del mismo Vec — un solo parse.
    let total_raw = raw_segments.len();
    let raws: Vec<RawTranscriptSegment> = raw_segments
        .iter()
        .filter_map(|s| serde_json::from_value(s.clone()).ok())
        .collect();

    // Observabilidad: `RawTranscriptSegment` tiene campos requeridos (id, text, timestamps,
    // sequence_id...). Si `recording_saver` cambiara su shape y dejara de escribir alguno,
    // `from_value` fallaría y `filter_map(...).ok()` descartaría el segmento en SILENCIO. Contar
    // y loggear los descartes convierte esa pérdida silenciosa en una señal diagnosticable
    // (análogo a un Dead Letter Channel: no se tira el mensaje corrupto sin dejar rastro).
    let dropped = total_raw - raws.len();
    if dropped > 0 {
        warn!(
            "[scheduled] {}/{} segmentos descartados por deserialización inválida \
             (posible drift de shape con recording_saver::TranscriptSegment)",
            dropped, total_raw
        );
    }

    if raws.is_empty() {
        warn!("[scheduled] segmento con transcripts inválidos; no se guarda a DB");
        return None;
    }

    // Vista compatible con el repositorio (api::models::TranscriptSegment usa `timestamp`
    // en vez de `display_time`, y todos los campos numéricos son Option<f64>).
    let segments: Vec<crate::api::models::TranscriptSegment> = raws
        .iter()
        .map(|r| crate::api::models::TranscriptSegment {
            id: r.id.clone(),
            text: r.text.clone(),
            timestamp: r.display_time.clone(),
            audio_start_time: Some(r.audio_start_time),
            audio_end_time: Some(r.audio_end_time),
            duration: Some(r.duration),
            source_type: r.source_type.clone(),
        })
        .collect();

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

    // Modo de grabación (Ponente vs Conversación). Lo mantiene un atomic global que setea el
    // arranque de grabación. El scheduler nunca lo pone en "presentation" (no hay UI para ello),
    // así que en la práctica siempre es "conversation" — pero leemos el flag para respetar el
    // toggle en vivo del coach si el usuario lo activó durante la jornada.
    let recording_mode = if crate::coach::live_feedback::is_presentation_mode() {
        "presentation"
    } else {
        "conversation"
    };

    match crate::database::repositories::transcript::TranscriptsRepository::save_transcript(
        &pool,
        meeting_name,
        &segments,
        Some(folder_path.to_string()),
        None,
        &user_id,
        Some(recording_mode),
    )
    .await
    {
        Ok(mid) => {
            info!(
                "[scheduled] segmento guardado a DB: {} ({} segmentos)",
                mid,
                segments.len()
            );

            // Outbox: encolar los 3 jobs de sync cloud contra el mismo meeting_id, ANTES de
            // reportar éxito. Un fallo aquí NO invalida el guardado local (ya committed), pero sí
            // se loggea al nivel error para diagnosticar rotaciones que no lleguen a la nube.
            if let Err(e) =
                enqueue_cloud_sync_jobs(&pool, &mid, meeting_name, &raws, &user_id, recording_mode)
                    .await
            {
                error!(
                    "[scheduled] fallo al encolar sync cloud para {} (local OK, nube pendiente): {}",
                    mid, e
                );
            }
            Some(mid)
        }
        Err(e) => {
            error!("[scheduled] fallo al guardar segmento a DB: {}", e);
            None
        }
    }
}

/// Encola los 3 jobs de sync cloud (save_conversation → save_transcript_segments →
/// finalize_conversation) para el segmento rotado. Espeja 1:1 el shape que arma el frontend en
/// `useRecordingStop.ts:enqueueCloudSync` — si el contrato del Cloudflare Worker / Vercel API
/// diverge (nombres de campo, tipos), la fila cae corrupta en Supabase, así que cualquier cambio
/// en el frontend debe replicarse aquí (y viceversa).
async fn enqueue_cloud_sync_jobs(
    pool: &SqlitePool,
    meeting_id: &str,
    meeting_name: &str,
    raws: &[RawTranscriptSegment],
    user_id: &str,
    recording_mode: &str,
) -> Result<(), sqlx::Error> {
    // Orden cronológico: los chunks dual-channel llegan al buffer fuera de orden (mic + system),
    // así que ordenar por `audio_start_time` garantiza que transcript_text lea natural y que
    // `duration_seconds` se compute contra el último sample real. Mismo criterio que el frontend.
    let mut sorted: Vec<&RawTranscriptSegment> = raws.iter().collect();
    sorted.sort_by(|a, b| {
        a.audio_start_time
            .partial_cmp(&b.audio_start_time)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    // Idempotency key para la reunión: cross-retry-stable UUID persistido en meetings. Si un job
    // reintenta tras un fallo mid-sync, Supabase colapsa el duplicado por UNIQUE(idempotency_key).
    let idempotency_key =
        crate::database::repositories::meeting::MeetingsRepository::get_or_create_idempotency_key(
            pool, meeting_id,
        )
        .await?;

    // Idioma de transcripción (Deepgram default `es-419`); fallback `"es"` conservador si la
    // tabla `transcript_settings` está vacía (primer arranque antes de guardar config).
    let language = crate::database::repositories::setting::SettingsRepository::get_transcript_config(pool)
        .await
        .ok()
        .flatten()
        .and_then(|s| s.language)
        .unwrap_or_else(|| "es".to_string());

    // transcript_text espeja el join del frontend: `"Usuario: ..."` / `"Interlocutor: ..."` por
    // línea. Es lo que el análisis V4 en la nube consume como cuerpo.
    let transcript_text = sorted
        .iter()
        .map(|t| {
            let speaker = match t.source_type.as_deref() {
                Some("user") => "Usuario",
                _ => "Interlocutor",
            };
            format!("{}: {}", speaker, t.text)
        })
        .collect::<Vec<_>>()
        .join("\n");

    // words_count: `split_whitespace` ignora tokens vacíos y espacios repetidos. Diverge a
    // PROPÓSITO del frontend (`text.split(/\s+/).length`, que cuenta 1 para "" y sobre-cuenta con
    // espacio inicial): la versión de Rust es la correcta y la diferencia es ±1 sólo en segmentos
    // vacíos — inocua para los umbrales del análisis V4. No alineamos el frontend para no tocar el
    // path caliente `enqueueCloudSync`. El golden test de este módulo fija este comportamiento.
    let words_count: i64 = sorted
        .iter()
        .map(|t| t.text.split_whitespace().count() as i64)
        .sum();

    // Duración: fallback del frontend (max audio_end_time redondeado). En rotación no tenemos
    // wall-clock del segmento (finalize corre después del stop y ya se dropeó el manager), pero
    // el max de los timestamps VAD/Deepgram es lo mismo que usa el frontend cuando no hay wall-clock.
    let max_end = sorted
        .iter()
        .map(|t| t.audio_end_time)
        .fold(0.0_f64, f64::max);
    let duration_seconds = max_end.round() as i64;

    // Timestamps: mismo enfoque que el frontend — `finished_at = now`, `started_at = now - dur`.
    // El backend cloud los usa solo como metadata display; el orden real lo dan los segmentos.
    let now = chrono::Utc::now();
    let finished_at = now.to_rfc3339();
    let started_at = (now - chrono::Duration::seconds(duration_seconds)).to_rfc3339();

    let segments_payload: Vec<serde_json::Value> = sorted
        .iter()
        .map(|t| {
            let is_user = t.source_type.as_deref() == Some("user");
            serde_json::json!({
                "segment_index": t.sequence_id,
                "text": t.text,
                "speaker": if is_user { "user" } else { "interlocutor" },
                "speaker_id": if is_user { 0 } else { 1 },
                "is_user": is_user,
                "start_time": t.audio_start_time,
                "end_time": t.audio_end_time,
            })
        })
        .collect();

    // Outbox ATÓMICO: los 3 jobs entran en UNA sola transacción. O el worker ve el grafo
    // completo (save_conversation → save_transcript_segments → finalize_conversation), o no ve
    // ninguno. Sin la transacción, un fallo tras el primer INSERT dejaría un outbox a medias:
    // el worker compuerta por `depends_on` completado (ver `SyncQueueRepository::get_ready_jobs`),
    // así que ejecutaría `save_conversation` solo y publicaría en Supabase una conversación SIN
    // segmentos ni finalize — dato corrupto. Es el invariante de atomicidad del patrón Outbox.
    //
    // El idempotency key y `language` se leyeron arriba (fuera de la tx, son lecturas): si la tx
    // hace rollback, un idempotency key ya persistido queda inofensivo (se reusa en el próximo
    // intento gracias al COALESCE de `get_or_create_idempotency_key`).
    let mut tx = pool.begin().await?;

    // Job 1: save_conversation (root, sin dependencia).
    let job1_payload = serde_json::json!({
        "user_id": user_id,
        "title": meeting_name,
        "started_at": started_at,
        "finished_at": finished_at,
        "transcript_text": transcript_text,
        "source": "maity_desktop",
        "language": language,
        "words_count": words_count,
        "duration_seconds": duration_seconds,
        "idempotency_key": idempotency_key,
    })
    .to_string();

    let job1_id = crate::database::repositories::sync_queue::SyncQueueRepository::enqueue(
        &mut *tx,
        "save_conversation",
        meeting_id,
        &job1_payload,
        10,
        None,
        user_id,
    )
    .await?;

    // Job 2: save_transcript_segments (depende de Job 1).
    let job2_payload = serde_json::json!({
        "user_id": user_id,
        "segments": segments_payload,
    })
    .to_string();

    let job2_id = crate::database::repositories::sync_queue::SyncQueueRepository::enqueue(
        &mut *tx,
        "save_transcript_segments",
        meeting_id,
        &job2_payload,
        10,
        Some(job1_id),
        user_id,
    )
    .await?;

    // Job 3: finalize_conversation (depende de Job 2). `recording_mode` viaja al backend cloud
    // para que el análisis V4 no penalice al ponente por dominancia de talk_ratio.
    let job3_payload = serde_json::json!({
        "duration_seconds": duration_seconds,
        "recording_mode": recording_mode,
    })
    .to_string();

    crate::database::repositories::sync_queue::SyncQueueRepository::enqueue(
        &mut *tx,
        "finalize_conversation",
        meeting_id,
        &job3_payload,
        10,
        Some(job2_id),
        user_id,
    )
    .await?;

    // Commit: recién aquí los 3 jobs se hacen visibles al worker, todos juntos.
    tx.commit().await?;

    info!(
        "[scheduled] 3 jobs de sync cloud encolados para {} (dur={}s, palabras={}, segments={})",
        meeting_id,
        duration_seconds,
        words_count,
        sorted.len()
    );

    Ok(())
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

/// Notificación nativa best-effort al cerrar la jornada headless. Sin click-action: el
/// emisor de Rust ignora `actions` (system.rs solo hace .title/.body/.show), a diferencia
/// del path del webview. Tipo `RecordingStopped` a propósito: queda gated por la
/// preferencia "notificar al detener" del usuario (además de consent/DND).
async fn notify_jornada_saved<R: Runtime>(app: &AppHandle<R>, meeting_name: &str) {
    let notif_state = app.state::<crate::NotificationManagerState<R>>();
    let guard = notif_state.read().await;
    match guard.as_ref() {
        Some(manager) => {
            let notification = crate::notifications::types::Notification::new(
                "Jornada guardada",
                format!("«{}» se guardó localmente y se está sincronizando.", meeting_name),
                crate::notifications::types::NotificationType::RecordingStopped,
            );
            if let Err(e) = manager.show_notification(notification).await {
                warn!("[scheduled] notificación de cierre falló: {}", e);
            }
        }
        None => warn!("[scheduled] NotificationManager no inicializado; sin aviso de cierre"),
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

#[cfg(test)]
mod tests {
    //! Golden / contract test del outbox de sync cloud de segmentos rotados.
    //!
    //! `enqueue_cloud_sync_jobs` DEBE producir payloads idénticos a los que arma el frontend en
    //! `useRecordingStop.ts::enqueueCloudSync`. Ese contrato hoy sólo lo protege un comentario; si
    //! divergen (una key renombrada, un campo perdido, un mapeo de speaker cambiado), la fila cae
    //! corrupta en Supabase sin error visible. Este test fija el shape EXACTO (keys + valores) del
    //! lado Rust, de modo que cualquier cambio accidental falle ruidosamente en CI local.
    //!
    //! Es una versión ligera de un Consumer-Driven Contract (Fowler) de un solo lado — golden
    //! master / characterization test. El salto a un fixture compartido Rust+TS (estilo Pact) que
    //! detecte drift también del frontend queda como trabajo futuro (issue de seguimiento).
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;
    use sqlx::SqlitePool;

    /// Pool in-memory con el ESQUEMA REAL (migraciones), no un SCHEMA a mano: el test necesita
    /// `meetings.cloud_idempotency_key` + `transcript_settings` + `sync_queue`, y aplicar las
    /// migraciones evita el drift que sufre el SCHEMA hand-written de `sync_queue.rs`.
    async fn setup_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1) // `:memory:` da una DB por conexión; capar a 1 mantiene una sola.
            .connect(":memory:")
            .await
            .expect("in-memory sqlite");
        sqlx::migrate!("./migrations")
            .run(&pool)
            .await
            .expect("run migrations");
        pool
    }

    /// `get_or_create_idempotency_key` hace `UPDATE meetings ... WHERE id = ?`; la fila debe existir.
    async fn insert_meeting(pool: &SqlitePool, id: &str) {
        sqlx::query("INSERT INTO meetings (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)")
            .bind(id)
            .bind("Segmento de prueba")
            .bind("2026-01-01T00:00:00Z")
            .bind("2026-01-01T00:00:00Z")
            .execute(pool)
            .await
            .expect("insert meeting");
    }

    /// Fixture DESORDENADO por `audio_start_time` a propósito: así el test verifica el sort
    /// cronológico (user@1.0 debe quedar antes que interlocutor@5.0) además del mapeo de speaker.
    fn fixture_segments() -> Vec<RawTranscriptSegment> {
        vec![
            RawTranscriptSegment {
                id: "seg-b".to_string(),
                text: "que tal".to_string(),
                audio_start_time: 5.0,
                audio_end_time: 7.5,
                duration: 2.5,
                display_time: "[00:05]".to_string(),
                sequence_id: 2,
                source_type: Some("interlocutor".to_string()),
            },
            RawTranscriptSegment {
                id: "seg-a".to_string(),
                text: "hola mundo".to_string(),
                audio_start_time: 1.0,
                audio_end_time: 3.0,
                duration: 2.0,
                display_time: "[00:01]".to_string(),
                sequence_id: 1,
                source_type: Some("user".to_string()),
            },
        ]
    }

    fn keys(v: &serde_json::Value) -> std::collections::BTreeSet<String> {
        v.as_object()
            .expect("objeto JSON")
            .keys()
            .cloned()
            .collect()
    }

    fn expected_keys(list: &[&str]) -> std::collections::BTreeSet<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[tokio::test]
    async fn enqueue_cloud_sync_jobs_mirrors_frontend_contract() {
        let pool = setup_pool().await;
        let meeting_id = "mid-test";
        insert_meeting(&pool, meeting_id).await;

        let raws = fixture_segments();
        enqueue_cloud_sync_jobs(
            &pool,
            meeting_id,
            "Segmento de prueba",
            &raws,
            "user-test",
            "conversation",
        )
        .await
        .expect("encolar outbox");

        // Los 3 jobs, en orden de inserción.
        let jobs: Vec<crate::database::models::SyncQueueJob> =
            sqlx::query_as("SELECT * FROM sync_queue WHERE meeting_id = ? ORDER BY id ASC")
                .bind(meeting_id)
                .fetch_all(&pool)
                .await
                .expect("leer jobs");

        assert_eq!(jobs.len(), 3, "deben encolarse exactamente 3 jobs");
        assert_eq!(jobs[0].job_type, "save_conversation");
        assert_eq!(jobs[1].job_type, "save_transcript_segments");
        assert_eq!(jobs[2].job_type, "finalize_conversation");

        // Cadena de dependencias 1 ← 2 ← 3 (el worker compuerta por `depends_on` completado).
        assert_eq!(jobs[0].depends_on, None);
        assert_eq!(jobs[1].depends_on, Some(jobs[0].id));
        assert_eq!(jobs[2].depends_on, Some(jobs[1].id));

        let job1: serde_json::Value = serde_json::from_str(&jobs[0].payload).unwrap();
        let job2: serde_json::Value = serde_json::from_str(&jobs[1].payload).unwrap();
        let job3: serde_json::Value = serde_json::from_str(&jobs[2].payload).unwrap();

        // ---- Job 1: save_conversation ----
        assert_eq!(
            keys(&job1),
            expected_keys(&[
                "user_id",
                "title",
                "started_at",
                "finished_at",
                "transcript_text",
                "source",
                "language",
                "words_count",
                "duration_seconds",
                "idempotency_key",
            ]),
            "las keys de save_conversation deben espejar el frontend 1:1"
        );
        assert_eq!(job1["user_id"], "user-test");
        assert_eq!(job1["title"], "Segmento de prueba");
        assert_eq!(job1["source"], "maity_desktop");
        assert_eq!(job1["language"], "es"); // fallback: transcript_settings vacío
        // transcript_text ORDENADO cronológicamente (user@1.0 antes que interlocutor@5.0).
        assert_eq!(
            job1["transcript_text"],
            "Usuario: hola mundo\nInterlocutor: que tal"
        );
        assert_eq!(job1["words_count"], 4); // "hola mundo" (2) + "que tal" (2)
        assert_eq!(job1["duration_seconds"], 8); // round(max_end = 7.5)
        assert!(!job1["idempotency_key"].as_str().unwrap().is_empty());
        assert!(job1["started_at"].is_string());
        assert!(job1["finished_at"].is_string());

        // ---- Job 2: save_transcript_segments ----
        assert_eq!(job2["user_id"], "user-test");
        let segs = job2["segments"].as_array().unwrap();
        assert_eq!(segs.len(), 2);
        assert_eq!(
            keys(&segs[0]),
            expected_keys(&[
                "segment_index",
                "text",
                "speaker",
                "speaker_id",
                "is_user",
                "start_time",
                "end_time",
            ]),
            "las keys de cada segmento deben espejar el frontend 1:1"
        );
        // Primero tras el sort = user@1.0
        assert_eq!(segs[0]["segment_index"], 1);
        assert_eq!(segs[0]["text"], "hola mundo");
        assert_eq!(segs[0]["speaker"], "user");
        assert_eq!(segs[0]["speaker_id"], 0);
        assert_eq!(segs[0]["is_user"], true);
        assert_eq!(segs[0]["start_time"], 1.0);
        assert_eq!(segs[0]["end_time"], 3.0);
        // Segundo = interlocutor@5.0
        assert_eq!(segs[1]["segment_index"], 2);
        assert_eq!(segs[1]["speaker"], "interlocutor");
        assert_eq!(segs[1]["speaker_id"], 1);
        assert_eq!(segs[1]["is_user"], false);

        // ---- Job 3: finalize_conversation ----
        assert_eq!(
            keys(&job3),
            expected_keys(&["duration_seconds", "recording_mode"]),
            "las keys de finalize_conversation deben espejar el frontend 1:1"
        );
        assert_eq!(job3["duration_seconds"], 8);
        assert_eq!(job3["recording_mode"], "conversation");

        // ---- Idempotencia: el key viajó en el payload Y se persistió en meetings ----
        let persisted: (Option<String>,) =
            sqlx::query_as("SELECT cloud_idempotency_key FROM meetings WHERE id = ?")
                .bind(meeting_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            persisted.0.as_deref(),
            job1["idempotency_key"].as_str(),
            "el idempotency_key del payload debe ser el persistido en meetings"
        );
        // Resolver de nuevo devuelve el MISMO key (cross-retry-stable).
        let again =
            crate::database::repositories::meeting::MeetingsRepository::get_or_create_idempotency_key(
                &pool, meeting_id,
            )
            .await
            .unwrap();
        assert_eq!(Some(again.as_str()), job1["idempotency_key"].as_str());
    }

    #[tokio::test]
    async fn enqueue_cloud_sync_jobs_propagates_presentation_mode() {
        let pool = setup_pool().await;
        let meeting_id = "mid-presentation";
        insert_meeting(&pool, meeting_id).await;

        let raws = fixture_segments();
        enqueue_cloud_sync_jobs(&pool, meeting_id, "Ponencia", &raws, "user-test", "presentation")
            .await
            .expect("encolar outbox");

        let finalize: (String,) = sqlx::query_as(
            "SELECT payload FROM sync_queue WHERE meeting_id = ? AND job_type = 'finalize_conversation'",
        )
        .bind(meeting_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        let payload: serde_json::Value = serde_json::from_str(&finalize.0).unwrap();
        assert_eq!(
            payload["recording_mode"], "presentation",
            "recording_mode debe viajar tal cual al finalize cloud (no penalizar al ponente)"
        );
    }
}
