//! Evaluador de comunicación post-llamada.
//!
//! Toma la transcripción completa al cerrar una reunión y devuelve métricas
//! 0-10 (clarity, engagement, structure, overall) más fortalezas y áreas
//! de mejora. Reusa `summary::llm_client::generate_summary`.
//!
//! Adoptado de `D:/Maity_Desktop/summary/communication_evaluator.rs` —
//! adaptado al proyecto: provider FIJO Ollama (privacidad), parser tolerante,
//! tests unitarios.

use crate::summary::llm_client::{generate_summary, LLMProvider};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

/// Observaciones detalladas por categoría.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CommunicationObservations {
    pub clarity: Option<String>,
    pub structure: Option<String>,
    pub objections: Option<String>,
    pub calls_to_action: Option<String>,
}

/// Feedback completo de comunicación con scores 0-10 + análisis.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CommunicationFeedback {
    pub overall_score: Option<f32>,
    pub clarity: Option<f32>,
    pub engagement: Option<f32>,
    pub structure: Option<f32>,
    pub feedback: Option<String>,
    pub summary: Option<String>,
    pub strengths: Option<Vec<String>>,
    pub areas_to_improve: Option<Vec<String>>,
    pub observations: Option<CommunicationObservations>,
    /// Modelo y latencia para A/B testing
    pub model: Option<String>,
    pub latency_ms: Option<u64>,
}

const EVALUATION_SYSTEM_PROMPT: &str = r#"Eres un coach de comunicación profesional. Analiza la transcripción de una reunión y evalúa las habilidades de comunicación del usuario (identificado como "USUARIO" o "user" — el hablante del micrófono).

MÉTRICAS (escala 0-10, decimales permitidos):
- clarity: qué tan claro y comprensible es el mensaje del usuario
- engagement: qué tan participativo e involucrado está
- structure: qué tan organizado es el discurso
- overall_score: puntuación general

REGLAS ESTRICTAS:
1. Responde ÚNICAMENTE con JSON válido, sin markdown, sin texto antes ni después.
2. Sé específico y constructivo. Cita comportamientos OBSERVABLES en la transcripción.
3. NO inventes datos. Si no hay suficiente material para una métrica, déjala en null.
4. strengths y areas_to_improve: 2-4 elementos cada uno, MAX 15 palabras cada uno.
5. feedback: 1-2 oraciones de resumen accionable.

Formato exacto:
{
  "overall_score": 7.5,
  "clarity": 8.0,
  "engagement": 7.0,
  "structure": 7.5,
  "feedback": "Resumen breve y accionable",
  "strengths": ["Fortaleza 1", "Fortaleza 2"],
  "areas_to_improve": ["Área 1", "Área 2"],
  "observations": {
    "clarity": "Observación específica",
    "structure": "Observación específica",
    "objections": "Cómo manejó objeciones",
    "calls_to_action": "Análisis de cierres y propuestas"
  }
}"#;

/// Evalúa la comunicación del usuario en una transcripción completa.
///
/// **Privacidad**: solo usa Ollama (igual que `coach_suggest`).
#[tauri::command]
pub async fn coach_evaluate_communication(
    transcript: String,
    model: Option<String>,
) -> Result<CommunicationFeedback, String> {
    if transcript.trim().len() < 50 {
        return Err("Transcripción demasiado corta para evaluar (min 50 caracteres)".to_string());
    }

    let model_to_use = model.unwrap_or_else(|| {
        crate::coach::prompt::DEFAULT_MODEL.to_string()
    });

    let user_prompt = format!(
        "Analiza la siguiente transcripción de reunión y evalúa al USUARIO:\n\n<transcripcion>\n{}\n</transcripcion>\n\nResponde SOLO con el JSON.",
        transcript
    );

    let client = Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| format!("Error creando cliente HTTP: {}", e))?;

    let start = std::time::Instant::now();

    let raw = generate_summary(
        &client,
        &LLMProvider::Ollama,
        &model_to_use,
        "",
        EVALUATION_SYSTEM_PROMPT,
        &user_prompt,
        None,
        None,
        Some(800), // suficiente para feedback completo
        Some(0.3), // baja temperatura: queremos análisis consistente
        Some(0.95),
        None,
        None,
    )
    .await
    .map_err(|e| format!("Error LLM: {}", e))?;

    let latency_ms = start.elapsed().as_millis() as u64;

    let mut feedback = parse_evaluation_response(&raw)?;
    feedback.model = Some(model_to_use);
    feedback.latency_ms = Some(latency_ms);

    Ok(feedback)
}

/// Parsea la respuesta del LLM. Tolerante a markdown wrapping y ruido.
fn parse_evaluation_response(response: &str) -> Result<CommunicationFeedback, String> {
    let json_str = extract_json_from_response(response);

    serde_json::from_str::<CommunicationFeedback>(&json_str)
        .map_err(|e| format!("JSON inválido del evaluador: {} | raw: {}", e, json_str))
}

/// Extrae el primer bloque JSON entre `{` y `}`.
fn extract_json_from_response(response: &str) -> String {
    let trimmed = response.trim();
    if let (Some(start), Some(end)) = (trimmed.find('{'), trimmed.rfind('}')) {
        if start < end {
            return trimmed[start..=end].to_string();
        }
    }
    trimmed.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_json_simple() {
        let raw = r#"{"overall_score":7.5,"clarity":8.0}"#;
        assert_eq!(extract_json_from_response(raw), raw);
    }

    #[test]
    fn test_extract_json_con_ruido() {
        let raw = "Aquí va: {\"overall_score\":7.5} listo.";
        let json = extract_json_from_response(raw);
        assert!(json.starts_with('{'));
        assert!(json.ends_with('}'));
        assert!(json.contains("overall_score"));
    }

    #[test]
    fn test_extract_json_con_markdown() {
        let raw = "```json\n{\"overall_score\":7.5}\n```";
        let json = extract_json_from_response(raw);
        assert!(json.contains("overall_score"));
    }

    #[test]
    fn test_parse_feedback_completo() {
        let json = r#"{
            "overall_score": 7.5,
            "clarity": 8.0,
            "engagement": 7.0,
            "structure": 7.5,
            "feedback": "Buen ritmo y claridad",
            "strengths": ["Claro", "Empático"],
            "areas_to_improve": ["Cerrar con call to action"]
        }"#;
        let result = parse_evaluation_response(json).unwrap();
        assert_eq!(result.overall_score, Some(7.5));
        assert_eq!(result.clarity, Some(8.0));
        assert_eq!(result.strengths.unwrap().len(), 2);
    }

    #[test]
    fn test_parse_feedback_minimo() {
        // Todos los campos opcionales, solo overall_score
        let json = r#"{"overall_score":6.0}"#;
        let result = parse_evaluation_response(json).unwrap();
        assert_eq!(result.overall_score, Some(6.0));
        assert!(result.clarity.is_none());
    }

    #[test]
    fn test_parse_invalido() {
        assert!(parse_evaluation_response("texto sin json").is_err());
    }
}
