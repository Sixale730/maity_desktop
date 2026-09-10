use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::{migrate::MigrateDatabase, Result, Sqlite, SqlitePool, Transaction};
use std::fs;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use tauri::Manager;

/// Compañero `-wal` de un archivo SQLite: sufijo pegado al nombre completo
/// (`x.sqlite` → `x.sqlite-wal`, `x.sqlite.bak` → `x.sqlite.bak-wal`).
fn bak_companion_wal(path: &Path) -> PathBuf {
    PathBuf::from(format!("{}-wal", path.to_string_lossy()))
}

/// Tope de conexiones del pool (#28 de la auditoría). sqlx abre conexiones bajo demanda y
/// reapera las inactivas a los 10 min, así que esto acota el PICO de page cache
/// (≤ 4 × 2 MB en vez de ≤ 10 × 2 MB), no la memoria residente en reposo. Ningún sitio pide
/// una 2.ª conexión mientras sostiene la 1.ª (las transacciones de los repositorios son
/// cortas y el worker de sync no retiene conexión durante el HTTP), por eso 4 no puede
/// producir deadlock; un 5.º concurrente espera milisegundos (`acquire_timeout` 30 s).
pub(crate) const POOL_MAX_CONNECTIONS: u32 = 4;

/// Opciones de conexión de producción. Todo pool sobre la DB de la app DEBE pasar por aquí
/// (no volver a `SqlitePool::connect(path)` pelón):
///
/// - **WAL explícito.** sqlx 0.8 NO fija `journal_mode` en las conexiones; el WAL que hoy
///   tienen las DBs lo puso `Sqlite::create_database` al crear el archivo (flag interno
///   `CREATE_DB_WAL`). Una DB copiada del backend legacy (`meeting_minutes.db`) queda en
///   modo rollback para siempre, y ahí `synchronous=NORMAL` sí puede corromper. Fijarlo aquí
///   es no-op cuando la DB ya está en WAL (mismo modo = sin lock) y convierte la legacy en la
///   1.ª conexión de `new()`, antes de compartir el pool, así que el lock exclusivo que exige
///   el cambio de modo (y que `busy_timeout` no espera) nunca compite con nadie.
/// - **`synchronous=NORMAL`.** En WAL no corrompe nunca. Ante crash o kill de la app no se
///   pierde nada (los commits ya están en la caché del SO). Sólo tras corte de luz/BSOD
///   pueden perderse los commits posteriores al último checkpoint (automático cada ~4 MB de
///   WAL, y `cleanup()` hace TRUNCATE al cerrar). A cambio, un fsync menos por commit.
///   Es el ajuste que la doc de SQLite recomienda para apps de escritorio en WAL.
/// - `busy_timeout` (5 s) y `foreign_keys` (ON) quedan en el default de sqlx.
pub(crate) fn connect_options(path: &str) -> Result<SqliteConnectOptions> {
    Ok(SqliteConnectOptions::from_str(path)?
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal))
}

pub(crate) fn pool_options() -> SqlitePoolOptions {
    SqlitePoolOptions::new().max_connections(POOL_MAX_CONNECTIONS)
}

#[derive(Clone)]
pub struct DatabaseManager {
    pool: SqlitePool,
}

impl DatabaseManager {
    pub async fn new(tauri_db_path: &str, backend_db_path: &str) -> Result<Self> {
        if let Some(parent_dir) = Path::new(tauri_db_path).parent() {
            if !parent_dir.exists() {
                fs::create_dir_all(parent_dir).map_err(|e| sqlx::Error::Io(e))?;
            }
        }

        if !Path::new(tauri_db_path).exists() {
            if Path::new(backend_db_path).exists() {
                log::info!(
                    "Copying database from {} to {}",
                    backend_db_path,
                    tauri_db_path
                );
                fs::copy(backend_db_path, tauri_db_path).map_err(|e| sqlx::Error::Io(e))?;
            } else {
                log::info!("Creating database at {}", tauri_db_path);
                Sqlite::create_database(tauri_db_path).await?;
            }
        }

        // Pragmas y tope del pool: ver `connect_options` / `POOL_MAX_CONNECTIONS` (#28).
        let pool = pool_options()
            .connect_with(connect_options(tauri_db_path)?)
            .await?;

        // Tolerar una DB "más nueva" que este binario: si la base tiene migraciones aplicadas que
        // esta versión NO conoce (p. ej. el usuario abrió una versión vieja después de probar/instalar
        // una más nueva, o tras un rollback), las ignoramos en lugar de abortar el arranque con
        // "migration X was previously applied but is missing in the resolved migrations".
        // Es seguro porque nuestras migraciones son aditivas (ADD COLUMN): una app vieja simplemente
        // no usa la columna nueva. SIN esto, un downgrade rompe el arranque y asusta al usuario.
        let mut migrator = sqlx::migrate!("./migrations");
        migrator.set_ignore_missing(true);
        migrator.run(&pool).await?;

        Ok(DatabaseManager { pool })
    }

    // NOTE: So for the first time users they needs to start the application
    // after they can just delete the existing .sqlite file and then copy the existing .db file to
    // the current app dir, So the system detects legacy db and copy it and starts with that data
    // (Newly created .sqlite with the copied content from .db)
    pub async fn new_from_app_handle(app_handle: &tauri::AppHandle) -> Result<Self> {
        // Resolve the app's data directory
        let app_data_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|e| sqlx::Error::Configuration(format!("failed to get app data dir: {}", e).into()))?;
        if !app_data_dir.exists() {
            fs::create_dir_all(&app_data_dir).map_err(|e| sqlx::Error::Io(e))?;
        }

        // Define database paths
        let tauri_db_path = app_data_dir
            .join("meeting_minutes.sqlite")
            .to_string_lossy()
            .to_string();
        // Legacy backend DB path (for auto-migration if exists)
        let backend_db_path = app_data_dir
            .join("meeting_minutes.db")
            .to_string_lossy()
            .to_string();

        // WAL file paths for defensive cleanup
        let wal_path = app_data_dir.join("meeting_minutes.sqlite-wal");
        let shm_path = app_data_dir.join("meeting_minutes.sqlite-shm");

        log::info!("Tauri DB path: {}", tauri_db_path);
        log::info!("Legacy backend DB path: {}", backend_db_path);

        // Try to open database with defensive WAL handling
        match Self::new(&tauri_db_path, &backend_db_path).await {
            Ok(db_manager) => {
                log::info!("Database opened successfully");
                Ok(db_manager)
            }
            Err(e) => {
                // Check if error is due to corrupted WAL file
                let error_msg = e.to_string();
                if error_msg.contains("malformed") || error_msg.contains("corrupt") {
                    log::warn!("Database appears corrupted, likely due to orphaned WAL file. Attempting recovery...");
                    log::warn!("Error details: {}", error_msg);

                    // Delete potentially corrupted WAL/SHM files
                    if wal_path.exists() {
                        match fs::remove_file(&wal_path) {
                            Ok(_) => log::info!("Removed orphaned WAL file: {:?}", wal_path),
                            Err(e) => log::warn!("Failed to remove WAL file: {}", e),
                        }
                    }
                    if shm_path.exists() {
                        match fs::remove_file(&shm_path) {
                            Ok(_) => log::info!("Removed orphaned SHM file: {:?}", shm_path),
                            Err(e) => log::warn!("Failed to remove SHM file: {}", e),
                        }
                    }

                    // Retry connection without WAL files
                    log::info!("Retrying database connection after WAL cleanup...");
                    match Self::new(&tauri_db_path, &backend_db_path).await {
                        Ok(db_manager) => {
                            log::info!("Database opened successfully after WAL recovery");
                            Ok(db_manager)
                        }
                        Err(retry_err) => {
                            log::error!("Database connection failed even after WAL cleanup: {}", retry_err);
                            Err(retry_err)
                        }
                    }
                } else {
                    // Not a WAL-related error, propagate original error
                    log::error!("Database connection failed: {}", error_msg);
                    Err(e)
                }
            }
        }
    }

    /// Check if this is the first launch (sqlite database doesn't exist yet)
    pub async fn is_first_launch(app_handle: &tauri::AppHandle) -> Result<bool> {
        let app_data_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|e| sqlx::Error::Configuration(format!("failed to get app data dir: {}", e).into()))?;

        let tauri_db_path = app_data_dir.join("meeting_minutes.sqlite");

        Ok(!tauri_db_path.exists())
    }

    /// Import a legacy database from the specified path and initialize
    pub async fn import_legacy_database(
        app_handle: &tauri::AppHandle,
        legacy_db_path: &str,
    ) -> Result<Self> {
        let app_data_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|e| sqlx::Error::Configuration(format!("failed to get app data dir: {}", e).into()))?;

        if !app_data_dir.exists() {
            fs::create_dir_all(&app_data_dir).map_err(|e| sqlx::Error::Io(e))?;
        }

        // Copy legacy database to app data directory as meeting_minutes.db
        let target_legacy_path = app_data_dir.join("meeting_minutes.db");
        log::info!(
            "Copying legacy database from {} to {}",
            legacy_db_path,
            target_legacy_path.display()
        );

        fs::copy(legacy_db_path, &target_legacy_path).map_err(|e| sqlx::Error::Io(e))?;

        // Now use the standard initialization which will detect and migrate the legacy db
        Self::new_from_app_handle(app_handle).await
    }

    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    pub async fn with_transaction<T, F, Fut>(&self, f: F) -> Result<T>
    where
        F: FnOnce(&mut Transaction<'_, Sqlite>) -> Fut,
        Fut: std::future::Future<Output = Result<T>>,
    {
        let mut tx = self.pool.begin().await?;
        let result = f(&mut tx).await;

        match result {
            Ok(val) => {
                tx.commit().await?;
                Ok(val)
            }
            Err(err) => {
                tx.rollback().await?;
                Err(err)
            }
        }
    }

    /// Checkpoint del WAL al archivo principal SIN cerrar el pool (a diferencia de
    /// `cleanup()`). TRUNCATE: vuelca todas las páginas y trunca el WAL a cero.
    /// El caller decide si el fallo es fatal (en el flujo rival es solo warn).
    pub async fn checkpoint(&self) -> Result<()> {
        sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Respaldo en caliente de la DB a `bak_path` (+ compañero `<bak>-wal` si aplica).
    ///
    /// Primario: `VACUUM INTO` — copia consistente por construcción sin importar writers
    /// concurrentes ni el estado del WAL (SQLite exige que el destino NO exista, por eso
    /// se borran los restos previos). Fallback: copia de archivos — el main más el `-wal`
    /// solo si tiene contenido. El `-shm` NUNCA se copia: es un índice de memoria
    /// compartida que SQLite regenera al abrir.
    pub async fn backup_to(&self, db_path: &Path, bak_path: &Path) -> Result<()> {
        let bak_wal = bak_companion_wal(bak_path);
        for stale in [bak_path, bak_wal.as_path()] {
            if stale.exists() {
                fs::remove_file(stale).map_err(sqlx::Error::Io)?;
            }
        }

        let vacuum = sqlx::query("VACUUM INTO ?1")
            .bind(bak_path.to_string_lossy().as_ref())
            .execute(&self.pool)
            .await;
        match vacuum {
            Ok(_) => {
                log::info!("Respaldo de DB creado con VACUUM INTO: {}", bak_path.display());
                Ok(())
            }
            Err(e) => {
                log::warn!(
                    "VACUUM INTO falló ({}), usando copia de archivos como fallback",
                    e
                );
                fs::copy(db_path, bak_path).map_err(sqlx::Error::Io)?;
                let wal_path = bak_companion_wal(db_path);
                let wal_has_content = wal_path
                    .metadata()
                    .map(|m| m.len() > 0)
                    .unwrap_or(false);
                if wal_has_content {
                    fs::copy(&wal_path, &bak_wal).map_err(sqlx::Error::Io)?;
                }
                log::info!("Respaldo de DB creado por copia: {}", bak_path.display());
                Ok(())
            }
        }
    }

    /// Cleanup database connection and checkpoint WAL
    /// This should be called on application shutdown to ensure:
    /// - All WAL changes are written to the main database file
    /// - The .wal and .shm files are deleted
    /// - Connection pool is gracefully closed
    pub async fn cleanup(&self) -> Result<()> {
        log::info!("Starting database cleanup...");

        // Force checkpoint of WAL to main database file and remove WAL file
        // TRUNCATE mode: checkpoints all pages AND deletes the WAL file
        match sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
            .execute(&self.pool)
            .await
        {
            Ok(_) => log::info!("WAL checkpoint completed successfully"),
            Err(e) => log::warn!("WAL checkpoint failed (non-fatal): {}", e),
        }

        // Close the connection pool gracefully
        self.pool.close().await;
        log::info!("Database connection pool closed");

        Ok(())
    }
}

#[cfg(test)]
mod pool_tests {
    use super::*;
    use sqlx::ConnectOptions;

    async fn journal_mode(pool: &SqlitePool) -> String {
        let (mode,): (String,) = sqlx::query_as("PRAGMA journal_mode")
            .fetch_one(pool)
            .await
            .unwrap();
        mode
    }

    /// `PRAGMA synchronous` devuelve entero: 0 OFF, 1 NORMAL, 2 FULL, 3 EXTRA.
    async fn synchronous(pool: &SqlitePool) -> i64 {
        let (level,): (i64,) = sqlx::query_as("PRAGMA synchronous")
            .fetch_one(pool)
            .await
            .unwrap();
        level
    }

    #[tokio::test]
    async fn new_aplica_wal_normal_y_4_conexiones() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("t.sqlite");
        let missing_legacy = dir.path().join("no-existe.db");
        let mgr = DatabaseManager::new(
            db_path.to_str().unwrap(),
            missing_legacy.to_str().unwrap(),
        )
        .await
        .unwrap();

        assert_eq!(journal_mode(mgr.pool()).await, "wal");
        assert_eq!(synchronous(mgr.pool()).await, 1, "NORMAL");
        assert_eq!(
            mgr.pool().options().get_max_connections(),
            POOL_MAX_CONNECTIONS
        );
        mgr.cleanup().await.unwrap();
    }

    /// Camino de la copia del backend legacy (`meeting_minutes.db` → `.sqlite`): la DB nace
    /// en modo rollback (sqlx 0.8 no fija `journal_mode`) y `new()` la convierte a WAL.
    #[tokio::test]
    async fn new_convierte_db_legacy_en_rollback_a_wal() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("legacy.sqlite");
        let missing_legacy = dir.path().join("no-existe.db");

        let rollback_opts = SqliteConnectOptions::new()
            .filename(&db_path)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Delete);
        let mut conn = rollback_opts.connect().await.unwrap();
        sqlx::query("CREATE TABLE legacy (id INTEGER PRIMARY KEY)")
            .execute(&mut conn)
            .await
            .unwrap();
        let (before,): (String,) = sqlx::query_as("PRAGMA journal_mode")
            .fetch_one(&mut conn)
            .await
            .unwrap();
        assert_eq!(before, "delete", "precondición: la DB legacy está en rollback");
        drop(conn);

        let mgr = DatabaseManager::new(
            db_path.to_str().unwrap(),
            missing_legacy.to_str().unwrap(),
        )
        .await
        .unwrap();
        assert_eq!(journal_mode(mgr.pool()).await, "wal");
        assert_eq!(synchronous(mgr.pool()).await, 1);
        mgr.cleanup().await.unwrap();
    }
}

#[cfg(test)]
mod maintenance_tests {
    use super::*;

    /// Pool sobre archivo real en tempdir (no `:memory:`): estos tests verifican el
    /// comportamiento de los archivos `-wal`/`.bak` en disco. Mismos pragmas que producción
    /// (`connect_options`: WAL + NORMAL); una sola conexión para que el checkpoint no
    /// compita con lectores.
    async fn file_manager(db_path: &Path) -> DatabaseManager {
        Sqlite::create_database(db_path.to_str().unwrap())
            .await
            .unwrap();
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(connect_options(db_path.to_str().unwrap()).unwrap())
            .await
            .unwrap();
        sqlx::query("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO t (v) VALUES ('x'), ('y')")
            .execute(&pool)
            .await
            .unwrap();
        DatabaseManager { pool }
    }

    #[tokio::test]
    async fn checkpoint_trunca_el_wal_sin_cerrar_el_pool() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("test.sqlite");
        let mgr = file_manager(&db_path).await;

        let wal = bak_companion_wal(&db_path);
        assert!(
            wal.metadata().map(|m| m.len() > 0).unwrap_or(false),
            "precondición: tras los INSERT el -wal debe tener contenido"
        );

        mgr.checkpoint().await.unwrap();
        assert_eq!(wal.metadata().map(|m| m.len()).unwrap_or(0), 0);

        // El pool sigue vivo (a diferencia de cleanup()).
        sqlx::query("INSERT INTO t (v) VALUES ('z')")
            .execute(mgr.pool())
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn checkpoint_sobre_pool_cerrado_da_err_sin_panic() {
        let dir = tempfile::tempdir().unwrap();
        let mgr = file_manager(&dir.path().join("test.sqlite")).await;
        mgr.cleanup().await.unwrap();
        assert!(mgr.checkpoint().await.is_err());
    }

    #[tokio::test]
    async fn cleanup_es_idempotente() {
        // Cubre el doble-cleanup real: uninstall_rival cierra el pool y el
        // RunEvent::Exit posterior vuelve a llamar cleanup().
        let dir = tempfile::tempdir().unwrap();
        let mgr = file_manager(&dir.path().join("test.sqlite")).await;
        mgr.cleanup().await.unwrap();
        mgr.cleanup().await.unwrap();
    }

    #[tokio::test]
    async fn backup_to_crea_bak_integro_y_borra_stale() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("test.sqlite");
        let bak_path = dir.path().join("test.sqlite.bak");
        let mgr = file_manager(&db_path).await;

        // Restos de un respaldo anterior: VACUUM INTO exige destino inexistente.
        std::fs::write(&bak_path, b"stale-garbage").unwrap();
        std::fs::write(bak_companion_wal(&bak_path), b"stale-wal").unwrap();

        mgr.backup_to(&db_path, &bak_path).await.unwrap();

        let bak_pool = SqlitePool::connect(bak_path.to_str().unwrap()).await.unwrap();
        let integrity: (String,) = sqlx::query_as("PRAGMA integrity_check")
            .fetch_one(&bak_pool)
            .await
            .unwrap();
        assert_eq!(integrity.0, "ok");
        let count: (i64,) = sqlx::query_as("SELECT count(*) FROM t")
            .fetch_one(&bak_pool)
            .await
            .unwrap();
        assert_eq!(count.0, 2, "el respaldo debe traer los datos, no el stale");
        bak_pool.close().await;
    }
}
