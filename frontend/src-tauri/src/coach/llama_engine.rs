//! Utilidades del Coach IA: resolución de paths a modelos GGUF en disco
//! y mapeo de IDs entre el registry del coach y el sidecar Built-in AI.
//!
//! La generación LLM se hace vía `summary::llm_client::generate_summary`
//! con `LLMProvider::BuiltInAI`, que delega a `summary::summary_engine`
//! (singleton SidecarManager). Este módulo NO arranca procesos.

use super::model_registry;
use std::path::PathBuf;
use tauri::{Manager, Runtime};

/// Resuelve la ruta del archivo .gguf de un modelo del registry coach.
/// Busca primero en `models/llm/` (descargas del coach), después en
/// `models/summary/` (descargas del sidecar Built-in AI). Esto permite
/// reusar modelos ya descargados por el onboarding sin duplicar 1-3 GB.
pub fn model_file_path<R: Runtime>(app: &tauri::AppHandle<R>, model_id: &str) -> Option<PathBuf> {
    let def = model_registry::get_model(model_id)?;
    let base = app.path().app_data_dir().ok()?;
    let llm_path = base.join("models").join("llm").join(def.filename);
    if llm_path.exists() {
        return Some(llm_path);
    }
    let summary_path = base.join("models").join("summary").join(def.filename);
    if summary_path.exists() {
        return Some(summary_path);
    }
    Some(llm_path)
}

pub fn is_model_installed<R: Runtime>(app: &tauri::AppHandle<R>, model_id: &str) -> bool {
    model_file_path(app, model_id)
        .map(|p| p.exists())
        .unwrap_or(false)
}

/// Mapea IDs del registry del coach al naming del sidecar Built-in AI.
/// El coach usa "gemma3-4b-q4" (nombre del archivo GGUF), el sidecar usa
/// "gemma3:4b" (formato familia:variante de `summary_engine::models`).
pub fn map_to_builtin_id(coach_id: &str) -> &str {
    match coach_id {
        "gemma3-1b-q8" => "gemma3:1b",
        "gemma3-4b-q4" => "gemma3:4b",
        other => other,
    }
}
