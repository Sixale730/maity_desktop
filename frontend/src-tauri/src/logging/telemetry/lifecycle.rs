//! Marcador de ciclo de vida del PROCESO (#83, desde 0.2.62).
//!
//! Responde en el arranque "¿cómo terminó el proceso anterior?" (versión previa,
//! motivo, si fue limpio, cuánto estuvo apagado) y distingue "laptop suspendida"
//! de "sin señal". No confundir con `app.open`/`app.close`, que emite el webview
//! (`app.close` es solo la ventana escondida a la bandeja).
//!
//! Fuente de verdad: un archivo síncrono en disco (`lifecycle.json`, o
//! `lifecycle-debug.json` con `debug_assertions`) en `app_local_data_dir` — NO
//! viaja con el perfil y NO usa `telemetry.json` (plugin-store escribe
//! no-atómico). La fila del outbox (`app.start`, `app.resumed`, luego
//! `app.exit`) es best-effort; el marcador es lo que sobrevive a un
//! "Finalizar tarea" o a un corte de luz.
//!
//! Ciclo (contrato §1.5):
//! 1. `rotate_at_boot` — PRIMERA sentencia del `setup()`, antes del init de la
//!    DB (un cuelgue de la DB se ve como "arrancó y nunca vivió"): lee el
//!    marcador anterior, escribe el nuevo (durable) y guarda el resumen
//!    pendiente en un `OnceLock`.
//! 2. `emit_start` — tras el init de la DB (el outbox necesita `AppState`):
//!    spawn que calcula `summarize_prev` y deja `app.start` en el outbox, y
//!    arranca el ticker de 60 s (`last_alive_ms` + `app.resumed`).
//! 3. `begin_exit` — PRIMERO en toda salida (bandeja, rival, `RunEvent::Exit`):
//!    escribe el bloque `exit` (durable) con el motivo del contrato §1.7 y
//!    apaga la drenadora; luego `emit_exit_row` deja `app.exit` en el outbox
//!    (insert acotado) y `finish_exit` sella `done_at_ms`. Un centinela en la
//!    tabla de recursos cubre las salidas que no pasan por `RunEvent::Exit`.
//!
//! Reglas: nunca `log::error!` en este módulo (solo `warn!`, fuera del lock y
//! con rate-limit); nunca `.lock().unwrap()`; ningún literal de "versión
//! desconocida" (lint (d) de `lint-telemetry.js`): una versión que no se sabe
//! va como `null`.

use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Manager, Runtime};

use super::panics::{self, PanicTs};
use super::status::TelemetryStatus;
use super::{catalog, context, emit};

/// Versión del esquema del marcador y del payload (`lifecycle_schema`).
pub const MARKER_SCHEMA: u32 = 1;

/// Periodo del ticker de vida (`last_alive_ms`).
const ALIVE_TICK: Duration = Duration::from_secs(60);
/// Salto de reloj de pared entre ticks que cuenta como suspensión.
const RESUME_GAP_MS: u64 = 180_000;
/// Margen tras el último latido en el que un panic todavía cuenta como del
/// proceso anterior (el hook escribe el panic y el proceso muere después).
const PANIC_GRACE_MS: u64 = 120_000;
/// Diferencia de `boot_time` del SO a partir de la cual se considera que la PC
/// se reinició entre procesos (el valor de sysinfo oscila unos segundos).
const OS_BOOT_TOLERANCE_MS: u64 = 120_000;

// ── Tipos del marcador (contrato §1.5) ─────────────────────────────────────
//
// `#[serde(default)]` a nivel de struct = default en CADA campo (el struct
// deriva `Default`): un marcador de una versión más vieja o más nueva se lee con
// lo que se conozca. Sin `deny_unknown_fields` a propósito. Los motivos van
// como `String`: una versión más nueva puede traer motivos que esta no conoce.

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct LifecycleMarker {
    pub schema: u32,
    pub proc_session_id: String,
    pub version: String,
    /// `release | debug`.
    pub build: String,
    /// `store | direct`.
    pub build_channel: String,
    pub started_at_ms: u64,
    pub last_alive_ms: u64,
    pub os_boot_ms: Option<u64>,
    pub exit: Option<MarkerExit>,
    pub exit_intent: Option<MarkerIntent>,
    pub last_resume: Option<MarkerResume>,
    /// Se ARRASTRA entre arranques (línea base de `autostart.changed`, P2).
    pub last_autostart_state: Option<String>,
    /// Se ARRASTRA entre arranques (marca de login para `auth.session_lost`, S4).
    pub last_login_user: Option<LastLoginUser>,
}

/// Salida observada del proceso (la escribe `begin_exit`, L2).
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct MarkerExit {
    pub reason: String,
    pub detail: Option<String>,
    pub exit_code: Option<i32>,
    pub begun_at_ms: u64,
    pub done_at_ms: Option<u64>,
    pub recording_active: bool,
    pub session_end_kind: Option<String>,
    pub critical: bool,
}

/// Intención de salida registrada ANTES de que el proceso muera por una vía
/// que no pasa por `RunEvent::Exit` (update, fin de sesión). No caduca por edad.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct MarkerIntent {
    /// `update | session_end`.
    pub reason: String,
    /// `store_button | store_api | nsis`.
    pub via: Option<String>,
    pub detail: Option<String>,
    pub target_version: Option<String>,
    pub at_ms: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct MarkerResume {
    pub suspended_at_ms: u64,
    pub resumed_at_ms: u64,
    pub gap_s: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct LastLoginUser {
    pub maity_user_id: String,
    pub since_ms: u64,
}

/// Nombre del archivo del marcador. Se llama con `cfg!(debug_assertions)`:
/// debug y release no se pisan el marcador aunque compartan directorio.
pub(crate) fn marker_file_name(debug: bool) -> &'static str {
    if debug {
        "lifecycle-debug.json"
    } else {
        "lifecycle.json"
    }
}

// ── Estado del proceso ─────────────────────────────────────────────────────

struct MarkerSlot {
    path: PathBuf,
    marker: LifecycleMarker,
}

/// Marcador vivo del proceso actual. El lock cubre la E/S A PROPÓSITO:
/// serializa a los escritores (ticker, WndProc del fin de sesión, hilo
/// principal en `RunEvent::Exit`, accesores) para que ninguna escritura
/// vieja pise a una nueva en disco. Es un `std::sync::Mutex` (síncrono): se
/// puede tomar desde el WndProc y desde el hilo principal sin runtime.
/// `None` = `app_local_data_dir` no resolvió (todo se vuelve no-op).
static MARKER: Mutex<Option<MarkerSlot>> = Mutex::new(None);

/// Resumen del proceso anterior, capturado en `rotate_at_boot` y consumido por
/// `emit_start` cuando ya hay outbox.
struct BootPrev {
    read: MarkerRead,
    panics: Vec<PanicTs>,
    now_ms: u64,
    os_boot_ms: Option<u64>,
    build_channel: &'static str,
}

static BOOT_PREV: OnceLock<BootPrev> = OnceLock::new();

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn build_name() -> &'static str {
    if cfg!(debug_assertions) {
        "debug"
    } else {
        "release"
    }
}

/// Misma regla que `logging/commands.rs::get_device_profile`.
fn current_channel() -> &'static str {
    if crate::utils::is_running_under_package_identity() {
        "store"
    } else {
        "direct"
    }
}

/// `boot_time` del SO en ms (0 ⇒ `None`). Función asociada en sysinfo 0.32:
/// no requiere refrescar un `System`.
fn os_boot_ms() -> Option<u64> {
    match sysinfo::System::boot_time() {
        0 => None,
        secs => secs.checked_mul(1000),
    }
}

fn ms_to_rfc3339(ms: u64) -> Option<String> {
    let ms = i64::try_from(ms).ok()?;
    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(ms).map(|d| d.to_rfc3339())
}

// ── Avisos con rate-limit ──────────────────────────────────────────────────

#[derive(Clone, Copy)]
enum WarnKind {
    Rotate,
    Tick,
    Accessor,
    Exit,
}

static WARNED_ROTATE: AtomicBool = AtomicBool::new(false);
static WARNED_TICK: AtomicBool = AtomicBool::new(false);
static WARNED_ACCESSOR: AtomicBool = AtomicBool::new(false);
static WARNED_EXIT: AtomicBool = AtomicBool::new(false);

/// Un `warn!` por tipo de error y proceso. Llamar SIEMPRE fuera del lock del
/// marcador (el logger puede tocar disco).
fn warn_once(kind: WarnKind, msg: &str) {
    let (flag, label) = match kind {
        WarnKind::Rotate => (&WARNED_ROTATE, "rotate"),
        WarnKind::Tick => (&WARNED_TICK, "tick"),
        WarnKind::Accessor => (&WARNED_ACCESSOR, "accessor"),
        WarnKind::Exit => (&WARNED_EXIT, "exit"),
    };
    if !flag.swap(true, Ordering::Relaxed) {
        log::warn!("[lifecycle] {} falló (se avisa una vez): {}", label, msg);
    }
}

// ── Escritura ──────────────────────────────────────────────────────────────

/// Escritura atómica: `<archivo>.json.tmp` (+ `sync_all` si `durable`) y
/// `rename` sobre el destino. Si el rename falla (antivirus/indexador con el
/// archivo abierto), reintenta a los 20 ms; si vuelve a fallar, escribe
/// in-place (+ `sync_all` si `durable`) y borra el `.tmp`.
fn write_atomic(path: &Path, bytes: &[u8], durable: bool) -> std::io::Result<()> {
    let tmp = path.with_extension("json.tmp");
    {
        let mut file = std::fs::File::create(&tmp)?;
        file.write_all(bytes)?;
        if durable {
            file.sync_all()?;
        }
    }
    if std::fs::rename(&tmp, path).is_ok() {
        return Ok(());
    }
    std::thread::sleep(Duration::from_millis(20));
    if std::fs::rename(&tmp, path).is_ok() {
        return Ok(());
    }
    let in_place = (|| -> std::io::Result<()> {
        let mut file = std::fs::File::create(path)?;
        file.write_all(bytes)?;
        if durable {
            file.sync_all()?;
        }
        Ok(())
    })();
    let _ = std::fs::remove_file(&tmp);
    in_place
}

/// Aplica `f` al marcador vivo y lo persiste. Sin marcador (dir no resolvió)
/// es no-op. El error vuelve como `String` para que el llamador lo avise con
/// `warn_once` DESPUÉS de soltar el lock.
fn mutate_marker(durable: bool, f: impl FnOnce(&mut LifecycleMarker)) -> Result<(), String> {
    let mut guard = MARKER.lock().unwrap_or_else(|e| e.into_inner());
    let Some(slot) = guard.as_mut() else {
        return Ok(());
    };
    f(&mut slot.marker);
    let bytes = serde_json::to_vec(&slot.marker).map_err(|e| e.to_string())?;
    write_atomic(&slot.path, &bytes, durable).map_err(|e| format!("{}: {}", slot.path.display(), e))
}

// ── Lectura ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum MarkerRead {
    Missing,
    Corrupt,
    /// Marcador de otro `build_channel` (store vs direct): se ignora.
    Foreign(LifecycleMarker),
    Ok(LifecycleMarker),
}

impl MarkerRead {
    fn status(&self) -> &'static str {
        match self {
            MarkerRead::Missing => "missing",
            MarkerRead::Corrupt => "corrupt",
            MarkerRead::Foreign(_) => "foreign",
            MarkerRead::Ok(_) => "ok",
        }
    }
}

/// Pura: `None` ⇒ Missing; JSON inválido ⇒ Corrupt; `build_channel` no vacío y
/// distinto del actual ⇒ Foreign; si no, Ok.
pub(crate) fn parse_marker(raw: Option<&str>, current_channel: &str) -> MarkerRead {
    let Some(raw) = raw else {
        return MarkerRead::Missing;
    };
    match serde_json::from_str::<LifecycleMarker>(raw) {
        Err(_) => MarkerRead::Corrupt,
        Ok(m) if !m.build_channel.is_empty() && m.build_channel != current_channel => {
            MarkerRead::Foreign(m)
        }
        Ok(m) => MarkerRead::Ok(m),
    }
}

// ── Rotación al arrancar ───────────────────────────────────────────────────

/// Síncrona, PRIMERA sentencia útil del `setup()` (antes del init de la DB).
/// Lee el marcador anterior y el archivo de pánicos (sin borrarlo: lo importa
/// después `panics::import_pending`), escribe el marcador del proceso nuevo
/// (durable) y deja el resumen pendiente para `emit_start`. Nunca falla: sin
/// `app_local_data_dir` guarda igual el resumen (para que `app.start` salga con
/// su `marker_status`) y deja el marcador vivo en `None`.
pub fn rotate_at_boot<R: Runtime>(app: &AppHandle<R>) {
    let now = now_ms();
    let os_boot = os_boot_ms();
    let channel = current_channel();
    let file_name = marker_file_name(cfg!(debug_assertions));

    let dir = app.path().app_local_data_dir();
    let raw = dir
        .as_ref()
        .ok()
        .and_then(|d| std::fs::read_to_string(d.join(file_name)).ok());
    let read = parse_marker(raw.as_deref(), channel);

    let panics = app
        .path()
        .app_data_dir()
        .ok()
        .and_then(|d| std::fs::read_to_string(d.join(panics::PANIC_FILE_NAME)).ok())
        .map(|c| panics::parse_panic_ts(&c))
        .unwrap_or_default();

    let mut warn: Option<String> = None;
    match dir {
        Ok(dir) => {
            let (last_autostart_state, last_login_user) = match &read {
                MarkerRead::Ok(prev) => {
                    (prev.last_autostart_state.clone(), prev.last_login_user.clone())
                }
                _ => (None, None),
            };
            let marker = LifecycleMarker {
                schema: MARKER_SCHEMA,
                proc_session_id: context::process_session_id().to_string(),
                version: app.package_info().version.to_string(),
                build: build_name().to_string(),
                build_channel: channel.to_string(),
                started_at_ms: now,
                last_alive_ms: now,
                os_boot_ms: os_boot,
                exit: None,
                exit_intent: None,
                last_resume: None,
                last_autostart_state,
                last_login_user,
            };
            let path = dir.join(file_name);
            let write = std::fs::create_dir_all(&dir)
                .map_err(|e| format!("{}: {}", dir.display(), e))
                .and_then(|_| serde_json::to_vec(&marker).map_err(|e| e.to_string()));
            let mut guard = MARKER.lock().unwrap_or_else(|e| e.into_inner());
            let result = write.and_then(|bytes| {
                write_atomic(&path, &bytes, true).map_err(|e| format!("{}: {}", path.display(), e))
            });
            // El slot se guarda aunque la escritura falle: un error transitorio
            // (antivirus) no debe apagar las escrituras del resto del proceso.
            *guard = Some(MarkerSlot { path, marker });
            drop(guard);
            if let Err(e) = result {
                warn = Some(e);
            }
        }
        Err(e) => warn = Some(format!("app_local_data_dir no resolvió: {}", e)),
    }
    if let Some(msg) = warn {
        warn_once(WarnKind::Rotate, &msg);
    }

    let _ = BOOT_PREV.set(BootPrev {
        read,
        panics,
        now_ms: now,
        os_boot_ms: os_boot,
        build_channel: channel,
    });
}

// ── app.start ──────────────────────────────────────────────────────────────

/// Tras el init de la DB. No bloquea el setup: todo va en un spawn que (1) en
/// release y sin marcador usable busca la versión previa en el outbox, (2) lee
/// el estado real del autostart, (3) resume el proceso anterior, (4) deja
/// `app.start` en el outbox y (5) arranca el ticker de vida.
pub fn emit_start<R: Runtime>(app: &AppHandle<R>) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Some(boot) = BOOT_PREV.get() {
            let session_id = context::process_session_id();

            let fallback_prev_version =
                if !matches!(boot.read, MarkerRead::Ok(_)) && !cfg!(debug_assertions) {
                    match app.try_state::<crate::state::AppState>() {
                        Some(state) => {
                            crate::database::repositories::recording_log::RecordingLogRepository::last_app_version_excluding_session(
                                state.db_manager.pool(),
                                session_id,
                            )
                            .await
                            .ok()
                            .flatten()
                        }
                        None => None,
                    }
                } else {
                    None
                };

            let autostart = crate::autostart_state::current(&app).await;
            let current_version = app.package_info().version.to_string();

            let summary = summarize_prev(&PrevInput {
                read: &boot.read,
                now_ms: boot.now_ms,
                current_version: &current_version,
                panics: &boot.panics,
                os_boot_ms: boot.os_boot_ms,
                fallback_prev_version,
            });
            let extras = StartExtras {
                build: build_name(),
                build_channel: boot.build_channel,
                started_at_boot: crate::STARTED_AT_BOOT.load(Ordering::Relaxed),
                autostart_state: Some(autostart.state),
                started_at_ms: boot.now_ms,
                os_boot_ms: boot.os_boot_ms,
            };
            let status = if summary.prev_exit_clean == Some(false) {
                TelemetryStatus::Warning
            } else {
                TelemetryStatus::Ok
            };
            emit::emit_event(
                &app,
                session_id,
                catalog::APP_START,
                summary.to_payload(&extras),
                Some(status),
                None,
                None,
            )
            .await;
        }
        spawn_alive_ticker(app);
    });
}

// ── Ticker de vida y app.resumed ───────────────────────────────────────────

/// Pura: `Some(gap_ms)` si el reloj de pared saltó más de 180 s entre ticks.
pub(crate) fn resume_gap_ms(prev_tick_ms: u64, now_ms: u64) -> Option<u64> {
    let gap = now_ms.checked_sub(prev_tick_ms)?;
    (gap > RESUME_GAP_MS).then_some(gap)
}

/// Ticker propio (NO el `mem_sampler`, que arranca tarde): cada 60 s escribe
/// `last_alive_ms` (no durable). `tokio::time::sleep` cuenta con `Instant`,
/// que sigue corriendo durante la suspensión en Windows: el tick dispara justo
/// al reanudar y el salto del reloj de pared ES la suspensión ⇒ `last_resume`
/// en el marcador (durable) + evento `app.resumed`.
fn spawn_alive_ticker<R: Runtime>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        let mut prev_tick_ms = now_ms();
        loop {
            tokio::time::sleep(ALIVE_TICK).await;
            let now = now_ms();
            let resume = resume_gap_ms(prev_tick_ms, now).map(|gap| MarkerResume {
                suspended_at_ms: prev_tick_ms,
                resumed_at_ms: now,
                gap_s: gap / 1000,
            });

            let durable = resume.is_some();
            let resume_for_marker = resume.clone();
            let written = tokio::task::spawn_blocking(move || {
                mutate_marker(durable, |m| {
                    m.last_alive_ms = now;
                    if let Some(r) = resume_for_marker {
                        m.last_resume = Some(r);
                    }
                })
            })
            .await;
            match written {
                Ok(Ok(())) => {}
                Ok(Err(e)) => warn_once(WarnKind::Tick, &e),
                Err(e) => warn_once(WarnKind::Tick, &e.to_string()),
            }

            if let Some(r) = resume {
                let payload = serde_json::json!({
                    "suspended_at": ms_to_rfc3339(r.suspended_at_ms),
                    "resumed_at": ms_to_rfc3339(r.resumed_at_ms),
                    "gap_s": r.gap_s,
                });
                emit::emit_event(
                    &app,
                    context::process_session_id(),
                    catalog::APP_RESUMED,
                    payload,
                    Some(TelemetryStatus::Ok),
                    None,
                    None,
                )
                .await;
            }
            prev_tick_ms = now;
        }
    });
}

// ── Resumen del proceso anterior (puro) ────────────────────────────────────

pub(crate) struct PrevInput<'a> {
    pub read: &'a MarkerRead,
    pub now_ms: u64,
    pub current_version: &'a str,
    pub panics: &'a [PanicTs],
    pub os_boot_ms: Option<u64>,
    /// Versión previa sacada del outbox (solo release y sin marcador usable).
    pub fallback_prev_version: Option<String>,
}

/// Campos de `app.start` que no dependen del proceso anterior.
pub(crate) struct StartExtras<'a> {
    pub build: &'a str,
    pub build_channel: &'a str,
    pub started_at_boot: bool,
    pub autostart_state: Option<String>,
    pub started_at_ms: u64,
    pub os_boot_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub(crate) struct PrevSummary {
    pub marker_status: &'static str,
    pub first_run: bool,
    pub prev_session_id: Option<String>,
    pub prev_version: Option<String>,
    /// `marker | outbox`.
    pub prev_version_source: Option<&'static str>,
    pub version_changed: Option<bool>,
    pub prev_started_at_ms: Option<u64>,
    pub prev_last_alive_at_ms: Option<u64>,
    pub prev_uptime_s: Option<u64>,
    pub prev_exit_reason: Option<String>,
    pub prev_exit_detail: Option<String>,
    /// `observed | intent | inferred`.
    pub prev_exit_source: Option<&'static str>,
    /// `null` = sin marcador (primer arranque o upgrade desde <0.2.62).
    pub prev_exit_clean: Option<bool>,
    pub prev_exit_interrupted: Option<bool>,
    pub prev_recording_active_at_exit: Option<bool>,
    pub prev_panicked: Option<bool>,
    pub prev_panic_count: Option<u64>,
    pub os_rebooted_since_prev: Option<bool>,
    pub downtime_s: Option<u64>,
    pub clock_skew: bool,
}

/// Motivos observados que una intención `update` pendiente sobreescribe: el
/// update cerró la app por una vía que el proceso vio como fin de sesión /
/// Restart Manager, o salió sin `RunEvent::Exit` (centinela).
const OVERRIDABLE_BY_UPDATE: &[&str] =
    &["os_session_end", "external_close", "process_exit_after_cleanup"];

/// Pura. Reglas del contrato §1.6/§1.7. Precedencia del motivo: exit observado
/// (con la excepción de update) → intención pendiente (no caduca por edad) →
/// `crash_panic` (panic del hilo `main` en la ventana de vida) →
/// `os_restart_unclean` (cambió el boot del SO) → `unclean`.
pub(crate) fn summarize_prev(input: &PrevInput) -> PrevSummary {
    let marker = match input.read {
        MarkerRead::Ok(m) => m,
        other => {
            // Sin marcador usable: todos los `prev_*` de salida en null.
            let prev_version = input
                .fallback_prev_version
                .clone()
                .filter(|v| !v.is_empty());
            let first_run = matches!(other, MarkerRead::Missing) && prev_version.is_none();
            return PrevSummary {
                marker_status: other.status(),
                first_run,
                version_changed: prev_version.as_deref().map(|p| p != input.current_version),
                prev_version_source: prev_version.as_ref().map(|_| "outbox"),
                prev_version,
                ..PrevSummary::default()
            };
        }
    };

    // Versión previa: del marcador; si viniera vacía, del respaldo del outbox.
    let (prev_version, prev_version_source) = if !marker.version.is_empty() {
        (Some(marker.version.clone()), Some("marker"))
    } else {
        match input.fallback_prev_version.clone().filter(|v| !v.is_empty()) {
            Some(v) => (Some(v), Some("outbox")),
            None => (None, None),
        }
    };
    let version_changed = prev_version.as_deref().map(|p| p != input.current_version);

    // Tiempos.
    let started = marker.started_at_ms;
    let alive = marker.last_alive_ms.max(started);
    let exit = marker.exit.as_ref().filter(|e| !e.reason.is_empty());
    let end_ms = exit.map(|e| e.begun_at_ms).unwrap_or(alive);
    let prev_uptime_s = end_ms.saturating_sub(started) / 1000;
    let last_seen = match exit {
        Some(e) => e.done_at_ms.unwrap_or(e.begun_at_ms).max(alive),
        None => alive,
    };
    let (downtime_s, clock_skew) = match input.now_ms.checked_sub(last_seen) {
        Some(d) => (d / 1000, false),
        None => (0, true),
    };

    // Pánicos dentro de la vida del proceso anterior: `[started_at_ms,
    // last_alive_ms + 120 s]` (contrato §1.7). Se ancla en el último latido y
    // NO en `last_seen`: una salida observada que terminó tarde no debe
    // agrandar la ventana y atribuirle pánicos que no son de esa vida.
    let window_end = alive.saturating_add(PANIC_GRACE_MS);
    let in_window: Vec<&PanicTs> = input
        .panics
        .iter()
        .filter(|p| p.ts_ms >= started && p.ts_ms <= window_end)
        .collect();
    let panic_count = in_window.len() as u64;
    let main_panic = in_window.iter().any(|p| p.thread.as_deref() == Some("main"));

    let os_rebooted = match (marker.os_boot_ms, input.os_boot_ms) {
        (Some(a), Some(b)) => Some(a.abs_diff(b) > OS_BOOT_TOLERANCE_MS),
        _ => None,
    };

    // Motivo de salida.
    let intent = marker.exit_intent.as_ref();
    let intent_is = |reason: &str| intent.filter(|i| i.reason == reason);
    let (reason, detail, source, clean): (String, Option<String>, &'static str, bool) =
        if let Some(e) = exit {
            match intent_is("update") {
                Some(i) if OVERRIDABLE_BY_UPDATE.contains(&e.reason.as_str()) => (
                    "update".to_string(),
                    e.detail.clone().or_else(|| i.via.clone()),
                    "observed",
                    true,
                ),
                _ => (e.reason.clone(), e.detail.clone(), "observed", true),
            }
        } else if let Some(i) = intent_is("update") {
            ("update".to_string(), i.via.clone(), "intent", true)
        } else if let Some(i) = intent_is("session_end") {
            // Restart Manager SIN apagado (instalador): no es fin de sesión.
            if i.detail.as_deref() == Some(crate::session_end::SessionEndKind::CloseApp.as_str()) {
                ("external_close".to_string(), None, "intent", true)
            } else {
                ("os_session_end".to_string(), i.detail.clone(), "intent", true)
            }
        } else if main_panic {
            ("crash_panic".to_string(), None, "inferred", false)
        } else if os_rebooted == Some(true) {
            ("os_restart_unclean".to_string(), None, "inferred", false)
        } else {
            ("unclean".to_string(), None, "inferred", false)
        };

    PrevSummary {
        marker_status: "ok",
        first_run: false,
        prev_session_id: Some(marker.proc_session_id.clone()).filter(|s| !s.is_empty()),
        prev_version,
        prev_version_source,
        version_changed,
        prev_started_at_ms: Some(started).filter(|&t| t > 0),
        prev_last_alive_at_ms: Some(alive).filter(|&t| t > 0),
        prev_uptime_s: Some(prev_uptime_s),
        prev_exit_reason: Some(reason),
        prev_exit_detail: detail,
        prev_exit_source: Some(source),
        prev_exit_clean: Some(clean),
        prev_exit_interrupted: exit.map(|e| e.done_at_ms.is_none()),
        prev_recording_active_at_exit: exit.map(|e| e.recording_active),
        prev_panicked: Some(panic_count > 0),
        prev_panic_count: Some(panic_count),
        os_rebooted_since_prev: os_rebooted,
        downtime_s: Some(downtime_s),
        clock_skew,
    }
}

impl PrevSummary {
    /// Payload completo de `app.start` (contrato §1.6).
    pub(crate) fn to_payload(&self, extras: &StartExtras) -> serde_json::Value {
        serde_json::json!({
            "lifecycle_schema": MARKER_SCHEMA,
            "build": extras.build,
            "build_channel": extras.build_channel,
            "started_at_boot": extras.started_at_boot,
            "autostart_state": extras.autostart_state,
            "started_at": ms_to_rfc3339(extras.started_at_ms),
            "os_boot_at": extras.os_boot_ms.and_then(ms_to_rfc3339),
            "first_run": self.first_run,
            "marker_status": self.marker_status,
            "prev_session_id": self.prev_session_id,
            "prev_version": self.prev_version,
            "prev_version_source": self.prev_version_source,
            "version_changed": self.version_changed,
            "prev_started_at": self.prev_started_at_ms.and_then(ms_to_rfc3339),
            "prev_last_alive_at": self.prev_last_alive_at_ms.and_then(ms_to_rfc3339),
            "prev_uptime_s": self.prev_uptime_s,
            "prev_exit_reason": self.prev_exit_reason,
            "prev_exit_detail": self.prev_exit_detail,
            "prev_exit_source": self.prev_exit_source,
            "prev_exit_clean": self.prev_exit_clean,
            "prev_exit_interrupted": self.prev_exit_interrupted,
            "prev_recording_active_at_exit": self.prev_recording_active_at_exit,
            "prev_panicked": self.prev_panicked,
            "prev_panic_count": self.prev_panic_count,
            "os_rebooted_since_prev": self.os_rebooted_since_prev,
            "downtime_s": self.downtime_s,
            "clock_skew": self.clock_skew,
        })
    }
}

// ── Accesores arrastrados entre arranques (contrato §1.8, síncronos) ───────

/// Escribe `new` como línea base del autostart (no durable, aunque sea igual al
/// anterior) y devuelve el valor previo. Reentrante: el lock se suelta al
/// volver, así que P2 puede hacer swap → emitir → swap de reversa.
pub fn swap_last_autostart_state(new: &str) -> Option<String> {
    let mut prev = None;
    if let Err(e) = mutate_marker(false, |m| {
        prev = m.last_autostart_state.replace(new.to_string());
    }) {
        warn_once(WarnKind::Accessor, &e);
    }
    prev
}

/// Marca de login (durable, `since_ms = ahora`).
pub fn set_last_login_user(maity_user_id: &str) {
    let since_ms = now_ms();
    let user = LastLoginUser {
        maity_user_id: maity_user_id.to_string(),
        since_ms,
    };
    if let Err(e) = mutate_marker(true, |m| m.last_login_user = Some(user)) {
        warn_once(WarnKind::Accessor, &e);
    }
}

/// Lee la marca de login sin escribir.
pub fn peek_last_login_user() -> Option<LastLoginUser> {
    let guard = MARKER.lock().unwrap_or_else(|e| e.into_inner());
    guard.as_ref().and_then(|s| s.marker.last_login_user.clone())
}

/// Devuelve y borra la marca de login (durable).
pub fn take_last_login_user() -> Option<LastLoginUser> {
    let mut taken = None;
    if let Err(e) = mutate_marker(true, |m| taken = m.last_login_user.take()) {
        warn_once(WarnKind::Accessor, &e);
    }
    taken
}

// ── Salida del proceso: app.exit (L2, contrato §1.7) ───────────────────────

/// Tope del insert de `app.exit` en las salidas normales: el pool tiene
/// `acquire_timeout` de 30 s y el marcador ya es la fuente de verdad, así que
/// la fila del outbox es best-effort y no puede retrasar la salida.
pub const EXIT_ROW_TIMEOUT: Duration = Duration::from_millis(750);
/// Tope del insert en la rama de fin de sesión de Windows (lo usa E2b).
#[allow(dead_code)]
pub const EXIT_ROW_TIMEOUT_SESSION_END: Duration = Duration::from_millis(400);

/// Motivo propio de una salida que la inicia la app misma. Gana sobre lo que
/// se observe después (el `app.exit(0)` que sigue llega como `ExitRequested`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExitHint {
    /// "Salir" del menú de la bandeja.
    TrayQuit,
    /// Desinstalación de la instalación rival (`rival_install::uninstall_rival`).
    RivalInstall,
    /// Update. `via` = `store_button | store_api | nsis` (va en `detail`).
    Update { via: &'static str },
}

/// Último `RunEvent::ExitRequested` visto por el `.run` de lib.rs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ExitRequestSeen {
    NotSeen,
    /// `AppHandle::exit(code)` / `restart()` (`Some(code)`).
    Programmatic(i32),
    /// `None`: se cerró la última ventana (regresión tipo 0.2.57).
    UserInteraction,
}

static EXIT_REQUESTED: Mutex<ExitRequestSeen> = Mutex::new(ExitRequestSeen::NotSeen);

/// Emit-once de la salida: el primero que llega (bandeja, rival, `RunEvent::Exit`
/// o el centinela) escribe el bloque `exit`; los demás son no-op.
static EXIT_BEGUN: AtomicBool = AtomicBool::new(false);

/// `true` solo para el primer llamador (swap atómico).
fn claim_once(flag: &AtomicBool) -> bool {
    !flag.swap(true, Ordering::SeqCst)
}

/// Lo llama el `.run` de lib.rs en `RunEvent::ExitRequested`. Síncrona; NO
/// hace `prevent_exit` (no cambia el comportamiento de la salida).
pub fn note_exit_requested(code: Option<i32>) {
    let seen = match code {
        Some(c) => ExitRequestSeen::Programmatic(c),
        None => ExitRequestSeen::UserInteraction,
    };
    *EXIT_REQUESTED.lock().unwrap_or_else(|e| e.into_inner()) = seen;
}

/// `GetSystemMetrics(SM_SHUTTINGDOWN) != 0`: Windows está cerrando la sesión o
/// apagando. Respaldo cuando no hay registro exacto del fin de sesión (E1).
/// Extern crudo de `user32` (sin feature nueva del crate `windows`).
pub(crate) fn os_shutting_down() -> bool {
    #[cfg(target_os = "windows")]
    {
        #[link(name = "user32")]
        extern "system" {
            fn GetSystemMetrics(n_index: i32) -> i32;
        }
        const SM_SHUTTINGDOWN: i32 = 0x2000;
        // SAFETY: función sin punteros ni estado; solo lee una métrica del sistema.
        unsafe { GetSystemMetrics(SM_SHUTTINGDOWN) != 0 }
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

/// Fin de sesión de Windows observado (E1 lo llena desde el subclass del HWND).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct SessionEndHint {
    /// `logoff | shutdown | unknown` (`close_app` con `external_close`, que
    /// `classify_exit` no usa como detail).
    pub detail: &'static str,
    pub critical: bool,
    /// Restart Manager `CLOSEAPP` SIN apagado del sistema (instalador).
    pub external_close: bool,
}

/// Pura. Tipo observado por `session_end` ⇒ pista para `classify_exit`:
/// `CloseApp` ⇒ `external_close`; el resto ⇒ `os_session_end` con su detail.
pub(crate) fn session_end_hint(
    kind: crate::session_end::SessionEndKind,
    critical: bool,
) -> SessionEndHint {
    use crate::session_end::SessionEndKind;
    SessionEndHint {
        detail: kind.as_str(),
        critical,
        external_close: kind == SessionEndKind::CloseApp,
    }
}

/// Pura. Intención `session_end` con el tipo (`close_app` incluido: el resumen
/// la lee como `external_close`). NO pisa una intención `update`.
fn apply_session_intent(m: &mut LifecycleMarker, kind: crate::session_end::SessionEndKind, now: u64) {
    if m.exit_intent.as_ref().map(|i| i.reason.as_str()) == Some("update") {
        return;
    }
    m.exit_intent = Some(MarkerIntent {
        reason: "session_end".into(),
        via: None,
        detail: Some(kind.as_str().into()),
        target_version: None,
        at_ms: now,
    });
}

/// Pura. Borra la intención SOLO si es `session_end`.
fn clear_session_intent(m: &mut LifecycleMarker) {
    if m.exit_intent.as_ref().map(|i| i.reason.as_str()) == Some("session_end") {
        m.exit_intent = None;
    }
}

/// Lo llama el WndProc de `session_end` en `WM_QUERYENDSESSION`: deja la
/// intención durable por si Windows mata el proceso antes del bloque `exit`.
/// Síncrona y sin await (segura dentro de un WndProc).
pub fn note_session_ending(kind: crate::session_end::SessionEndKind) {
    let now = now_ms();
    if let Err(e) = mutate_marker(true, |m| apply_session_intent(m, kind, now)) {
        warn_once(WarnKind::Accessor, &e);
    }
}

/// `WM_ENDSESSION(FALSE)`: otra app canceló el fin de sesión. Durable; borra
/// la intención solo si es `session_end`.
pub fn clear_session_ending() {
    if let Err(e) = mutate_marker(true, clear_session_intent) {
        warn_once(WarnKind::Accessor, &e);
    }
}

// ── Updates de la Store (L3, contrato §5.7) ────────────────────────────────

/// Pura. Intención `update` (reemplaza una `session_end`: si el update llega
/// por Restart Manager, `summarize_prev` lo convierte en `update`).
fn apply_update_intent(m: &mut LifecycleMarker, via: &str, target_version: Option<&str>, now: u64) {
    m.exit_intent = Some(MarkerIntent {
        reason: "update".into(),
        via: Some(via.into()),
        detail: None,
        target_version: target_version.map(Into::into),
        at_ms: now,
    });
}

/// Pura. Borra la intención SOLO si es `update`.
fn clear_update_intent_in(m: &mut LifecycleMarker) {
    if m.exit_intent.as_ref().map(|i| i.reason.as_str()) == Some("update") {
        m.exit_intent = None;
    }
}

/// Deja durable la intención `update` justo antes de que un instalador pueda
/// matar el proceso sin `RunEvent::Exit` (StoreContext: `store_install_updates`).
/// Síncrona (corre en el hilo MTA de `with_mta`); no caduca por edad.
pub fn record_update_intent(via: &str, target_version: Option<&str>) {
    let now = now_ms();
    if let Err(e) = mutate_marker(true, |m| apply_update_intent(m, via, target_version, now)) {
        warn_once(WarnKind::Accessor, &e);
    }
}

/// El update no se aplicó (cancelado, error, sin updates): borra la intención
/// `update` (durable) para que el siguiente `app.start` no la reporte.
pub fn clear_update_intent() {
    if let Err(e) = mutate_marker(true, clear_update_intent_in) {
        warn_once(WarnKind::Accessor, &e);
    }
}

/// Pura. `exit_for_update` se niega en cualquier fase distinta de `Idle`: más
/// estricto que `is_recording()`, incluye `Starting` y `Stopping` (post-proceso).
pub(crate) fn update_exit_refusal(
    phase: crate::audio::recording_phase::RecordingPhase,
) -> Option<&'static str> {
    match phase {
        crate::audio::recording_phase::RecordingPhase::Idle => None,
        _ => Some("recording_active"),
    }
}

/// "Cerrar Maity para actualizar" (canal Store): la Store no reemplaza un MSIX
/// en ejecución, así que Maity sale y el paquete se aplica al cerrar. Registra
/// `app.exit` `update`/`store_button` (marcador durable + fila ≤750 ms + flush
/// dirigido de 3 s) y sale con `app.exit(0)`: `RunEvent::Exit` sigue corriendo
/// su backstop (graceful, DB, sidecar) y su `begin_exit(None)` es no-op.
/// `Err("recording_active")` con grabación o post-proceso en curso.
#[tauri::command]
pub async fn exit_for_update(app: tauri::AppHandle) -> Result<(), String> {
    let phase = crate::audio::recording_phase::current_phase();
    if let Some(refusal) = update_exit_refusal(phase) {
        log::warn!("[lifecycle] exit_for_update rechazado: fase {}", phase.as_str());
        return Err(refusal.into());
    }
    if let Some(rec) = begin_exit(Some(ExitHint::Update { via: "store_button" })) {
        if let Some(id) = emit_exit_row(&app, &rec, EXIT_ROW_TIMEOUT).await {
            let _ = super::drain::flush_row(&app, id, Duration::from_secs(3)).await;
        }
    }
    app.exit(0);
    Ok(())
}

/// Resultado puro de `classify_exit`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ExitClass {
    pub reason: &'static str,
    pub detail: Option<String>,
    pub exit_code: Option<i32>,
    pub session_end_kind: Option<&'static str>,
    pub critical: bool,
}

/// Pura. Precedencia (contrato §1.7): (1) motivo propio; (2) `restart`;
/// (3) `app_exit` con su código; (4) `last_window_closed`; y sin
/// `ExitRequested`: (5) `external_close`, (6) `os_session_end` con el tipo
/// observado, (7) `os_session_end`/`unknown` por la métrica del SO,
/// (8) `loop_destroyed`.
pub(crate) fn classify_exit(
    hint: Option<&ExitHint>,
    requested: &ExitRequestSeen,
    session_end: Option<&SessionEndHint>,
    os_shutting_down: bool,
) -> ExitClass {
    let exit_code = match requested {
        ExitRequestSeen::Programmatic(c) => Some(*c),
        _ => None,
    };
    let plain = |reason: &'static str| ExitClass {
        reason,
        detail: None,
        exit_code,
        session_end_kind: None,
        critical: false,
    };

    if let Some(hint) = hint {
        return match hint {
            ExitHint::TrayQuit => plain("tray_quit"),
            ExitHint::RivalInstall => plain("rival_install"),
            ExitHint::Update { via } => ExitClass {
                detail: Some((*via).to_string()),
                ..plain("update")
            },
        };
    }
    match requested {
        ExitRequestSeen::Programmatic(c) if *c == tauri::RESTART_EXIT_CODE => plain("restart"),
        ExitRequestSeen::Programmatic(_) => plain("app_exit"),
        ExitRequestSeen::UserInteraction => plain("last_window_closed"),
        ExitRequestSeen::NotSeen => match session_end {
            Some(se) if se.external_close => ExitClass {
                session_end_kind: Some("close_app"),
                critical: se.critical,
                ..plain("external_close")
            },
            Some(se) => ExitClass {
                detail: Some(se.detail.to_string()),
                session_end_kind: Some(se.detail),
                critical: se.critical,
                ..plain("os_session_end")
            },
            None if os_shutting_down => ExitClass {
                detail: Some("unknown".to_string()),
                session_end_kind: Some("unknown"),
                ..plain("os_session_end")
            },
            None => plain("loop_destroyed"),
        },
    }
}

/// Salida registrada: lo que se escribió en el marcador + lo que lleva la fila.
#[derive(Debug, Clone, PartialEq)]
pub struct ExitRecord {
    pub reason: String,
    pub detail: Option<String>,
    pub exit_code: Option<i32>,
    pub begun_at_ms: u64,
    pub uptime_s: u64,
    pub recording_active: bool,
    pub recording_phase: &'static str,
    pub session_end_kind: Option<String>,
    pub critical: bool,
}

/// Inicio de la vida del proceso: el del marcador vivo o, si no hubo
/// directorio, el que capturó `rotate_at_boot`.
fn process_started_ms() -> Option<u64> {
    let from_slot = {
        let guard = MARKER.lock().unwrap_or_else(|e| e.into_inner());
        guard.as_ref().map(|s| s.marker.started_at_ms)
    };
    from_slot
        .filter(|&t| t > 0)
        .or_else(|| BOOT_PREV.get().map(|b| b.now_ms))
}

/// PRIMERO en toda salida. Emit-once: el segundo llamador recibe `None` (p. ej.
/// el `RunEvent::Exit` que sigue a la salida de la bandeja). Escribe el bloque
/// `exit` del marcador (durable) ANTES que nada — es la fuente de verdad — y
/// luego apaga la drenadora (`drain::set_exiting`). Síncrona.
pub fn begin_exit(hint: Option<ExitHint>) -> Option<ExitRecord> {
    if !claim_once(&EXIT_BEGUN) {
        return None;
    }
    let requested = *EXIT_REQUESTED.lock().unwrap_or_else(|e| e.into_inner());
    let shutting_down = requested == ExitRequestSeen::NotSeen && os_shutting_down();
    // Tipo exacto de fin de sesión (subclass del HWND, E1). Solo cuenta sin
    // `ExitRequested`: una salida pedida por la app gana.
    let session_end: Option<SessionEndHint> = if requested == ExitRequestSeen::NotSeen {
        crate::session_end::observed().map(|s| session_end_hint(s.kind, s.critical))
    } else {
        None
    };
    let class = classify_exit(hint.as_ref(), &requested, session_end.as_ref(), shutting_down);

    let phase = crate::audio::recording_phase::current_phase();
    let now = now_ms();
    let uptime_s = process_started_ms()
        .map(|s| now.saturating_sub(s) / 1000)
        .unwrap_or(0);
    let record = ExitRecord {
        reason: class.reason.to_string(),
        detail: class.detail,
        exit_code: class.exit_code,
        begun_at_ms: now,
        uptime_s,
        recording_active: phase.is_session_active(),
        recording_phase: phase.as_str(),
        session_end_kind: class.session_end_kind.map(str::to_string),
        critical: class.critical,
    };

    let block = MarkerExit {
        reason: record.reason.clone(),
        detail: record.detail.clone(),
        exit_code: record.exit_code,
        begun_at_ms: now,
        done_at_ms: None,
        recording_active: record.recording_active,
        session_end_kind: record.session_end_kind.clone(),
        critical: record.critical,
    };
    let written = mutate_marker(true, |m| {
        m.exit = Some(block);
        m.last_alive_ms = m.last_alive_ms.max(now);
    });
    if let Err(e) = written {
        warn_once(WarnKind::Exit, &e);
    }
    super::drain::set_exiting();
    log::info!(
        "[lifecycle] salida: reason={} detail={:?} code={:?} phase={}",
        record.reason,
        record.detail,
        record.exit_code,
        record.recording_phase
    );
    Some(record)
}

/// Payload de `app.exit` (contrato §1.6).
pub(crate) fn exit_payload(rec: &ExitRecord) -> serde_json::Value {
    serde_json::json!({
        "lifecycle_schema": MARKER_SCHEMA,
        "reason": rec.reason,
        "detail": rec.detail,
        "exit_code": rec.exit_code,
        "uptime_s": rec.uptime_s,
        "recording_active": rec.recording_active,
        "recording_phase": rec.recording_phase,
        "session_end_kind": rec.session_end_kind,
        "critical": rec.critical,
        "build": build_name(),
    })
}

/// Deja la fila `app.exit` en el outbox, acotado a `timeout` (`EXIT_ROW_TIMEOUT`
/// en salidas normales, `EXIT_ROW_TIMEOUT_SESSION_END` en fin de sesión).
/// Devuelve el rowid para un `drain::flush_row` dirigido; `None` si se descartó
/// o si expiró el tope (el marcador ya tiene el motivo).
pub async fn emit_exit_row<R: Runtime>(
    app: &AppHandle<R>,
    rec: &ExitRecord,
    timeout: Duration,
) -> Option<i64> {
    tokio::time::timeout(
        timeout,
        emit::emit_event_with_id(
            app,
            context::process_session_id(),
            catalog::APP_EXIT,
            exit_payload(rec),
            Some(TelemetryStatus::Ok),
            None,
            None,
        ),
    )
    .await
    .ok()
    .flatten()
}

/// Sella `done_at_ms` del bloque `exit` (durable) al final de la limpieza.
/// Funciona aunque el `begin_exit` de este llamador haya devuelto `None`.
pub fn finish_exit() {
    let now = now_ms();
    let written = mutate_marker(true, |m| {
        if let Some(e) = m.exit.as_mut() {
            if e.done_at_ms.is_none() {
                e.done_at_ms = Some(now);
            }
        }
    });
    if let Err(e) = written {
        warn_once(WarnKind::Exit, &e);
    }
}

/// Centinela en la tabla de recursos de la app: `cleanup_before_exit()` la
/// vacía, así que su `Drop` corre también en las salidas que NO pasan por
/// `RunEvent::Exit` (el `on_before_exit` del updater NSIS antes de su
/// `process::exit`, `restart()` desde el hilo principal, el respaldo de
/// `AppHandle::exit`). Si nadie registró la salida, escribe
/// `process_exit_after_cleanup`. En la salida normal tauri llama al callback
/// de `Exit` ANTES de `cleanup_before_exit`, así que aquí ya es no-op.
struct ExitSentinel;

impl tauri::Resource for ExitSentinel {}

impl Drop for ExitSentinel {
    fn drop(&mut self) {
        if !claim_once(&EXIT_BEGUN) {
            return;
        }
        let now = now_ms();
        let phase = crate::audio::recording_phase::current_phase();
        let written = mutate_marker(true, |m| {
            m.exit = Some(MarkerExit {
                reason: "process_exit_after_cleanup".to_string(),
                detail: None,
                exit_code: None,
                begun_at_ms: now,
                done_at_ms: Some(now),
                recording_active: phase.is_session_active(),
                session_end_kind: None,
                critical: false,
            });
            m.last_alive_ms = m.last_alive_ms.max(now);
        });
        if let Err(e) = written {
            warn_once(WarnKind::Exit, &e);
        }
    }
}

/// En `setup()`, justo después de `rotate_at_boot`.
pub fn install_exit_sentinel<R: Runtime>(app: &AppHandle<R>) {
    let _ = app.resources_table().add(ExitSentinel);
}

#[cfg(test)]
mod tests {
    use super::*;

    const CURRENT: &str = "0.2.62";
    const T0: u64 = 1_780_000_000_000; // ~2026, ms

    fn marker() -> LifecycleMarker {
        LifecycleMarker {
            schema: MARKER_SCHEMA,
            proc_session_id: "proc-1-abcd".into(),
            version: "0.2.62".into(),
            build: "release".into(),
            build_channel: "direct".into(),
            started_at_ms: T0,
            last_alive_ms: T0 + 3_600_000, // 1 h de vida
            os_boot_ms: Some(T0 - 600_000),
            ..LifecycleMarker::default()
        }
    }

    fn exit(reason: &str, detail: Option<&str>, done: bool) -> MarkerExit {
        MarkerExit {
            reason: reason.into(),
            detail: detail.map(Into::into),
            begun_at_ms: T0 + 3_630_000,
            done_at_ms: done.then_some(T0 + 3_632_000),
            recording_active: true,
            ..MarkerExit::default()
        }
    }

    fn intent(reason: &str, via: Option<&str>, detail: Option<&str>, at_ms: u64) -> MarkerIntent {
        MarkerIntent {
            reason: reason.into(),
            via: via.map(Into::into),
            detail: detail.map(Into::into),
            target_version: None,
            at_ms,
        }
    }

    fn summarize(
        read: &MarkerRead,
        now_ms: u64,
        panics: &[PanicTs],
        os_boot_ms: Option<u64>,
        fallback: Option<&str>,
    ) -> PrevSummary {
        summarize_prev(&PrevInput {
            read,
            now_ms,
            current_version: CURRENT,
            panics,
            os_boot_ms,
            fallback_prev_version: fallback.map(Into::into),
        })
    }

    fn extras() -> StartExtras<'static> {
        StartExtras {
            build: "release",
            build_channel: "direct",
            started_at_boot: false,
            autostart_state: Some("enabled".into()),
            started_at_ms: T0 + 10_000_000,
            os_boot_ms: Some(T0 - 600_000),
        }
    }

    // ── parse_marker ──

    #[test]
    fn parse_marker_none_es_missing() {
        assert_eq!(parse_marker(None, "direct"), MarkerRead::Missing);
    }

    #[test]
    fn parse_marker_basura_es_corrupt() {
        assert_eq!(parse_marker(Some("{no es json"), "direct"), MarkerRead::Corrupt);
        assert_eq!(parse_marker(Some(""), "direct"), MarkerRead::Corrupt);
    }

    #[test]
    fn parse_marker_v1_roundtrip() {
        let mut m = marker();
        m.exit = Some(exit("tray_quit", None, true));
        m.exit_intent = Some(intent("update", Some("store_api"), None, T0));
        m.last_resume = Some(MarkerResume { suspended_at_ms: 1, resumed_at_ms: 2, gap_s: 3 });
        m.last_autostart_state = Some("enabled".into());
        m.last_login_user = Some(LastLoginUser { maity_user_id: "u-1".into(), since_ms: 9 });
        let raw = serde_json::to_string(&m).unwrap();
        assert_eq!(parse_marker(Some(&raw), "direct"), MarkerRead::Ok(m));
    }

    #[test]
    fn parse_marker_ignora_campos_desconocidos_y_schema_futuro() {
        let raw = r#"{"schema":2,"proc_session_id":"proc-9","version":"0.3.0",
            "build_channel":"direct","started_at_ms":5,"campo_nuevo":{"x":1},
            "exit":{"reason":"motivo_nuevo","otro":true,"begun_at_ms":7}}"#;
        let MarkerRead::Ok(m) = parse_marker(Some(raw), "direct") else {
            panic!("esperaba Ok");
        };
        assert_eq!(m.schema, 2);
        assert_eq!(m.version, "0.3.0");
        assert_eq!(m.started_at_ms, 5);
        let e = m.exit.expect("exit");
        assert_eq!(e.reason, "motivo_nuevo");
        assert_eq!(e.begun_at_ms, 7);
    }

    #[test]
    fn parse_marker_campos_faltantes_toman_default() {
        let MarkerRead::Ok(m) = parse_marker(Some("{}"), "direct") else {
            panic!("esperaba Ok");
        };
        assert_eq!(m, LifecycleMarker::default());
    }

    #[test]
    fn parse_marker_de_otro_canal_es_foreign() {
        let mut m = marker();
        m.build_channel = "store".into();
        let raw = serde_json::to_string(&m).unwrap();
        assert_eq!(parse_marker(Some(&raw), "direct"), MarkerRead::Foreign(m));
    }

    #[test]
    fn marker_file_name_por_build() {
        assert_eq!(marker_file_name(true), "lifecycle-debug.json");
        assert_eq!(marker_file_name(false), "lifecycle.json");
    }

    // ── write_atomic ──

    #[test]
    fn write_atomic_crea_sobrescribe_y_no_deja_tmp() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("lifecycle.json");
        let tmp = path.with_extension("json.tmp");

        write_atomic(&path, b"{\"a\":1}", true).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{\"a\":1}");
        assert!(!tmp.exists());

        write_atomic(&path, b"{\"a\":2}", false).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{\"a\":2}");
        assert!(!tmp.exists());

        write_atomic(&path, b"{}", true).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{}");
        assert!(!tmp.exists());
    }

    // ── summarize_prev (tabla) ──

    #[test]
    fn caso_01_missing_sin_respaldo_es_primer_arranque() {
        let s = summarize(&MarkerRead::Missing, T0, &[], None, None);
        assert_eq!(s.marker_status, "missing");
        assert!(s.first_run);
        assert_eq!(s.prev_version, None);
        assert_eq!(s.prev_version_source, None);
        assert_eq!(s.version_changed, None);
        assert_eq!(s.prev_exit_reason, None);
        assert_eq!(s.prev_exit_source, None);
        assert_eq!(s.prev_exit_clean, None);
        assert_eq!(s.prev_session_id, None);
        assert_eq!(s.downtime_s, None);
        assert_eq!(s.prev_panicked, None);
        assert_eq!(s.os_rebooted_since_prev, None);
    }

    #[test]
    fn caso_02_missing_con_respaldo_del_outbox() {
        let s = summarize(&MarkerRead::Missing, T0, &[], None, Some("0.2.61"));
        assert!(!s.first_run);
        assert_eq!(s.prev_version.as_deref(), Some("0.2.61"));
        assert_eq!(s.prev_version_source, Some("outbox"));
        assert_eq!(s.version_changed, Some(true));
        assert_eq!(s.prev_exit_clean, None);
        assert_eq!(s.prev_exit_reason, None);
    }

    #[test]
    fn caso_03_exit_observado_tray_quit() {
        let mut m = marker();
        m.exit = Some(exit("tray_quit", None, true));
        let now = T0 + 3_632_000 + 50_000;
        let s = summarize(&MarkerRead::Ok(m), now, &[], Some(T0 - 600_000), None);
        assert_eq!(s.marker_status, "ok");
        assert!(!s.first_run);
        assert_eq!(s.prev_exit_reason.as_deref(), Some("tray_quit"));
        assert_eq!(s.prev_exit_source, Some("observed"));
        assert_eq!(s.prev_exit_clean, Some(true));
        assert_eq!(s.prev_exit_interrupted, Some(false));
        assert_eq!(s.prev_recording_active_at_exit, Some(true));
        assert_eq!(s.prev_uptime_s, Some(3_630)); // hasta begun_at
        assert_eq!(s.downtime_s, Some(50)); // desde done_at
        assert!(!s.clock_skew);
        assert_eq!(s.prev_version.as_deref(), Some("0.2.62"));
        assert_eq!(s.prev_version_source, Some("marker"));
        assert_eq!(s.version_changed, Some(false));
        assert_eq!(s.prev_session_id.as_deref(), Some("proc-1-abcd"));
        assert_eq!(s.os_rebooted_since_prev, Some(false));
        assert_eq!(s.prev_panicked, Some(false));
        assert_eq!(s.prev_panic_count, Some(0));
    }

    #[test]
    fn caso_04_exit_sin_done_es_interrumpido() {
        let mut m = marker();
        m.exit = Some(exit("tray_quit", None, false));
        let now = T0 + 3_630_000 + 10_000;
        let s = summarize(&MarkerRead::Ok(m), now, &[], None, None);
        assert_eq!(s.prev_exit_interrupted, Some(true));
        assert_eq!(s.prev_exit_source, Some("observed"));
        assert_eq!(s.downtime_s, Some(10)); // desde begun_at
    }

    #[test]
    fn caso_05_intencion_update_no_caduca() {
        let mut m = marker();
        // Intención muy anterior al último latido: igual cuenta.
        m.exit_intent = Some(intent("update", Some("store_api"), None, T0 - 86_400_000));
        let s = summarize(&MarkerRead::Ok(m), T0 + 4_000_000, &[], None, None);
        assert_eq!(s.prev_exit_reason.as_deref(), Some("update"));
        assert_eq!(s.prev_exit_detail.as_deref(), Some("store_api"));
        assert_eq!(s.prev_exit_source, Some("intent"));
        assert_eq!(s.prev_exit_clean, Some(true));
        assert_eq!(s.prev_exit_interrupted, None);
    }

    #[test]
    fn caso_06_intencion_de_fin_de_sesion() {
        let mut m = marker();
        m.exit_intent = Some(intent("session_end", None, Some("logoff"), T0 + 3_000_000));
        let s = summarize(&MarkerRead::Ok(m), T0 + 4_000_000, &[], None, None);
        assert_eq!(s.prev_exit_reason.as_deref(), Some("os_session_end"));
        assert_eq!(s.prev_exit_detail.as_deref(), Some("logoff"));
        assert_eq!(s.prev_exit_source, Some("intent"));
        assert_eq!(s.prev_exit_clean, Some(true));
    }

    #[test]
    fn caso_07_fin_de_sesion_observado_mas_intencion_update_es_update() {
        let mut m = marker();
        m.exit = Some(exit("os_session_end", Some("shutdown"), true));
        m.exit_intent = Some(intent("update", Some("nsis"), None, T0 + 3_000_000));
        let s = summarize(&MarkerRead::Ok(m.clone()), T0 + 4_000_000, &[], None, None);
        assert_eq!(s.prev_exit_reason.as_deref(), Some("update"));
        assert_eq!(s.prev_exit_detail.as_deref(), Some("shutdown"));
        assert_eq!(s.prev_exit_source, Some("observed"));
        assert_eq!(s.prev_exit_clean, Some(true));

        // external_close y el centinela también ceden ante la intención.
        for reason in ["external_close", "process_exit_after_cleanup"] {
            m.exit = Some(exit(reason, None, true));
            let s = summarize(&MarkerRead::Ok(m.clone()), T0 + 4_000_000, &[], None, None);
            assert_eq!(s.prev_exit_reason.as_deref(), Some("update"), "{}", reason);
            assert_eq!(s.prev_exit_detail.as_deref(), Some("nsis"), "{}", reason);
            assert_eq!(s.prev_exit_source, Some("observed"));
        }

        // Un motivo propio (tray_quit) NO cede.
        m.exit = Some(exit("tray_quit", None, true));
        let s = summarize(&MarkerRead::Ok(m), T0 + 4_000_000, &[], None, None);
        assert_eq!(s.prev_exit_reason.as_deref(), Some("tray_quit"));
    }

    #[test]
    fn caso_08_panic_del_hilo_main_es_crash_panic() {
        let panics = [PanicTs { ts_ms: T0 + 1_000_000, thread: Some("main".into()) }];
        let s = summarize(&MarkerRead::Ok(marker()), T0 + 4_000_000, &panics, None, None);
        assert_eq!(s.prev_exit_reason.as_deref(), Some("crash_panic"));
        assert_eq!(s.prev_exit_source, Some("inferred"));
        assert_eq!(s.prev_exit_clean, Some(false));
        assert_eq!(s.prev_panicked, Some(true));
        assert_eq!(s.prev_panic_count, Some(1));
    }

    #[test]
    fn caso_09_panic_de_otro_hilo_es_unclean_con_panic() {
        let panics = [
            PanicTs { ts_ms: T0 + 1_000_000, thread: Some("tokio-runtime-worker".into()) },
            PanicTs { ts_ms: T0 + 1_100_000, thread: None },
        ];
        let s = summarize(&MarkerRead::Ok(marker()), T0 + 4_000_000, &panics, None, None);
        assert_eq!(s.prev_exit_reason.as_deref(), Some("unclean"));
        assert_eq!(s.prev_exit_clean, Some(false));
        assert_eq!(s.prev_panicked, Some(true));
        assert_eq!(s.prev_panic_count, Some(2));
    }

    #[test]
    fn caso_10_panic_fuera_de_la_ventana_no_cuenta() {
        let panics = [
            PanicTs { ts_ms: T0 - 1, thread: Some("main".into()) },
            PanicTs { ts_ms: T0 + 3_600_000 + PANIC_GRACE_MS + 1, thread: Some("main".into()) },
        ];
        let s = summarize(&MarkerRead::Ok(marker()), T0 + 9_000_000, &panics, None, None);
        assert_eq!(s.prev_exit_reason.as_deref(), Some("unclean"));
        assert_eq!(s.prev_panicked, Some(false));
        assert_eq!(s.prev_panic_count, Some(0));

        // El borde superior (último latido + 120 s) sí cuenta.
        let edge = [PanicTs { ts_ms: T0 + 3_600_000 + PANIC_GRACE_MS, thread: Some("main".into()) }];
        let s = summarize(&MarkerRead::Ok(marker()), T0 + 9_000_000, &edge, None, None);
        assert_eq!(s.prev_exit_reason.as_deref(), Some("crash_panic"));
    }

    #[test]
    fn caso_10b_salida_observada_tardia_no_agranda_la_ventana_de_panicos() {
        // Salida observada que terminó 400 s después del último latido: la
        // ventana sigue anclada en last_alive_ms + 120 s, no en done_at_ms.
        let mut m = marker(); // last_alive = T0 + 3_600_000
        m.exit = Some(MarkerExit {
            done_at_ms: Some(T0 + 3_600_000 + 400_000),
            ..exit("tray_quit", None, true)
        });
        let tarde = [PanicTs {
            ts_ms: T0 + 3_600_000 + PANIC_GRACE_MS + 1,
            thread: Some("tokio-runtime-worker".into()),
        }];
        let s = summarize(&MarkerRead::Ok(m.clone()), T0 + 9_000_000, &tarde, None, None);
        assert_eq!(s.prev_exit_reason.as_deref(), Some("tray_quit"));
        assert_eq!(s.prev_panicked, Some(false));
        assert_eq!(s.prev_panic_count, Some(0));

        // En el borde (último latido + 120 s) sí cuenta, con la salida observada.
        let borde = [PanicTs {
            ts_ms: T0 + 3_600_000 + PANIC_GRACE_MS,
            thread: Some("tokio-runtime-worker".into()),
        }];
        let s = summarize(&MarkerRead::Ok(m), T0 + 9_000_000, &borde, None, None);
        assert_eq!(s.prev_exit_reason.as_deref(), Some("tray_quit"));
        assert_eq!(s.prev_panicked, Some(true));
        assert_eq!(s.prev_panic_count, Some(1));
    }

    #[test]
    fn caso_11_boot_del_so_distinto_es_os_restart_unclean() {
        let m = marker(); // os_boot = T0 - 600 s
        let s = summarize(&MarkerRead::Ok(m.clone()), T0 + 9_000_000, &[], Some(T0 + 8_000_000), None);
        assert_eq!(s.prev_exit_reason.as_deref(), Some("os_restart_unclean"));
        assert_eq!(s.prev_exit_source, Some("inferred"));
        assert_eq!(s.prev_exit_clean, Some(false));
        assert_eq!(s.os_rebooted_since_prev, Some(true));

        // Oscilación de pocos segundos del boot_time: no es reinicio.
        let s = summarize(&MarkerRead::Ok(m), T0 + 9_000_000, &[], Some(T0 - 600_000 + 5_000), None);
        assert_eq!(s.os_rebooted_since_prev, Some(false));
        assert_eq!(s.prev_exit_reason.as_deref(), Some("unclean"));
    }

    #[test]
    fn caso_12_sin_nada_es_unclean() {
        let s = summarize(&MarkerRead::Ok(marker()), T0 + 3_700_000, &[], None, None);
        assert_eq!(s.prev_exit_reason.as_deref(), Some("unclean"));
        assert_eq!(s.prev_exit_detail, None);
        assert_eq!(s.prev_exit_source, Some("inferred"));
        assert_eq!(s.prev_exit_clean, Some(false));
        assert_eq!(s.prev_exit_interrupted, None);
        assert_eq!(s.prev_recording_active_at_exit, None);
        assert_eq!(s.os_rebooted_since_prev, None);
        assert_eq!(s.prev_uptime_s, Some(3_600));
        assert_eq!(s.downtime_s, Some(100));
    }

    #[test]
    fn caso_13_reloj_hacia_atras_da_downtime_cero_y_skew() {
        let s = summarize(&MarkerRead::Ok(marker()), T0 + 1_000, &[], None, None);
        assert_eq!(s.downtime_s, Some(0));
        assert!(s.clock_skew);
    }

    #[test]
    fn caso_14_foreign_ignora_el_marcador() {
        let mut m = marker();
        m.build_channel = "store".into();
        m.exit = Some(exit("tray_quit", None, true));
        let s = summarize(&MarkerRead::Foreign(m), T0 + 4_000_000, &[], None, None);
        assert_eq!(s.marker_status, "foreign");
        assert!(!s.first_run);
        assert_eq!(s.prev_exit_reason, None);
        assert_eq!(s.prev_exit_clean, None);
        assert_eq!(s.prev_session_id, None);
        assert_eq!(s.prev_version, None);
        assert_eq!(s.downtime_s, None);
    }

    #[test]
    fn corrupt_no_es_primer_arranque_y_deja_prev_en_null() {
        let s = summarize(&MarkerRead::Corrupt, T0, &[], None, None);
        assert_eq!(s.marker_status, "corrupt");
        assert!(!s.first_run);
        assert_eq!(s.prev_exit_clean, None);
    }

    // ── payload ──

    #[test]
    fn el_payload_lleva_todos_los_campos_del_contrato() {
        let mut m = marker();
        m.exit = Some(exit("tray_quit", None, true));
        let s = summarize(&MarkerRead::Ok(m), T0 + 4_000_000, &[], Some(T0 - 600_000), None);
        let p = s.to_payload(&extras());
        let obj = p.as_object().unwrap();
        for key in [
            "lifecycle_schema", "build", "build_channel", "started_at_boot", "autostart_state",
            "started_at", "os_boot_at", "first_run", "marker_status", "prev_session_id",
            "prev_version", "prev_version_source", "version_changed", "prev_started_at",
            "prev_last_alive_at", "prev_uptime_s", "prev_exit_reason", "prev_exit_detail",
            "prev_exit_source", "prev_exit_clean", "prev_exit_interrupted",
            "prev_recording_active_at_exit", "prev_panicked", "prev_panic_count",
            "os_rebooted_since_prev", "downtime_s", "clock_skew",
        ] {
            assert!(obj.contains_key(key), "falta {}", key);
        }
        assert_eq!(obj.len(), 27);
        assert_eq!(p["lifecycle_schema"], 1);
        assert_eq!(p["build"], "release");
        assert_eq!(p["prev_exit_reason"], "tray_quit");
        assert!(p["started_at"].as_str().unwrap().starts_with("2026-"));
        assert!(p["prev_started_at"].as_str().is_some());
    }

    #[test]
    fn el_payload_sin_version_previa_va_en_null_nunca_con_centinela() {
        for read in [MarkerRead::Missing, MarkerRead::Corrupt, MarkerRead::Ok(LifecycleMarker::default())] {
            let s = summarize(&read, T0, &[], None, None);
            let p = s.to_payload(&extras());
            assert!(p["prev_version"].is_null(), "{:?}", read);
            assert!(p["prev_version_source"].is_null());
            assert!(p["version_changed"].is_null());
            assert!(!p.to_string().contains("unknown"));
            assert_eq!(p["lifecycle_schema"], 1);
            assert_eq!(p["build"], "release");
        }
    }

    #[test]
    fn resume_gap_solo_con_salto_mayor_a_180_s() {
        assert_eq!(resume_gap_ms(T0, T0 + 60_000), None);
        assert_eq!(resume_gap_ms(T0, T0 + RESUME_GAP_MS), None);
        assert_eq!(resume_gap_ms(T0, T0 + RESUME_GAP_MS + 1), Some(RESUME_GAP_MS + 1));
        assert_eq!(resume_gap_ms(T0, T0 - 5_000), None); // reloj hacia atrás
    }

    // ── classify_exit (L2) ──

    /// Motivos observados del contrato §1.7 (`app.exit.reason`).
    const CONTRACT_EXIT_REASONS: &[&str] = &[
        "tray_quit",
        "rival_install",
        "update",
        "restart",
        "app_exit",
        "last_window_closed",
        "os_session_end",
        "external_close",
        "loop_destroyed",
        "process_exit_after_cleanup",
    ];

    fn se(detail: &'static str, critical: bool, external_close: bool) -> SessionEndHint {
        SessionEndHint { detail, critical, external_close }
    }

    #[test]
    fn classify_exit_tabla() {
        use ExitRequestSeen::*;
        let logoff = se("logoff", true, false);
        let close_app = se("unknown", false, true);
        let tray = ExitHint::TrayQuit;
        let store = ExitHint::Update { via: "store_button" };

        // (hint, requested, session_end, os_shutting_down) ⇒ (reason, detail, exit_code, kind, critical)
        let casos: Vec<(
            Option<&ExitHint>,
            ExitRequestSeen,
            Option<&SessionEndHint>,
            bool,
            (&str, Option<&str>, Option<i32>, Option<&str>, bool),
        )> = vec![
            (Some(&tray), Programmatic(0), None, false, ("tray_quit", None, Some(0), None, false)),
            (Some(&tray), NotSeen, Some(&logoff), true, ("tray_quit", None, None, None, false)),
            (Some(&ExitHint::RivalInstall), NotSeen, None, false, ("rival_install", None, None, None, false)),
            (Some(&store), NotSeen, None, false, ("update", Some("store_button"), None, None, false)),
            (None, Programmatic(i32::MAX), None, false, ("restart", None, Some(i32::MAX), None, false)),
            (None, Programmatic(0), None, true, ("app_exit", None, Some(0), None, false)),
            (None, Programmatic(3), None, false, ("app_exit", None, Some(3), None, false)),
            (None, UserInteraction, None, true, ("last_window_closed", None, None, None, false)),
            (None, NotSeen, Some(&logoff), false, ("os_session_end", Some("logoff"), None, Some("logoff"), true)),
            (None, NotSeen, Some(&close_app), true, ("external_close", None, None, Some("close_app"), false)),
            (None, NotSeen, None, true, ("os_session_end", Some("unknown"), None, Some("unknown"), false)),
            (None, NotSeen, None, false, ("loop_destroyed", None, None, None, false)),
        ];
        for (hint, requested, session_end, sd, (reason, detail, code, kind, critical)) in casos {
            let c = classify_exit(hint, &requested, session_end, sd);
            let ctx = format!("{:?} {:?} {:?} {}", hint, requested, session_end, sd);
            assert_eq!(c.reason, reason, "{}", ctx);
            assert_eq!(c.detail.as_deref(), detail, "{}", ctx);
            assert_eq!(c.exit_code, code, "{}", ctx);
            assert_eq!(c.session_end_kind, kind, "{}", ctx);
            assert_eq!(c.critical, critical, "{}", ctx);
        }
    }

    #[test]
    fn classify_exit_con_el_mapeo_de_session_end() {
        use crate::session_end::SessionEndKind;
        use ExitRequestSeen::*;
        // (kind, critical) observado ⇒ (reason, detail, session_end_kind, critical)
        let casos: &[(SessionEndKind, bool, (&str, Option<&str>, Option<&str>, bool))] = &[
            (SessionEndKind::Logoff, true, ("os_session_end", Some("logoff"), Some("logoff"), true)),
            (SessionEndKind::Logoff, false, ("os_session_end", Some("logoff"), Some("logoff"), false)),
            (SessionEndKind::Shutdown, false, ("os_session_end", Some("shutdown"), Some("shutdown"), false)),
            (SessionEndKind::Unknown, false, ("os_session_end", Some("unknown"), Some("unknown"), false)),
            (SessionEndKind::CloseApp, false, ("external_close", None, Some("close_app"), false)),
            (SessionEndKind::CloseApp, true, ("external_close", None, Some("close_app"), true)),
        ];
        for &(kind, crit, (reason, detail, se_kind, critical)) in casos {
            let hint = session_end_hint(kind, crit);
            let c = classify_exit(None, &NotSeen, Some(&hint), false);
            let ctx = format!("{:?} {}", kind, crit);
            assert_eq!(c.reason, reason, "{}", ctx);
            assert_eq!(c.detail.as_deref(), detail, "{}", ctx);
            assert_eq!(c.session_end_kind, se_kind, "{}", ctx);
            assert_eq!(c.critical, critical, "{}", ctx);
            assert!(CONTRACT_EXIT_REASONS.contains(&c.reason), "{}", ctx);
        }
        // Un ExitRequested gana sobre el fin de sesión observado.
        let hint = session_end_hint(SessionEndKind::Logoff, true);
        assert_eq!(classify_exit(None, &Programmatic(0), Some(&hint), true).reason, "app_exit");
    }

    #[test]
    fn apply_session_intent_escribe_y_no_pisa_update() {
        use crate::session_end::SessionEndKind;
        let mut m = marker();
        apply_session_intent(&mut m, SessionEndKind::Logoff, T0 + 5);
        let i = m.exit_intent.clone().expect("intención");
        assert_eq!(i.reason, "session_end");
        assert_eq!(i.detail.as_deref(), Some("logoff"));
        assert_eq!(i.via, None);
        assert_eq!(i.at_ms, T0 + 5);

        // Un QES posterior actualiza el tipo.
        apply_session_intent(&mut m, SessionEndKind::Shutdown, T0 + 6);
        assert_eq!(m.exit_intent.as_ref().and_then(|i| i.detail.as_deref()), Some("shutdown"));

        // Una intención update NO se pisa.
        let upd = intent("update", Some("store_api"), None, T0);
        m.exit_intent = Some(upd.clone());
        apply_session_intent(&mut m, SessionEndKind::Logoff, T0 + 7);
        assert_eq!(m.exit_intent, Some(upd));
    }

    #[test]
    fn clear_session_intent_solo_borra_session_end() {
        let mut m = marker();
        m.exit_intent = Some(intent("session_end", None, Some("logoff"), T0));
        clear_session_intent(&mut m);
        assert_eq!(m.exit_intent, None);

        let upd = intent("update", Some("nsis"), None, T0);
        m.exit_intent = Some(upd.clone());
        clear_session_intent(&mut m);
        assert_eq!(m.exit_intent, Some(upd));

        clear_session_intent(&mut m); // sin intención: no-op
        m.exit_intent = None;
        clear_session_intent(&mut m);
        assert_eq!(m.exit_intent, None);
    }

    // ── Updates de la Store (L3) ──

    #[test]
    fn apply_update_intent_escribe_y_reemplaza_session_end() {
        let mut m = marker();
        m.exit_intent = Some(intent("session_end", None, Some("logoff"), T0));
        apply_update_intent(&mut m, "store_api", Some("0.2.63"), T0 + 9);
        let i = m.exit_intent.clone().expect("intención");
        assert_eq!(i.reason, "update");
        assert_eq!(i.via.as_deref(), Some("store_api"));
        assert_eq!(i.detail, None);
        assert_eq!(i.target_version.as_deref(), Some("0.2.63"));
        assert_eq!(i.at_ms, T0 + 9);

        // Sin versión objetivo (StoreContext no la expone): null, nunca un centinela.
        apply_update_intent(&mut m, "store_api", None, T0 + 10);
        assert_eq!(m.exit_intent.as_ref().and_then(|i| i.target_version.clone()), None);
    }

    #[test]
    fn clear_update_intent_in_borra_update_pero_no_session_end() {
        let mut m = marker();
        apply_update_intent(&mut m, "store_api", None, T0);
        clear_update_intent_in(&mut m);
        assert_eq!(m.exit_intent, None);

        let ses = intent("session_end", None, Some("shutdown"), T0);
        m.exit_intent = Some(ses.clone());
        clear_update_intent_in(&mut m);
        assert_eq!(m.exit_intent, Some(ses));

        m.exit_intent = None;
        clear_update_intent_in(&mut m); // sin intención: no-op
        assert_eq!(m.exit_intent, None);
    }

    #[test]
    fn intencion_update_store_api_pendiente_se_resume_como_update() {
        let mut m = marker();
        apply_update_intent(&mut m, "store_api", None, T0 + 3_000_000);
        let s = summarize(&MarkerRead::Ok(m.clone()), T0 + 4_000_000, &[], None, None);
        assert_eq!(s.prev_exit_reason.as_deref(), Some("update"));
        assert_eq!(s.prev_exit_detail.as_deref(), Some("store_api"));
        assert_eq!(s.prev_exit_source, Some("intent"));
        assert_eq!(s.prev_exit_clean, Some(true));

        // Restart Manager durante el update: el fin de sesión observado cede.
        m.exit = Some(exit("os_session_end", Some("unknown"), true));
        let s = summarize(&MarkerRead::Ok(m.clone()), T0 + 4_000_000, &[], None, None);
        assert_eq!(s.prev_exit_reason.as_deref(), Some("update"));
        assert_eq!(s.prev_exit_source, Some("observed"));

        // Borrada tras un update no aplicado: vuelve a la inferencia.
        m.exit = None;
        clear_update_intent_in(&mut m);
        let s = summarize(&MarkerRead::Ok(m), T0 + 4_000_000, &[], None, None);
        assert_eq!(s.prev_exit_reason.as_deref(), Some("unclean"));
    }

    #[test]
    fn salida_observada_store_button_se_resume_como_update() {
        let mut m = marker();
        let c = classify_exit(
            Some(&ExitHint::Update { via: "store_button" }),
            &ExitRequestSeen::NotSeen,
            None,
            false,
        );
        m.exit = Some(MarkerExit {
            reason: c.reason.into(),
            detail: c.detail.clone(),
            ..exit("", None, true)
        });
        let s = summarize(&MarkerRead::Ok(m), T0 + 4_000_000, &[], None, None);
        assert_eq!(s.prev_exit_reason.as_deref(), Some("update"));
        assert_eq!(s.prev_exit_detail.as_deref(), Some("store_button"));
        assert_eq!(s.prev_exit_source, Some("observed"));
        assert_eq!(s.prev_exit_clean, Some(true));
    }

    #[test]
    fn exit_for_update_solo_sale_en_idle() {
        use crate::audio::recording_phase::RecordingPhase;
        assert_eq!(update_exit_refusal(RecordingPhase::Idle), None);
        for phase in [
            RecordingPhase::Starting,
            RecordingPhase::Recording,
            RecordingPhase::Paused,
            RecordingPhase::Stopping,
        ] {
            assert_eq!(update_exit_refusal(phase), Some("recording_active"), "{:?}", phase);
        }
    }

    #[test]
    fn intencion_close_app_se_resume_como_external_close() {
        use crate::session_end::SessionEndKind;
        let mut m = marker();
        apply_session_intent(&mut m, SessionEndKind::CloseApp, T0 + 3_000_000);
        let s = summarize(&MarkerRead::Ok(m), T0 + 4_000_000, &[], None, None);
        assert_eq!(s.prev_exit_reason.as_deref(), Some("external_close"));
        assert_eq!(s.prev_exit_detail, None);
        assert_eq!(s.prev_exit_source, Some("intent"));
        assert_eq!(s.prev_exit_clean, Some(true));
    }

    #[test]
    fn intencion_de_apagado_escrita_por_el_wndproc_se_resume_como_os_session_end() {
        use crate::session_end::SessionEndKind;
        let mut m = marker();
        apply_session_intent(&mut m, SessionEndKind::Shutdown, T0 + 3_000_000);
        let s = summarize(&MarkerRead::Ok(m), T0 + 4_000_000, &[], None, None);
        assert_eq!(s.prev_exit_reason.as_deref(), Some("os_session_end"));
        assert_eq!(s.prev_exit_detail.as_deref(), Some("shutdown"));
        assert_eq!(s.prev_exit_source, Some("intent"));
    }

    #[test]
    fn restart_usa_el_codigo_de_tauri() {
        assert_eq!(tauri::RESTART_EXIT_CODE, i32::MAX);
        let c = classify_exit(None, &ExitRequestSeen::Programmatic(tauri::RESTART_EXIT_CODE), None, false);
        assert_eq!(c.reason, "restart");
    }

    #[test]
    fn todo_motivo_de_classify_exit_esta_en_el_contrato() {
        use ExitRequestSeen::*;
        let hints = [
            None,
            Some(ExitHint::TrayQuit),
            Some(ExitHint::RivalInstall),
            Some(ExitHint::Update { via: "nsis" }),
        ];
        let requested = [NotSeen, Programmatic(0), Programmatic(i32::MAX), UserInteraction];
        let sessions = [
            None,
            Some(se("logoff", false, false)),
            Some(se("shutdown", true, false)),
            Some(se("unknown", false, true)),
        ];
        for h in &hints {
            for r in &requested {
                for s in &sessions {
                    for sd in [false, true] {
                        let c = classify_exit(h.as_ref(), r, s.as_ref(), sd);
                        assert!(
                            CONTRACT_EXIT_REASONS.contains(&c.reason),
                            "motivo fuera del contrato: {}",
                            c.reason
                        );
                    }
                }
            }
        }
        // El centinela también escribe un motivo del contrato.
        assert!(CONTRACT_EXIT_REASONS.contains(&"process_exit_after_cleanup"));
    }

    #[test]
    fn claim_once_solo_el_primero_gana() {
        let flag = AtomicBool::new(false);
        assert!(claim_once(&flag));
        assert!(!claim_once(&flag));
        assert!(!claim_once(&flag));
    }

    #[test]
    fn el_payload_de_app_exit_lleva_los_campos_del_contrato() {
        let rec = ExitRecord {
            reason: "tray_quit".into(),
            detail: None,
            exit_code: None,
            begun_at_ms: T0,
            uptime_s: 3_600,
            recording_active: true,
            recording_phase: "recording",
            session_end_kind: None,
            critical: false,
        };
        let p = exit_payload(&rec);
        let obj = p.as_object().unwrap();
        for key in [
            "lifecycle_schema",
            "reason",
            "detail",
            "exit_code",
            "uptime_s",
            "recording_active",
            "recording_phase",
            "session_end_kind",
            "critical",
            "build",
        ] {
            assert!(obj.contains_key(key), "falta {}", key);
        }
        assert_eq!(obj.len(), 10);
        assert_eq!(p["lifecycle_schema"], 1);
        assert_eq!(p["reason"], "tray_quit");
        assert_eq!(p["uptime_s"], 3_600);
        assert_eq!(p["recording_active"], true);
        assert!(p["detail"].is_null());
    }
}
