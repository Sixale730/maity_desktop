// Model definitions and prompt templates for built-in AI summary generation
// Designed for easy extension - just add new entries to get_available_models()

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

// ============================================================================
// Model Definitions
// ============================================================================

/// Sampling parameters for text generation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SamplingParams {
    /// Temperature - controls randomness (0.0 = deterministic, 1.0 = balanced, 2.0 = very creative)
    pub temperature: f32,

    /// Top-K sampling - limits vocabulary to top K tokens (0 = disabled)
    pub top_k: i32,

    /// Top-P (nucleus) sampling - cumulative probability threshold (1.0 = disabled)
    pub top_p: f32,

    /// Stop tokens - generation stops when any of these appear in output
    pub stop_tokens: Vec<String>,
}

/// Caso de uso para el cual el modelo esta optimizado.
/// Usado por la UI de seleccion de modelos para sugerir el modelo correcto
/// segun el caso (coach=tips rapidos, summary=resumenes largos, both=ambos).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ModelTier {
    /// Optimo para tips rapidos del coach (modelos chicos: Gemma 1B Q8).
    /// Usar n_ctx pequeno y max_tokens bajo para minimizar latencia.
    Coach,
    /// Optimo para resumenes y evaluaciones largas (modelos balanceados o grandes).
    Summary,
    /// Sirve para ambos casos. Default para no-romper compat con setup actual.
    Both,
}

impl Default for ModelTier {
    fn default() -> Self {
        ModelTier::Both
    }
}

/// Definition of a built-in AI model with all metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelDef {
    /// Model name in format "family:variant" (e.g., "gemma3:1b")
    /// This is what's stored in database as model field when provider="builtin-ai"
    pub name: String,

    /// Display name for UI (e.g., "Gemma 3 1B (Fast)")
    pub display_name: String,

    /// GGUF filename on disk (e.g., "gemma-3-1b-it-q4_0.gguf")
    pub gguf_file: String,

    /// Template name for prompt formatting (e.g., "gemma3")
    pub template: String,

    /// Download URL (HuggingFace or other source)
    pub download_url: String,

    /// File size in MB
    pub size_mb: u64,

    /// Context window size in tokens (configurable per model!)
    /// This is used for chunking in processor.rs
    pub context_size: u32,

    /// Model layer count (for GPU offloading calculation)
    pub layer_count: u32,

    /// Sampling parameters for this model
    pub sampling: SamplingParams,

    /// Short description for UI
    pub description: String,

    /// Caso de uso optimo: coach (tips rapidos), summary (resumenes), both.
    /// Default = Both para no romper compat con modelos viejos.
    #[serde(default)]
    pub tier: ModelTier,
}

impl ModelDef {
    /// Rango de tamano aceptable del .gguf en MB: `size_mb` con ±10% de tolerancia.
    ///
    /// Vive aqui, junto al registry, para que exista UN solo umbral por modelo.
    /// Antes `onboarding.rs` se inventaba los suyos (1.8 GB para el 4b, 800 MB para
    /// el 1b), que no coincidian con estos ni entre si.
    pub fn size_bounds_mb(&self) -> (u64, u64) {
        let min = (self.size_mb as f64 * 0.9) as u64;
        let max = (self.size_mb as f64 * 1.1) as u64;
        (min, max)
    }

    /// True si un archivo de `file_size_mb` es un .gguf plausible para este modelo.
    pub fn accepts_file_size_mb(&self, file_size_mb: u64) -> bool {
        let (min, max) = self.size_bounds_mb();
        file_size_mb >= min && file_size_mb <= max
    }
}

/// Hay al menos UN modelo del registry valido en `models_dir`.
///
/// Sincrona y sin estado a proposito: la usa el reconciliador del onboarding, que
/// corre en el arranque, antes (y a veces en lugar) de que exista un `ModelManager`
/// en el app state — `init_model_manager_at_startup` solo se llama cuando el proveedor
/// de resumen configurado es `builtin-ai`.
///
/// No pregunta por un modelo CONCRETO a proposito: `builtin_ai_get_recommended_model`
/// entrega `gemma3:1b` en toda maquina que no sea macOS >16GB, asi que exigir el 4b
/// marcaria como "instalacion rota" justo lo que el recomendador produce.
pub fn any_model_on_disk(models_dir: &Path) -> bool {
    get_available_models().iter().any(|def| {
        let path = models_dir.join(&def.gguf_file);
        std::fs::metadata(&path)
            .map(|meta| meta.is_file() && def.accepts_file_size_mb(meta.len() / (1024 * 1024)))
            .unwrap_or(false)
    })
}

/// Get all available built-in AI models
/// Add new models here - the system will automatically detect and manage them
pub fn get_available_models() -> Vec<ModelDef> {
    vec![
        // Gemma 3 1B - Fast tier (optimo para tips del coach)
        ModelDef {
            name: "gemma3:1b".to_string(),
            display_name: "Gemma 3 1B (Fast)".to_string(),
            gguf_file: "gemma-3-1b-it-Q8_0.gguf".to_string(),
            template: "gemma3".to_string(),
            download_url: "https://huggingface.co/ggml-org/gemma-3-1b-it-GGUF/resolve/main/gemma-3-1b-it-Q8_0.gguf".to_string(),
            size_mb: 1019,
            context_size: 32768,
            layer_count: 26,
            sampling: SamplingParams {
                temperature: 1.0,
                top_k: 64,
                top_p: 0.95,
                stop_tokens: vec!["<end_of_turn>".to_string()],
            },
            description: "Fastest model. Runs on any hardware with ~1GB RAM. Good for quick summaries.".to_string(),
            tier: ModelTier::Coach,
        },
        ModelDef {
            name: "gemma3:4b".to_string(),
            display_name: "Gemma 3 4B (Balanced)".to_string(),
            gguf_file: "gemma-3-4b-it-Q4_K_M.gguf".to_string(),
            template: "gemma3".to_string(),
            download_url: "https://huggingface.co/ggml-org/gemma-3-4b-it-GGUF/resolve/main/gemma-3-4b-it-Q4_K_M.gguf".to_string(),
            size_mb: 2374,
            context_size: 32768, // Supports 128k, but 32k is good for local·
            layer_count: 35,
            sampling: SamplingParams {
                temperature: 1.0,
                top_k: 64,
                top_p: 0.95,
                stop_tokens: vec!["<end_of_turn>".to_string()],
            },
            description: "Balanced model. Great quality/speed trade-off. Requires ~3.5GB RAM.".to_string(),
            tier: ModelTier::Both,
        },
    ]
}

/// Devuelve los modelos optimos para un caso de uso (coach o summary).
/// Util para que la UI sugiera modelos al usuario segun donde los va a usar.
/// Modelos con tier=Both aparecen en ambos listados.
pub fn get_models_for_tier(tier: ModelTier) -> Vec<ModelDef> {
    get_available_models()
        .into_iter()
        .filter(|m| m.tier == tier || m.tier == ModelTier::Both)
        .collect()
}

/// Get a specific model by name
pub fn get_model_by_name(name: &str) -> Option<ModelDef> {
    get_available_models().into_iter().find(|m| m.name == name)
}

/// Get the default model (first in list)
pub fn get_default_model() -> ModelDef {
    get_available_models()
        .into_iter()
        .next()
        .expect("At least one model must be defined")
}

/// Resolve model name to full file path in the models directory
pub fn get_model_path(app_data_dir: &PathBuf, model_name: &str) -> Result<PathBuf> {
    let model = get_model_by_name(model_name)
        .ok_or_else(|| anyhow!("Unknown model: {}", model_name))?;

    let models_dir = get_models_directory(app_data_dir);
    let model_path = models_dir.join(&model.gguf_file);

    Ok(model_path)
}

/// Get the models directory path for built-in AI
pub fn get_models_directory(app_data_dir: &PathBuf) -> PathBuf {
    app_data_dir.join("models").join("summary")
}

// ============================================================================
// Prompt Templates (Model-Specific Formatting)
// ============================================================================

/// Gemma 3 chat template format
pub const GEMMA3_TEMPLATE: &str = "\
<start_of_turn>user
{system_prompt}<end_of_turn>
<start_of_turn>user
{user_prompt}<end_of_turn>
<start_of_turn>model
";

/// Format a prompt using the specified template
///
/// # Arguments
/// * `template_name` - Template identifier (e.g., "gemma3", "chatml", "llama3")
/// * `system_prompt` - System message (instructions for the model)
/// * `user_prompt` - User message (actual task/question)
///
/// # Returns
/// Formatted prompt string ready to send to llama-helper
pub fn format_prompt(
    template_name: &str,
    system_prompt: &str,
    user_prompt: &str,
) -> Result<String> {
    let template = match template_name {
        "gemma3" => GEMMA3_TEMPLATE,
        _ => return Err(anyhow!("Unknown template: {}", template_name)),
    };

    let formatted = template
        .replace("{system_prompt}", system_prompt)
        .replace("{user_prompt}", user_prompt);

    Ok(formatted)
}

// ============================================================================
// Configuration Constants
// ============================================================================

/// Default max tokens for generation (increased for better summary quality)
pub const DEFAULT_MAX_TOKENS: i32 = 4096;

/// Idle timeout for sidecar (seconds) - can be overridden via LLAMA_IDLE_TIMEOUT env var
pub const DEFAULT_IDLE_TIMEOUT_SECS: u64 = 300; // 5 minutes

/// Generation timeout (how long to wait for a response)
pub const GENERATION_TIMEOUT_SECS: u64 = 900; // 15 minutes

/// n_ctx efectivo acotado por la RAM del equipo. llama.cpp reserva el KV
/// cache COMPLETO de n_ctx al crear el contexto (~139 KiB/token en gemma-3-4b
/// → 32768 tokens ≈ 4.3 GiB anónimos, no evictables): en máquinas de 8-16 GB
/// el n_ctx nominal del registry provoca swap y congela el equipo. Mismo
/// criterio que el fix de n_ctx del coach (coach/llm_service.rs, 32768→4096).
/// El chunker de summary/service.rs DEBE usar este mismo valor para que los
/// prompts quepan en el contexto real.
pub fn effective_context_size(model_def: &ModelDef) -> u32 {
    let ram_gb = crate::audio::hardware_detector::HardwareProfile::detect().memory_gb as u64;
    effective_context_size_for_ram(model_def.context_size, ram_gb)
}

/// Lógica pura, testeable sin depender del hardware real.
fn effective_context_size_for_ram(nominal: u32, ram_gb: u64) -> u32 {
    let cap: u32 = if ram_gb < 16 {
        8192
    } else if ram_gb < 32 {
        16384
    } else {
        return nominal;
    };
    nominal.min(cap)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gemma3_1b_is_coach_tier() {
        let m = get_model_by_name("gemma3:1b").expect("gemma3:1b en registry");
        assert_eq!(m.tier, ModelTier::Coach);
    }

    #[test]
    fn gemma3_4b_is_both_tier() {
        let m = get_model_by_name("gemma3:4b").expect("gemma3:4b en registry");
        assert_eq!(m.tier, ModelTier::Both);
    }

    #[test]
    fn coach_tier_includes_1b_and_4b() {
        // Coach tier debe incluir modelos Coach + Both (4b sirve como fallback).
        let coach_models = get_models_for_tier(ModelTier::Coach);
        let names: Vec<String> = coach_models.iter().map(|m| m.name.clone()).collect();
        assert!(names.contains(&"gemma3:1b".to_string()), "1b deberia estar en coach tier");
        assert!(names.contains(&"gemma3:4b".to_string()), "4b (Both) deberia estar en coach tier");
    }

    #[test]
    fn summary_tier_excludes_coach_only() {
        // Summary tier debe incluir solo modelos Summary + Both, NO Coach-only.
        let summary_models = get_models_for_tier(ModelTier::Summary);
        let names: Vec<String> = summary_models.iter().map(|m| m.name.clone()).collect();
        assert!(!names.contains(&"gemma3:1b".to_string()), "1b (Coach-only) NO debe aparecer en summary tier");
        assert!(names.contains(&"gemma3:4b".to_string()), "4b (Both) debe aparecer en summary tier");
    }

    #[test]
    fn effective_context_se_acota_por_ram() {
        // <16 GB: cap 8192 (KV de 32768 = ~4.3 GiB, inviable en 8 GB)
        assert_eq!(effective_context_size_for_ram(32768, 8), 8192);
        assert_eq!(effective_context_size_for_ram(32768, 15), 8192);
        // 16-31 GB: cap 16384
        assert_eq!(effective_context_size_for_ram(32768, 16), 16384);
        assert_eq!(effective_context_size_for_ram(32768, 31), 16384);
        // >=32 GB: nominal completo
        assert_eq!(effective_context_size_for_ram(32768, 32), 32768);
        assert_eq!(effective_context_size_for_ram(32768, 64), 32768);
        // Un nominal ya chico nunca se agranda
        assert_eq!(effective_context_size_for_ram(4096, 8), 4096);
        assert_eq!(effective_context_size_for_ram(4096, 64), 4096);
    }
}
