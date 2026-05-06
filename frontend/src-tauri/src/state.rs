use std::sync::Arc;
use tokio::sync::RwLock;

use crate::database::manager::DatabaseManager;

pub struct AppState {
    pub db_manager: DatabaseManager,
    /// Supabase user.id of the currently authenticated user. None when logged out.
    /// Set via `set_current_user` Tauri command on login, cleared by `clear_current_user` on logout.
    /// Used by repositories/commands to filter SQLite reads and tag SQLite writes (multi-account privacy).
    pub current_user_id: Arc<RwLock<Option<String>>>,
}

impl AppState {
    /// Read the current user_id. Returns None when not logged in.
    pub async fn current_user_id(&self) -> Option<String> {
        self.current_user_id.read().await.clone()
    }
}
