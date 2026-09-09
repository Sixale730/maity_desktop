// audio/transcription/batch/chunker.rs
//
// Trocea regiones habladas largas en chunks de 10-30 s para Parakeet, cortando
// en el bloque de menor energía cercano a los 20 s (el punto más probable de
// frontera entre palabras). Regiones de ≤30 s pasan enteras. Función pura.

use super::decoder::SAMPLE_RATE;
use super::energy_gate::{VoicedRegion, BLOCK_SAMPLES};

/// Chunk listo para transcribir, con su offset absoluto para reconstruir
/// timestamps (`audio_start_time = start_sample_abs / 16000`).
#[derive(Debug)]
pub(crate) struct AudioChunk {
    pub start_sample_abs: u64,
    pub samples: Vec<f32>,
}

impl AudioChunk {
    pub(crate) fn start_secs(&self) -> f64 {
        self.start_sample_abs as f64 / SAMPLE_RATE as f64
    }

    pub(crate) fn duration_secs(&self) -> f64 {
        self.samples.len() as f64 / SAMPLE_RATE as f64
    }
}

/// Límites en bloques de 100 ms.
const TARGET_BLOCKS: usize = 200; // 20 s
const MIN_BLOCKS: usize = 100; // 10 s
const MAX_BLOCKS: usize = 300; // 30 s

/// Parte una región en chunks. El corte se elige greedy: dentro de la ventana
/// [10 s, 30 s] desde el inicio del chunk, el bloque de menor RMS; a igual
/// energía, el más cercano a 20 s. La cola final puede ser menor a 10 s (es lo
/// que queda, no un corte elegido).
pub(crate) fn chunk_region(region: VoicedRegion) -> Vec<AudioChunk> {
    let total_blocks = region.block_rms.len();
    debug_assert_eq!(region.samples.len(), total_blocks * BLOCK_SAMPLES);

    if total_blocks <= MAX_BLOCKS {
        return vec![AudioChunk {
            start_sample_abs: region.start_sample_abs,
            samples: region.samples,
        }];
    }

    let mut cuts = Vec::new();
    let mut start = 0usize;
    while total_blocks - start > MAX_BLOCKS {
        let lo = start + MIN_BLOCKS;
        let hi = (start + MAX_BLOCKS).min(total_blocks - 1);
        let target = start + TARGET_BLOCKS;
        let mut best = lo;
        let mut best_score = f32::INFINITY;
        for b in lo..=hi {
            // Distancia al target como desempate suave (1e-6 por bloque no
            // le gana nunca a una diferencia real de energía).
            let score = region.block_rms[b] + (b.abs_diff(target) as f32) * 1e-6;
            if score < best_score {
                best_score = score;
                best = b;
            }
        }
        cuts.push(best);
        start = best;
    }

    let mut chunks = Vec::with_capacity(cuts.len() + 1);
    let mut prev = 0usize;
    let mut samples = region.samples;
    for cut in cuts.iter().chain(std::iter::once(&total_blocks)) {
        let len_samples = (cut - prev) * BLOCK_SAMPLES;
        let rest = samples.split_off(len_samples);
        chunks.push(AudioChunk {
            start_sample_abs: region.start_sample_abs + (prev * BLOCK_SAMPLES) as u64,
            samples,
        });
        samples = rest;
        prev = *cut;
    }
    chunks
}

#[cfg(test)]
mod tests {
    use super::*;

    fn region(blocks: usize, dips: &[usize]) -> VoicedRegion {
        let mut block_rms = vec![0.08_f32; blocks];
        for &d in dips {
            block_rms[d] = 0.001;
        }
        VoicedRegion {
            start_sample_abs: 5 * BLOCK_SAMPLES as u64,
            samples: vec![0.1; blocks * BLOCK_SAMPLES],
            block_rms,
        }
    }

    #[test]
    fn region_corta_pasa_entera() {
        let chunks = chunk_region(region(250, &[]));
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].start_sample_abs, 5 * BLOCK_SAMPLES as u64);
        assert_eq!(chunks[0].samples.len(), 250 * BLOCK_SAMPLES);
    }

    #[test]
    fn corta_en_el_hueco_mas_cercano_a_20s() {
        // 65 s (650 bloques) con huecos en 150 (15 s) y 210 (21 s): debe
        // preferir 210 (más cerca del target 200 y misma energía).
        let chunks = chunk_region(region(650, &[150, 210]));
        assert_eq!(chunks.len(), 3, "650 bloques → 3 chunks");
        assert_eq!(chunks[0].samples.len(), 210 * BLOCK_SAMPLES);
        // El segundo corte cae en la ventana [310, 510]: sin huecos, el
        // desempate lo lleva al target 410.
        assert_eq!(chunks[1].samples.len(), 200 * BLOCK_SAMPLES);
        // Continuidad: offsets consecutivos y sin pérdida de muestras.
        let total: usize = chunks.iter().map(|c| c.samples.len()).sum();
        assert_eq!(total, 650 * BLOCK_SAMPLES);
        let mut expected = 5 * BLOCK_SAMPLES as u64;
        for c in &chunks {
            assert_eq!(c.start_sample_abs, expected);
            expected += c.samples.len() as u64;
        }
    }

    #[test]
    fn sin_huecos_corta_en_el_target() {
        let chunks = chunk_region(region(450, &[]));
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].samples.len(), 200 * BLOCK_SAMPLES);
        assert_eq!(chunks[1].samples.len(), 250 * BLOCK_SAMPLES);
    }

    #[test]
    fn ningun_chunk_supera_30s() {
        let chunks = chunk_region(region(1000, &[]));
        for c in &chunks {
            assert!(c.duration_secs() <= 30.0 + f64::EPSILON, "{}", c.duration_secs());
        }
        let total: usize = chunks.iter().map(|c| c.samples.len()).sum();
        assert_eq!(total, 1000 * BLOCK_SAMPLES);
    }
}
