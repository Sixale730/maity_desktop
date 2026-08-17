//! Id de sesión de GRABACIÓN (`session-<epoch_ms>-<rand>`), el mismo formato
//! que generaba `recordingLogService.startSession()` en JS. Es un nivel por
//! debajo del id de proceso (`ctx.session_id`): una jornada tiene un proceso y
//! N grabaciones.
//!
//! `begin()` se llama SOLO desde `initialize_recording` con el `StartGate` en
//! mano (una sola grabación activa garantizada — sin carreras sobre el slot).
//! `take()` lo consume el stop. Un start fallido usa `new_id()` efímero y no
//! toca el slot: pisar el id de una grabación VIVA por un doble-clic rechazado
//! corrompería el join start↔stop.

use std::sync::Mutex;

static CURRENT: Mutex<Option<String>> = Mutex::new(None);

pub fn new_id() -> String {
    let ts = chrono::Utc::now().timestamp_millis();
    let rand = &uuid::Uuid::new_v4().simple().to_string()[..6];
    format!("session-{}-{}", ts, rand)
}

/// Genera el id de la grabación que ARRANCA y lo deja en el slot para el stop.
pub fn begin() -> String {
    let id = new_id();
    if let Ok(mut current) = CURRENT.lock() {
        *current = Some(id.clone());
    }
    id
}

/// Consume el id de la grabación activa (None si no hubo start instrumentado,
/// p. ej. stop tras un reinicio del proceso).
pub fn take() -> Option<String> {
    CURRENT.lock().ok().and_then(|mut current| current.take())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn begin_y_take_forman_un_ciclo() {
        let id = begin();
        assert!(id.starts_with("session-"));
        assert_eq!(take().as_deref(), Some(id.as_str()));
        assert_eq!(take(), None, "el segundo take no debe ver nada");
    }
}
