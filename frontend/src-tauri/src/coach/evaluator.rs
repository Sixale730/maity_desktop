//! Evaluación post-reunión con llama.cpp (modelo eval, típicamente 12B).
//!
//! Analiza la transcripción completa y genera feedback de comunicación
//! detallado (métricas, fortalezas, áreas de mejora).

use crate::coach::context::{build_context, ContextMode};
use crate::coach::llama_engine;
use crate::state::AppState;
use crate::summary::llm_client::{generate_summary, LLMProvider};
use once_cell::sync::Lazy;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tracing::{info, warn};

static HTTP_CLIENT: Lazy<Client> = Lazy::new(Client::new);

const EVAL_SYSTEM_PROMPT: &str = r#"Eres Maity, coach de comunicación. Analiza la transcripción de la reunión y evalúa las habilidades del USUARIO (micrófono). Responde SIEMPRE en español con JSON exactamente en el formato indicado.

MÉTRICAS (escala 0-10):
- clarity: Claridad y comprensibilidad del mensaje
- engagement: Qué tan participativo e involucrado estuvo
- structure: Organización del discurso
- overall_score: Puntuación general

REGLAS:
- Evalúa SOLO al USUARIO (líneas "USUARIO:"), no al INTERLOCUTOR
- Sé constructivo y específico
- Si hay poca transcripción, sé honesto pero amable

Responde ÚNICAMENTE con este JSON, sin texto adicional:
{
  "overall_score": 7.5,
  "clarity": 8.0,
  "engagement": 7.0,
  "structure": 7.5,
  "feedback": "Resumen de 1-2 oraciones...",
  "strengths": ["Fortaleza 1", "Fortaleza 2"],
  "areas_to_improve": ["Mejora 1", "Mejora 2"],
  "observations": {
    "clarity": "Observación sobre claridad...",
    "structure": "Observación sobre estructura...",
    "objections": "Cómo manejó objeciones...",
    "calls_to_action": "Análisis de propuestas o cierres..."
  }
}"#;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoachEvalResult {
    pub overall_score: f32,
    pub clarity: f32,
    pub engagement: f32,
    pub structure: f32,
    pub feedback: String,
    pub strengths: Vec<String>,
    pub areas_to_improve: Vec<String>,
    pub observations: serde_json::Value,
    pub meeting_id: String,
}

async fn get_eval_model_id(pool: &SqlitePool) -> String {
    sqlx::query_scalar::<_, String>(
        "SELECT eval_model_id FROM coach_settings WHERE id = '1'",
    )
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .unwrap_or_else(|| "qwen25-7b-q4".to_string())
}

async fn get_tips_model_id(pool: &SqlitePool) -> String {
    sqlx::query_scalar::<_, String>(
        "SELECT tips_model_id FROM coach_settings WHERE id = '1'",
    )
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .unwrap_or_else(|| "qwen25-3b-q4".to_string())
}

/// Evalúa la comunicación del usuario para un meeting_id dado.
/// Devuelve el resultado JSON o un error descriptivo.
pub async fn evaluate_meeting<R: Runtime>(
    app: &AppHandle<R>,
    meeting_id: &str,
) -> Result<CoachEvalResult, String> {
    let state = app.state::<AppState>();
    let pool = state.db_manager.pool();

    // Leer transcripción completa
    let ctx = build_context(pool, meeting_id, ContextMode::Full).await?;
    if ctx.is_empty() {
        return Err("Sin transcripción para evaluar".to_string());
    }

    info!(
        "📊 Evaluando reunión {} ({} turnos, {} chars)",
        meeting_id, ctx.turn_count, ctx.char_count
    );

    let eval_model_id = get_eval_model_id(pool).await;
    let tips_model_id = get_tips_model_id(pool).await;

    // Si tips y eval son modelos distintos, usar puerto 11435 para no interrumpir tips en vivo
    let port: u16 = if eval_model_id == tips_model_id {
        11434
    } else {
        11435
    };

    let endpoint = llama_engine::ensure_running(app, &eval_model_id, port)
        .await
        .map_err(|e| format!("No se pudo iniciar el motor LLM para evaluación: {}", e))?;

    let user_prompt = format!(
        "Transcripción de la reunión:\n\n<transcripcion>\n{}\n</transcripcion>\n\nGenera la evaluación de comunicación del USUARIO.",
        ctx.formatted
    );

    // El parámetro model es ignorado por llama-server (usa el modelo con el que arrancó)
    let raw = generate_summary(
        &HTTP_CLIENT,
        &LLMProvider::Ollama,
        "local",
        "",
        EVAL_SYSTEM_PROMPT,
        &user_prompt,
        Some(&endpoint),
        None,
        None,
        Some(0.2),
        None,
        None,
        None,
    )
    .await
    .map_err(|e| format!("Error llamando al motor LLM: {}", e))?;

    // Extraer JSON de la respuesta
    let json_str = extract_json(&raw)
        .ok_or_else(|| format!("Ollama no devolvió JSON válido: {}", &raw[..raw.len().min(200)]))?;

    let mut parsed: serde_json::Value =
        serde_json::from_str(&json_str).map_err(|e| format!("JSON inválido: {}", e))?;

    let result = CoachEvalResult {
        overall_score: parsed["overall_score"].as_f64().unwrap_or(5.0) as f32,
        clarity: parsed["clarity"].as_f64().unwrap_or(5.0) as f32,
        engagement: parsed["engagement"].as_f64().unwrap_or(5.0) as f32,
        structure: parsed["structure"].as_f64().unwrap_or(5.0) as f32,
        feedback: parsed["feedback"]
            .as_str()
            .unwrap_or("Sin feedback disponible")
            .to_string(),
        strengths: parsed["strengths"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default(),
        areas_to_improve: parsed["areas_to_improve"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default(),
        observations: parsed["observations"].take(),
        meeting_id: meeting_id.to_string(),
    };

    // Persistir en summary_processes si existe el registro
    if let Err(e) = save_eval_to_db(pool, meeting_id, &result).await {
        warn!("No se pudo guardar evaluación en DB: {}", e);
    }

    info!(
        "✅ Evaluación completa para {} (score={:.1})",
        meeting_id, result.overall_score
    );
    Ok(result)
}

async fn save_eval_to_db(
    pool: &SqlitePool,
    meeting_id: &str,
    result: &CoachEvalResult,
) -> Result<(), sqlx::Error> {
    let feedback_json = serde_json::to_value(result).unwrap_or(serde_json::Value::Null);

    sqlx::query(
        "UPDATE summary_processes
         SET result = json_set(COALESCE(result, '{}'), '$.coach_eval', json(?))
         WHERE meeting_id = ?",
    )
    .bind(feedback_json.to_string())
    .bind(meeting_id)
    .execute(pool)
    .await?;

    Ok(())
}

fn extract_json(text: &str) -> Option<String> {
    let text = text.trim();
    if text.starts_with('{') {
        return Some(text.to_string());
    }
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    if end > start {
        Some(text[start..=end].to_string())
    } else {
        None
    }
}
