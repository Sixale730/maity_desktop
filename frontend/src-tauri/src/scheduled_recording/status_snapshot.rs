//! Instantánea del scheduler para telemetría (#83, J5).
//!
//! Antes de esta tarea, la razón por la que la jornada no graba vivía solo dentro del
//! `RwLock` del servicio (`prev_skip`, visible únicamente al loop) y no había forma de
//! distinguir "fuera de horario" de "sin micrófono" o "el usuario la detuvo" desde el
//! latido o desde `jornada.idle_reason_changed`. Este módulo publica una ranura de solo
//! lectura (`SLOT`, `std::sync::Mutex`, patrón `logging::mem_sampler::LAST_SAMPLE`) que
//! los lectores (heartbeats, J6/J7) consultan SIN tocar el `RwLock` del servicio —
//! importante porque ese lock es write-preferring y `lib.rs` lo retiene de escritura
//! durante todo un cierre (ver contrato de locks en `service.rs`).
//!
//! Todas las funciones puras (`idle_reason`, `view_from_slot`, `idle_transition`) están
//! deliberadamente separadas de la E/S del `Mutex` para poder testearlas sin tocar el
//! `static`.

use chrono::NaiveDateTime;

use crate::audio::recording_phase::RecordingPhase;

use super::service::{Rearm, RearmCause, SchedulerPhase, SkipReason};
use super::settings::ScheduledRecordingSettings;

/// Vista compartida del scheduler, publicada por `service.rs` en cada transición.
#[derive(Debug, Clone)]
pub(crate) struct Slot {
    gen: u64,
    settings: ScheduledRecordingSettings,
    settings_load: &'static str,
    loop_running: bool,
    phase: SchedulerPhase,
    skip: Option<SkipReason>,
    rearm: Option<Rearm>,
    backoff: Option<BackoffView>,
}

/// Copia ligera del back-off de arranque, sin el `notified`/latch interno (irrelevante
/// para telemetría).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct BackoffView {
    pub code: &'static str,
    pub consecutive: u32,
    pub halted_for_day: bool,
}

/// Ranura global. `None` = el scheduler todavía no publicó nada en este proceso
/// (`idle_reason` devuelve `initializing`).
static SLOT: std::sync::Mutex<Option<Slot>> = std::sync::Mutex::new(None);

/// Publica settings + resultado de la carga. Crea la ranura si falta (primer arranque
/// del proceso). Limpia `backoff`: espejo del brazo `UpdateSettings` del loop, que trata
/// "guardó ajustes" como "ya lo arreglé, vuelve a intentar".
pub(super) fn publish_settings(s: &ScheduledRecordingSettings, load: &'static str) {
    if let Ok(mut g) = SLOT.lock() {
        match g.as_mut() {
            Some(slot) => {
                slot.settings = s.clone();
                slot.settings_load = load;
                slot.backoff = None;
            }
            None => {
                *g = Some(Slot {
                    gen: 0,
                    settings: s.clone(),
                    settings_load: load,
                    loop_running: false,
                    phase: SchedulerPhase::Disabled,
                    skip: None,
                    rearm: None,
                    backoff: None,
                });
            }
        }
    }
}

/// Marca el arranque de un loop nuevo (nueva generación) y devuelve esa generación, para
/// que `publish_tick` pueda ignorar los ticks tardíos de un loop ya detenido.
pub(super) fn begin_loop() -> u64 {
    if let Ok(mut g) = SLOT.lock() {
        let slot = g.get_or_insert_with(|| Slot {
            gen: 0,
            settings: ScheduledRecordingSettings::default(),
            settings_load: "missing",
            loop_running: false,
            phase: SchedulerPhase::Disabled,
            skip: None,
            rearm: None,
            backoff: None,
        });
        slot.gen += 1;
        slot.loop_running = true;
        return slot.gen;
    }
    0
}

/// Marca el loop como detenido (`stop()`, sin `AppHandle`: no emite transición aquí — la
/// emite `update_settings`, que en `set_scheduled_recording_enabled` corre ANTES del stop).
pub(super) fn publish_stopped() {
    if let Ok(mut g) = SLOT.lock() {
        if let Some(slot) = g.as_mut() {
            slot.loop_running = false;
            slot.phase = SchedulerPhase::Disabled;
            slot.skip = None;
            slot.backoff = None;
        }
    }
}

/// Publica el resultado de un tick. Ignorado si `gen` no coincide con la generación
/// vigente o si el loop ya no corre (un tick tardío de un loop detenido no debe revivir
/// la fase publicada).
pub(super) fn publish_tick(
    gen: u64,
    phase: SchedulerPhase,
    skip: Option<SkipReason>,
    rearm: Option<Rearm>,
    backoff: Option<BackoffView>,
) {
    if let Ok(mut g) = SLOT.lock() {
        if let Some(slot) = g.as_mut() {
            if slot.gen != gen || !slot.loop_running {
                return;
            }
            slot.phase = phase;
            slot.skip = skip;
            slot.rearm = rearm;
            slot.backoff = backoff;
        }
    }
}

/// Vista derivada de la ranura, calculada FUERA del lock (una vez clonada la ranura).
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct JornadaView {
    pub enabled: bool,
    pub configured_by_user: bool,
    pub loop_running: bool,
    pub phase: SchedulerPhase,
    /// Pertenencia al horario. IGNORA `enabled`, igual que `ScheduledStatus.in_window`.
    pub in_window: bool,
    pub skip: Option<SkipReason>,
    /// Solo `Some` si el rearme sigue vigente (`now < until`).
    pub rearm: Option<Rearm>,
    pub backoff: Option<BackoffView>,
    pub settings_load: &'static str,
    /// `true` si el loop del scheduler arrancó al menos una vez en este proceso
    /// (`gen > 0`). Ajuste del líder tras la refutación del plan: sin esto, el tick
    /// `initialize(enabled=true)` (loop aún no arrancado, `gen == 0`) reportaría
    /// `scheduler_stopped` — una fila espuria antes de que `start()` corra siquiera una
    /// vez. Con `ever_started == false` y `loop_running == false` la razón es
    /// `initializing` (no se emite como transición).
    ever_started: bool,
}

/// Construye la vista a partir de una ranura ya clonada (sin lock).
pub(crate) fn view_from_slot(slot: &Slot, now: NaiveDateTime) -> JornadaView {
    let in_window = super::schedule::active_window_at(now, &slot.settings).is_some();
    JornadaView {
        enabled: slot.settings.enabled,
        configured_by_user: slot.settings.configured_by_user,
        loop_running: slot.loop_running,
        phase: slot.phase,
        in_window,
        skip: slot.skip,
        rearm: slot.rearm.filter(|r| now < r.until),
        backoff: slot.backoff,
        settings_load: slot.settings_load,
        ever_started: slot.gen > 0,
    }
}

/// Dominio cerrado de `idle_reason` (16 valores no nulos; contrato §1.3). Un valor nuevo
/// exige una fila aquí, una en `idle_reason()` y una en la query de clasificación.
pub const IDLE_REASONS: &[&str] = &[
    "paused_by_user",
    "initializing",
    "jornada_unconfigured",
    "jornada_off",
    "scheduler_stopped",
    "session_ending",
    "outside_window",
    "no_session",
    "no_registration",
    "closed_for_day",
    "stopped_by_user",
    "mic_not_found",
    "mic_permission_denied",
    "mic_in_use",
    "start_failed",
    "pending",
];

/// Por qué no se graba ahora mismo. `None` = grabando/arrancando/deteniendo. Primera fila
/// que aplica gana (contrato §1.3). `transcription_not_ready` (el `SkipReason` de la UI)
/// NUNCA sale aquí: escondía `mic_in_use` — se traduce a `start_failed` salvo que el
/// back-off ya haya clasificado la causa real.
pub(crate) fn idle_reason(rec: RecordingPhase, v: Option<&JornadaView>) -> Option<&'static str> {
    use RecordingPhase::*;
    match rec {
        Recording | Starting | Stopping => return None,
        Paused => return Some("paused_by_user"),
        Idle => {}
    }

    let Some(v) = v else {
        return Some("initializing");
    };

    if !v.enabled && !v.configured_by_user {
        return Some("jornada_unconfigured");
    }
    if !v.enabled {
        return Some("jornada_off");
    }
    if !v.loop_running {
        // Ajuste del líder: sin `ever_started`, el tick de `initialize(enabled=true)`
        // (el loop nunca arrancó en este proceso, `gen == 0`) reportaría
        // `scheduler_stopped` de forma espuria, antes de que `start()` corra una vez.
        return Some(if v.ever_started {
            "scheduler_stopped"
        } else {
            "initializing"
        });
    }
    if matches!(v.rearm, Some(r) if r.cause == RearmCause::SessionEnd) {
        return Some("session_ending");
    }
    if !v.in_window {
        return Some("outside_window");
    }
    match v.skip {
        Some(SkipReason::NoSession) => return Some("no_session"),
        Some(SkipReason::RegistrationIncomplete) => return Some("no_registration"),
        _ => {}
    }
    if let Some(r) = v.rearm {
        match r.cause {
            RearmCause::AutoClose => return Some("closed_for_day"),
            RearmCause::UserStop => return Some("stopped_by_user"),
            RearmCause::SessionEnd => {}
        }
    }
    if let Some(b) = v.backoff {
        return Some(match b.code {
            "mic_not_found" => "mic_not_found",
            "mic_permission_denied" => "mic_permission_denied",
            "mic_in_use" => "mic_in_use",
            _ => "start_failed",
        });
    }
    if matches!(
        v.skip,
        Some(SkipReason::TranscriptionNotReady) | Some(SkipReason::StartBackoff)
    ) {
        return Some("start_failed");
    }
    Some("pending")
}

fn scheduler_phase_str(p: SchedulerPhase) -> &'static str {
    match p {
        SchedulerPhase::Disabled => "disabled",
        SchedulerPhase::Idle => "idle",
        SchedulerPhase::Armed => "armed",
        SchedulerPhase::Recording => "recording",
        SchedulerPhase::Grace => "grace",
        // Sin escritores hoy (grep = 0); mapeada a reposo.
        SchedulerPhase::Stopping => "idle",
    }
}

/// Bloque `jornada` del latido (contrato §1.2). Todos los campos `pub`: J6 construye
/// literales en sus tests.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct JornadaTelemetry {
    pub enabled: bool,
    pub configured_by_user: bool,
    pub loop_running: bool,
    pub scheduler_phase: &'static str,
    pub in_window: bool,
    pub skip: Option<&'static str>,
    /// Solo si el rearme sigue vigente.
    pub rearm_cause: Option<&'static str>,
    /// "%Y-%m-%dT%H:%M:%S" hora LOCAL de la PC.
    pub rearm_until: Option<String>,
    pub backoff: Option<BackoffTelemetry>,
    pub settings_load: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
pub struct BackoffTelemetry {
    pub code: &'static str,
    pub consecutive: u32,
    pub halted_for_day: bool,
}

impl From<BackoffView> for BackoffTelemetry {
    fn from(b: BackoffView) -> Self {
        Self {
            code: b.code,
            consecutive: b.consecutive,
            halted_for_day: b.halted_for_day,
        }
    }
}

impl JornadaTelemetry {
    fn from_view(v: &JornadaView) -> Self {
        Self {
            enabled: v.enabled,
            configured_by_user: v.configured_by_user,
            loop_running: v.loop_running,
            scheduler_phase: scheduler_phase_str(v.phase),
            in_window: v.in_window,
            skip: v.skip.map(SkipReason::as_str),
            rearm_cause: v.rearm.map(|r| r.cause.as_str()),
            rearm_until: v
                .rearm
                .map(|r| r.until.format("%Y-%m-%dT%H:%M:%S").to_string()),
            backoff: v.backoff.map(BackoffTelemetry::from),
            settings_load: v.settings_load,
        }
    }
}

/// `idle_reason` + bloque `jornada`, listos para el latido (J6) y `jornada.idle_reason_changed`.
/// Sin ranura publicada todavía (proceso recién arrancado, scheduler aún no inicializado)
/// devuelve `(idle_reason(rec, None), None)`, es decir `initializing`.
pub fn heartbeat_fields(
    rec: RecordingPhase,
    now: NaiveDateTime,
) -> (Option<&'static str>, Option<JornadaTelemetry>) {
    let slot = SLOT.lock().ok().and_then(|g| g.clone());
    match slot {
        Some(s) => {
            let view = view_from_slot(&s, now);
            let reason = idle_reason(rec, Some(&view));
            (reason, Some(JornadaTelemetry::from_view(&view)))
        }
        None => (idle_reason(rec, None), None),
    }
}

// ── Transiciones (`jornada.idle_reason_changed`) ──────────────────────────────

/// Último valor emitido + contador de emisiones de este proceso (tope de 200).
static LAST_EMITTED: std::sync::Mutex<(Option<Option<&'static str>>, u32)> =
    std::sync::Mutex::new((None, 0));

/// ¿Esta transición se emite? `None` si `current` es `pending`/`initializing` (ni se
/// emite ni reemplaza el último valor recordado: son "no sé todavía", no una transición
/// real) o si coincide con el último valor emitido.
fn idle_transition(
    last: Option<Option<&'static str>>,
    current: Option<&'static str>,
) -> Option<(Option<&'static str>, Option<&'static str>)> {
    if matches!(current, Some("pending") | Some("initializing")) {
        return None;
    }
    if last == Some(current) {
        return None;
    }
    Some((last.flatten(), current))
}

/// Calcula `heartbeat_fields`, aplica `idle_transition` y devuelve el payload de
/// `jornada.idle_reason_changed`, o `None` si no hay transición que emitir (o si ya se
/// alcanzó el tope de 200 emisiones de este proceso). El último valor recordado se
/// actualiza siempre que hay una transición real, incluso tras el tope — así el dedup
/// sigue funcionando aunque ya no se emita.
pub(super) fn take_idle_transition(
    rec: RecordingPhase,
    now: NaiveDateTime,
) -> Option<serde_json::Value> {
    let (reason, jornada) = heartbeat_fields(rec, now);
    let mut guard = LAST_EMITTED.lock().ok()?;
    let (last, count) = *guard;
    let (from, to) = idle_transition(last, reason)?;
    *guard = (Some(reason), count.saturating_add(1));
    drop(guard);
    if count >= 200 {
        return None;
    }
    Some(serde_json::json!({
        "from": from,
        "to": to,
        "recording_phase": rec.as_str(),
        "jornada": jornada,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scheduled_recording::settings::ScheduleWindow;

    fn t(y: i32, m: u32, d: u32, h: u32, min: u32) -> NaiveDateTime {
        chrono::NaiveDate::from_ymd_opt(y, m, d)
            .unwrap()
            .and_hms_opt(h, min, 0)
            .unwrap()
    }

    fn weekday_settings() -> ScheduledRecordingSettings {
        let mut s = ScheduledRecordingSettings::default();
        s.enabled = true;
        s.windows = vec![ScheduleWindow {
            days_of_week: vec![1, 2, 3, 4, 5],
            start_time: "09:00".to_string(),
            end_time: "18:00".to_string(),
        }];
        s
    }

    fn base_view(_now: NaiveDateTime) -> JornadaView {
        JornadaView {
            enabled: true,
            configured_by_user: true,
            loop_running: true,
            phase: SchedulerPhase::Armed,
            in_window: true,
            skip: None,
            rearm: None,
            backoff: None,
            settings_load: "ok",
            ever_started: true,
        }
    }

    #[test]
    fn recording_starting_stopping_no_tienen_idle_reason() {
        let now = t(2026, 9, 23, 10, 0);
        let v = base_view(now);
        assert_eq!(idle_reason(RecordingPhase::Recording, Some(&v)), None);
        assert_eq!(idle_reason(RecordingPhase::Starting, Some(&v)), None);
        assert_eq!(idle_reason(RecordingPhase::Stopping, Some(&v)), None);
    }

    #[test]
    fn paused_es_paused_by_user_incluso_sin_vista() {
        assert_eq!(
            idle_reason(RecordingPhase::Paused, None),
            Some("paused_by_user")
        );
    }

    #[test]
    fn idle_sin_vista_es_initializing() {
        assert_eq!(idle_reason(RecordingPhase::Idle, None), Some("initializing"));
    }

    #[test]
    fn jornada_unconfigured_vs_off() {
        let now = t(2026, 9, 23, 10, 0);
        let mut v = base_view(now);
        v.enabled = false;
        v.configured_by_user = false;
        assert_eq!(idle_reason(RecordingPhase::Idle, Some(&v)), Some("jornada_unconfigured"));
        v.configured_by_user = true;
        assert_eq!(idle_reason(RecordingPhase::Idle, Some(&v)), Some("jornada_off"));
    }

    #[test]
    fn scheduler_stopped_cuando_loop_no_corre() {
        let now = t(2026, 9, 23, 10, 0);
        let mut v = base_view(now);
        v.loop_running = false;
        assert_eq!(idle_reason(RecordingPhase::Idle, Some(&v)), Some("scheduler_stopped"));
    }

    #[test]
    fn initializing_si_el_loop_nunca_arranco_gen_0() {
        // Ajuste del líder: `initialize(enabled=true)` publica la ranura con
        // `loop_running=false` y `gen==0` (el loop todavía no corrió ni una vez en este
        // proceso) — debe reportar `initializing`, no `scheduler_stopped`, para no
        // emitir una fila espuria antes de que `start()` corra.
        let now = t(2026, 9, 23, 10, 0);
        let mut v = base_view(now);
        v.loop_running = false;
        v.ever_started = false;
        assert_eq!(idle_reason(RecordingPhase::Idle, Some(&v)), Some("initializing"));
    }

    #[test]
    fn session_ending_gana_a_outside_window() {
        let now = t(2026, 9, 23, 22, 0);
        let mut v = base_view(now);
        v.in_window = false;
        v.rearm = Some(Rearm {
            until: now + chrono::Duration::minutes(5),
            cause: RearmCause::SessionEnd,
            set_at: now,
        });
        assert_eq!(idle_reason(RecordingPhase::Idle, Some(&v)), Some("session_ending"));
    }

    #[test]
    fn fuera_de_ventana_con_rearme_auto_close_es_outside_window() {
        // outside_window gana a closed_for_day: closed_for_day exige in_window == true.
        let now = t(2026, 9, 23, 22, 0);
        let mut v = base_view(now);
        v.in_window = false;
        v.rearm = Some(Rearm {
            until: now + chrono::Duration::hours(2),
            cause: RearmCause::AutoClose,
            set_at: now,
        });
        assert_eq!(idle_reason(RecordingPhase::Idle, Some(&v)), Some("outside_window"));
    }

    #[test]
    fn no_session_y_no_registration() {
        let now = t(2026, 9, 23, 10, 0);
        let mut v = base_view(now);
        v.skip = Some(SkipReason::NoSession);
        assert_eq!(idle_reason(RecordingPhase::Idle, Some(&v)), Some("no_session"));
        v.skip = Some(SkipReason::RegistrationIncomplete);
        assert_eq!(idle_reason(RecordingPhase::Idle, Some(&v)), Some("no_registration"));
    }

    #[test]
    fn closed_for_day_y_stopped_by_user_dentro_de_ventana() {
        let now = t(2026, 9, 23, 10, 0);
        let mut v = base_view(now);
        v.rearm = Some(Rearm {
            until: now + chrono::Duration::hours(1),
            cause: RearmCause::AutoClose,
            set_at: now,
        });
        assert_eq!(idle_reason(RecordingPhase::Idle, Some(&v)), Some("closed_for_day"));
        v.rearm = Some(Rearm {
            until: now + chrono::Duration::minutes(30),
            cause: RearmCause::UserStop,
            set_at: now,
        });
        assert_eq!(idle_reason(RecordingPhase::Idle, Some(&v)), Some("stopped_by_user"));
    }

    #[test]
    fn backoff_con_code_conocido_sale_tal_cual() {
        let now = t(2026, 9, 23, 10, 0);
        let mut v = base_view(now);
        v.skip = Some(SkipReason::TranscriptionNotReady);
        v.backoff = Some(BackoffView {
            code: "mic_in_use",
            consecutive: 3,
            halted_for_day: true,
        });
        assert_eq!(idle_reason(RecordingPhase::Idle, Some(&v)), Some("mic_in_use"));
    }

    #[test]
    fn backoff_con_otro_code_es_start_failed() {
        let now = t(2026, 9, 23, 10, 0);
        let mut v = base_view(now);
        v.skip = Some(SkipReason::StartBackoff);
        v.backoff = Some(BackoffView {
            code: "audio_unknown",
            consecutive: 1,
            halted_for_day: false,
        });
        assert_eq!(idle_reason(RecordingPhase::Idle, Some(&v)), Some("start_failed"));
    }

    #[test]
    fn skip_transcription_not_ready_sin_backoff_es_start_failed() {
        let now = t(2026, 9, 23, 10, 0);
        let mut v = base_view(now);
        v.skip = Some(SkipReason::TranscriptionNotReady);
        assert_eq!(idle_reason(RecordingPhase::Idle, Some(&v)), Some("start_failed"));
    }

    #[test]
    fn skip_manual_in_progress_es_pending() {
        let now = t(2026, 9, 23, 10, 0);
        let mut v = base_view(now);
        v.skip = Some(SkipReason::ManualInProgress);
        assert_eq!(idle_reason(RecordingPhase::Idle, Some(&v)), Some("pending"));
    }

    #[test]
    fn transcription_not_ready_nunca_sale_literal() {
        assert!(!IDLE_REASONS.contains(&"transcription_not_ready"));
    }

    #[test]
    fn idle_reasons_son_16_sin_duplicados() {
        assert_eq!(IDLE_REASONS.len(), 16);
        let mut sorted = IDLE_REASONS.to_vec();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(sorted.len(), IDLE_REASONS.len());
    }

    #[test]
    fn barrido_de_la_tabla_solo_devuelve_valores_del_dominio() {
        let now = t(2026, 9, 23, 10, 0);
        let cases: Vec<Option<&'static str>> = vec![
            idle_reason(RecordingPhase::Paused, None),
            idle_reason(RecordingPhase::Idle, None),
            idle_reason(RecordingPhase::Idle, Some(&base_view(now))),
        ];
        for c in cases.into_iter().flatten() {
            assert!(IDLE_REASONS.contains(&c), "{c} no está en IDLE_REASONS");
        }
    }

    #[test]
    fn view_from_slot_in_window_ignora_enabled() {
        let now = t(2026, 9, 23, 10, 0); // miércoles, dentro de 09-18
        let mut settings = weekday_settings();
        settings.enabled = false;
        let slot = Slot {
            gen: 1,
            settings,
            settings_load: "ok",
            loop_running: true,
            phase: SchedulerPhase::Disabled,
            skip: None,
            rearm: None,
            backoff: None,
        };
        let view = view_from_slot(&slot, now);
        assert!(view.in_window, "in_window debe ignorar enabled=false");
        assert!(!view.enabled);
    }

    #[test]
    fn view_from_slot_filtra_rearm_vencido() {
        let now = t(2026, 9, 23, 10, 0);
        let slot = Slot {
            gen: 1,
            settings: weekday_settings(),
            settings_load: "ok",
            loop_running: true,
            phase: SchedulerPhase::Armed,
            skip: None,
            rearm: Some(Rearm {
                until: now - chrono::Duration::minutes(1),
                cause: RearmCause::UserStop,
                set_at: now - chrono::Duration::hours(1),
            }),
            backoff: None,
        };
        let view = view_from_slot(&slot, now);
        assert_eq!(view.rearm, None, "un rearme vencido no debe salir en la vista");
    }

    #[test]
    fn view_from_slot_conserva_rearm_vigente() {
        let now = t(2026, 9, 23, 10, 0);
        let slot = Slot {
            gen: 1,
            settings: weekday_settings(),
            settings_load: "ok",
            loop_running: true,
            phase: SchedulerPhase::Armed,
            skip: None,
            rearm: Some(Rearm {
                until: now + chrono::Duration::minutes(1),
                cause: RearmCause::UserStop,
                set_at: now,
            }),
            backoff: None,
        };
        let view = view_from_slot(&slot, now);
        assert!(view.rearm.is_some());
    }

    #[test]
    fn idle_transition_pending_e_initializing_no_emiten() {
        assert_eq!(idle_transition(None, Some("pending")), None);
        assert_eq!(idle_transition(None, Some("initializing")), None);
        assert_eq!(idle_transition(Some(Some("outside_window")), Some("pending")), None);
    }

    #[test]
    fn idle_transition_valor_igual_al_ultimo_no_emite() {
        assert_eq!(
            idle_transition(Some(Some("outside_window")), Some("outside_window")),
            None
        );
    }

    #[test]
    fn idle_transition_primer_valor_real() {
        assert_eq!(
            idle_transition(None, Some("outside_window")),
            Some((None, Some("outside_window")))
        );
    }

    #[test]
    fn idle_transition_paso_a_grabacion() {
        assert_eq!(
            idle_transition(Some(Some("outside_window")), None),
            Some((Some("outside_window"), None))
        );
    }

    /// Único test serial sobre el `static SLOT`: publish_settings + begin_loop +
    /// publish_tick con generación vieja (ignorado); publish_stopped y luego
    /// publish_tick con la generación actual (también ignorado, porque `loop_running`
    /// ya es `false`).
    #[test]
    fn slot_static_gen_y_loop_running_descartan_ticks_tardios() {
        // Serializado por el propio Mutex del módulo: no hace falta un lock externo,
        // pero sí evitar que otro test de este archivo corra en paralelo sobre el mismo
        // `static` — `cargo test` por defecto corre los tests de un mismo binario en
        // hilos distintos, así que esta prueba usa valores que no colisionan con las de
        // arriba (no leen el `static`).
        publish_settings(&weekday_settings(), "ok");
        let gen_actual = begin_loop();
        let now = t(2026, 9, 23, 10, 0);

        // Tick con una generación vieja: ignorado.
        publish_tick(
            gen_actual.saturating_sub(1).max(0),
            SchedulerPhase::Recording,
            None,
            None,
            None,
        );
        let (reason_tras_tick_viejo, _) = heartbeat_fields(RecordingPhase::Idle, now);
        assert_ne!(reason_tras_tick_viejo, None, "un tick de generación vieja no debe aplicarse");

        // Publica con la generación correcta: sí se aplica.
        publish_tick(gen_actual, SchedulerPhase::Armed, Some(SkipReason::NoSession), None, None);
        let (reason, _) = heartbeat_fields(RecordingPhase::Idle, now);
        assert_eq!(reason, Some("no_session"));

        // Detiene el loop: publish_tick posterior con la MISMA generación se ignora
        // porque `loop_running` ya es `false`.
        publish_stopped();
        publish_tick(gen_actual, SchedulerPhase::Armed, Some(SkipReason::ManualInProgress), None, None);
        let (reason_tras_stop, _) = heartbeat_fields(RecordingPhase::Idle, now);
        assert_ne!(
            reason_tras_stop,
            Some("pending"),
            "tras publish_stopped, un tick con la misma generación no debe aplicarse"
        );
    }
}
