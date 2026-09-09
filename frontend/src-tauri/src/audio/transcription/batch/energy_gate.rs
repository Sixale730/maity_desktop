// audio/transcription/batch/energy_gate.rs
//
// Compuerta de energía para el modo lote: separa voz de silencio SIN Silero.
// En lote no hace falta la precisión frame a frame del VAD neural — basta con
// no mandarle silencio a Parakeet (el silencio es donde alucina) y no cortar
// palabras. RMS por bloque de 100 ms con umbral adaptativo, pre-pad de 200 ms,
// hangover de 500 ms y fusión de huecos cortos.
//
// Diseño incremental: el decoder entrega ventanas (~60 s) y la compuerta
// mantiene estado entre ventanas (filtro HP, piso de ruido, región abierta),
// así el segmento nunca vive entero en RAM. La máquina de estados es pura
// respecto a sus entradas y se prueba con audio sintético.
//
// Fusión de huecos: una región solo se cierra tras `CLOSE_AFTER_BLOCKS`
// (hangover + merge gap = 800 ms) de silencio CONTINUO; huecos menores quedan
// dentro de la región (con su silencio, que a un modelo por lotes no le
// estorba). Al cerrar, la cola de silencio se recorta al hangover (500 ms).

use std::collections::VecDeque;

use crate::audio::dsp::{dc_remove, high_pass_80hz, HighPassState};

use super::decoder::SAMPLE_RATE;

/// Bloque de análisis: 100 ms a 16 kHz.
pub(crate) const BLOCK_SAMPLES: usize = SAMPLE_RATE as usize / 10;
/// Cola de silencio que se conserva tras la última voz (500 ms).
const HANGOVER_BLOCKS: usize = 5;
/// Contexto antes del arranque de voz (200 ms) para no cortar ataques.
const PREPAD_BLOCKS: usize = 2;
/// Huecos de hasta 300 ms DESPUÉS del hangover no cierran la región.
const MERGE_GAP_BLOCKS: usize = 3;
/// Silencio continuo que cierra una región: hangover + merge gap = 800 ms.
const CLOSE_AFTER_BLOCKS: usize = HANGOVER_BLOCKS + MERGE_GAP_BLOCKS;
/// Regiones con menos voz que esto (300 ms) se descartan como ruido/click.
const MIN_VOICED_BLOCKS: usize = 3;
/// Piso absoluto del umbral: por debajo de esto nada cuenta como voz.
const MIN_THRESHOLD: f32 = 0.006;
/// El umbral es `noise_floor * FACTOR`, acotado por MIN_THRESHOLD.
const THRESHOLD_FACTOR: f32 = 3.0;
/// Fuga multiplicativa del piso de ruido por bloque: sube ~3.3x en 10 min de
/// voz continua (se adapta a cambios reales de ruido sin perseguir la voz).
const NOISE_FLOOR_LEAK: f32 = 1.002;
const NOISE_FLOOR_INIT: f32 = 0.01;

/// Región hablada cerrada, con sus muestras (ya filtradas DC+HP) y el RMS por
/// bloque de 100 ms — el chunker usa los RMS para elegir puntos de corte.
#[derive(Debug)]
pub(crate) struct VoicedRegion {
    /// Offset absoluto de la primera muestra dentro del canal (a 16 kHz).
    pub start_sample_abs: u64,
    pub samples: Vec<f32>,
    pub block_rms: Vec<f32>,
}

impl VoicedRegion {
    pub(crate) fn duration_secs(&self) -> f64 {
        self.samples.len() as f64 / SAMPLE_RATE as f64
    }
}

#[derive(Debug)]
struct RegionAccum {
    start_block: u64,
    samples: Vec<f32>,
    block_rms: Vec<f32>,
    voiced_blocks: usize,
    /// Bloques silenciosos consecutivos al final de la región.
    trailing_silent: usize,
}

pub(crate) struct EnergyGate {
    hp: HighPassState,
    noise_floor: f32,
    /// Muestras que aún no completan un bloque de 100 ms.
    partial: Vec<f32>,
    /// Índice absoluto del PRÓXIMO bloque a procesar.
    next_block: u64,
    /// Últimos bloques silenciosos (índice, muestras) para el pre-pad.
    prepad: VecDeque<(u64, Vec<f32>, f32)>,
    current: Option<RegionAccum>,
    closed: Vec<VoicedRegion>,
}

impl EnergyGate {
    pub(crate) fn new() -> Self {
        Self {
            hp: HighPassState::new(),
            noise_floor: NOISE_FLOOR_INIT,
            partial: Vec::with_capacity(BLOCK_SAMPLES),
            next_block: 0,
            prepad: VecDeque::with_capacity(PREPAD_BLOCKS + 1),
            current: None,
            closed: Vec::new(),
        }
    }

    /// Alimenta muestras (mono 16 kHz). Procesa los bloques completos que se
    /// formen; el resto queda en `partial` para la siguiente llamada.
    pub(crate) fn push(&mut self, samples: &[f32]) {
        let mut offset = 0;
        while offset < samples.len() {
            let need = BLOCK_SAMPLES - self.partial.len();
            let take = need.min(samples.len() - offset);
            self.partial.extend_from_slice(&samples[offset..offset + take]);
            offset += take;
            if self.partial.len() == BLOCK_SAMPLES {
                let block = std::mem::replace(
                    &mut self.partial,
                    Vec::with_capacity(BLOCK_SAMPLES),
                );
                self.process_block(block);
            }
        }
    }

    /// Drena las regiones cerradas hasta ahora (para procesarlas y soltarlas
    /// sin esperar el final del canal).
    pub(crate) fn take_closed(&mut self) -> Vec<VoicedRegion> {
        std::mem::take(&mut self.closed)
    }

    /// Fin del canal: cierra la región abierta (si aporta voz suficiente) y
    /// devuelve todo lo pendiente. El resto de `partial` (<100 ms) se descarta.
    pub(crate) fn finish(&mut self) -> Vec<VoicedRegion> {
        if let Some(mut region) = self.current.take() {
            // Recortar la cola de silencio al hangover, como en el cierre normal.
            let trim = region.trailing_silent.saturating_sub(HANGOVER_BLOCKS);
            Self::trim_blocks(&mut region, trim);
            if region.voiced_blocks >= MIN_VOICED_BLOCKS {
                self.closed.push(Self::into_region(region));
            }
        }
        self.partial.clear();
        std::mem::take(&mut self.closed)
    }

    fn process_block(&mut self, mut block: Vec<f32>) {
        let idx = self.next_block;
        self.next_block += 1;

        // Pre-filtro (plan F1): DC + high-pass 80 Hz para que el rumble no
        // infle el RMS. El estado del HP persiste entre bloques y ventanas.
        dc_remove(&mut block);
        high_pass_80hz(&mut block, SAMPLE_RATE as f32, &mut self.hp);

        let rms = {
            let sum_sq: f32 = block.iter().map(|s| s * s).sum();
            (sum_sq / block.len() as f32).sqrt()
        };

        // Piso de ruido: baja al instante, sube por fuga lenta. Nunca 0 para
        // que el umbral relativo no colapse con silencio digital perfecto.
        self.noise_floor = rms.min(self.noise_floor * NOISE_FLOOR_LEAK).clamp(1e-5, 0.1);
        let threshold = (self.noise_floor * THRESHOLD_FACTOR).max(MIN_THRESHOLD);
        let voiced = rms >= threshold;

        match self.current.as_mut() {
            None => {
                if voiced {
                    // Arranque de región: pre-pad con los últimos bloques
                    // silenciosos contiguos.
                    let start_block = self
                        .prepad
                        .front()
                        .map(|(i, _, _)| *i)
                        .unwrap_or(idx);
                    let mut samples =
                        Vec::with_capacity((self.prepad.len() + 1) * BLOCK_SAMPLES);
                    let mut block_rms = Vec::with_capacity(self.prepad.len() + 1);
                    for (_, pad_samples, pad_rms) in self.prepad.drain(..) {
                        samples.extend_from_slice(&pad_samples);
                        block_rms.push(pad_rms);
                    }
                    samples.extend_from_slice(&block);
                    block_rms.push(rms);
                    self.current = Some(RegionAccum {
                        start_block,
                        samples,
                        block_rms,
                        voiced_blocks: 1,
                        trailing_silent: 0,
                    });
                } else {
                    // Ring de pre-pad. Contigüidad garantizada: se vacía al
                    // arrancar región y al cerrar se repuebla con la cola
                    // recortada (los bloques silenciosos más recientes).
                    self.prepad.push_back((idx, block, rms));
                    while self.prepad.len() > PREPAD_BLOCKS {
                        self.prepad.pop_front();
                    }
                }
            }
            Some(region) => {
                region.samples.extend_from_slice(&block);
                region.block_rms.push(rms);
                if voiced {
                    region.voiced_blocks += 1;
                    region.trailing_silent = 0;
                } else {
                    region.trailing_silent += 1;
                    if region.trailing_silent >= CLOSE_AFTER_BLOCKS {
                        let mut region = self.current.take().expect("region abierta");
                        // Conservar solo el hangover; los bloques recortados
                        // pasan al ring de pre-pad (son el silencio más
                        // reciente, contiguo con lo que viene).
                        let trim = CLOSE_AFTER_BLOCKS - HANGOVER_BLOCKS;
                        let trimmed = Self::trim_blocks(&mut region, trim);
                        let base_idx = region.start_block + region.block_rms.len() as u64;
                        for (k, (pad_samples, pad_rms)) in trimmed.into_iter().enumerate() {
                            self.prepad.push_back((base_idx + k as u64, pad_samples, pad_rms));
                            while self.prepad.len() > PREPAD_BLOCKS {
                                self.prepad.pop_front();
                            }
                        }
                        if region.voiced_blocks >= MIN_VOICED_BLOCKS {
                            self.closed.push(Self::into_region(region));
                        }
                    }
                }
            }
        }
    }

    /// Recorta `trim` bloques del final de la región; devuelve los recortados
    /// (en orden) para reutilizarlos como pre-pad.
    fn trim_blocks(region: &mut RegionAccum, trim: usize) -> Vec<(Vec<f32>, f32)> {
        let mut out = Vec::with_capacity(trim);
        for _ in 0..trim {
            if region.block_rms.len() <= 1 {
                break;
            }
            let rms = region.block_rms.pop().expect("rms");
            let at = region.samples.len() - BLOCK_SAMPLES;
            let samples = region.samples.split_off(at);
            out.push((samples, rms));
            region.trailing_silent = region.trailing_silent.saturating_sub(1);
        }
        out.reverse();
        out
    }

    fn into_region(region: RegionAccum) -> VoicedRegion {
        VoicedRegion {
            start_sample_abs: region.start_block * BLOCK_SAMPLES as u64,
            samples: region.samples,
            block_rms: region.block_rms,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f32::consts::PI;

    /// Bloques de voz sintética: seno 440 Hz a 0.1 de amplitud (RMS ~0.07,
    /// muy por encima del umbral) — el HP a 80 Hz no lo toca.
    fn voice(blocks: usize) -> Vec<f32> {
        (0..blocks * BLOCK_SAMPLES)
            .map(|i| 0.1 * (2.0 * PI * 440.0 * i as f32 / SAMPLE_RATE as f32).sin())
            .collect()
    }

    fn silence(blocks: usize) -> Vec<f32> {
        vec![0.0; blocks * BLOCK_SAMPLES]
    }

    fn total_voiced_secs(regions: &[VoicedRegion]) -> f64 {
        regions.iter().map(|r| r.duration_secs()).sum()
    }

    #[test]
    fn puro_silencio_no_produce_regiones() {
        let mut gate = EnergyGate::new();
        gate.push(&silence(100));
        assert!(gate.take_closed().is_empty());
        assert!(gate.finish().is_empty());
    }

    #[test]
    fn voz_aislada_lleva_prepad_y_hangover() {
        let mut gate = EnergyGate::new();
        // 10 bloques de silencio, 20 de voz, 20 de silencio.
        gate.push(&silence(10));
        gate.push(&voice(20));
        gate.push(&silence(20));
        let regions = gate.finish();
        assert_eq!(regions.len(), 1);
        let r = &regions[0];
        // Pre-pad 2 bloques: arranca en el bloque 8.
        assert_eq!(r.start_sample_abs, 8 * BLOCK_SAMPLES as u64);
        // 2 prepad + 20 voz + 5 hangover = 27 bloques.
        assert_eq!(r.block_rms.len(), 27);
        assert_eq!(r.samples.len(), 27 * BLOCK_SAMPLES);
    }

    #[test]
    fn hueco_corto_no_parte_la_region() {
        let mut gate = EnergyGate::new();
        // Voz, hueco de 600 ms (6 bloques < CLOSE_AFTER=8), más voz.
        gate.push(&voice(15));
        gate.push(&silence(6));
        gate.push(&voice(15));
        gate.push(&silence(20));
        let regions = gate.finish();
        assert_eq!(regions.len(), 1, "el hueco de 600 ms debe quedar dentro");
    }

    #[test]
    fn hueco_largo_cierra_y_abre_dos_regiones() {
        let mut gate = EnergyGate::new();
        gate.push(&voice(15));
        gate.push(&silence(15)); // 1.5 s >= 800 ms
        gate.push(&voice(15));
        gate.push(&silence(20));
        let regions = gate.finish();
        assert_eq!(regions.len(), 2);
        // La primera conserva su hangover de 5 bloques (15 voz + 5).
        assert_eq!(regions[0].block_rms.len(), 20);
        // La segunda arranca con pre-pad de 2 bloques ANTES de su voz
        // (bloque 30 de voz - 2 = 28).
        assert_eq!(regions[1].start_sample_abs, 28 * BLOCK_SAMPLES as u64);
    }

    #[test]
    fn blip_de_un_bloque_se_descarta() {
        let mut gate = EnergyGate::new();
        gate.push(&silence(10));
        gate.push(&voice(1)); // 100 ms < MIN_VOICED_BLOCKS
        gate.push(&silence(20));
        assert!(gate.finish().is_empty());
    }

    #[test]
    fn finish_cierra_la_region_abierta() {
        let mut gate = EnergyGate::new();
        gate.push(&voice(10));
        // Sin silencio final: la región sigue abierta hasta finish().
        assert!(gate.take_closed().is_empty());
        let regions = gate.finish();
        assert_eq!(regions.len(), 1);
        assert!(total_voiced_secs(&regions) > 0.9);
    }

    #[test]
    fn ventanas_partidas_equivalen_a_una_sola() {
        // Mismas muestras empujadas de a pedazos arbitrarios (simula las
        // ventanas del decoder) producen la misma región.
        let mut audio = silence(5);
        audio.extend(voice(12));
        audio.extend(silence(15));

        let mut gate_a = EnergyGate::new();
        gate_a.push(&audio);
        let ra = gate_a.finish();

        let mut gate_b = EnergyGate::new();
        for chunk in audio.chunks(777) {
            gate_b.push(chunk);
        }
        let rb = gate_b.finish();

        assert_eq!(ra.len(), rb.len());
        assert_eq!(ra[0].start_sample_abs, rb[0].start_sample_abs);
        assert_eq!(ra[0].samples.len(), rb[0].samples.len());
    }
}
