// audio/transcription/engine.rs
//
// TranscriptionEngine enum and model initialization/validation logic.

use super::deepgram_provider::DeepgramRealtimeTranscriber;
use super::provider::TranscriptionProvider;
use log::{info, warn, error};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, LazyLock, Mutex, RwLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::audio::recording_phase::{self, RecordingPhase};
use crate::events;

// ============================================================================
// FAST PATH: PRELOADED ENGINE FLAG
// ============================================================================
//
// Cuando `ensure_stt_warm` (o la carga on-demand de `validate_transcription_
// model_ready`) deja el modelo en RAM, registra (provider, model) en este flag
// global. `validate_transcription_model_ready` lo consulta ANTES de tocar el
// motor — si coincide, retorna Ok(()) en <1 ms en lugar de re-validar.
//
// El flag NO comprueba `is_model_loaded()`: por eso se lee y se limpia SIEMPRE
// bajo `STT_WARM_LOCK`, y `clear_preloaded()` va DESPUÉS de `unload_model()`.
// Un unload que dejara el flag armado haría que la siguiente grabación saltara
// la carga y muriera en `get_or_init_transcription_engine` con "no model loaded".
//
// Pendiente conocido: ningún handler de Ajustes llama a `mark_preloaded` al
// cambiar el modelo activo, y `parakeet_validate_model_ready_with_config`
// devuelve Ok con cualquier modelo cargado aunque la config pida otro.

static PRELOADED_ENGINE: LazyLock<RwLock<Option<(String, String)>>> =
    LazyLock::new(|| RwLock::new(None));

/// Marca el engine como precargado en RAM. Permite que validate_transcription_model_ready
/// retorne Ok inmediato sin tocar SQLite.
pub fn mark_preloaded(provider: &str, model: &str) {
    if let Ok(mut guard) = PRELOADED_ENGINE.write() {
        *guard = Some((provider.to_string(), model.to_string()));
        info!("⚡ FAST PATH armado: {}={}", provider, model);
    } else {
        warn!("mark_preloaded: PRELOADED_ENGINE poisoned, skip");
    }
}

/// Limpia el flag de preload. Llamar tras unload, bajo `STT_WARM_LOCK`.
pub fn clear_preloaded() {
    if let Ok(mut guard) = PRELOADED_ENGINE.write() {
        *guard = None;
    }
}

fn fast_path_match(provider: &str, model: &str) -> bool {
    PRELOADED_ENGINE
        .read()
        .ok()
        .and_then(|g| g.clone())
        .map(|(p, m)| p == provider && m == model)
        .unwrap_or(false)
}

// ============================================================================
// CICLO DE VIDA DEL MOTOR STT LOCAL (sep-2026, #02 de la auditoría de recursos)
// ============================================================================
//
// Hasta sep-2026 el modelo se precargaba en el `setup()` de lib.rs sin mirar
// sesión ni registro (~600 MB residentes en la pantalla de login y en la
// bandeja, sin consumidor posible) y nada lo descargaba jamás. Hoy la carga
// vive detrás de `ensure_stt_warm` (login, registro, fin de descarga, prewarm
// de jornada) y la descarga detrás de `unload_stt` (logout en todo tier; reposo
// prolongado en tier Low vía `idle_unload.rs`).
//
// `STT_WARM_LOCK` serializa TRES cosas: la precarga, la carga on-demand de
// `validate_transcription_model_ready` y el unload. Sostener el write lock del
// motor durante el check de fase NO bastaría: `validate` devuelve Ok tras un
// `is_model_loaded()` y suelta todo, y entre ese Ok y la primera inferencia
// pasan cientos de ms en los que un unload que ya pasó su check de fase vacía
// el modelo y el worker salta la grabación entera (worker.rs: chunk sin modelo
// = chunk descartado). Con el flag, la carga y el check de fase bajo el mismo
// mutex —y `StartGate` (fase `Starting`) adquirido ANTES de que `validate`
// pida el lock— todos los órdenes terminan bien: o el unload ve `Starting` y
// rehúsa, o `validate` ve el flag limpio y recarga.
//
// Orden de locks: `STT_WARM_LOCK` es SIEMPRE el más externo. Dentro sólo se
// toman los statics `*_ENGINE` (std Mutex, bloque corto para clonar el `Arc`,
// nunca a través de un await) y los `RwLock` tokio de cada motor.

static STT_WARM_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Resultado de `ensure_stt_warm`.
#[derive(Debug)]
pub enum WarmOutcome {
    /// Se cargó un modelo en esta llamada.
    Loaded {
        provider: String,
        model: String,
        elapsed: Duration,
    },
    /// El modelo configurado ya estaba en RAM: no se hizo nada.
    AlreadyLoaded,
    SkippedNoSession,
    SkippedRegistration,
    /// Provider en la nube (Deepgram): no hay nada que cargar.
    SkippedCloud,
    /// Modo LOTE (`RecordingPreferences::effective_mode()`): la grabación no
    /// consume el motor — el planner lo carga con `ensure_stt_warm_parakeet`
    /// al cerrar cada segmento y lo suelta al vaciar la cola. Precargarlo al
    /// login eran ~700 MB residentes sin consumidor durante toda la jornada
    /// (visto el 2026-09-10 en el build piloto 0.2.59: `app_rss_mb` 740 desde
    /// el login hasta que la presión de memoria forzó el `idle_unload`).
    SkippedBatch,
}

/// ¿La precarga se omite por modo LOTE? Decisión pura para la tabla de tests.
/// Usa `effective_mode()` y no `is_batch_mode()` a secas: sin `auto_save` no
/// hay checkpoints, la grabación cae a streaming y SÍ necesita el motor (misma
/// regla que `initialize_recording` y que el warmup del sidecar en `lib.rs`).
/// `None` (prefs ilegibles) → no se omite: fail-open, como el sidecar.
pub(crate) fn warm_skipped_by_batch(
    prefs: Option<&crate::audio::recording_preferences::RecordingPreferences>,
) -> bool {
    use crate::audio::recording_preferences::TranscriptionMode;
    prefs.is_some_and(|p| matches!(p.effective_mode(), TranscriptionMode::Batch))
}

/// Resultado de `unload_stt`.
#[derive(Debug)]
pub enum UnloadOutcome {
    /// `(provider, modelo)` por cada motor que tenía algo residente.
    Unloaded(Vec<(&'static str, String)>),
    NothingLoaded,
    /// Hay una grabación en curso (o arrancando / cerrando): no se toca.
    RefusedPhase(RecordingPhase),
    /// Un job de transcripción por lote tiene el motor en uso (lease vivo).
    RefusedBatchLease,
}

// ============================================================================
// LEASE DEL LOTE (F1 de la migración a transcripción por lote, sep-2026)
// ============================================================================
//
// Un job de lote usa el motor SIN que la fase de grabación lo refleje (puede
// correr con fase `Idle`, p. ej. drenando pendientes tras el arranque). El
// lease es la señal que le falta a `unload_stt`: mientras haya un guard vivo,
// ni el logout ni el reposo de tier Low descargan el modelo a mitad de una
// inferencia. Se consulta BAJO `STT_WARM_LOCK` (mismo contrato que la fase);
// el guard RAII garantiza el decremento también en error/cancelación.

static BATCH_STT_LEASE: AtomicU32 = AtomicU32::new(0);

/// ¿Hay algún job de lote con el motor en uso?
pub(crate) fn batch_lease_active() -> bool {
    BATCH_STT_LEASE.load(Ordering::SeqCst) > 0
}

/// Guard RAII del lease. `acquire()` al entrar al job; el Drop lo suelta.
pub struct BatchSttLease(());

impl BatchSttLease {
    pub fn acquire() -> Self {
        let prev = BATCH_STT_LEASE.fetch_add(1, Ordering::SeqCst);
        info!("🔒 Batch STT lease adquirido ({} activos)", prev + 1);
        Self(())
    }
}

impl Drop for BatchSttLease {
    fn drop(&mut self) {
        let prev = BATCH_STT_LEASE.fetch_sub(1, Ordering::SeqCst);
        info!("🔓 Batch STT lease liberado ({} activos)", prev.saturating_sub(1));
    }
}

/// Señal del modo lote (F2): ¿la grabación ACTIVA consume el motor STT?
/// `true` = streaming (default histórico). En modo lote la grabación solo
/// captura checkpoints — no toca el motor — así que las fases
/// `Recording`/`Paused`/`Stopping` dejan de bloquear el unload. La SELLA el
/// arranque de grabación (F3) para ambos modos; el stop NO la restaura (con la
/// fase aún en `Stopping` el planner de lote leía `streaming_active` y difería
/// cada segmento 5 min, 2026-09-10). En `Idle` nadie la consulta.
static ACTIVE_RECORDING_USES_STT: AtomicBool = AtomicBool::new(true);

/// La llama el arranque de grabación (F3) según `transcription_mode`.
pub fn set_active_recording_uses_stt(uses_stt: bool) {
    ACTIVE_RECORDING_USES_STT.store(uses_stt, Ordering::SeqCst);
}

pub(crate) fn active_recording_uses_stt() -> bool {
    ACTIVE_RECORDING_USES_STT.load(Ordering::SeqCst)
}

/// ¿Se puede descargar el motor en esta fase? En streaming sólo en `Idle`
/// (`Stopping` también rehúsa: el drenaje final de la cola aún usa el modelo).
/// Con una grabación en modo LOTE (`recording_uses_stt == false`) la fase no
/// bloquea: la grabación no consume el motor. Pura, tabulada en tests.
pub(crate) fn unload_allowed(phase: RecordingPhase, recording_uses_stt: bool) -> bool {
    phase == RecordingPhase::Idle || !recording_uses_stt
}

fn is_local_provider(provider: &str) -> bool {
    matches!(provider, "parakeet" | "localWhisper" | "moonshine" | "canary")
}

fn default_transcript_config() -> crate::api::TranscriptConfig {
    crate::api::TranscriptConfig {
        provider: "parakeet".to_string(),
        model: "parakeet-tdt-0.6b-v3-int8".to_string(),
        api_key: None,
        language: Some("es-419".to_string()),
    }
}

/// Config de transcripción desde SQLite, con el default histórico (Parakeet)
/// si no hay fila o la lectura falla. `Err` sólo si `AppState` no existe aún.
async fn read_transcript_config<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<crate::api::TranscriptConfig, String> {
    let app_state = app
        .try_state::<crate::state::AppState>()
        .ok_or_else(|| "Database not initialized — cannot read transcript config".to_string())?;
    match crate::api::api_get_transcript_config(app.clone(), app_state, None).await {
        Ok(Some(config)) => Ok(config),
        Ok(None) => {
            info!("📝 No transcript config found, defaulting to parakeet");
            Ok(default_transcript_config())
        }
        Err(e) => {
            warn!("⚠️ Failed to get transcript config: {}, defaulting to parakeet", e);
            Ok(default_transcript_config())
        }
    }
}

/// Clona el `Arc` de un motor desde su static, sin sostener el std Mutex.
fn clone_engine<T>(slot: &Mutex<Option<Arc<T>>>) -> Option<Arc<T>> {
    match slot.lock() {
        Ok(guard) => guard.as_ref().cloned(),
        Err(_) => {
            warn!("engine slot poisoned; treating as uninitialized");
            None
        }
    }
}

/// Nombre del modelo residente del provider configurado, si lo hay.
async fn loaded_model_for(provider: &str) -> Option<String> {
    match provider {
        "parakeet" => {
            let e = clone_engine(&crate::parakeet_engine::commands::PARAKEET_ENGINE)?;
            if e.is_model_loaded().await { e.get_current_model().await } else { None }
        }
        "localWhisper" => {
            let e = clone_engine(&crate::whisper_engine::commands::WHISPER_ENGINE)?;
            if e.is_model_loaded().await { e.get_current_model().await } else { None }
        }
        "moonshine" => {
            let e = clone_engine(&crate::moonshine_engine::commands::MOONSHINE_ENGINE)?;
            if e.is_model_loaded().await { e.get_current_model().await } else { None }
        }
        "canary" => {
            let e = clone_engine(&crate::canary_engine::commands::CANARY_ENGINE)?;
            if e.is_model_loaded().await { e.get_current_model().await } else { None }
        }
        _ => None,
    }
}

/// ¿Hay algún motor local con modelo en RAM? Lectura sin `STT_WARM_LOCK`: es
/// una pista para la tarea de reposo, la decisión final la toma `unload_stt`.
pub(crate) async fn any_local_engine_loaded() -> bool {
    for p in ["parakeet", "localWhisper", "moonshine", "canary"] {
        if loaded_model_for(p).await.is_some() {
            return true;
        }
    }
    false
}

/// Descarga TODO motor local que tenga algo residente, sin mirar el provider
/// configurado: cubre al usuario que cambió de provider en Ajustes con el
/// modelo viejo aún en RAM. Deepgram no tiene nada que descargar.
async fn unload_all_local_engines() -> Vec<(&'static str, String)> {
    let mut out = Vec::new();
    if let Some(e) = clone_engine(&crate::parakeet_engine::commands::PARAKEET_ENGINE) {
        if e.is_model_loaded().await {
            let m = e.get_current_model().await.unwrap_or_default();
            if e.unload_model().await {
                out.push(("parakeet", m));
            }
        }
    }
    if let Some(e) = clone_engine(&crate::whisper_engine::commands::WHISPER_ENGINE) {
        if e.is_model_loaded().await {
            let m = e.get_current_model().await.unwrap_or_default();
            if e.unload_model().await {
                out.push(("localWhisper", m));
            }
        }
    }
    if let Some(e) = clone_engine(&crate::moonshine_engine::commands::MOONSHINE_ENGINE) {
        if e.is_model_loaded().await {
            let m = e.get_current_model().await.unwrap_or_default();
            if e.unload_model().await {
                out.push(("moonshine", m));
            }
        }
    }
    if let Some(e) = clone_engine(&crate::canary_engine::commands::CANARY_ENGINE) {
        if e.is_model_loaded().await {
            let m = e.get_current_model().await.unwrap_or_default();
            if e.unload_model().await {
                out.push(("canary", m));
            }
        }
    }
    out
}

/// Evento `stt.engine_lifecycle` al outbox. Sólo se emite en cargas y descargas
/// REALES (unas pocas por día): `set_registration_status` reinvoca
/// `ensure_stt_warm` en cada refetch y un "ya estaba" no debe dejar fila.
pub(crate) async fn emit_engine_lifecycle<R: Runtime>(
    app: &AppHandle<R>,
    action: &str,
    reason: &str,
    provider: &str,
    model: &str,
    elapsed_ms: Option<u64>,
    status: &str,
) {
    let tier = crate::audio::hardware_detector::HardwareProfile::detect()
        .performance_tier
        .as_str();
    crate::logging::telemetry::emit::emit_event(
        app,
        crate::logging::telemetry::context::process_session_id(),
        crate::logging::telemetry::catalog::STT_ENGINE_LIFECYCLE,
        serde_json::json!({
            "action": action,
            "reason": reason,
            "provider": provider,
            "model": model,
            "elapsed_ms": elapsed_ms,
            "tier": tier,
        }),
        Some(status),
        None,
        None,
    )
    .await;
}

/// Carga el modelo del provider local configurado si no está ya en RAM.
/// REQUIERE `STT_WARM_LOCK` tomado por el caller. Nunca descarga un modelo
/// (`validate_*_with_config` de cada motor falla con error claro si falta).
async fn load_configured_model_locked<R: Runtime>(
    app: &AppHandle<R>,
    config: &crate::api::TranscriptConfig,
) -> Result<WarmOutcome, String> {
    if !is_local_provider(&config.provider) {
        return Ok(WarmOutcome::SkippedCloud);
    }
    if let Some(loaded) = loaded_model_for(&config.provider).await {
        info!(
            "🦜 Motor STT ya residente ({}={}), no se recarga",
            config.provider, loaded
        );
        mark_preloaded(&config.provider, &config.model);
        return Ok(WarmOutcome::AlreadyLoaded);
    }

    // Evidencia local del pico de carga (~1.3 GB transitorio con Parakeet int8).
    crate::logging::mem_sampler::snapshot_now("stt-warm");
    info!("🔥 Cargando motor STT (provider: {}, model: {})", config.provider, config.model);
    let start = Instant::now();
    validate_local_provider(app, &config.provider).await?;
    let elapsed = start.elapsed();
    info!("✅ Motor STT cargado en {:?}", elapsed);
    mark_preloaded(&config.provider, &config.model);
    Ok(WarmOutcome::Loaded {
        provider: config.provider.clone(),
        model: config.model.clone(),
        elapsed,
    })
}

/// Precarga gateada e idempotente del motor STT. Punto de entrada de login,
/// registro completado, fin de descarga del modelo y prewarm de jornada.
///
/// Sin sesión o sin registro confirmado no carga nada (fail-closed, mismo gate
/// que el embudo de grabación). Re-chequea la sesión DESPUÉS de esperar el
/// lock: si un logout ganó mientras esperábamos, no hay que recargar lo que
/// `clear_current_user` acaba de soltar.
pub async fn ensure_stt_warm<R: Runtime>(
    app: &AppHandle<R>,
    reason: &'static str,
) -> Result<WarmOutcome, String> {
    if !crate::state::has_session(app).await {
        return Ok(WarmOutcome::SkippedNoSession);
    }
    if !crate::state::registration_completed(app).await {
        return Ok(WarmOutcome::SkippedRegistration);
    }
    // Modo lote: la grabación no usa el motor (ver `WarmOutcome::SkippedBatch`).
    // Se lee ANTES del provider: en lote da igual cuál esté configurado.
    let prefs = crate::audio::recording_preferences::load_recording_preferences(app)
        .await
        .ok();
    if warm_skipped_by_batch(prefs.as_ref()) {
        info!(
            "🦜 Precarga del STT omitida ({}) — modo lote: la grabación no usa el motor; \
             el planner lo carga al cerrar cada segmento",
            reason
        );
        return Ok(WarmOutcome::SkippedBatch);
    }
    let config = read_transcript_config(app).await?;
    if !is_local_provider(&config.provider) {
        info!("☁️ Provider '{}' es nube, sin precarga", config.provider);
        return Ok(WarmOutcome::SkippedCloud);
    }

    let outcome = {
        let _flight = STT_WARM_LOCK.lock().await;
        if !crate::state::has_session(app).await {
            return Ok(WarmOutcome::SkippedNoSession);
        }
        load_configured_model_locked(app, &config).await?
    };

    if let WarmOutcome::Loaded { provider, model, elapsed } = &outcome {
        // Disponible para un indicador de UI ("Modelo listo"); hoy sin listener.
        let _ = app.emit(
            events::TRANSCRIPTION_PRELOAD_COMPLETED,
            serde_json::json!({
                "provider": provider,
                "model": model,
                "elapsed_ms": elapsed.as_millis() as u64,
            }),
        );
        emit_engine_lifecycle(
            app,
            "loaded",
            reason,
            provider,
            model,
            Some(elapsed.as_millis() as u64),
            "ok",
        )
        .await;
    }
    Ok(outcome)
}

/// Variante del warm para la transcripción por LOTE: fuerza Parakeet (decisión
/// de producto de la migración — el provider configurado puede ser Deepgram,
/// que en lote no aplica) con los mismos gates fail-closed de sesión/registro.
///
/// Nota conocida (aceptada en F1, dev command): si otro motor local quedó
/// residente (p. ej. Whisper del streaming), esta carga NO lo descarga —
/// habría dos modelos en RAM durante el job. El planner de F2 decide política.
pub async fn ensure_stt_warm_parakeet<R: Runtime>(
    app: &AppHandle<R>,
    reason: &'static str,
) -> Result<WarmOutcome, String> {
    if !crate::state::has_session(app).await {
        return Ok(WarmOutcome::SkippedNoSession);
    }
    if !crate::state::registration_completed(app).await {
        return Ok(WarmOutcome::SkippedRegistration);
    }
    let config = default_transcript_config();

    let outcome = {
        let _flight = STT_WARM_LOCK.lock().await;
        if !crate::state::has_session(app).await {
            return Ok(WarmOutcome::SkippedNoSession);
        }
        load_configured_model_locked(app, &config).await?
    };

    if let WarmOutcome::Loaded { provider, model, elapsed } = &outcome {
        emit_engine_lifecycle(
            app,
            "loaded",
            reason,
            provider,
            model,
            Some(elapsed.as_millis() as u64),
            "ok",
        )
        .await;
    }
    Ok(outcome)
}

/// Descarga todo motor STT local residente. Rehúsa si hay grabación (fase
/// distinta de `Idle`). Limpia el fast path DESPUÉS de descargar y bajo el
/// mismo lock, para que ningún `validate` concurrente vea el flag armado con
/// el modelo ya fuera de RAM.
pub async fn unload_stt<R: Runtime>(app: &AppHandle<R>, reason: &'static str) -> UnloadOutcome {
    let unloaded = {
        let _flight = STT_WARM_LOCK.lock().await;
        let phase = recording_phase::current_phase();
        if !unload_allowed(phase, active_recording_uses_stt()) {
            info!("STT unload ({}) rehusado: fase {:?}", reason, phase);
            return UnloadOutcome::RefusedPhase(phase);
        }
        // Un job de lote puede estar transcribiendo con fase Idle: el lease
        // es su única señal de "en uso". Chequeado bajo el mismo lock que la
        // carga, así ningún job arranca entre el check y la descarga.
        if batch_lease_active() {
            info!("STT unload ({}) rehusado: batch lease activo", reason);
            return UnloadOutcome::RefusedBatchLease;
        }
        let unloaded = unload_all_local_engines().await;
        clear_preloaded();
        unloaded
    };

    if unloaded.is_empty() {
        return UnloadOutcome::NothingLoaded;
    }
    crate::logging::mem_sampler::snapshot_now("stt-unload");
    for (provider, model) in &unloaded {
        info!("📉 Motor STT descargado ({}): {}={}", reason, provider, model);
        emit_engine_lifecycle(app, "unloaded", reason, provider, model, None, "ok").await;
    }
    UnloadOutcome::Unloaded(unloaded)
}

// ============================================================================
// TRANSCRIPTION ENGINE ENUM
// ============================================================================

// Transcription engine abstraction to support multiple providers
pub enum TranscriptionEngine {
    Whisper(Arc<crate::whisper_engine::WhisperEngine>),  // Direct access (backward compat)
    Parakeet(Arc<crate::parakeet_engine::ParakeetEngine>), // Direct access (backward compat)
    Moonshine(Arc<crate::moonshine_engine::MoonshineEngine>), // Moonshine edge-optimized
    Deepgram { mic: Arc<DeepgramRealtimeTranscriber>, sys: Arc<DeepgramRealtimeTranscriber> }, // Deepgram dual persistent streaming (one per audio source)
    Provider(Arc<dyn TranscriptionProvider>),  // Trait-based (preferred for new code)
}

impl TranscriptionEngine {
    /// Check if the engine has a model loaded
    pub async fn is_model_loaded(&self) -> bool {
        match self {
            Self::Whisper(engine) => engine.is_model_loaded().await,
            Self::Parakeet(engine) => engine.is_model_loaded().await,
            Self::Moonshine(engine) => engine.is_model_loaded().await,
            Self::Deepgram { mic, .. } => mic.is_model_loaded().await,
            Self::Provider(provider) => provider.is_model_loaded().await,
        }
    }

    /// Get the current model name
    pub async fn get_current_model(&self) -> Option<String> {
        match self {
            Self::Whisper(engine) => engine.get_current_model().await,
            Self::Parakeet(engine) => engine.get_current_model().await,
            Self::Moonshine(engine) => engine.get_current_model().await,
            Self::Deepgram { mic, .. } => mic.get_current_model().await,
            Self::Provider(provider) => provider.get_current_model().await,
        }
    }

    /// Get the provider name for logging
    pub fn provider_name(&self) -> &str {
        match self {
            Self::Whisper(_) => "Whisper (direct)",
            Self::Parakeet(_) => "Parakeet (direct)",
            Self::Moonshine(_) => "Moonshine (direct)",
            Self::Deepgram { .. } => "Deepgram (streaming)",
            Self::Provider(provider) => provider.provider_name(),
        }
    }

    /// Check if this engine uses persistent streaming (e.g., Deepgram).
    /// When true, the worker should not emit transcript-update events itself
    /// because the engine's reader task handles emission directly.
    pub fn is_streaming_provider(&self) -> bool {
        matches!(self, Self::Deepgram { .. })
    }

    /// Transcribe audio routed to the correct Deepgram instance by device_type.
    /// Only valid for Deepgram engines; returns error for other engine types.
    pub async fn transcribe_for_device(
        &self,
        device_type: &crate::audio::recording_state::DeviceType,
        audio: Vec<f32>,
        language: Option<String>,
    ) -> Result<super::provider::TranscriptResult, super::provider::TranscriptionError> {
        if let Self::Deepgram { mic, sys } = self {
            let dg = match device_type {
                crate::audio::recording_state::DeviceType::Microphone => mic,
                crate::audio::recording_state::DeviceType::System => sys,
                crate::audio::recording_state::DeviceType::Mixed => {
                    return Err(super::provider::TranscriptionError::EngineFailed(
                        "Mixed device_type should not reach Deepgram transcription".to_string(),
                    ));
                }
            };
            dg.transcribe(audio, language).await
        } else {
            Err(super::provider::TranscriptionError::EngineFailed(
                "transcribe_for_device called on non-Deepgram engine".to_string(),
            ))
        }
    }

    /// Close persistent stream for streaming providers (e.g., Deepgram).
    /// No-op for non-streaming engines.
    pub async fn close_stream(&self) {
        if let Self::Deepgram { mic, sys } = self {
            mic.close_persistent_stream().await;
            sys.close_persistent_stream().await;
        }
    }
}

// ============================================================================
// MODEL VALIDATION AND INITIALIZATION
// ============================================================================

/// Validate that transcription models are ready before starting recording.
///
/// Es la carga ON-DEMAND: tray, scheduler y botón pasan por aquí vía
/// `initialize_recording`, con la fase ya en `Starting` (`StartGate`). Si el
/// motor fue descargado (logout / reposo en tier Low), aquí se recarga: 3-10 s
/// que la auditoría #02 acepta a cambio de no tener 600 MB residentes sin
/// consumidor. El fast path y la carga van bajo `STT_WARM_LOCK` (ver arriba).
pub async fn validate_transcription_model_ready<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    // Defensive: AppState may not be managed if DB init failed silently
    // (e.g. sqlx migration checksum mismatch). Convert what would be a panic
    // from `app.state::<AppState>()` into an actionable error event.
    if app.try_state::<crate::state::AppState>().is_none() {
        let msg = "Database not initialized — cannot validate transcription. \
                   Check earlier logs for DB init errors (sqlx migration checksum mismatch?).";
        log::error!("{}", msg);
        let _ = app.emit(
            events::TRANSCRIPTION_ERROR,
            serde_json::json!({
                "error": msg,
                "userMessage": "La base de datos no se pudo inicializar. Reinicia la app o contacta soporte si persiste.",
                "actionable": true
            }),
        );
        return Err(msg.to_string());
    }

    let config = read_transcript_config(app).await?;
    info!(
        "📝 Transcript config - provider: {}, model: {}",
        config.provider, config.model
    );

    match config.provider.as_str() {
        "parakeet" | "localWhisper" | "moonshine" | "canary" => {
            let outcome = {
                let _flight = STT_WARM_LOCK.lock().await;
                // FAST PATH: el flag coincide con el (provider, model) configurado
                // -> Ok inmediato (<1 ms) sin re-validar. Leído bajo el lock.
                if fast_path_match(&config.provider, &config.model) {
                    info!(
                        "⚡ FAST PATH validate: {}={} ya precargado",
                        config.provider, config.model
                    );
                    return Ok(());
                }
                load_configured_model_locked(app, &config).await?
            };
            if let WarmOutcome::Loaded { provider, model, elapsed } = &outcome {
                emit_engine_lifecycle(
                    app,
                    "loaded",
                    "recording_start",
                    provider,
                    model,
                    Some(elapsed.as_millis() as u64),
                    "ok",
                )
                .await;
            }
            Ok(())
        }
        "deepgram" => {
            info!("🔍 Validating Deepgram cloud provider...");

            // Check if we have a valid proxy config (obtained from Vercel API)
            if super::deepgram_commands::has_cached_proxy_config() {
                info!("✅ Deepgram proxy config disponible, transcripción en la nube lista");
                Ok(())
            } else {
                // No proxy config available - user needs to be authenticated
                warn!("⚠️ No hay configuración de proxy Deepgram disponible");
                warn!("   El frontend debe obtener la configuración del proxy antes de iniciar la grabación");
                Err(
                    "Configuración de Deepgram no disponible. Por favor asegúrate de estar autenticado con tu cuenta de Google.".to_string()
                )
            }
        }
        other => {
            warn!("❌ Unsupported transcription provider: {}", other);
            Err(format!(
                "El proveedor '{}' no es compatible. Por favor selecciona 'deepgram', 'localWhisper', 'parakeet', o 'moonshine'.",
                other
            ))
        }
    }
}

/// Inicializa el motor del provider local y carga su modelo (auto-descubrimiento
/// incluido; nunca descarga). Sólo llamar desde `load_configured_model_locked`.
async fn validate_local_provider<R: Runtime>(app: &AppHandle<R>, provider: &str) -> Result<(), String> {
    match provider {
        "localWhisper" => {
            info!("🔍 Validating Whisper model...");
            // Ensure whisper engine is initialized first
            if let Err(init_error) = crate::whisper_engine::commands::whisper_init().await {
                warn!("❌ Failed to initialize Whisper engine: {}", init_error);
                return Err(format!(
                    "Failed to initialize speech recognition: {}",
                    init_error
                ));
            }

            // Call the whisper validation command with config support
            match crate::whisper_engine::commands::whisper_validate_model_ready_with_config(app).await {
                Ok(model_name) => {
                    info!("✅ Whisper model validation successful: {} is ready", model_name);
                    Ok(())
                }
                Err(e) => {
                    warn!("❌ Whisper model validation failed: {}", e);
                    Err(e)
                }
            }
        }
        "parakeet" => {
            info!("🔍 Validating Parakeet model...");
            // Ensure parakeet engine is initialized first
            if let Err(init_error) = crate::parakeet_engine::commands::parakeet_init().await {
                warn!("❌ Failed to initialize Parakeet engine: {}", init_error);
                return Err(format!(
                    "Failed to initialize Parakeet speech recognition: {}",
                    init_error
                ));
            }

            // Use the validation command that includes auto-discovery and loading
            // This matches the Whisper behavior for consistency
            match crate::parakeet_engine::commands::parakeet_validate_model_ready_with_config(app).await {
                Ok(model_name) => {
                    info!("✅ Parakeet model validation successful: {} is ready", model_name);
                    Ok(())
                }
                Err(e) => {
                    warn!("❌ Parakeet model validation failed: {}", e);
                    Err(e)
                }
            }
        }
        "canary" => {
            info!("🐤 Validating Canary model...");
            if let Err(init_error) = crate::canary_engine::commands::canary_init().await {
                warn!("❌ Failed to initialize Canary engine: {}", init_error);
                return Err(format!(
                    "Failed to initialize Canary speech recognition: {}",
                    init_error
                ));
            }
            match crate::canary_engine::commands::canary_validate_model_ready_with_config(app).await {
                Ok(model_name) => {
                    info!("✅ Canary model validation successful: {} is ready", model_name);
                    Ok(())
                }
                Err(e) => {
                    warn!("❌ Canary model validation failed: {}", e);
                    Err(e)
                }
            }
        }
        "moonshine" => {
            info!("🌙 Validating Moonshine model...");
            // Ensure moonshine engine is initialized first
            if let Err(init_error) = crate::moonshine_engine::commands::moonshine_init().await {
                warn!("❌ Failed to initialize Moonshine engine: {}", init_error);
                return Err(format!(
                    "Failed to initialize Moonshine speech recognition: {}",
                    init_error
                ));
            }

            // Use the validation command that includes auto-discovery and loading
            match crate::moonshine_engine::commands::moonshine_validate_model_ready_with_config(app).await {
                Ok(model_name) => {
                    info!("✅ Moonshine model validation successful: {} is ready", model_name);
                    Ok(())
                }
                Err(e) => {
                    warn!("❌ Moonshine model validation failed: {}", e);
                    Err(e)
                }
            }
        }
        other => Err(format!("validate_local_provider: '{}' no es un provider local", other)),
    }
}

#[cfg(test)]
mod stt_lifecycle_tests {
    use super::*;

    fn prefs(mode: &str, auto_save: bool) -> crate::audio::recording_preferences::RecordingPreferences {
        serde_json::from_value(serde_json::json!({
            "save_folder": "C:/maity-recordings",
            "auto_save": auto_save,
            "file_format": "mp4",
            "transcription_mode": mode,
        }))
        .expect("prefs mínimas")
    }

    /// La precarga al login/registro/descarga/prewarm se omite SOLO cuando la
    /// grabación efectiva irá por lote. Sin `auto_save` no hay checkpoints y
    /// el modo cae a streaming, que sí consume el motor; prefs ilegibles no
    /// bloquean (fail-open).
    #[test]
    fn precarga_omitida_solo_en_lote_efectivo() {
        let cases: [(&str, Option<(&str, bool)>, bool); 5] = [
            ("lote con auto_save → omitida", Some(("batch", true)), true),
            ("lote sin auto_save cae a streaming → carga", Some(("batch", false)), false),
            ("streaming → carga", Some(("streaming", true)), false),
            ("modo desconocido cae a streaming → carga", Some(("lo-que-sea", true)), false),
            ("prefs ilegibles → carga (fail-open)", None, false),
        ];
        for (name, input, expected) in cases {
            let p = input.map(|(mode, auto_save)| prefs(mode, auto_save));
            assert_eq!(warm_skipped_by_batch(p.as_ref()), expected, "{}", name);
        }
    }

    /// El flag es la única memoria del fast path: armarlo, cotejarlo y limpiarlo
    /// tiene que ser exacto por (provider, model), no por provider.
    #[test]
    fn fast_path_coteja_provider_y_modelo_exactos() {
        clear_preloaded();
        assert!(!fast_path_match("parakeet", "parakeet-tdt-0.6b-v3-int8"));
        mark_preloaded("parakeet", "parakeet-tdt-0.6b-v3-int8");
        assert!(fast_path_match("parakeet", "parakeet-tdt-0.6b-v3-int8"));
        assert!(!fast_path_match("parakeet", "parakeet-tdt-0.6b-v2-int8"));
        assert!(!fast_path_match("localWhisper", "parakeet-tdt-0.6b-v3-int8"));
        clear_preloaded();
        assert!(!fast_path_match("parakeet", "parakeet-tdt-0.6b-v3-int8"));
    }

    /// En streaming sólo `Idle` permite descargar: `Stopping` aún drena la cola
    /// con el modelo y `Starting` ya tiene un `validate` en vuelo que cuenta
    /// con él. En modo lote (uses_stt=false) la fase deja de bloquear: la
    /// grabación solo captura checkpoints.
    #[test]
    fn unload_por_fase_y_modo() {
        let casos = [
            // (fase, recording_uses_stt, esperado)
            (RecordingPhase::Idle, true, true),
            (RecordingPhase::Starting, true, false),
            (RecordingPhase::Recording, true, false),
            (RecordingPhase::Paused, true, false),
            (RecordingPhase::Stopping, true, false),
            (RecordingPhase::Idle, false, true),
            (RecordingPhase::Starting, false, true),
            (RecordingPhase::Recording, false, true),
            (RecordingPhase::Paused, false, true),
            (RecordingPhase::Stopping, false, true),
        ];
        for (phase, uses_stt, esperado) in casos {
            assert_eq!(
                unload_allowed(phase, uses_stt),
                esperado,
                "fase {:?} uses_stt={}",
                phase,
                uses_stt
            );
        }
    }

    /// El lease es un contador con guard RAII: se libera también si el job
    /// muere por error (Drop), y soporta jobs anidados/concurrentes.
    #[test]
    fn batch_lease_raii() {
        assert!(!batch_lease_active());
        {
            let _a = BatchSttLease::acquire();
            assert!(batch_lease_active());
            {
                let _b = BatchSttLease::acquire();
                assert!(batch_lease_active());
            }
            assert!(batch_lease_active(), "un guard vivo mantiene el lease");
        }
        assert!(!batch_lease_active(), "el Drop del último guard lo suelta");
    }

    #[test]
    fn providers_locales_vs_nube() {
        for p in ["parakeet", "localWhisper", "moonshine", "canary"] {
            assert!(is_local_provider(p), "{}", p);
        }
        assert!(!is_local_provider("deepgram"));
        assert!(!is_local_provider(""));
    }
}

/// Get or initialize the appropriate transcription engine based on provider configuration
pub async fn get_or_init_transcription_engine<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<TranscriptionEngine, String> {
    // Get provider configuration from API
    let config = match crate::api::api_get_transcript_config(
        app.clone(),
        app.clone().state(), // state-allow: pre-existing, refactor in separate PR
        None,
    )
    .await
    {
        Ok(Some(config)) => {
            info!(
                "📝 Transcript config - provider: {}, model: {}",
                config.provider, config.model
            );
            config
        }
        Ok(None) => {
            info!("📝 No transcript config found, defaulting to parakeet");
            crate::api::TranscriptConfig {
                provider: "parakeet".to_string(),
                model: "parakeet-tdt-0.6b-v3-int8".to_string(),
                api_key: None,
                language: Some("es-419".to_string()),
            }
        }
        Err(e) => {
            warn!("⚠️ Failed to get transcript config: {}, defaulting to parakeet", e);
            crate::api::TranscriptConfig {
                provider: "parakeet".to_string(),
                model: "parakeet-tdt-0.6b-v3-int8".to_string(),
                api_key: None,
                language: Some("es-419".to_string()),
            }
        }
    };

    // Initialize the appropriate engine based on provider
    match config.provider.as_str() {
        "parakeet" => {
            info!("🦜 Initializing Parakeet transcription engine");

            // Get Parakeet engine
            let engine = {
                let guard = crate::parakeet_engine::commands::PARAKEET_ENGINE
                    .lock()
                    .map_err(|e| format!("Parakeet engine mutex poisoned: {}", e))?;
                guard.as_ref().cloned()
            };

            match engine {
                Some(engine) => {
                    // Check if model is loaded
                    if engine.is_model_loaded().await {
                        let model_name = engine.get_current_model().await
                            .unwrap_or_else(|| "unknown".to_string());
                        info!("✅ Parakeet model '{}' already loaded", model_name);
                        Ok(TranscriptionEngine::Parakeet(engine))
                    } else {
                        Err("Parakeet engine initialized but no model loaded. This should not happen after validation.".to_string())
                    }
                }
                None => {
                    Err("Parakeet engine not initialized. This should not happen after validation.".to_string())
                }
            }
        }
        "canary" => {
            info!("🐤 Initializing Canary transcription engine");

            let engine = {
                let guard = crate::canary_engine::commands::CANARY_ENGINE
                    .lock()
                    .map_err(|e| format!("Canary engine mutex poisoned: {}", e))?;
                guard.as_ref().cloned()
            };

            match engine {
                Some(engine) => {
                    if engine.is_model_loaded().await {
                        let model_name = engine.get_current_model().await
                            .unwrap_or_else(|| "unknown".to_string());
                        info!("✅ Canary model '{}' already loaded", model_name);
                        // Vía trait TranscriptionProvider: el worker le pasa language
                        // (Canary SÍ acepta idioma forzado: es/en/de/fr).
                        Ok(TranscriptionEngine::Provider(std::sync::Arc::new(
                            crate::audio::transcription::canary_provider::CanaryProvider::new(engine),
                        )))
                    } else {
                        Err("Canary engine initialized but no model loaded. This should not happen after validation.".to_string())
                    }
                }
                None => {
                    Err("Canary engine not initialized. This should not happen after validation.".to_string())
                }
            }
        }
        "moonshine" => {
            info!("🌙 Initializing Moonshine transcription engine");

            // Get Moonshine engine
            let engine = {
                let guard = crate::moonshine_engine::commands::MOONSHINE_ENGINE
                    .lock()
                    .map_err(|e| format!("Moonshine engine mutex poisoned: {}", e))?;
                guard.as_ref().cloned()
            };

            match engine {
                Some(engine) => {
                    // Check if model is loaded
                    if engine.is_model_loaded().await {
                        let model_name = engine.get_current_model().await
                            .unwrap_or_else(|| "unknown".to_string());
                        info!("✅ Moonshine model '{}' already loaded", model_name);
                        Ok(TranscriptionEngine::Moonshine(engine))
                    } else {
                        Err("Moonshine engine initialized but no model loaded. This should not happen after validation.".to_string())
                    }
                }
                None => {
                    Err("Moonshine engine not initialized. This should not happen after validation.".to_string())
                }
            }
        }
        "deepgram" => {
            info!("Initializing Deepgram cloud transcription engine (dual persistent streaming via proxy)");
            println!("[ENGINE] Initializing Deepgram dual persistent streaming engine via proxy (mic + sys)");

            // Get proxy config from cache (should have been set by frontend before starting recording)
            let proxy_config = super::deepgram_commands::get_cached_proxy_config();

            match proxy_config {
                Some((proxy_base_url, jwt)) => {
                    info!("Deepgram proxy config found");

                    // Apply model from config if specified, otherwise use nova-3
                    let model = if !config.model.is_empty() && config.model != "deepgram" {
                        config.model.clone()
                    } else {
                        "nova-3".to_string()
                    };

                    // Apply language from config, default to es-419 (Latin American Spanish)
                    let language = config.language
                        .clone()
                        .filter(|l| !l.is_empty())
                        .unwrap_or_else(|| "es-419".to_string());

                    info!("Setting Deepgram model={}, language={}", model, language);

                    // Create TWO Deepgram instances: one for mic, one for system audio
                    let mut mic_dg = DeepgramRealtimeTranscriber::with_proxy(proxy_base_url.clone(), jwt.clone());
                    mic_dg.set_source_label("user".to_string());
                    mic_dg.set_model(model.clone());
                    mic_dg.set_language(language.clone());

                    let mut sys_dg = DeepgramRealtimeTranscriber::with_proxy(proxy_base_url, jwt);
                    sys_dg.set_source_label("interlocutor".to_string());
                    sys_dg.set_model(model.clone());
                    sys_dg.set_language(language);

                    let mic_arc = Arc::new(mic_dg);
                    let sys_arc = Arc::new(sys_dg);

                    // Set up event emitters for both instances
                    let app_for_mic = app.clone();
                    mic_arc.set_event_emitter(move |update: super::worker::TranscriptUpdate| {
                        use tauri::Emitter;
                        let speech_flag = &super::worker::SPEECH_DETECTED_EMITTED;
                        if !speech_flag.load(std::sync::atomic::Ordering::SeqCst) {
                            speech_flag.store(true, std::sync::atomic::Ordering::SeqCst);
                            let _ = app_for_mic.emit(events::SPEECH_DETECTED, serde_json::json!({
                                "message": "Speech activity detected"
                            }));
                        }
                        match app_for_mic.emit(events::TRANSCRIPT_UPDATE, &update) {
                            Ok(_) => {
                                println!("[DEEPGRAM-MIC] transcript-update emitted: seq={}, partial={}, source={:?}",
                                    update.sequence_id, update.is_partial, update.source_type);
                            }
                            Err(e) => {
                                log::error!("Failed to emit transcript-update from Deepgram mic reader: {}", e);
                            }
                        }
                    }).await;

                    let app_for_sys = app.clone();
                    sys_arc.set_event_emitter(move |update: super::worker::TranscriptUpdate| {
                        use tauri::Emitter;
                        let speech_flag = &super::worker::SPEECH_DETECTED_EMITTED;
                        if !speech_flag.load(std::sync::atomic::Ordering::SeqCst) {
                            speech_flag.store(true, std::sync::atomic::Ordering::SeqCst);
                            let _ = app_for_sys.emit(events::SPEECH_DETECTED, serde_json::json!({
                                "message": "Speech activity detected"
                            }));
                        }
                        match app_for_sys.emit(events::TRANSCRIPT_UPDATE, &update) {
                            Ok(_) => {
                                println!("[DEEPGRAM-SYS] transcript-update emitted: seq={}, partial={}, source={:?}",
                                    update.sequence_id, update.is_partial, update.source_type);
                            }
                            Err(e) => {
                                log::error!("Failed to emit transcript-update from Deepgram sys reader: {}", e);
                            }
                        }
                    }).await;

                    info!("Deepgram dual streaming initialized: mic (user) + sys (interlocutor) with model: {}", model);
                    println!("[ENGINE] Deepgram dual streaming ready with model: {}", model);

                    Ok(TranscriptionEngine::Deepgram { mic: mic_arc, sys: sys_arc })
                }
                None => {
                    error!("No Deepgram proxy config available");
                    Err(
                        "Configuración de Deepgram no disponible. Por favor asegúrate de estar autenticado con tu cuenta de Google.".to_string()
                    )
                }
            }
        }
        "localWhisper" | _ => {
            info!("🎤 Initializing Whisper transcription engine");
            let whisper_engine = get_or_init_whisper(app).await?;
            Ok(TranscriptionEngine::Whisper(whisper_engine))
        }
    }
}

/// Initialize Parakeet as fallback when cloud provider fails
#[allow(dead_code)]  // Reserved for Parakeet fallback functionality
async fn init_parakeet_fallback() -> Result<TranscriptionEngine, String> {
    info!("🦜 Falling back to Parakeet transcription engine");

    let engine = {
        let guard = crate::parakeet_engine::commands::PARAKEET_ENGINE
            .lock()
            .map_err(|e| format!("Parakeet engine mutex poisoned: {}", e))?;
        guard.as_ref().cloned()
    };

    match engine {
        Some(engine) => {
            if engine.is_model_loaded().await {
                let model_name = engine.get_current_model().await
                    .unwrap_or_else(|| "unknown".to_string());
                info!("✅ Parakeet fallback model '{}' loaded", model_name);
                Ok(TranscriptionEngine::Parakeet(engine))
            } else {
                Err("Parakeet engine initialized but no model loaded for fallback.".to_string())
            }
        }
        None => {
            Err("Parakeet engine not available for fallback. Please ensure a local transcription model is downloaded.".to_string())
        }
    }
}

/// Get or initialize transcription engine using API configuration
/// Returns Whisper engine if provider is localWhisper, otherwise returns error for non-Whisper providers
pub async fn get_or_init_whisper<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<Arc<crate::whisper_engine::WhisperEngine>, String> {
    // Check if engine already exists and has a model loaded
    let existing_engine = {
        let engine_guard = crate::whisper_engine::commands::WHISPER_ENGINE
            .lock()
            .map_err(|e| format!("Whisper engine mutex poisoned: {}", e))?;
        engine_guard.as_ref().cloned()
    };

    if let Some(engine) = existing_engine {
        // Check if a model is already loaded
        if engine.is_model_loaded().await {
            let current_model = engine
                .get_current_model()
                .await
                .unwrap_or_else(|| "unknown".to_string());

            // NEW: Check if loaded model matches saved config
            let configured_model = match crate::api::api_get_transcript_config(
                app.clone(),
                app.clone().state(), // state-allow: pre-existing, refactor in separate PR
                None,
            )
            .await
            {
                Ok(Some(config)) => {
                    info!(
                        "📝 Saved transcript config - provider: {}, model: {}",
                        config.provider, config.model
                    );
                    if config.provider == "localWhisper" && !config.model.is_empty() {
                        Some(config.model)
                    } else {
                        None
                    }
                }
                Ok(None) => {
                    info!("📝 No transcript config found in database");
                    None
                }
                Err(e) => {
                    warn!("⚠️ Failed to get transcript config: {}", e);
                    None
                }
            };

            // If loaded model matches config, reuse it
            if let Some(ref expected_model) = configured_model {
                if current_model == *expected_model {
                    info!(
                        "✅ Loaded model '{}' matches saved config, reusing",
                        current_model
                    );
                    return Ok(engine);
                } else {
                    info!(
                        "🔄 Loaded model '{}' doesn't match saved config '{}', reloading correct model...",
                        current_model, expected_model
                    );
                    // Unload the incorrect model
                    engine.unload_model().await;
                    info!("📉 Unloaded incorrect model '{}'", current_model);
                    // Continue to model loading logic below
                }
            } else {
                // No specific config saved, accept currently loaded model
                info!(
                    "✅ No specific model configured, using currently loaded model: '{}'",
                    current_model
                );
                return Ok(engine);
            }
        } else {
            info!("🔄 Whisper engine exists but no model loaded, will load model from config");
        }
    }

    // Initialize new engine if needed
    info!("Initializing Whisper engine");

    // First ensure the engine is initialized
    if let Err(e) = crate::whisper_engine::commands::whisper_init().await {
        return Err(format!("Failed to initialize Whisper engine: {}", e));
    }

    // Get the engine reference
    let engine = {
        let engine_guard = crate::whisper_engine::commands::WHISPER_ENGINE
            .lock()
            .map_err(|e| format!("Whisper engine mutex poisoned: {}", e))?;
        engine_guard
            .as_ref()
            .cloned()
            .ok_or("Failed to get initialized engine")?
    };

    // Get model configuration from API
    let model_to_load =
        match crate::api::api_get_transcript_config(app.clone(), app.clone().state(), None) // state-allow: pre-existing, refactor in separate PR
            .await
        {
            Ok(Some(config)) => {
                info!(
                    "Got transcript config from API - provider: {}, model: {}",
                    config.provider, config.model
                );
                if config.provider == "localWhisper" {
                    info!("Using model from API config: {}", config.model);
                    config.model
                } else {
                    // Non-Whisper provider (e.g., parakeet) - this function shouldn't be called
                    return Err(format!(
                        "Cannot initialize Whisper engine: Config uses '{}' provider. This is a bug in the transcription task initialization.",
                        config.provider
                    ));
                }
            }
            Ok(None) => {
                info!("No transcript config found in API, falling back to 'small'");
                "small".to_string()
            }
            Err(e) => {
                warn!(
                    "Failed to get transcript config from API: {}, falling back to 'small'",
                    e
                );
                "small".to_string()
            }
        };

    info!("Selected model to load: {}", model_to_load);

    // Discover available models to check if the desired model is downloaded
    let models = engine
        .discover_models()
        .await
        .map_err(|e| format!("Failed to discover models: {}", e))?;

    info!("Discovered {} models", models.len());
    for model in &models {
        info!(
            "Model: {} - Status: {:?} - Path: {}",
            model.name,
            model.status,
            model.path.display()
        );
    }

    // Check if the desired model is available
    let model_info = models.iter().find(|model| model.name == model_to_load);

    if model_info.is_none() {
        info!(
            "Model '{}' not found in discovered models. Available models: {:?}",
            model_to_load,
            models.iter().map(|m| &m.name).collect::<Vec<_>>()
        );
    }

    match model_info {
        Some(model) => {
            match model.status {
                crate::whisper_engine::ModelStatus::Available => {
                    info!("Loading model: {}", model_to_load);
                    engine
                        .load_model(&model_to_load)
                        .await
                        .map_err(|e| format!("Failed to load model '{}': {}", model_to_load, e))?;
                    info!("✅ Model '{}' loaded successfully", model_to_load);
                }
                crate::whisper_engine::ModelStatus::Missing => {
                    return Err(format!(
                        "Model '{}' is not downloaded. Please download it first from the settings.",
                        model_to_load
                    ));
                }
                crate::whisper_engine::ModelStatus::Downloading { progress } => {
                    return Err(format!("Model '{}' is currently downloading ({}%). Please wait for it to complete.", model_to_load, progress));
                }
                crate::whisper_engine::ModelStatus::Error(ref err) => {
                    return Err(format!("Model '{}' has an error: {}. Please check the model or try downloading it again.", model_to_load, err));
                }
                crate::whisper_engine::ModelStatus::Corrupted { .. } => {
                    return Err(format!("Model '{}' is corrupted. Please delete it and download again from the settings.", model_to_load));
                }
            }
        }
        None => {
            // Check if we have any available models and try to load the first one
            let available_models: Vec<_> = models
                .iter()
                .filter(|m| matches!(m.status, crate::whisper_engine::ModelStatus::Available))
                .collect();

            if let Some(fallback_model) = available_models.first() {
                warn!(
                    "Model '{}' not found, falling back to available model: '{}'",
                    model_to_load, fallback_model.name
                );
                engine.load_model(&fallback_model.name).await.map_err(|e| {
                    format!(
                        "Failed to load fallback model '{}': {}",
                        fallback_model.name, e
                    )
                })?;
                info!(
                    "✅ Fallback model '{}' loaded successfully",
                    fallback_model.name
                );
            } else {
                return Err(format!("Model '{}' is not supported and no other models are available. Please download a model from the settings.", model_to_load));
            }
        }
    }

    Ok(engine)
}
