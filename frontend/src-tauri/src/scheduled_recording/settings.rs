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

    /// Si está activo, la grabación que inicia el scheduler se cierra sola al llegar
    /// `auto_close_time`. Default ON (Incremento 4): la jornada debe cerrarse a las 18:00
    /// por defecto. `#[serde(default = ...)]` (en vez de `#[serde(default)]` = false) para
    /// que los JSON viejos sin el campo TAMBIÉN adopten el cierre por hora fija.
    #[serde(default = "default_auto_close_enabled")]
    pub auto_close_enabled: bool,

    /// Hora "HH:MM" (24h, local) a la que se cierra la última grabación cuando
    /// `auto_close_enabled` está activo. `#[serde(default = ...)]` para que los JSON viejos
    /// (sin el campo) tomen "18:00" en vez de "" (string vacío de `Default::default`).
    #[serde(default = "default_auto_close_time")]
    pub auto_close_time: String,

    /// Opt-in (Incremento 4): si está activo, la grabación de jornada se trocea en un
    /// segmento por hora (alineado al reloj). Al cruzar la hora en punto dentro de la
    /// ventana, el scheduler detiene el segmento actual (guarda local + nube) y arranca
    /// uno nuevo. Fuera de ventana NO rota — el cierre lo maneja `auto_close`. Default OFF.
    #[serde(default)]
    pub hourly_rotation_enabled: bool,
}

/// Default de `auto_close_time` para deserialización de JSONs sin el campo.
fn default_auto_close_time() -> String {
    "18:00".to_string()
}

/// Default de `auto_close_enabled` (Incremento 4): la jornada se cierra a las 18:00 por
/// defecto. Aplica también a JSONs persistidos que no traen el campo todavía.
fn default_auto_close_enabled() -> bool {
    true
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
            auto_close_enabled: default_auto_close_enabled(), // Incremento 4: cierra 18:00 por defecto
            auto_close_time: default_auto_close_time(),
            hourly_rotation_enabled: false, // opt-in: por defecto NO trocea por hora
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
    parse_and_normalize(&content)
}

/// Deserializa + normaliza un JSON persistido. Separada de `load_settings` para poder
/// testearse sin `AppHandle`.
///
/// La normalización cubre lo que una serde default fn NO puede: derivar un campo de sus
/// hermanos. Serde rellena `auto_close_time = "18:00"` ANTES de cualquier post-proceso,
/// así que la AUSENCIA de la key se detecta sobre el `Value` crudo. Un JSON pre-0.2.52
/// sin `auto_close_time` pero con ventana que termina a las 20:00 debe cerrar a las
/// 20:00 — no a las 18:00 fijas, que cortaría la jornada 2h antes y suprimiría el
/// re-arranque el resto del día (pérdida silenciosa). La derivación es one-shot sticky:
/// el próximo `save_settings` persiste el valor derivado.
fn parse_and_normalize(content: &str) -> Result<ScheduledRecordingSettings> {
    let raw: serde_json::Value = serde_json::from_str(content)?;
    let had_auto_close_time = raw.get("auto_close_time").is_some();
    let mut settings: ScheduledRecordingSettings = serde_json::from_value(raw)?;
    if !had_auto_close_time {
        settings.auto_close_time = derive_auto_close_time(&settings.windows);
    }
    Ok(settings)
}

/// `end_time` más tardío de las ventanas, por hora-de-reloj. Con una sola ventana
/// nocturna (22:00→06:00) da "06:00", que `auto_close_at` interpreta correctamente como
/// madrugada siguiente; con MEZCLA día+noche gana la mayor hora del día (config solo
/// alcanzable editando el JSON a mano — la UI edita una sola ventana). Ends inválidos se
/// ignoran; sin ventanas (o todas inválidas), fallback "18:00".
fn derive_auto_close_time(windows: &[ScheduleWindow]) -> String {
    windows
        .iter()
        .filter_map(|w| super::schedule::parse_hm(&w.end_time))
        .max()
        .map(|m| format!("{:02}:{:02}", m / 60, m % 60))
        .unwrap_or_else(default_auto_close_time)
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
    fn test_default_cierra_18_y_no_rota() {
        // Incremento 4: la jornada se cierra a las 18:00 por defecto; el troceo por hora es opt-in.
        let s = ScheduledRecordingSettings::default();
        assert!(s.auto_close_enabled, "auto_close debe estar ON por defecto (cerrar 18:00)");
        assert_eq!(s.auto_close_time, "18:00");
        assert!(!s.hourly_rotation_enabled, "rotación horaria debe ser opt-in (OFF por defecto)");
    }

    #[test]
    fn test_json_viejo_sin_campos_adopta_cierre_18() {
        // Un JSON persistido antes del Incremento 4 (sin auto_close_enabled ni hourly_rotation_enabled)
        // debe deserializar cerrando a las 18:00 (serde default fn) y sin rotación.
        let json = r#"{
            "enabled": true,
            "windows": [{"days_of_week":[1,2,3,4,5],"start_time":"09:00","end_time":"18:00"}],
            "grace_period_minutes": 30,
            "respect_manual_recording": true,
            "catch_up_on_start": true,
            "check_interval_seconds": 30,
            "notify_on_start": true,
            "meeting_name_template": "Jornada {date}"
        }"#;
        let s: ScheduledRecordingSettings = serde_json::from_str(json).unwrap();
        assert!(s.auto_close_enabled, "JSON viejo debe adoptar el cierre por hora fija");
        assert_eq!(s.auto_close_time, "18:00");
        assert!(!s.hourly_rotation_enabled);
    }

    /// JSON mínimo estilo pre-0.2.52 (sin `auto_close_time`) con la ventana indicada.
    fn json_sin_auto_close_time(end_time: &str) -> String {
        format!(
            r#"{{
                "enabled": true,
                "windows": [{{"days_of_week":[1,2,3,4,5],"start_time":"09:00","end_time":"{}"}}],
                "grace_period_minutes": 30,
                "respect_manual_recording": true,
                "catch_up_on_start": true,
                "check_interval_seconds": 30,
                "notify_on_start": true,
                "meeting_name_template": "Jornada {{date}}"
            }}"#,
            end_time
        )
    }

    #[test]
    fn test_normalize_deriva_auto_close_de_ventana() {
        // JSON viejo sin auto_close_time y ventana hasta las 17:30 → cierra 17:30, no 18:00.
        let s = parse_and_normalize(&json_sin_auto_close_time("17:30")).unwrap();
        assert_eq!(s.auto_close_time, "17:30");
    }

    #[test]
    fn test_normalize_ventana_tardia_no_se_corta_a_18() {
        // El caso que motivó la derivación: ventana hasta las 20:00 NO debe cerrar 18:00.
        let s = parse_and_normalize(&json_sin_auto_close_time("20:00")).unwrap();
        assert_eq!(s.auto_close_time, "20:00");
    }

    #[test]
    fn test_normalize_respeta_auto_close_explicito() {
        // Con la key presente, la normalización no toca nada (aunque la ventana difiera).
        let json = r#"{
            "enabled": true,
            "windows": [{"days_of_week":[1],"start_time":"09:00","end_time":"17:00"}],
            "grace_period_minutes": 30,
            "respect_manual_recording": true,
            "catch_up_on_start": true,
            "check_interval_seconds": 30,
            "notify_on_start": true,
            "meeting_name_template": "Jornada {date}",
            "auto_close_time": "20:00"
        }"#;
        let s = parse_and_normalize(json).unwrap();
        assert_eq!(s.auto_close_time, "20:00");
    }

    #[test]
    fn test_normalize_sin_ventanas_fallback_18() {
        let json = json_sin_auto_close_time("17:00").replace(
            r#"[{"days_of_week":[1,2,3,4,5],"start_time":"09:00","end_time":"17:00"}]"#,
            "[]",
        );
        let s = parse_and_normalize(&json).unwrap();
        assert_eq!(s.auto_close_time, "18:00");
    }

    #[test]
    fn test_normalize_end_invalido_fallback_18() {
        let s = parse_and_normalize(&json_sin_auto_close_time("99:99")).unwrap();
        assert_eq!(s.auto_close_time, "18:00");
    }

    #[test]
    fn test_derive_varias_ventanas_toma_la_mas_tardia() {
        let mk = |end: &str| ScheduleWindow {
            days_of_week: vec![1],
            start_time: "09:00".to_string(),
            end_time: end.to_string(),
        };
        assert_eq!(derive_auto_close_time(&[mk("13:00"), mk("17:45")]), "17:45");
    }

    #[test]
    fn test_normalize_json_corrupto_propaga_err() {
        // load_settings depende de este Err para que initialize() caiga a default().
        assert!(parse_and_normalize("no es json").is_err());
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
