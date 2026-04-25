//! Eventos de progreso en vivo para transparencia de procesos LLM y pipeline.
//!
//! Patrón inspirado en VideoDB Director: el reasoning loop emite updates
//! granulares al frontend para que la UI muestre estados intermedios
//! (analizando, generando, etc) en lugar de "loading..." opaco.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Runtime};

/// Etapas del Coach IA mientras procesa una sugerencia.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CoachStage {
    Analyzing,
    Generating,
    Done,
    Error,
}

/// Payload del evento `coach-thinking`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoachThinkingPayload {
    pub stage: CoachStage,
    pub elapsed_ms: u64,
    /// Modelo en uso (ej. "phi3.5:3.8b-mini-instruct-q4_K_M").
    pub model: String,
}

/// Payload del evento `summary-progress`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SummaryProgressPayload {
    pub stage: String,
    pub percent: f32,
    pub current_chunk: u32,
    pub total_chunks: u32,
}

/// Payload del evento `transcription-stalled`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptionStalledPayload {
    pub provider: String,
    pub last_chunk_ago_ms: u64,
    pub queue_size: u32,
}

/// Emite `coach-thinking` al frontend. Errores se loggean pero no propagan
/// (la telemetría no debe romper el flujo principal).
pub fn emit_coach_thinking<R: Runtime>(
    app: &AppHandle<R>,
    stage: CoachStage,
    elapsed_ms: u64,
    model: &str,
) {
    let payload = CoachThinkingPayload {
        stage,
        elapsed_ms,
        model: model.to_string(),
    };
    if let Err(e) = app.emit("coach-thinking", payload) {
        log::warn!("emit coach-thinking failed: {}", e);
    }
}

/// Emite `summary-progress` al frontend.
pub fn emit_summary_progress<R: Runtime>(
    app: &AppHandle<R>,
    stage: &str,
    percent: f32,
    current_chunk: u32,
    total_chunks: u32,
) {
    let payload = SummaryProgressPayload {
        stage: stage.to_string(),
        percent: percent.clamp(0.0, 1.0),
        current_chunk,
        total_chunks,
    };
    if let Err(e) = app.emit("summary-progress", payload) {
        log::warn!("emit summary-progress failed: {}", e);
    }
}

/// Emite `transcription-stalled` al frontend.
pub fn emit_transcription_stalled<R: Runtime>(
    app: &AppHandle<R>,
    provider: &str,
    last_chunk_ago_ms: u64,
    queue_size: u32,
) {
    let payload = TranscriptionStalledPayload {
        provider: provider.to_string(),
        last_chunk_ago_ms,
        queue_size,
    };
    if let Err(e) = app.emit("transcription-stalled", payload) {
        log::warn!("emit transcription-stalled failed: {}", e);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coach_thinking_payload_serializes_to_camel_lowercase_stage() {
        let p = CoachThinkingPayload {
            stage: CoachStage::Analyzing,
            elapsed_ms: 1234,
            model: "phi3.5".to_string(),
        };
        let json = serde_json::to_string(&p).unwrap();
        assert!(json.contains("\"stage\":\"analyzing\""), "got: {}", json);
        assert!(json.contains("\"elapsed_ms\":1234"));
        assert!(json.contains("\"model\":\"phi3.5\""));
    }

    #[test]
    fn coach_stage_done_serializes_lowercase() {
        let p = CoachThinkingPayload {
            stage: CoachStage::Done,
            elapsed_ms: 0,
            model: "x".to_string(),
        };
        let json = serde_json::to_string(&p).unwrap();
        assert!(json.contains("\"stage\":\"done\""));
    }

    #[test]
    fn summary_progress_payload_clamps_percent() {
        let p = SummaryProgressPayload {
            stage: "rendering".to_string(),
            percent: 0.42,
            current_chunk: 2,
            total_chunks: 5,
        };
        let json = serde_json::to_string(&p).unwrap();
        assert!(json.contains("\"percent\":0.42"));
        assert!(json.contains("\"current_chunk\":2"));
        assert!(json.contains("\"total_chunks\":5"));
    }

    #[test]
    fn transcription_stalled_payload_serializes() {
        let p = TranscriptionStalledPayload {
            provider: "parakeet".to_string(),
            last_chunk_ago_ms: 6500,
            queue_size: 12,
        };
        let json = serde_json::to_string(&p).unwrap();
        assert!(json.contains("\"provider\":\"parakeet\""));
        assert!(json.contains("\"last_chunk_ago_ms\":6500"));
        assert!(json.contains("\"queue_size\":12"));
    }

    #[test]
    fn coach_stage_round_trip_through_json() {
        for stage in [
            CoachStage::Analyzing,
            CoachStage::Generating,
            CoachStage::Done,
            CoachStage::Error,
        ] {
            let p = CoachThinkingPayload {
                stage,
                elapsed_ms: 1,
                model: "m".to_string(),
            };
            let s = serde_json::to_string(&p).unwrap();
            let back: CoachThinkingPayload = serde_json::from_str(&s).unwrap();
            assert_eq!(back.elapsed_ms, 1);
        }
    }
}
