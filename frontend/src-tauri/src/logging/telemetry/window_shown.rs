//! Evento `app.window_shown`: quién mostró la ventana principal (el `app-ready`
//! del frontend o el fallback de 3 s de `lib.rs`) y cuánto tardó desde el
//! inicio de `setup()`. Una fila por proceso.
//!
//! No va dentro de `app.start` (spec F5, #fixes-pre-0262) porque `app.start`
//! se emite ANTES de que cargue el webview — no puede llevar la latencia del
//! frontend sin bloquear su propia emisión a esperar el placement de la
//! ventana. Este módulo vive aparte y se dispara desde los dos puntos de
//! `lib.rs` que ya deciden el placement (listener de `APP_READY` y el
//! `std::thread::spawn` del fallback), sin tocar su lógica de show/minimize/focus.
//!
//! Si gana el fallback, se espera hasta `LATE_READY_WAIT_MS` (60 s) un
//! `app-ready` tardío; si nunca llega, se emite con `app_ready_ms: null`.

use std::sync::atomic::Ordering;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use tauri::{AppHandle, Runtime};

use super::{catalog, context, emit, status::TelemetryStatus};

/// Tiempo tras el cual `lib.rs` muestra la ventana por fallback si el frontend
/// no señaló `app-ready`. Debe coincidir con el `sleep` del fallback en `lib.rs`.
pub const FALLBACK_AFTER_MS: u64 = 3_000;

/// Cuánto se espera, tras un fallback, un `app-ready` tardío antes de emitir
/// la fila con `app_ready_ms: null`.
pub const LATE_READY_WAIT_MS: u64 = 60_000;

static SETUP_START: OnceLock<Instant> = OnceLock::new();

/// Marca el inicio de `setup()` como origen de los `*_ms` del evento.
/// Idempotente: solo la primera llamada fija el instante.
pub fn mark_setup_start() {
    let _ = SETUP_START.set(Instant::now());
}

/// Milisegundos desde `mark_setup_start()`. `0` si nunca se marcó (no debería
/// pasar en producción: `lib.rs` la llama como primera sentencia del closure
/// de `setup`).
fn elapsed_ms() -> u64 {
    match SETUP_START.get() {
        Some(start) => start.elapsed().as_millis() as u64,
        None => 0,
    }
}

/// Payload de la fila a emitir. Claves exactas del JSON en `to_json`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ShownPayload {
    shown_by: &'static str,
    shown_ms: u64,
    app_ready_ms: Option<u64>,
}

impl ShownPayload {
    pub(crate) fn to_json(&self, started_at_boot: bool) -> serde_json::Value {
        serde_json::json!({
            "shown_by": self.shown_by,
            "shown_ms": self.shown_ms,
            "app_ready_ms": self.app_ready_ms,
            "started_at_boot": started_at_boot,
            "fallback_after_ms": FALLBACK_AFTER_MS,
            "late_ready_wait_ms": LATE_READY_WAIT_MS,
        })
    }
}

/// Máquina de estados pura (sin statics) del ciclo "quién mostró la ventana".
/// `emitted` es un latch: una sola fila por proceso.
#[derive(Debug, Default)]
pub(crate) struct ShownTracker {
    fallback_ms: Option<u64>,
    app_ready_ms: Option<u64>,
    emitted: bool,
}

impl ShownTracker {
    /// El frontend señaló `app-ready` en `at_ms`.
    ///
    /// - Si ya se emitió (segundo `app-ready` de un remount, o llegó después
    ///   de que expiró la espera de 60 s), no hace nada: `None`.
    /// - Si no hubo fallback todavía, este `app-ready` es quien mostró la
    ///   ventana: emite `shown_by: "app_ready"`.
    /// - Si ya hubo fallback, este `app-ready` es el "tardío": emite
    ///   `shown_by: "fallback"` con `shown_ms` del fallback y `app_ready_ms`
    ///   de este evento.
    pub(crate) fn on_app_ready(&mut self, at_ms: u64) -> Option<ShownPayload> {
        if self.emitted {
            return None;
        }
        self.app_ready_ms = Some(at_ms);
        self.emitted = true;
        match self.fallback_ms {
            Some(fallback_ms) => Some(ShownPayload {
                shown_by: "fallback",
                shown_ms: fallback_ms,
                app_ready_ms: Some(at_ms),
            }),
            None => Some(ShownPayload {
                shown_by: "app_ready",
                shown_ms: at_ms,
                app_ready_ms: Some(at_ms),
            }),
        }
    }

    /// El fallback de `lib.rs` mostró la ventana en `at_ms` (no hubo
    /// `app-ready` a tiempo). Registra el instante y devuelve `true` cuando el
    /// llamador debe armar la espera de 60 s por un `app-ready` tardío
    /// (`false` si ya se emitió o si ya había un `app-ready` — no debería
    /// pasar: el fallback solo dispara si la ventana seguía oculta).
    pub(crate) fn on_fallback_shown(&mut self, at_ms: u64) -> bool {
        if self.emitted || self.fallback_ms.is_some() {
            return false;
        }
        self.fallback_ms = Some(at_ms);
        true
    }

    /// Expiró la espera de 60 s por un `app-ready` tardío tras el fallback.
    /// Emite `shown_by: "fallback"` con `app_ready_ms: None` si nada más lo
    /// emitió mientras tanto.
    pub(crate) fn on_wait_expired(&mut self) -> Option<ShownPayload> {
        if self.emitted {
            return None;
        }
        let fallback_ms = self.fallback_ms.unwrap_or_else(elapsed_ms);
        self.emitted = true;
        Some(ShownPayload {
            shown_by: "fallback",
            shown_ms: fallback_ms,
            app_ready_ms: None,
        })
    }
}

static TRACKER: Mutex<ShownTracker> = Mutex::new(ShownTracker {
    fallback_ms: None,
    app_ready_ms: None,
    emitted: false,
});

fn emit_payload<R: Runtime>(app: &AppHandle<R>, payload: ShownPayload) {
    let started_at_boot = crate::STARTED_AT_BOOT.load(Ordering::Relaxed);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        emit::emit_event(
            &app,
            context::process_session_id(),
            catalog::APP_WINDOW_SHOWN,
            payload.to_json(started_at_boot),
            Some(TelemetryStatus::Ok),
            None,
            None,
        )
        .await;
    });
}

/// Llamar al entrar al listener de `APP_READY`, antes de `show()`.
pub fn note_app_ready<R: Runtime>(app: &AppHandle<R>) {
    let at_ms = elapsed_ms();
    let payload = {
        let mut tracker = TRACKER.lock().unwrap_or_else(|e| e.into_inner());
        tracker.on_app_ready(at_ms)
    };
    if let Some(payload) = payload {
        emit_payload(app, payload);
    }
}

/// Llamar dentro del fallback de `lib.rs`, después de `show()`, cuando la
/// ventana seguía oculta a los 3 s.
pub fn note_fallback_shown<R: Runtime>(app: &AppHandle<R>) {
    let at_ms = elapsed_ms();
    let should_wait = {
        let mut tracker = TRACKER.lock().unwrap_or_else(|e| e.into_inner());
        tracker.on_fallback_shown(at_ms)
    };
    if !should_wait {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(LATE_READY_WAIT_MS)).await;
        let payload = {
            let mut tracker = TRACKER.lock().unwrap_or_else(|e| e.into_inner());
            tracker.on_wait_expired()
        };
        if let Some(payload) = payload {
            emit_payload(&app, payload);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ready_primero_emite_app_ready_y_no_arma_espera() {
        let mut tracker = ShownTracker::default();
        let payload = tracker.on_app_ready(120).expect("debe emitir");
        assert_eq!(payload.shown_by, "app_ready");
        assert_eq!(payload.shown_ms, 120);
        assert_eq!(payload.app_ready_ms, Some(120));

        // Un app-ready posterior (remount) ya no emite nada.
        assert_eq!(tracker.on_app_ready(500), None);
        // Tampoco un fallback tardío hipotético (no debería llamarse, pero el
        // latch lo cubre igual).
        assert!(!tracker.on_fallback_shown(3_000));
    }

    #[test]
    fn fallback_y_luego_ready_tardio_emite_fallback_con_app_ready_ms() {
        let mut tracker = ShownTracker::default();
        assert!(tracker.on_fallback_shown(3_000), "debe armar la espera");

        let payload = tracker.on_app_ready(4_100).expect("debe emitir");
        assert_eq!(payload.shown_by, "fallback");
        assert_eq!(payload.shown_ms, 3_000);
        assert_eq!(payload.app_ready_ms, Some(4_100));

        // Ya emitido: ni un segundo ready ni la expiración de la espera emiten de nuevo.
        assert_eq!(tracker.on_app_ready(9_000), None);
        assert_eq!(tracker.on_wait_expired(), None);
    }

    #[test]
    fn fallback_sin_ready_expira_con_app_ready_ms_null() {
        let mut tracker = ShownTracker::default();
        assert!(tracker.on_fallback_shown(3_000));

        let payload = tracker.on_wait_expired().expect("debe emitir al expirar");
        assert_eq!(payload.shown_by, "fallback");
        assert_eq!(payload.shown_ms, 3_000);
        assert_eq!(payload.app_ready_ms, None);

        // Nada emite dos veces.
        assert_eq!(tracker.on_wait_expired(), None);
        assert_eq!(tracker.on_app_ready(70_000), None);
    }

    #[test]
    fn segundo_fallback_no_rearma_la_espera() {
        let mut tracker = ShownTracker::default();
        assert!(tracker.on_fallback_shown(3_000));
        // No debería pasar en producción (la ventana ya estaría visible),
        // pero el latch de `fallback_ms` evita una segunda espera igual.
        assert!(!tracker.on_fallback_shown(3_100));
    }

    #[test]
    fn to_json_tiene_las_claves_exactas() {
        let payload = ShownPayload {
            shown_by: "app_ready",
            shown_ms: 42,
            app_ready_ms: Some(42),
        };
        let value = payload.to_json(true);
        let obj = value.as_object().expect("debe ser un objeto");
        let mut keys: Vec<&str> = obj.keys().map(|k| k.as_str()).collect();
        keys.sort_unstable();
        let mut expected = vec![
            "shown_by",
            "shown_ms",
            "app_ready_ms",
            "started_at_boot",
            "fallback_after_ms",
            "late_ready_wait_ms",
        ];
        expected.sort_unstable();
        assert_eq!(keys, expected);
        assert_eq!(obj.get("fallback_after_ms").unwrap(), &serde_json::json!(FALLBACK_AFTER_MS));
        assert_eq!(obj.get("late_ready_wait_ms").unwrap(), &serde_json::json!(LATE_READY_WAIT_MS));
    }
}
