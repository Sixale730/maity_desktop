// audio/transcription/worker.rs
//
// Parallel transcription worker pool and chunk processing logic.
// Includes ChunkAccumulator for batching small VAD segments before Whisper.

use super::engine::TranscriptionEngine;
use super::provider::TranscriptionError;
use crate::audio::AudioChunk;
use crate::audio::recording_state::DeviceType;
use log::{debug, error, info, warn};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Runtime};

// Sequence counter for transcript updates
static SEQUENCE_COUNTER: AtomicU64 = AtomicU64::new(0);

// Speech detection flag - reset per recording session
static SPEECH_DETECTED_EMITTED: AtomicBool = AtomicBool::new(false);

/// Reset the speech detected flag for a new recording session
pub fn reset_speech_detected_flag() {
    SPEECH_DETECTED_EMITTED.store(false, Ordering::SeqCst);
    debug!("🔍 SPEECH_DETECTED_EMITTED reset to: {}", SPEECH_DETECTED_EMITTED.load(Ordering::SeqCst));
}

/// Accumulates small VAD segments into larger chunks before sending to Whisper.
/// This reduces per-chunk initialization overhead and improves transcription quality
/// (Whisper works best with 3-10s chunks, not 400ms micro-segments).
struct ChunkAccumulator {
    buffer: Vec<f32>,
    sample_rate: u32,
    /// Timestamp of the first sample in the buffer (recording-relative seconds)
    first_timestamp: f64,
    /// Device type of accumulated audio (mic or system)
    device_type: DeviceType,
    /// Running chunk_id counter for accumulated chunks
    next_chunk_id: u64,
    /// Minimum duration in seconds before flushing to Whisper (default: 3.0)
    min_duration_secs: f64,
    /// Maximum duration in seconds before forcing a flush (default: 8.0)
    max_duration_secs: f64,
    /// Last time audio was added (for flush timeout)
    last_add_time: std::time::Instant,
    /// Flush timeout: if no new audio arrives within this duration, flush what we have (default: 2s)
    flush_timeout: std::time::Duration,
}

impl ChunkAccumulator {
    fn new(min_duration: f64, max_duration: f64, flush_timeout_ms: u64) -> Self {
        Self {
            buffer: Vec::new(),
            sample_rate: 16000,
            first_timestamp: 0.0,
            device_type: DeviceType::Mixed,
            next_chunk_id: 0,
            min_duration_secs: min_duration,
            max_duration_secs: max_duration,
            last_add_time: std::time::Instant::now(),
            flush_timeout: std::time::Duration::from_millis(flush_timeout_ms),
        }
    }

    /// Add a chunk to the accumulator. Returns a merged AudioChunk if ready to flush.
    fn add(&mut self, chunk: AudioChunk) -> Option<AudioChunk> {
        if self.buffer.is_empty() {
            // First chunk in this accumulation window
            self.first_timestamp = chunk.timestamp;
            self.device_type = chunk.device_type;
            self.sample_rate = chunk.sample_rate;
        }

        self.buffer.extend_from_slice(&chunk.data);
        self.last_add_time = std::time::Instant::now();

        let duration = self.buffer.len() as f64 / self.sample_rate as f64;

        // Flush if we've reached max duration or minimum duration
        if duration >= self.max_duration_secs || duration >= self.min_duration_secs {
            return self.flush();
        }

        None
    }

    /// Check if buffer should be flushed due to timeout (no new audio for flush_timeout).
    /// Returns accumulated chunk if timeout exceeded and buffer has content.
    fn check_timeout(&mut self) -> Option<AudioChunk> {
        if !self.buffer.is_empty() && self.last_add_time.elapsed() >= self.flush_timeout {
            let duration = self.buffer.len() as f64 / self.sample_rate as f64;
            // Flush on timeout if we have at least 50ms of audio (was 0.2s — lost fillers <200ms)
            if duration >= 0.05 {
                return self.flush();
            }
        }
        None
    }

    /// Force flush remaining buffer (e.g., when recording stops).
    fn flush(&mut self) -> Option<AudioChunk> {
        if self.buffer.is_empty() {
            return None;
        }

        let chunk_id = self.next_chunk_id;
        self.next_chunk_id += 1;

        let flushed = AudioChunk {
            data: std::mem::take(&mut self.buffer),
            sample_rate: self.sample_rate,
            timestamp: self.first_timestamp,
            chunk_id,
            device_type: self.device_type,
        };
        self.buffer.shrink_to_fit();

        Some(flushed)
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TranscriptUpdate {
    pub text: String,
    pub timestamp: String, // Wall-clock time for reference (e.g., "14:30:05")
    pub source: String,
    pub sequence_id: u64,
    pub chunk_start_time: f64, // Legacy field, kept for compatibility
    pub is_partial: bool,
    pub confidence: f32,
    // NEW: Recording-relative timestamps for playback sync
    pub audio_start_time: f64, // Seconds from recording start (e.g., 125.3)
    pub audio_end_time: f64,   // Seconds from recording start (e.g., 128.6)
    pub duration: f64,          // Segment duration in seconds (e.g., 3.3)
    // NEW: Source type for speaker identification (user=mic, interlocutor=system)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_type: Option<String>,
}

// NOTE: get_transcript_history and get_recording_meeting_name functions
// have been moved to recording_commands.rs where they have access to RECORDING_MANAGER

/// Optimized parallel transcription task ensuring ZERO chunk loss
pub fn start_transcription_task<R: Runtime>(
    app: AppHandle<R>,
    transcription_receiver: tokio::sync::mpsc::UnboundedReceiver<AudioChunk>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        info!("🚀 Starting optimized parallel transcription task - guaranteeing zero chunk loss");

        // Initialize transcription engine (Whisper or Parakeet based on config)
        info!("[WORKER] Initializing transcription engine...");
        let transcription_engine = match super::engine::get_or_init_transcription_engine(&app).await {
            Ok(engine) => {
                info!("[WORKER] Transcription engine initialized: {}", engine.provider_name());
                engine
            }
            Err(e) => {
                error!("[WORKER] Error initializing transcription engine: {}", e);
                error!("Failed to initialize transcription engine: {}", e);
                let _ = app.emit("transcription-error", serde_json::json!({
                    "error": e,
                    "userMessage": "Recording failed: Unable to initialize speech recognition. Please check your model settings.",
                    "actionable": true
                }));
                return;
            }
        };

        // Create parallel workers for faster processing while preserving ALL chunks
        const NUM_WORKERS: usize = 1; // Serial processing ensures transcripts emit in chronological order

        // FIX: Bounded channel con backpressure - evita memory leak en conversaciones muy largas
        // 2000 chunks = ~2 minutos de audio en cola máximo (a 60ms por chunk)
        // Si se llena, el sender esperará (backpressure) en vez de perder datos
        let (work_sender, work_receiver) = tokio::sync::mpsc::channel::<AudioChunk>(4000);
        let work_receiver = Arc::new(tokio::sync::Mutex::new(work_receiver));

        // Track completion: AtomicU64 for chunks queued, completed, and dropped
        let chunks_queued = Arc::new(AtomicU64::new(0));
        let chunks_completed = Arc::new(AtomicU64::new(0));
        let chunks_dropped = Arc::new(AtomicU64::new(0)); // FIX: Track dropped chunks for debugging
        let input_finished = Arc::new(AtomicBool::new(false));

        info!("📊 Starting {} transcription worker{} (serial mode for ordered emission)", NUM_WORKERS, if NUM_WORKERS == 1 { "" } else { "s" });

        // Spawn worker tasks
        let mut worker_handles = Vec::new();
        for worker_id in 0..NUM_WORKERS {
            let engine_clone = match &transcription_engine {
                TranscriptionEngine::Parakeet(e) => TranscriptionEngine::Parakeet(e.clone()),
                TranscriptionEngine::Canary(e) => TranscriptionEngine::Canary(e.clone()),
                TranscriptionEngine::Provider(p) => TranscriptionEngine::Provider(p.clone()),
            };
            let app_clone = app.clone();
            let work_receiver_clone = work_receiver.clone();
            let chunks_completed_clone = chunks_completed.clone();
            let input_finished_clone = input_finished.clone();
            let chunks_queued_clone = chunks_queued.clone();

            let worker_handle = tokio::spawn(async move {
                info!("👷 Worker {} started", worker_id);

                // PRE-VALIDATE model state to avoid repeated async calls per chunk
                let initial_model_loaded = engine_clone.is_model_loaded().await;
                let current_model = engine_clone
                    .get_current_model()
                    .await
                    .unwrap_or_else(|| "unknown".to_string());

                let engine_name = engine_clone.provider_name();

                if initial_model_loaded {
                    info!(
                        "✅ Worker {} pre-validation: {} model '{}' is loaded and ready",
                        worker_id, engine_name, current_model
                    );
                } else {
                    warn!("⚠️ Worker {} pre-validation: {} model not loaded - chunks may be skipped", worker_id, engine_name);
                }

                let mut chunks_processed_by_worker: u64 = 0;

                loop {
                    // Try to get a chunk to process
                    let chunk = {
                        let mut receiver = work_receiver_clone.lock().await;
                        receiver.recv().await
                    };

                    match chunk {
                        Some(chunk) => {
                            chunks_processed_by_worker += 1;

                            // PERFORMANCE OPTIMIZATION: Reduce logging in hot path
                            // Only log every 10th chunk per worker to reduce I/O overhead
                            let should_log_this_chunk = chunk.chunk_id % 10 == 0;

                            if chunks_processed_by_worker % 10 == 0 {
                                debug!("[WORKER {}] Processed {} chunks so far (chunk_id: {}, {} samples)",
                                         worker_id, chunks_processed_by_worker, chunk.chunk_id, chunk.data.len());
                            }

                            if should_log_this_chunk {
                                debug!(
                                    "👷 Worker {} processing chunk {} with {} samples",
                                    worker_id,
                                    chunk.chunk_id,
                                    chunk.data.len()
                                );
                            }

                            // Check if model is still loaded before processing
                            if !engine_clone.is_model_loaded().await {
                                warn!("[WORKER {}] Model not loaded, chunk {} discarded", worker_id, chunk.chunk_id);
                                warn!("⚠️ Worker {}: Model unloaded, but continuing to preserve chunk {}", worker_id, chunk.chunk_id);
                                // Still count as completed even if we can't process
                                chunks_completed_clone.fetch_add(1, Ordering::SeqCst);
                                continue;
                            }

                            let chunk_timestamp = chunk.timestamp;
                            let chunk_duration = chunk.data.len() as f64 / chunk.sample_rate as f64;
                            // Capture device_type before chunk is moved (for speaker identification)
                            let chunk_source_type = match chunk.device_type {
                                crate::audio::recording_state::DeviceType::Microphone => Some("user".to_string()),
                                crate::audio::recording_state::DeviceType::System => Some("interlocutor".to_string()),
                                crate::audio::recording_state::DeviceType::Mixed => None, // Mixed audio should not be transcribed
                            };

                            // Transcribe with provider-agnostic approach
                            match transcribe_chunk_with_provider(
                                &engine_clone,
                                chunk,
                                &app_clone,
                            )
                            .await
                            {
                                Ok((transcript, confidence_opt, is_partial)) => {
                                    // Provider-aware confidence threshold
                                    // Lowered from 0.3 to 0.01 - Whisper.cpp sometimes reports low
                                    // confidence even with valid Spanish transcriptions. Let almost
                                    // everything through and let the user decide.
                                    let confidence_threshold = match &engine_clone {
                                        TranscriptionEngine::Provider(_) => 0.01,
                                        TranscriptionEngine::Parakeet(_) | TranscriptionEngine::Canary(_) => 0.0,
                                    };

                                    let confidence_str = match confidence_opt {
                                        Some(c) => format!("{:.2}", c),
                                        None => "N/A".to_string(),
                                    };

                                    debug!("🔍 Worker {} transcription result: text='{}', confidence={}, partial={}, threshold={:.2}",
                                          worker_id, transcript, confidence_str, is_partial, confidence_threshold);

                                    // Check confidence threshold (or accept if no confidence provided)
                                    let meets_threshold = confidence_opt.map_or(true, |c| c >= confidence_threshold);

                                    if !transcript.trim().is_empty() && meets_threshold {
                                        // PERFORMANCE: Only log transcription results, not every processing step
                                        debug!("✅ Worker {} transcribed: {} (confidence: {}, partial: {})",
                                              worker_id, transcript, confidence_str, is_partial);

                                        // Emit speech-detected event for frontend UX (only on first detection per session)
                                        // This is lightweight and provides better user feedback
                                        let current_flag = SPEECH_DETECTED_EMITTED.load(Ordering::SeqCst);
                                        debug!("🔍 Checking speech-detected flag: current={}, will_emit={}", current_flag, !current_flag);

                                        if !current_flag {
                                            SPEECH_DETECTED_EMITTED.store(true, Ordering::SeqCst);
                                            match app_clone.emit("speech-detected", serde_json::json!({
                                                "message": "Speech activity detected"
                                            })) {
                                                Ok(_) => info!("🎤 ✅ First speech detected - successfully emitted speech-detected event"),
                                                Err(e) => error!("🎤 ❌ Failed to emit speech-detected event: {}", e),
                                            }
                                        } else {
                                            debug!("🔍 Speech already detected in this session, not re-emitting");
                                        }

                                        // Generate sequence ID and calculate timestamps FIRST
                                        let sequence_id = SEQUENCE_COUNTER.fetch_add(1, Ordering::SeqCst);
                                        let audio_start_time = chunk_timestamp; // Already in seconds from recording start
                                        let audio_end_time = chunk_timestamp + chunk_duration;

                                        // Save structured transcript segment to recording manager (only final results)
                                        // Save ALL segments (partial and final) to ensure complete JSON
                                        // Create structured segment with full timestamp data
                                        // NOTE: This is now handled via the transcript-update event emission below
                                        // The recording_commands module listens to these events and saves them
                                        // This decouples the transcription worker from direct RECORDING_MANAGER access

                                        // Emit transcript update with NEW recording-relative timestamps

                                        // Heurística español: capitalización, tildes en preguntas,
                                        // signos ¿?, normalización de espacios, atenuación de muletillas.
                                        // Idempotente y barata (sin LLM, sin allocs en hot path).
                                        let language = crate::get_language_preference_internal()
                                            .unwrap_or_else(|| "es".to_string());
                                        let enhanced_text = super::spanish_postprocess::enhance(
                                            &transcript,
                                            &language,
                                        );

                                        // Anti-hallucination: descartar texto que es YouTube/subtítulo garbage
                                        if super::spanish_postprocess::is_hallucination(&enhanced_text) {
                                            warn!("🚫 Hallucination detected, discarding: '{}'", enhanced_text);
                                            chunks_completed_clone.fetch_add(1, Ordering::SeqCst);
                                            continue;
                                        }

                                        if enhanced_text != transcript {
                                            let preview: String = enhanced_text.chars().take(120).collect();
                                            debug!("🇪🇸 ES post-process: '{}' → '{}'", transcript, preview);
                                        }

                                        let update = TranscriptUpdate {
                                            text: enhanced_text,
                                            timestamp: format_current_timestamp(), // Wall-clock for reference
                                            source: "Audio".to_string(),
                                            sequence_id,
                                            chunk_start_time: chunk_timestamp, // Legacy compatibility
                                            is_partial,
                                            confidence: confidence_opt.unwrap_or(0.85), // Default for providers without confidence
                                            // NEW: Recording-relative timestamps for sync
                                            audio_start_time,
                                            audio_end_time,
                                            duration: chunk_duration,
                                            // NEW: Speaker identification (user=mic, interlocutor=system)
                                            source_type: chunk_source_type.clone(),
                                        };

                                        // FIX UTF-8 (2026-04-11): usar chars().take() para no cortar
                                        // en medio de carácter multi-byte (á, é, ñ, ¿, etc).
                                        let text_preview: String = update.text.chars().take(50).collect();
                                        debug!("📤 Transcript emitted: source={} text='{}' seq={} time={:.1}s-{:.1}s",
                                              chunk_source_type.as_deref().unwrap_or("unknown"),
                                              text_preview,
                                              sequence_id, audio_start_time, audio_end_time);

                                        match app_clone.emit("transcript-update", &update) {
                                            Ok(_) => {
                                                debug!("[WORKER] transcript-update event emitted successfully");
                                            }
                                            Err(e) => {
                                                error!("[WORKER] Error emitting transcript-update: {}", e);
                                                error!(
                                                    "Worker {}: Failed to emit transcript update: {}",
                                                    worker_id, e
                                                );
                                            }
                                        }
                                        // PERFORMANCE: Removed verbose logging of every emission
                                    } else if !transcript.trim().is_empty() {
                                        // Log ALL filtered transcriptions for debugging
                                        if let Some(c) = confidence_opt {
                                            debug!("[WORKER {}] Transcription filtered by confidence: '{}' (conf: {:.2}, threshold: {:.2})",
                                                     worker_id, transcript, c, confidence_threshold);
                                            debug!("Worker {} low-confidence transcription (confidence: {:.2}), skipping", worker_id, c);
                                        }
                                    }
                                }
                                Err(e) => {
                                    // Improved error handling with specific cases
                                    match e {
                                        TranscriptionError::AudioTooShort { .. } => {
                                            debug!("[WORKER {}] Audio too short: {}", worker_id, e);
                                            debug!("Worker {}: {}", worker_id, e);
                                            chunks_completed_clone.fetch_add(1, Ordering::SeqCst);
                                            continue;
                                        }
                                        TranscriptionError::ModelNotLoaded => {
                                            warn!("[WORKER {}] Model not loaded during transcription", worker_id);
                                            warn!("Worker {}: Model unloaded during transcription", worker_id);
                                            chunks_completed_clone.fetch_add(1, Ordering::SeqCst);
                                            continue;
                                        }
                                        _ => {
                                            warn!("[WORKER {}] Transcription error: {}", worker_id, e);
                                            warn!("Worker {}: Transcription failed: {}", worker_id, e);
                                            let _ = app_clone.emit("transcription-warning", e.to_string());
                                        }
                                    }
                                }
                            }

                            // Mark chunk as completed
                            let completed =
                                chunks_completed_clone.fetch_add(1, Ordering::SeqCst) + 1;
                            let queued = chunks_queued_clone.load(Ordering::SeqCst);

                            // PERFORMANCE: Only log progress every 30th chunk to reduce I/O overhead
                            if completed % 30 == 0 || should_log_this_chunk {
                                debug!(
                                    "Worker {}: Progress {}/{} chunks ({:.1}%)",
                                    worker_id,
                                    completed,
                                    queued,
                                    (completed as f64 / queued.max(1) as f64 * 100.0)
                                );
                            }

                            // Emit progress event for frontend
                            let progress_percentage = if queued > 0 {
                                (completed as f64 / queued as f64 * 100.0) as u32
                            } else {
                                100
                            };

                            let _ = app_clone.emit("transcription-progress", serde_json::json!({
                                "worker_id": worker_id,
                                "chunks_completed": completed,
                                "chunks_queued": queued,
                                "progress_percentage": progress_percentage,
                                "message": format!("Worker {} processing... ({}/{})", worker_id, completed, queued)
                            }));
                        }
                        None => {
                            // No more chunks available
                            if input_finished_clone.load(Ordering::SeqCst) {
                                // Double-check that all queued chunks are actually completed
                                let final_queued = chunks_queued_clone.load(Ordering::SeqCst);
                                let final_completed = chunks_completed_clone.load(Ordering::SeqCst);

                                if final_completed >= final_queued {
                                    info!(
                                        "👷 Worker {} finishing - all {}/{} chunks processed",
                                        worker_id, final_completed, final_queued
                                    );
                                    break;
                                } else {
                                    warn!("👷 Worker {} detected potential chunk loss: {}/{} completed, waiting...", worker_id, final_completed, final_queued);
                                    // Shutdown polling: check for remaining chunks periodically
                                    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
                                }
                            } else {
                                // Cleanup polling: wait for input to finish
                                tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
                            }
                        }
                    }
                }

                info!("👷 Worker {} completed", worker_id);
            });

            worker_handles.push(worker_handle);
        }

        // Main dispatcher: accumulate small VAD chunks before sending to workers.
        // This reduces Whisper invocations (each has ~200-500ms init overhead) and
        // improves quality (Whisper works better with 3-8s chunks than 400ms).
        let mut receiver = transcription_receiver;
        let chunks_dropped_dispatcher = chunks_dropped.clone();

        // Separate accumulators per device type (mic audio and system audio transcribe independently)
        //
        // QW-4 (audit 2026-04-08, adoptado de D:\Maity_Desktop 2026-04-11):
        // ANTES los tiers altos esperaban MÁS (1500ms flush en Ultra) que los bajos —
        // exactamente lo contrario de la intuición esperada. El usuario con hardware
        // potente se sentía MÁS laggy que el que tiene una laptop débil. Esto causaba
        // que chunks crecieran hasta 60-70s cuando el interlocutor hablaba continuo,
        // matando la sensación de "tiempo real".
        //
        // AHORA todos los tiers usan (0.3s min, 4.0s max, 400ms flush):
        //   - emit-sooner: 0.3s permite que segmentos cortos se transcriban casi al vuelo
        //   - techo razonable: 4.0s evita chunks gigantes (Parakeet máx eficiente)
        //   - flush rápido: 400ms para que silencios cortos liberen el buffer
        //
        // Reduce latencia percibida ~700-1100ms.
        let hw_profile = crate::audio::HardwareProfile::detect();
        let (min_dur, max_dur, flush_timeout) = (0.3_f64, 8.0_f64, 400_u64);
        info!(
            "[WORKER] ChunkAccumulator (real-time tuned): min={:.1}s, max={:.1}s, flush={}ms (tier detectado: {:?}, valor uniforme)",
            min_dur, max_dur, flush_timeout, hw_profile.performance_tier
        );
        let mut mic_accumulator = ChunkAccumulator::new(min_dur, max_dur, flush_timeout);
        let mut sys_accumulator = ChunkAccumulator::new(min_dur, max_dur, flush_timeout);

        /// Helper: send an accumulated chunk to the worker channel
        async fn dispatch_accumulated(
            accumulated: AudioChunk,
            work_sender: &tokio::sync::mpsc::Sender<AudioChunk>,
            chunks_queued: &AtomicU64,
            chunks_dropped: &AtomicU64,
        ) -> bool {
            let duration = accumulated.data.len() as f64 / accumulated.sample_rate as f64;
            let queued = chunks_queued.fetch_add(1, Ordering::SeqCst) + 1;
            debug!(
                "📥 Dispatching accumulated chunk {} ({:.1}s, {:?}) to workers (total queued: {})",
                accumulated.chunk_id, duration, accumulated.device_type, queued
            );

            match tokio::time::timeout(
                tokio::time::Duration::from_secs(5),
                work_sender.send(accumulated)
            ).await {
                Ok(Ok(())) => true,
                Ok(Err(_)) => {
                    error!("❌ Channel closed - workers terminated unexpectedly");
                    false
                }
                Err(_) => {
                    error!("⚠️ Accumulated chunk dropped - queue full for >5s (backpressure timeout)");
                    chunks_dropped.fetch_add(1, Ordering::SeqCst);
                    true
                }
            }
        }

        loop {
            // Use a short timeout to periodically check for flush timeouts (200ms for responsive silence detection)
            match tokio::time::timeout(
                tokio::time::Duration::from_millis(200),
                receiver.recv()
            ).await {
                Ok(Some(chunk)) => {
                    // Route chunk to appropriate accumulator based on device type
                    let accumulated = match chunk.device_type {
                        DeviceType::Microphone => mic_accumulator.add(chunk),
                        DeviceType::System => sys_accumulator.add(chunk),
                        DeviceType::Mixed => {
                            // Mixed audio: send directly without accumulation
                            Some(chunk)
                        }
                    };

                    if let Some(acc_chunk) = accumulated {
                        if !dispatch_accumulated(acc_chunk, &work_sender, &chunks_queued, &chunks_dropped_dispatcher).await {
                            break;
                        }
                    }
                }
                Ok(None) => {
                    // Channel closed - flush remaining buffers and exit
                    info!("📭 Input channel closed, flushing accumulators...");
                    if let Some(remaining) = mic_accumulator.flush() {
                        dispatch_accumulated(remaining, &work_sender, &chunks_queued, &chunks_dropped_dispatcher).await;
                    }
                    if let Some(remaining) = sys_accumulator.flush() {
                        dispatch_accumulated(remaining, &work_sender, &chunks_queued, &chunks_dropped_dispatcher).await;
                    }
                    break;
                }
                Err(_) => {
                    // Timeout - check if accumulators need flushing due to silence timeout
                    if let Some(timeout_chunk) = mic_accumulator.check_timeout() {
                        dispatch_accumulated(timeout_chunk, &work_sender, &chunks_queued, &chunks_dropped_dispatcher).await;
                    }
                    if let Some(timeout_chunk) = sys_accumulator.check_timeout() {
                        dispatch_accumulated(timeout_chunk, &work_sender, &chunks_queued, &chunks_dropped_dispatcher).await;
                    }
                }
            }
        }

        // Signal that input is finished
        input_finished.store(true, Ordering::SeqCst);
        drop(work_sender); // Close the channel to signal workers

        let total_chunks_queued = chunks_queued.load(Ordering::SeqCst);
        info!("📭 Input finished with {} total chunks queued. Waiting for all {} workers to complete...",
              total_chunks_queued, NUM_WORKERS);

        // Emit final chunk count to frontend
        let _ = app.emit("transcription-queue-complete", serde_json::json!({
            "total_chunks": total_chunks_queued,
            "message": format!("{} chunks queued for processing - waiting for completion", total_chunks_queued)
        }));

        // Wait for all workers to complete
        for (worker_id, handle) in worker_handles.into_iter().enumerate() {
            if let Err(e) = handle.await {
                error!("❌ Worker {} panicked: {:?}", worker_id, e);
            } else {
                info!("✅ Worker {} completed successfully", worker_id);
            }
        }

        // Final verification with retry logic to catch any stragglers
        let mut verification_attempts = 0;
        const MAX_VERIFICATION_ATTEMPTS: u32 = 10;

        loop {
            let final_queued = chunks_queued.load(Ordering::SeqCst);
            let final_completed = chunks_completed.load(Ordering::SeqCst);
            let final_dropped = chunks_dropped.load(Ordering::SeqCst);

            if final_queued == final_completed + final_dropped {
                if final_dropped == 0 {
                    info!(
                        "🎉 ALL {} chunks processed successfully - ZERO chunks lost!",
                        final_completed
                    );
                } else {
                    warn!(
                        "⚠️ {} chunks processed, {} dropped due to backpressure",
                        final_completed, final_dropped
                    );
                }

                // FIX: Emit transcription summary with loss metrics for debugging
                let loss_percentage = if final_queued > 0 {
                    (final_dropped as f64 / final_queued as f64) * 100.0
                } else {
                    0.0
                };

                let _ = app.emit("transcription-summary", serde_json::json!({
                    "chunks_queued": final_queued,
                    "chunks_completed": final_completed,
                    "chunks_dropped": final_dropped,
                    "loss_percentage": loss_percentage,
                    "status": if final_dropped == 0 { "success" } else { "partial_loss" }
                }));

                break;
            } else if verification_attempts < MAX_VERIFICATION_ATTEMPTS {
                verification_attempts += 1;
                warn!("⚠️ Chunk count mismatch (attempt {}): {} queued, {} completed, {} dropped - waiting for stragglers...",
                     verification_attempts, final_queued, final_completed, final_dropped);

                // Wait a bit for any remaining chunks to be processed
                tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
            } else {
                let processing_loss = final_queued.saturating_sub(final_completed + final_dropped);
                error!(
                    "❌ CRITICAL: After {} attempts, chunk loss detected: {} queued, {} completed, {} dropped, {} lost in processing",
                    MAX_VERIFICATION_ATTEMPTS, final_queued, final_completed, final_dropped, processing_loss
                );

                // Emit critical error event with full metrics
                let _ = app.emit(
                    "transcript-chunk-loss-detected",
                    serde_json::json!({
                        "chunks_queued": final_queued,
                        "chunks_completed": final_completed,
                        "chunks_dropped": final_dropped,
                        "chunks_lost_in_processing": processing_loss,
                        "total_loss": final_dropped + processing_loss,
                        "message": "Some transcript chunks may have been lost during shutdown"
                    }),
                );
                break;
            }
        }

        info!("✅ Parallel transcription task completed - all workers finished, ready for model unload");
    })
}

/// Transcribe audio chunk using the appropriate provider (Whisper, Parakeet, or trait-based)
/// Returns: (text, confidence Option, is_partial)
async fn transcribe_chunk_with_provider<R: Runtime>(
    engine: &TranscriptionEngine,
    chunk: AudioChunk,
    app: &AppHandle<R>,
) -> std::result::Result<(String, Option<f32>, bool), TranscriptionError> {
    // Convert to 16kHz mono for transcription
    let transcription_data = if chunk.sample_rate != 16000 {
        crate::audio::audio_processing::resample_audio(&chunk.data, chunk.sample_rate, 16000)
    } else {
        chunk.data
    };

    // Skip VAD processing here since the pipeline already extracted speech using VAD
    let speech_samples = transcription_data;

    // Check for empty samples - improved error handling
    if speech_samples.is_empty() {
        warn!(
            "Audio chunk {} is empty, skipping transcription",
            chunk.chunk_id
        );
        return Err(TranscriptionError::AudioTooShort {
            samples: 0,
            minimum: 1600, // 100ms at 16kHz
        });
    }

    // Calculate energy for logging/monitoring only
    let energy: f32 =
        speech_samples.iter().map(|&x| x * x).sum::<f32>() / speech_samples.len() as f32;
    info!(
        "Processing speech audio chunk {} with {} samples (energy: {:.6})",
        chunk.chunk_id,
        speech_samples.len(),
        energy
    );

    // Transcribe using the appropriate engine (with improved error handling)
    match engine {
        TranscriptionEngine::Parakeet(parakeet_engine) => {
            match parakeet_engine.transcribe_audio(speech_samples).await {
                Ok(text) => {
                    let cleaned_text = text.trim().to_string();
                    if cleaned_text.is_empty() {
                        return Ok((String::new(), None, false));
                    }

                    info!(
                        "Parakeet transcription complete for chunk {}: '{}'",
                        chunk.chunk_id, cleaned_text
                    );

                    // Parakeet doesn't provide confidence or partial results
                    Ok((cleaned_text, None, false))
                }
                Err(e) => {
                    error!(
                        "Parakeet transcription failed for chunk {}: {}",
                        chunk.chunk_id, e
                    );

                    let transcription_error = TranscriptionError::EngineFailed(e.to_string());
                    let _ = app.emit(
                        "transcription-error",
                        &serde_json::json!({
                            "error": transcription_error.to_string(),
                            "userMessage": format!("Transcription failed: {}", transcription_error),
                            "actionable": false
                        }),
                    );

                    Err(transcription_error)
                }
            }
        }
        TranscriptionEngine::Canary(canary_engine) => {
            // Get language preference for Canary (supports es, en, de, fr)
            let language = crate::get_language_preference_internal();

            match canary_engine.transcribe_audio_with_lang(speech_samples, language).await {
                Ok(text) => {
                    let cleaned_text = text.trim().to_string();
                    if cleaned_text.is_empty() {
                        return Ok((String::new(), None, false));
                    }

                    info!(
                        "Canary transcription complete for chunk {}: '{}'",
                        chunk.chunk_id, cleaned_text
                    );

                    Ok((cleaned_text, None, false))
                }
                Err(e) => {
                    error!(
                        "Canary transcription failed for chunk {}: {}",
                        chunk.chunk_id, e
                    );

                    let transcription_error = TranscriptionError::EngineFailed(e.to_string());
                    let _ = app.emit(
                        "transcription-error",
                        &serde_json::json!({
                            "error": transcription_error.to_string(),
                            "userMessage": format!("Transcription failed: {}", transcription_error),
                            "actionable": false
                        }),
                    );

                    Err(transcription_error)
                }
            }
        }
        TranscriptionEngine::Provider(provider) => {
            // NEW: Trait-based provider (clean, unified interface)
            let language = crate::get_language_preference_internal();
            debug!("[WORKER] Using provider: {} (language: {:?}, {} samples)",
                     provider.provider_name(), language, speech_samples.len());

            match provider.transcribe(speech_samples, language).await {
                Ok(result) => {
                    debug!("[WORKER] Provider {} returned: '{}' (confidence: {:?}, partial: {})",
                             provider.provider_name(), result.text, result.confidence, result.is_partial);
                    let cleaned_text = result.text.trim().to_string();
                    if cleaned_text.is_empty() {
                        debug!("[WORKER] Empty text after cleaning, skipping...");
                        return Ok((String::new(), result.confidence, result.is_partial));
                    }

                    let confidence_str = match result.confidence {
                        Some(c) => format!("confidence: {:.2}", c),
                        None => "no confidence".to_string(),
                    };

                    info!(
                        "{} transcription complete for chunk {}: '{}' ({}, partial: {})",
                        provider.provider_name(),
                        chunk.chunk_id,
                        cleaned_text,
                        confidence_str,
                        result.is_partial
                    );

                    Ok((cleaned_text, result.confidence, result.is_partial))
                }
                Err(e) => {
                    error!(
                        "{} transcription failed for chunk {}: {}",
                        provider.provider_name(),
                        chunk.chunk_id,
                        e
                    );

                    let _ = app.emit(
                        "transcription-error",
                        &serde_json::json!({
                            "error": e.to_string(),
                            "userMessage": format!("Transcription failed: {}", e),
                            "actionable": false
                        }),
                    );

                    Err(e)
                }
            }
        }
    }
}

/// Format current timestamp (wall-clock local time)
fn format_current_timestamp() -> String {
    chrono::Local::now().format("%H:%M:%S").to_string()
}

