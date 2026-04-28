//! Nudge Engine — coaching inteligente basado en métricas, no en timer.
//!
//! Evalúa métricas de la conversación y genera nudges SOLO cuando hay señal
//! real. Rate-limited a máx 1 nudge cada 2 minutos para evitar fatiga.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NudgeResult {
    pub should_nudge: bool,
    pub nudge_type: Option<NudgeType>,
    /// Tip heurístico listo para mostrar (sin LLM).
    pub tip: Option<String>,
    pub severity: String,
    pub category: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum NudgeType {
    TalkRatioDominant,
    NoQuestions,
    SpeakingTooFast,
    Monologue,
    NextStepsReminder,
    LowHealthScore,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationSnapshot {
    pub user_talk_ratio: f32,
    pub user_questions: u32,
    pub session_duration_sec: u32,
    pub user_wpm: f32,
    pub longest_user_monologue_sec: u32,
    pub health_score: u32,
    pub last_nudge_type: Option<String>,
}

/// Evalúa métricas y decide si se debe generar un nudge.
///
/// Prioridad (primera condición que matchea gana):
/// 1. Health score muy bajo (<30) → urgente
/// 2. Monólogo activo (>60s) → urgente
/// 3. Talk ratio >65% (después de 2+ min) → medio
/// 4. WPM >180 → medio
/// 5. Sin preguntas en 3+ min → bajo
/// 6. 20+ min sin next steps → bajo
pub fn evaluate_nudge(snapshot: &ConversationSnapshot) -> NudgeResult {
    let no_nudge = NudgeResult {
        should_nudge: false,
        nudge_type: None,
        tip: None,
        severity: "low".to_string(),
        category: "pacing".to_string(),
    };

    if snapshot.session_duration_sec < 60 {
        return no_nudge;
    }

    if snapshot.health_score < 30 && snapshot.session_duration_sec > 120 {
        return NudgeResult {
            should_nudge: true,
            nudge_type: Some(NudgeType::LowHealthScore),
            tip: None,
            severity: "high".to_string(),
            category: "rapport".to_string(),
        };
    }

    if snapshot.longest_user_monologue_sec > 60 {
        return NudgeResult {
            should_nudge: true,
            nudge_type: Some(NudgeType::Monologue),
            tip: None,
            severity: "high".to_string(),
            category: "pacing".to_string(),
        };
    }

    if snapshot.user_talk_ratio > 0.65 && snapshot.session_duration_sec > 120 {
        if snapshot.last_nudge_type.as_deref() != Some("TalkRatioDominant") {
            return NudgeResult {
                should_nudge: true,
                nudge_type: Some(NudgeType::TalkRatioDominant),
                tip: None,
                severity: "medium".to_string(),
                category: "pacing".to_string(),
            };
        }
    }

    if snapshot.user_wpm > 180.0 && snapshot.session_duration_sec > 90 {
        return NudgeResult {
            should_nudge: true,
            nudge_type: Some(NudgeType::SpeakingTooFast),
            tip: None,
            severity: "medium".to_string(),
            category: "pacing".to_string(),
        };
    }

    if snapshot.user_questions == 0 && snapshot.session_duration_sec > 180 {
        return NudgeResult {
            should_nudge: true,
            nudge_type: Some(NudgeType::NoQuestions),
            tip: None,
            severity: "low".to_string(),
            category: "discovery".to_string(),
        };
    }

    if snapshot.session_duration_sec > 1200 {
        if snapshot.last_nudge_type.as_deref() != Some("NextStepsReminder") {
            return NudgeResult {
                should_nudge: true,
                nudge_type: Some(NudgeType::NextStepsReminder),
                tip: None,
                severity: "low".to_string(),
                category: "closing".to_string(),
            };
        }
    }

    no_nudge
}

#[tauri::command]
pub fn coach_evaluate_nudge(
    user_talk_ratio: f32,
    user_questions: u32,
    session_duration_sec: u32,
    user_wpm: f32,
    longest_user_monologue_sec: u32,
    health_score: u32,
    last_nudge_type: Option<String>,
) -> NudgeResult {
    evaluate_nudge(&ConversationSnapshot {
        user_talk_ratio,
        user_questions,
        session_duration_sec,
        user_wpm,
        longest_user_monologue_sec,
        health_score,
        last_nudge_type,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_nudge_first_60s() {
        let snap = ConversationSnapshot {
            user_talk_ratio: 0.9,
            user_questions: 0,
            session_duration_sec: 30,
            user_wpm: 200.0,
            longest_user_monologue_sec: 90,
            health_score: 10,
            last_nudge_type: None,
        };
        assert!(!evaluate_nudge(&snap).should_nudge);
    }

    #[test]
    fn low_health_score() {
        let snap = ConversationSnapshot {
            user_talk_ratio: 0.5,
            user_questions: 3,
            session_duration_sec: 180,
            user_wpm: 120.0,
            longest_user_monologue_sec: 20,
            health_score: 25,
            last_nudge_type: None,
        };
        let r = evaluate_nudge(&snap);
        assert!(r.should_nudge);
        assert_eq!(r.nudge_type, Some(NudgeType::LowHealthScore));
    }

    #[test]
    fn monologue_detected() {
        let snap = ConversationSnapshot {
            user_talk_ratio: 0.5,
            user_questions: 2,
            session_duration_sec: 300,
            user_wpm: 140.0,
            longest_user_monologue_sec: 75,
            health_score: 60,
            last_nudge_type: None,
        };
        let r = evaluate_nudge(&snap);
        assert!(r.should_nudge);
        assert_eq!(r.nudge_type, Some(NudgeType::Monologue));
    }

    #[test]
    fn talk_ratio_no_repeat() {
        let snap = ConversationSnapshot {
            user_talk_ratio: 0.72,
            user_questions: 5,
            session_duration_sec: 300,
            user_wpm: 140.0,
            longest_user_monologue_sec: 30,
            health_score: 55,
            last_nudge_type: Some("TalkRatioDominant".to_string()),
        };
        assert!(!evaluate_nudge(&snap).should_nudge);
    }

    #[test]
    fn healthy_conversation_no_nudge() {
        let snap = ConversationSnapshot {
            user_talk_ratio: 0.45,
            user_questions: 6,
            session_duration_sec: 600,
            user_wpm: 140.0,
            longest_user_monologue_sec: 25,
            health_score: 82,
            last_nudge_type: None,
        };
        assert!(!evaluate_nudge(&snap).should_nudge);
    }
}
