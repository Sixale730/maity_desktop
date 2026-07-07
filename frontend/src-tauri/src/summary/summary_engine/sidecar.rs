// Sidecar process lifecycle management for llama-helper
// Handles spawning, health checking, keep-alive, and graceful shutdown

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{anyhow, Context, Result};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout};
use tokio::sync::{Mutex, RwLock};

// Windows-specific extension for process creation (may be needed for future enhancements)
#[cfg(target_os = "windows")]
#[allow(unused_imports)]
use std::os::windows::process::CommandExt;

use super::models;

// ============================================================================
// Supervisión (jul-2026, reporte usuario)
// ============================================================================
//
// Antes: cada timeout de request MATABA el proceso (para sanear el pipe) y el
// siguiente request lo re-spawneaba recargando ~2.4 GB de modelo. Bajo carga,
// la carga tarda más que el timeout → death spiral (141 kills/hora en logs).
//
// Ahora, tres mecanismos (patrones: JSON-RPC ids / circuit-breaker strikes /
// restart-budget estilo Erlang OTP + backoff estilo CrashLoopBackOff):
// 1. Correlación por `id`: un timeout ya no envenena el pipe — la respuesta
//    tardía se descarta por id en el siguiente read. Sin necesidad de kill.
// 2. Strikes: N timeouts consecutivos ⇒ proceso presuntamente colgado ⇒ un
//    reinicio controlado (distinción liveness/readiness: 1 timeout = lento).
// 3. Presupuesto de reinicios: máx N spawns por ventana; agotado ⇒ cooldown.
//    Backoff creciente entre spawns para no martillar CPU/disco.

/// Secuencia global de ids de correlación (compartida entre managers del pool).
static REQUEST_SEQ: AtomicU64 = AtomicU64::new(1);

// ── Contadores de supervisión (proceso-globales, compartidos por el pool) ──
// Solo crecen durante la vida del proceso; los consumidores (session-summary
// del coach) toman snapshot al inicio de sesión y reportan el DELTA. Sin esto,
// los mecanismos de supervisión (strikes, restart budget, cooldown) actúan
// pero no dejan rastro medible fuera de los logs.
static SIDECAR_TIMEOUTS_TOTAL: AtomicU64 = AtomicU64::new(0);
static SIDECAR_RESTARTS_TOTAL: AtomicU64 = AtomicU64::new(0);
static SIDECAR_COOLDOWNS_TOTAL: AtomicU64 = AtomicU64::new(0);

/// Snapshot de los contadores de supervisión: `(timeouts, restarts, cooldowns)`.
pub fn supervision_counters() -> (u64, u64, u64) {
    (
        SIDECAR_TIMEOUTS_TOTAL.load(Ordering::Relaxed),
        SIDECAR_RESTARTS_TOTAL.load(Ordering::Relaxed),
        SIDECAR_COOLDOWNS_TOTAL.load(Ordering::Relaxed),
    )
}

/// Timeouts consecutivos antes de presumir proceso colgado y reiniciarlo.
const TIMEOUT_STRIKES_BEFORE_RESTART: u32 = 3;
/// Máximo de spawns dentro de `RESTART_WINDOW` antes de entrar en cooldown.
const MAX_RESTARTS_PER_WINDOW: usize = 3;
const RESTART_WINDOW: Duration = Duration::from_secs(120);
/// Cooldown cuando se agota el presupuesto de reinicios.
const RESTART_COOLDOWN: Duration = Duration::from_secs(300);

// ============================================================================
// Sidecar State Management
// ============================================================================

/// Sidecar process manager with keep-alive and health monitoring
#[derive(Clone)]
pub struct SidecarManager {
    /// Child process handle
    child_process: Arc<Mutex<Option<Child>>>,

    /// Stdin writer for sending requests
    stdin_writer: Arc<Mutex<Option<ChildStdin>>>,

    /// Stdout reader for receiving responses
    stdout_reader: Arc<Mutex<Option<BufReader<ChildStdout>>>>,

    /// Last activity timestamp
    last_activity: Arc<RwLock<Instant>>,

    /// Health status
    is_healthy: Arc<AtomicBool>,

    /// Shutdown flag
    should_shutdown: Arc<AtomicBool>,

    /// Active request count (for graceful shutdown)
    active_request_count: Arc<AtomicUsize>,

    /// Path to llama-helper binary
    helper_binary_path: PathBuf,

    /// Current model path (if loaded)
    current_model_path: Arc<RwLock<Option<PathBuf>>>,

    /// Idle timeout in seconds (configurable via env var)
    idle_timeout_secs: u64,

    /// Timeouts consecutivos de requests (se resetea en cada éxito y cada spawn).
    consecutive_timeouts: Arc<AtomicU32>,

    /// True cuando el helper de este proceso demostró soportar ids de correlación
    /// (respondió con `id`). Con un helper legacy (binario viejo sin ids) el
    /// timeout conserva el comportamiento anterior (kill) porque sin ids no hay
    /// forma de distinguir una respuesta tardía huérfana de la siguiente.
    ids_confirmed: Arc<AtomicBool>,

    /// Serializa spawns: `ensure_running` era check-then-act sin lock y dos
    /// llamadas concurrentes spawneaban DOS procesos (visto en logs jul-2026,
    /// mismo milisegundo), uno quedaba huérfano con el modelo cargado.
    spawn_lock: Arc<Mutex<()>>,

    /// Timestamps de spawns recientes (presupuesto de reinicios).
    restart_history: Arc<Mutex<Vec<Instant>>>,

    /// Si está seteado y en el futuro, los spawns fallan rápido (cooldown).
    cooldown_until: Arc<Mutex<Option<Instant>>>,
}

/// RAII guard for tracking active requests
/// Decrements the active request count when dropped
struct RequestGuard {
    counter: Arc<AtomicUsize>,
}

impl RequestGuard {
    fn new(counter: Arc<AtomicUsize>) -> Self {
        counter.fetch_add(1, Ordering::SeqCst);
        Self { counter }
    }
}

impl Drop for RequestGuard {
    fn drop(&mut self) {
        self.counter.fetch_sub(1, Ordering::SeqCst);
    }
}

impl SidecarManager {
    /// Create a new sidecar manager
    pub fn new(_app_data_dir: PathBuf) -> Result<Self> {
        let helper_binary_path = Self::resolve_helper_binary()?;

        // Get idle timeout from env var or use default
        let idle_timeout_secs = std::env::var("LLAMA_IDLE_TIMEOUT")
            .ok()
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(models::DEFAULT_IDLE_TIMEOUT_SECS);

        log::info!(
            "SidecarManager initialized with idle timeout: {}s",
            idle_timeout_secs
        );
        log::info!("Helper binary path: {}", helper_binary_path.display());

        Ok(Self {
            child_process: Arc::new(Mutex::new(None)),
            stdin_writer: Arc::new(Mutex::new(None)),
            stdout_reader: Arc::new(Mutex::new(None)),
            last_activity: Arc::new(RwLock::new(Instant::now())),
            is_healthy: Arc::new(AtomicBool::new(false)),
            should_shutdown: Arc::new(AtomicBool::new(false)),
            active_request_count: Arc::new(AtomicUsize::new(0)),
            helper_binary_path,
            current_model_path: Arc::new(RwLock::new(None)),
            idle_timeout_secs,
            consecutive_timeouts: Arc::new(AtomicU32::new(0)),
            ids_confirmed: Arc::new(AtomicBool::new(false)),
            spawn_lock: Arc::new(Mutex::new(())),
            restart_history: Arc::new(Mutex::new(Vec::new())),
            cooldown_until: Arc::new(Mutex::new(None)),
        })
    }

    /// Resolve the path to llama-helper binary
    fn resolve_helper_binary() -> Result<PathBuf> {
        // 1. Check environment variable (dev mode or manual override)
        if let Ok(env_path) = std::env::var("MAITY_LLAMA_HELPER") {
            if !env_path.is_empty() {
                let path = PathBuf::from(env_path);
                if path.exists() {
                    log::info!("Using llama-helper from MAITY_LLAMA_HELPER: {}", path.display());
                    return Ok(path);
                }
            }
        }

        // In production, Tauri bundles the binary with target triple suffix
        // 2. Check relative to current executable (most reliable for AppImage/bundled apps)
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                log::info!("Searching for llama-helper relative to executable: {}", exe_dir.display());
                
                // Get the target triple (same logic as before)
                let target_triple = std::env::var("TARGET")
                    .unwrap_or_else(|_| {
                        #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
                        { "x86_64-unknown-linux-gnu".to_string() }
                        #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
                        { "aarch64-unknown-linux-gnu".to_string() }
                        #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
                        { "x86_64-apple-darwin".to_string() }
                        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
                        { "aarch64-apple-darwin".to_string() }
                        #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
                        { "x86_64-pc-windows-msvc".to_string() }
                        #[cfg(all(target_os = "windows", target_arch = "aarch64"))]
                        { "aarch64-pc-windows-msvc".to_string() }
                        #[cfg(not(any(
                            all(target_os = "linux", any(target_arch = "x86_64", target_arch = "aarch64")),
                            all(target_os = "macos", any(target_arch = "x86_64", target_arch = "aarch64")),
                            all(target_os = "windows", any(target_arch = "x86_64", target_arch = "aarch64"))
                        )))]
                        { "unknown".to_string() }
                    });

                let binary_name = if cfg!(windows) {
                    format!("llama-helper-{}.exe", target_triple)
                } else {
                    format!("llama-helper-{}", target_triple)
                };

                // Try exact match in exe dir
                let bundled = exe_dir.join(&binary_name);
                if bundled.exists() {
                    log::info!("Found exact match next to executable: {}", bundled.display());
                    return Ok(bundled);
                }

                // Fuzzy match in exe dir
                log::info!("Attempting fuzzy match in exe dir: {}", exe_dir.display());
                if let Ok(entries) = std::fs::read_dir(exe_dir) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                            if name.starts_with("llama-helper") && !name.ends_with(".d") {
                                log::info!("Found fuzzy match next to executable: {}", path.display());
                                return Ok(path);
                            }
                        }
                    }
                }
            }
        }

        // 3. Check bundled resources (RESOURCE_DIR) - Fallback
        if let Ok(resource_dir) = std::env::var("RESOURCE_DIR") {
            log::info!("Searching for llama-helper in RESOURCE_DIR: {}", resource_dir);
            let resource_path = PathBuf::from(&resource_dir);
             // Get the target triple again (or we could have shared it, but code duplication is safer for this tool usage)
            let target_triple = std::env::var("TARGET")
                .unwrap_or_else(|_| {
                     #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
                    { "x86_64-unknown-linux-gnu".to_string() }
                    // ... (abbreviated for brevity in thought, but must be full in tool)
                     #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
                    { "aarch64-unknown-linux-gnu".to_string() }
                    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
                    { "x86_64-apple-darwin".to_string() }
                    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
                    { "aarch64-apple-darwin".to_string() }
                    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
                    { "x86_64-pc-windows-msvc".to_string() }
                    #[cfg(all(target_os = "windows", target_arch = "aarch64"))]
                    { "aarch64-pc-windows-msvc".to_string() }
                    #[cfg(not(any(
                        all(target_os = "linux", any(target_arch = "x86_64", target_arch = "aarch64")),
                        all(target_os = "macos", any(target_arch = "x86_64", target_arch = "aarch64")),
                        all(target_os = "windows", any(target_arch = "x86_64", target_arch = "aarch64"))
                    )))]
                    { "unknown".to_string() }
                });

            let binary_name = if cfg!(windows) {
                format!("llama-helper-{}.exe", target_triple)
            } else {
                format!("llama-helper-{}", target_triple)
            };

            let bundled = resource_path.join(&binary_name);
            if bundled.exists() {
                log::info!("Found exact match in RESOURCE_DIR: {}", bundled.display());
                return Ok(bundled);
            }

            // Fuzzy match in RESOURCE_DIR
            if let Ok(entries) = std::fs::read_dir(&resource_path) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                        if name.starts_with("llama-helper") && !name.ends_with(".d") {
                            log::info!("Found fuzzy match in RESOURCE_DIR: {}", path.display());
                            return Ok(path);
                        }
                    }
                }
            }
        } else {
            log::warn!("RESOURCE_DIR environment variable not set");
        }

        // 3. Fallback for dev: try relative paths from workspace (no target triple in dev builds)
        if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
            let project_root = PathBuf::from(&manifest_dir)
                .parent()
                .and_then(|p| p.parent())
                .ok_or_else(|| anyhow!("Failed to determine project root"))?
                .to_path_buf();

            let candidates = vec![
                project_root.join("target/release/llama-helper"),
                project_root.join("target/debug/llama-helper"),
                project_root.join("target/release/llama-helper.exe"),
                project_root.join("target/debug/llama-helper.exe"),
            ];

            for candidate in candidates {
                if candidate.exists() {
                    log::info!("Using dev llama-helper: {}", candidate.display());
                    return Ok(candidate);
                }
            }
        }

        Err(anyhow!(
            "llama-helper binary not found. Build with 'cd llama-helper && cargo build --release' or set MAITY_LLAMA_HELPER env var."
        ))
    }

    /// Ensure sidecar is running, spawn if needed
    pub async fn ensure_running(&self, model_path: PathBuf) -> Result<()> {
        // Fast path sin lock: ya corre con el modelo correcto
        {
            let current_model = self.current_model_path.read().await;
            if current_model.as_ref() == Some(&model_path) && self.is_healthy() {
                log::debug!("Sidecar already running with correct model");
                self.update_activity().await;
                return Ok(());
            }
        }

        // Slow path: serializar el spawn. Double-check tras adquirir el lock —
        // otra llamada concurrente pudo habernos ganado y spawneado ya.
        let _spawn_guard = self.spawn_lock.lock().await;
        {
            let current_model = self.current_model_path.read().await;
            if current_model.as_ref() == Some(&model_path) && self.is_healthy() {
                log::debug!("Sidecar spawned by concurrent caller while waiting for lock");
                self.update_activity().await;
                return Ok(());
            }
        }

        self.spawn(model_path).await
    }

    /// Spawn the sidecar process.
    ///
    /// Presupuesto de reinicios (Erlang OTP `max_restarts/max_seconds`): si el
    /// proceso no logra mantenerse vivo, re-spawnearlo más rápido no lo arregla —
    /// solo martilla CPU/disco recargando el modelo. Agotado el presupuesto se
    /// entra en cooldown y los callers fallan rápido (el circuit breaker del
    /// coach absorbe esos errores).
    async fn spawn(&self, model_path: PathBuf) -> Result<()> {
        // Cooldown activo → fallar rápido sin tocar el proceso
        {
            let cooldown = self.cooldown_until.lock().await;
            if let Some(until) = *cooldown {
                let now = Instant::now();
                if now < until {
                    return Err(anyhow!(
                        "Sidecar en cooldown tras agotar presupuesto de reinicios ({}s restantes)",
                        (until - now).as_secs()
                    ));
                }
            }
        }

        // Presupuesto: máx MAX_RESTARTS_PER_WINDOW spawns por RESTART_WINDOW
        let recent_restarts = {
            let mut history = self.restart_history.lock().await;
            let now = Instant::now();
            history.retain(|t| now.duration_since(*t) < RESTART_WINDOW);
            if history.len() >= MAX_RESTARTS_PER_WINDOW {
                let mut cooldown = self.cooldown_until.lock().await;
                *cooldown = Some(now + RESTART_COOLDOWN);
                SIDECAR_COOLDOWNS_TOTAL.fetch_add(1, Ordering::Relaxed);
                log::error!(
                    "Sidecar: {} reinicios en {}s — presupuesto agotado, cooldown de {}s",
                    history.len(),
                    RESTART_WINDOW.as_secs(),
                    RESTART_COOLDOWN.as_secs()
                );
                return Err(anyhow!(
                    "Presupuesto de reinicios del sidecar agotado ({} en {}s); cooldown de {}s",
                    history.len(),
                    RESTART_WINDOW.as_secs(),
                    RESTART_COOLDOWN.as_secs()
                ));
            }
            history.push(now);
            history.len()
        };

        // Backoff creciente entre reinicios (el primer spawn no espera)
        if recent_restarts > 1 {
            let backoff_secs = 1u64 << (recent_restarts - 2).min(3); // 1, 2, 4...
            log::info!(
                "Sidecar: backoff de {}s antes del reinicio #{} en la ventana",
                backoff_secs,
                recent_restarts
            );
            tokio::time::sleep(Duration::from_secs(backoff_secs)).await;
        }

        // Shutdown existing process if running
        self.shutdown().await?;

        // Estado por-proceso: el nuevo proceso aún no demostró soportar ids
        self.consecutive_timeouts.store(0, Ordering::SeqCst);
        self.ids_confirmed.store(false, Ordering::SeqCst);

        log::info!("Spawning llama-helper sidecar");
        log::info!("Model path: {}", model_path.display());

        #[cfg(unix)]
        let mut command = tokio::process::Command::new("nice");
        
        #[cfg(not(unix))]
        let mut command = tokio::process::Command::new(&self.helper_binary_path);

        #[cfg(unix)]
        command.arg("-n").arg("10").arg(&self.helper_binary_path);

        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit()) // Log stderr to main process
            .env("LLAMA_IDLE_TIMEOUT", self.idle_timeout_secs.to_string());

        #[cfg(target_os = "windows")]
        {
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x00004000;

            command.creation_flags(CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS);
        }

        let mut child = command
            .spawn()
            .with_context(|| format!("Failed to spawn llama-helper at {:?}", self.helper_binary_path))?;

        let stdin = child.stdin.take().ok_or_else(|| anyhow!("Failed to get stdin"))?;
        let stdout = child.stdout.take().ok_or_else(|| anyhow!("Failed to get stdout"))?;

        // Store handles
        {
            let mut child_lock = self.child_process.lock().await;
            *child_lock = Some(child);
        }

        {
            let mut stdin_lock = self.stdin_writer.lock().await;
            *stdin_lock = Some(stdin);
        }

        {
            let mut stdout_lock = self.stdout_reader.lock().await;
            *stdout_lock = Some(BufReader::new(stdout));
        }

        // Update state
        {
            let mut current_model = self.current_model_path.write().await;
            *current_model = Some(model_path);
        }

        self.is_healthy.store(true, Ordering::SeqCst);
        self.should_shutdown.store(false, Ordering::SeqCst);
        self.update_activity().await;

        // Cuenta TODOS los spawns (incluido el inicial); el delta por sesión
        // del session-summary del coach revela los respawns durante grabación.
        SIDECAR_RESTARTS_TOTAL.fetch_add(1, Ordering::Relaxed);
        log::info!("Sidecar spawned successfully");

        // Start background tasks
        self.start_health_check_loop();
        self.start_idle_check_loop();

        // LLM-005: fire-and-forget warmup to pre-load GGUF weights.
        // Runs concurrently with app startup — first real Generate will find the model hot.
        let warmup_manager = self.clone();
        tokio::spawn(async move {
            if let Err(e) = warmup_manager.warmup().await {
                log::warn!("LLM-005: warmup failed (non-fatal): {}", e);
            }
        });

        Ok(())
    }

    /// Send a request to the sidecar and wait for response.
    ///
    /// Correlación estilo JSON-RPC: se inyecta un `id` en el request y se leen
    /// líneas hasta encontrar la respuesta con ese id, descartando respuestas
    /// huérfanas de requests abandonados por timeout. Con esto un timeout deja
    /// de requerir matar el proceso (y recargar el modelo): la respuesta tardía
    /// se drena por id en el siguiente read. El helper es síncrono/FIFO, así que
    /// un request enviado mientras genera otro simplemente espera su turno.
    pub async fn send_request(&self, request_json: String, timeout: Duration) -> Result<String> {
        // Track active request
        let _guard = RequestGuard::new(self.active_request_count.clone());

        let request_id = REQUEST_SEQ.fetch_add(1, Ordering::Relaxed);
        // Inyectar id de correlación. Payloads no-objeto se envían tal cual.
        let payload = match serde_json::from_str::<serde_json::Value>(&request_json) {
            Ok(serde_json::Value::Object(mut map)) => {
                map.insert("id".to_string(), serde_json::json!(request_id));
                serde_json::Value::Object(map).to_string()
            }
            _ => request_json,
        };

        // Write request to stdin
        {
            let mut stdin_lock = self.stdin_writer.lock().await;
            let stdin = stdin_lock
                .as_mut()
                .ok_or_else(|| anyhow!("Sidecar not running"))?;

            stdin
                .write_all(payload.as_bytes())
                .await
                .context("Failed to write request to stdin")?;
            stdin
                .write_all(b"\n")
                .await
                .context("Failed to write newline")?;
            stdin.flush().await.context("Failed to flush stdin")?;
        }

        // Read response from stdout with timeout
        match tokio::time::timeout(timeout, self.read_matching_response(request_id)).await {
            Ok(Ok(response)) => {
                self.update_activity().await;
                self.consecutive_timeouts.store(0, Ordering::SeqCst);
                Ok(response)
            }
            Ok(Err(e)) => Err(e),
            Err(_) => {
                SIDECAR_TIMEOUTS_TOTAL.fetch_add(1, Ordering::Relaxed);
                if self.ids_confirmed.load(Ordering::SeqCst) {
                    // El helper soporta ids: el proceso sigue vivo (request lento ≠
                    // proceso muerto) y la respuesta tardía se descartará por id.
                    // Solo tras N strikes consecutivos presumimos proceso colgado.
                    let strikes = self.consecutive_timeouts.fetch_add(1, Ordering::SeqCst) + 1;
                    log::warn!(
                        "Request {} timed out after {:?} (strike {}/{}) — proceso vivo, respuesta tardía se drenará por id",
                        request_id,
                        timeout,
                        strikes,
                        TIMEOUT_STRIKES_BEFORE_RESTART
                    );
                    if strikes >= TIMEOUT_STRIKES_BEFORE_RESTART {
                        log::error!(
                            "{} timeouts consecutivos — sidecar presuntamente colgado, reinicio controlado",
                            strikes
                        );
                        self.consecutive_timeouts.store(0, Ordering::SeqCst);
                        if let Err(e) = self.shutdown().await {
                            log::error!("Failed to shutdown wedged sidecar: {}", e);
                        }
                        // El respawn ocurre lazy en el siguiente ensure_running,
                        // sujeto a presupuesto de reinicios + backoff.
                    }
                } else {
                    // Helper legacy sin ids: sin correlación no se puede drenar la
                    // respuesta tardía, el kill sigue siendo la única forma de
                    // sanear el pipe (comportamiento anterior).
                    log::error!(
                        "Request timeout after {:?} con helper legacy (sin ids) — shutting down sidecar",
                        timeout
                    );
                    if let Err(shutdown_err) = self.shutdown().await {
                        log::error!("Failed to shutdown sidecar after timeout: {}", shutdown_err);
                    }
                }
                Err(anyhow!("Request timed out after {:?}", timeout))
            }
        }
    }

    /// Lee líneas de stdout hasta encontrar la respuesta con `expected_id`,
    /// descartando respuestas huérfanas (de requests abandonados por timeout).
    /// Compat: una respuesta SIN id (helper legacy) se acepta como match.
    ///
    /// Nota: si el timeout cancela este future a mitad de una línea, esa línea
    /// puede perderse (read_line no es cancel-safe). El peor caso es UN request
    /// posterior con respuesta ilegible — estrictamente mejor que el kill
    /// incondicional anterior, que descartaba 2.4 GB de modelo caliente.
    async fn read_matching_response(&self, expected_id: u64) -> Result<String> {
        let mut stdout_lock = self.stdout_reader.lock().await;
        let reader = stdout_lock
            .as_mut()
            .ok_or_else(|| anyhow!("Sidecar not running"))?;

        loop {
            let mut line = String::new();
            let bytes = reader
                .read_line(&mut line)
                .await
                .context("Failed to read response from stdout")?;

            if bytes == 0 {
                return Err(anyhow!("Sidecar closed stdout (process may have crashed)"));
            }
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            match serde_json::from_str::<serde_json::Value>(trimmed) {
                Ok(value) => match value.get("id").and_then(|i| i.as_u64()) {
                    Some(id) if id == expected_id => {
                        self.ids_confirmed.store(true, Ordering::SeqCst);
                        return Ok(trimmed.to_string());
                    }
                    Some(stale_id) => {
                        self.ids_confirmed.store(true, Ordering::SeqCst);
                        log::warn!(
                            "Descartando respuesta huérfana del sidecar (id={}, esperado={}) — request abandonado por timeout",
                            stale_id,
                            expected_id
                        );
                        continue;
                    }
                    // Helper legacy sin ids: entregar tal cual (semántica anterior)
                    None => return Ok(trimmed.to_string()),
                },
                // Línea no-JSON: entregar tal cual; el caller reporta el parse error
                Err(_) => return Ok(trimmed.to_string()),
            }
        }
    }

    /// LLM-005: Warm up the model to eliminate cold-start latency on the first real Generate.
    /// Sends a Generate with max_tokens=1 so llama.cpp loads the GGUF weights into memory
    /// (GPU layers, KV-cache alloc, etc.) during app startup instead of on the first user request.
    pub async fn warmup(&self) -> Result<()> {
        log::info!("LLM-005: Starting llama-helper warmup (max_tokens=1)...");
        let start = std::time::Instant::now();

        // El warmup DEBE incluir model_path: sin él, el helper responde
        // `error: "Model not loaded"` y antes eso se reportaba como "warmup
        // complete in 0.0s" (éxito falso, visto en logs jul-2026) dejando la
        // carga real del modelo para el primer request de producción.
        let model_path = {
            let current = self.current_model_path.read().await;
            current
                .as_ref()
                .map(|p| p.to_string_lossy().to_string())
                .ok_or_else(|| anyhow!("LLM-005: warmup sin modelo asignado al sidecar"))?
        };

        let request = serde_json::json!({
            "type": "generate",
            "prompt": "warmup",
            "max_tokens": 1,
            "model_path": model_path,
        })
        .to_string();

        // Margen amplio para CPU sin GPU: cargar Gemma 4B + 1 token puede tardar 50-90s.
        let timeout = Duration::from_secs(120);
        let response = self.send_request(request, timeout).await.map_err(|e| {
            anyhow!("LLM-005: warmup Generate failed: {}", e)
        })?;

        // Warmup honesto: una respuesta con `error` NO es un warmup exitoso.
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&response) {
            if let Some(err) = value.get("error").and_then(|e| e.as_str()) {
                return Err(anyhow!("LLM-005: warmup respondió con error: {}", err));
            }
        }

        log::info!(
            "LLM-005: llama-helper warmup complete in {:.1}s (response preview: {})",
            start.elapsed().as_secs_f32(),
            &response[..response.len().min(80)]
        );
        Ok(())
    }

    /// Send ping to keep sidecar alive
    async fn send_ping(&self) -> Result<()> {
        let ping_id = REQUEST_SEQ.fetch_add(1, Ordering::Relaxed);
        let request = serde_json::json!({"type": "ping", "id": ping_id}).to_string();
        let timeout = Duration::from_secs(5);

        // Note: We don't use send_request here to avoid incrementing active_request_count
        // for internal health checks, as that would prevent graceful shutdown

        // Write request
        {
            let mut stdin_lock = self.stdin_writer.lock().await;
            if let Some(stdin) = stdin_lock.as_mut() {
                stdin.write_all(request.as_bytes()).await?;
                stdin.write_all(b"\n").await?;
                stdin.flush().await?;
            } else {
                return Err(anyhow!("Sidecar not running"));
            }
        }

        // Lectura con correlación: sin ella, un ping que llegara justo después
        // de una respuesta huérfana (de un generate abandonado por timeout)
        // leería esa respuesta, fallaría el health check y marcaría el sidecar
        // unhealthy → respawn innecesario con el modelo caliente.
        let response = tokio::time::timeout(timeout, self.read_matching_response(ping_id)).await??;

        let resp: serde_json::Value = serde_json::from_str(&response)?;
        if resp.get("type").and_then(|t| t.as_str()) == Some("pong") {
            Ok(())
        } else {
            Err(anyhow!("Unexpected ping response: {}", response))
        }
    }

    /// Gracefully shutdown the sidecar
    /// Waits for active requests to complete before killing the process
    pub async fn shutdown_gracefully(&self) -> Result<()> {
        log::info!("Initiating graceful shutdown of sidecar");
        
        // Set shutdown flag to prevent new internal tasks
        self.should_shutdown.store(true, Ordering::SeqCst);
        
        // Wait for active requests to complete
        // We poll every 500ms
        let start = Instant::now();
        let max_wait = Duration::from_secs(600); // Wait up to 10 minutes for long generations
        
        loop {
            let count = self.active_request_count.load(Ordering::SeqCst);
            if count == 0 {
                log::info!("No active requests, proceeding with shutdown");
                break;
            }
            
            if start.elapsed() > max_wait {
                log::warn!("Timed out waiting for active requests ({} active), forcing shutdown", count);
                break;
            }
            
            log::debug!("Waiting for {} active requests to complete...", count);
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
        
        self.shutdown().await
    }

    /// Force shutdown the sidecar
    pub async fn shutdown(&self) -> Result<()> {
        // Set shutdown flag
        self.should_shutdown.store(true, Ordering::SeqCst);

        // Send shutdown command
        if self.is_healthy() {
            let request = serde_json::json!({"type": "shutdown"}).to_string();
            let _timeout = Duration::from_secs(5);

            // Try to send shutdown command, but ignore errors
            // We don't use send_request to avoid incrementing counter
            let _ = async {
                let mut stdin_lock = self.stdin_writer.lock().await;
                if let Some(stdin) = stdin_lock.as_mut() {
                    stdin.write_all(request.as_bytes()).await?;
                    stdin.write_all(b"\n").await?;
                    stdin.flush().await?;
                }
                Ok::<(), anyhow::Error>(())
            }.await;
        }

        // Kill process if still running
        {
            let mut child_lock = self.child_process.lock().await;
            if let Some(mut child) = child_lock.take() {
                match tokio::time::timeout(Duration::from_secs(3), child.wait()).await {
                    Ok(Ok(status)) => {
                        log::info!("Sidecar exited with status: {}", status);
                    }
                    Ok(Err(e)) => {
                        log::error!("Failed to wait for sidecar: {}", e);
                    }
                    Err(_) => {
                        log::warn!("Sidecar didn't exit gracefully, killing");
                        let _ = child.kill().await;
                    }
                }
            }
        }

        // Clear handles
        {
            let mut stdin_lock = self.stdin_writer.lock().await;
            *stdin_lock = None;
        }

        {
            let mut stdout_lock = self.stdout_reader.lock().await;
            *stdout_lock = None;
        }

        {
            let mut current_model = self.current_model_path.write().await;
            *current_model = None;
        }

        self.is_healthy.store(false, Ordering::SeqCst);

        log::info!("Sidecar shutdown complete");
        Ok(())
    }

    /// Check if sidecar is healthy
    pub fn is_healthy(&self) -> bool {
        self.is_healthy.load(Ordering::SeqCst)
    }

    /// Update last activity timestamp
    async fn update_activity(&self) {
        let mut last_activity = self.last_activity.write().await;
        *last_activity = Instant::now();
    }

    /// Get seconds since last activity
    async fn seconds_since_activity(&self) -> u64 {
        let last_activity = self.last_activity.read().await;
        last_activity.elapsed().as_secs()
    }

    /// Start health check loop (runs in background)
    fn start_health_check_loop(&self) {
        let manager = self.clone();

        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(30));
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

            loop {
                interval.tick().await;

                if manager.should_shutdown.load(Ordering::SeqCst) {
                    log::debug!("Health check loop: shutdown flag set, exiting");
                    break;
                }

                if !manager.is_healthy() {
                    log::debug!("Health check loop: sidecar unhealthy, skipping ping");
                    continue;
                }

                // Don't ping if we are busy with a request
                if manager.active_request_count.load(Ordering::SeqCst) > 0 {
                    continue;
                }

                log::debug!("Health check: sending ping");
                if let Err(e) = manager.send_ping().await {
                    log::warn!("Health check failed: {}", e);
                    manager.is_healthy.store(false, Ordering::SeqCst);
                }
            }

            log::debug!("Health check loop exited");
        });
    }

    /// Start idle check loop (runs in background)
    fn start_idle_check_loop(&self) {
        let manager = self.clone();

        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(60));
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

            loop {
                interval.tick().await;

                if manager.should_shutdown.load(Ordering::SeqCst) {
                    log::debug!("Idle check loop: shutdown flag set, exiting");
                    break;
                }

                // Don't shutdown if we are busy
                if manager.active_request_count.load(Ordering::SeqCst) > 0 {
                    // Update activity to prevent timeout immediately after request finishes
                    manager.update_activity().await;
                    continue;
                }

                let idle_secs = manager.seconds_since_activity().await;
                log::debug!("Idle check: {}s since last activity", idle_secs);

                if idle_secs > manager.idle_timeout_secs {
                    log::info!(
                        "Sidecar idle for {}s (timeout: {}s), shutting down",
                        idle_secs,
                        manager.idle_timeout_secs
                    );

                    if let Err(e) = manager.shutdown().await {
                        log::error!("Failed to shutdown idle sidecar: {}", e);
                    }

                    break;
                }
            }

            log::debug!("Idle check loop exited");
        });
    }
}

impl Drop for SidecarManager {
    fn drop(&mut self) {
        // NO tocar should_shutdown aquí: el flag es COMPARTIDO (Arc) entre todos
        // los clones. Setearlo al dropear un clon (warmup, health/idle loops)
        // mataba los background loops del manager real que sigue vivo en el pool
        // — p. ej. el clon del warmup lo activaba al terminar el warmup.
        // El shutdown real lo orquesta SidecarPool::shutdown_all / shutdown().
        log::debug!("SidecarManager clone dropped");
    }
}
