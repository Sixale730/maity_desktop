//! Descarga del motor STT en reposo y prewarm antes de la jornada (sep-2026,
//! #02 de la auditoría de recursos).
//!
//! En tier Low (5-7 GB, 11 de 20 usuarios del piloto) los ~600 MB de Parakeet
//! residentes entre grabaciones son la diferencia entre 74 MB libres y una
//! máquina usable. Esta tarea suelta el modelo cuando lleva `IDLE_UNLOAD_AFTER`
//! en fase `Idle` fuera de la ventana de jornada, y lo vuelve a calentar
//! `PREWARM_LEAD` antes de que arranque la siguiente ventana para que el tick
//! del scheduler no pague la carga fría. Fuera de tier Low la tarea ni siquiera
//! arranca: ahí el modelo sólo se descarga en logout (`clear_current_user`).
//!
//! **Por qué una tarea propia y no un tick prestado** (mismo criterio que
//! `audio_retention.rs`): el tick del scheduler sólo corre con la jornada
//! habilitada, y el usuario de grabación manual también merece el ahorro; el
//! `mem_sampler` mueve un `System` dentro y fuera de `spawn_blocking` y una
//! descarga de 600 MB ahí contaminaría el timing de la muestra.
//!
//! **El reposo se mide con `Instant`, nunca en ticks** (regla derivada del #14):
//! "N ticks de 60 s" cambiaría de significado con la cadencia y el log mentiría.
//!
//! La política es pura (`should_unload`, `should_prewarm`, `window_context`) y
//! se prueba con tablas; el loop sólo la alimenta.

use std::time::{Duration, Instant};

use chrono::{Local, NaiveDateTime};
use log::{info, warn};
use tauri::{AppHandle, Manager, Runtime};

use crate::audio::hardware_detector::{HardwareProfile, PerformanceTier};
use crate::audio::recording_phase::{self, RecordingPhase};
use crate::logging::mem_sampler::PressureLevel;
use crate::scheduled_recording::commands::ScheduledRecordingState;
use crate::scheduled_recording::schedule;
use crate::scheduled_recording::settings::ScheduledRecordingSettings;

use super::engine::{any_local_engine_loaded, ensure_stt_warm, unload_stt, UnloadOutcome, WarmOutcome};

/// Cadencia del loop. Un minuto es suficiente: el umbral es de 10 min y el
/// prewarm lleva 5 min de margen.
const TICK: Duration = Duration::from_secs(60);
/// Pista libre al arranque: `autoRecoverAll` y la init de motores van primero.
const STARTUP_DELAY: Duration = Duration::from_secs(60);
/// Reposo continuo (fase `Idle`) antes de descargar, en tier Low.
const IDLE_UNLOAD_AFTER_LOW: Duration = Duration::from_secs(10 * 60);
/// Con la próxima ventana a menos de esto, no se descarga y se pre-calienta.
const PREWARM_LEAD: Duration = Duration::from_secs(5 * 60);
/// Override de desarrollo (segundos) para no esperar 10 min en un smoke.
/// Fuerza el umbral en cualquier tier; mismo espíritu que `MEMORY_GB`.
const IDLE_UNLOAD_ENV: &str = "MAITY_STT_IDLE_UNLOAD_SECS";

/// Umbral de reposo por tier. `None` = esta tarea no descarga nunca (el modelo
/// sólo se suelta en logout). Pura, para la tabla de tests.
pub(crate) fn idle_unload_after(tier: &PerformanceTier) -> Option<Duration> {
    match tier {
        PerformanceTier::Low => Some(IDLE_UNLOAD_AFTER_LOW),
        PerformanceTier::Medium | PerformanceTier::High | PerformanceTier::Ultra => None,
    }
}

/// Umbral efectivo: override de entorno o política por tier.
fn effective_threshold() -> Option<Duration> {
    if let Ok(raw) = std::env::var(IDLE_UNLOAD_ENV) {
        match raw.trim().parse::<u64>() {
            Ok(secs) => {
                warn!(
                    "[stt-idle] override {}={} s (sólo para pruebas)",
                    IDLE_UNLOAD_ENV, secs
                );
                return Some(Duration::from_secs(secs));
            }
            Err(_) => warn!("[stt-idle] {} inválido: {:?}, se ignora", IDLE_UNLOAD_ENV, raw),
        }
    }
    idle_unload_after(&HardwareProfile::detect().performance_tier)
}

/// Entradas de la decisión de descarga en un tick.
#[derive(Debug, Clone, Copy)]
pub(crate) struct UnloadInputs {
    /// Cuánto lleva la grabación en fase `Idle` de forma continua.
    pub idle_for: Duration,
    /// `true` si `now` cae dentro de una ventana de jornada habilitada.
    pub in_window: bool,
    /// Tiempo hasta el próximo arranque de ventana, si hay alguno.
    pub next_window_in: Option<Duration>,
    pub has_session: bool,
    pub model_loaded: bool,
    /// Nivel de presión de memoria del sampler (#22). Con `Elevated+` el
    /// reposo no espera el umbral: soltar los ~600 MB del motor es la acción
    /// más barata disponible.
    pub pressure: PressureLevel,
}

/// ¿Toca descargar? Sólo con umbral (tier Low), modelo cargado, sesión viva
/// (sin sesión ya decidió `clear_current_user`), fuera de ventana, con el
/// reposo cumplido — o presión de memoria `Elevated+` (#22), que no espera el
/// umbral — y sin una ventana a menos de `PREWARM_LEAD`.
pub(crate) fn should_unload(threshold: Option<Duration>, i: &UnloadInputs) -> bool {
    let Some(threshold) = threshold else {
        return false;
    };
    i.model_loaded
        && i.has_session
        && !i.in_window
        && (i.idle_for >= threshold || i.pressure >= PressureLevel::Elevated)
        && i.next_window_in.map_or(true, |d| d > PREWARM_LEAD)
}

/// ¿Toca pre-calentar? Modelo fuera de RAM, sesión viva y una ventana a menos
/// de `PREWARM_LEAD`. El latch (`last_attempt_for` == `next_start`) garantiza
/// UN intento por ventana: si el modelo no está en disco no se reintenta cada
/// 60 s (`download_complete` ya dispara la carga cuando llegue).
pub(crate) fn should_prewarm(
    next_window_in: Option<Duration>,
    next_start: Option<NaiveDateTime>,
    last_attempt_for: Option<NaiveDateTime>,
    has_session: bool,
    model_loaded: bool,
) -> bool {
    if model_loaded || !has_session {
        return false;
    }
    let Some(d) = next_window_in else {
        return false;
    };
    d <= PREWARM_LEAD && next_start.is_some() && last_attempt_for != next_start
}

/// `(en ventana ahora, próximo arranque de ventana)`. Sin servicio o con la
/// jornada deshabilitada no hay ventanas: `(false, None)`.
pub(crate) fn window_context(
    now: NaiveDateTime,
    settings: Option<&ScheduledRecordingSettings>,
) -> (bool, Option<NaiveDateTime>) {
    match settings {
        Some(s) if s.enabled => (
            schedule::active_window_at(now, s).is_some(),
            schedule::next_fire_at(now, s),
        ),
        _ => (false, None),
    }
}

pub fn spawn<R: Runtime>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        run(app).await;
    });
}

async fn run<R: Runtime>(app: AppHandle<R>) {
    tokio::time::sleep(STARTUP_DELAY).await;
    let Some(threshold) = effective_threshold() else {
        info!(
            "[stt-idle] tier {} sin descarga en reposo: el motor sólo se suelta en logout",
            HardwareProfile::detect().performance_tier.as_str()
        );
        return;
    };
    info!(
        "[stt-idle] descarga en reposo activa: umbral {:?}, prewarm {:?} antes de la jornada",
        threshold, PREWARM_LEAD
    );

    let mut idle_since: Option<Instant> = None;
    let mut prewarm_attempted_for: Option<NaiveDateTime> = None;
    loop {
        tick_once(&app, threshold, &mut idle_since, &mut prewarm_attempted_for).await;
        tokio::time::sleep(TICK).await;
    }
}

/// Settings vivos del scheduler (memoria, no disco). `get_settings` clona bajo
/// un `read()` corto sin cruzar awaits: respeta el contrato de locks de
/// `SchedulerShared`. Sin servicio manejado → `None` (sin ventanas).
async fn live_schedule_settings<R: Runtime>(app: &AppHandle<R>) -> Option<ScheduledRecordingSettings> {
    let state = app.try_state::<ScheduledRecordingState>()?;
    let service = state.read().await;
    Some(service.get_settings().await)
}

async fn tick_once<R: Runtime>(
    app: &AppHandle<R>,
    threshold: Duration,
    idle_since: &mut Option<Instant>,
    prewarm_attempted_for: &mut Option<NaiveDateTime>,
) {
    let phase = recording_phase::current_phase();
    if phase != RecordingPhase::Idle {
        *idle_since = None;
        return;
    }
    let idle_for = idle_since.get_or_insert_with(Instant::now).elapsed();

    let has_session = crate::state::has_session(app).await;
    let model_loaded = any_local_engine_loaded().await;
    let now = Local::now().naive_local();
    let settings = live_schedule_settings(app).await;
    let (in_window, next_start) = window_context(now, settings.as_ref());
    let next_window_in = next_start.and_then(|s| (s - now).to_std().ok());

    if should_prewarm(next_window_in, next_start, *prewarm_attempted_for, has_session, model_loaded) {
        *prewarm_attempted_for = next_start;
        match ensure_stt_warm(app, "prewarm").await {
            Ok(WarmOutcome::Loaded { elapsed, .. }) => {
                info!("[stt-idle] prewarm de jornada: motor cargado en {:?}", elapsed)
            }
            Ok(other) => info!("[stt-idle] prewarm sin carga: {:?}", other),
            Err(e) => warn!("[stt-idle] prewarm falló: {}", e),
        }
        return;
    }

    let inputs = UnloadInputs {
        idle_for,
        in_window,
        next_window_in,
        has_session,
        model_loaded,
        pressure: crate::logging::mem_sampler::pressure_level(),
    };
    if should_unload(Some(threshold), &inputs) {
        match unload_stt(app, "idle").await {
            UnloadOutcome::Unloaded(list) => {
                info!("[stt-idle] motor descargado tras {:?} en reposo: {:?}", idle_for, list)
            }
            UnloadOutcome::NothingLoaded => {}
            UnloadOutcome::RefusedPhase(p) => {
                // La fase cambió entre el check de arriba y el lock: se reintenta
                // en el siguiente tick, sin contar el reposo desde cero.
                info!("[stt-idle] descarga pospuesta: fase {:?}", p)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    fn dt(y: i32, m: u32, d: u32, h: u32, min: u32) -> NaiveDateTime {
        NaiveDate::from_ymd_opt(y, m, d)
            .unwrap()
            .and_hms_opt(h, min, 0)
            .unwrap()
    }

    fn mins(m: u64) -> Duration {
        Duration::from_secs(m * 60)
    }

    fn inputs() -> UnloadInputs {
        UnloadInputs {
            idle_for: mins(30),
            in_window: false,
            next_window_in: None,
            has_session: true,
            model_loaded: true,
            pressure: PressureLevel::Normal,
        }
    }

    #[test]
    fn solo_tier_low_descarga_en_reposo() {
        assert_eq!(idle_unload_after(&PerformanceTier::Low), Some(IDLE_UNLOAD_AFTER_LOW));
        for tier in [PerformanceTier::Medium, PerformanceTier::High, PerformanceTier::Ultra] {
            assert_eq!(idle_unload_after(&tier), None, "{:?}", tier);
        }
    }

    #[test]
    fn should_unload_tabla() {
        let t = Some(mins(10));
        let casos: [(&str, Option<Duration>, UnloadInputs, bool); 13] = [
            ("caso base", t, inputs(), true),
            ("sin umbral (tier alto)", None, inputs(), false),
            ("en ventana", t, UnloadInputs { in_window: true, ..inputs() }, false),
            ("ventana a 3 min", t, UnloadInputs { next_window_in: Some(mins(3)), ..inputs() }, false),
            ("ventana a 6 min", t, UnloadInputs { next_window_in: Some(mins(6)), ..inputs() }, true),
            ("reposo 9 min", t, UnloadInputs { idle_for: mins(9), ..inputs() }, false),
            ("reposo 10 min exactos", t, UnloadInputs { idle_for: mins(10), ..inputs() }, true),
            ("sin sesión", t, UnloadInputs { has_session: false, ..inputs() }, false),
            ("modelo no cargado", t, UnloadInputs { model_loaded: false, ..inputs() }, false),
            // #22: presión Elevated+ no espera el umbral de reposo…
            (
                "presión Elevated con reposo 1 min",
                t,
                UnloadInputs { idle_for: mins(1), pressure: PressureLevel::Elevated, ..inputs() },
                true,
            ),
            (
                "presión Critical con reposo 0",
                t,
                UnloadInputs { idle_for: mins(0), pressure: PressureLevel::Critical, ..inputs() },
                true,
            ),
            // …pero no puentea los otros guards.
            (
                "presión sin umbral (tier alto): la tarea ni corre",
                None,
                UnloadInputs { pressure: PressureLevel::Critical, ..inputs() },
                false,
            ),
            (
                "presión con ventana a 3 min: el prewarm lo recargaría",
                t,
                UnloadInputs {
                    idle_for: mins(1),
                    next_window_in: Some(mins(3)),
                    pressure: PressureLevel::Elevated,
                    ..inputs()
                },
                false,
            ),
        ];
        for (nombre, threshold, i, esperado) in casos {
            assert_eq!(should_unload(threshold, &i), esperado, "{}", nombre);
        }
    }

    #[test]
    fn should_prewarm_tabla_y_latch() {
        let start = Some(dt(2026, 6, 29, 9, 0));
        // Dentro del lead, sin intento previo → sí.
        assert!(should_prewarm(Some(mins(4)), start, None, true, false));
        // Latch: ya se intentó para ESTA ventana → no.
        assert!(!should_prewarm(Some(mins(4)), start, start, true, false));
        // Latch de otra ventana no bloquea.
        assert!(should_prewarm(Some(mins(4)), start, Some(dt(2026, 6, 28, 9, 0)), true, false));
        // Fuera del lead → no.
        assert!(!should_prewarm(Some(mins(6)), start, None, true, false));
        // Sin ventana → no.
        assert!(!should_prewarm(None, None, None, true, false));
        // Ya cargado o sin sesión → no.
        assert!(!should_prewarm(Some(mins(1)), start, None, true, true));
        assert!(!should_prewarm(Some(mins(1)), start, None, false, false));
    }

    #[test]
    fn window_context_tabla() {
        // 2026-06-29 es LUNES; default = Lun-Vie 09:00-18:00.
        let mut s = ScheduledRecordingSettings::default();
        assert_eq!(window_context(dt(2026, 6, 29, 12, 0), None), (false, None), "sin servicio");
        assert_eq!(
            window_context(dt(2026, 6, 29, 12, 0), Some(&s)),
            (false, None),
            "jornada deshabilitada"
        );
        s.enabled = true;
        let (in_w, next) = window_context(dt(2026, 6, 29, 12, 0), Some(&s));
        assert!(in_w, "dentro de ventana");
        assert_eq!(next, Some(dt(2026, 6, 30, 9, 0)), "la próxima es mañana");
        let (in_w, next) = window_context(dt(2026, 6, 29, 8, 30), Some(&s));
        assert!(!in_w, "antes de ventana");
        assert_eq!(next, Some(dt(2026, 6, 29, 9, 0)));
        s.windows.clear();
        assert_eq!(window_context(dt(2026, 6, 29, 8, 30), Some(&s)), (false, None), "sin ventanas");
    }
}
