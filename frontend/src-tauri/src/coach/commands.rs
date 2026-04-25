//! Comandos Tauri del copiloto IA.
//!
//! Reusa `summary::llm_client::generate_summary` con un system prompt
//! especializado en sales coaching. SOLO permite proveedor Ollama (privacidad).

use crate::coach::context::{build_context, ContextMode};
use crate::coach::prompt::{
    build_user_prompt_v3, DEFAULT_MODEL, MAITY_COPILOTO_V3_LITE_PROMPT, MeetingType,
};
use crate::summary::llm_client::{generate_summary, LLMProvider};
use crate::validation_helpers;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::Manager;

/// Modelo activo (mutable, defaulteado a Phi-3.5).
pub static CURRENT_MODEL: LazyLock<Mutex<String>> =
    LazyLock::new(|| Mutex::new(DEFAULT_MODEL.to_string()));

/// Latencia del último request (ms). 0 = aún no medido.
static LAST_LATENCY_MS: AtomicU64 = AtomicU64::new(0);

/// Shared HTTP client for Ollama requests (eliminates cold-start per-request overhead).
/// HTTP client compartido entre coach_suggest y coach_chat.
/// Timeout 60s para chat (respuestas más largas); pool reutiliza conexiones TCP
/// a localhost:11434 → elimina 20-50ms de setup por request.
pub static SHARED_CLIENT: LazyLock<Client> = LazyLock::new(|| {
    Client::builder()
        .timeout(Duration::from_secs(60))
        .pool_max_idle_per_host(4)
        .build()
        .expect("Failed to create shared HTTP client for Ollama")
});

/// Get current model without locking (for startup warm-up).
pub fn get_current_model() -> Result<String, String> {
    CURRENT_MODEL
        .lock()
        .map(|g| g.clone())
        .map_err(|e| format!("Failed to get current model: {}", e))
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CoachSuggestion {
    pub tip: String,
    pub category: String,
    /// Subcategoría específica de la técnica (ej: "spin_problem_to_implication").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subcategory: Option<String>,
    /// Framework de origen (ej: "SPIN", "Chris Voss", "Cialdini").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub technique: Option<String>,
    /// Nivel de prioridad: "critical" | "important" | "soft".
    /// Se deriva de confidence si el LLM no la provee.
    #[serde(default = "default_priority")]
    pub priority: String,
    pub confidence: f32,
    /// V3.1: tipo de tip — "recognition"|"observation"|"corrective"|"introspective".
    /// Se infiere si el LLM no lo provee (fallback).
    #[serde(default = "default_tip_type")]
    pub tip_type: String,
    pub timestamp: i64,
    pub model: String,
    pub latency_ms: u64,
}

fn default_priority() -> String {
    "soft".to_string()
}

fn default_tip_type() -> String {
    "observation".to_string()
}

/// Infiere `tip_type` a partir del tip + priority + confidence cuando el LLM no lo provee.
///
/// Heurística:
/// - Empieza con "Excelente/Bien/Perfecto/Gran/Buen" → recognition
/// - Empieza con "¿" → introspective
/// - Empieza con "Noto/He notado/Observo" → observation
/// - priority in {critical, important} → corrective
/// - resto → observation
pub fn infer_tip_type(tip: &str, priority: &str) -> String {
    let trimmed = tip.trim_start();
    let lower = trimmed.to_lowercase();
    const RECOG: &[&str] = &[
        "excelente", "bien hecho", "perfecto", "gran ", "buen ", "increible",
        "muy bien", "genial",
    ];
    if RECOG.iter().any(|p| lower.starts_with(p)) {
        return "recognition".to_string();
    }
    if trimmed.starts_with('¿') || trimmed.starts_with('?') {
        return "introspective".to_string();
    }
    const OBS: &[&str] = &["noto", "he notado", "observo", "veo que"];
    if OBS.iter().any(|p| lower.starts_with(p)) {
        return "observation".to_string();
    }
    match priority {
        "critical" | "important" => "corrective".to_string(),
        _ => "observation".to_string(),
    }
}

#[derive(Debug, Serialize, Clone)]
pub struct CoachStatus {
    pub model: String,
    pub ollama_running: bool,
    pub last_latency_ms: u64,
}

/// Salida cruda esperada del LLM (JSON dentro del content).
#[derive(Debug, Deserialize)]
struct RawSuggestion {
    tip: String,
    category: String,
    /// V3.1 nuevo: tipo de tip (opcional, se infiere si falta).
    #[serde(default)]
    tip_type: Option<String>,
    #[serde(default)]
    subcategory: Option<String>,
    #[serde(default)]
    technique: Option<String>,
    #[serde(default)]
    priority: Option<String>,
    confidence: f32,
}

/// Genera una sugerencia de coaching v3.0 con 31 frameworks + routing explícito.
///
/// # Argumentos
/// * `window` - Transcripción en vivo (frontend `buildWindow()`)
/// * `role` - Rol del usuario (compat, no usado en v3)
/// * `language` - Idioma (compat, el prompt v3 responde en el idioma del contexto)
/// * `meeting_id` - Opcional: ID de la reunión activa (lee de DB si existe)
/// * `meeting_type` - Opcional: "sales" | "service" | "webinar" | "team_meeting" | "auto"
/// * `minute` - Minuto actual de la sesión (para timing awareness del prompt)
/// * `previous_tips` - Lista de tips ya dados (para evitar repetición)
/// * `suggested_category` - Pista del trigger detector (opcional)
#[tauri::command]
pub async fn coach_suggest(
    app: tauri::AppHandle,
    window: String,
    role: String,
    language: String,
    meeting_id: Option<String>,
    meeting_type: Option<String>,
    minute: Option<u32>,
    previous_tips: Option<Vec<String>>,
    suggested_category: Option<String>,
    trigger_signal: Option<String>,
) -> Result<CoachSuggestion, String> {
    // Validate input parameters
    let _ = validation_helpers::validate_language(&role)?; // Validate role field
    let _ = validation_helpers::validate_language(&language)?; // Validate language field

    let validated_meeting_id = if let Some(mid) = meeting_id {
        Some(validation_helpers::validate_meeting_id(&mid)?)
    } else {
        None
    };

    let validated_meeting_type = if let Some(mt) = meeting_type {
        Some(validation_helpers::validate_string_length(&mt, "meeting_type", 50)?)
    } else {
        None
    };

    let validated_category = if let Some(cat) = suggested_category {
        Some(validation_helpers::validate_string_length(&cat, "suggested_category", 100)?)
    } else {
        None
    };

    let model = CURRENT_MODEL
        .lock()
        .map_err(|e| format!("Mutex envenenado: {}", e))?
        .clone();

    // Prioridad de contexto:
    // 1. window del frontend (en vivo, más reciente que DB)
    // 2. DB via meeting_id (reuniones guardadas)
    let effective_window = if !window.trim().is_empty() {
        window.clone()
    } else if let Some(mid) = validated_meeting_id.as_ref() {
        let state = app.try_state::<crate::state::AppState>();
        if let Some(app_state) = state {
            let pool = app_state.db_manager.pool();
            build_context(pool, mid, ContextMode::Full)
                .await
                .map(|c| c.formatted)
                .unwrap_or_default()
        } else {
            String::new()
        }
    } else {
        String::new()
    };

    let mt = MeetingType::from_str_loose(validated_meeting_type.as_deref().unwrap_or("auto"));
    let prev = previous_tips.unwrap_or_default();
    let validated_signal = trigger_signal
        .map(|s| validation_helpers::validate_string_length(&s, "trigger_signal", 100))
        .transpose()?;

    let user_prompt = build_user_prompt_v3(
        &effective_window,
        mt,
        minute.unwrap_or(0),
        &prev,
        validated_category.as_deref(),
        validated_signal.as_deref(),
    );

    log::info!(
        "[coach_suggest v3] meeting_type={:?}, minute={}, window_chars={}, prev_tips={}, hint={:?}",
        mt,
        minute.unwrap_or(0),
        effective_window.len(),
        prev.len(),
        validated_category
    );

    let client = &*SHARED_CLIENT;

    let start = Instant::now();

    crate::progress_events::emit_coach_thinking(
        &app,
        crate::progress_events::CoachStage::Analyzing,
        0,
        &model,
    );

    let raw_result = generate_summary(
        client,
        &LLMProvider::Ollama,
        &model,
        "",
        MAITY_COPILOTO_V3_LITE_PROMPT,
        &user_prompt,
        None,
        None,
        Some(200), // v3: un poco más para caber subcategory+technique
        Some(0.5), // menos temperatura: queremos tips consistentes y basados en frameworks
        Some(0.9),
        None,
        None,
    )
    .await;

    let raw = match raw_result {
        Ok(r) => r,
        Err(e) => {
            crate::progress_events::emit_coach_thinking(
                &app,
                crate::progress_events::CoachStage::Error,
                start.elapsed().as_millis() as u64,
                &model,
            );
            return Err(format!("Error LLM: {}", e));
        }
    };

    let latency_ms = start.elapsed().as_millis() as u64;
    LAST_LATENCY_MS.store(latency_ms, Ordering::Relaxed);

    crate::progress_events::emit_coach_thinking(
        &app,
        crate::progress_events::CoachStage::Done,
        latency_ms,
        &model,
    );

    let parsed = parse_llm_output(&raw)?;

    // Derivar priority si el LLM no la provee, basado en confidence.
    let priority = parsed.priority.unwrap_or_else(|| {
        if parsed.confidence >= 0.85 {
            "critical".to_string()
        } else if parsed.confidence >= 0.6 {
            "important".to_string()
        } else {
            "soft".to_string()
        }
    });

    // V3.1: tip_type del LLM o inferido.
    let tip_type = parsed
        .tip_type
        .filter(|t| matches!(t.as_str(), "recognition" | "observation" | "corrective" | "introspective"))
        .unwrap_or_else(|| infer_tip_type(&parsed.tip, &priority));

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    Ok(CoachSuggestion {
        tip: parsed.tip,
        category: parsed.category,
        subcategory: parsed.subcategory,
        technique: parsed.technique,
        priority,
        confidence: parsed.confidence,
        tip_type,
        timestamp,
        model,
        latency_ms,
    })
}

/// Cambia el modelo activo del coach.
///
/// Acepta cualquier modelo Ollama instalado (validación delegada al runtime).
/// Esto permite al usuario usar gemma4, gemma3, qwen3, codegemma, etc. sin
/// que el código tenga que enumerar la lista.
#[tauri::command]
pub fn coach_set_model(model_id: String) -> Result<(), String> {
    if model_id.trim().is_empty() {
        return Err("Modelo vacío".to_string());
    }
    let mut current = CURRENT_MODEL
        .lock()
        .map_err(|e| format!("Mutex envenenado: {}", e))?;
    *current = model_id;
    Ok(())
}

/// Devuelve el estado del coach: modelo activo, Ollama corriendo, última latencia.
#[tauri::command]
pub async fn coach_get_status() -> Result<CoachStatus, String> {
    let model = CURRENT_MODEL
        .lock()
        .map_err(|e| format!("Mutex envenenado: {}", e))?
        .clone();

    let ollama_running = check_ollama_running().await;
    let last_latency_ms = LAST_LATENCY_MS.load(Ordering::Relaxed);

    Ok(CoachStatus {
        model,
        ollama_running,
        last_latency_ms,
    })
}

/// Health check rápido a Ollama (timeout 2s).
async fn check_ollama_running() -> bool {
    let client = match Client::builder().timeout(Duration::from_secs(2)).build() {
        Ok(c) => c,
        Err(_) => return false,
    };
    client
        .get("http://localhost:11434/api/tags")
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

/// Parsea la salida del LLM. Tolerante a markdown wrapping y ruido alrededor del JSON.
fn parse_llm_output(raw: &str) -> Result<RawSuggestion, String> {
    let cleaned = raw.trim();

    // Intento directo
    if let Ok(parsed) = serde_json::from_str::<RawSuggestion>(cleaned) {
        return Ok(parsed);
    }

    // Buscar el primer { y el último } (tolerante a texto antes/después)
    let start = cleaned.find('{');
    let end = cleaned.rfind('}');
    if let (Some(s), Some(e)) = (start, end) {
        if e > s {
            let slice = &cleaned[s..=e];
            return serde_json::from_str::<RawSuggestion>(slice)
                .map_err(|err| format!("JSON inválido: {} | raw: {}", err, slice));
        }
    }

    Err(format!(
        "No se pudo parsear salida del LLM (no encontré JSON): {}",
        cleaned
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_directo() {
        let raw = r#"{"tip":"Hola","category":"rapport","confidence":0.8}"#;
        let result = parse_llm_output(raw).unwrap();
        assert_eq!(result.tip, "Hola");
        assert_eq!(result.category, "rapport");
        assert!((result.confidence - 0.8).abs() < 0.001);
    }

    #[test]
    fn test_parse_con_markdown() {
        let raw = "```json\n{\"tip\":\"Pregunta sobre el fin de semana\",\"category\":\"icebreaker\",\"confidence\":0.7}\n```";
        let result = parse_llm_output(raw).unwrap();
        assert_eq!(result.category, "icebreaker");
    }

    #[test]
    fn test_parse_con_ruido_alrededor() {
        let raw = r#"Aquí va mi respuesta: {"tip":"Cierra ahora","category":"closing","confidence":0.95} Espero ayude."#;
        let result = parse_llm_output(raw).unwrap();
        assert_eq!(result.tip, "Cierra ahora");
    }

    #[test]
    fn test_parse_invalido() {
        assert!(parse_llm_output("texto sin json").is_err());
    }

    #[test]
    fn test_set_model_acepta_cualquier_ollama() {
        // Tras el fix de la asamblea (2026-04-11), aceptamos cualquier modelo
        // Ollama instalado. Solo rechazamos string vacío.
        assert!(coach_set_model("gemma4:latest".to_string()).is_ok());
        assert!(coach_set_model("gemma3:4b".to_string()).is_ok());
        assert!(coach_set_model("qwen3:8b".to_string()).is_ok());
        assert!(coach_set_model("custom-model:v2".to_string()).is_ok());
        assert!(coach_set_model("".to_string()).is_err());
        assert!(coach_set_model("   ".to_string()).is_err());
    }
}
