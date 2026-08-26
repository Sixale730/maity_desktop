//! Estado de registro del usuario (`maity.users.registration_form_completed`)
//! del lado nativo — issue #66.
//!
//! Por qué existe: el gate de registro vivía SOLO en el render de la ventana
//! principal (`layout.tsx`), pero la grabación tiene entrypoints nativos que
//! nunca pasan por ahí (tray, scheduler de jornada, y los floats, que le piden
//! a la main que arranque). En producción un usuario con la UI parada en
//! `/registration` grabó 21 jornadas con 0.2.57. El frontend es entrada de
//! usuario, no autoridad: la verdad vive en `AppState.registration_completed`
//! y el gate en `recording_helpers::initialize_recording` (mismo patrón que
//! `state::has_session`).
//!
//! Caché monótona: el flag en la DB solo avanza (`false` → `true`), así que
//! recordar localmente a los usuarios que ya se vieron completados es seguro y
//! evita bloquear a un usuario registrado que arranca sin red (la RPC
//! `my_status` falla → el frontend cae a `get_registration_status`, sembrado
//! desde aquí en `set_current_user`). Solo se cachea `true`; un `false`
//! confirmado por la RPC lo retira (por si un admin resetea el flag).

use log::{info, warn};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;

use crate::state::AppState;

const STORE_FILE: &str = "registration-status.json";
const STORE_KEY: &str = "cache";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RegistrationCache {
    /// `maity.users.id` de los usuarios que alguna vez se confirmaron con
    /// `registration_form_completed = true` en esta instalación.
    #[serde(default)]
    pub completed_user_ids: Vec<String>,
}

/// Siembra para `AppState.registration_completed` al hacer login: `Some(true)`
/// si el usuario ya se vio completado en esta máquina, `None` (desconocido) si
/// no. Nunca `Some(false)`: eso solo lo afirma la RPC.
pub fn seed_from_cache(user_id: &str, cache: &RegistrationCache) -> Option<bool> {
    if cache.completed_user_ids.iter().any(|id| id == user_id) {
        Some(true)
    } else {
        None
    }
}

/// Aplica el valor confirmado por la RPC a la caché. Devuelve `true` si la
/// caché cambió (y hay que persistir).
pub fn apply_to_cache(user_id: &str, completed: bool, cache: &mut RegistrationCache) -> bool {
    let present = cache.completed_user_ids.iter().any(|id| id == user_id);
    match (completed, present) {
        (true, false) => {
            cache.completed_user_ids.push(user_id.to_string());
            true
        }
        (false, true) => {
            cache.completed_user_ids.retain(|id| id != user_id);
            true
        }
        _ => false,
    }
}

pub fn load_cache<R: Runtime>(app: &AppHandle<R>) -> RegistrationCache {
    let store = match app.store(STORE_FILE) {
        Ok(store) => store,
        Err(e) => {
            warn!("[registration] store inaccesible ({}), caché vacía", e);
            return RegistrationCache::default();
        }
    };
    match store.get(STORE_KEY) {
        Some(value) => serde_json::from_value::<RegistrationCache>(value.clone()).unwrap_or_else(|e| {
            warn!("[registration] caché ilegible ({}), se ignora", e);
            RegistrationCache::default()
        }),
        None => RegistrationCache::default(),
    }
}

fn persist_cache<R: Runtime>(app: &AppHandle<R>, cache: &RegistrationCache) -> Result<(), String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Store inaccesible: {}", e))?;
    let value = serde_json::to_value(cache).map_err(|e| format!("Serialización falló: {}", e))?;
    store.set(STORE_KEY, value);
    store
        .save()
        .map_err(|e| format!("No se pudo persistir a disco: {}", e))
}

/// El frontend lo invoca con el valor real de `my_status()` cada vez que la
/// RPC responde. Es la ÚNICA fuente de `Some(false)`.
///
/// Lleva `user_id` explícito (el `maity.users.id` de la sesión) para no
/// depender del orden respecto a `set_current_user`: ambos IPC salen del
/// mismo commit de React. Si `current_user_id` ya está y NO coincide, el
/// valor es de una sesión vieja y se ignora para el estado vivo (la caché sí
/// se actualiza para ese usuario).
#[tauri::command]
pub async fn set_registration_status<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    user_id: String,
    completed: bool,
) -> Result<(), String> {
    let current = state.current_user_id().await;
    let applies_to_live = current.as_deref().map_or(true, |c| c == user_id);
    if applies_to_live {
        *state.registration_completed.write().await = Some(completed);
        info!("[registration] registration_completed = {} (user {})", completed, user_id);
    } else {
        warn!(
            "[registration] set_registration_status({}) para {} con sesión de {:?} — solo caché",
            completed, user_id, current
        );
    }

    let mut cache = load_cache(&app);
    if apply_to_cache(&user_id, completed, &mut cache) {
        // Best-effort: la caché es una comodidad offline, no la verdad.
        if let Err(e) = persist_cache(&app, &cache) {
            warn!("[registration] no se pudo persistir la caché: {}", e);
        }
    }
    Ok(())
}

/// Lo que Rust cree hoy: `Some(bool)` si la RPC o la caché lo afirmaron,
/// `None` si es desconocido. El frontend lo usa como fallback cuando la RPC
/// falla (arranque sin red).
#[tauri::command]
pub async fn get_registration_status(
    state: tauri::State<'_, AppState>,
) -> Result<Option<bool>, String> {
    Ok(*state.registration_completed.read().await)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cache_with(ids: &[&str]) -> RegistrationCache {
        RegistrationCache {
            completed_user_ids: ids.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn seed_es_some_true_solo_si_el_usuario_esta_en_cache() {
        let cache = cache_with(&["u-1"]);
        assert_eq!(seed_from_cache("u-1", &cache), Some(true));
        // Desconocido, NUNCA Some(false): eso lo decide la RPC.
        assert_eq!(seed_from_cache("u-2", &cache), None);
        assert_eq!(seed_from_cache("u-1", &RegistrationCache::default()), None);
    }

    #[test]
    fn apply_agrega_en_true_y_retira_en_false() {
        let mut cache = RegistrationCache::default();
        assert!(apply_to_cache("u-1", true, &mut cache));
        assert_eq!(cache.completed_user_ids, vec!["u-1".to_string()]);
        // Idempotente
        assert!(!apply_to_cache("u-1", true, &mut cache));
        assert_eq!(cache.completed_user_ids.len(), 1);
        // Un false confirmado retira (admin reseteó el flag)
        assert!(apply_to_cache("u-1", false, &mut cache));
        assert!(cache.completed_user_ids.is_empty());
        // false sobre ausente: sin cambios
        assert!(!apply_to_cache("u-1", false, &mut cache));
    }

    #[test]
    fn cache_deserializa_json_viejo_sin_campo() {
        let cache: RegistrationCache = serde_json::from_str("{}").unwrap();
        assert!(cache.completed_user_ids.is_empty());
    }
}
