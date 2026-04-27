//! Gestión del proceso llama-server como backend LLM local.
//! Mantiene hasta dos instancias (puerto 11434 para tips, 11435 para eval).
//! La API que expone es OpenAI-compatible (/v1/chat/completions), idéntica a Ollama.

use super::model_registry;
use once_cell::sync::Lazy;
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Manager, Runtime};
use tracing::{info, warn};

// ─── Estado global ────────────────────────────────────────────────────────────

struct LlamaProcess {
    child: tokio::process::Child,
    model_id: String,
}

static LLAMA_PROCESSES: Lazy<Mutex<HashMap<u16, LlamaProcess>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

// ─── Tipos públicos ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct LlamaServerStatus {
    pub model_id: String,
    pub port: u16,
    pub running: bool,
    pub endpoint: String,
}

// ─── Rutas ────────────────────────────────────────────────────────────────────

pub fn llama_binary_path<R: Runtime>(app: &tauri::AppHandle<R>) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap()
        .join("llama")
        .join("llama-server.exe")
}

pub fn model_file_path<R: Runtime>(app: &tauri::AppHandle<R>, model_id: &str) -> Option<PathBuf> {
    let def = model_registry::get_model(model_id)?;
    Some(
        app.path()
            .app_data_dir()
            .unwrap()
            .join("models")
            .join("llm")
            .join(def.filename),
    )
}

pub fn is_binary_installed<R: Runtime>(app: &tauri::AppHandle<R>) -> bool {
    llama_binary_path(app).exists()
}

pub fn is_model_installed<R: Runtime>(app: &tauri::AppHandle<R>, model_id: &str) -> bool {
    model_file_path(app, model_id)
        .map(|p| p.exists())
        .unwrap_or(false)
}

// ─── Health check ─────────────────────────────────────────────────────────────

pub async fn health_check(port: u16) -> bool {
    let url = format!("http://127.0.0.1:{}/health", port);
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };
    client
        .get(&url)
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

async fn wait_for_health(port: u16, timeout: Duration) -> Result<(), String> {
    let start = std::time::Instant::now();
    loop {
        // Detect premature exit (crash, missing DLL) before waiting the full timeout
        {
            let mut procs = LLAMA_PROCESSES.lock().unwrap();
            if let Some(proc) = procs.get_mut(&port) {
                if let Ok(Some(status)) = proc.child.try_wait() {
                    procs.remove(&port);
                    return Err(format!(
                        "llama-server terminó inesperadamente (código {:?}). Verifica la instalación en Ajustes → Coach IA.",
                        status.code()
                    ));
                }
            }
        }

        if health_check(port).await {
            return Ok(());
        }
        if start.elapsed() > timeout {
            return Err(format!(
                "llama-server no respondió en {}s en el puerto {}",
                timeout.as_secs(),
                port
            ));
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}

// ─── Ciclo de vida del proceso ────────────────────────────────────────────────

/// Garantiza que llama-server corre en `port` con `model_id`.
/// Si ya corre con ese modelo y responde al health check, retorna inmediatamente.
/// Si corre con otro modelo, lo reinicia.
pub async fn ensure_running<R: Runtime>(
    app: &tauri::AppHandle<R>,
    model_id: &str,
    port: u16,
) -> Result<String, String> {
    let endpoint = format!("http://127.0.0.1:{}", port);

    // Verificar si ya corre con el modelo correcto
    let already_running = {
        let mut procs = LLAMA_PROCESSES.lock().unwrap();
        match procs.get_mut(&port) {
            Some(proc) if proc.model_id == model_id => {
                // alive check (non-async)
                matches!(proc.child.try_wait(), Ok(None))
            }
            Some(proc) => {
                // Modelo diferente en este puerto — matar
                let _ = proc.child.start_kill();
                procs.remove(&port);
                false
            }
            None => false,
        }
    }; // mutex liberado

    if already_running && health_check(port).await {
        return Ok(endpoint);
    }

    // Quitar entrada si existe (proceso muerto con modelo correcto)
    {
        let mut procs = LLAMA_PROCESSES.lock().unwrap();
        if let Some(mut proc) = procs.remove(&port) {
            let _ = proc.child.start_kill();
        }
    }

    // Verificar que binary y modelo existen
    let binary = llama_binary_path(app);
    if !binary.exists() {
        return Err(
            "llama-server.exe no instalado. Ve a Ajustes → Pipeline y configura el Coach IA."
                .to_string(),
        );
    }
    let model_path = model_file_path(app, model_id)
        .ok_or_else(|| format!("Modelo '{}' no reconocido en el registry", model_id))?;
    if !model_path.exists() {
        return Err(format!(
            "Modelo '{}' no descargado todavía. Descárgalo desde Ajustes → Pipeline.",
            model_id
        ));
    }

    info!(
        "🦙 Iniciando llama-server: modelo={} puerto={}",
        model_id, port
    );

    let mut cmd = tokio::process::Command::new(&binary);
    cmd.args([
        "--model",
        &model_path.to_string_lossy(),
        "--port",
        &port.to_string(),
        "--host",
        "127.0.0.1",
        "--ctx-size",
        "4096",
        "--n-gpu-layers",
        "0",
        "--log-disable",
    ]);
    cmd.stdout(std::process::Stdio::null());
    cmd.stderr(std::process::Stdio::null());

    // Sin ventana de consola en Windows
    #[cfg(windows)]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

    let child = cmd
        .spawn()
        .map_err(|e| format!("Error iniciando llama-server: {}", e))?;

    {
        let mut procs = LLAMA_PROCESSES.lock().unwrap();
        procs.insert(
            port,
            LlamaProcess {
                child,
                model_id: model_id.to_string(),
            },
        );
    }

    // Esperar a que el servidor responda (hasta 180s — CPU-only tarda 1-2 min cargando 2GB)
    wait_for_health(port, Duration::from_secs(180)).await?;

    info!("✅ llama-server listo en {}", endpoint);
    Ok(endpoint)
}

/// Para el servidor en `port` (no-async, envía señal de kill).
pub fn stop_server(port: u16) {
    let mut procs = LLAMA_PROCESSES.lock().unwrap();
    if let Some(mut proc) = procs.remove(&port) {
        let _ = proc.child.start_kill();
        info!("🛑 llama-server en puerto {} detenido", port);
    }
}

/// Para todos los servidores (llamar al cerrar la app).
pub fn stop_all() {
    let mut procs = LLAMA_PROCESSES.lock().unwrap();
    for (port, mut proc) in procs.drain() {
        let _ = proc.child.start_kill();
        info!("🛑 llama-server en puerto {} detenido (app exit)", port);
    }
}

/// Estado actual de todos los servidores.
pub fn get_running_status() -> Vec<LlamaServerStatus> {
    let mut procs = LLAMA_PROCESSES.lock().unwrap();
    procs
        .iter_mut()
        .map(|(port, proc)| {
            let alive = matches!(proc.child.try_wait(), Ok(None));
            if !alive {
                warn!("llama-server en puerto {} ya no responde", port);
            }
            LlamaServerStatus {
                model_id: proc.model_id.clone(),
                port: *port,
                running: alive,
                endpoint: format!("http://127.0.0.1:{}", port),
            }
        })
        .collect()
}
