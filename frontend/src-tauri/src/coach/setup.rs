//! Setup del Coach IA local: descarga de modelos GGUF de HuggingFace.
//! El motor LLM ya viene embebido en el bundle (sidecar Built-in AI), no hay
//! binario externo que descargar.

use super::{llama_engine, model_registry};
use once_cell::sync::Lazy;
use reqwest::Client;
use serde::Serialize;
use std::io::Write as IoWrite;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tracing::info;

static HTTP_CLIENT: Lazy<Client> = Lazy::new(Client::new);

// Previene que múltiples llamadas simultáneas descarguen el mismo modelo
static ACTIVE_DOWNLOADS: Lazy<Mutex<std::collections::HashSet<String>>> =
    Lazy::new(|| Mutex::new(std::collections::HashSet::new()));

// Cancelaciones pedidas por el usuario
static CANCELLED_DOWNLOADS: Lazy<Mutex<std::collections::HashSet<String>>> =
    Lazy::new(|| Mutex::new(std::collections::HashSet::new()));

#[derive(Clone, Serialize)]
struct SetupProgress {
    step: String,
    progress: u8,
    message: String,
}

#[derive(Clone, Serialize)]
struct GgufDownloadProgress {
    model_id: String,
    progress: u8,
    downloaded_mb: f64,
    total_mb: f64,
}

fn emit_setup<R: Runtime>(app: &AppHandle<R>, step: &str, progress: u8, message: &str) {
    let _ = app.emit(
        "coach-setup-progress",
        SetupProgress {
            step: step.to_string(),
            progress,
            message: message.to_string(),
        },
    );
}

fn emit_download<R: Runtime>(
    app: &AppHandle<R>,
    model_id: &str,
    progress: u8,
    downloaded_mb: f64,
    total_mb: f64,
) {
    let _ = app.emit(
        "coach-gguf-download-progress",
        GgufDownloadProgress {
            model_id: model_id.to_string(),
            progress,
            downloaded_mb,
            total_mb,
        },
    );
}

// ─── Comando principal ────────────────────────────────────────────────────────

/// Setup del Coach IA: verifica que el modelo GGUF indicado esté disponible,
/// descargándolo si falta. El motor LLM (sidecar) ya viene en el bundle.
/// model_id: si None, usa "gemma3-4b-q4" (default).
#[tauri::command]
pub async fn install_coach_if_needed<R: Runtime>(
    app: AppHandle<R>,
    model_id: Option<String>,
) -> Result<(), String> {
    let model_id = model_id.unwrap_or_else(|| "gemma3-4b-q4".to_string());

    emit_setup(&app, "checking", 0, "Verificando modelo...");

    if !llama_engine::is_model_installed(&app, &model_id) {
        let def = model_registry::get_model(&model_id)
            .ok_or_else(|| format!("Modelo '{}' no reconocido", model_id))?;
        emit_setup(
            &app,
            "downloading_model",
            10,
            &format!("Descargando {} ({:.0} GB)...", def.name, def.size_gb),
        );
        download_gguf_model_file(&app, &model_id).await?;
        emit_setup(&app, "model_ready", 90, "Modelo descargado ✓");
    } else {
        emit_setup(&app, "model_ready", 90, "Modelo ya disponible ✓");
    }

    emit_setup(&app, "complete", 100, "¡Coach IA listo!");
    info!("✅ Coach IA setup completado con modelo {}", model_id);
    Ok(())
}

// ─── Descarga de modelo GGUF ──────────────────────────────────────────────────

/// Descarga un modelo GGUF desde HuggingFace. Emite "coach-gguf-download-progress".
/// Puede llamarse directamente como tarea de fondo desde coach_download_gguf_model.
pub async fn download_gguf_model_file<R: Runtime>(
    app: &AppHandle<R>,
    model_id: &str,
) -> Result<(), String> {
    let def = model_registry::get_model(model_id)
        .ok_or_else(|| format!("Modelo '{}' no reconocido", model_id))?;

    {
        let mut active = ACTIVE_DOWNLOADS.lock().unwrap();
        if active.contains(model_id) {
            return Err(format!("El modelo '{}' ya se está descargando", model_id));
        }
        active.insert(model_id.to_string());
    }

    let result = do_download_gguf(app, model_id, def).await;

    {
        let mut active = ACTIVE_DOWNLOADS.lock().unwrap();
        active.remove(model_id);
    }

    result
}

async fn do_download_gguf<R: Runtime>(
    app: &AppHandle<R>,
    model_id: &str,
    def: &model_registry::GgufModelDef,
) -> Result<(), String> {
    let url = model_registry::download_url(def);
    info!("⬇️  Descargando modelo GGUF: {} desde {}", model_id, url);

    let dest_dir = app
        .path()
        .app_data_dir()
        .unwrap()
        .join("models")
        .join("llm");
    std::fs::create_dir_all(&dest_dir)
        .map_err(|e| format!("Error creando directorio de modelos: {}", e))?;

    let tmp_path = dest_dir.join(format!("{}.tmp", def.filename));
    let final_path = dest_dir.join(def.filename);

    let already_downloaded = if tmp_path.exists() {
        std::fs::metadata(&tmp_path)
            .map(|m| m.len())
            .unwrap_or(0)
    } else {
        0
    };

    let mut req = HTTP_CLIENT.get(&url);
    if already_downloaded > 0 {
        req = req.header("Range", format!("bytes={}-", already_downloaded));
        info!("📂 Reanudando descarga desde {} bytes", already_downloaded);
    }

    let resp = req
        .send()
        .await
        .map_err(|e| format!("Error iniciando descarga de {}: {}", def.name, e))?;

    let status = resp.status();
    if !status.is_success() && status != reqwest::StatusCode::PARTIAL_CONTENT {
        return Err(format!("HTTP {} al descargar {}", status, def.name));
    }

    let content_length = resp.content_length().unwrap_or(0);
    let total_bytes = if status == reqwest::StatusCode::PARTIAL_CONTENT {
        already_downloaded + content_length
    } else {
        content_length
    };

    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(already_downloaded > 0 && status == reqwest::StatusCode::PARTIAL_CONTENT)
        .write(true)
        .truncate(already_downloaded == 0 || status != reqwest::StatusCode::PARTIAL_CONTENT)
        .open(&tmp_path)
        .map_err(|e| format!("Error abriendo archivo temporal: {}", e))?;

    let mut downloaded = if status == reqwest::StatusCode::PARTIAL_CONTENT {
        already_downloaded
    } else {
        0
    };
    let mut last_pct: u8 = 255;
    let mut stream = resp;

    while let Some(chunk) = stream
        .chunk()
        .await
        .map_err(|e| format!("Error en descarga de {}: {}", def.name, e))?
    {
        if CANCELLED_DOWNLOADS.lock().unwrap().remove(model_id) {
            return Err(format!("Descarga de '{}' cancelada", model_id));
        }
        file.write_all(&chunk)
            .map_err(|e| format!("Error escribiendo modelo: {}", e))?;
        downloaded += chunk.len() as u64;

        if total_bytes > 0 {
            let pct = ((downloaded as f64 / total_bytes as f64) * 100.0).min(99.0) as u8;
            if pct != last_pct {
                last_pct = pct;
                emit_download(
                    app,
                    model_id,
                    pct,
                    downloaded as f64 / 1_048_576.0,
                    total_bytes as f64 / 1_048_576.0,
                );
            }
        }
    }

    drop(file);
    std::fs::rename(&tmp_path, &final_path)
        .map_err(|e| format!("Error finalizando descarga: {}", e))?;

    emit_download(
        app,
        model_id,
        100,
        downloaded as f64 / 1_048_576.0,
        downloaded as f64 / 1_048_576.0,
    );
    info!("✅ Modelo {} descargado en {:?}", model_id, final_path);
    Ok(())
}

/// Cancela una descarga GGUF en curso. La descarga se detiene al siguiente chunk.
/// El archivo .tmp se conserva para reanudar la descarga en el futuro.
#[tauri::command]
pub fn cancel_gguf_download(model_id: String) {
    CANCELLED_DOWNLOADS.lock().unwrap().insert(model_id);
}
