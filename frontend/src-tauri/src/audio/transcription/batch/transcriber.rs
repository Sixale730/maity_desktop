// audio/transcription/batch/transcriber.rs
//
// Orquestador del lote: decodifica los dos canales del audio.mp4, filtra voz
// con la compuerta de energía, trocea en chunks de 10-30 s y transcribe con
// Parakeet, reconstruyendo timestamps y escribiendo el mismo transcripts.json
// del streaming (vía writer.rs).
//
// El proveedor del lote es SIEMPRE Parakeet local (decisión de producto de la
// migración): `ensure_stt_warm_parakeet` ignora el provider configurado.
// Mientras corre, el lease `BatchSttLease` impide que logout/reposo descarguen
// el motor a mitad de un job.
//
// #16 (auditoría): la inferencia de cada chunk corre en `spawn_blocking` — el
// cómputo ONNX no bloquea un worker del runtime async ni en lote.

use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

use log::{info, warn};
use serde::Serialize;
use tauri::{AppHandle, Runtime};

use super::chunker::{chunk_region, AudioChunk};
use super::decoder::{BatchChannel, ChannelDecoder, SAMPLE_RATE};
use super::energy_gate::{EnergyGate, VoicedRegion};
use super::writer::{build_segments, write_transcripts, BatchSegmentDraft};
use crate::audio::transcription::engine::{self, WarmOutcome};
use crate::audio::transcription::spanish_postprocess;

/// Métricas de un job de lote — el instrumento de la F1 para decidir el flip:
/// WER se compara contra el transcripts.json del streaming; RTF y pico de RAM
/// calibran el planner de la F2.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchMetrics {
    /// Duración del audio decodificado (max de ambos canales), en segundos.
    pub audio_secs: f64,
    /// Suma de regiones habladas de ambos canales, en segundos.
    pub voiced_secs: f64,
    pub wall_ms: u64,
    /// `wall / audio`: <1.0 = más rápido que tiempo real.
    pub rtf: f64,
    pub segments: usize,
    pub words: usize,
    pub discarded_hallucinations: usize,
    pub output_file: String,
}

/// Comando DEV (F1 del plan de lote, sin UI): corre el pipeline por lote sobre
/// una carpeta de grabación existente y escribe `transcripts.batch.json` AL
/// LADO del `transcripts.json` de streaming — nunca lo pisa. Se invoca desde
/// la consola de DevTools para medir WER sobre AAC 64k y RTF real:
/// `await __TAURI__.core.invoke('batch_transcribe_folder', { folderPath: '...' })`
#[tauri::command]
pub async fn batch_transcribe_folder<R: Runtime>(
    app: AppHandle<R>,
    folder_path: String,
) -> Result<BatchMetrics, String> {
    transcribe_folder(&app, Path::new(&folder_path), "transcripts.batch.json").await
}

/// Corre el lote completo sobre una carpeta de grabación (`audio.mp4` dentro).
/// Escribe los segmentos a `output_filename` en la misma carpeta.
pub(crate) async fn transcribe_folder<R: Runtime>(
    app: &AppHandle<R>,
    folder: &Path,
    output_filename: &str,
) -> Result<BatchMetrics, String> {
    let audio_path = folder.join("audio.mp4");
    if !audio_path.exists() {
        return Err(format!("No existe {}", audio_path.display()));
    }
    let ffmpeg = crate::audio::ffmpeg::find_ffmpeg_path()
        .ok_or_else(|| "ffmpeg no disponible para el decode por lote".to_string())?;

    // Lease ANTES de calentar: desde aquí ni el logout ni el reposo de tier
    // Low descargan el motor a mitad del job (se suelta al salir por Drop,
    // también en error).
    let _lease = engine::BatchSttLease::acquire();

    // Evidencia del pico de carga en modo lote (calibra BATCH_HEADROOM_MB, F0c).
    crate::logging::mem_sampler::snapshot_now("batch-load");
    match engine::ensure_stt_warm_parakeet(app, "batch").await? {
        WarmOutcome::SkippedNoSession => {
            return Err("Sin sesión: el lote no transcribe (mismo gate que la grabación)".into())
        }
        WarmOutcome::SkippedRegistration => {
            return Err("Registro incompleto: el lote no transcribe".into())
        }
        _ => {}
    }
    let engine_arc = parakeet_engine()?;

    let start = Instant::now();
    let lang_pref = crate::get_language_preference_internal();
    let mut drafts: Vec<BatchSegmentDraft> = Vec::new();
    let mut audio_secs = 0f64;
    let mut voiced_secs = 0f64;
    let mut discarded = 0usize;

    for channel in [BatchChannel::Left, BatchChannel::Right] {
        let mut decoder = ChannelDecoder::spawn(ffmpeg.clone(), &audio_path, channel).await?;
        let mut gate = EnergyGate::new();
        let mut channel_samples = 0usize;

        // Un canal completo a la vez: ventana → gate → regiones cerradas →
        // chunks → inferencia. Nada retiene el canal entero en RAM.
        while let Some(window) = decoder.next_window().await? {
            channel_samples += window.len();
            gate.push(&window);
            for region in gate.take_closed() {
                process_region(
                    &engine_arc,
                    region,
                    channel,
                    lang_pref.as_deref(),
                    &mut drafts,
                    &mut voiced_secs,
                    &mut discarded,
                )
                .await?;
            }
        }
        for region in gate.finish() {
            process_region(
                &engine_arc,
                region,
                channel,
                lang_pref.as_deref(),
                &mut drafts,
                &mut voiced_secs,
                &mut discarded,
            )
            .await?;
        }
        decoder.finish().await?;

        audio_secs = audio_secs.max(channel_samples as f64 / SAMPLE_RATE as f64);
        info!(
            "[batch] canal {:?} listo: {:.1}s de audio, {} borradores acumulados",
            channel,
            channel_samples as f64 / SAMPLE_RATE as f64,
            drafts.len()
        );
    }

    let segments = build_segments(drafts);
    let words: usize = segments
        .iter()
        .map(|s| s.text.split_whitespace().count())
        .sum();
    let count = write_transcripts(folder, output_filename, &segments)?;

    let wall_ms = start.elapsed().as_millis() as u64;
    let rtf = if audio_secs > 0.0 {
        (wall_ms as f64 / 1000.0) / audio_secs
    } else {
        0.0
    };
    crate::logging::mem_sampler::snapshot_now("batch-done");

    let metrics = BatchMetrics {
        audio_secs,
        voiced_secs,
        wall_ms,
        rtf,
        segments: count,
        words,
        discarded_hallucinations: discarded,
        output_file: folder.join(output_filename).to_string_lossy().to_string(),
    };
    info!(
        "[batch] job listo: {:.1}s audio, {:.1}s con voz, {} segmentos, {} palabras, RTF {:.2}",
        metrics.audio_secs, metrics.voiced_secs, metrics.segments, metrics.words, metrics.rtf
    );
    Ok(metrics)
}

/// Trocea una región y transcribe sus chunks, acumulando borradores con el
/// mismo post-procesado que el worker de streaming (anti-hallucination +
/// enhance).
async fn process_region(
    engine: &Arc<crate::parakeet_engine::ParakeetEngine>,
    region: VoicedRegion,
    channel: BatchChannel,
    lang_pref: Option<&str>,
    drafts: &mut Vec<BatchSegmentDraft>,
    voiced_secs: &mut f64,
    discarded: &mut usize,
) -> Result<(), String> {
    *voiced_secs += region.duration_secs();
    for chunk in chunk_region(region) {
        let start_secs = chunk.start_secs();
        let duration_secs = chunk.duration_secs();
        let raw = transcribe_chunk(engine, chunk).await?;
        let raw = raw.trim();
        if raw.is_empty() {
            continue;
        }
        if spanish_postprocess::is_hallucination(raw, lang_pref) {
            *discarded += 1;
            info!("[batch] hallucination descartada: '{}'", raw);
            continue;
        }
        drafts.push(BatchSegmentDraft {
            text: spanish_postprocess::enhance(raw, "es"),
            start_secs,
            duration_secs,
            source_type: channel.source_type(),
        });
    }
    Ok(())
}

/// Inferencia de UN chunk en el blocking pool (#16). `Handle::block_on` es
/// legal en un hilo de `spawn_blocking` (no es worker del runtime), y el poll
/// del futuro ejecuta el cómputo ONNX ahí mismo.
async fn transcribe_chunk(
    engine: &Arc<crate::parakeet_engine::ParakeetEngine>,
    chunk: AudioChunk,
) -> Result<String, String> {
    let mut samples = chunk.samples;
    // El gate ya aplicó DC + high-pass; la normalización de pico va por chunk
    // (por bloque de 100 ms bombearía el ruido de fondo).
    crate::audio::dsp::peak_normalize_minus3db(&mut samples);

    let engine = engine.clone();
    let handle = tokio::runtime::Handle::current();
    tokio::task::spawn_blocking(move || handle.block_on(engine.transcribe_audio(samples)))
        .await
        .map_err(|e| format!("batch transcribe join: {}", e))?
        .map_err(|e| {
            warn!("[batch] inferencia falló: {}", e);
            e.to_string()
        })
}

fn parakeet_engine() -> Result<Arc<crate::parakeet_engine::ParakeetEngine>, String> {
    let guard = crate::parakeet_engine::commands::PARAKEET_ENGINE
        .lock()
        .map_err(|e| format!("Parakeet engine mutex poisoned: {}", e))?;
    guard
        .as_ref()
        .cloned()
        .ok_or_else(|| "Parakeet sin inicializar tras ensure_stt_warm_parakeet".to_string())
}
