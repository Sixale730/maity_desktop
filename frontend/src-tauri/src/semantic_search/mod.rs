//! Búsqueda semántica local sobre transcripciones (Wave C2+C3).
//!
//! Pipeline:
//! 1. embed_text(): embeddings via Ollama API (modelo `nomic-embed-text` por defecto, 768d).
//!    Privacidad total: localhost:11434, sin egreso de datos.
//! 2. SQLite tabla `transcript_embeddings` con BLOB de f32 little-endian.
//! 3. cosine_similarity() en Rust puro sobre rows decodificados.
//!
//! Inspirado en patrón Director (multimodal semantic search) pero adaptado a:
//! - Texto-only (no video/audio embeddings)
//! - Storage embebido SQLite (no Qdrant/Milvus remoto)
//! - Sin nuevas deps Rust pesadas

pub mod commands;
pub mod embedder;
pub mod repository;

use serde::{Deserialize, Serialize};

/// Modelo embed por defecto. El usuario debe `ollama pull nomic-embed-text`.
pub const DEFAULT_EMBED_MODEL: &str = "nomic-embed-text";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub meeting_id: String,
    pub segment_id: String,
    pub text: String,
    pub score: f32,
    pub audio_start_time: Option<f64>,
    pub audio_end_time: Option<f64>,
    pub source_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexResult {
    pub meeting_id: String,
    pub indexed_count: u32,
    pub skipped_count: u32,
    pub model: String,
    pub elapsed_ms: u64,
}

/// Calcula cosine similarity entre dos vectores f32 de la misma dimensión.
/// Devuelve 0.0 si normas son 0.
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let mut dot = 0.0_f32;
    let mut na = 0.0_f32;
    let mut nb = 0.0_f32;
    for i in 0..a.len() {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    let denom = na.sqrt() * nb.sqrt();
    if denom == 0.0 { 0.0 } else { dot / denom }
}

/// Serializa Vec<f32> a BLOB (little-endian, 4 bytes por float).
pub fn embedding_to_bytes(emb: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(emb.len() * 4);
    for v in emb {
        out.extend_from_slice(&v.to_le_bytes());
    }
    out
}

/// Deserializa BLOB a Vec<f32>. Devuelve error si longitud no es múltiplo de 4.
pub fn bytes_to_embedding(bytes: &[u8]) -> Result<Vec<f32>, String> {
    if bytes.len() % 4 != 0 {
        return Err(format!("BLOB length {} not divisible by 4", bytes.len()));
    }
    let mut out = Vec::with_capacity(bytes.len() / 4);
    for chunk in bytes.chunks_exact(4) {
        let arr = [chunk[0], chunk[1], chunk[2], chunk[3]];
        out.push(f32::from_le_bytes(arr));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cosine_identical_vectors_return_one() {
        let a = vec![1.0_f32, 2.0, 3.0];
        let b = vec![1.0_f32, 2.0, 3.0];
        let sim = cosine_similarity(&a, &b);
        assert!((sim - 1.0).abs() < 1e-5);
    }

    #[test]
    fn cosine_orthogonal_vectors_return_zero() {
        let a = vec![1.0_f32, 0.0];
        let b = vec![0.0_f32, 1.0];
        let sim = cosine_similarity(&a, &b);
        assert!(sim.abs() < 1e-5);
    }

    #[test]
    fn cosine_opposite_vectors_return_minus_one() {
        let a = vec![1.0_f32, 1.0];
        let b = vec![-1.0_f32, -1.0];
        let sim = cosine_similarity(&a, &b);
        assert!((sim + 1.0).abs() < 1e-5);
    }

    #[test]
    fn cosine_empty_vectors_return_zero() {
        let a: Vec<f32> = vec![];
        let b: Vec<f32> = vec![];
        assert_eq!(cosine_similarity(&a, &b), 0.0);
    }

    #[test]
    fn cosine_zero_norm_returns_zero() {
        let a = vec![0.0_f32, 0.0, 0.0];
        let b = vec![1.0_f32, 1.0, 1.0];
        assert_eq!(cosine_similarity(&a, &b), 0.0);
    }

    #[test]
    fn cosine_different_dim_returns_zero() {
        let a = vec![1.0_f32, 2.0];
        let b = vec![1.0_f32, 2.0, 3.0];
        assert_eq!(cosine_similarity(&a, &b), 0.0);
    }

    #[test]
    fn embedding_round_trip_through_bytes() {
        let original = vec![0.0_f32, 0.5, -0.3, 1.234, -42.0];
        let bytes = embedding_to_bytes(&original);
        assert_eq!(bytes.len(), 5 * 4);
        let decoded = bytes_to_embedding(&bytes).unwrap();
        assert_eq!(decoded.len(), original.len());
        for (a, b) in original.iter().zip(decoded.iter()) {
            assert!((a - b).abs() < 1e-6);
        }
    }

    #[test]
    fn bytes_to_embedding_rejects_invalid_length() {
        let bad = vec![1u8, 2, 3, 4, 5]; // 5 bytes, not divisible by 4
        assert!(bytes_to_embedding(&bad).is_err());
    }
}
