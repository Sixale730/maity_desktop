//! Stages de análisis de contexto: heurísticas locales sobre la transcripción
//! para producir insights sin invocar LLM.
//!
//! - TalkRatioStage: balance de hablantes (user vs interlocutor)
//! - MeetingTypeHintStage: hint de tipo de reunión (sales/service/team) por keywords
//! - KeyMomentsStage: cambios de hablante con silencios largos > umbral

use super::{OrchestratorContext, Stage};
use serde_json::json;

const SALES_KEYWORDS: &[&str] = &[
    "precio", "presupuesto", "demo", "propuesta", "objeción", "cierre",
    "descuento", "contrato", "comprar", "vender", "venta", "plan", "ofert",
];
const SERVICE_KEYWORDS: &[&str] = &[
    "ticket", "incidencia", "problema", "soporte", "error", "fallo",
    "garantía", "reclamo", "queja", "ayuda", "resolver", "solución",
];
const TEAM_KEYWORDS: &[&str] = &[
    "sprint", "standup", "retrospectiva", "objetivo", "okr", "kpi",
    "deadline", "milestone", "asignar", "tarea", "review", "blocker",
];

pub struct TalkRatioStage;
impl Stage for TalkRatioStage {
    fn name(&self) -> &str {
        "talk_ratio"
    }
    fn run(&self, ctx: &OrchestratorContext) -> Result<serde_json::Value, String> {
        let mut user_secs = 0.0_f64;
        let mut inter_secs = 0.0_f64;
        let mut other_secs = 0.0_f64;
        for s in ctx.segments {
            let dur = (s.audio_end_time - s.audio_start_time).max(0.0);
            match s.source_type.as_deref() {
                Some("user") => user_secs += dur,
                Some("interlocutor") => inter_secs += dur,
                _ => other_secs += dur,
            }
        }
        let total = user_secs + inter_secs + other_secs;
        let user_ratio = if total > 0.0 { user_secs / total } else { 0.0 };
        let inter_ratio = if total > 0.0 { inter_secs / total } else { 0.0 };
        Ok(json!({
            "user_seconds": user_secs,
            "interlocutor_seconds": inter_secs,
            "other_seconds": other_secs,
            "user_ratio": user_ratio,
            "interlocutor_ratio": inter_ratio,
            "balanced": (user_ratio - inter_ratio).abs() < 0.2 && total > 0.0,
        }))
    }
}

pub struct MeetingTypeHintStage;
impl Stage for MeetingTypeHintStage {
    fn name(&self) -> &str {
        "meeting_type_hint"
    }
    fn run(&self, ctx: &OrchestratorContext) -> Result<serde_json::Value, String> {
        let lower: String = ctx
            .segments
            .iter()
            .map(|s| s.text.to_lowercase())
            .collect::<Vec<_>>()
            .join(" ");

        let count = |words: &[&str]| -> usize {
            words.iter().map(|w| lower.matches(w).count()).sum()
        };
        let sales = count(SALES_KEYWORDS);
        let service = count(SERVICE_KEYWORDS);
        let team = count(TEAM_KEYWORDS);

        let (hint, score) = [
            ("sales", sales),
            ("service", service),
            ("team_meeting", team),
        ]
        .into_iter()
        .max_by_key(|(_, c)| *c)
        .unwrap_or(("auto", 0));

        Ok(json!({
            "hint": if score == 0 { "auto" } else { hint },
            "scores": { "sales": sales, "service": service, "team_meeting": team },
            "confidence": (score as f32 / (sales + service + team).max(1) as f32),
        }))
    }
}

pub struct KeyMomentsStage {
    /// Umbral en segundos para considerar un silencio "largo".
    pub silence_threshold_sec: f64,
}

impl Default for KeyMomentsStage {
    fn default() -> Self {
        Self { silence_threshold_sec: 4.0 }
    }
}

impl Stage for KeyMomentsStage {
    fn name(&self) -> &str {
        "key_moments"
    }
    fn run(&self, ctx: &OrchestratorContext) -> Result<serde_json::Value, String> {
        let mut moments: Vec<serde_json::Value> = Vec::new();
        let mut prev_speaker: Option<&str> = None;
        let mut prev_end = 0.0_f64;

        for s in ctx.segments {
            let speaker = s.source_type.as_deref().unwrap_or("unknown");
            let gap = s.audio_start_time - prev_end;

            if gap >= self.silence_threshold_sec && prev_end > 0.0 {
                moments.push(json!({
                    "kind": "long_silence",
                    "at_seconds": prev_end,
                    "duration_seconds": gap,
                }));
            }
            if let Some(prev) = prev_speaker {
                if prev != speaker {
                    moments.push(json!({
                        "kind": "speaker_change",
                        "at_seconds": s.audio_start_time,
                        "from": prev,
                        "to": speaker,
                    }));
                }
            }
            prev_speaker = Some(speaker);
            prev_end = s.audio_end_time;
        }

        Ok(json!({ "count": moments.len(), "moments": moments }))
    }
}

#[cfg(test)]
mod tests {
    use super::super::{OrchestratorContext, OrchestratorSegment, Pipeline};
    use super::*;

    fn seg(text: &str, source: &str, start: f64, end: f64) -> OrchestratorSegment {
        OrchestratorSegment {
            text: text.to_string(),
            source_type: Some(source.to_string()),
            audio_start_time: start,
            audio_end_time: end,
        }
    }

    #[test]
    fn talk_ratio_balanced_meeting() {
        let segs = vec![
            seg("hola", "user", 0.0, 5.0),
            seg("hola que tal", "interlocutor", 5.0, 10.0),
        ];
        let ctx = OrchestratorContext { segments: &segs, language: "es" };
        let out = TalkRatioStage.run(&ctx).unwrap();
        assert!((out["user_ratio"].as_f64().unwrap() - 0.5).abs() < 0.01);
        assert_eq!(out["balanced"], true);
    }

    #[test]
    fn talk_ratio_user_dominant() {
        let segs = vec![
            seg("a", "user", 0.0, 30.0),
            seg("b", "interlocutor", 30.0, 32.0),
        ];
        let ctx = OrchestratorContext { segments: &segs, language: "es" };
        let out = TalkRatioStage.run(&ctx).unwrap();
        let r = out["user_ratio"].as_f64().unwrap();
        assert!(r > 0.9);
        assert_eq!(out["balanced"], false);
    }

    #[test]
    fn meeting_type_detects_sales() {
        let segs = vec![
            seg("el precio del producto y el descuento", "user", 0.0, 5.0),
            seg("queremos comprar pero el contrato", "interlocutor", 5.0, 10.0),
        ];
        let ctx = OrchestratorContext { segments: &segs, language: "es" };
        let out = MeetingTypeHintStage.run(&ctx).unwrap();
        assert_eq!(out["hint"], "sales");
    }

    #[test]
    fn meeting_type_auto_on_empty() {
        let ctx = OrchestratorContext { segments: &[], language: "es" };
        let out = MeetingTypeHintStage.run(&ctx).unwrap();
        assert_eq!(out["hint"], "auto");
    }

    #[test]
    fn key_moments_detects_silence_and_speaker_change() {
        let segs = vec![
            seg("hola", "user", 0.0, 2.0),
            seg("respuesta", "interlocutor", 8.0, 10.0),
        ];
        let ctx = OrchestratorContext { segments: &segs, language: "es" };
        let out = KeyMomentsStage::default().run(&ctx).unwrap();
        let count = out["count"].as_u64().unwrap();
        assert!(count >= 2, "expected silence + speaker_change, got {}", count);
    }

    #[test]
    fn full_pipeline_runs_three_stages() {
        let segs = vec![
            seg("precio del demo", "user", 0.0, 3.0),
            seg("revisamos el presupuesto", "interlocutor", 8.0, 12.0),
        ];
        let ctx = OrchestratorContext { segments: &segs, language: "es" };
        let pipeline = Pipeline::new()
            .with_stage(TalkRatioStage)
            .with_stage(MeetingTypeHintStage)
            .with_stage(KeyMomentsStage::default());
        let outs = pipeline.run(&ctx);
        assert_eq!(outs.len(), 3);
        assert_eq!(outs[0].stage, "talk_ratio");
        assert_eq!(outs[1].stage, "meeting_type_hint");
        assert_eq!(outs[2].stage, "key_moments");
    }
}
