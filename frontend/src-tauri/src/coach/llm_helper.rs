//! Helpers para construir `CoachLlmService` bajo demanda en los callers
//! historicos del coach (live_feedback, evaluator, commands).
//!
//! Estos helpers esconden el boilerplate de:
//! 1. Resolver `app_data_dir`
//! 2. Obtener el `SidecarPool` global
//! 3. Construir el `CoachLlmService` con el modelo correcto
//!
//! El servicio resultante es cheap (Arc<SidecarPool> es global Lazy, los
//! sidecar reales se reusan via pool). Construirlo por-invocacion no
//! agrega overhead significativo.

use std::sync::Arc;

use sqlx::SqlitePool;
use tauri::{AppHandle, Manager, Runtime};

use crate::coach::llm_service::CoachLlmService;
use crate::summary::summary_engine::client::get_sidecar_pool;
use crate::summary::summary_engine::sidecar::SidecarKeepAlive;

/// Construye un `CoachLlmService` con el modelo configurado en
/// `coach_settings.tips_model_id` (o default si no hay setting).
pub async fn build_coach_service<R: Runtime>(
    app: &AppHandle<R>,
    db_pool: &SqlitePool,
) -> Result<Arc<CoachLlmService>, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {}", e))?;

    let pool = get_sidecar_pool(&app_data_dir)
        .await
        .map_err(|e| format!("SidecarPool: {}", e))?;

    let service = CoachLlmService::new_from_settings(pool, app_data_dir, db_pool).await;
    Ok(Arc::new(service))
}

/// Construye un `CoachLlmService` con un modelo especifico (override del setting).
/// Usado por evaluator (que tiene su propio `eval_model_id`).
pub async fn build_coach_service_with_model<R: Runtime>(
    app: &AppHandle<R>,
    model_name: String,
) -> Result<Arc<CoachLlmService>, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {}", e))?;

    let pool = get_sidecar_pool(&app_data_dir)
        .await
        .map_err(|e| format!("SidecarPool: {}", e))?;

    Ok(Arc::new(CoachLlmService::new(
        pool,
        app_data_dir,
        model_name,
    )))
}

/// Toma un lease de sesión sobre el sidecar de `builtin_model` SIN spawnearlo
/// (`SidecarPool::get_or_create`): el proceso sigue naciendo lazy en el primer
/// tick LLM. Mientras el lease viva, el idle loop del sidecar no lo mata
/// (#03 de la auditoría de recursos). `builtin_model` debe ser la MISMA clave
/// con la que `CoachLlmService` pide el sidecar (`map_to_builtin_id`).
pub async fn acquire_sidecar_keepalive<R: Runtime>(
    app: &AppHandle<R>,
    builtin_model: &str,
) -> Result<SidecarKeepAlive, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {}", e))?;

    let pool = get_sidecar_pool(&app_data_dir)
        .await
        .map_err(|e| format!("SidecarPool: {}", e))?;

    let manager = pool
        .get_or_create(builtin_model)
        .await
        .map_err(|e| format!("SidecarManager: {}", e))?;

    Ok(manager.keepalive())
}
