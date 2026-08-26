//! Bundle de incidente con consentimiento (#61) — nivel 3 de la pirámide de
//! `docs/TELEMETRIA.md`.
//!
//! Los logs crudos NO van a la nube (decisión jul-2026). Este módulo es la
//! excepción CONSENTIDA: al detectar un umbral crítico de RAM, un panic del
//! proceso anterior, o a petición del usuario en Ajustes, la app pregunta
//! "¿Enviar diagnóstico a Maity?" y, solo si acepta, sube ~200 KB del tail del
//! log rotativo + cabecera JSON + system_info a Supabase Storage
//! (`incident-bundles/{auth_uid}/…txt`, contrato en
//! `docs/incident-bundles-bucket.sql`). Nunca automático, nunca reintentos:
//! best-effort.
//!
//! Piezas:
//! - `arm()` — armado con dedupe: 1 prompt por kind por proceso + cooldown
//!   persistido de 7 días por kind + `never_ask`. Guarda el incidente en un
//!   slot (`take_pending_incident`) Y emite `incident-detected`: WebView2
//!   suspende el JS con la ventana oculta (tray/jornada), así que el push se
//!   puede perder; el slot no.
//! - `read_log_tail()` — tail por `seek`, sin cargar archivos completos.
//! - `upload_incident_bundle` — POST a Storage con la sesión nativa
//!   (`CloudSyncState` + `get_valid_token`, mismo patrón que `drain.rs`). La
//!   carpeta es `auth.uid()` (claim `sub` del JWT), NO `maity.users.id`: es la
//!   identidad con la que cierra la policy RLS de Storage.

use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::Mutex;

use base64::Engine;
use log::{info, warn};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_store::StoreExt;

/// Presupuesto del tail del log dentro del bundle.
pub const TAIL_MAX_BYTES: usize = 200 * 1024;
const BUCKET: &str = "incident-bundles";
const PREFS_FILE: &str = "incident-prefs.json";
const PREFS_KEY: &str = "preferences";
/// No volver a preguntar por el mismo `kind` durante 7 días (persistido).
pub const PROMPT_COOLDOWN_MS: u64 = 7 * 24 * 60 * 60 * 1000;
const UPLOAD_TIMEOUT_SECS: u64 = 30;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum IncidentKind {
    /// `mem_sampler`: maity-desktop > 4000 MB RSS.
    AppRssCritical,
    /// `mem_sampler`: < 1024 MB disponibles en el sistema, sostenido.
    SystemMemoryPressure,
    /// `panics.rs::import_pending` encontró un panic del proceso anterior.
    RustPanic,
    /// Botón "Enviar diagnóstico" en Ajustes → Diagnóstico y Soporte.
    Manual,
}

impl IncidentKind {
    pub fn as_str(self) -> &'static str {
        match self {
            IncidentKind::AppRssCritical => "app-rss-critical",
            IncidentKind::SystemMemoryPressure => "system-memory-pressure",
            IncidentKind::RustPanic => "rust-panic",
            IncidentKind::Manual => "manual",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "app-rss-critical" => Some(IncidentKind::AppRssCritical),
            "system-memory-pressure" => Some(IncidentKind::SystemMemoryPressure),
            "rust-panic" => Some(IncidentKind::RustPanic),
            "manual" => Some(IncidentKind::Manual),
            _ => None,
        }
    }
}

/// Lo que viaja en `incident-detected` y en `take_pending_incident`.
#[derive(Debug, Clone, Serialize)]
pub struct IncidentPayload {
    pub kind: IncidentKind,
    pub ts_ms: u64,
    /// Una línea legible (la misma que va al log).
    pub message: String,
    /// Contexto crudo (sample de memoria, location del panic…).
    pub detail: serde_json::Value,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct IncidentPrefs {
    /// "No volver a preguntar": silencia los prompts automáticos (no el manual).
    #[serde(default)]
    pub never_ask: bool,
    /// Último prompt por `kind` (epoch ms), para el cooldown de 7 días.
    #[serde(default)]
    pub last_prompt_ms: HashMap<String, u64>,
}

static PENDING: Mutex<Option<IncidentPayload>> = Mutex::new(None);
/// Kinds ya preguntados en ESTE proceso (1 prompt por kind por proceso).
static PROMPTED: Mutex<Vec<IncidentKind>> = Mutex::new(Vec::new());

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ───────────────────────────── armado / dedupe ─────────────────────────────

/// Decisión pura: ¿se muestra el prompt para `kind`?
pub fn should_prompt(
    kind: IncidentKind,
    prefs: &IncidentPrefs,
    prompted_in_process: &[IncidentKind],
    now: u64,
) -> bool {
    if prefs.never_ask {
        return false;
    }
    if prompted_in_process.contains(&kind) {
        return false;
    }
    match prefs.last_prompt_ms.get(kind.as_str()) {
        Some(last) if now.saturating_sub(*last) < PROMPT_COOLDOWN_MS => false,
        _ => true,
    }
}

pub fn load_prefs<R: Runtime>(app: &AppHandle<R>) -> IncidentPrefs {
    let store = match app.store(PREFS_FILE) {
        Ok(store) => store,
        Err(e) => {
            warn!("[incident] store inaccesible ({}), prefs por defecto", e);
            return IncidentPrefs::default();
        }
    };
    match store.get(PREFS_KEY) {
        Some(value) => serde_json::from_value(value.clone()).unwrap_or_else(|e| {
            warn!("[incident] prefs ilegibles ({}), por defecto", e);
            IncidentPrefs::default()
        }),
        None => IncidentPrefs::default(),
    }
}

fn persist_prefs<R: Runtime>(app: &AppHandle<R>, prefs: &IncidentPrefs) -> Result<(), String> {
    let store = app
        .store(PREFS_FILE)
        .map_err(|e| format!("Store inaccesible: {}", e))?;
    let value = serde_json::to_value(prefs).map_err(|e| format!("Serialización falló: {}", e))?;
    store.set(PREFS_KEY, value);
    store
        .save()
        .map_err(|e| format!("No se pudo persistir a disco: {}", e))
}

/// Arma un incidente: si pasa el dedupe, lo deja en el slot pendiente, emite
/// `incident-detected` a la main y registra `incident.detected` en telemetría.
/// Devuelve `true` si se armó (se va a preguntar). Seguro de llamar cada 30 s
/// desde el sampler: el dedupe lo absorbe.
pub async fn arm<R: Runtime>(app: &AppHandle<R>, payload: IncidentPayload) -> bool {
    let mut prefs = load_prefs(app);
    let prompted = PROMPTED.lock().map(|p| p.clone()).unwrap_or_default();
    let now = now_ms();
    if !should_prompt(payload.kind, &prefs, &prompted, now) {
        return false;
    }

    if let Ok(mut p) = PROMPTED.lock() {
        p.push(payload.kind);
    }
    prefs
        .last_prompt_ms
        .insert(payload.kind.as_str().to_string(), now);
    if let Err(e) = persist_prefs(app, &prefs) {
        warn!("[incident] no se pudo persistir el cooldown: {}", e);
    }

    info!(
        "[incident] armado kind={} — {}",
        payload.kind.as_str(),
        payload.message
    );
    if let Ok(mut slot) = PENDING.lock() {
        *slot = Some(payload.clone());
    }
    if let Err(e) = app.emit(crate::events::INCIDENT_DETECTED, &payload) {
        warn!("[incident] emit incident-detected falló: {}", e);
    }

    super::telemetry::emit::emit_event(
        app,
        super::telemetry::context::process_session_id(),
        super::telemetry::catalog::INCIDENT_DETECTED,
        serde_json::json!({
            "kind": payload.kind.as_str(),
            "message": payload.message,
            "detail": payload.detail,
        }),
        Some("warning"),
        None,
        None,
    )
    .await;
    true
}

/// El frontend lo consulta al montar y en `visibilitychange` (pull), además
/// de escuchar el push. Consumir lo vacía.
#[tauri::command]
pub fn take_pending_incident() -> Option<IncidentPayload> {
    PENDING.lock().ok().and_then(|mut slot| slot.take())
}

#[tauri::command]
pub async fn get_incident_preferences<R: Runtime>(app: AppHandle<R>) -> Result<IncidentPrefs, String> {
    Ok(load_prefs(&app))
}

#[tauri::command]
pub async fn set_incident_preferences<R: Runtime>(
    app: AppHandle<R>,
    preferences: IncidentPrefs,
) -> Result<(), String> {
    info!("[incident] prefs: never_ask={}", preferences.never_ask);
    persist_prefs(&app, &preferences)
}

// ───────────────────────────── tail del log ─────────────────────────────

/// Normaliza un buffer leído desde `start` del archivo: si se truncó por
/// delante, descarta la primera línea parcial.
pub fn tail_text(buf: &[u8], truncated: bool) -> String {
    let text = String::from_utf8_lossy(buf);
    if !truncated {
        return text.into_owned();
    }
    match text.find('\n') {
        Some(idx) => text[idx + 1..].to_string(),
        None => String::new(),
    }
}

/// Últimos `max_bytes` de un archivo, alineados a línea, sin leer el resto.
pub fn tail_of_file(path: &Path, max_bytes: usize) -> std::io::Result<String> {
    let mut file = std::fs::File::open(path)?;
    let len = file.metadata()?.len();
    let start = len.saturating_sub(max_bytes as u64);
    file.seek(SeekFrom::Start(start))?;
    let mut buf = Vec::with_capacity((len - start) as usize);
    file.read_to_end(&mut buf)?;
    Ok(tail_text(&buf, start > 0))
}

/// Tail del log rotativo: el archivo más nuevo y, si no llena el presupuesto,
/// el anterior. El writer es `non_blocking`: las últimas líneas pueden no
/// estar en disco todavía (aceptado, es un tail de diagnóstico).
pub fn read_log_tail(max_bytes: usize) -> String {
    let files = match super::file_logger::list_log_files() {
        Ok(f) => f,
        Err(e) => return format!("(no se pudo listar el directorio de logs: {})", e),
    };
    let mut out = String::new();
    let mut budget = max_bytes;
    for (i, path) in files.iter().take(2).enumerate() {
        if budget == 0 {
            break;
        }
        match tail_of_file(path, budget) {
            Ok(chunk) => {
                budget = budget.saturating_sub(chunk.len());
                if i == 0 {
                    out = chunk;
                } else if !chunk.is_empty() {
                    out = format!(
                        "{}\n----- archivo anterior: {} -----\n{}",
                        chunk,
                        path.file_name().map(|n| n.to_string_lossy()).unwrap_or_default(),
                        out
                    );
                }
            }
            Err(e) => warn!("[incident] no se pudo leer {:?}: {}", path, e),
        }
    }
    if files.is_empty() {
        out.push_str("(sin archivos de log)");
    }
    out
}

// ───────────────────────────── bundle ─────────────────────────────

/// Cabecera JSON + system_info + tail. Solo texto: sin audio, sin
/// transcripciones, sin SQLite.
pub async fn build_bundle<R: Runtime>(
    app: &AppHandle<R>,
    kind: IncidentKind,
    note: Option<String>,
) -> String {
    let header = serde_json::json!({
        "kind": kind.as_str(),
        "note": note,
        "generated_at": chrono::Utc::now().to_rfc3339(),
        "ctx": super::telemetry::context::ctx_value(app),
        "mem": super::mem_sampler::last_sample().map(|(s, _)| s),
        "peaks": super::mem_sampler::session_peaks(),
        "phase": crate::audio::recording_phase::current_phase().as_str(),
        "lag_seconds": crate::audio::transcription::worker::transcription_lag_seconds(),
    });

    // system_info recorre la tabla de procesos y el tail toca disco: fuera del runtime.
    let (device, sysinfo, tail) = tokio::task::spawn_blocking(|| {
        (
            serde_json::to_value(super::commands::get_device_profile()).unwrap_or(serde_json::Value::Null),
            super::commands::generate_system_info(),
            read_log_tail(TAIL_MAX_BYTES),
        )
    })
    .await
    .unwrap_or_else(|e| (serde_json::Value::Null, format!("(system_info falló: {})", e), String::new()));

    let mut header = header;
    if let Some(obj) = header.as_object_mut() {
        obj.insert("device".into(), device);
    }

    format!(
        "{}\n----- system_info -----\n{}\n----- log tail (≤{} KB) -----\n{}",
        header,
        sysinfo,
        TAIL_MAX_BYTES / 1024,
        tail
    )
}

// ───────────────────────────── subida ─────────────────────────────

/// Claim `sub` del JWT (= `auth.users.id`). Sin verificar firma: solo se usa
/// para armar la ruta; la autorización real la hace Storage con el token.
pub fn jwt_sub(token: &str) -> Option<String> {
    let payload_b64 = token.split('.').nth(1)?;
    let trimmed = payload_b64.trim_end_matches('=');
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(trimmed)
        .ok()?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    value.get("sub")?.as_str().map(|s| s.to_string())
}

/// `{auth_uid}/{YYYYMMDD-HHMMSS}-{kind}-{session}.txt` — contrato con la
/// policy RLS (`(storage.foldername(name))[1] = auth.uid()`).
pub fn object_path(
    auth_uid: &str,
    kind: IncidentKind,
    at: chrono::DateTime<chrono::Utc>,
    session_id: &str,
) -> String {
    format!(
        "{}/{}-{}-{}.txt",
        auth_uid,
        at.format("%Y%m%d-%H%M%S"),
        kind.as_str(),
        session_id
    )
}

/// Mensaje corto para el usuario según el status HTTP de Storage.
pub fn upload_error_message(status: u16) -> String {
    match status {
        400 | 404 => "El destino de diagnósticos no está disponible todavía".to_string(),
        401 | 403 => "Sin permiso para enviar el diagnóstico; vuelve a iniciar sesión".to_string(),
        413 => "El diagnóstico es demasiado grande".to_string(),
        other => format!("Error {} al enviar el diagnóstico", other),
    }
}

/// Sube el bundle. SOLO se invoca tras el consentimiento explícito del usuario
/// (diálogo o botón). Sin reintentos ni cola: si falla, el usuario lo ve y el
/// export ZIP local sigue disponible.
#[tauri::command]
pub async fn upload_incident_bundle<R: Runtime>(
    app: AppHandle<R>,
    kind: String,
    note: Option<String>,
) -> Result<String, String> {
    let kind = IncidentKind::parse(&kind).ok_or_else(|| format!("kind desconocido: {}", kind))?;

    let session = {
        let cloud = app.state::<crate::cloud_sync::CloudSyncState>();
        cloud.snapshot().await
    }
    .ok_or_else(|| "Inicia sesión para enviar el diagnóstico".to_string())?;
    let token = crate::cloud_sync::session::get_valid_token(&app)
        .await
        .map_err(|e| format!("Sesión no válida ({})", e))?;
    let auth_uid = jwt_sub(&token).ok_or_else(|| "No se pudo identificar la sesión".to_string())?;

    let body = build_bundle(&app, kind, note).await;
    let path = object_path(
        &auth_uid,
        kind,
        chrono::Utc::now(),
        super::telemetry::context::process_session_id(),
    );
    let url = format!(
        "{}/storage/v1/object/{}/{}",
        session.supabase_url.trim_end_matches('/'),
        BUCKET,
        path
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(UPLOAD_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("HTTP client: {}", e))?;
    let bytes = body.len();
    let response = client
        .post(&url)
        .header("apikey", &session.anon_key)
        .bearer_auth(&token)
        .header("Content-Type", "text/plain; charset=utf-8")
        .header("x-upsert", "false")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("Sin conexión con el servidor ({})", e))?;

    let status = response.status();
    if !status.is_success() {
        let detail = response.text().await.unwrap_or_default();
        warn!(
            "[incident] upload {} → HTTP {}: {}",
            path,
            status.as_u16(),
            detail.chars().take(300).collect::<String>()
        );
        return Err(upload_error_message(status.as_u16()));
    }

    info!("[incident] bundle subido: {} ({} bytes)", path, bytes);
    super::telemetry::emit::emit_event(
        &app,
        super::telemetry::context::process_session_id(),
        super::telemetry::catalog::INCIDENT_BUNDLE_UPLOADED,
        serde_json::json!({
            "kind": kind.as_str(),
            "object_path": path,
            "bytes": bytes,
        }),
        Some("ok"),
        None,
        None,
    )
    .await;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tail_text_descarta_la_primera_linea_parcial_solo_si_se_trunco() {
        assert_eq!(tail_text(b"abc\ndef\nghi", true), "def\nghi");
        assert_eq!(tail_text(b"abc\ndef\nghi", false), "abc\ndef\nghi");
        // Sin salto de línea en todo el buffer truncado → nada útil
        assert_eq!(tail_text(b"sinlineas", true), "");
        // Corte justo en un salto: la línea siguiente queda completa
        assert_eq!(tail_text(b"\nlinea", true), "linea");
    }

    #[test]
    fn tail_of_file_respeta_el_presupuesto_y_alinea_a_linea() {
        let dir = std::env::temp_dir().join(format!("maity-incident-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("maity.log");
        let content: String = (0..200).map(|i| format!("linea {:03}\n", i)).collect();
        std::fs::write(&path, &content).unwrap();

        let tail = tail_of_file(&path, 100).unwrap();
        assert!(tail.len() <= 100);
        assert!(tail.starts_with("linea "), "debe empezar en inicio de línea: {:?}", tail);
        assert!(tail.ends_with("linea 199\n"));

        // Presupuesto mayor que el archivo → archivo completo, sin recorte
        let all = tail_of_file(&path, 1 << 20).unwrap();
        assert_eq!(all, content);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn jwt_sub_extrae_el_claim_y_falla_limpio() {
        // {"sub":"11111111-2222-3333-4444-555555555555","role":"authenticated"}
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(
            br#"{"sub":"11111111-2222-3333-4444-555555555555","role":"authenticated"}"#,
        );
        let token = format!("eyJhbGciOiJIUzI1NiJ9.{}.firma", payload);
        assert_eq!(jwt_sub(&token).as_deref(), Some("11111111-2222-3333-4444-555555555555"));
        // Con padding '=' también (algunos emisores lo dejan)
        let token_padded = format!("h.{}==.s", payload);
        assert!(jwt_sub(&token_padded).is_some());
        assert_eq!(jwt_sub("no-es-un-jwt"), None);
        assert_eq!(jwt_sub("a.!!!.c"), None);
        let sin_sub = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(br#"{"role":"x"}"#);
        assert_eq!(jwt_sub(&format!("a.{}.c", sin_sub)), None);
    }

    #[test]
    fn object_path_sigue_el_contrato_de_la_policy() {
        let at = chrono::DateTime::parse_from_rfc3339("2026-08-26T15:04:05Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        let p = object_path("uid-1", IncidentKind::RustPanic, at, "proc-123-ab");
        assert_eq!(p, "uid-1/20260826-150405-rust-panic-proc-123-ab.txt");
        // El primer segmento es el auth uid (lo que compara la policy)
        assert_eq!(p.split('/').next(), Some("uid-1"));
    }

    #[test]
    fn should_prompt_aplica_never_ask_proceso_y_cooldown() {
        let kind = IncidentKind::SystemMemoryPressure;
        let now = 10 * PROMPT_COOLDOWN_MS;
        let mut prefs = IncidentPrefs::default();
        assert!(should_prompt(kind, &prefs, &[], now));
        // Ya preguntado en este proceso
        assert!(!should_prompt(kind, &prefs, &[kind], now));
        // Otro kind sí
        assert!(should_prompt(IncidentKind::AppRssCritical, &prefs, &[kind], now));
        // Cooldown de 7 días persistido
        prefs.last_prompt_ms.insert(kind.as_str().into(), now - PROMPT_COOLDOWN_MS + 1);
        assert!(!should_prompt(kind, &prefs, &[], now));
        prefs.last_prompt_ms.insert(kind.as_str().into(), now - PROMPT_COOLDOWN_MS);
        assert!(should_prompt(kind, &prefs, &[], now));
        // never_ask silencia todo
        prefs.never_ask = true;
        assert!(!should_prompt(IncidentKind::AppRssCritical, &prefs, &[], now));
    }

    #[test]
    fn kind_roundtrip_y_serde_kebab() {
        for k in [
            IncidentKind::AppRssCritical,
            IncidentKind::SystemMemoryPressure,
            IncidentKind::RustPanic,
            IncidentKind::Manual,
        ] {
            assert_eq!(IncidentKind::parse(k.as_str()), Some(k));
            assert_eq!(serde_json::to_value(k).unwrap(), serde_json::json!(k.as_str()));
        }
        assert_eq!(IncidentKind::parse("otro"), None);
    }

    #[test]
    fn prefs_deserializan_json_vacio() {
        let p: IncidentPrefs = serde_json::from_str("{}").unwrap();
        assert!(!p.never_ask);
        assert!(p.last_prompt_ms.is_empty());
    }

    #[test]
    fn upload_error_message_por_status() {
        assert!(upload_error_message(404).contains("no está disponible"));
        assert!(upload_error_message(400).contains("no está disponible"));
        assert!(upload_error_message(403).contains("permiso"));
        assert!(upload_error_message(500).contains("500"));
    }
}
