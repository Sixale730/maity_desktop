//! Supresión de la jornada persistida entre reinicios (#83, J4 / B4).
//!
//! El rearme (`SchedulerShared.rearm`, service.rs) vivía solo en memoria: si el usuario
//! detenía la jornada a las 10:15 y la app se reiniciaba (update, crash, reinicio de
//! Windows), la jornada rearrancaba sola antes de las 11:00 — problema de privacidad: quizá
//! paró por una conversación privada —, y tras un cierre automático un reinicio abría un
//! segmento de overtime.
//!
//! Aquí se persisten SOLO las causas `UserStop` y `AutoClose` en
//! `app_local_data_dir/scheduled_recording_runtime.json` (Local, no Roaming: es estado de
//! esta máquina; bajo MSIX va redirigido a LocalCache). La retención de fin de sesión
//! (`SessionEnd`) es IRREPRESENTABLE en disco (`PersistedCause` no tiene esa variante): una
//! supresión escrita desde la ruta de salida apagaría la jornada tras cualquier reinicio.
//!
//! Todo lo que decide (proyección, serialización, validación al cargar) es PURO y se
//! testea con tablas; la E/S son tres funciones pequeñas (ruta, escritura atómica
//! tmp+rename, lectura opcional).

use std::path::{Path, PathBuf};

use chrono::{Duration, NaiveDateTime};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};
use tokio::io::AsyncWriteExt;

use super::schedule::next_hour_boundary;
use super::service::{Rearm, RearmCause};

/// Versión del formato. Una versión MAYOR se ignora sin borrar (la escribió una build más
/// nueva que convive en el mismo canal tras un downgrade; no destruir su estado).
pub(crate) const RUNTIME_STATE_VERSION: u32 = 1;
/// Nombre del archivo dentro de `app_local_data_dir`.
pub(crate) const FILE_NAME: &str = "scheduled_recording_runtime.json";
/// Tolerancia a un reloj que retrocede poco (NTP, cambio de zona) antes de descartar.
const CLOCK_SKEW_TOLERANCE_MINUTES: i64 = 10;
/// Tope de un `AutoClose` coherente: `next_fire_at` itera 8 días.
const AUTO_CLOSE_MAX_DAYS: i64 = 8;

/// Causas persistibles. SIN `SessionEnd`: irrepresentable en disco a propósito.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum PersistedCause {
    UserStop,
    AutoClose,
}

/// Rearme tal como se guarda en disco (`NaiveDateTime` local, igual que el scheduler).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct PersistedRearm {
    cause: PersistedCause,
    until: NaiveDateTime,
    set_at: NaiveDateTime,
}

impl PersistedRearm {
    fn into_rearm(self) -> Rearm {
        Rearm {
            until: self.until,
            cause: match self.cause {
                PersistedCause::UserStop => RearmCause::UserStop,
                PersistedCause::AutoClose => RearmCause::AutoClose,
            },
            set_at: self.set_at,
        }
    }
}

/// Archivo completo. Sin `deny_unknown_fields`: los campos futuros son aditivos.
#[derive(Debug, Serialize, Deserialize)]
struct RuntimeStateFile {
    version: u32,
    #[serde(default)]
    rearm: Option<PersistedRearm>,
}

/// Solo la versión: se lee ANTES del parse completo para que un archivo de una versión
/// futura (que quizá traiga causas nuevas) se ignore sin borrarlo en vez de caer en "corrupt".
#[derive(Debug, Deserialize)]
struct VersionProbe {
    version: u32,
}

/// Parte persistible de un rearme en memoria: `UserStop`/`AutoClose` ⇒ `Some`;
/// `SessionEnd`/`None` ⇒ `None` (no se escribe nada, y si había archivo se borra).
pub(crate) fn persisted_projection(r: Option<&Rearm>) -> Option<PersistedRearm> {
    let r = r?;
    let cause = match r.cause {
        RearmCause::UserStop => PersistedCause::UserStop,
        RearmCause::AutoClose => PersistedCause::AutoClose,
        RearmCause::SessionEnd => return None,
    };
    Some(PersistedRearm {
        cause,
        until: r.until,
        set_at: r.set_at,
    })
}

/// Contenido del archivo para un rearme en memoria. `None` ⇒ el archivo se BORRA.
pub(crate) fn serialize_state(r: Option<&Rearm>) -> Option<String> {
    let rearm = persisted_projection(r)?;
    serde_json::to_string(&RuntimeStateFile {
        version: RUNTIME_STATE_VERSION,
        rearm: Some(rearm),
    })
    .ok()
}

/// Qué hacer con el archivo leído al arrancar.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RestoreOutcome {
    /// Rearme vigente y coherente: se restaura en memoria.
    Restored(Rearm),
    /// Archivo válido sin rearme: se borra (no aporta nada).
    Empty,
    /// No se usa y se BORRA: `corrupt`, `inconsistent`, `expired`, `clock_moved_back`.
    Discard(&'static str),
    /// No se usa y NO se borra: `future_version`.
    Ignore(&'static str),
}

/// Valida el contenido del archivo contra el reloj actual. Orden:
/// 1. no es JSON o no trae `version` ⇒ `Discard("corrupt")`;
/// 2. `version > RUNTIME_STATE_VERSION` ⇒ `Ignore("future_version")` (antes del parse
///    completo: una versión futura puede traer causas que esta build no conoce);
/// 3. el parse completo falla (incluye `"cause":"session_end"` o cualquier causa
///    desconocida) ⇒ `Discard("corrupt")`;
/// 4. `rearm` ausente ⇒ `Empty`;
/// 5. coherencia: `UserStop` exige `until == next_hour_boundary(set_at)`; `AutoClose` exige
///    `set_at < until <= set_at + 8 días` ⇒ si no, `Discard("inconsistent")`;
/// 6. `now < set_at − 10 min` ⇒ `Discard("clock_moved_back")` (el reloj retrocedió: el
///    rearme duraría más de lo que se pidió). Equivale a `until − now > (until − set_at) + 10 min`;
/// 7. `now >= until` ⇒ `Discard("expired")`;
/// 8. si no ⇒ `Restored`.
pub(crate) fn restore(content: &str, now: NaiveDateTime) -> RestoreOutcome {
    let probe: VersionProbe = match serde_json::from_str(content) {
        Ok(p) => p,
        Err(_) => return RestoreOutcome::Discard("corrupt"),
    };
    if probe.version > RUNTIME_STATE_VERSION {
        return RestoreOutcome::Ignore("future_version");
    }
    let file: RuntimeStateFile = match serde_json::from_str(content) {
        Ok(f) => f,
        Err(_) => return RestoreOutcome::Discard("corrupt"),
    };
    let Some(p) = file.rearm else {
        return RestoreOutcome::Empty;
    };

    let coherent = match p.cause {
        PersistedCause::UserStop => p.until == next_hour_boundary(p.set_at),
        PersistedCause::AutoClose => {
            p.set_at < p.until && p.until <= p.set_at + Duration::days(AUTO_CLOSE_MAX_DAYS)
        }
    };
    if !coherent {
        return RestoreOutcome::Discard("inconsistent");
    }
    if now < p.set_at - Duration::minutes(CLOCK_SKEW_TOLERANCE_MINUTES) {
        return RestoreOutcome::Discard("clock_moved_back");
    }
    if now >= p.until {
        return RestoreOutcome::Discard("expired");
    }
    RestoreOutcome::Restored(p.into_rearm())
}

/// Ruta del archivo: `app_local_data_dir/scheduled_recording_runtime.json` (crea el
/// directorio si falta).
pub(crate) fn state_path<R: Runtime>(app: &AppHandle<R>) -> anyhow::Result<PathBuf> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| anyhow::anyhow!("app_local_data_dir no disponible: {}", e))?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join(FILE_NAME))
}

/// Escritura atómica. `Some` ⇒ escribe `.<nombre>.tmp` en el mismo directorio, `sync_all` y
/// `rename` sobre el destino (en Windows reemplaza al existente). `None` ⇒ borra el archivo,
/// ignorando `NotFound`.
pub(crate) async fn write_to_path(path: &Path, content: Option<String>) -> std::io::Result<()> {
    let Some(content) = content else {
        return match tokio::fs::remove_file(path).await {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e),
        };
    };
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| FILE_NAME.to_string());
    let tmp = path.with_file_name(format!(".{}.tmp", file_name));
    let written = async {
        let mut f = tokio::fs::File::create(&tmp).await?;
        f.write_all(content.as_bytes()).await?;
        f.sync_all().await?;
        drop(f);
        tokio::fs::rename(&tmp, path).await
    }
    .await;
    if written.is_err() {
        // Best-effort: no dejar el temporal huérfano.
        let _ = tokio::fs::remove_file(&tmp).await;
    }
    written
}

/// Lee el archivo si existe (`NotFound` u otro error de lectura ⇒ `None`).
pub(crate) async fn read_to_string_opt(path: &Path) -> Option<String> {
    match tokio::fs::read_to_string(path).await {
        Ok(s) => Some(s),
        Err(e) => {
            if e.kind() != std::io::ErrorKind::NotFound {
                log::warn!("[scheduled] no se pudo leer el estado de supresión: {}", e);
            }
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scheduled_recording::settings::{ScheduleWindow, ScheduledRecordingSettings};

    fn t(y: i32, m: u32, d: u32, h: u32, min: u32) -> NaiveDateTime {
        chrono::NaiveDate::from_ymd_opt(y, m, d)
            .unwrap()
            .and_hms_opt(h, min, 0)
            .unwrap()
    }

    fn weekday_settings() -> ScheduledRecordingSettings {
        ScheduledRecordingSettings {
            windows: vec![ScheduleWindow {
                days_of_week: vec![1, 2, 3, 4, 5],
                start_time: "09:00".to_string(),
                end_time: "18:00".to_string(),
            }],
            ..ScheduledRecordingSettings::default()
        }
    }

    fn file_json(cause: &str, until: &str, set_at: &str) -> String {
        format!(
            r#"{{"version":1,"rearm":{{"cause":"{}","until":"{}","set_at":"{}"}}}}"#,
            cause, until, set_at
        )
    }

    #[test]
    fn round_trip_user_stop_conserva_set_at_exacto() {
        let set_at = t(2026, 9, 23, 10, 17) + Duration::milliseconds(42_500);
        let r = Rearm::user_stop(set_at);
        let json = serialize_state(Some(&r)).expect("UserStop se persiste");
        assert!(json.contains("\"cause\":\"user_stop\""), "{}", json);
        match restore(&json, t(2026, 9, 23, 10, 30)) {
            RestoreOutcome::Restored(back) => {
                assert_eq!(back.cause, RearmCause::UserStop);
                assert_eq!(back.until, t(2026, 9, 23, 11, 0));
                assert_eq!(back.set_at, set_at);
            }
            other => panic!("esperaba Restored, fue {:?}", other),
        }
    }

    #[test]
    fn round_trip_auto_close_hasta_el_siguiente_inicio_de_ventana() {
        let now = t(2026, 9, 22, 17, 0); // martes
        let r = Rearm::auto_close(now, &weekday_settings());
        assert_eq!(r.until, t(2026, 9, 23, 9, 0));
        let json = serialize_state(Some(&r)).expect("AutoClose se persiste");
        assert_eq!(restore(&json, t(2026, 9, 22, 20, 0)), RestoreOutcome::Restored(r));
    }

    #[test]
    fn session_end_y_none_nunca_se_escriben() {
        let now = t(2026, 9, 23, 10, 15);
        assert_eq!(persisted_projection(Some(&Rearm::session_end(now))), None);
        assert_eq!(serialize_state(Some(&Rearm::session_end(now))), None);
        assert_eq!(serialize_state(None), None);
        // Un archivo escrito a mano con session_end no es representable ⇒ corrupto (se borra).
        let json = file_json("session_end", "2026-09-23T10:30:00", "2026-09-23T10:15:00");
        assert_eq!(restore(&json, now), RestoreOutcome::Discard("corrupt"));
    }

    #[test]
    fn user_stop_vencido_se_descarta() {
        let set_at = t(2026, 9, 23, 10, 17);
        let json = serialize_state(Some(&Rearm::user_stop(set_at))).unwrap();
        assert_eq!(restore(&json, t(2026, 9, 23, 11, 0)), RestoreOutcome::Discard("expired"));
        assert_eq!(restore(&json, t(2026, 9, 24, 9, 0)), RestoreOutcome::Discard("expired"));
    }

    #[test]
    fn registros_inconsistentes_se_descartan() {
        let now = t(2026, 9, 23, 10, 20);
        // user_stop con until = set_at + 3 h (no es la siguiente hora en punto).
        let json = file_json("user_stop", "2026-09-23T13:15:00", "2026-09-23T10:15:00");
        assert_eq!(restore(&json, now), RestoreOutcome::Discard("inconsistent"));
        // auto_close de 9 días.
        let json = file_json("auto_close", "2026-10-02T17:00:00", "2026-09-23T17:00:00");
        assert_eq!(
            restore(&json, t(2026, 9, 23, 18, 0)),
            RestoreOutcome::Discard("inconsistent")
        );
        // auto_close con until <= set_at.
        let json = file_json("auto_close", "2026-09-23T17:00:00", "2026-09-23T17:00:00");
        assert_eq!(
            restore(&json, t(2026, 9, 23, 16, 0)),
            RestoreOutcome::Discard("inconsistent")
        );
    }

    #[test]
    fn reloj_movido_hacia_atras_se_descarta_con_tolerancia() {
        let set_at = t(2026, 9, 23, 18, 5);
        let json = file_json("auto_close", "2026-09-24T09:00:00", "2026-09-23T18:05:00");
        // Madrugada del MISMO día del set_at: el reloj retrocedió ~17 h.
        assert_eq!(
            restore(&json, t(2026, 9, 23, 0, 30)),
            RestoreOutcome::Discard("clock_moved_back")
        );
        // Dentro de la tolerancia (2 min antes del set_at) ⇒ se restaura.
        assert!(matches!(
            restore(&json, set_at - Duration::minutes(2)),
            RestoreOutcome::Restored(_)
        ));
        // Justo fuera de la tolerancia.
        assert_eq!(
            restore(&json, set_at - Duration::minutes(11)),
            RestoreOutcome::Discard("clock_moved_back")
        );
        // Tres días antes.
        assert_eq!(
            restore(&json, set_at - Duration::days(3)),
            RestoreOutcome::Discard("clock_moved_back")
        );
    }

    #[test]
    fn formato_corrupto_version_futura_vacio_y_campos_extra() {
        let now = t(2026, 9, 23, 10, 20);
        assert_eq!(restore("no es json", now), RestoreOutcome::Discard("corrupt"));
        assert_eq!(restore("", now), RestoreOutcome::Discard("corrupt"));
        assert_eq!(restore(r#"{"rearm":null}"#, now), RestoreOutcome::Discard("corrupt"));
        // Versión futura: se ignora SIN borrar, aunque traiga una causa desconocida.
        let v2 = r#"{"version":2,"rearm":{"cause":"user_stop","until":"2026-09-23T11:00:00","set_at":"2026-09-23T10:15:00"}}"#;
        assert_eq!(restore(v2, now), RestoreOutcome::Ignore("future_version"));
        let v2_new_cause = r#"{"version":2,"rearm":{"cause":"vacation","until":"2026-09-30T00:00:00","set_at":"2026-09-23T10:15:00"}}"#;
        assert_eq!(restore(v2_new_cause, now), RestoreOutcome::Ignore("future_version"));
        // Sin rearme ⇒ Empty.
        assert_eq!(restore(r#"{"version":1}"#, now), RestoreOutcome::Empty);
        assert_eq!(restore(r#"{"version":1,"rearm":null}"#, now), RestoreOutcome::Empty);
        // Campo desconocido extra (aditivo) ⇒ sigue restaurando.
        let extra = r#"{"version":1,"written_by":"0.2.62","rearm":{"cause":"user_stop","until":"2026-09-23T11:00:00","set_at":"2026-09-23T10:15:00","note":"x"}}"#;
        assert!(matches!(restore(extra, now), RestoreOutcome::Restored(_)));
    }

    #[tokio::test]
    async fn escritura_atomica_reemplaza_y_borra() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(FILE_NAME);
        let tmp = dir.path().join(format!(".{}.tmp", FILE_NAME));

        let first = serialize_state(Some(&Rearm::user_stop(t(2026, 9, 23, 10, 15))));
        write_to_path(&path, first.clone()).await.unwrap();
        assert!(path.exists());
        assert!(!tmp.exists(), "no debe quedar el temporal");
        assert_eq!(read_to_string_opt(&path).await, first);

        let second = serialize_state(Some(&Rearm::user_stop(t(2026, 9, 23, 14, 5))));
        write_to_path(&path, second.clone()).await.unwrap();
        assert_eq!(read_to_string_opt(&path).await, second);
        assert!(!tmp.exists());

        write_to_path(&path, None).await.unwrap();
        assert!(!path.exists());
        assert_eq!(read_to_string_opt(&path).await, None);
        // Borrar sin archivo es Ok.
        write_to_path(&path, None).await.unwrap();
    }
}
