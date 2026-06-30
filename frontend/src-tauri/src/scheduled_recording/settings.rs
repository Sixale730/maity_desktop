//! Scheduled Recording Settings
//!
//! Configuración para la grabación programada por jornada. Persiste como JSON en
//! `{app_config_dir}/scheduled_recording_settings.json`, replicando el mecanismo del
//! Meeting Detector (NO usa las tablas singleton de SQLite).

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use anyhow::Result;
use tauri::{AppHandle, Manager, Runtime};

/// Configuración del scheduler de grabación por jornada.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduledRecordingSettings {
    /// Si la grabación programada está activa.
    pub enabled: bool,

    /// Ventanas horarias en las que se debe grabar (1+).
    pub windows: Vec<ScheduleWindow>,

    /// Margen máximo (minutos) que se espera al fin de ventana si hay reunión activa (D4).
    pub grace_period_minutes: u32,

    /// Si una grabación manual está en curso al iniciar la ventana, no interrumpir (D3).
    pub respect_manual_recording: bool,

    /// Si la app abre dentro de una ventana activa, arrancar a mitad de jornada.
    pub catch_up_on_start: bool,

    /// Periodo del loop de evaluación, en segundos.
    pub check_interval_seconds: u32,

    /// Mostrar notificación al usuario cuando arranca una grabación programada.
    pub notify_on_start: bool,

    /// Plantilla del nombre de reunión. Soporta `{date}` y `{time}`.
    pub meeting_name_template: String,

    /// True una vez que el usuario vio/atendió el gate de activación (onboarding o
    /// modal post-update), o configuró la jornada desde Settings. Evita re-mostrar el
    /// gate aunque luego desactive. `#[serde(default)]` para no romper JSONs existentes.
    #[serde(default)]
    pub configured_by_user: bool,

    /// Extra opt-in (Incremento 3): si está activo, la grabación que inicia el scheduler
    /// se cierra sola al llegar `auto_close_time`. Si está apagado (default), la grabación
    /// NO se cierra sola — corre hasta que el usuario la detenga a mano.
    #[serde(default)]
    pub auto_close_enabled: bool,

    /// Hora "HH:MM" (24h, local) a la que se cierra la última grabación cuando
    /// `auto_close_enabled` está activo. `#[serde(default = ...)]` para que los JSON viejos
    /// (sin el campo) tomen "18:00" en vez de "" (string vacío de `Default::default`).
    #[serde(default = "default_auto_close_time")]
    pub auto_close_time: String,
}

/// Default de `auto_close_time` para deserialización de JSONs sin el campo.
fn default_auto_close_time() -> String {
    "18:00".to_string()
}

/// Una ventana horaria recurrente por días de la semana.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduleWindow {
    /// Días en los que la ventana ARRANCA. 1=Lunes .. 7=Domingo
    /// (mapea directo a `chrono::Weekday::number_from_monday()`).
    pub days_of_week: Vec<u8>,

    /// Hora de inicio "HH:MM" (24h), hora LOCAL del sistema.
    pub start_time: String,

    /// Hora de fin "HH:MM" (24h). Si `end_time <= start_time` la ventana cruza medianoche.
    pub end_time: String,
}

impl Default for ScheduledRecordingSettings {
    fn default() -> Self {
        Self {
            enabled: false, // opt-in explícito (privacidad)
            windows: vec![ScheduleWindow {
                days_of_week: vec![1, 2, 3, 4, 5], // Lun-Vie
                start_time: "09:00".to_string(),
                end_time: "18:00".to_string(),
            }],
            grace_period_minutes: 30,
            respect_manual_recording: true,
            catch_up_on_start: true,
            check_interval_seconds: 30,
            notify_on_start: true,
            meeting_name_template: "Jornada {date}".to_string(),
            configured_by_user: false,
            auto_close_enabled: false, // opt-in: por defecto NO se cierra sola
            auto_close_time: default_auto_close_time(),
        }
    }
}

/// Ruta del archivo de settings (crea el directorio si no existe).
fn get_settings_path<R: Runtime>(app_handle: &AppHandle<R>) -> Result<PathBuf> {
    let config_dir = app_handle
        .path()
        .app_config_dir()
        .map_err(|e| anyhow::anyhow!("Failed to get config directory: {}", e))?;

    std::fs::create_dir_all(&config_dir)?;
    Ok(config_dir.join("scheduled_recording_settings.json"))
}

/// Carga settings desde disco (o defaults si no existe el archivo).
pub async fn load_settings<R: Runtime>(
    app_handle: &AppHandle<R>,
) -> Result<ScheduledRecordingSettings> {
    let path = get_settings_path(app_handle)?;

    if !path.exists() {
        return Ok(ScheduledRecordingSettings::default());
    }

    let content = tokio::fs::read_to_string(&path).await?;
    let settings: ScheduledRecordingSettings = serde_json::from_str(&content)?;
    Ok(settings)
}

/// Guarda settings a disco (JSON pretty-printed).
pub async fn save_settings<R: Runtime>(
    app_handle: &AppHandle<R>,
    settings: &ScheduledRecordingSettings,
) -> Result<()> {
    let path = get_settings_path(app_handle)?;
    let content = serde_json::to_string_pretty(settings)?;
    tokio::fs::write(&path, content).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_is_opt_in() {
        let s = ScheduledRecordingSettings::default();
        assert!(!s.enabled, "scheduled recording debe estar OFF por defecto (privacidad)");
        assert!(s.respect_manual_recording);
        assert!(s.catch_up_on_start);
        assert_eq!(s.grace_period_minutes, 30);
        assert_eq!(s.check_interval_seconds, 30);
    }

    #[test]
    fn test_default_window_is_weekday_9_to_18() {
        let s = ScheduledRecordingSettings::default();
        assert_eq!(s.windows.len(), 1);
        let w = &s.windows[0];
        assert_eq!(w.days_of_week, vec![1, 2, 3, 4, 5]);
        assert_eq!(w.start_time, "09:00");
        assert_eq!(w.end_time, "18:00");
    }

    #[test]
    fn test_settings_roundtrip_json() {
        let s = ScheduledRecordingSettings::default();
        let json = serde_json::to_string(&s).unwrap();
        let back: ScheduledRecordingSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(back.windows.len(), s.windows.len());
        assert_eq!(back.meeting_name_template, s.meeting_name_template);
    }
}
