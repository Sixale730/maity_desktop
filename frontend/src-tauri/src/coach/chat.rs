//! Chat bidireccional con el coach IA.
//!
//! Permite al usuario hacer preguntas en lenguaje natural sobre la reunión
//! actual. La IA responde usando como contexto:
//!   1. La transcripción FULL de la reunión (no rolling window)
//!   2. Speaker segregation (USUARIO vs INTERLOCUTOR)
//!   3. Historial de la conversación con el coach (multi-turn)
//!
//! Reusa `summary::llm_client` con provider FIJO Ollama (privacidad).

use crate::coach::context::{build_context, ContextMode};
use crate::summary::llm_client::{generate_summary, LLMProvider};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::Manager;

const CHAT_SYSTEM_PROMPT: &str = r#"Eres un copiloto IA inteligente que acompaña al usuario durante una reunión en vivo. Tienes acceso a la transcripción completa de la conversación, segregada por speaker (USUARIO = el dueño del micrófono; INTERLOCUTOR = la otra persona).

REGLAS:
1. Responde DIRECTO, en español neutro, sin preámbulos ("¡claro!", "¡perfecto!").
2. Sé CONCRETO: si te piden un consejo, da el consejo. Si te piden análisis, analiza con datos del transcript.
3. CITA partes del transcript cuando sea relevante: "el cliente dijo 'X' en el min Y".
4. NO inventes datos que no estén en el transcript.
5. Máximo 4 oraciones por respuesta a menos que el usuario pida explícitamente más detalle.
6. Si el contexto del transcript es insuficiente para responder, dilo y sugiere qué escuchar.
7. Tono: profesional pero cercano, como un mentor que escuchó la reunión contigo."#;

#[derive(Debug, Deserialize)]
pub struct ChatHistoryEntry {
    pub role: String, // "user" | "assistant"
    pub content: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct ChatResponse {
    pub answer: String,
    pub model: String,
    pub latency_ms: u64,
    pub context_chars: usize,
    pub context_turns: usize,
    pub user_turns: usize,
    pub interlocutor_turns: usize,
}

/// Comando Tauri: chat con el coach.
///
/// # Argumentos
/// * `message` - Pregunta del usuario en lenguaje natural
/// * `meeting_id` - ID de la reunión actual (para leer transcript de DB)
/// * `history` - Historial de turnos previos del chat (opcional)
/// * `model` - Modelo Ollama a usar (default: gemma4:latest)
#[tauri::command]
pub async fn coach_chat(
    app: tauri::AppHandle,
    message: String,
    meeting_id: Option<String>,
    live_transcript: Option<String>,
    history: Option<Vec<ChatHistoryEntry>>,
    model: Option<String>,
) -> Result<ChatResponse, String> {
    log::info!(
        "🧠 coach_chat INVOKED: message={:?}, meeting_id={:?}, live_len={}, history_len={}, model={:?}",
        message.chars().take(50).collect::<String>(),
        meeting_id,
        live_transcript.as_ref().map(|s| s.len()).unwrap_or(0),
        history.as_ref().map(|h| h.len()).unwrap_or(0),
        model
    );

    if message.trim().is_empty() {
        return Err("Mensaje vacío".to_string());
    }

    let model_to_use = model.unwrap_or_else(|| crate::coach::prompt::DEFAULT_MODEL.to_string());

    // Prioridad de contexto:
    // 1. live_transcript del frontend (durante grabación en vivo, DB está vacía)
    // 2. DB vía meeting_id (reuniones ya guardadas)
    // 3. Contexto vacío (chat sin contexto, respuesta genérica)
    let context = if let Some(live) = live_transcript.filter(|s| !s.trim().is_empty()) {
        log::info!("[coach_chat] Usando live_transcript del frontend ({} chars)", live.len());
        let live_len = live.len();
        crate::coach::context::CoachContext {
            formatted: live,
            turn_count: 0,
            char_count: live_len,
            user_turns: 0,
            interlocutor_turns: 0,
        }
    } else if let Some(mid) = meeting_id.as_ref() {
        let state = app
            .try_state::<crate::state::AppState>()
            .ok_or_else(|| "AppState no disponible".to_string())?;
        let pool = state.db_manager.pool();
        build_context(pool, mid, ContextMode::Full)
            .await
            .unwrap_or_else(|e| {
                log::warn!("[coach_chat] Error cargando contexto: {}", e);
                crate::coach::context::CoachContext::empty()
            })
    } else {
        crate::coach::context::CoachContext::empty()
    };

    // 2. Armar el user_prompt: contexto + historial + pregunta actual
    let mut user_prompt = String::new();

    if !context.is_empty() {
        user_prompt.push_str(&format!(
            "<transcripcion meeting=\"{}\" turnos=\"{}\" usuario_turnos=\"{}\" interlocutor_turnos=\"{}\">\n{}\n</transcripcion>\n\n",
            meeting_id.as_deref().unwrap_or("unknown"),
            context.turn_count,
            context.user_turns,
            context.interlocutor_turns,
            context.formatted
        ));
    } else {
        user_prompt.push_str("<transcripcion>(sin transcripción disponible)</transcripcion>\n\n");
    }

    // Historial de chat previo (multi-turn)
    if let Some(hist) = history {
        if !hist.is_empty() {
            user_prompt.push_str("<historial_chat>\n");
            for entry in hist.iter().take(20) {
                // cap a últimos 20 turnos
                let role_label = if entry.role == "user" { "Usuario" } else { "Coach" };
                user_prompt.push_str(&format!("{}: {}\n", role_label, entry.content));
            }
            user_prompt.push_str("</historial_chat>\n\n");
        }
    }

    user_prompt.push_str(&format!("PREGUNTA ACTUAL DEL USUARIO:\n{}", message.trim()));

    // 3. Llamar al LLM
    let client = Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| format!("Error creando cliente HTTP: {}", e))?;

    let start = std::time::Instant::now();

    let response = generate_summary(
        &client,
        &LLMProvider::Ollama,
        &model_to_use,
        "",
        CHAT_SYSTEM_PROMPT,
        &user_prompt,
        None,
        None,
        Some(500),  // chat puede ser un poco más largo
        Some(0.5),  // temperatura media: balance entre creatividad y consistencia
        Some(0.9),
        None,
        None,
    )
    .await
    .map_err(|e| format!("Error LLM chat: {}", e))?;

    let latency_ms = start.elapsed().as_millis() as u64;

    Ok(ChatResponse {
        answer: response.trim().to_string(),
        model: model_to_use,
        latency_ms,
        context_chars: context.char_count,
        context_turns: context.turn_count,
        user_turns: context.user_turns,
        interlocutor_turns: context.interlocutor_turns,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_chat_response_struct() {
        let r = ChatResponse {
            answer: "Test".to_string(),
            model: "gemma4:latest".to_string(),
            latency_ms: 1234,
            context_chars: 100,
            context_turns: 5,
            user_turns: 2,
            interlocutor_turns: 3,
        };
        assert_eq!(r.user_turns + r.interlocutor_turns, r.context_turns);
    }

    #[test]
    fn test_history_entry_deserialize() {
        let json = r#"{"role":"user","content":"Hola"}"#;
        let entry: ChatHistoryEntry = serde_json::from_str(json).unwrap();
        assert_eq!(entry.role, "user");
        assert_eq!(entry.content, "Hola");
    }
}
