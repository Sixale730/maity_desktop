//! Coach de PONENTE (modo Presentación) — módulo PURO, una sola tabla para
//! los dos modos del coach (audio/lote y transcript/streaming).
//!
//! Decisión de producto (2026-09-11): en una presentación el ponente domina
//! por diseño. Los avisos de conversación (monólogo a los 60/150 s, dominancia)
//! y la penalización del score por monólogo eran ruido: un ponente normal
//! vivía en 50 de "Ritmo" con la aguja en ámbar. Aquí los umbrales son de
//! MINUTOS y el score sólo mide lo que un ponente sí quiere saber:
//!
//! - racha sin respiro > 5 min (`pres_run_long`) y > 10 min
//!   (`pres_run_critical`), **una vez por racha** (el crítico escala dentro de
//!   la misma racha y marca también al largo, como `AudioTipState`);
//! - audiencia callada ≥ 10 min (`pres_audience_silent`), como mucho cada
//!   10 min, y **sólo si la audiencia ya intervino alguna vez** en la sesión
//!   (`audience_seen`): en una ponencia presencial o un webinar mudo el canal
//!   del interlocutor está vacío toda la sesión (las preguntas de la sala
//!   entran por el mic del ponente) y el aviso sería un falso positivo cada
//!   10 min;
//! - Ritmo: 70 base, −10/−20 por racha más larga > 5/10 min, +5 si la
//!   audiencia habló ≥ 10 % (tras 3 min de sesión); rango 50-75. Nada más:
//!   ni dominancia, ni preguntas, ni turnos.
//!
//! Los dos modos construyen una `PresenterView` y delegan aquí: audio con
//! `AudioSnapshot::presenter_view` (reloj de AUDIO del mic, a prueba de
//! pausa/suspend) y transcript con `FeedbackState::presenter_view` (reloj de
//! pared, como el resto de sus métricas). Sin `AppHandle`, sin relojes: se
//! prueba con tablas. La tabla de conversación (`audio_heuristics.rs`,
//! `evaluate_health_tips`) no cambia.

use crate::coach::live_feedback::HeuristicTip;

/// Racha sin respiro a partir de la cual avisa "deja un respiro".
pub(crate) const PRES_RUN_LONG_SECS: u32 = 300;
/// Racha a partir de la cual el aviso escala a crítico.
pub(crate) const PRES_RUN_CRITICAL_SECS: u32 = 600;
/// Silencio de la audiencia (y sesión mínima) para "nadie ha intervenido".
pub(crate) const PRES_AUDIENCE_SILENT_SECS: u32 = 600;
/// El aviso de audiencia se repite como mucho cada 10 min.
pub(crate) const PRES_AUDIENCE_REPEAT_SECS: u32 = 600;
/// Sesión mínima para que la participación de la audiencia sume al Ritmo.
pub(crate) const PRES_HEALTH_MIN_SESSION_SECS: u32 = 180;
/// Participación mínima de la audiencia para el +5. Entero (10 %) en vez de
/// `f32 = 0.10`: `audience * 100 >= total * 10` no tiene frontera flotante.
pub(crate) const PRES_AUDIENCE_SHARE_PCT: u64 = 10;
pub(crate) const PRES_HEALTH_MIN: i32 = 50;
pub(crate) const PRES_HEALTH_MAX: i32 = 75;

pub(crate) const TRIGGER_PRES_RUN_LONG: &str = "pres_run_long";
pub(crate) const TRIGGER_PRES_RUN_CRITICAL: &str = "pres_run_critical";
pub(crate) const TRIGGER_PRES_AUDIENCE_SILENT: &str = "pres_audience_silent";

/// Vista agnóstica del modo. Cada campo lleva el RELOJ del modo que la
/// construye (audio: reloj de audio del mic; transcript: pared), igual que hoy.
#[derive(Debug, Clone, Copy)]
pub(crate) struct PresenterView {
    pub session_secs: u32,
    /// Racha del ponente en curso (0 si no hay).
    pub current_run_secs: u32,
    /// Racha más larga de la sesión (máximo, nunca baja).
    pub longest_run_secs: u32,
    /// Id de racha (≥ 1 cuando hay racha; 0 = ninguna abierta aún).
    pub run_id: u64,
    /// La audiencia ya intervino al menos una vez en la sesión.
    pub audience_seen: bool,
    /// Segundos desde la última intervención de la audiencia; = `session_secs`
    /// si nunca intervino.
    pub audience_silent_secs: u32,
    /// Unidades de participación (audio: ms de voz; transcript: turnos).
    pub audience_units: u64,
    pub total_units: u64,
    pub any_activity: bool,
}

/// Gating de los tips de ponente. Lo muta el caller con `mark` SOLO cuando el
/// tip se emitió de verdad (si `can_emit` lo bloqueó, se reintenta al tick
/// siguiente). Vive en `FeedbackState.presenter_tips`, aparte de
/// `AudioTipState`, porque sirve a los dos modos.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct PresenterTipState {
    /// Racha en la que ya se avisó "5 minutos seguidos".
    run_long_marked: u64,
    /// Racha en la que ya se escaló a crítico.
    run_critical_marked: u64,
    /// Segundo de sesión del último aviso de audiencia callada.
    last_audience_tip_at_sec: Option<u32>,
}

impl PresenterTipState {
    pub(crate) fn mark(&mut self, tip: &HeuristicTip, view: &PresenterView) {
        match tip.trigger {
            TRIGGER_PRES_RUN_CRITICAL => {
                // El crítico cubre también al largo en la misma racha.
                self.run_critical_marked = view.run_id;
                self.run_long_marked = view.run_id;
            }
            TRIGGER_PRES_RUN_LONG => self.run_long_marked = view.run_id,
            TRIGGER_PRES_AUDIENCE_SILENT => {
                self.last_audience_tip_at_sec = Some(view.session_secs)
            }
            _ => {}
        }
    }
}

/// Evalúa la vista y devuelve el primer tip que aplique (uno por tick):
/// racha crítica > racha larga > audiencia callada.
pub(crate) fn evaluate_presenter_tips(
    view: &PresenterView,
    gate: &PresenterTipState,
) -> Option<HeuristicTip> {
    if !view.any_activity {
        return None;
    }

    // (1) Racha > 10 min sin respiro, una vez por racha.
    if view.current_run_secs > PRES_RUN_CRITICAL_SECS && gate.run_critical_marked != view.run_id {
        return Some(HeuristicTip {
            tip: "Diez minutos sin pausa. Para un momento y abre preguntas.",
            category: "pacing",
            priority: "critical",
            trigger: TRIGGER_PRES_RUN_CRITICAL,
        });
    }
    // (2) Racha > 5 min, una vez por racha.
    if view.current_run_secs > PRES_RUN_LONG_SECS && gate.run_long_marked != view.run_id {
        return Some(HeuristicTip {
            tip: "Llevas 5 minutos seguidos. Deja un respiro o lanza una pregunta al público.",
            category: "pacing",
            priority: "important",
            trigger: TRIGGER_PRES_RUN_LONG,
        });
    }
    // (3) Audiencia callada ≥ 10 min, sólo si alguna vez intervino, cada 10 min.
    let repeat_ok = match gate.last_audience_tip_at_sec {
        None => true,
        Some(last) => view.session_secs.saturating_sub(last) >= PRES_AUDIENCE_REPEAT_SECS,
    };
    if view.audience_seen
        && view.session_secs >= PRES_AUDIENCE_SILENT_SECS
        && view.audience_silent_secs >= PRES_AUDIENCE_SILENT_SECS
        && repeat_ok
    {
        return Some(HeuristicTip {
            tip: "Nadie ha intervenido en 10 minutos. Abre un espacio para preguntas.",
            category: "listening",
            priority: "important",
            trigger: TRIGGER_PRES_AUDIENCE_SILENT,
        });
    }
    None
}

/// Ritmo del ponente (0-100 en el gauge, en la práctica 50-75): 70 base;
/// −20 si la racha más larga pasó de 10 min, −10 si pasó de 5; +5 si la
/// audiencia habló ≥ 10 % con sesión ≥ 3 min. Ningún otro término.
pub(crate) fn presenter_health_score(view: &PresenterView) -> u32 {
    let mut s: i32 = 70;
    if view.longest_run_secs > PRES_RUN_CRITICAL_SECS {
        s -= 20;
    } else if view.longest_run_secs > PRES_RUN_LONG_SECS {
        s -= 10;
    }
    if view.session_secs >= PRES_HEALTH_MIN_SESSION_SECS
        && view.total_units > 0
        && view.audience_units * 100 >= view.total_units * PRES_AUDIENCE_SHARE_PCT
    {
        s += 5;
    }
    s.clamp(PRES_HEALTH_MIN, PRES_HEALTH_MAX) as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[allow(clippy::too_many_arguments)]
    fn view(
        session: u32,
        run: u32,
        longest: u32,
        run_id: u64,
        seen: bool,
        silent: u32,
        audience: u64,
        total: u64,
    ) -> PresenterView {
        PresenterView {
            session_secs: session,
            current_run_secs: run,
            longest_run_secs: longest,
            run_id,
            audience_seen: seen,
            audience_silent_secs: silent,
            audience_units: audience,
            total_units: total,
            any_activity: total > 0,
        }
    }

    #[test]
    fn sin_actividad_no_hay_tip() {
        let v = view(900, 700, 700, 1, true, 900, 0, 0);
        assert!(!v.any_activity);
        assert!(evaluate_presenter_tips(&v, &PresenterTipState::default()).is_none());
    }

    #[test]
    fn racha_de_301s_avisa_una_vez_por_racha() {
        let mut gate = PresenterTipState::default();
        let v = view(400, 301, 301, 1, false, 400, 0, 400_000);
        let tip = evaluate_presenter_tips(&v, &gate).expect("301 s seguidos dispara");
        assert_eq!(tip.trigger, TRIGGER_PRES_RUN_LONG);
        assert_eq!(tip.category, "pacing");
        assert_eq!(tip.priority, "important");
        gate.mark(&tip, &v);

        // Misma racha, más larga: ya avisado.
        let v2 = view(500, 400, 400, 1, false, 500, 0, 500_000);
        assert!(evaluate_presenter_tips(&v2, &gate).is_none(), "una vez por racha");

        // Racha nueva: vuelve a avisar.
        let v3 = view(900, 301, 400, 2, false, 900, 0, 900_000);
        assert_eq!(
            evaluate_presenter_tips(&v3, &gate).unwrap().trigger,
            TRIGGER_PRES_RUN_LONG
        );
    }

    #[test]
    fn racha_de_601s_escala_a_critico_y_marca_el_largo() {
        let mut gate = PresenterTipState::default();
        let v = view(700, 601, 601, 1, false, 700, 0, 700_000);
        let critical = evaluate_presenter_tips(&v, &gate).expect("601 s escala");
        assert_eq!(critical.trigger, TRIGGER_PRES_RUN_CRITICAL);
        assert_eq!(critical.priority, "critical");
        gate.mark(&critical, &v);

        // Ni el crítico ni el largo se repiten en la misma racha.
        let v2 = view(800, 700, 700, 1, false, 800, 0, 800_000);
        assert!(evaluate_presenter_tips(&v2, &gate).is_none());

        // Largo → crítico dentro de la misma racha.
        let mut gate2 = PresenterTipState::default();
        let a = view(400, 301, 301, 3, false, 400, 0, 400_000);
        let long = evaluate_presenter_tips(&a, &gate2).unwrap();
        assert_eq!(long.trigger, TRIGGER_PRES_RUN_LONG);
        gate2.mark(&long, &a);
        let b = view(700, 601, 601, 3, false, 700, 0, 700_000);
        assert_eq!(
            evaluate_presenter_tips(&b, &gate2).unwrap().trigger,
            TRIGGER_PRES_RUN_CRITICAL
        );
    }

    #[test]
    fn audiencia_callada_exige_audiencia_vista_10_min_de_sesion_y_10_min_de_silencio() {
        let gate = PresenterTipState::default();
        // Nunca intervino (presencial / webinar mudo): nunca avisa.
        assert!(evaluate_presenter_tips(&view(900, 0, 100, 2, false, 900, 0, 900_000), &gate).is_none());
        // Sesión o silencio < 10 min: no.
        assert!(evaluate_presenter_tips(&view(599, 0, 100, 2, true, 599, 5_000, 599_000), &gate).is_none());
        assert!(evaluate_presenter_tips(&view(900, 0, 100, 2, true, 599, 5_000, 900_000), &gate).is_none());
        // Todo en regla.
        let tip = evaluate_presenter_tips(&view(600, 0, 100, 2, true, 600, 5_000, 600_000), &gate)
            .expect("10 min callada con audiencia vista");
        assert_eq!(tip.trigger, TRIGGER_PRES_AUDIENCE_SILENT);
        assert_eq!(tip.category, "listening");
        assert_eq!(tip.priority, "important");
    }

    #[test]
    fn audiencia_callada_repite_cada_10_min() {
        let mut gate = PresenterTipState::default();
        let v = view(600, 0, 100, 2, true, 600, 5_000, 600_000);
        let tip = evaluate_presenter_tips(&v, &gate).unwrap();
        gate.mark(&tip, &v);
        assert!(evaluate_presenter_tips(&view(1_100, 0, 100, 2, true, 1_100, 5_000, 1_100_000), &gate).is_none());
        assert_eq!(
            evaluate_presenter_tips(&view(1_200, 0, 100, 2, true, 1_200, 5_000, 1_200_000), &gate)
                .unwrap()
                .trigger,
            TRIGGER_PRES_AUDIENCE_SILENT
        );
    }

    #[test]
    fn audiencia_reciente_no_avisa() {
        let v = view(900, 0, 100, 2, true, 400, 60_000, 900_000);
        assert!(evaluate_presenter_tips(&v, &PresenterTipState::default()).is_none());
    }

    #[test]
    fn prioridad_racha_sobre_audiencia() {
        let v = view(900, 301, 301, 2, true, 900, 5_000, 900_000);
        let tip = evaluate_presenter_tips(&v, &PresenterTipState::default()).unwrap();
        assert_eq!(tip.trigger, TRIGGER_PRES_RUN_LONG);
    }

    // ── presenter_health_score ────────────────────────────────────────────

    #[test]
    fn health_ponente_base_70_y_rango_50_75() {
        assert_eq!(presenter_health_score(&view(0, 0, 0, 0, false, 0, 0, 0)), 70);
        assert_eq!(presenter_health_score(&view(400, 0, 301, 1, false, 400, 0, 400_000)), 60);
        assert_eq!(presenter_health_score(&view(700, 0, 601, 1, false, 700, 0, 700_000)), 50);
        // Con audiencia participativa la racha crítica queda en 55, nunca por debajo de 50.
        assert_eq!(presenter_health_score(&view(700, 0, 601, 1, true, 10, 200_000, 700_000)), 55);
        // Sin racha y con audiencia: 75, nunca por encima.
        assert_eq!(presenter_health_score(&view(700, 0, 100, 1, true, 10, 200_000, 700_000)), 75);
    }

    #[test]
    fn health_ponente_bonifica_audiencia_solo_tras_3_min_y_desde_10_pct() {
        // Sesión < 180 s: sin bono aunque participe.
        assert_eq!(presenter_health_score(&view(179, 0, 0, 1, true, 10, 50_000, 100_000)), 70);
        // 180 s con exactamente 10 %: bono.
        assert_eq!(presenter_health_score(&view(180, 0, 0, 1, true, 10, 10_000, 100_000)), 75);
        // 9 %: no.
        assert_eq!(presenter_health_score(&view(180, 0, 0, 1, true, 10, 9_000, 100_000)), 70);
        // Sin unidades: no divide, no bonifica.
        assert_eq!(presenter_health_score(&view(600, 0, 0, 1, false, 600, 0, 0)), 70);
    }
}
