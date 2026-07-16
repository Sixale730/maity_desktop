//! Utilidades del Coach IA: resolución de paths a modelos GGUF en disco
//! y mapeo de IDs entre el registry del coach y el sidecar Built-in AI.
//!
//! La generación LLM se hace vía `summary::llm_client::generate_summary`
//! con `LLMProvider::BuiltInAI`, que delega a `summary::summary_engine`
//! (singleton SidecarManager). Este módulo NO arranca procesos.

use super::model_registry;
use super::prompt::DEFAULT_TIPS_MODEL;
use crate::audio::{HardwareProfile, PerformanceTier};
use std::path::PathBuf;
use tauri::{Manager, Runtime};
use tracing::info;

/// Resuelve la ruta del archivo .gguf de un modelo del registry coach.
/// Busca primero en `models/llm/` (descargas del coach), después en
/// `models/summary/` (descargas del sidecar Built-in AI). Esto permite
/// reusar modelos ya descargados por el onboarding sin duplicar 1-3 GB.
pub fn model_file_path<R: Runtime>(app: &tauri::AppHandle<R>, model_id: &str) -> Option<PathBuf> {
    let def = model_registry::get_model(model_id)?;
    let base = app.path().app_data_dir().ok()?;
    let llm_path = base.join("models").join("llm").join(def.filename);
    if llm_path.exists() {
        return Some(llm_path);
    }
    let summary_path = base.join("models").join("summary").join(def.filename);
    if summary_path.exists() {
        return Some(summary_path);
    }
    Some(llm_path)
}

pub fn is_model_installed<R: Runtime>(app: &tauri::AppHandle<R>, model_id: &str) -> bool {
    model_file_path(app, model_id)
        .map(|p| p.exists())
        .unwrap_or(false)
}

/// Mapea IDs del registry del coach al naming del sidecar Built-in AI.
/// El coach usa "gemma3-4b-q4" (nombre del archivo GGUF), el sidecar usa
/// "gemma3:4b" (formato familia:variante de `summary_engine::models`).
pub fn map_to_builtin_id(coach_id: &str) -> &str {
    match coach_id {
        // §4.1 Mantenemos el mapeo de 1b por compatibilidad transitoria (DBs viejas que
        // todavia tengan tips_model_id='gemma3-1b-q8' antes de que la migracion corra),
        // pero el resto del sistema prefiere 4b en candidatos y default.
        "gemma3-1b-q8" => "gemma3:1b",
        "gemma3-4b-q4" => "gemma3:4b",
        other => other,
    }
}

// ─── Resolución tier-aware del modelo de tips ─────────────────────────────────

/// Modelo ligero de tips para hardware tier Low (CPU-only con specs bajas).
pub const LOW_TIER_TIPS_MODEL: &str = "gemma3-1b-q8";

/// Resultado de resolver el modelo efectivo de tips del coach.
pub enum TipsResolution {
    /// Modelo instalado en disco, listo para usar.
    Use(String),
    /// Ningún candidato instalado: tips-LLM deshabilitados. `preferred` es el
    /// modelo que falta descargar (en tier Low: el 1B).
    Unavailable { preferred: String },
}

/// Orden de candidatos según hardware. En tier Low el tradeoff de §4.1 se
/// invierte: el 4b bajo carga no produce tips (timeouts de 30s del sidecar,
/// logs de usuario 2026-07-06 y 2026-07-10), así que sin elección explícita
/// del usuario el ÚNICO candidato es el 1B — si falta en disco, el caller
/// deshabilita los tips y dispara la descarga, en vez de caer a 4b.
/// "Elección explícita" = valor en DB distinto del default que fuerzan las
/// migraciones (20260429000000). En Medium+ se mantiene §4.1: 4b primero.
fn tips_model_candidates(
    db_model: Option<&str>,
    configured_model: Option<&str>,
    tier: &PerformanceTier,
) -> Vec<String> {
    let explicit_db = db_model.filter(|m| !m.is_empty() && *m != DEFAULT_TIPS_MODEL);
    let is_low = *tier == PerformanceTier::Low;

    if is_low && explicit_db.is_none() {
        return vec![LOW_TIER_TIPS_MODEL.to_string()];
    }

    fn push(out: &mut Vec<String>, m: &str) {
        if !m.is_empty() && !out.iter().any(|x| x == m) {
            out.push(m.to_string());
        }
    }

    let mut out: Vec<String> = Vec::new();
    if let Some(db) = db_model {
        push(&mut out, db);
    }
    if is_low {
        push(&mut out, LOW_TIER_TIPS_MODEL);
    }
    if let Some(cfg) = configured_model {
        push(&mut out, cfg);
    }
    push(&mut out, DEFAULT_TIPS_MODEL);
    push(&mut out, "qwen25-3b-q4");
    out
}

/// Resuelve el modelo efectivo de tips: primer candidato instalado en disco.
/// Compartido por el warmup del arranque (lib.rs) y `live_feedback::start`,
/// para que ambos carguen EL MISMO modelo — antes el warmup leía la DB sin
/// lógica de tier y podía precargar 4b mientras el coach usaba 1b (dos
/// modelos residentes en una máquina de 8 GB).
pub async fn resolve_effective_tips_model<R: Runtime>(
    app: &tauri::AppHandle<R>,
    configured_model: Option<&str>,
) -> TipsResolution {
    let db_model: Option<String> =
        if let Some(state) = app.try_state::<crate::state::AppState>() {
            let pool = state.db_manager.pool();
            sqlx::query_scalar::<_, String>(
                "SELECT tips_model_id FROM coach_settings WHERE id = '1'",
            )
            .fetch_optional(pool)
            .await
            .ok()
            .flatten()
        } else {
            None
        };

    let tier = HardwareProfile::detect().performance_tier.clone();
    if tier == PerformanceTier::Low {
        info!(
            "Coach: hardware tier Low — priorizando modelo 1B ({}) sobre §4.1",
            LOW_TIER_TIPS_MODEL
        );
    }

    let candidates = tips_model_candidates(db_model.as_deref(), configured_model, &tier);

    let installed = candidates
        .iter()
        .find(|id| {
            model_registry::get_model(id).is_some()
                && is_model_installed(app, id)
                && !map_to_builtin_id(id).is_empty()
        })
        .cloned();

    match installed {
        Some(m) => TipsResolution::Use(m),
        None => TipsResolution::Unavailable {
            preferred: candidates
                .first()
                .cloned()
                .unwrap_or_else(|| DEFAULT_TIPS_MODEL.to_string()),
        },
    }
}

#[cfg(test)]
mod tips_model_candidates_tests {
    use super::*;

    #[test]
    fn low_sin_eleccion_explicita_solo_1b() {
        // El default forzado por la migración 20260429000000 NO cuenta como
        // elección del usuario: en tier Low el único candidato es el 1B.
        let c = tips_model_candidates(
            Some("gemma3-4b-q4"),
            Some("gemma3-4b-q4"),
            &PerformanceTier::Low,
        );
        assert_eq!(c, vec!["gemma3-1b-q8".to_string()]);
    }

    #[test]
    fn low_sin_valor_en_db_solo_1b() {
        let c = tips_model_candidates(None, None, &PerformanceTier::Low);
        assert_eq!(c, vec!["gemma3-1b-q8".to_string()]);
    }

    #[test]
    fn low_con_eleccion_explicita_respeta_db_y_conserva_1b() {
        let c = tips_model_candidates(
            Some("qwen25-3b-q4"),
            Some("gemma3-4b-q4"),
            &PerformanceTier::Low,
        );
        assert_eq!(
            c,
            vec![
                "qwen25-3b-q4".to_string(),
                "gemma3-1b-q8".to_string(),
                "gemma3-4b-q4".to_string(),
            ]
        );
    }

    #[test]
    fn medium_mantiene_orden_4_1() {
        let c = tips_model_candidates(
            Some("gemma3-4b-q4"),
            Some("gemma3-4b-q4"),
            &PerformanceTier::Medium,
        );
        assert_eq!(
            c,
            vec!["gemma3-4b-q4".to_string(), "qwen25-3b-q4".to_string()]
        );
    }

    #[test]
    fn high_con_db_custom_va_primero() {
        let c = tips_model_candidates(Some("gemma3-12b-q4"), None, &PerformanceTier::High);
        assert_eq!(
            c,
            vec![
                "gemma3-12b-q4".to_string(),
                "gemma3-4b-q4".to_string(),
                "qwen25-3b-q4".to_string(),
            ]
        );
    }
}
