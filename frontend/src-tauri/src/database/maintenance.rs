//! Mantenimiento periódico de la base local: poda de `sync_queue`.
//!
//! Cada job completado conservaba su `payload` entero para siempre
//! (`save_conversation` lleva el `transcript_text`, `save_transcript_segments`
//! todos los segmentos): en la DB de desarrollo 37 jobs retenían 606 KB de
//! 1.67 MB, y un usuario de jornada encola ~24 jobs/día → 50-100 MB al año
//! (#26 de la auditoría de recursos, sep-2026). Esta tarea vacía ese texto
//! pasados `COMPLETED_PAYLOAD_RETENTION_DAYS`; **nunca borra filas** — ver el
//! doc-comment de `SyncQueueRepository::trim_completed_payloads` para los tres
//! consumidores que dependen de las filas completadas (barrido de audio,
//! lista de conversaciones, hijos diferidos por cuota).
//!
//! **Por qué una tarea propia** (molde: `audio::audio_retention`):
//! - El `reset_stale_jobs` del arranque (`lib.rs`) corre en un `block_on`
//!   dentro del `setup()` del hilo principal; un UPDATE sobre miles de filas
//!   ahí es justo lo que la auditoría combate en otros hallazgos.
//! - El tick de `cloud_sync::worker` se auto-gatea por `current_user_id` +
//!   sesión Supabase, y esto no necesita ni usuario ni sesión: recortar los
//!   completados de cualquier cuenta de la máquina es seguro (un job
//!   completado nunca vuelve a ejecutarse) y mejor para privacidad.
//!
//! **Delay de arranque de 120 s**: deja pasar la primera pasada del worker y
//! `autoRecoverAll` (que también escribe en la DB) antes de tocar la cola.
//!
//! Nota sobre disco: SQLite reutiliza las páginas liberadas (freelist), así que
//! el archivo deja de crecer, no se encoge; los backups con `VACUUM INTO` sí
//! salen más chicos de inmediato. No se hace `VACUUM` aquí a propósito:
//! reescribe la DB entera bajo lock y duplica el espacio temporalmente.

use std::time::Duration;

use tauri::{AppHandle, Manager, Runtime};

use crate::database::repositories::sync_queue::SyncQueueRepository;

/// Ver el doc-comment del módulo.
const STARTUP_DELAY_SECS: u64 = 120;
/// Una vez al día basta: el volumen es de ~24 jobs/día.
const TICK_SECS: u64 = 24 * 60 * 60;
/// Ventana FORENSE, no funcional: un job completado nunca se re-ejecuta, así
/// que los 7 días sólo sirven para inspeccionar el payload de un sync raro con
/// el log rotativo a mano. Ningún lector de `payload` mira jobs completados.
const COMPLETED_PAYLOAD_RETENTION_DAYS: i64 = 7;

pub fn spawn<R: Runtime>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        run(app).await;
    });
}

async fn run<R: Runtime>(app: AppHandle<R>) {
    tokio::time::sleep(Duration::from_secs(STARTUP_DELAY_SECS)).await;
    loop {
        trim_once(&app).await;
        tokio::time::sleep(Duration::from_secs(TICK_SECS)).await;
    }
}

/// Una pasada. Nunca propaga error: el mantenimiento jamás rompe nada aguas arriba.
async fn trim_once<R: Runtime>(app: &AppHandle<R>) {
    // El pool se CLONA (Arc por dentro) en vez de sostener el `State` a través
    // del `.await`: mismo patrón que `audio_retention::sweep_once`.
    let pool = {
        let Some(state) = app.try_state::<crate::state::AppState>() else {
            log::warn!("[sync-maintenance] AppState no disponible; se salta la pasada");
            return;
        };
        state.db_manager.pool().clone()
    };

    match SyncQueueRepository::trim_completed_payloads(&pool, COMPLETED_PAYLOAD_RETENTION_DAYS).await {
        // Silencio si no hubo trabajo: una línea diaria de "0 recortados" es ruido.
        Ok(0) => {}
        Ok(rows) => log::info!(
            "[sync-maintenance] {} payload(s) de jobs completados hace >={} dias recortados",
            rows,
            COMPLETED_PAYLOAD_RETENTION_DAYS
        ),
        Err(e) => log::warn!("[sync-maintenance] fallo al podar sync_queue: {}", e),
    }
}
