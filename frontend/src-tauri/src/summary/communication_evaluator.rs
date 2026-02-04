use crate::summary::communication_types::CommunicationFeedback;
use crate::summary::llm_client::{generate_summary, LLMProvider};
use reqwest::Client;
use std::path::PathBuf;
use tracing::{error, info, warn};

/// System prompt for communication evaluation
const EVALUATION_SYSTEM_PROMPT: &str = r#"Eres un coach de comunicación profesional. Tu tarea es analizar transcripciones de reuniones y evaluar las habilidades de comunicación del usuario (identificado como "user" o el hablante del micrófono).

MÉTRICAS (escala 0-10):
- clarity: Qué tan claro y comprensible es el mensaje del usuario
- engagement: Qué tan participativo e involucrado está el usuario
- structure: Qué tan organizado es el discurso del usuario
- overall_score: Puntuación general de comunicación

IMPORTANTE: Debes responder ÚNICAMENTE con un JSON válido, sin texto adicional antes o después.

El formato de respuesta debe ser exactamente:
{
  "overall_score": 7.5,
  "clarity": 8.0,
  "engagement": 7.0,
  "structure": 7.5,
  "feedback": "Resumen de una o dos oraciones sobre la comunicación del usuario...",
  "strengths": ["Fortaleza 1", "Fortaleza 2", "Fortaleza 3"],
  "areas_to_improve": ["Área de mejora 1", "Área de mejora 2"],
  "observations": {
    "clarity": "Observación específica sobre claridad del mensaje...",
    "structure": "Observación específica sobre estructura del discurso...",
    "objections": "Cómo manejó objeciones o preguntas difíciles...",
    "calls_to_action": "Análisis de las llamadas a la acción o propuestas..."
  }
}

Sé específico y constructivo en tu análisis. Enfócate en comportamientos observables en la transcripción."#;

/// Evaluates communication skills from a transcript
///
/// # Arguments
/// * `client` - Reqwest HTTP client
/// * `provider` - LLM provider to use
/// * `model_name` - Specific model name
/// * `api_key` - API key for the provider
/// * `transcript` - Full transcript text to analyze
/// * `ollama_endpoint` - Optional custom Ollama endpoint
/// * `custom_openai_endpoint` - Optional custom OpenAI endpoint
/// * `max_tokens` - Optional max tokens for CustomOpenAI
/// * `temperature` - Optional temperature for CustomOpenAI
/// * `top_p` - Optional top_p for CustomOpenAI
/// * `app_data_dir` - Optional app data directory for BuiltInAI
///
/// # Returns
/// Communication feedback with scores and analysis
pub async fn evaluate_communication(
    client: &Client,
    provider: &LLMProvider,
    model_name: &str,
    api_key: &str,
    transcript: &str,
    ollama_endpoint: Option<&str>,
    custom_openai_endpoint: Option<&str>,
    max_tokens: Option<u32>,
    temperature: Option<f32>,
    top_p: Option<f32>,
    app_data_dir: Option<&PathBuf>,
) -> Result<CommunicationFeedback, String> {
    info!("Starting communication evaluation for transcript");

    // Build user prompt with transcript
    let user_prompt = format!(
        "Analiza la siguiente transcripción de reunión y evalúa las habilidades de comunicación del usuario:\n\n<transcripcion>\n{}\n</transcripcion>\n\nResponde ÚNICAMENTE con el JSON de evaluación.",
        transcript
    );

    // Call LLM with evaluation prompt
    let response = generate_summary(
        client,
        provider,
        model_name,
        api_key,
        EVALUATION_SYSTEM_PROMPT,
        &user_prompt,
        ollama_endpoint,
        custom_openai_endpoint,
        max_tokens,
        temperature,
        top_p,
        app_data_dir,
        None, // No cancellation token for evaluation
    )
    .await?;

    info!("Communication evaluation LLM response received");

    // Parse JSON response
    parse_evaluation_response(&response)
}

/// Parses the LLM response into CommunicationFeedback
fn parse_evaluation_response(response: &str) -> Result<CommunicationFeedback, String> {
    // Try to extract JSON from response (LLM might include extra text)
    let json_str = extract_json_from_response(response);

    match serde_json::from_str::<CommunicationFeedback>(&json_str) {
        Ok(feedback) => {
            info!(
                "Successfully parsed communication feedback: overall_score={:?}",
                feedback.overall_score
            );
            Ok(feedback)
        }
        Err(e) => {
            warn!("Failed to parse communication feedback JSON: {}", e);
            warn!("Raw response: {}", response);

            // Try to create a minimal feedback from partial parsing
            create_fallback_feedback(response)
        }
    }
}

/// Extracts JSON object from response that might contain extra text
fn extract_json_from_response(response: &str) -> String {
    // Find the first '{' and last '}'
    if let (Some(start), Some(end)) = (response.find('{'), response.rfind('}')) {
        if start < end {
            return response[start..=end].to_string();
        }
    }
    response.to_string()
}

/// Creates a fallback feedback when JSON parsing fails
fn create_fallback_feedback(response: &str) -> Result<CommunicationFeedback, String> {
    // Try to extract some information from the text
    let mut feedback = CommunicationFeedback::default();

    // Look for numbers that might be scores (between 0 and 10)
    let score_regex = regex::Regex::new(r"(\d+\.?\d*)(/10|de 10)?").ok();

    if let Some(regex) = score_regex {
        let scores: Vec<f32> = regex
            .find_iter(response)
            .filter_map(|m| {
                let num_str = m.as_str().replace("/10", "").replace("de 10", "");
                num_str.trim().parse::<f32>().ok()
            })
            .filter(|&n| n >= 0.0 && n <= 10.0)
            .collect();

        if !scores.is_empty() {
            // Use first valid score as overall
            feedback.overall_score = Some(scores[0]);

            // Try to assign other scores if available
            if scores.len() > 1 {
                feedback.clarity = Some(scores.get(1).copied().unwrap_or(scores[0]));
            }
            if scores.len() > 2 {
                feedback.engagement = Some(scores.get(2).copied().unwrap_or(scores[0]));
            }
            if scores.len() > 3 {
                feedback.structure = Some(scores.get(3).copied().unwrap_or(scores[0]));
            }
        }
    }

    // Use the response as feedback text if we couldn't parse JSON
    if feedback.overall_score.is_none() {
        // No scores found, create minimal feedback
        feedback.feedback = Some("No se pudo generar una evaluación detallada. El texto de la transcripción fue analizado pero el formato de respuesta no fue válido.".to_string());
        feedback.overall_score = Some(5.0); // Default neutral score
        feedback.clarity = Some(5.0);
        feedback.engagement = Some(5.0);
        feedback.structure = Some(5.0);
    } else {
        feedback.feedback = Some("Evaluación parcial generada.".to_string());
    }

    Ok(feedback)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_json_from_response() {
        let response = r#"Here is the analysis:
{"overall_score": 7.5, "clarity": 8.0}
That's my evaluation."#;

        let json = extract_json_from_response(response);
        assert!(json.starts_with('{'));
        assert!(json.ends_with('}'));
        assert!(json.contains("overall_score"));
    }

    #[test]
    fn test_parse_valid_json() {
        let json = r#"{
            "overall_score": 7.5,
            "clarity": 8.0,
            "engagement": 7.0,
            "structure": 7.5,
            "feedback": "Good communication",
            "strengths": ["Clear", "Engaged"],
            "areas_to_improve": ["Structure"]
        }"#;

        let result = parse_evaluation_response(json);
        assert!(result.is_ok());
        let feedback = result.unwrap();
        assert_eq!(feedback.overall_score, Some(7.5));
        assert_eq!(feedback.clarity, Some(8.0));
    }
}
