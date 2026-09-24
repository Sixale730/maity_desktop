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
/// Vive en `app_data_dir` (no en el local). `lifecycle::rotate_at_boot` lo LEE
/// (sin borrarlo) antes de `import_pending` para decidir `crash_panic` (#83).
pub(crate) const PANIC_FILE_NAME: &str = "telemetry-panics.jsonl";

/// Instante e hilo de un panic anotado por el hook (una línea del `.jsonl`).
/// Lo usa `lifecycle::summarize_prev`: solo un panic del hilo `main` tumba el
/// proceso (`panic = "unwind"`: los de tasks tokio se anotan pero no lo matan).
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct PanicTs {
    pub ts_ms: u64,
    pub thread: Option<String>,
}

/// Pura: una entrada por línea JSON válida con `ts_ms` numérico. Líneas
/// vacías, JSON roto o sin `ts_ms` se saltan. No toca el archivo.
pub(crate) fn parse_panic_ts(contents: &str) -> Vec<PanicTs> {
    contents
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
        .filter_map(|entry| {
            let ts_ms = entry.get("ts_ms").and_then(|v| v.as_u64())?;
            let thread = entry
                .get("thread")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            Some(PanicTs { ts_ms, thread })
        })
        .collect()
}

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
            // `thread`: nombre del hilo (null si no tiene). El ciclo de vida
            // (#83) distingue un panic del hilo `main` (mata el proceso →
            // `crash_panic`) de uno de un worker tokio (se anota y sigue).
            let line = serde_json::json!({
                "ts_ms": now_ms(),
                "message": message,
                "location": location,
                "thread": std::thread::current().name(),
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

    let mut last_panic: Option<(String, serde_json::Value)> = None;
    for line in contents.lines().filter(|l| !l.trim().is_empty()) {
        let Ok(entry) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        let message = entry
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("panic")
            .to_string();
        last_panic = Some((message.clone(), entry.clone()));
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
            super::catalog::APP_ERROR,
            payload,
            Some(super::status::TelemetryStatus::Error),
            Some(&message),
            None,
        )
        .await;
    }

    let _ = std::fs::remove_file(path);

    // Bundle de incidente con consentimiento (#61): el proceso anterior murió
    // por un panic → ofrecer enviar el tail del log (que sigue en disco, con
    // el PANIC de main.rs al final). Se arma UNA vez por arranque con el último
    // panic; `incident::arm` aplica el cooldown/never_ask. No se toca la
    // cadena de hooks.
    if let Some((message, entry)) = last_panic {
        let payload = crate::logging::incident::IncidentPayload {
            kind: crate::logging::incident::IncidentKind::RustPanic,
            ts_ms: now_ms(),
            message: format!("Maity se cerró inesperadamente: {}", message),
            detail: serde_json::json!({
                "location": entry.get("location").cloned().unwrap_or(serde_json::Value::Null),
                "panic_ts_ms": entry.get("ts_ms").cloned().unwrap_or(serde_json::Value::Null),
            }),
        };
        crate::logging::incident::arm(app, payload).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_panic_ts_lee_varias_lineas_con_y_sin_hilo() {
        let contents = concat!(
            r#"{"ts_ms":1000,"message":"a","location":"x.rs:1:1","thread":"main"}"#,
            "\n",
            r#"{"ts_ms":2000,"message":"b","location":"y.rs:2:2","thread":null}"#,
            "\n",
            // Formato previo a #83 (sin `thread`): sigue contando, hilo None.
            r#"{"ts_ms":3000,"message":"c","location":"z.rs:3:3"}"#,
            "\n",
            r#"{"ts_ms":4000,"thread":"tokio-runtime-worker"}"#,
            "\n",
        );
        let got = parse_panic_ts(contents);
        assert_eq!(
            got,
            vec![
                PanicTs { ts_ms: 1000, thread: Some("main".into()) },
                PanicTs { ts_ms: 2000, thread: None },
                PanicTs { ts_ms: 3000, thread: None },
                PanicTs { ts_ms: 4000, thread: Some("tokio-runtime-worker".into()) },
            ]
        );
    }

    #[test]
    fn parse_panic_ts_salta_vacias_rotas_y_sin_ts() {
        let contents = concat!(
            "\n",
            "   \n",
            "{esto no es json\n",
            r#"{"message":"sin ts","thread":"main"}"#,
            "\n",
            r#"{"ts_ms":"no-numero","thread":"main"}"#,
            "\n",
            r#"{"ts_ms":5000,"thread":"main"}"#,
            "\n",
            r#"{"ts_ms":6000,"thread":"main""#, // línea truncada (crash a media escritura)
        );
        let got = parse_panic_ts(contents);
        assert_eq!(got, vec![PanicTs { ts_ms: 5000, thread: Some("main".into()) }]);
    }

    #[test]
    fn parse_panic_ts_vacio_no_da_entradas() {
        assert!(parse_panic_ts("").is_empty());
    }
}
