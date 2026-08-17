//! Tauri commands for log management
//!
//! Provides commands to export logs as ZIP files and get log information.

use std::io::{Read, Write};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime};
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

use super::file_logger::{get_log_directory, list_log_files, get_logs_total_size};
use super::mem_sampler::{self, MemSample, SessionPeaks};
use crate::database::repositories::recording_log::RecordingLogRepository;
use crate::state::AppState;

/// Information about the log files
#[derive(Debug, Clone, serde::Serialize)]
pub struct LogInfo {
    pub log_directory: Option<String>,
    pub total_size_bytes: u64,
    pub total_size_human: String,
    pub file_count: usize,
    pub files: Vec<LogFileInfo>,
}

/// Information about a single log file
#[derive(Debug, Clone, serde::Serialize)]
pub struct LogFileInfo {
    pub name: String,
    pub size_bytes: u64,
    pub size_human: String,
    pub modified: Option<String>,
}

/// Format bytes into human-readable string
fn format_bytes(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;
    const GB: u64 = MB * 1024;

    if bytes >= GB {
        format!("{:.2} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.2} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.2} KB", bytes as f64 / KB as f64)
    } else {
        format!("{} bytes", bytes)
    }
}

/// Get information about log files
#[tauri::command]
pub async fn get_log_info() -> Result<LogInfo, String> {
    let log_dir = get_log_directory();
    let files = list_log_files().map_err(|e| format!("Failed to list log files: {}", e))?;
    let total_size = get_logs_total_size().map_err(|e| format!("Failed to get log size: {}", e))?;

    let file_infos: Vec<LogFileInfo> = files
        .iter()
        .filter_map(|path| {
            let metadata = path.metadata().ok()?;
            let name = path.file_name()?.to_string_lossy().to_string();
            let size = metadata.len();
            let modified = metadata.modified().ok().map(|t| {
                let datetime: chrono::DateTime<chrono::Local> = t.into();
                datetime.format("%Y-%m-%d %H:%M:%S").to_string()
            });

            Some(LogFileInfo {
                name,
                size_bytes: size,
                size_human: format_bytes(size),
                modified,
            })
        })
        .collect();

    Ok(LogInfo {
        log_directory: log_dir.map(|p| p.to_string_lossy().to_string()),
        total_size_bytes: total_size,
        total_size_human: format_bytes(total_size),
        file_count: file_infos.len(),
        files: file_infos,
    })
}

/// Export logs as a ZIP file
///
/// Creates a ZIP file containing all log files and saves it to the specified path.
/// If no path is provided, saves to the user's Downloads folder.
#[tauri::command]
pub async fn export_logs<R: Runtime>(
    _app: AppHandle<R>,
    output_path: Option<String>,
) -> Result<String, String> {
    let files = list_log_files().map_err(|e| format!("Failed to list log files: {}", e))?;

    if files.is_empty() {
        return Err("No log files found to export".to_string());
    }

    // Determine output path
    let output_path = if let Some(path) = output_path {
        PathBuf::from(path)
    } else {
        // Default to Downloads folder
        let downloads = dirs::download_dir()
            .ok_or_else(|| "Could not determine Downloads folder".to_string())?;

        let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
        downloads.join(format!("maity_logs_{}.zip", timestamp))
    };

    // Create the ZIP file
    let file = std::fs::File::create(&output_path)
        .map_err(|e| format!("Failed to create ZIP file: {}", e))?;

    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .compression_level(Some(6));

    for log_file in &files {
        let file_name = log_file
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "unknown.log".to_string());

        // Read the log file
        let mut contents = Vec::new();
        let mut file = std::fs::File::open(log_file)
            .map_err(|e| format!("Failed to open log file {}: {}", file_name, e))?;
        file.read_to_end(&mut contents)
            .map_err(|e| format!("Failed to read log file {}: {}", file_name, e))?;

        // Add to ZIP
        zip.start_file(&file_name, options)
            .map_err(|e| format!("Failed to add file to ZIP: {}", e))?;
        zip.write_all(&contents)
            .map_err(|e| format!("Failed to write to ZIP: {}", e))?;
    }

    // Add a system info file
    let system_info = generate_system_info();
    zip.start_file("system_info.txt", options)
        .map_err(|e| format!("Failed to add system info to ZIP: {}", e))?;
    zip.write_all(system_info.as_bytes())
        .map_err(|e| format!("Failed to write system info: {}", e))?;

    // Add recording lifecycle logs from SQLite
    if let Some(app_state) = _app.try_state::<AppState>() {
        let pool = app_state.db_manager.pool();
        match RecordingLogRepository::export_all_logs_json(pool).await {
            Ok(logs_json) => {
                if let Err(e) = zip.start_file("recording_lifecycle_logs.json", options) {
                    tracing::warn!("Failed to add recording logs to ZIP: {}", e);
                } else if let Err(e) = zip.write_all(logs_json.as_bytes()) {
                    tracing::warn!("Failed to write recording logs to ZIP: {}", e);
                } else {
                    tracing::info!("Added recording lifecycle logs to export ZIP");
                }
            }
            Err(e) => {
                tracing::warn!("Failed to export recording logs: {}", e);
            }
        }
    }

    zip.finish()
        .map_err(|e| format!("Failed to finish ZIP file: {}", e))?;

    tracing::info!("Logs exported to: {:?}", output_path);

    Ok(output_path.to_string_lossy().to_string())
}

/// Generate system information for debugging
fn generate_system_info() -> String {
    let mut info = String::new();

    info.push_str("=== Maity Desktop System Info ===\n\n");
    info.push_str(&format!("Generated: {}\n", chrono::Local::now().format("%Y-%m-%d %H:%M:%S")));
    info.push_str(&format!("App Version: {}\n", env!("CARGO_PKG_VERSION")));
    info.push_str(&format!("OS: {}\n", std::env::consts::OS));
    info.push_str(&format!("Architecture: {}\n", std::env::consts::ARCH));

    // System memory info
    let sys = sysinfo::System::new_all();
    info.push_str(&format!("Total Memory: {} MB\n", sys.total_memory() / 1024 / 1024));
    info.push_str(&format!("Available Memory: {} MB\n", sys.available_memory() / 1024 / 1024));
    info.push_str(&format!("CPU Count: {}\n", sys.cpus().len()));

    if let Some(name) = sysinfo::System::name() {
        info.push_str(&format!("System Name: {}\n", name));
    }
    if let Some(version) = sysinfo::System::os_version() {
        info.push_str(&format!("OS Version: {}\n", version));
    }

    info.push_str("\n=== End System Info ===\n");

    info
}

/// Open the log directory in the system file explorer
#[tauri::command]
pub async fn open_log_directory() -> Result<(), String> {
    let log_dir = get_log_directory()
        .ok_or_else(|| "Log directory not initialized".to_string())?;

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&log_dir)
            .spawn()
            .map_err(|e| format!("Failed to open directory: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&log_dir)
            .spawn()
            .map_err(|e| format!("Failed to open directory: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&log_dir)
            .spawn()
            .map_err(|e| format!("Failed to open directory: {}", e))?;
    }

    Ok(())
}

/// Open the system file explorer with a specific file selected.
///
/// Windows: `explorer /select,<path>` highlights the file in its containing folder.
/// macOS: `open -R <path>` does the equivalent in Finder. Linux falls back to
/// opening the parent directory — most file managers don't have a reveal verb.
#[tauri::command]
pub async fn reveal_in_folder(path: String) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    if !path_buf.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", path))
            .spawn()
            .map_err(|e| format!("Failed to reveal in explorer: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to reveal in finder: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        let parent = path_buf
            .parent()
            .ok_or_else(|| "No parent directory".to_string())?;
        std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| format!("Failed to open parent directory: {}", e))?;
    }

    Ok(())
}

/// Bridge: receive a log event from the frontend and pipe it into Rust
/// `tracing::*!` so the message ends up in the daily file logger and is
/// included in the export ZIP.
///
/// The frontend logger (`@/lib/logger`) writes only to `console.*` and is
/// invisible after the session ends. This command lets `fileLogger` opt-in
/// to durable, exportable logging for diagnosis-critical events (auth state
/// transitions, dashboard query lifecycle, etc).
///
/// `level` accepts "error" | "warn" | "info" | anything-else-treated-as-debug.
/// `target` is a short module name (e.g. "auth_gate") used for grep-friendly
/// filtering. `context` is optional structured data serialized to JSON inline.
#[tauri::command]
pub fn log_frontend_event(
    level: String,
    target: String,
    message: String,
    context: Option<serde_json::Value>,
) -> Result<(), String> {
    let ctx = context
        .map(|c| format!(" {}", c))
        .unwrap_or_default();
    match level.as_str() {
        "error" => tracing::error!(target: "frontend", "[{}] {}{}", target, message, ctx),
        "warn" => tracing::warn!(target: "frontend", "[{}] {}{}", target, message, ctx),
        "info" => tracing::info!(target: "frontend", "[{}] {}{}", target, message, ctx),
        _ => tracing::debug!(target: "frontend", "[{}] {}{}", target, message, ctx),
    }
    Ok(())
}

/// Snapshot combinado de salud para el heartbeat de telemetría del frontend.
///
/// `mem` sale del cache del sampler periódico de `mem_sampler` (edad ≤30s,
/// `cpu_pct` real por el delta del System persistente); el fallback fresco
/// solo corre antes del primer tick y se distingue por `mem_sample_age_s: None`.
/// `peaks` se resetea con `reset_session_peaks()` (lo hace el ciclo del coach),
/// así que son informativos por tramo, no acumulados de toda la app.
#[derive(Debug, serde::Serialize)]
pub struct HealthSnapshot {
    pub mem: Option<MemSample>,
    pub mem_sample_age_s: Option<u64>,
    pub peaks: SessionPeaks,
    pub phase: &'static str,
    pub lag_seconds: u64,
    /// Contadores del puente Rust ERROR→telemetría (monótonos por proceso):
    /// hace visible lo que el limiter DESCARTA — sin esto, "20 errores" podía
    /// significar 20 o 20.000. None si el layer nunca se creó (fallback
    /// `fmt::init()` de main.rs).
    pub err_budget: Option<super::rust_error_bridge::BridgeBudget>,
}

/// Métricas de salud en UNA invocación IPC: memoria por proceso, fase de
/// grabación y lag de transcripción. Costo ~0 en el camino normal (lock corto
/// + clone de struct chico + lecturas atómicas).
#[tauri::command]
pub async fn get_health_snapshot() -> Result<HealthSnapshot, String> {
    let (mem, mem_sample_age_s) = match mem_sampler::last_sample() {
        Some((s, age)) => (Some(s), Some(age)),
        None => {
            // El refresh de procesos recorre la tabla del OS: fuera del runtime.
            let fresh = tokio::task::spawn_blocking(mem_sampler::collect_fresh)
                .await
                .map_err(|e| format!("health snapshot join error: {}", e))?;
            (fresh, None)
        }
    };

    Ok(HealthSnapshot {
        mem,
        mem_sample_age_s,
        peaks: mem_sampler::session_peaks(),
        phase: crate::audio::recording_phase::current_phase().as_str(),
        lag_seconds: crate::audio::transcription::worker::transcription_lag_seconds(),
        err_budget: super::rust_error_bridge::budget_snapshot(),
    })
}

/// Clear old log files (keeps only the most recent)
#[tauri::command]
pub async fn clear_old_logs(keep_count: Option<usize>) -> Result<usize, String> {
    let keep = keep_count.unwrap_or(2); // Keep last 2 by default
    let files = list_log_files().map_err(|e| format!("Failed to list log files: {}", e))?;

    let mut deleted = 0;
    for (i, file) in files.iter().enumerate() {
        if i >= keep {
            if let Err(e) = std::fs::remove_file(file) {
                tracing::warn!("Failed to delete log file {:?}: {}", file, e);
            } else {
                deleted += 1;
            }
        }
    }

    tracing::info!("Cleared {} old log files", deleted);
    Ok(deleted)
}

/// Perfil estático del equipo — *resource attributes* (OTel): se emiten UNA vez
/// por sesión como `device.profile`, no en cada heartbeat (repetirlos ×469
/// beats es peso muerto). Excepción deliberada: `performance_tier` viaja
/// también en el heartbeat porque es el slice-by más frecuente.
#[derive(Debug, serde::Serialize)]
pub struct DeviceProfile {
    pub cpu_cores: u8,
    pub gpu_type: &'static str,
    pub has_gpu_acceleration: bool,
    pub memory_gb: u8,
    pub performance_tier: &'static str,
    pub os: &'static str,
    pub os_version: Option<String>,
    pub arch: &'static str,
    /// `store` (MSIX con identidad de paquete) o `direct` (NSIS/dev) — permite
    /// segmentar incidentes por canal de distribución.
    pub build_channel: &'static str,
}

#[tauri::command]
pub fn get_device_profile() -> DeviceProfile {
    use crate::audio::hardware_detector::{GpuType, HardwareProfile, PerformanceTier};

    let hw = HardwareProfile::detect();
    DeviceProfile {
        cpu_cores: hw.cpu_cores,
        gpu_type: match hw.gpu_type {
            GpuType::None => "none",
            GpuType::Metal => "metal",
            GpuType::Cuda => "cuda",
            GpuType::Vulkan => "vulkan",
            GpuType::OpenCL => "opencl",
        },
        has_gpu_acceleration: hw.has_gpu_acceleration,
        memory_gb: hw.memory_gb,
        performance_tier: match hw.performance_tier {
            PerformanceTier::Low => "low",
            PerformanceTier::Medium => "medium",
            PerformanceTier::High => "high",
            PerformanceTier::Ultra => "ultra",
        },
        os: std::env::consts::OS,
        os_version: sysinfo::System::os_version(),
        arch: std::env::consts::ARCH,
        build_channel: if crate::utils::is_running_under_package_identity() {
            "store"
        } else {
            "direct"
        },
    }
}

#[cfg(test)]
mod health_snapshot_tests {
    use super::*;

    /// Primera vez que MemSample/SessionPeaks cruzan el boundary IPC: blinda
    /// los derives de Serialize y las keys que consume healthHeartbeatService.
    #[test]
    fn health_snapshot_serializa_con_keys_esperadas() {
        let snapshot = HealthSnapshot {
            mem: Some(MemSample {
                app_rss_mb: 512,
                llama_rss_mb: 1024,
                llama_procs: 1,
                webview_rss_mb: 300,
                webview_procs: 4,
                ffmpeg_procs: 0,
                sys_avail_mb: 8000,
                sys_total_mb: 16000,
                cpu_pct: 12.5,
            }),
            mem_sample_age_s: Some(7),
            peaks: SessionPeaks {
                app_rss_peak_mb: 900,
                llama_rss_peak_mb: 2400,
                webview_rss_peak_mb: 400,
                sys_avail_min_mb: 3000,
                llama_procs_max: 2,
            },
            phase: "recording",
            lag_seconds: 3,
            err_budget: None,
        };

        let v = serde_json::to_value(&snapshot).expect("HealthSnapshot serializable");
        assert_eq!(v["phase"], "recording");
        assert_eq!(v["lag_seconds"], 3);
        assert_eq!(v["mem_sample_age_s"], 7);
        assert_eq!(v["mem"]["app_rss_mb"], 512);
        assert_eq!(v["mem"]["cpu_pct"], 12.5);
        assert_eq!(v["peaks"]["app_rss_peak_mb"], 900);
        assert_eq!(v["peaks"]["sys_avail_min_mb"], 3000);
    }

    #[test]
    fn health_snapshot_mem_none_serializa_null() {
        let snapshot = HealthSnapshot {
            mem: None,
            mem_sample_age_s: None,
            peaks: SessionPeaks {
                app_rss_peak_mb: 0,
                llama_rss_peak_mb: 0,
                webview_rss_peak_mb: 0,
                sys_avail_min_mb: 0,
                llama_procs_max: 0,
            },
            phase: "idle",
            lag_seconds: 0,
            err_budget: None,
        };

        let v = serde_json::to_value(&snapshot).expect("serializable");
        assert!(v["mem"].is_null());
        assert!(v["mem_sample_age_s"].is_null());
    }
}
