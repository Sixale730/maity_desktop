//! Comandos Tauri de la cola de transcripción por lote (F4 de la migración).
//!
//! Molde: `sync_queue_commands.rs` (aislamiento por usuario: sin sesión no
//! hay filas, y el reintento solo toca filas del usuario actual). El
//! consumidor es el bloque "Transcripciones pendientes" de la lista de
//! Conversaciones (`features/conversations/components/PendingTranscriptionsBlock.tsx`)
//! vía `batchQueue.service.ts`. Contrato congelado con el frontend:
//! - `batch_queue_list_active() -> BatchQueueRowView[]` (snake_case).
//! - `batch_queue_retry(folderPath) -> bool` (la clave llega en camelCase y
//!   Tauri la mapea al argumento `folder_path`).
//! Comandos custom: NO necesitan entrada en capabilities.

use log::error;
use serde::Serialize;
use tauri::{AppHandle, Runtime};

use super::repositories::batch_queue::BatchQueueRepository;
use crate::audio::transcription::batch::planner;
use crate::state::AppState;

/// Fila proyectada para la UI. `meeting_name` sale del `metadata.json` de la
/// carpeta (lo escribe el saver al arrancar; fallback: nombre de la carpeta),
/// igual que el finalize del planner.
#[derive(Debug, Clone, Serialize)]
pub struct BatchQueueRowView {
    pub id: i64,
    pub folder_path: String,
    pub meeting_name: String,
    /// `manual` | `rotation` | `auto_close` | `crash_recovery`.
    pub trigger_kind: String,
    /// `pending` | `processing` | `failed` (solo filas vivas; ver `list_active`).
    pub status: String,
    pub attempts: i64,
    /// `"crash_recovery"` marca una fila recuperada tras un crash (el
    /// `trigger_kind` conserva el origen); otro texto = último error.
    pub last_error: Option<String>,
    pub segment_started_at: Option<String>,
    pub updated_at: String,
}

/// Filas vivas (`pending|processing|failed`) del usuario actual, más
/// recientes primero, tope 50. Sin sesión → lista vacía (aislamiento, mismo
/// criterio que `sync_queue_get_ready_jobs`).
#[tauri::command]
pub async fn batch_queue_list_active<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<BatchQueueRowView>, String> {
    let user_id = match state.current_user_id().await {
        Some(id) => id,
        None => return Ok(Vec::new()),
    };
    let pool = state.db_manager.pool();
    let rows = BatchQueueRepository::list_active(pool, &user_id)
        .await
        .map_err(|e| {
            error!("Failed to list active batch jobs: {}", e);
            e.to_string()
        })?;
    Ok(rows
        .into_iter()
        .map(|job| BatchQueueRowView {
            meeting_name: planner::read_meeting_name(&job.folder_path),
            id: job.id,
            folder_path: job.folder_path,
            trigger_kind: job.trigger_kind,
            status: job.status,
            attempts: job.attempts,
            last_error: job.last_error,
            segment_started_at: job.segment_started_at,
            updated_at: job.updated_at,
        })
        .collect())
}

/// Reintento manual de una fila `failed` (botón "Reintentar" del bloque):
/// `failed → pending`, intentos a cero, sin `last_error`, y despierta al
/// planner con `notify_enqueued()` para no esperar su tick de 5 min. `false`
/// si la fila no era del usuario o no estaba en `failed` (idempotente).
#[tauri::command]
pub async fn batch_queue_retry<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    folder_path: String,
) -> Result<bool, String> {
    let user_id = match state.current_user_id().await {
        Some(id) => id,
        None => return Ok(false),
    };
    let pool = state.db_manager.pool();
    let revived = BatchQueueRepository::retry_failed(pool, &folder_path, &user_id)
        .await
        .map_err(|e| {
            error!("Failed to retry batch job {}: {}", folder_path, e);
            e.to_string()
        })?;
    if revived {
        planner::notify_enqueued();
    }
    Ok(revived)
}
