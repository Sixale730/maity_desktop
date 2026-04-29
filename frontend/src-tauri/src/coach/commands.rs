//! Comandos Tauri del coach: sugerencias, configuración de modelos,
//! estado del motor LLM local (sidecar Built-in AI), y ventana flotante always-on-top.

use crate::coach::evaluator::evaluate_meeting;
use crate::coach::live_feedback::CoachTipUpdate;
use crate::coach::llama_engine;
use crate::coach::model_registry;
use crate::coach::prompt::DEFAULT_CHAT_MODEL;
use crate::state::AppState;
use crate::summary::llm_client::{generate_summary, LLMProvider};
use once_cell::sync::Lazy;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tracing::{info, warn};

static HTTP_CLIENT: Lazy<Client> = Lazy::new(Client::new);

// ─── Tipos de respuesta ───────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct CoachStatus {
    pub available: bool,
    pub endpoint: String,
    pub tips_model: String,
    pub eval_model: String,
    pub chat_model: String,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CoachModels {
    pub tips_model: String,
    pub eval_model: String,
    pub chat_model: String,
}

// ─── Comandos Tauri ───────────────────────────────────────────────────────────

/// Genera una sugerencia puntual (para chat o test manual).
#[tauri::command]
pub async fn coach_suggest<R: Runtime>(
    app: AppHandle<R>,
    transcript: String,
    meeting_type: Option<String>,
) -> Result<CoachTipUpdate, String> {
    use crate::coach::prompt::{build_user_prompt, MeetingType};

    let state = app.state::<AppState>();
    let pool = state.db_manager.pool();

    let model_id = get_tips_model_id(pool).await;
    let mt = meeting_type
        .as_deref()
        .map(MeetingType::from_str_loose)
        .unwrap_or(MeetingType::Auto);

    let user_prompt = build_user_prompt(&transcript, mt, 0, &[], None);

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No se pudo obtener app_data_dir: {}", e))?;

    let builtin_model = llama_engine::map_to_builtin_id(&model_id);

    let raw = generate_summary(
        &HTTP_CLIENT,
        &LLMProvider::BuiltInAI,
        builtin_model,
        "",
        crate::coach::prompt::COACH_SYSTEM_PROMPT,
        &user_prompt,
        None,
        None,
        None,
        Some(0.3),
        None,
        Some(&app_data_dir),
        None,
    )
    .await
    .map_err(|e| format!("Coach LLM error: {}", e))?;

    parse_tip_response(&raw).ok_or_else(|| "No se pudo parsear respuesta del coach".to_string())
}

/// Configura el modelo para un propósito específico (tips | eval | chat).
#[tauri::command]
pub async fn coach_set_model_for_purpose<R: Runtime>(
    app: AppHandle<R>,
    purpose: String,
    model: String,
) -> Result<(), String> {
    let state = app.state::<AppState>();
    let pool = state.db_manager.pool();

    let col = match purpose.as_str() {
        "tips" => "tips_model_id",
        "eval" => "eval_model_id",
        "chat" => "chat_model",
        _ => return Err(format!("Propósito desconocido: {}", purpose)),
    };

    let query = format!(
        "INSERT INTO coach_settings (id, {col}) VALUES ('1', ?)
         ON CONFLICT(id) DO UPDATE SET {col} = excluded.{col}"
    );
    sqlx::query(&query)
        .bind(&model)
        .execute(pool)
        .await
        .map_err(|e| format!("Error guardando modelo: {}", e))?;

    info!("✅ Coach model for '{}' set to '{}'", purpose, model);
    Ok(())
}

/// Devuelve los modelos configurados actualmente.
#[tauri::command]
pub async fn coach_get_models<R: Runtime>(app: AppHandle<R>) -> CoachModels {
    let state = app.state::<AppState>();
    let pool = state.db_manager.pool();

    let tips_model = get_tips_model_id(pool).await;
    let eval_model = get_eval_model_id(pool).await;

    let chat_model = sqlx::query_scalar::<_, String>(
        "SELECT chat_model FROM coach_settings WHERE id = '1'",
    )
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .unwrap_or_else(|| DEFAULT_CHAT_MODEL.to_string());

    CoachModels {
        tips_model,
        eval_model,
        chat_model,
    }
}

/// Devuelve el estado del Coach IA (modelo de tips descargado o no).
#[tauri::command]
pub async fn coach_get_status<R: Runtime>(app: AppHandle<R>) -> CoachStatus {
    let state = app.state::<AppState>();
    let pool = state.db_manager.pool();

    let tips_model_id = get_tips_model_id(pool).await;
    let eval_model_id = get_eval_model_id(pool).await;

    let chat_model = sqlx::query_scalar::<_, String>(
        "SELECT chat_model FROM coach_settings WHERE id = '1'",
    )
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .unwrap_or_else(|| DEFAULT_CHAT_MODEL.to_string());

    let installed = llama_engine::is_model_installed(&app, &tips_model_id);
    let (available, error) = if installed {
        (true, None)
    } else {
        (
            false,
            Some(format!(
                "El modelo '{}' aún no está descargado. Configura el Coach IA en Ajustes → Pipeline.",
                tips_model_id
            )),
        )
    };

    CoachStatus {
        available,
        endpoint: "builtin-ai-sidecar".to_string(),
        tips_model: tips_model_id,
        eval_model: eval_model_id,
        chat_model,
        error,
    }
}

/// Lanza evaluación post-reunión en background y emite "coach-eval-complete".
#[tauri::command]
pub async fn coach_evaluate_meeting<R: Runtime + 'static>(
    app: AppHandle<R>,
    meeting_id: String,
) -> Result<(), String> {
    let app2 = app.clone();
    tokio::spawn(async move {
        match evaluate_meeting(&app2, &meeting_id).await {
            Ok(result) => {
                let _ = app2.emit("coach-eval-complete", &result);
                info!("✅ Coach eval emitido para {}", meeting_id);
            }
            Err(e) => {
                warn!("Coach eval falló para {}: {}", meeting_id, e);
                let _ = app2.emit(
                    "coach-eval-error",
                    serde_json::json!({ "meeting_id": meeting_id, "error": e }),
                );
            }
        }
    });
    Ok(())
}

/// Abre la ventana flotante always-on-top del coach.
#[tauri::command]
pub async fn open_floating_coach<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("coach-float") {
        w.show().map_err(|e| e.to_string())?;
        w.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    tauri::WebviewWindowBuilder::new(
        &app,
        "coach-float",
        tauri::WebviewUrl::App("coach-float".into()),
    )
    .title("Maity Coach")
    .inner_size(320.0, 430.0)
    .min_inner_size(280.0, 200.0)
    .always_on_top(true)
    .decorations(false)
    .resizable(true)
    .skip_taskbar(true)
    .build()
    .map_err(|e| format!("Error abriendo ventana flotante: {}", e))?;

    info!("✅ Floating coach window opened");
    Ok(())
}

/// Cierra la ventana flotante del coach.
#[tauri::command]
pub async fn close_floating_coach<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("coach-float") {
        w.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Alterna entre modo compacto y expandido en la ventana flotante.
#[tauri::command]
pub async fn floating_toggle_compact<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("coach-float") {
        let size = w.inner_size().map_err(|e| e.to_string())?;
        let (new_w, new_h): (u32, u32) = if size.height > 250 {
            (320, 80)
        } else {
            (320, 430)
        };
        w.set_size(tauri::Size::Physical(tauri::PhysicalSize {
            width: new_w,
            height: new_h,
        }))
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ─── Comandos GGUF ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct GgufModelInfo {
    pub id: String,
    pub name: String,
    pub size_gb: f32,
    pub ram_gb: f32,
    pub use_case: String,
    pub description: String,
    pub installed: bool,
    pub is_tips_model: bool,
    pub is_eval_model: bool,
}

/// Lista todos los modelos GGUF del registry con estado de instalación.
#[tauri::command]
pub async fn coach_list_gguf_models<R: Runtime>(app: AppHandle<R>) -> Vec<GgufModelInfo> {
    let state = app.state::<AppState>();
    let pool = state.db_manager.pool();

    let tips_id = get_tips_model_id(pool).await;
    let eval_id = get_eval_model_id(pool).await;

    model_registry::MODELS
        .iter()
        .map(|def| GgufModelInfo {
            id: def.id.to_string(),
            name: def.name.to_string(),
            size_gb: def.size_gb,
            ram_gb: def.ram_gb,
            use_case: def.use_case.to_string(),
            description: def.description.to_string(),
            installed: llama_engine::is_model_installed(&app, def.id),
            is_tips_model: tips_id == def.id,
            is_eval_model: eval_id == def.id,
        })
        .collect()
}

/// Descarga un modelo GGUF en background, emitiendo "coach-gguf-download-progress".
#[tauri::command]
pub async fn coach_download_gguf_model<R: Runtime + 'static>(
    app: AppHandle<R>,
    model_id: String,
) -> Result<(), String> {
    let app2 = app.clone();
    tokio::spawn(async move {
        match crate::coach::setup::download_gguf_model_file(&app2, &model_id).await {
            Ok(()) => {
                let _ = app2.emit(
                    "coach-gguf-download-complete",
                    serde_json::json!({ "model_id": model_id }),
                );
            }
            Err(e) => {
                warn!("Error descargando modelo {}: {}", model_id, e);
                let _ = app2.emit(
                    "coach-gguf-download-error",
                    serde_json::json!({ "model_id": model_id, "error": e }),
                );
            }
        }
    });
    Ok(())
}

/// Cambia el modelo activo para un propósito (tips | eval) y persiste en DB.
/// El sidecar carga modelos a demanda en la próxima generación, no hay servidor que reiniciar.
#[tauri::command]
pub async fn coach_switch_model<R: Runtime + 'static>(
    app: AppHandle<R>,
    purpose: String,
    model_id: String,
) -> Result<(), String> {
    model_registry::get_model(&model_id)
        .ok_or_else(|| format!("Modelo '{}' no reconocido", model_id))?;

    if !llama_engine::is_model_installed(&app, &model_id) {
        return Err(format!(
            "Modelo '{}' no descargado. Descárgalo primero.",
            model_id
        ));
    }

    let state = app.state::<AppState>();
    let pool = state.db_manager.pool();

    let col = match purpose.as_str() {
        "tips" => "tips_model_id",
        "eval" => "eval_model_id",
        _ => return Err(format!("Propósito desconocido: {}", purpose)),
    };

    let query = format!(
        "INSERT INTO coach_settings (id, {col}) VALUES ('1', ?)
         ON CONFLICT(id) DO UPDATE SET {col} = excluded.{col}"
    );
    sqlx::query(&query)
        .bind(&model_id)
        .execute(pool)
        .await
        .map_err(|e| format!("Error guardando modelo: {}", e))?;

    let _ = app.emit(
        "coach-engine-ready",
        serde_json::json!({ "purpose": purpose, "model_id": model_id }),
    );

    info!("✅ Modelo de {} cambiado a {}", purpose, model_id);
    Ok(())
}

/// Elimina el archivo GGUF descargado de un modelo.
#[tauri::command]
pub async fn coach_delete_gguf_model<R: Runtime + 'static>(
    app: AppHandle<R>,
    model_id: String,
) -> Result<(), String> {
    model_registry::get_model(&model_id)
        .ok_or_else(|| format!("Modelo '{}' no reconocido", model_id))?;

    let path = llama_engine::model_file_path(&app, &model_id)
        .ok_or_else(|| format!("No se pudo resolver la ruta del modelo '{}'", model_id))?;

    if !path.exists() {
        return Err(format!("El modelo '{}' no está descargado", model_id));
    }

    tokio::fs::remove_file(&path)
        .await
        .map_err(|e| format!("Error eliminando modelo '{}': {}", model_id, e))?;

    info!("🗑️  Modelo GGUF eliminado: {}", model_id);
    Ok(())
}

/// Devuelve el historial de tips de la sesión activa (máx 20, FIFO).
/// Devuelve lista vacía si no hay sesión activa — nunca falla.
#[tauri::command]
pub fn coach_get_session_tips() -> Vec<CoachTipUpdate> {
    crate::coach::live_feedback::get_session_tips()
}

// ─── Helpers privados ─────────────────────────────────────────────────────────

async fn get_tips_model_id(pool: &sqlx::SqlitePool) -> String {
    let stored = sqlx::query_scalar::<_, String>(
        "SELECT tips_model_id FROM coach_settings WHERE id = '1'",
    )
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .unwrap_or_else(|| "gemma3-4b-q4".to_string());
    if model_registry::get_model(&stored).is_some() {
        stored
    } else {
        "gemma3-4b-q4".to_string()
    }
}

async fn get_eval_model_id(pool: &sqlx::SqlitePool) -> String {
    let stored = sqlx::query_scalar::<_, String>(
        "SELECT eval_model_id FROM coach_settings WHERE id = '1'",
    )
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .unwrap_or_else(|| "qwen25-7b-q4".to_string());
    if model_registry::get_model(&stored).is_some() {
        stored
    } else {
        "qwen25-7b-q4".to_string()
    }
}

fn parse_tip_response(raw: &str) -> Option<CoachTipUpdate> {
    let text = raw.trim();
    let start = if text.starts_with('{') {
        0
    } else {
        text.find('{')?
    };
    let end = text.rfind('}')?;
    if end <= start {
        return None;
    }
    let json_str = &text[start..=end];

    #[derive(Deserialize)]
    struct Raw {
        tip: Option<String>,
        tip_type: Option<String>,
        category: Option<String>,
        priority: Option<String>,
        confidence: Option<f64>,
    }

    let parsed: Raw = serde_json::from_str(json_str).ok()?;
    let tip = parsed.tip?.trim().to_string();
    if tip.is_empty() {
        return None;
    }

    Some(CoachTipUpdate {
        tip,
        tip_type: parsed.tip_type.unwrap_or_else(|| "observation".to_string()),
        category: parsed.category.unwrap_or_else(|| "pacing".to_string()),
        priority: parsed.priority.unwrap_or_else(|| "soft".to_string()),
        confidence: parsed.confidence.unwrap_or(0.5),
        trigger: None,
        timestamp_secs: 0,
    })
}

// ─── Chat IA con acceso autónomo a conversaciones ────────────────────────────

/// Un turno del historial de chat enviado desde el frontend.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatTurn {
    pub role: String,
    pub content: String,
}

/// Payload del comando coach_chat.
#[derive(Debug, Deserialize)]
pub struct ChatQuery {
    /// Historial de la conversación (sin el turno system, se inyecta server-side).
    pub messages: Vec<ChatTurn>,
}

/// Respuesta enviada al frontend.
#[derive(Debug, Serialize)]
pub struct ChatReply {
    pub content: String,
    pub model: String,
    pub provider: String,
}

/// Construye el system prompt del agente inyectando datos reales de todas
/// las conversaciones del usuario más fragmentos relevantes a la pregunta.
async fn build_agent_system_prompt(pool: &sqlx::SqlitePool, user_question: &str) -> String {
    let base = "Eres Maity, asistente personal de comunicación. \
        Tienes acceso completo a las conversaciones y análisis del usuario. \
        Responde siempre en español. \
        Sé conciso y orientado a acción (máximo 3 párrafos). \
        Cita reuniones específicas por nombre cuando sea relevante.";

    #[derive(sqlx::FromRow)]
    struct MeetingRow {
        id: String,
        title: String,
        created_at: String,
    }

    let meetings = sqlx::query_as::<_, MeetingRow>(
        "SELECT id, title, created_at FROM meetings ORDER BY created_at DESC LIMIT 30",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    if meetings.is_empty() {
        return format!(
            "{}\n\nEl usuario aún no tiene conversaciones registradas.",
            base
        );
    }

    #[derive(sqlx::FromRow)]
    struct SummaryRow {
        meeting_id: String,
        result: String,
    }

    let summaries = sqlx::query_as::<_, SummaryRow>(
        "SELECT meeting_id, result FROM summary_processes \
         WHERE status = 'completed' AND result IS NOT NULL",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    use std::collections::HashMap;
    let score_map: HashMap<String, f64> = summaries
        .into_iter()
        .filter_map(|row| {
            let v: serde_json::Value = serde_json::from_str(&row.result).ok()?;
            let score = v["resumen"]["puntuacion_global"]
                .as_f64()
                .or_else(|| v["calidad_global"]["puntaje"].as_f64())?;
            Some((row.meeting_id, score))
        })
        .collect();

    let scores: Vec<f64> = score_map.values().copied().collect();
    let avg_score = if scores.is_empty() {
        None
    } else {
        Some(scores.iter().sum::<f64>() / scores.len() as f64)
    };

    let first_date = meetings.last().map(|m| m.created_at[..10].to_string()).unwrap_or_default();
    let last_date = meetings.first().map(|m| m.created_at[..10].to_string()).unwrap_or_default();

    let mut profile = format!(
        "PERFIL DEL USUARIO:\n\
         - Total de conversaciones: {}\n\
         - Período: {} → {}\n",
        meetings.len(),
        first_date,
        last_date,
    );
    if let Some(avg) = avg_score {
        profile.push_str(&format!("- Promedio de puntuación: {:.0}/100\n", avg));
    }

    profile.push_str("\nCONVERSACIONES (más recientes primero):\n");
    for (i, m) in meetings.iter().take(15).enumerate() {
        let date = &m.created_at[..10.min(m.created_at.len())];
        if let Some(score) = score_map.get(&m.id) {
            profile.push_str(&format!(
                "{}. \"{}\" — {} — Puntuación: {:.0}/100\n",
                i + 1,
                m.title,
                date,
                score
            ));
        } else {
            profile.push_str(&format!("{}. \"{}\" — {}\n", i + 1, m.title, date));
        }
    }

    let keywords: Vec<&str> = user_question
        .split_whitespace()
        .filter(|w| w.len() > 4)
        .take(4)
        .collect();

    let mut relevant_block = String::new();
    let mut seen_meetings: std::collections::HashSet<String> = std::collections::HashSet::new();

    for keyword in &keywords {
        if seen_meetings.len() >= 3 {
            break;
        }
        #[derive(sqlx::FromRow)]
        struct SearchRow {
            title: String,
            transcript: String,
            meeting_id: String,
        }
        let pattern = format!("%{}%", keyword.to_lowercase());
        let rows = sqlx::query_as::<_, SearchRow>(
            "SELECT m.title, t.transcript, t.meeting_id \
             FROM meetings m JOIN transcripts t ON m.id = t.meeting_id \
             WHERE LOWER(t.transcript) LIKE ? LIMIT 3",
        )
        .bind(&pattern)
        .fetch_all(pool)
        .await
        .unwrap_or_default();

        for row in rows {
            if seen_meetings.contains(&row.meeting_id) {
                continue;
            }
            seen_meetings.insert(row.meeting_id);
            let snippet: String = row.transcript.chars().take(200).collect();
            relevant_block.push_str(&format!(
                "→ De \"{}\": \"...{}...\"\n",
                row.title, snippet
            ));
            if seen_meetings.len() >= 3 {
                break;
            }
        }
    }

    let mut prompt = format!("{}\n\n{}", base, profile);
    if !relevant_block.is_empty() {
        prompt.push_str(&format!("\nFRAGMENTOS RELEVANTES:\n{}", relevant_block));
    }
    prompt
}

/// Aplana el historial de chat a system + user prompt para el sidecar BuiltInAI.
async fn call_coach_builtin<R: tauri::Runtime>(
    app: &AppHandle<R>,
    model_id: &str,
    system_prompt: &str,
    turns: &[ChatTurn],
) -> Result<String, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No se pudo obtener app_data_dir: {}", e))?;

    let user_prompt = if turns.len() <= 1 {
        turns
            .last()
            .map(|t| t.content.clone())
            .unwrap_or_default()
    } else {
        let mut buf = String::from("Historial previo:\n");
        for turn in &turns[..turns.len() - 1] {
            let role = if turn.role == "user" { "Usuario" } else { "Asistente" };
            buf.push_str(&format!("{}: {}\n", role, turn.content));
        }
        buf.push_str("---\nMensaje actual: ");
        buf.push_str(&turns.last().map(|t| t.content.as_str()).unwrap_or(""));
        buf
    };

    let builtin_model = llama_engine::map_to_builtin_id(model_id);

    generate_summary(
        &HTTP_CLIENT,
        &LLMProvider::BuiltInAI,
        builtin_model,
        "",
        system_prompt,
        &user_prompt,
        None,
        None,
        Some(512),
        Some(0.7),
        None,
        Some(&app_data_dir),
        None,
    )
    .await
}

/// Comando principal: usa el sidecar Built-in AI con el modelo de tips configurado.
#[tauri::command]
pub async fn coach_chat<R: tauri::Runtime>(
    app: AppHandle<R>,
    query: ChatQuery,
) -> Result<ChatReply, String> {
    let state = app.state::<AppState>();
    let pool = state.db_manager.pool();

    let user_question = query
        .messages
        .last()
        .map(|m| m.content.as_str())
        .unwrap_or("");

    let system_prompt = build_agent_system_prompt(pool, user_question).await;

    let turns: &[ChatTurn] = if query.messages.len() > 10 {
        &query.messages[query.messages.len() - 10..]
    } else {
        &query.messages
    };

    let model_id = get_tips_model_id(pool).await;
    if !llama_engine::is_model_installed(&app, &model_id) {
        return Err(format!(
            "El modelo '{}' aún no está descargado. Configura el Coach IA en Ajustes → Pipeline.",
            model_id
        ));
    }

    match call_coach_builtin(&app, &model_id, &system_prompt, turns).await {
        Ok(content) => Ok(ChatReply {
            content,
            model: model_id,
            provider: "builtin-ai".to_string(),
        }),
        Err(e) => {
            warn!("Coach Built-in AI falló: {}", e);
            Err(format!("Coach IA no disponible: {}", e))
        }
    }
}
