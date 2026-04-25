//! Comandos Tauri para el orquestador.
//!
//! `analyze_meeting_context` recibe segmentos de transcripción del frontend
//! y devuelve los outputs del pipeline de análisis local.

use super::context_analyzer::{KeyMomentsStage, MeetingTypeHintStage, TalkRatioStage};
use super::{OrchestratorContext, OrchestratorSegment, Pipeline, StageOutput};

#[tauri::command]
pub async fn analyze_meeting_context(
    segments: Vec<OrchestratorSegment>,
    language: Option<String>,
) -> Result<Vec<StageOutput>, String> {
    let lang = language.unwrap_or_else(|| "es".to_string());
    let ctx = OrchestratorContext {
        segments: &segments,
        language: &lang,
    };
    let pipeline = Pipeline::new()
        .with_stage(TalkRatioStage)
        .with_stage(MeetingTypeHintStage)
        .with_stage(KeyMomentsStage::default());
    Ok(pipeline.run(&ctx))
}
