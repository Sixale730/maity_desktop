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
// Gemma (Google) y Llama (Meta) requieren aceptar su licencia en HF → devuelven 401.
// Qwen2.5 (Alibaba, Apache 2.0) y Mistral son accesibles sin autenticación.
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
];

pub fn get_model(id: &str) -> Option<&'static GgufModelDef> {
    MODELS.iter().find(|m| m.id == id)
}
