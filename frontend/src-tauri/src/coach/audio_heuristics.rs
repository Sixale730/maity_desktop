//! Coach por heurísticos de AUDIO (F5 de la migración a lote) — módulo PURO.
//!
//! En modo LOTE no hay `transcript-update` durante la grabación, así que el
//! coach no puede contar turnos, preguntas ni palabras. Lo que sí tiene es el
//! rastreador de voz por canal (`audio/voice_activity.rs`): ms de voz por
//! canal y la racha de monólogo del usuario. Con eso se cubren, en
//! CONVERSACIÓN, las dos cosas que un vendedor quiere que le avisen en vivo:
//! **monólogo** y **dominancia** del tiempo de palabra. Nada más — sin LLM,
//! sin sidecar. En modo Ponente esta tabla NO aplica: `health_score` y
//! `audio_heuristic_tick` delegan en `coach/presenter_heuristics.rs` (rachas
//! de 5/10 min, audiencia callada, Ritmo 50-75) vía `presenter_view()`.
//!
//! Los dos tips viven en el loop heurístico de 3 s de `live_feedback` (no en
//! el loop de nudges de 15 s: ahí todo `evaluate_nudge` devuelve `tip: None`
//! = petición al LLM, que en audio no existe). Gating propio en vez del
//! Jaccard de `is_duplicate_tip`: con 2-3 textos fijos, el Jaccard avisaría
//! UNA vez por sesión. Aquí: monólogo **una vez por racha** (id =
//! `user_mono_runs` del tracker; el crítico escala dentro de la misma racha)
//! y dominancia **cada 5 min**. `can_emit` (caps/cooldowns) se respeta igual
//! desde el caller.
//!
//! Sin `AppHandle`, sin relojes: todo entra por `AudioSnapshot` y el estado
//! de gating `AudioTipState`, así que se prueba con tablas.

use crate::audio::voice_activity::VoiceActivitySnapshot;
use crate::coach::live_feedback::HeuristicTip;
use crate::coach::presenter_heuristics::{presenter_health_score, PresenterView};

/// Antes de este tiempo de sesión no se emite ningún tip por audio (el
/// arranque de una reunión es ruidoso: saludos, compartir pantalla).
pub(crate) const MIN_SESSION_SECS: u32 = 60;
/// Racha de monólogo en curso a partir de la cual avisa "haz una pausa".
pub(crate) const MONO_LONG_SECS: u64 = 60;
/// Racha a partir de la cual el aviso escala a crítico.
pub(crate) const MONO_CRITICAL_SECS: u64 = 150;
/// Dominancia: exige sesión madura, voz total suficiente y ratio alto.
pub(crate) const DOMINANCE_MIN_SESSION_SECS: u32 = 120;
pub(crate) const DOMINANCE_MIN_VOICED_MS: u64 = 60_000;
pub(crate) const DOMINANCE_RATIO: f32 = 0.70;
/// El tip de dominancia se repite como mucho cada 5 min.
pub(crate) const DOMINANCE_REPEAT_SECS: u32 = 300;
/// "Monólogo" (sin interlocutor): sesión ≥ 30 s y el canal sistema con menos
/// de 2 s de voz acumulada — espejo de `FeedbackState::is_monologue_mode`
/// (30 s de gracia, interlocutor ausente).
pub(crate) const MONOLOGUE_GRACE_SECS: u32 = 30;
pub(crate) const MONOLOGUE_INTERLOCUTOR_MAX_MS: u64 = 2_000;
/// Voz total mínima para que el ratio pese en el health (evita que 3 s de
/// saludo muevan el gauge ±15).
pub(crate) const HEALTH_MIN_VOICED_MS: u64 = 30_000;

pub(crate) const TRIGGER_MONO_CRITICAL: &str = "audio_monologue_critical";
pub(crate) const TRIGGER_MONO_LONG: &str = "audio_monologue_long";
pub(crate) const TRIGGER_DOMINANCE: &str = "audio_dominance";

/// Vista del coach sobre el rastreador de voz + contexto de sesión.
#[derive(Debug, Clone, Copy)]
pub(crate) struct AudioSnapshot {
    pub any_voiced: bool,
    /// Fracción del tiempo de palabra del usuario (0.5 sin voz).
    pub user_talk_ratio: f32,
    /// Reloj de AUDIO del mic (`VoiceActivitySnapshot::session_ms / 1000`), NO
    /// el de pared del coach: no avanza en pausa ni durante un suspend, así
    /// que los umbrales de sesión (60 s, 120 s, 5 min) miden audio real. El
    /// reloj de pared se conserva solo para `MeetingMetrics.session_secs`
    /// (paridad visual con el modo transcript).
    pub session_secs: u32,
    pub user_voiced_ms: u64,
    pub interlocutor_voiced_ms: u64,
    pub current_user_mono_ms: u64,
    pub longest_user_mono_ms: u64,
    /// Id de la racha en curso (rachas abiertas en la sesión).
    pub user_mono_runs: u64,
    /// Sesión ≥ 30 s sin interlocutor (< 2 s de voz en el canal sistema).
    pub is_monologue: bool,
    /// La audiencia ya tuvo la palabra (≥ `INTERRUPT_MS`) alguna vez.
    pub audience_seen: bool,
    /// Segundos de audio desde la última intervención de la audiencia (toda
    /// la sesión si nunca intervino).
    pub audience_silent_secs: u32,
    /// Modo Ponente: esta tabla no aplica; ver `presenter_view()` y
    /// `coach/presenter_heuristics.rs`.
    pub is_presentation: bool,
}

impl AudioSnapshot {
    pub(crate) fn from_voice(
        v: &VoiceActivitySnapshot,
        session_secs: u32,
        is_presentation: bool,
    ) -> Self {
        Self {
            any_voiced: v.any_voiced(),
            user_talk_ratio: v.user_talk_ratio(),
            session_secs,
            user_voiced_ms: v.user_voiced_ms,
            interlocutor_voiced_ms: v.interlocutor_voiced_ms,
            current_user_mono_ms: v.current_user_mono_ms,
            longest_user_mono_ms: v.longest_user_mono_ms,
            user_mono_runs: v.user_mono_runs,
            is_monologue: session_secs >= MONOLOGUE_GRACE_SECS
                && v.interlocutor_voiced_ms < MONOLOGUE_INTERLOCUTOR_MAX_MS,
            audience_seen: v.last_interlocutor_voice_ms > 0,
            audience_silent_secs: (v.interlocutor_silence_ms() / 1000).min(u32::MAX as u64) as u32,
            is_presentation,
        }
    }

    fn total_voiced_ms(&self) -> u64 {
        self.user_voiced_ms + self.interlocutor_voiced_ms
    }

    /// Vista de ponente (reloj de AUDIO): racha = monólogo en curso del
    /// tracker, audiencia = ms de voz del interlocutor.
    pub(crate) fn presenter_view(&self) -> PresenterView {
        PresenterView {
            session_secs: self.session_secs,
            current_run_secs: (self.current_user_mono_ms / 1000).min(u32::MAX as u64) as u32,
            longest_run_secs: (self.longest_user_mono_ms / 1000).min(u32::MAX as u64) as u32,
            run_id: self.user_mono_runs,
            audience_seen: self.audience_seen,
            audience_silent_secs: self.audience_silent_secs,
            audience_units: self.interlocutor_voiced_ms,
            total_units: self.total_voiced_ms(),
            any_activity: self.any_voiced,
        }
    }

    /// Health 0-100 del gauge ("Ritmo"), versión audio. Empieza en 70 como el
    /// de transcript y conserva sólo los términos que el audio puede medir:
    /// - monólogo más largo > 120 s −20 / > 60 s −10;
    /// - con ≥ 30 s de voz total: ratio > 0.80 −15, ratio en 0.40-0.60 +5.
    /// Sin términos de preguntas ni de turnos (no existen sin transcript).
    ///
    /// Modo Ponente (2026-09-11): delega en `presenter_health_score` (rachas
    /// de 5/10 min, +5 por audiencia, 50-75). Antes la penalización por
    /// monólogo aplicaba también aquí y un ponente normal vivía en 50.
    pub(crate) fn health_score(&self) -> u32 {
        if self.is_presentation {
            return presenter_health_score(&self.presenter_view());
        }
        let mut s: i32 = 70;
        let longest_secs = self.longest_user_mono_ms / 1000;
        if longest_secs > 120 {
            s -= 20;
        } else if longest_secs > 60 {
            s -= 10;
        }
        if !self.is_presentation && self.total_voiced_ms() >= HEALTH_MIN_VOICED_MS {
            let r = self.user_talk_ratio;
            if r > 0.80 {
                s -= 15;
            }
            if (0.40..=0.60).contains(&r) {
                s += 5;
            }
        }
        s.clamp(0, 100) as u32
    }
}

/// Gating de los tips por audio. Lo muta el caller con `mark` SOLO cuando el
/// tip se emitió de verdad (si `can_emit` lo bloqueó, se reintenta al tick
/// siguiente).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct AudioTipState {
    /// Racha (`user_mono_runs`) en la que ya se avisó "más de un minuto".
    mono_tip_run: u64,
    /// Racha en la que ya se escaló a crítico.
    mono_critical_run: u64,
    /// Segundo de sesión del último aviso de dominancia.
    last_dominance_at_sec: Option<u32>,
}

impl AudioTipState {
    pub(crate) fn mark(&mut self, tip: &HeuristicTip, snap: &AudioSnapshot) {
        match tip.trigger {
            TRIGGER_MONO_CRITICAL => {
                // El crítico cubre también al largo: en la misma racha no se
                // emite el "más de un minuto" después del "más de dos".
                self.mono_critical_run = snap.user_mono_runs;
                self.mono_tip_run = snap.user_mono_runs;
            }
            TRIGGER_MONO_LONG => self.mono_tip_run = snap.user_mono_runs,
            TRIGGER_DOMINANCE => self.last_dominance_at_sec = Some(snap.session_secs),
            _ => {}
        }
    }
}

/// Evalúa el snapshot y devuelve el primer tip que aplique (uno por tick):
/// monólogo crítico > monólogo largo > dominancia.
pub(crate) fn evaluate_audio_tips(
    snap: &AudioSnapshot,
    gate: &AudioTipState,
) -> Option<HeuristicTip> {
    // Guarda explícita y simple (el caller ya filtra `any_voiced`; se repite
    // aquí para que la función sea segura sola, sin precedencias `||`/`&&`
    // que se lean mal).
    if snap.session_secs < MIN_SESSION_SECS || !snap.any_voiced {
        return None;
    }
    // Modo Ponente: esta tabla no aplica (ni monólogo ni dominancia); la de
    // ponente la enruta `audio_heuristic_tick` vía `presenter_view()`.
    if snap.is_presentation {
        return None;
    }
    let mono_secs = snap.current_user_mono_ms / 1000;

    // (1) Monólogo crítico: > 150 s seguidos, una vez por racha.
    if mono_secs > MONO_CRITICAL_SECS && gate.mono_critical_run != snap.user_mono_runs {
        return Some(HeuristicTip {
            tip: "Llevas más de 2 minutos sin parar. Para, respira y pregunta.",
            category: "pacing",
            priority: "critical",
            trigger: TRIGGER_MONO_CRITICAL,
        });
    }
    // (2) Monólogo largo: > 60 s seguidos, una vez por racha.
    if mono_secs > MONO_LONG_SECS && gate.mono_tip_run != snap.user_mono_runs {
        return Some(HeuristicTip {
            tip: "Llevas más de un minuto hablando seguido. Haz una pausa y deja espacio.",
            category: "pacing",
            priority: "important",
            trigger: TRIGGER_MONO_LONG,
        });
    }
    // (3) Dominancia: solo en diálogo real (hay interlocutor, no es ponencia),
    //     sesión madura, voz total suficiente, ratio > 0.70, cada 5 min.
    let dialog = !snap.is_monologue && !snap.is_presentation;
    let repeat_ok = match gate.last_dominance_at_sec {
        None => true,
        Some(last) => snap.session_secs.saturating_sub(last) >= DOMINANCE_REPEAT_SECS,
    };
    if dialog
        && snap.session_secs >= DOMINANCE_MIN_SESSION_SECS
        && snap.total_voiced_ms() >= DOMINANCE_MIN_VOICED_MS
        && snap.user_talk_ratio > DOMINANCE_RATIO
        && repeat_ok
    {
        return Some(HeuristicTip {
            tip: "Llevas más del 70 % del tiempo de palabra. Pregúntale qué piensa.",
            category: "listening",
            priority: "important",
            trigger: TRIGGER_DOMINANCE,
        });
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn voice(user_ms: u64, inter_ms: u64, current_mono_ms: u64, runs: u64) -> VoiceActivitySnapshot {
        VoiceActivitySnapshot {
            user_voiced_ms: user_ms,
            interlocutor_voiced_ms: inter_ms,
            current_user_mono_ms: current_mono_ms,
            longest_user_mono_ms: current_mono_ms,
            user_mono_runs: runs,
            session_ms: user_ms + inter_ms,
            last_interlocutor_voice_ms: 0,
        }
    }

    fn snap(user_ms: u64, inter_ms: u64, current_mono_ms: u64, runs: u64, session: u32) -> AudioSnapshot {
        AudioSnapshot::from_voice(&voice(user_ms, inter_ms, current_mono_ms, runs), session, false)
    }

    #[test]
    fn sin_voz_no_hay_tip() {
        let s = AudioSnapshot::from_voice(&VoiceActivitySnapshot::default(), 300, false);
        assert!(!s.any_voiced);
        assert!(evaluate_audio_tips(&s, &AudioTipState::default()).is_none());
    }

    #[test]
    fn antes_de_60s_de_sesion_no_hay_tip() {
        // Monólogo de 70 s "imposible" en 50 s de sesión, pero el gate de sesión manda.
        let s = snap(70_000, 0, 70_000, 1, 50);
        assert!(evaluate_audio_tips(&s, &AudioTipState::default()).is_none());
    }

    #[test]
    fn monologo_de_61s_avisa_una_vez_por_racha() {
        let mut gate = AudioTipState::default();
        let s = snap(61_000, 0, 61_000, 1, 90);
        let tip = evaluate_audio_tips(&s, &gate).expect("61 s seguidos dispara");
        assert_eq!(tip.trigger, TRIGGER_MONO_LONG);
        assert_eq!(tip.priority, "important");
        gate.mark(&tip, &s);

        // Misma racha, más larga: ya avisado.
        let s2 = snap(80_000, 0, 80_000, 1, 110);
        assert!(evaluate_audio_tips(&s2, &gate).is_none(), "una vez por racha");

        // Racha nueva (el usuario paró ≥ 3 s y retomó): vuelve a avisar.
        let s3 = snap(150_000, 0, 65_000, 2, 200);
        let tip3 = evaluate_audio_tips(&s3, &gate).expect("racha nueva dispara otra vez");
        assert_eq!(tip3.trigger, TRIGGER_MONO_LONG);
    }

    #[test]
    fn monologo_de_151s_escala_a_critico_y_no_repite_el_largo() {
        let mut gate = AudioTipState::default();
        let s = snap(61_000, 0, 61_000, 1, 90);
        let long = evaluate_audio_tips(&s, &gate).unwrap();
        gate.mark(&long, &s);

        let s2 = snap(151_000, 0, 151_000, 1, 180);
        let critical = evaluate_audio_tips(&s2, &gate).expect("151 s escala");
        assert_eq!(critical.trigger, TRIGGER_MONO_CRITICAL);
        assert_eq!(critical.priority, "critical");
        gate.mark(&critical, &s2);

        let s3 = snap(170_000, 0, 170_000, 1, 200);
        assert!(evaluate_audio_tips(&s3, &gate).is_none(), "crítico ya emitido en esta racha");
    }

    #[test]
    fn critico_directo_marca_tambien_el_largo() {
        // Si can_emit bloqueó el largo y la racha ya pasó los 150 s, sale el
        // crítico y el largo NO debe aparecer después en la misma racha.
        let mut gate = AudioTipState::default();
        let s = snap(151_000, 0, 151_000, 1, 180);
        let critical = evaluate_audio_tips(&s, &gate).unwrap();
        assert_eq!(critical.trigger, TRIGGER_MONO_CRITICAL);
        gate.mark(&critical, &s);
        let s2 = snap(160_000, 0, 160_000, 1, 190);
        assert!(evaluate_audio_tips(&s2, &gate).is_none());
    }

    #[test]
    fn dominancia_solo_con_interlocutor_presente() {
        // Sin interlocutor (monólogo): ratio 1.0 pero no hay a quién preguntarle.
        let solo = snap(90_000, 0, 10_000, 3, 200);
        assert!(solo.is_monologue);
        assert!(evaluate_audio_tips(&solo, &AudioTipState::default()).is_none());

        // Con interlocutor (20 s de voz), ratio 0.8, sesión 200 s, voz total 100 s.
        let dialog = snap(80_000, 20_000, 10_000, 3, 200);
        assert!(!dialog.is_monologue);
        let tip = evaluate_audio_tips(&dialog, &AudioTipState::default()).expect("dominancia");
        assert_eq!(tip.trigger, TRIGGER_DOMINANCE);
        assert_eq!(tip.category, "listening");
    }

    #[test]
    fn dominancia_exige_sesion_madura_voz_total_y_ratio() {
        let gate = AudioTipState::default();
        // Sesión < 120 s.
        assert!(evaluate_audio_tips(&snap(80_000, 20_000, 0, 3, 100), &gate).is_none());
        // Voz total < 60 s.
        assert!(evaluate_audio_tips(&snap(40_000, 10_000, 0, 3, 200), &gate).is_none());
        // Ratio 0.65 ≤ 0.70.
        assert!(evaluate_audio_tips(&snap(65_000, 35_000, 0, 3, 200), &gate).is_none());
        // Todo en regla.
        assert!(evaluate_audio_tips(&snap(75_000, 25_000, 0, 3, 200), &gate).is_some());
    }

    #[test]
    fn dominancia_respeta_5_minutos() {
        let mut gate = AudioTipState::default();
        let s = snap(80_000, 20_000, 0, 3, 200);
        let tip = evaluate_audio_tips(&s, &gate).unwrap();
        gate.mark(&tip, &s);

        let s2 = snap(200_000, 40_000, 0, 5, 400); // 200 s después: no
        assert!(evaluate_audio_tips(&s2, &gate).is_none());
        let s3 = snap(300_000, 60_000, 0, 6, 500); // 300 s después: sí
        assert_eq!(evaluate_audio_tips(&s3, &gate).unwrap().trigger, TRIGGER_DOMINANCE);
    }

    #[test]
    fn presentacion_no_usa_la_tabla_conversacional() {
        // Desde 2026-09-11 en ponente no sale ni dominancia ni el monólogo de
        // 60 s: la tabla de ponente (5/10 min) vive en presenter_heuristics y la
        // enruta audio_heuristic_tick.
        let gate = AudioTipState::default();
        let pres = AudioSnapshot::from_voice(&voice(80_000, 20_000, 0, 3), 200, true);
        assert!(evaluate_audio_tips(&pres, &gate).is_none(), "un ponente DEBE acaparar");

        let pres_mono = AudioSnapshot::from_voice(&voice(80_000, 20_000, 70_000, 3), 200, true);
        assert!(evaluate_audio_tips(&pres_mono, &gate).is_none(), "70 s seguidos son normales en ponencia");
    }

    #[test]
    fn presenter_view_mapea_el_snapshot_de_audio() {
        let mut v = voice(120_000, 30_000, 61_000, 2);
        v.last_interlocutor_voice_ms = 100_000;
        let view = AudioSnapshot::from_voice(&v, 150, true).presenter_view();
        assert_eq!(view.session_secs, 150);
        assert_eq!(view.current_run_secs, 61);
        assert_eq!(view.longest_run_secs, 61);
        assert_eq!(view.run_id, 2);
        assert!(view.audience_seen);
        assert_eq!(view.audience_silent_secs, 50, "(150 000 − 100 000) / 1000");
        assert_eq!(view.audience_units, 30_000);
        assert_eq!(view.total_units, 150_000);
        assert!(view.any_activity);

        let nunca = AudioSnapshot::from_voice(&voice(120_000, 800, 0, 1), 120, true).presenter_view();
        assert!(!nunca.audience_seen, "800 ms de voz no llegan a tener la palabra");
        assert_eq!(nunca.audience_silent_secs, 120, "toda la sesión");
    }

    #[test]
    fn health_en_presentacion_delega_en_ponente() {
        let mut v = voice(400_000, 0, 0, 1);
        v.longest_user_mono_ms = 301_000;
        // Ponente: −10 por racha > 5 min, sin audiencia → 60.
        assert_eq!(AudioSnapshot::from_voice(&v, 600, true).health_score(), 60);
        // Conversación, mismo estado: −20 (> 120 s) −15 (ratio 1.0) → 35.
        assert_eq!(AudioSnapshot::from_voice(&v, 600, false).health_score(), 35);
    }

    #[test]
    fn prioridad_monologo_sobre_dominancia() {
        // Dominancia y monólogo largo a la vez: sale el monólogo (uno por tick).
        let s = snap(80_000, 20_000, 70_000, 3, 200);
        let tip = evaluate_audio_tips(&s, &AudioTipState::default()).unwrap();
        assert_eq!(tip.trigger, TRIGGER_MONO_LONG);
    }

    #[test]
    fn is_monologue_respeta_gracia_y_umbral_del_interlocutor() {
        assert!(!snap(10_000, 0, 0, 1, 20).is_monologue, "gracia de 30 s");
        assert!(snap(40_000, 1_900, 0, 1, 40).is_monologue, "< 2 s de interlocutor");
        assert!(!snap(40_000, 2_000, 0, 1, 40).is_monologue, "2 s de interlocutor = diálogo");
    }

    // ── health_score ──────────────────────────────────────────────────────

    #[test]
    fn health_baseline_70_sin_datos() {
        let s = AudioSnapshot::from_voice(&VoiceActivitySnapshot::default(), 0, false);
        assert_eq!(s.health_score(), 70);
    }

    #[test]
    fn health_penaliza_monologo_largo() {
        let mut v = voice(70_000, 30_000, 0, 1);
        v.longest_user_mono_ms = 61_000;
        assert_eq!(AudioSnapshot::from_voice(&v, 200, false).health_score(), 60);
        v.longest_user_mono_ms = 121_000;
        assert_eq!(AudioSnapshot::from_voice(&v, 200, false).health_score(), 50);
        // Ponente (2026-09-11): 121 s no llegan a los 5 min, y la audiencia
        // habló el 30 % con sesión ≥ 3 min → 70 + 5.
        assert_eq!(AudioSnapshot::from_voice(&v, 200, true).health_score(), 75);
    }

    #[test]
    fn health_ratio_penaliza_y_bonifica_solo_con_voz_suficiente() {
        // ratio 0.9 con 100 s de voz: −15.
        assert_eq!(snap(90_000, 10_000, 0, 1, 200).health_score(), 55);
        // ratio 0.5 con 100 s de voz: +5.
        assert_eq!(snap(50_000, 50_000, 0, 1, 200).health_score(), 75);
        // ratio 0.9 pero solo 10 s de voz total: neutro.
        assert_eq!(snap(9_000, 1_000, 0, 1, 200).health_score(), 70);
        // Presentación: el ratio no penaliza; la audiencia con exactamente el
        // 10 % (frontera entera, a propósito) sí bonifica → 75.
        let pres = AudioSnapshot::from_voice(&voice(90_000, 10_000, 0, 1), 200, true);
        assert_eq!(pres.health_score(), 75);
    }

    #[test]
    fn health_clampea() {
        let mut v = voice(90_000, 10_000, 0, 1);
        v.longest_user_mono_ms = 200_000;
        // 70 − 20 − 15 = 35, dentro de rango; y nunca fuera de 0..=100.
        let h = AudioSnapshot::from_voice(&v, 600, false).health_score();
        assert_eq!(h, 35);
        assert!(h <= 100);
    }
}
