//! Guardado de artefactos generados en la app (.md / .pdf / .pptx) al disco real
//! del usuario. Dos modos segun la preferencia `ask_where_to_save`:
//!   true  (default) -> dialogo nativo "Guardar como" del SO en cada descarga
//!   false           -> escritura directa a la carpeta de Descargas, con
//!                      desambiguacion tipo Explorer (`doc (2).md`)
//!
//! Por que vive en Rust y no en el WebView: un `<a download>` dentro de WebView2
//! guarda en la carpeta de descargas del propio WebView, sin preguntar y sin UI
//! visible dentro de Tauri. La app nunca aprende la ruta, asi que no puede
//! confirmar el guardado ni ofrecer "Abrir carpeta" — que es exactamente como se
//! sentia roto el boton de descarga de Maity Chat.
//!
//! El dialogo se maneja con `DialogExt` desde Rust (mismo patron que
//! `database::commands::select_legacy_database_path`). Hacerlo asi evita instalar
//! `@tauri-apps/plugin-dialog` y agregar permisos `dialog:*` a las capabilities:
//! los comandos propios no pasan por el ACL de Tauri.

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use log::{info, warn};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Runtime};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "export_preferences.json";
const STORE_KEY: &str = "preferences";

/// Preferencias de exportacion. Es un struct (y no un bool suelto) para poder
/// agregar campos despues (p.ej. `default_folder`) sin comandos nuevos.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportPreferences {
    /// true  -> abrir el dialogo nativo en cada descarga (default)
    /// false -> guardar directo en la carpeta de Descargas
    #[serde(default = "default_ask")]
    pub ask_where_to_save: bool,
}

fn default_ask() -> bool {
    true
}

impl Default for ExportPreferences {
    fn default() -> Self {
        Self {
            ask_where_to_save: default_ask(),
        }
    }
}

// ──────────────────────────── preferencias ────────────────────────────
// Mismo patron read-merge-write que `audio::recording_preferences`.

pub fn load_export_preferences<R: Runtime>(app: &AppHandle<R>) -> ExportPreferences {
    let store = match app.store(STORE_FILE) {
        Ok(store) => store,
        Err(e) => {
            warn!("export prefs: store inaccesible ({}), usando defaults", e);
            return ExportPreferences::default();
        }
    };

    match store.get(STORE_KEY) {
        Some(value) => match serde_json::from_value::<ExportPreferences>(value.clone()) {
            Ok(prefs) => prefs,
            Err(e) => {
                warn!(
                    "export prefs: no se pudo deserializar ({}), usando defaults",
                    e
                );
                ExportPreferences::default()
            }
        },
        None => ExportPreferences::default(),
    }
}

pub fn persist_export_preferences<R: Runtime>(
    app: &AppHandle<R>,
    prefs: &ExportPreferences,
) -> Result<(), String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Store inaccesible: {}", e))?;

    let value =
        serde_json::to_value(prefs).map_err(|e| format!("Serializacion fallo: {}", e))?;

    store.set(STORE_KEY, value);
    store
        .save()
        .map_err(|e| format!("No se pudo persistir a disco: {}", e))
}

#[tauri::command]
pub async fn get_export_preferences<R: Runtime>(
    app: AppHandle<R>,
) -> Result<ExportPreferences, String> {
    Ok(load_export_preferences(&app))
}

#[tauri::command]
pub async fn set_export_preferences<R: Runtime>(
    app: AppHandle<R>,
    preferences: ExportPreferences,
) -> Result<(), String> {
    info!(
        "export prefs: ask_where_to_save={}",
        preferences.ask_where_to_save
    );
    persist_export_preferences(&app, &preferences)
}

// ────────────────────────────── guardado ──────────────────────────────

/// Guarda `contents_base64` en disco.
///
/// Devuelve `Ok(Some(ruta))` si se escribio y `Ok(None)` si el usuario cancelo el
/// dialogo — la cancelacion es un no-op silencioso, el frontend NO debe mostrar
/// toast de error.
///
/// IMPORTANTE: tiene que ser `async`. `blocking_save_file()` despacha el dialogo
/// al main thread y espera en un `sync_channel(0)`; desde un comando sincrono
/// (que corre EN el main thread) eso deadlockea la app. Un comando async corre en
/// un worker de tokio, que es lo correcto.
#[tauri::command]
pub async fn save_artifact_file<R: Runtime>(
    app: AppHandle<R>,
    default_file_name: String,
    contents_base64: String,
    filter_name: String,
    extensions: Vec<String>,
    force_ask: Option<bool>,
) -> Result<Option<String>, String> {
    let bytes = B64
        .decode(contents_base64.as_bytes())
        .map_err(|e| format!("Contenido invalido (base64): {}", e))?;

    let file_name = sanitize_file_name(&default_file_name);
    let ask = force_ask.unwrap_or_else(|| load_export_preferences(&app).ask_where_to_save);

    let target: PathBuf = if ask {
        let ext_refs: Vec<&str> = extensions.iter().map(String::as_str).collect();
        let mut builder = app.dialog().file().set_file_name(&file_name);

        if !ext_refs.is_empty() {
            builder = builder.add_filter(&filter_name, &ext_refs);
        }
        if let Some(dir) = dirs::download_dir() {
            builder = builder.set_directory(dir);
        }

        match builder.blocking_save_file() {
            Some(file_path) => file_path
                // `into_path()` y no `.to_string()`: para la variante `Url` esto
                // ultimo devuelve un `file://...`, no una ruta del sistema.
                .into_path()
                .map_err(|e| format!("Ruta invalida devuelta por el dialogo: {}", e))?,
            None => {
                info!("save_artifact_file: el usuario cancelo el dialogo");
                return Ok(None);
            }
        }
    } else {
        let dir = dirs::download_dir()
            .or_else(dirs::home_dir)
            .ok_or_else(|| "No se pudo resolver la carpeta de Descargas".to_string())?;

        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("No se pudo crear la carpeta destino: {}", e))?;

        unique_path(&dir, &file_name)
    };

    std::fs::write(&target, &bytes)
        .map_err(|e| format!("No se pudo escribir el archivo: {}", e))?;

    let path_str = target.to_string_lossy().to_string();
    info!("Artefacto guardado ({} bytes): {}", bytes.len(), path_str);
    Ok(Some(path_str))
}

/// Quita separadores y caracteres reservados de Windows. Defensa en profundidad:
/// hoy los callers ya mandan slugs, pero el nombre viene de un titulo generado
/// por el LLM y no queremos que un `/` lo convierta en una ruta.
fn sanitize_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            c if (c as u32) < 0x20 => '-',
            c => c,
        })
        .collect();

    let cleaned = cleaned.trim().trim_matches('.').trim().to_string();
    if cleaned.is_empty() {
        "documento".to_string()
    } else {
        cleaned
    }
}

/// `doc.md` -> `doc (2).md` -> `doc (3).md`... convencion del Explorador.
/// Solo aplica al modo "no preguntar"; con dialogo, el SO ya confirma el
/// sobrescribir.
fn unique_path(dir: &Path, file_name: &str) -> PathBuf {
    let candidate = dir.join(file_name);
    if !candidate.exists() {
        return candidate;
    }

    let path = Path::new(file_name);
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "documento".to_string());
    let ext = path.extension().map(|s| s.to_string_lossy().to_string());

    for n in 2..1000u32 {
        let name = match &ext {
            Some(e) => format!("{} ({}).{}", stem, n, e),
            None => format!("{} ({})", stem, n),
        };
        let candidate = dir.join(name);
        if !candidate.exists() {
            return candidate;
        }
    }

    // Salida de emergencia: timestamp.
    let ts = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let name = match &ext {
        Some(e) => format!("{}_{}.{}", stem, ts, e),
        None => format!("{}_{}", stem, ts),
    };
    dir.join(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_replaces_reserved_chars() {
        assert_eq!(sanitize_file_name("a/b\\c:d.md"), "a-b-c-d.md");
        assert_eq!(sanitize_file_name("plan Q3?.pdf"), "plan Q3-.pdf");
    }

    #[test]
    fn sanitize_falls_back_when_empty() {
        assert_eq!(sanitize_file_name("   "), "documento");
        assert_eq!(sanitize_file_name("..."), "documento");
    }

    #[test]
    fn sanitize_keeps_accents() {
        assert_eq!(sanitize_file_name("reunión.md"), "reunión.md");
    }

    #[test]
    fn unique_path_returns_original_when_free() {
        let dir = std::env::temp_dir().join("maity_export_test_free");
        let _ = std::fs::create_dir_all(&dir);
        let _ = std::fs::remove_file(dir.join("libre.md"));

        assert_eq!(unique_path(&dir, "libre.md"), dir.join("libre.md"));
    }

    #[test]
    fn unique_path_disambiguates_collisions() {
        let dir = std::env::temp_dir().join("maity_export_test_collision");
        let _ = std::fs::create_dir_all(&dir);
        std::fs::write(dir.join("doc.md"), b"x").unwrap();

        assert_eq!(unique_path(&dir, "doc.md"), dir.join("doc (2).md"));

        std::fs::write(dir.join("doc (2).md"), b"x").unwrap();
        assert_eq!(unique_path(&dir, "doc.md"), dir.join("doc (3).md"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn preferences_default_to_asking() {
        assert!(ExportPreferences::default().ask_where_to_save);
        // Un JSON vacio de una version anterior tambien debe caer en "preguntar".
        let parsed: ExportPreferences = serde_json::from_str("{}").unwrap();
        assert!(parsed.ask_where_to_save);
    }
}
