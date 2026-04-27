//! Setup del Coach IA local: descarga llama-server.exe de GitHub Releases
//! y modelos GGUF de HuggingFace. Sin instaladores, sin UAC, sin fricción.

use super::{llama_engine, model_registry};
use once_cell::sync::Lazy;
use reqwest::Client;
use serde::Serialize;
use std::io::Write as IoWrite;
use std::path::PathBuf;
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

/// Setup completo del Coach IA: instala llama-server.exe y descarga el modelo indicado.
/// Emite eventos "coach-setup-progress" durante el proceso.
/// model_id: si None, usa "qwen25-3b-q4" (tips model por defecto).
#[tauri::command]
pub async fn install_coach_if_needed<R: Runtime>(
    app: AppHandle<R>,
    model_id: Option<String>,
) -> Result<(), String> {
    let model_id = model_id.unwrap_or_else(|| "qwen25-3b-q4".to_string());

    emit_setup(&app, "checking", 0, "Verificando instalación...");

    // ── Paso 1: binario ───────────────────────────────────────────────────────
    if !llama_engine::is_binary_installed(&app) {
        emit_setup(&app, "downloading_binary", 0, "Descargando llama-server...");
        download_llama_binary(&app).await?;
        emit_setup(&app, "binary_ready", 20, "llama-server instalado ✓");
    } else {
        emit_setup(&app, "binary_ready", 20, "llama-server ya disponible ✓");
    }

    // ── Paso 2: modelo ────────────────────────────────────────────────────────
    if !llama_engine::is_model_installed(&app, &model_id) {
        let def = model_registry::get_model(&model_id)
            .ok_or_else(|| format!("Modelo '{}' no reconocido", model_id))?;
        emit_setup(
            &app,
            "downloading_model",
            20,
            &format!("Descargando {} ({:.0} GB)...", def.name, def.size_gb),
        );
        download_gguf_model_file(&app, &model_id).await?;
        emit_setup(&app, "model_ready", 90, "Modelo descargado ✓");
    } else {
        emit_setup(&app, "model_ready", 90, "Modelo ya disponible ✓");
    }

    // ── Paso 3: arrancar servidor ─────────────────────────────────────────────
    emit_setup(&app, "starting_server", 95, "Iniciando servidor LLM...");
    llama_engine::ensure_running(&app, &model_id, 11434).await?;

    emit_setup(&app, "complete", 100, "¡Coach IA listo!");
    info!("✅ Coach IA setup completado con modelo {}", model_id);
    Ok(())
}

// ─── Descarga del binario ─────────────────────────────────────────────────────

async fn download_llama_binary<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    // Obtener la URL del zip de la última release
    let zip_url = get_latest_llama_win_zip_url().await?;
    info!("📦 Descargando llama.cpp desde {}", zip_url);

    let dest_dir = app
        .path()
        .app_data_dir()
        .unwrap()
        .join("llama");
    std::fs::create_dir_all(&dest_dir)
        .map_err(|e| format!("Error creando directorio llama: {}", e))?;

    // Descargar el zip a memoria (es pequeño, ~15 MB)
    let resp = HTTP_CLIENT
        .get(&zip_url)
        .send()
        .await
        .map_err(|e| format!("Error descargando llama-server: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!(
            "HTTP {} al descargar llama-server",
            resp.status()
        ));
    }

    let total = resp.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut bytes: Vec<u8> = Vec::with_capacity(total as usize);
    let mut stream = resp;

    while let Some(chunk) = stream
        .chunk()
        .await
        .map_err(|e| format!("Error en descarga: {}", e))?
    {
        bytes.extend_from_slice(&chunk);
        downloaded += chunk.len() as u64;
        if total > 0 {
            let pct = ((downloaded as f64 / total as f64) * 100.0) as u8;
            let dl_mb = downloaded as f64 / 1_048_576.0;
            let tot_mb = total as f64 / 1_048_576.0;
            emit_setup(
                app,
                "downloading_binary",
                pct,
                &format!("Descargando llama-server... ({:.0}/{:.0} MB)", dl_mb, tot_mb),
            );
        }
    }

    // Extraer llama-server.exe y DLLs del zip
    extract_llama_server_from_zip(&bytes, &dest_dir)?;
    info!("✅ llama-server extraído en {:?}", dest_dir);
    Ok(())
}

async fn get_latest_llama_win_zip_url() -> Result<String, String> {
    let api_url = "https://api.github.com/repos/ggerganov/llama.cpp/releases/latest";
    let resp = HTTP_CLIENT
        .get(api_url)
        .header("User-Agent", "maity-desktop")
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("Error consultando GitHub API: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("GitHub API devolvió HTTP {}", resp.status()));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Error parseando respuesta GitHub: {}", e))?;

    // Buscar asset para Windows AVX2 x64
    let assets = json["assets"]
        .as_array()
        .ok_or("Respuesta GitHub sin campo 'assets'")?;

    for asset in assets {
        let name = asset["name"].as_str().unwrap_or("");
        // Nombres como: llama-b4926-bin-win-avx2-x64.zip
        if name.ends_with(".zip")
            && name.contains("win")
            && name.contains("x64")
            && !name.contains("cuda")
            && !name.contains("vulkan")
            && !name.contains("kompute")
            && !name.contains("openblas")
            && !name.contains("clblast")
        {
            if let Some(url) = asset["browser_download_url"].as_str() {
                info!("🎯 Usando asset llama.cpp: {}", name);
                return Ok(url.to_string());
            }
        }
    }

    // Fallback: buscar cualquier win-avx2
    for asset in assets {
        let name = asset["name"].as_str().unwrap_or("");
        if name.contains("win") && name.contains("avx2") && name.ends_with(".zip") {
            if let Some(url) = asset["browser_download_url"].as_str() {
                return Ok(url.to_string());
            }
        }
    }

    Err("No se encontró un asset de llama.cpp para Windows x64 en la última release".to_string())
}

fn extract_llama_server_from_zip(zip_bytes: &[u8], dest_dir: &PathBuf) -> Result<(), String> {
    use std::io::Read;
    let cursor = std::io::Cursor::new(zip_bytes);
    let mut archive = zip::ZipArchive::new(cursor)
        .map_err(|e| format!("ZIP inválido: {}", e))?;

    let mut extracted = 0usize;
    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("Error leyendo ZIP: {}", e))?;
        let name = file.name().to_string();

        // Extraer llama-server.exe y cualquier DLL que necesite
        let filename = std::path::Path::new(&name)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        let should_extract = filename == "llama-server.exe"
            || (filename.ends_with(".dll") && !filename.starts_with("vc_redist"));

        if !should_extract {
            continue;
        }

        let dest = dest_dir.join(&filename);
        let mut out = std::fs::File::create(&dest)
            .map_err(|e| format!("Error creando {}: {}", filename, e))?;

        let mut buf = Vec::new();
        file.read_to_end(&mut buf)
            .map_err(|e| format!("Error leyendo {}: {}", filename, e))?;
        out.write_all(&buf)
            .map_err(|e| format!("Error escribiendo {}: {}", filename, e))?;

        info!("📄 Extraído: {}", filename);
        extracted += 1;
    }

    if extracted == 0 {
        return Err("ZIP de llama.cpp no contiene llama-server.exe".to_string());
    }
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

    // Evitar descargas paralelas del mismo modelo
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

    // Soporte de descarga reanudable: comprobar bytes ya descargados
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
        // Check cancellation before writing each chunk
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

    // Mover .tmp → .gguf
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
