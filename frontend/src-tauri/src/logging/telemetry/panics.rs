//! Panics → outbox de telemetría (cierra el gap "panics a la nube" de
//! `docs/TELEMETRIA.md`).
//!
//! Un panic no puede escribir a SQLite async ni tocar la red — el proceso se
//! está muriendo. El hook escribe UNA línea JSON a un archivo con I/O síncrona
//! de std, y el SIGUIENTE arranque la importa al outbox (`app.error` con
//! `source: "rust-panic"`), donde la drenadora la sube.
//!
//! Reglas: el hook se ENCADENA con `panic::take_hook()` (el de main.rs sigue
//! mandando a tracing + Sentry — no pisarlo); y dentro del hook está PROHIBIDO
//! `tracing`/`log` (anti-reentrada, misma regla que el rust_error_bridge).

use std::io::Write;
use std::path::PathBuf;
use std::sync::OnceLock;
use tauri::{AppHandle, Manager, Runtime};

static PANIC_FILE: OnceLock<PathBuf> = OnceLock::new();
const PANIC_FILE_NAME: &str = "telemetry-panics.jsonl";

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Instala el hook (idempotente). Llamar desde el setup, cuando el app data
/// dir ya resuelve.
pub fn install<R: Runtime>(app: &AppHandle<R>) {
    let Ok(dir) = app.path().app_data_dir() else {
        return;
    };
    if PANIC_FILE.set(dir.join(PANIC_FILE_NAME)).is_err() {
        return; // ya instalado
    }

    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        // Solo I/O síncrona de std: nada de tracing/log/async aquí.
        if let Some(path) = PANIC_FILE.get() {
            let location = info
                .location()
                .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
                .unwrap_or_else(|| "unknown".to_string());
            let message = if let Some(s) = info.payload().downcast_ref::<&str>() {
                (*s).to_string()
            } else if let Some(s) = info.payload().downcast_ref::<String>() {
                s.clone()
            } else {
                "Unknown panic payload".to_string()
            };
            let line = serde_json::json!({
                "ts_ms": now_ms(),
                "message": message,
                "location": location,
            });
            if let Ok(mut file) = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(path)
            {
                let _ = writeln!(file, "{}", line);
            }
        }
        previous(info);
    }));
}

/// Importa los panics del proceso anterior al outbox y borra el archivo.
/// La columna `session_id` es la del proceso IMPORTADOR; el instante real del
/// panic viaja en `panic_ts_ms` (el proceso que murió no dejó más identidad).
pub async fn import_pending<R: Runtime>(app: &AppHandle<R>) {
    let Some(path) = PANIC_FILE.get() else {
        return;
    };
    let Ok(contents) = std::fs::read_to_string(path) else {
        return; // no existe (arranque limpio) o ilegible
    };

    for line in contents.lines().filter(|l| !l.trim().is_empty()) {
        let Ok(entry) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        let message = entry
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("panic")
            .to_string();
        let payload = serde_json::json!({
            "source": "rust-panic",
            "name": "RustPanic",
            "message": message,
            "location": entry.get("location").cloned().unwrap_or(serde_json::Value::Null),
            "panic_ts_ms": entry.get("ts_ms").cloned().unwrap_or(serde_json::Value::Null),
        });
        super::emit::emit_event(
            app,
            super::context::process_session_id(),
            "app.error",
            payload,
            Some("error"),
            Some(&message),
            None,
        )
        .await;
    }

    let _ = std::fs::remove_file(path);
}
