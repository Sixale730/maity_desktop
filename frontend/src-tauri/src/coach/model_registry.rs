//! Registry estático de modelos GGUF para llama.cpp.
//! Agregar un modelo nuevo = una entrada en MODELS. El resto del sistema lo recoge.

pub struct GgufModelDef {
    pub id: &'static str,
    pub name: &'static str,
    pub hf_repo: &'static str,
    pub filename: &'static str,
    pub size_gb: f32,
    pub ram_gb: f32,
    /// "tips" | "eval" | "both"
    pub use_case: &'static str,
    pub description: &'static str,
}

pub fn download_url(model: &GgufModelDef) -> String {
    format!(
        "https://huggingface.co/{}/resolve/main/{}",
        model.hf_repo, model.filename
    )
}

// NOTA: Los modelos aquí listados deben ser públicos en HuggingFace (sin gate de licencia).
// Qwen2.5 (Alibaba, Apache 2.0) y Gemma 3 vía bartowski son accesibles sin autenticación.
// Gemma 2 (Google) requería aceptar licencia → 401. Gemma 3 en repos bartowski → 200 OK.
pub const MODELS: &[GgufModelDef] = &[
    GgufModelDef {
        id: "qwen25-3b-q4",
        name: "Qwen 2.5 3B (rápido)",
        hf_repo: "bartowski/Qwen2.5-3B-Instruct-GGUF",
        filename: "Qwen2.5-3B-Instruct-Q4_K_M.gguf",
        size_gb: 2.0,
        ram_gb: 4.0,
        use_case: "tips",
        description: "Ideal para tips en vivo. Respuesta en 1-3s.",
    },
    GgufModelDef {
        id: "qwen25-7b-q4",
        name: "Qwen 2.5 7B (preciso)",
        hf_repo: "bartowski/Qwen2.5-7B-Instruct-GGUF",
        filename: "Qwen2.5-7B-Instruct-Q4_K_M.gguf",
        size_gb: 4.7,
        ram_gb: 8.0,
        use_case: "eval",
        description: "Para evaluación post-reunión. Mejor calidad.",
    },
    GgufModelDef {
        id: "qwen25-14b-q4",
        name: "Qwen 2.5 14B (máxima calidad)",
        hf_repo: "bartowski/Qwen2.5-14B-Instruct-GGUF",
        filename: "Qwen2.5-14B-Instruct-Q4_K_M.gguf",
        size_gb: 8.9,
        ram_gb: 16.0,
        use_case: "eval",
        description: "La mejor calidad disponible. Requiere 16 GB RAM.",
    },
    GgufModelDef {
        id: "gemma3-1b-q8",
        name: "Gemma 3 1B (ultra-rápido)",
        hf_repo: "bartowski/google_gemma-3-1b-it-GGUF",
        filename: "google_gemma-3-1b-it-Q8_0.gguf",
        size_gb: 1.0,
        ram_gb: 2.0,
        use_case: "both",
        description: "Ultra-rápido. Ideal para tips en vivo con latencia mínima.",
    },
    GgufModelDef {
        id: "gemma3-4b-q4",
        name: "Gemma 3 4B (balanceado)",
        hf_repo: "bartowski/google_gemma-3-4b-it-GGUF",
        filename: "google_gemma-3-4b-it-Q4_K_M.gguf",
        size_gb: 2.7,
        ram_gb: 5.0,
        use_case: "both",
        description: "Balance calidad/velocidad. Tips en vivo + evaluación post-reunión.",
    },
    GgufModelDef {
        id: "gemma3-12b-q4",
        name: "Gemma 3 12B (máxima calidad)",
        hf_repo: "bartowski/google_gemma-3-12b-it-GGUF",
        filename: "google_gemma-3-12b-it-Q4_K_M.gguf",
        size_gb: 7.7,
        ram_gb: 12.0,
        use_case: "eval",
        description: "Mayor calidad de Gemma 3. Para evaluación post-reunión con 12 GB RAM.",
    },
];

pub fn get_model(id: &str) -> Option<&'static GgufModelDef> {
    MODELS.iter().find(|m| m.id == id)
}
