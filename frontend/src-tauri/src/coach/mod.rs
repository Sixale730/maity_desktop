//! Módulo coach — feedback en vivo y evaluación post-reunión con Ollama.

pub mod breaker;
pub mod commands;
pub mod context;
pub mod evaluator;
pub mod live_feedback;
pub mod llama_engine;
pub mod llm_helper;
pub mod llm_service;
pub mod model_registry;
pub mod nudge_engine;
pub mod prompt;
pub mod setup;
pub mod trigger;

pub use commands::{
    close_floating_coach, coach_download_gguf_model, coach_evaluate_meeting,
    coach_float_get_visibility_pref, coach_float_request_start, coach_float_set_visibility_pref,
    coach_float_stop_recording, coach_get_models, coach_get_status, coach_list_gguf_models,
    coach_set_model_for_purpose, coach_suggest, coach_switch_model, floating_toggle_compact,
    is_coach_float_open, open_floating_coach,
};
pub use nudge_engine::coach_evaluate_nudge;
pub use trigger::coach_analyze_trigger;

pub mod audio_heuristics;

use std::sync::Arc;

use crate::audio::recording_preferences::TranscriptionMode;
use crate::audio::recording_state::RecordingState;
use crate::audio::voice_activity::VoiceActivityStats;

/// De qué se alimenta el coach en vivo (F5 de la migración a lote).
///
/// - `Transcript`: el pipeline histórico — listener de `transcript-update`,
///   nudges, tips heurísticos por turnos y (si el tier lo permite) tips LLM.
/// - `Audio`: modo LOTE — no hay transcripción durante la grabación, así que
///   el coach lee el rastreador de voz por canal (`audio/voice_activity.rs`):
///   tiempo de palabra por ms de voz, monólogo por racha, dos tips
///   heurísticos (`coach/audio_heuristics.rs`) y **nunca** LLM ni sidecar.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CoachMode {
    Transcript,
    Audio,
}

impl CoachMode {
    /// Etiqueta de telemetría (`coach.session_summary.coach_mode`) y del
    /// evento `meeting-metrics.mode`.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Transcript => "transcript",
            Self::Audio => "audio",
        }
    }
}

impl From<TranscriptionMode> for CoachMode {
    fn from(mode: TranscriptionMode) -> Self {
        match mode {
            TranscriptionMode::Streaming => Self::Transcript,
            TranscriptionMode::Batch => Self::Audio,
        }
    }
}

/// Fuente concreta con la que arranca `live_feedback::start`. En `Audio`
/// lleva el `Arc` de estadísticas que escribe el pipeline (compartido, sin
/// lock) para que el coach no dependa de `RECORDING_MANAGER` en cada tick.
#[derive(Debug, Clone)]
pub enum CoachSource {
    Transcript,
    Audio(Arc<VoiceActivityStats>),
}

impl CoachSource {
    pub fn mode(&self) -> CoachMode {
        match self {
            Self::Transcript => CoachMode::Transcript,
            Self::Audio(_) => CoachMode::Audio,
        }
    }

    /// Deriva la fuente de la verdad SELLADA por sesión
    /// (`RecordingState::transcription_mode`, fijada en `initialize_recording`).
    pub fn from_recording(state: &RecordingState) -> Self {
        match state.transcription_mode() {
            TranscriptionMode::Batch => Self::Audio(Arc::clone(state.voice_activity())),
            TranscriptionMode::Streaming => Self::Transcript,
        }
    }
}

/// ¿Esta sesión debe usar el LLM local para los tips del coach?
///
/// `Audio` (modo lote) → `false` incondicional: no hay transcript que darle
/// al modelo, así que el sidecar no tiene consumidor. `Transcript` → `false`
/// en tier Low. Punto de decisión ÚNICO: lo consultan el warmup de arranque
/// (`lib.rs`, con el modo leído de las preferencias) y `live_feedback::start`
/// (con el modo sellado en `RecordingState`), que si divergieran dejarían el
/// modelo cargado en RAM sin nadie que lo use — el peor de los dos mundos.
///
/// **Por qué apagarlo y no sólo aplazarlo** (piloto Dingler, ago-2026): en dos
/// semanas y 7 equipos de gama baja, el LLM produjo **1 tip** contra 19
/// heurísticos, a cambio de 75 reinicios de sidecar, 28 timeouts, 26 aperturas
/// de circuit breaker y un p95 de 94 s. El helper pica en 1.2 GB justo cuando
/// Parakeet y FFmpeg más memoria necesitan: 215 avisos de presión de memoria,
/// con mínimos de 74 MB libres. No es una función degradada, es una que no
/// llega a ejecutarse y estorba.
///
/// Los tips heurísticos (`evaluate_health_tips`, tick de 3 s) y el gauge de
/// participación siguen intactos: el coach no se apaga, sólo su mitad cara.
///
/// **No se re-enciende al terminar la grabación.** El sidecar local no tiene
/// ningún otro consumidor vivo: Maity Chat corre en la nube, la minuta y el
/// análisis V4 también, y `coach_chat` / `coach_evaluate_meeting` /
/// `api_process_transcript` (el resumen local; su única ruta, `/meeting-details`,
/// se borró en sep-2026, #24 de la auditoría) no tienen call sites en el
/// frontend. Ver docs/COACH_LLM_ARCHITECTURE.md § Apéndice.
pub fn should_use_llm_tips(mode: CoachMode) -> bool {
    use crate::audio::hardware_detector::{HardwareProfile, PerformanceTier};
    match mode {
        CoachMode::Audio => false,
        CoachMode::Transcript => HardwareProfile::detect().performance_tier != PerformanceTier::Low,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::hardware_detector::{HardwareProfile, PerformanceTier};

    #[test]
    fn audio_nunca_usa_llm() {
        // Independiente del tier de la máquina que corre el test.
        assert!(!should_use_llm_tips(CoachMode::Audio));
        assert_eq!(CoachMode::Audio.as_str(), "audio");
    }

    #[test]
    fn transcript_sigue_la_regla_de_tier() {
        let expected = HardwareProfile::detect().performance_tier != PerformanceTier::Low;
        assert_eq!(should_use_llm_tips(CoachMode::Transcript), expected);
        assert_eq!(CoachMode::Transcript.as_str(), "transcript");
    }

    #[test]
    fn coach_mode_desde_transcription_mode() {
        assert_eq!(CoachMode::from(TranscriptionMode::Streaming), CoachMode::Transcript);
        assert_eq!(CoachMode::from(TranscriptionMode::Batch), CoachMode::Audio);
    }

    #[test]
    fn coach_source_desde_el_estado_sellado() {
        let state = RecordingState::new();
        assert_eq!(CoachSource::from_recording(&state).mode(), CoachMode::Transcript);
        state.set_transcription_mode(TranscriptionMode::Batch);
        let source = CoachSource::from_recording(&state);
        assert_eq!(source.mode(), CoachMode::Audio);
        // El Arc es EL de la sesión, no una copia: lo que escriba el pipeline lo ve el coach.
        if let CoachSource::Audio(stats) = source {
            assert!(Arc::ptr_eq(&stats, state.voice_activity()));
        }
    }
}
