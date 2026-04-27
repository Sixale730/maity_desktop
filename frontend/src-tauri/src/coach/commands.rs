//! Comandos Tauri del coach: sugerencias, configuración de modelos,
//! estado del motor LLM local (llama.cpp), y ventana flotante always-on-top.

use crate::coach::evaluator::{evaluate_meeting, CoachEvalResult};
use crate::coach::live_feedback::CoachTipUpdate;
use crate::coach::llama_engine::{self, LlamaServerStatus};
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

    let (model, endpoint) = get_tips_config(pool).await;
    let mt = meeting_type
        .as_deref()
        .map(MeetingType::from_str_loose)
        .unwrap_or(MeetingType::Auto);

    let user_prompt = build_user_prompt(&transcript, mt, 0, &[], None);

    let raw = generate_summary(
        &HTTP_CLIENT,
        &LLMProvider::Ollama,
        &model,
        "",
        crate::coach::prompt::COACH_SYSTEM_PROMPT,
        &user_prompt,
        Some(&endpoint),
        None,
        None,
        Some(0.3),
        None,
        None,
        None,
    )
    .await
    .map_err(|e| format!("Ollama error: {}", e))?;

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

/// Verifica si llama-server está disponible y devuelve estado del coach.
#[tauri::command]
pub async fn coach_get_status<R: Runtime>(app: AppHandle<R>) -> CoachStatus {
    let state = app.state::<AppState>();
    let pool = state.db_manager.pool();

    let (tips_model_id, endpoint) = get_tips_config(pool).await;
    let eval_model_id = get_eval_model_id(pool).await;

    let chat_model = sqlx::query_scalar::<_, String>(
        "SELECT chat_model FROM coach_settings WHERE id = '1'",
    )
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .unwrap_or_else(|| DEFAULT_CHAT_MODEL.to_string());

    let (available, error) = if llama_engine::is_binary_installed(&app) {
        let alive = llama_engine::health_check(11434).await;
        (alive, if alive { None } else { Some("llama-server no está corriendo. Inicia una grabación o configura el Coach IA.".to_string()) })
    } else {
        (false, Some("llama-server.exe no instalado. Configura el Coach IA.".to_string()))
    };

    CoachStatus {
        available,
        endpoint,
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
    // Si ya existe, solo mostrarla y enfocarla
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
        // Si la altura es mayor a 250px → modo compacto (80px), si no → expandir (430px)
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

// ─── Nuevos comandos GGUF ─────────────────────────────────────────────────────

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

/// Estado actual de los servidores llama-server (ports 11434 / 11435).
#[tauri::command]
pub fn coach_get_engine_status() -> Vec<LlamaServerStatus> {
    llama_engine::get_running_status()
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

/// Cambia el modelo activo para un propósito y reinicia el servidor si es necesario.
/// purpose: "tips" | "eval"
#[tauri::command]
pub async fn coach_switch_model<R: Runtime + 'static>(
    app: AppHandle<R>,
    purpose: String,
    model_id: String,
) -> Result<(), String> {
    // Verificar que el modelo existe en el registry
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

    // Reiniciar servidor con el nuevo modelo
    let port: u16 = if purpose == "tips" { 11434 } else { 11435 };
    llama_engine::stop_server(port);
    let app2 = app.clone();
    let model_id2 = model_id.clone();
    let purpose2 = purpose.clone();
    tokio::spawn(async move {
        if let Err(e) = llama_engine::ensure_running(&app2, &model_id2, port).await {
            warn!("Error reiniciando llama-server para {}: {}", purpose2, e);
        } else {
            let _ = app2.emit(
                "coach-engine-ready",
                serde_json::json!({ "purpose": purpose2, "model_id": model_id2, "port": port }),
            );
        }
    });

    info!("✅ Modelo de {} cambiado a {}", purpose, model_id);
    Ok(())
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
    .unwrap_or_else(|| "qwen25-3b-q4".to_string());
    // Fall back to code default if the stored ID is no longer in the registry
    if model_registry::get_model(&stored).is_some() { stored } else { "qwen25-3b-q4".to_string() }
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
    // Fall back to code default if the stored ID is no longer in the registry
    if model_registry::get_model(&stored).is_some() { stored } else { "qwen25-7b-q4".to_string() }
}

async fn get_tips_config(pool: &sqlx::SqlitePool) -> (String, String) {
    let model_id = get_tips_model_id(pool).await;
    let endpoint = "http://127.0.0.1:11434".to_string();
    (model_id, endpoint)
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
