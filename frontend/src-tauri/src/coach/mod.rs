//! Módulo coach — feedback en vivo y evaluación post-reunión con Ollama.

pub mod commands;
pub mod context;
pub mod evaluator;
pub mod live_feedback;
pub mod llama_engine;
pub mod model_registry;
pub mod nudge_engine;
pub mod prompt;
pub mod setup;
pub mod trigger;

pub use commands::{
    close_floating_coach, coach_download_gguf_model, coach_evaluate_meeting, coach_get_engine_status,
    coach_get_models, coach_get_status, coach_list_gguf_models, coach_set_model_for_purpose,
    coach_suggest, coach_switch_model, floating_toggle_compact, open_floating_coach,
};
pub use nudge_engine::coach_evaluate_nudge;
pub use trigger::coach_analyze_trigger;
