//! Nudge Engine — coaching inteligente basado en métricas, no en timer.
//!
//! Inspirado en call.md nudge-engine.service.ts. Evalúa métricas de la
//! conversación y genera nudges SOLO cuando hay señal real. Rate-limited
//! a máx 1 nudge cada 2 minutos para evitar fatiga.

use serde::{Deserialize, Serialize};

/// Resultado de evaluación del nudge engine.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NudgeResult {
    /// Si se debe mostrar un nudge ahora.
    pub should_nudge: bool,
    /// Tipo de nudge detectado.
    pub nudge_type: Option<NudgeType>,
    /// Tip heurístico listo para mostrar (sin LLM).
    pub tip: Option<String>,
    /// Severidad: low, medium, high.
    pub severity: String,
    /// Categoría para el coach.
    pub category: String,
}

/// Tipos de nudge soportados.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum NudgeType {
    /// Usuario habla >65% del tiempo.
    TalkRatioDominant,
    /// 0 preguntas en 3+ minutos.
    NoQuestions,
    /// WPM >180 (habla muy rápido).
    SpeakingTooFast,
    /// Monólogo >60s sin parar.
    Monologue,
    /// Min 20+ sin definir next steps.
    NextStepsReminder,
    /// Calidad de servicio baja (<40).
    LowHealthScore,
}

/// Métricas de conversación que el frontend envía.
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
/// Prioridad de evaluación (primera condición que matchea gana):
/// 1. Health score muy bajo (<30) → urgente
/// 2. Monólogo activo (>60s) → urgente
/// 3. Talk ratio >65% (después de 2+ min) → medio
/// 4. WPM >180 → medio
/// 5. Sin preguntas en 3+ min → bajo
/// 6. Min 20+ sin next steps → bajo
pub fn evaluate_nudge(snapshot: &ConversationSnapshot) -> NudgeResult {
    let no_nudge = NudgeResult {
        should_nudge: false,
        nudge_type: None,
        tip: None,
        severity: "low".to_string(),
        category: "pacing".to_string(),
    };

    // Mínimo 60s de sesión para evaluar
    if snapshot.session_duration_sec < 60 {
        return no_nudge;
    }

    // 1. Health score crítico
    if snapshot.health_score < 30 && snapshot.session_duration_sec > 120 {
        return NudgeResult {
            should_nudge: true,
            nudge_type: Some(NudgeType::LowHealthScore),
            tip: Some("Atención: la conversación necesita mejorar. Pregúntale: '¿cómo te sientes con lo que hemos hablado?'".to_string()),
            severity: "high".to_string(),
            category: "rapport".to_string(),
        };
    }

    // 2. Monólogo activo
    if snapshot.longest_user_monologue_sec > 60 {
        return NudgeResult {
            should_nudge: true,
            nudge_type: Some(NudgeType::Monologue),
            tip: Some("Llevas más de 1 minuto hablando. Haz pausa y pregunta: '¿esto te hace sentido?'".to_string()),
            severity: "high".to_string(),
            category: "pacing".to_string(),
        };
    }

    // 3. Talk ratio dominante (solo después de 2 min)
    if snapshot.user_talk_ratio > 0.65 && snapshot.session_duration_sec > 120 {
        let last = snapshot.last_nudge_type.as_deref();
        if last != Some("TalkRatioDominant") {
            return NudgeResult {
                should_nudge: true,
                nudge_type: Some(NudgeType::TalkRatioDominant),
                tip: Some("Estás hablando mucho. Pregúntale: '¿qué opinas tú sobre esto?'".to_string()),
                severity: "medium".to_string(),
                category: "pacing".to_string(),
            };
        }
    }

    // 4. Hablando muy rápido
    if snapshot.user_wpm > 180.0 && snapshot.session_duration_sec > 90 {
        return NudgeResult {
            should_nudge: true,
            nudge_type: Some(NudgeType::SpeakingTooFast),
            tip: Some("Estás acelerando. Baja el ritmo y respira entre oraciones.".to_string()),
            severity: "medium".to_string(),
            category: "pacing".to_string(),
        };
    }

    // 5. Sin preguntas en 3+ minutos
    if snapshot.user_questions == 0 && snapshot.session_duration_sec > 180 {
        return NudgeResult {
            should_nudge: true,
            nudge_type: Some(NudgeType::NoQuestions),
            tip: Some("Llevas rato sin preguntar. Pregúntale: '¿qué es lo más importante para ti?'".to_string()),
            severity: "low".to_string(),
            category: "discovery".to_string(),
        };
    }

    // 6. Next steps reminder (20 min+)
    if snapshot.session_duration_sec > 1200 {
        let last = snapshot.last_nudge_type.as_deref();
        if last != Some("NextStepsReminder") {
            return NudgeResult {
                should_nudge: true,
                nudge_type: Some(NudgeType::NextStepsReminder),
                tip: Some("Llevas 20+ min. Pregúntale: '¿cuáles serían los siguientes pasos?'".to_string()),
                severity: "low".to_string(),
                category: "closing".to_string(),
            };
        }
    }

    no_nudge
}

/// Comando Tauri para evaluar nudges desde el frontend.
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
    let snapshot = ConversationSnapshot {
        user_talk_ratio,
        user_questions,
        session_duration_sec,
        user_wpm,
        longest_user_monologue_sec,
        health_score,
        last_nudge_type,
    };
    evaluate_nudge(&snapshot)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_no_nudge_first_60s() {
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
    fn test_low_health_score() {
        let snap = ConversationSnapshot {
            user_talk_ratio: 0.5,
            user_questions: 3,
            session_duration_sec: 180,
            user_wpm: 120.0,
            longest_user_monologue_sec: 20,
            health_score: 25,
            last_nudge_type: None,
        };
        let result = evaluate_nudge(&snap);
        assert!(result.should_nudge);
        assert_eq!(result.nudge_type, Some(NudgeType::LowHealthScore));
        assert_eq!(result.severity, "high");
    }

    #[test]
    fn test_monologue_detected() {
        let snap = ConversationSnapshot {
            user_talk_ratio: 0.5,
            user_questions: 2,
            session_duration_sec: 300,
            user_wpm: 140.0,
            longest_user_monologue_sec: 75,
            health_score: 60,
            last_nudge_type: None,
        };
        let result = evaluate_nudge(&snap);
        assert!(result.should_nudge);
        assert_eq!(result.nudge_type, Some(NudgeType::Monologue));
    }

    #[test]
    fn test_talk_ratio_dominant() {
        let snap = ConversationSnapshot {
            user_talk_ratio: 0.72,
            user_questions: 5,
            session_duration_sec: 300,
            user_wpm: 140.0,
            longest_user_monologue_sec: 30,
            health_score: 55,
            last_nudge_type: None,
        };
        let result = evaluate_nudge(&snap);
        assert!(result.should_nudge);
        assert_eq!(result.nudge_type, Some(NudgeType::TalkRatioDominant));
    }

    #[test]
    fn test_talk_ratio_no_repeat() {
        let snap = ConversationSnapshot {
            user_talk_ratio: 0.72,
            user_questions: 5,
            session_duration_sec: 300,
            user_wpm: 140.0,
            longest_user_monologue_sec: 30,
            health_score: 55,
            last_nudge_type: Some("TalkRatioDominant".to_string()),
        };
        // Should skip because same nudge already shown
        let result = evaluate_nudge(&snap);
        assert!(!result.should_nudge);
    }

    #[test]
    fn test_speaking_too_fast() {
        let snap = ConversationSnapshot {
            user_talk_ratio: 0.45,
            user_questions: 4,
            session_duration_sec: 120,
            user_wpm: 195.0,
            longest_user_monologue_sec: 20,
            health_score: 70,
            last_nudge_type: None,
        };
        let result = evaluate_nudge(&snap);
        assert!(result.should_nudge);
        assert_eq!(result.nudge_type, Some(NudgeType::SpeakingTooFast));
    }

    #[test]
    fn test_no_questions_after_3min() {
        let snap = ConversationSnapshot {
            user_talk_ratio: 0.5,
            user_questions: 0,
            session_duration_sec: 240,
            user_wpm: 130.0,
            longest_user_monologue_sec: 20,
            health_score: 60,
            last_nudge_type: None,
        };
        let result = evaluate_nudge(&snap);
        assert!(result.should_nudge);
        assert_eq!(result.nudge_type, Some(NudgeType::NoQuestions));
    }

    #[test]
    fn test_next_steps_after_20min() {
        let snap = ConversationSnapshot {
            user_talk_ratio: 0.5,
            user_questions: 8,
            session_duration_sec: 1300,
            user_wpm: 130.0,
            longest_user_monologue_sec: 20,
            health_score: 75,
            last_nudge_type: None,
        };
        let result = evaluate_nudge(&snap);
        assert!(result.should_nudge);
        assert_eq!(result.nudge_type, Some(NudgeType::NextStepsReminder));
    }

    #[test]
    fn test_healthy_conversation_no_nudge() {
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
