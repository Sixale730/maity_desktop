use log::{error, info};
use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager, Runtime};

use super::manager::DatabaseManager;
use super::repositories::meeting::MeetingsRepository;
use super::repositories::recording_log::RecordingLogRepository;
use crate::database::models::RecordingLog;
use crate::events;
use crate::state::AppState;

#[derive(Serialize)]
pub struct DatabaseCheckResult {
    pub exists: bool,
    pub size: u64,
}

/// Check if this is the first launch (no database exists yet)
#[tauri::command]
pub async fn check_first_launch(app: AppHandle) -> Result<bool, String> {
    DatabaseManager::is_first_launch(&app)
        .await
        .map_err(|e| format!("Failed to check first launch: {}", e))
}

/// Open a dialog to select a folder or file for legacy database import
#[tauri::command]
pub async fn select_legacy_database_path(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    info!("Opening dialog to select legacy database location");

    let file_path = app
        .dialog()
        .file()
        .add_filter("Database Files", &["db"])
        .blocking_pick_file();

    if let Some(path) = file_path {
        let path_str = path.to_string();
        info!("User selected path: {}", path_str);
        Ok(Some(path_str))
    } else {
        info!("User cancelled file selection");
        Ok(None)
    }
}

/// Detect legacy database from a selected path (root repo, backend folder, or db file)
#[tauri::command]
pub async fn detect_legacy_database(selected_path: String) -> Result<Option<String>, String> {
    let path = PathBuf::from(&selected_path);

    info!("Detecting legacy database from path: {}", selected_path);

    // Case 1: User selected the .db file directly
    if path.is_file() {
        if let Some(extension) = path.extension() {
            if extension == "db" {
                info!("Direct .db file selected: {}", selected_path);
                return Ok(Some(selected_path));
            }
        }
    }

    // Case 2: User selected directory containing meeting_minutes.db
    if path.is_dir() {
        let direct_db = path.join("meeting_minutes.db");
        if direct_db.exists() && direct_db.is_file() {
            let db_path = direct_db.to_string_lossy().to_string();
            info!("Found database in selected directory: {}", db_path);
            return Ok(Some(db_path));
        }

        // Case 3: User selected root repo (check backend subdirectory)
        let backend_db = path.join("backend").join("meeting_minutes.db");
        if backend_db.exists() && backend_db.is_file() {
            let db_path = backend_db.to_string_lossy().to_string();
            info!("Found database in backend subdirectory: {}", db_path);
            return Ok(Some(db_path));
        }
    }

    info!("No legacy database found at path: {}", selected_path);
    Ok(None)
}

/// Check for legacy database in the default app data directory
#[tauri::command]
pub async fn check_default_legacy_database(app: AppHandle) -> Result<Option<String>, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let legacy_db = app_data_dir.join("meeting_minutes.db");
    info!("Checking for default legacy database at: {:?}", legacy_db);

    if legacy_db.exists() && legacy_db.is_file() {
        let path_str = legacy_db.to_string_lossy().to_string();
        info!("Found default legacy database: {}", path_str);
        Ok(Some(path_str))
    } else {
        info!("No default legacy database found");
        Ok(None)
    }
}

/// Check if the Homebrew database exists and return its size
/// This is specifically for detecting old Python backend installations
#[tauri::command]
pub async fn check_homebrew_database(path: String) -> Result<Option<DatabaseCheckResult>, String> {
    let db_path = PathBuf::from(&path);
    
    info!("Checking for Homebrew database at: {}", path);
    
    // Check if file exists and is a regular file
    if db_path.exists() && db_path.is_file() {
        // Get file metadata to check size
        match std::fs::metadata(&db_path) {
            Ok(metadata) => {
                let size = metadata.len();
                info!("Found Homebrew database: {} ({} bytes)", path, size);
                
                // Only consider it valid if it has content (not empty)
                if size > 0 {
                    Ok(Some(DatabaseCheckResult {
                        exists: true,
                        size,
                    }))
                } else {
                    info!("Database file exists but is empty");
                    Ok(None)
                }
            }
            Err(e) => {
                error!("Failed to read database metadata: {}", e);
                Ok(None)
            }
        }
    } else {
        info!("No database found at Homebrew location");
        Ok(None)
    }
}

/// Import legacy database and initialize the database manager
#[tauri::command]
pub async fn import_and_initialize_database(
    app: AppHandle,
    legacy_db_path: String,
) -> Result<(), String> {
    info!(
        "Starting import of legacy database from: {}",
        legacy_db_path
    );

    // Import and get initialized manager
    let db_manager = DatabaseManager::import_legacy_database(&app, &legacy_db_path)
        .await
        .map_err(|e| {
            error!("Failed to import legacy database: {}", e);
            format!("Failed to import database: {}", e)
        })?;

    // Update app state with the new manager
    app.manage(AppState {
        db_manager,
        current_user_id: std::sync::Arc::new(tokio::sync::RwLock::new(None)),
        registration_completed: std::sync::Arc::new(tokio::sync::RwLock::new(None)),
    });

    info!("Legacy database imported and initialized successfully");

    // Emit event to notify frontend that database is ready
    app.emit(events::DATABASE_INITIALIZED, ())
        .map_err(|e| format!("Failed to emit database-initialized event: {}", e))?;

    Ok(())
}

/// Initialize a fresh database (for users who don't want to import)
#[tauri::command]
pub async fn initialize_fresh_database(app: AppHandle) -> Result<(), String> {
    info!("Initializing fresh database");

    let db_manager = DatabaseManager::new_from_app_handle(&app)
        .await
        .map_err(|e| {
            error!("Failed to initialize fresh database: {}", e);
            format!("Failed to initialize database: {}", e)
        })?;

    // Update app state with the new manager
    app.manage(AppState {
        db_manager: db_manager.clone(),
        current_user_id: std::sync::Arc::new(tokio::sync::RwLock::new(None)),
        registration_completed: std::sync::Arc::new(tokio::sync::RwLock::new(None)),
    });

    // Set default model configuration for fresh installs
    let pool = db_manager.pool();
    
    // Default Summary Model: OpenAI API (cloud)
    if let Err(e) = crate::database::repositories::setting::SettingsRepository::save_model_config(
        pool,
        "custom-openai",  // Changed from "builtin-ai" for cloud-only mode
        "gpt-4o-mini",    // Default OpenAI model
        "large-v3",       // Default whisper model (unused for cloud but required)
        None,
    ).await {
        error!("Failed to set default summary model config: {}", e);
    }

    // Default Transcription Model: Deepgram (cloud)
    if let Err(e) = crate::database::repositories::setting::SettingsRepository::save_transcript_config(
        pool,
        "deepgram",       // Changed from "parakeet" for cloud-only mode
        "nova-3",         // Deepgram's best model with Spanish support
        Some("es-419"),   // Latin American Spanish
    ).await {
        error!("Failed to set default transcription model config: {}", e);
    }

    info!("Fresh database initialized successfully with default models");

    // Emit event to notify frontend that database is ready
    app.emit(events::DATABASE_INITIALIZED, ())
        .map_err(|e| format!("Failed to emit database-initialized event: {}", e))?;

    Ok(())
}

/// Get the database directory path
#[tauri::command]
pub async fn get_database_directory(app: AppHandle) -> Result<String, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    Ok(app_data_dir.to_string_lossy().to_string())
}

/// Open the database folder in the system file explorer
#[tauri::command]
pub async fn open_database_folder(app: AppHandle) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    // Ensure directory exists before trying to open it
    if !app_data_dir.exists() {
        std::fs::create_dir_all(&app_data_dir)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    let folder_path = app_data_dir.to_string_lossy().to_string();

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&folder_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&folder_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&folder_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    info!("Opened database folder: {}", folder_path);
    Ok(())
}

// ===== RECORDING LOG COMMANDS =====

/// Insert a recording lifecycle event into the local recording_logs table
#[tauri::command]
pub async fn log_recording_event<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    session_id: String,
    event_type: String,
    event_data: Option<String>,
    status: Option<String>,
    error: Option<String>,
    meeting_id: Option<String>,
    app_version: Option<String>,
    device_info: Option<String>,
) -> Result<i64, String> {
    let pool = state.db_manager.pool();
    RecordingLogRepository::log_event(
        pool,
        &session_id,
        &event_type,
        event_data.as_deref(),
        status.as_deref(),
        error.as_deref(),
        meeting_id.as_deref(),
        app_version.as_deref(),
        device_info.as_deref(),
    )
    .await
    .map_err(|e| {
        error!("Failed to log recording event: {}", e);
        e.to_string()
    })
}

/// Get recording logs by session or recent
#[tauri::command]
pub async fn get_recording_logs<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    session_id: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<RecordingLog>, String> {
    let pool = state.db_manager.pool();
    if let Some(sid) = session_id {
        RecordingLogRepository::get_logs_by_session(pool, &sid)
            .await
            .map_err(|e| e.to_string())
    } else {
        RecordingLogRepository::get_recent_logs(pool, limit.unwrap_or(100))
            .await
            .map_err(|e| e.to_string())
    }
}

/// Get logs not yet synced to cloud
#[tauri::command]
pub async fn get_unsynced_recording_logs<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    limit: Option<i64>,
) -> Result<Vec<RecordingLog>, String> {
    let pool = state.db_manager.pool();
    RecordingLogRepository::get_unsynced_logs(pool, limit.unwrap_or(200))
        .await
        .map_err(|e| e.to_string())
}

/// Mark recording logs as synced to cloud
#[tauri::command]
pub async fn mark_recording_logs_synced<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    ids: Vec<i64>,
) -> Result<u64, String> {
    let pool = state.db_manager.pool();
    RecordingLogRepository::mark_as_synced(pool, &ids)
        .await
        .map_err(|e| e.to_string())
}

/// Save user feedback: coach tip like/dislike or post-session rating.
/// Returns the generated feedback id for optional cloud sync from the frontend.
#[tauri::command]
pub async fn save_user_feedback<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: Option<String>,
    feedback_type: String,
    rating: Option<String>,
    message: Option<String>,
    metadata: Option<String>,
) -> Result<String, String> {
    let pool = state.db_manager.pool();
    let id = uuid::Uuid::new_v4().to_string();

    sqlx::query(
        "INSERT INTO user_feedback (id, meeting_id, feedback_type, rating, message, metadata) \
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&meeting_id)
    .bind(&feedback_type)
    .bind(&rating)
    .bind(&message)
    .bind(&metadata)
    .execute(pool)
    .await
    .map_err(|e| {
        error!("Failed to save user feedback: {}", e);
        e.to_string()
    })?;

    info!("Saved user feedback: type={} id={}", feedback_type, id);
    Ok(id)
}

/// Atomically read-or-create the cloud idempotency key for a meeting.
/// First call generates a UUID v4 and persists it; subsequent calls return
/// the same value. Used by the cloud sync flow so retries of save_conversation
/// collapse via the UNIQUE (idempotency_key) constraint on omi_conversations.
#[tauri::command]
pub async fn api_get_or_create_meeting_idempotency_key(
    state: tauri::State<'_, AppState>,
    meeting_id: String,
) -> Result<String, String> {
    MeetingsRepository::get_or_create_idempotency_key(state.db_manager.pool(), &meeting_id)
        .await
        .map_err(|e| {
            error!(
                "Failed to get_or_create idempotency key for meeting {}: {}",
                meeting_id, e
            );
            e.to_string()
        })
}

/// Set the current Supabase user.id in AppState. Called by frontend on login.
/// Subsequent SQLite reads/writes use this to filter (privacy isolation between accounts).
#[tauri::command]
pub async fn set_current_user<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    user_id: String,
) -> Result<(), String> {
    // Detectar la transición None→Some (login real). Re-invocaciones con el
    // mismo id (remounts de AuthContext, refresh de maityUser) no cuentan.
    let was_logged_out = {
        let mut guard = state.current_user_id.write().await;
        let was = guard.is_none();
        *guard = Some(user_id.clone());
        was
    };
    info!("[AppState] current_user_id set to {}", user_id);

    // Gate de registro (#66): sembrar desde la caché monótona local para que un
    // usuario ya registrado pueda grabar aunque la RPC `my_status` falle
    // (arranque sin red). Solo en la transición de login — un remount de
    // AuthContext con el mismo id no debe pisar un valor ya confirmado por la
    // RPC (`set_registration_status`).
    if was_logged_out {
        let seeded = crate::registration_status::seed_from_cache(
            &user_id,
            &crate::registration_status::load_cache(&app),
        );
        *state.registration_completed.write().await = seeded;
        info!("[AppState] registration_completed sembrado desde caché: {:?}", seeded);
    }

    // El auto-open del coach-float vive AQUÍ (no en el setup de lib.rs): la
    // flotante solo aparece cuando hay usuario logueado. Respeta la pref de
    // visibilidad y el override de STARTED_AT_BOOT (ver open_coach_on_login).
    if was_logged_out {
        tauri::async_runtime::spawn(async move {
            crate::coach::commands::open_coach_on_login(app).await;
        });
    }
    Ok(())
}

/// Clear the current user from AppState. Called by frontend on logout.
/// After this, SQLite queries return empty and writes that require a user fail.
#[tauri::command]
pub async fn clear_current_user<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    {
        let mut guard = state.current_user_id.write().await;
        *guard = None;
    }
    *state.registration_completed.write().await = None;
    info!("[AppState] current_user_id cleared (logout)");
    // Sin sesión no hay coach-float. Idempotente (no-op si no existe la ventana);
    // también dispara al montar AuthContext con maityUser aún null — inofensivo.
    let _ = crate::coach::commands::close_floating_coach(app).await;
    Ok(())
}

/// Backup the local SQLite database and rename it out of the way.
///
/// Used by `DbInitErrorGate` when the DB failed to initialize and the user
/// chooses "Restablecer base de datos". The current file is renamed to
/// `meeting_minutes.sqlite.broken-{timestamp}` (preserving WAL/SHM as well
/// for forensia) and the next app launch will create a fresh database.
///
/// Returns the absolute path of the backup so the UI can show it to the user.
/// Does NOT restart the app — the caller asks the user to close and reopen.
#[tauri::command]
pub async fn reset_database<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No se pudo localizar la carpeta de datos: {}", e))?;

    let db_path = app_data.join("meeting_minutes.sqlite");
    if !db_path.exists() {
        info!("[reset_database] No DB file at {:?}, nothing to do", db_path);
        return Ok(String::new());
    }

    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();
    let backup_path: PathBuf = app_data.join(format!("meeting_minutes.sqlite.broken-{}", timestamp));

    std::fs::rename(&db_path, &backup_path)
        .map_err(|e| format!("No se pudo respaldar la base de datos: {}", e))?;

    // SQLite WAL + SHM live next to the main file. Move them too so the next
    // launch starts truly clean — leaving them around can confuse a fresh db.
    for suffix in &["-wal", "-shm"] {
        let aux = app_data.join(format!("meeting_minutes.sqlite{}", suffix));
        if aux.exists() {
            let aux_backup = app_data.join(format!("meeting_minutes.sqlite{}.broken-{}", suffix, timestamp));
            if let Err(e) = std::fs::rename(&aux, &aux_backup) {
                error!("[reset_database] Failed to rename {:?}: {}", aux, e);
            }
        }
    }

    info!("[reset_database] DB backed up to {:?}", backup_path);
    Ok(backup_path.to_string_lossy().to_string())
}

/// Metadatos del respaldo `.bak` que deja `uninstall_rival` antes de cerrar la DB.
#[derive(Serialize)]
pub struct DbBackupInfo {
    pub path: String,
    /// Epoch en segundos de la última modificación (para mostrar la fecha en el gate).
    pub modified_epoch_s: u64,
    pub size_bytes: u64,
}

/// Devuelve `Some(info)` si existe `meeting_minutes.sqlite.bak` (respaldo creado por el
/// flujo de desinstalación del rival). `DbInitErrorGate` lo usa para decidir si ofrece
/// "Restaurar respaldo" además de "Restablecer".
#[tauri::command]
pub async fn get_db_backup_info<R: Runtime>(app: AppHandle<R>) -> Result<Option<DbBackupInfo>, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No se pudo localizar la carpeta de datos: {}", e))?;
    let bak_path = app_data.join("meeting_minutes.sqlite.bak");
    let Ok(meta) = std::fs::metadata(&bak_path) else {
        return Ok(None);
    };
    let modified_epoch_s = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    Ok(Some(DbBackupInfo {
        path: bak_path.to_string_lossy().to_string(),
        modified_epoch_s,
        size_bytes: meta.len(),
    }))
}

/// Restaura el respaldo `.bak` sobre una DB corrupta. Espejo de `reset_database`:
/// mismo contrato (solo lo invoca `DbInitErrorGate` con el pool SIN abrir — de otro modo
/// los rename fallan por locks de Windows — y NO reinicia la app: el caller pide al
/// usuario cerrar y reabrir).
///
/// Orden crítico: la DB corrupta Y sus `-wal`/`-shm` se apartan a `.broken-{ts}` ANTES de
/// colocar el respaldo. Un `-wal` huérfano junto al archivo restaurado comparte salts con
/// la DB vieja y SQLite lo REPLAYARÍA sobre la copia limpia al abrir → re-corrupción.
/// Si existe `.bak-wal` (fallback de copia de `backup_to`), se coloca como `-wal` del
/// restaurado: sus salts corresponden al `.bak`.
#[tauri::command]
pub async fn restore_db_backup<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No se pudo localizar la carpeta de datos: {}", e))?;
    restore_db_backup_in_dir(&app_data)
}

/// Cuerpo de `restore_db_backup` sobre un directorio concreto (testeable sin AppHandle).
fn restore_db_backup_in_dir(app_data: &std::path::Path) -> Result<String, String> {
    let bak_path = app_data.join("meeting_minutes.sqlite.bak");
    if !bak_path.exists() {
        // Anómalo: el botón de restaurar solo se muestra cuando get_db_backup_info
        // reportó un respaldo. Llegar aquí sin .bak amerita ERROR (y sirve de disparo
        // determinista para verificar el puente rust-error).
        error!("[restore_db_backup] No existe {:?}", bak_path);
        return Err("No hay respaldo .bak para restaurar".to_string());
    }

    let db_path = app_data.join("meeting_minutes.sqlite");
    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();

    if db_path.exists() {
        let broken_path: PathBuf =
            app_data.join(format!("meeting_minutes.sqlite.broken-{}", timestamp));
        std::fs::rename(&db_path, &broken_path)
            .map_err(|e| format!("No se pudo apartar la base corrupta: {}", e))?;
    }
    for suffix in &["-wal", "-shm"] {
        let aux = app_data.join(format!("meeting_minutes.sqlite{}", suffix));
        if aux.exists() {
            let aux_backup =
                app_data.join(format!("meeting_minutes.sqlite{}.broken-{}", suffix, timestamp));
            if let Err(e) = std::fs::rename(&aux, &aux_backup) {
                error!("[restore_db_backup] Failed to rename {:?}: {}", aux, e);
            }
        }
    }

    std::fs::copy(&bak_path, &db_path)
        .map_err(|e| format!("No se pudo restaurar el respaldo: {}", e))?;
    let bak_wal = app_data.join("meeting_minutes.sqlite.bak-wal");
    if bak_wal.exists() {
        let wal_path = app_data.join("meeting_minutes.sqlite-wal");
        if let Err(e) = std::fs::copy(&bak_wal, &wal_path) {
            error!("[restore_db_backup] Failed to place .bak-wal: {}", e);
        }
    }

    info!("[restore_db_backup] Respaldo restaurado desde {:?}", bak_path);
    Ok(db_path.to_string_lossy().to_string())
}

#[cfg(test)]
mod restore_tests {
    use super::restore_db_backup_in_dir;

    /// Header mínimo válido de un archivo SQLite (solo para distinguir del garbage;
    /// la validez real del respaldo la cubren los tests de `backup_to` en manager.rs).
    const SQLITE_MAGIC: &[u8] = b"SQLite format 3\0";

    #[test]
    fn sin_bak_devuelve_err() {
        let dir = tempfile::tempdir().unwrap();
        let res = restore_db_backup_in_dir(dir.path());
        assert!(res.is_err());
        assert!(res.unwrap_err().contains(".bak"));
    }

    #[test]
    fn aparta_corrupta_y_wal_shm_huerfanos_antes_de_restaurar() {
        let dir = tempfile::tempdir().unwrap();
        let p = |n: &str| dir.path().join(n);
        std::fs::write(p("meeting_minutes.sqlite"), b"garbage-main").unwrap();
        // -wal/-shm huérfanos de la DB corrupta: si sobreviven junto al restaurado,
        // SQLite replayaría el WAL viejo sobre la copia limpia (re-corrupción).
        std::fs::write(p("meeting_minutes.sqlite-wal"), b"garbage-wal").unwrap();
        std::fs::write(p("meeting_minutes.sqlite-shm"), b"garbage-shm").unwrap();
        std::fs::write(p("meeting_minutes.sqlite.bak"), SQLITE_MAGIC).unwrap();

        restore_db_backup_in_dir(dir.path()).unwrap();

        let restored = std::fs::read(p("meeting_minutes.sqlite")).unwrap();
        assert_eq!(restored, SQLITE_MAGIC, "el main debe ser el contenido del .bak");
        assert!(
            !p("meeting_minutes.sqlite-wal").exists(),
            "el -wal huérfano debe quedar apartado, no junto al restaurado"
        );
        assert!(!p("meeting_minutes.sqlite-shm").exists());

        let broken: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.contains(".broken-"))
            .collect();
        assert_eq!(broken.len(), 3, "main + -wal + -shm apartados: {:?}", broken);
    }

    #[test]
    fn bak_wal_se_coloca_como_wal_del_restaurado() {
        let dir = tempfile::tempdir().unwrap();
        let p = |n: &str| dir.path().join(n);
        std::fs::write(p("meeting_minutes.sqlite"), b"garbage-main").unwrap();
        std::fs::write(p("meeting_minutes.sqlite.bak"), SQLITE_MAGIC).unwrap();
        // Fallback de copia de backup_to: el WAL cuyo salt corresponde al .bak.
        std::fs::write(p("meeting_minutes.sqlite.bak-wal"), b"bak-wal-frames").unwrap();

        restore_db_backup_in_dir(dir.path()).unwrap();

        let wal = std::fs::read(p("meeting_minutes.sqlite-wal")).unwrap();
        assert_eq!(wal, b"bak-wal-frames");
    }
}
