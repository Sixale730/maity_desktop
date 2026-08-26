use crate::database::manager::DatabaseManager;
use std::sync::Arc;
use tauri::{AppHandle, Manager, Runtime};
use tokio::sync::RwLock;

/// Global application state managed by Tauri
pub struct AppState {
    pub db_manager: DatabaseManager,
    /// Supabase user.id of the currently authenticated user. None when logged out.
    /// Set via `set_current_user` Tauri command on login, cleared by `clear_current_user` on logout.
    /// Used by repositories/commands to filter SQLite reads and tag SQLite writes (multi-account privacy).
    pub current_user_id: Arc<RwLock<Option<String>>>,
    /// ¿El usuario actual completó el formulario de registro (`maity.users.
    /// registration_form_completed`)? `None` = desconocido (sin sesión, o la RPC
    /// `my_status` aún no respondió y no hay caché local). Lo escribe
    /// `set_registration_status` (frontend) y lo siembra `set_current_user`
    /// desde la caché monótona de `registration_status.rs`. Ver
    /// `registration_completed()` — el gate es FAIL-CLOSED (#66).
    pub registration_completed: Arc<RwLock<Option<bool>>>,
}

impl AppState {
    /// Get the current user id, if any
    pub async fn current_user_id(&self) -> Option<String> {
        self.current_user_id.read().await.clone()
    }
}

/// ¿Hay un usuario logueado? Gate de sesión para los entrypoints NATIVOS de
/// grabación (tray, scheduler) y del coach-float, que no pasan por el AuthGate
/// de React. `try_state` (no `state`) porque en first-launch el orden de
/// `manage` respecto a los spawns del setup no está garantizado.
pub async fn has_session<R: Runtime>(app: &AppHandle<R>) -> bool {
    match app.try_state::<AppState>() {
        Some(s) => s.current_user_id().await.is_some(),
        None => false,
    }
}

/// ¿Consta que el usuario actual completó el registro? Gate de registro para
/// el embudo de grabación (`initialize_recording`), el scheduler y el tray.
///
/// FAIL-CLOSED a propósito (#66): `None` (desconocido) cuenta como `false`.
/// Un usuario registrado que arranca sin red no queda bloqueado porque
/// `set_current_user` siembra `Some(true)` desde la caché local si ya se le
/// vio completado alguna vez (el flag en la DB solo avanza).
pub async fn registration_completed<R: Runtime>(app: &AppHandle<R>) -> bool {
    match app.try_state::<AppState>() {
        Some(s) => *s.registration_completed.read().await == Some(true),
        None => false,
    }
}
