//! Módulo coach — feedback en vivo y evaluación post-reunión con Ollama.

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

/// ¿Este equipo debe usar el LLM local para los tips del coach?
///
/// `false` en tier Low. Punto de decisión ÚNICO: lo consultan el warmup de
/// arranque (`lib.rs`) y `live_feedback::start`, que si divergieran dejarían el
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
/// análisis V4 también, y `coach_chat` / `coach_evaluate_meeting` / el resumen
/// local de `/meeting-details` no tienen call sites en el frontend. Ver
/// CLAUDE.md § "Resumen built-in (Gemma)".
pub fn should_use_llm_tips() -> bool {
    use crate::audio::hardware_detector::{HardwareProfile, PerformanceTier};
    HardwareProfile::detect().performance_tier != PerformanceTier::Low
}
