// cloud_sync/commands.rs
//
// Comandos Tauri para sembrar / limpiar la sesión Supabase en Rust y para
// despertar al loop consumidor (commit 4).

use log::{debug, info};
use serde::Deserialize;

use super::session::{CloudSession, CloudSyncState};

/// Payload de `cloud_sync_set_session`. camelCase porque viene del frontend.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetSessionPayload {
    pub supabase_url: String,
    pub anon_key: String,
    pub access_token: String,
    pub refresh_token: String,
    /// Epoch **segundos** (`session.expires_at` de supabase-js).
    pub expires_at: i64,
    /// `maity.users.id`, NO el `auth.users.id`.
    pub user_id: String,
}

impl From<SetSessionPayload> for CloudSession {
    fn from(p: SetSessionPayload) -> Self {
        CloudSession {
            supabase_url: p.supabase_url,
            anon_key: p.anon_key,
            access_token: p.access_token,
            refresh_token: p.refresh_token,
            expires_at: p.expires_at,
            user_id: p.user_id,
        }
    }
}

/// Siembra (o re-siembra) la sesión Supabase. El frontend lo llama al resolver
/// el `maityUser`, en cada `TOKEN_REFRESHED` y al restaurar sesión al arranque.
#[tauri::command]
pub async fn cloud_sync_set_session(
    state: tauri::State<'_, CloudSyncState>,
    payload: SetSessionPayload,
) -> Result<(), String> {
    if payload.supabase_url.trim().is_empty() || payload.anon_key.trim().is_empty() {
        return Err("validation:supabaseUrl y anonKey son obligatorios".to_string());
    }
    if payload.access_token.trim().is_empty() || payload.refresh_token.trim().is_empty() {
        return Err("validation:se requieren accessToken y refreshToken".to_string());
    }
    if payload.user_id.trim().is_empty() {
        return Err("validation:userId (maity.users.id) es obligatorio".to_string());
    }

    let expires_at = payload.expires_at;
    let user_suffix: String = payload.user_id.chars().rev().take(8).collect();
    state.set_session(CloudSession::from(payload)).await;

    // Nunca loguear tokens; solo lo que sirve para diagnosticar.
    info!(
        "cloud_sync: sesión sembrada (user …{}, expires_at={})",
        user_suffix.chars().rev().collect::<String>(),
        expires_at
    );

    // Si el loop consumidor estaba dormido por falta de sesión, que reintente ya.
    state.notify.notify_one();
    Ok(())
}

/// Limpia la sesión (logout). El consumidor pasa a diferir jobs sin quemar
/// intentos en vez de fallarlos.
#[tauri::command]
pub async fn cloud_sync_clear_session(
    state: tauri::State<'_, CloudSyncState>,
) -> Result<(), String> {
    state.clear_session().await;
    info!("cloud_sync: sesión limpiada");
    Ok(())
}

/// Despierta al loop consumidor sin esperar su tick (p. ej. justo después de
/// encolar jobs al terminar una grabación).
#[tauri::command]
pub async fn cloud_sync_nudge(state: tauri::State<'_, CloudSyncState>) -> Result<(), String> {
    debug!("cloud_sync: nudge");
    state.notify.notify_one();
    Ok(())
}
