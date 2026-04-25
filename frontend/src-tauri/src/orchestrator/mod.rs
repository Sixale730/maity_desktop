//! Orquestador de pipelines de análisis (Wave B3, inspirado en Director reasoning loop).
//!
//! Provee un patrón Stage/Pipeline para componer análisis sobre transcripciones
//! sin acoplarse al pipeline de audio. Cada Stage recibe un Context inmutable
//! con la transcripción + metadata, y produce un fragmento de resultado.
//!
//! Diferencia clave con Director:
//! - Director = reasoning sobre video, decide qué agente invocar
//! - Maity orchestrator = reasoning sobre transcripción de reunión
//!   para inferir tipo de reunión, balance de hablantes, momentos clave

use serde::{Deserialize, Serialize};
use std::time::Instant;

pub mod commands;
pub mod context_analyzer;

/// Segmento de transcripción consumido por los stages del orquestador.
/// Estructura mínima desacoplada del modelo SQL.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrchestratorSegment {
    pub text: String,
    /// "user" | "interlocutor" | otro
    pub source_type: Option<String>,
    /// Segundos relativos al inicio de la grabación.
    pub audio_start_time: f64,
    pub audio_end_time: f64,
}

/// Contexto inmutable que recorre los stages del pipeline.
#[derive(Debug, Clone)]
pub struct OrchestratorContext<'a> {
    pub segments: &'a [OrchestratorSegment],
    pub language: &'a str,
}

/// Resultado parcial producido por un stage.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StageOutput {
    pub stage: String,
    pub elapsed_ms: u64,
    pub data: serde_json::Value,
}

/// Trait que define un step del pipeline.
pub trait Stage: Send + Sync {
    fn name(&self) -> &str;
    fn run(&self, ctx: &OrchestratorContext) -> Result<serde_json::Value, String>;
}

/// Pipeline = secuencia ordenada de Stages. La ejecución es síncrona y secuencial:
/// los stages son CPU-bound y rápidos (heurística sobre texto, no LLM).
pub struct Pipeline {
    stages: Vec<Box<dyn Stage>>,
}

impl Pipeline {
    pub fn new() -> Self {
        Self { stages: Vec::new() }
    }

    pub fn with_stage<S: Stage + 'static>(mut self, stage: S) -> Self {
        self.stages.push(Box::new(stage));
        self
    }

    pub fn run(&self, ctx: &OrchestratorContext) -> Vec<StageOutput> {
        let mut outputs = Vec::with_capacity(self.stages.len());
        for stage in &self.stages {
            let start = Instant::now();
            let data = match stage.run(ctx) {
                Ok(v) => v,
                Err(e) => serde_json::json!({ "error": e }),
            };
            outputs.push(StageOutput {
                stage: stage.name().to_string(),
                elapsed_ms: start.elapsed().as_millis() as u64,
                data,
            });
        }
        outputs
    }
}

impl Default for Pipeline {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct EchoStage;
    impl Stage for EchoStage {
        fn name(&self) -> &str {
            "echo"
        }
        fn run(&self, ctx: &OrchestratorContext) -> Result<serde_json::Value, String> {
            Ok(serde_json::json!({ "count": ctx.segments.len() }))
        }
    }

    struct FailStage;
    impl Stage for FailStage {
        fn name(&self) -> &str {
            "fail"
        }
        fn run(&self, _ctx: &OrchestratorContext) -> Result<serde_json::Value, String> {
            Err("intentional".into())
        }
    }

    #[test]
    fn pipeline_runs_all_stages_in_order() {
        let segs = vec![
            OrchestratorSegment {
                text: "hola".into(),
                source_type: Some("user".into()),
                audio_start_time: 0.0,
                audio_end_time: 1.0,
            },
            OrchestratorSegment {
                text: "qué tal".into(),
                source_type: Some("interlocutor".into()),
                audio_start_time: 1.0,
                audio_end_time: 2.0,
            },
        ];
        let ctx = OrchestratorContext {
            segments: &segs,
            language: "es",
        };
        let pipeline = Pipeline::new().with_stage(EchoStage);
        let outputs = pipeline.run(&ctx);
        assert_eq!(outputs.len(), 1);
        assert_eq!(outputs[0].stage, "echo");
        assert_eq!(outputs[0].data["count"], 2);
    }

    #[test]
    fn pipeline_continues_after_stage_error() {
        let ctx = OrchestratorContext {
            segments: &[],
            language: "es",
        };
        let pipeline = Pipeline::new().with_stage(FailStage).with_stage(EchoStage);
        let outputs = pipeline.run(&ctx);
        assert_eq!(outputs.len(), 2);
        assert!(outputs[0].data["error"].is_string());
        assert_eq!(outputs[1].data["count"], 0);
    }
}
