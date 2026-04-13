//! Módulo Coach — Copiloto IA en tiempo real para reuniones.
//!
//! Recibe ventanas de transcripción acumulada y genera sugerencias cortas
//! (1-2 oraciones) accionables para el usuario durante la conversación.
//!
//! 100% local: solo proveedor Ollama permitido. Reusa `summary::llm_client`.

pub mod chat;
pub mod commands;
pub mod context;
pub mod evaluator;
pub mod meeting_type;
pub mod prompt;
pub mod trigger;
#[cfg(test)]
mod stress_tests;

pub use chat::{coach_chat, ChatResponse};
pub use commands::{
    coach_get_status, coach_set_model, coach_suggest, CoachStatus, CoachSuggestion,
};
pub use context::{build_context, CoachContext, ContextMode};
pub use evaluator::{
    coach_evaluate_communication, CommunicationFeedback, CommunicationObservations,
};
pub use trigger::{analyze_turn, coach_analyze_trigger, TriggerCategory, TriggerSignal};
