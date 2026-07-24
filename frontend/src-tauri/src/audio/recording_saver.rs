use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::Mutex as AsyncMutex;
use anyhow::Result;
use log::{info, warn, error};
use tauri::{AppHandle, Runtime, Emitter};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use serde::{Serialize, Deserialize};
use std::path::PathBuf;

use super::recording_state::AudioChunk;
use super::audio_processing::create_meeting_folder;
use super::incremental_saver::IncrementalAudioSaver;
use crate::events;

/// Structured transcript segment for JSON export
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptSegment {
    pub id: String,
    pub text: String,
    pub audio_start_time: f64, // Seconds from recording start
    pub audio_end_time: f64,   // Seconds from recording start
    pub duration: f64,          // Segment duration in seconds
    pub display_time: String,   // Formatted time for display like "[02:15]"
    pub confidence: f32,
    pub sequence_id: u64,
    pub source_type: Option<String>, // Speaker identification: "user" (mic) or "interlocutor" (system)
}

/// Meeting metadata structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeetingMetadata {
    pub version: String,
    pub meeting_id: Option<String>,
    pub meeting_name: Option<String>,
    pub created_at: String,
    pub completed_at: Option<String>,
    pub duration_seconds: Option<f64>,
    pub devices: DeviceInfo,
    pub audio_file: String,
    pub transcript_file: String,
    pub sample_rate: u32,
    pub status: String,  // "recording", "completed", "error"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceInfo {
    pub microphone: Option<String>,
    pub system_audio: Option<String>,
}

/// Insertion-order Vec of segments backed by a HashMap index for O(1) upsert
/// by `sequence_id`. Replaces the previous `Vec<TranscriptSegment>` whose
/// upsert did a linear `find()` that became pathological in long recordings
/// (60 min = 3600+ segments, each insert slower under Mutex).
#[derive(Debug, Default)]
struct TranscriptStore {
    segments: Vec<TranscriptSegment>,
    index_by_seq: HashMap<u64, usize>,
}

impl TranscriptStore {
    fn new() -> Self {
        Self {
            segments: Vec::new(),
            index_by_seq: HashMap::new(),
        }
    }

    /// Upsert by `sequence_id`. Returns `true` if updated, `false` if new.
    fn upsert(&mut self, segment: TranscriptSegment) -> bool {
        if let Some(&idx) = self.index_by_seq.get(&segment.sequence_id) {
            self.segments[idx] = segment;
            true
        } else {
            let idx = self.segments.len();
            self.index_by_seq.insert(segment.sequence_id, idx);
            self.segments.push(segment);
            false
        }
    }

    fn len(&self) -> usize {
        self.segments.len()
    }

    fn clear(&mut self) {
        self.segments.clear();
        self.index_by_seq.clear();
    }

    fn last(&self) -> Option<&TranscriptSegment> {
        self.segments.last()
    }

    fn clone_vec(&self) -> Vec<TranscriptSegment> {
        self.segments.clone()
    }
}

/// New recording saver using incremental saving strategy
pub struct RecordingSaver {
    incremental_saver: Option<Arc<AsyncMutex<IncrementalAudioSaver>>>,
    meeting_folder: Option<PathBuf>,
    meeting_name: Option<String>,
    metadata: Option<MeetingMetadata>,
    transcript_segments: Arc<Mutex<TranscriptStore>>,
    chunk_receiver: Option<mpsc::UnboundedReceiver<AudioChunk>>,
    is_saving: Arc<Mutex<bool>>,
    transcripts_dirty: Arc<AtomicBool>,
    transcript_io_lock: Arc<Mutex<()>>,
    /// Apagado del debounced writer. `stop_and_save` cancela y espera el handle
    /// ANTES de la escritura final y del `clear()`: tras el join, el único que
    /// escribe transcripts.json es el propio stop. Sin este orden, el tick
    /// póstumo del writer podía escribir el store ya vaciado encima del archivo
    /// final (transcripts.json truncado a 0 segmentos).
    writer_shutdown: Option<CancellationToken>,
    writer_handle: Option<tokio::task::JoinHandle<()>>,
}

impl RecordingSaver {
    pub fn new() -> Self {
        Self {
            incremental_saver: None,
            meeting_folder: None,
            meeting_name: None,
            metadata: None,
            transcript_segments: Arc::new(Mutex::new(TranscriptStore::new())),
            chunk_receiver: None,
            is_saving: Arc::new(Mutex::new(false)),
            transcripts_dirty: Arc::new(AtomicBool::new(false)),
            transcript_io_lock: Arc::new(Mutex::new(())),
            writer_shutdown: None,
            writer_handle: None,
        }
    }

    /// Set the meeting name for this recording session
    pub fn set_meeting_name(&mut self, name: Option<String>) {
        self.meeting_name = name;
    }

    /// Set device information in metadata
    pub fn set_device_info(&mut self, mic_name: Option<String>, sys_name: Option<String>) {
        if let Some(ref mut metadata) = self.metadata {
            metadata.devices.microphone = mic_name;
            metadata.devices.system_audio = sys_name;

            // Write updated metadata to disk if folder exists
            if let Some(folder) = &self.meeting_folder {
                let metadata_clone = metadata.clone();
                if let Err(e) = self.write_metadata(folder, &metadata_clone) {
                    warn!("Failed to update metadata with device info: {}", e);
                }
            }
        }
    }

    /// Add or update a structured transcript segment (upserts based on sequence_id)
    /// Also saves incrementally to disk
    pub fn add_transcript_segment(&self, segment: TranscriptSegment) {
        let segment_id = segment.id.clone();
        let segment_seq = segment.sequence_id;

        if let Ok(mut store) = self.transcript_segments.lock() {
            let updated = store.upsert(segment);
            if updated {
                info!("Updated transcript segment {} (seq: {}) - total segments: {}",
                      segment_id, segment_seq, store.len());
            } else {
                info!("Added new transcript segment {} (seq: {}) - total segments: {}",
                      segment_id, segment_seq, store.len());
            }
        } else {
            error!("Failed to lock transcript segments for adding segment {}", segment_id);
        }

        // No I/O here: this runs under the global RECORDING_MANAGER mutex per
        // segment, and rewriting the whole transcripts.json each time is O(n²)
        // over the session. The debounced writer task persists within 10s.
        self.transcripts_dirty.store(true, Ordering::Relaxed);
    }

    /// Legacy method for backward compatibility - converts text to basic segment
    pub fn add_transcript_chunk(&self, text: String) {
        let segment = TranscriptSegment {
            id: format!("seg_{}", chrono::Utc::now().timestamp_millis()),
            text,
            audio_start_time: 0.0,
            audio_end_time: 0.0,
            duration: 0.0,
            display_time: "[00:00]".to_string(),
            confidence: 1.0,
            sequence_id: 0,
            source_type: None, // Unknown source for legacy chunks
        };
        self.add_transcript_segment(segment);
    }

    /// Start accumulation with optional incremental saving
    ///
    /// # Arguments
    /// * `auto_save` - If true, creates checkpoints and enables saving. If false, audio chunks are discarded.
    pub fn start_accumulation(&mut self, auto_save: bool) -> mpsc::UnboundedSender<AudioChunk> {
        if auto_save {
            info!("Initializing incremental audio saver for recording (auto-save ENABLED)");
        } else {
            info!("Starting recording without audio saving (auto-save DISABLED - transcripts only)");
        }

        // Create channel for receiving audio chunks
        let (sender, receiver) = mpsc::unbounded_channel::<AudioChunk>();
        self.chunk_receiver = Some(receiver);

        // Initialize meeting folder and incremental saver ONLY if auto_save is enabled
        if auto_save {
            if let Some(name) = self.meeting_name.clone() {
                match self.initialize_meeting_folder(&name, true) {
                    Ok(()) => info!("Successfully initialized meeting folder with checkpoints"),
                    Err(e) => {
                        error!("Failed to initialize meeting folder: {}", e);
                        // Continue anyway - will use fallback flat structure
                    }
                }
            }
        } else {
            // When auto_save is false, still create meeting folder for transcripts/metadata
            // but skip .checkpoints directory
            if let Some(name) = self.meeting_name.clone() {
                match self.initialize_meeting_folder(&name, false) {
                    Ok(()) => info!("Successfully initialized meeting folder (transcripts only)"),
                    Err(e) => {
                        error!("Failed to initialize meeting folder: {}", e);
                    }
                }
            }
        }

        // Set saving flag BEFORE spawning tasks so their first ticks see it
        if let Ok(mut is_saving) = self.is_saving.lock() {
            *is_saving = true;
        }

        // Debounced transcript writer: persists transcripts.json every 10s
        // while dirty, off the async runtime. stop_and_save lo apaga de forma
        // DETERMINISTA (cancel + join) antes de su escritura final y del clear;
        // transcript_io_lock solo serializa escrituras, el orden lo da el join.
        if let Some(folder) = self.meeting_folder.clone() {
            // Defensivo: no debería haber un writer previo vivo (el saver es
            // por-grabación), pero si lo hubiera compartiría store y archivo.
            if let Some(token) = self.writer_shutdown.take() {
                token.cancel();
            }
            if let Some(handle) = self.writer_handle.take() {
                handle.abort();
            }
            let token = CancellationToken::new();
            self.writer_handle = Some(spawn_transcript_writer(
                self.transcript_segments.clone(),
                self.transcripts_dirty.clone(),
                self.transcript_io_lock.clone(),
                folder,
                token.clone(),
                std::time::Duration::from_secs(10),
            ));
            self.writer_shutdown = Some(token);
        }

        // Start accumulation task
        let is_saving_clone = self.is_saving.clone();
        let incremental_saver_arc = self.incremental_saver.clone();
        let save_audio = auto_save;

        if let Some(mut receiver) = self.chunk_receiver.take() {
            tokio::spawn(async move {
                info!("Recording saver accumulation task started (save_audio: {})", save_audio);

                while let Some(chunk) = receiver.recv().await {
                    // Check if we should continue
                    let should_continue = if let Ok(is_saving) = is_saving_clone.lock() {
                        *is_saving
                    } else {
                        false
                    };

                    if !should_continue {
                        break;
                    }

                    // Only process audio chunks if auto_save is enabled
                    if save_audio {
                        // Add chunk to incremental saver
                        if let Some(saver_arc) = &incremental_saver_arc {
                            let mut saver_guard = saver_arc.lock().await;
                            if let Err(e) = saver_guard.add_chunk(chunk) {
                                error!("Failed to add chunk to incremental saver: {}", e);
                            }
                        } else {
                            error!("Incremental saver not available while accumulating");
                        }
                    } else {
                        // auto_save is false: discard audio chunk (no-op)
                        // Transcription already happened in the pipeline before this point
                    }
                }

                info!("Recording saver accumulation task ended");
            });
        }

        sender
    }

    /// Initialize meeting folder structure and metadata
    ///
    /// # Arguments
    /// * `meeting_name` - Name of the meeting
    /// * `create_checkpoints` - Whether to create .checkpoints/ directory and IncrementalAudioSaver
    fn initialize_meeting_folder(&mut self, meeting_name: &str, create_checkpoints: bool) -> Result<()> {
        // Load preferences to get base recordings folder
        let base_folder = super::recording_preferences::get_default_recordings_folder();

        // Create meeting folder structure (with or without .checkpoints/ subdirectory)
        let meeting_folder = create_meeting_folder(&base_folder, meeting_name, create_checkpoints)?;

        // Only initialize incremental saver if checkpoints are needed (auto_save is true)
        if create_checkpoints {
            let incremental_saver = IncrementalAudioSaver::new(meeting_folder.clone(), 48000, 2)?;
            self.incremental_saver = Some(Arc::new(AsyncMutex::new(incremental_saver)));
            info!("✅ Incremental audio saver initialized for meeting: {}", meeting_name);
        } else {
            info!("⚠️  Skipped incremental audio saver (auto-save disabled)");
        }

        // Create initial metadata
        let metadata = MeetingMetadata {
            version: "1.0".to_string(),
            meeting_id: None,  // Will be set by backend
            meeting_name: Some(meeting_name.to_string()),
            created_at: chrono::Utc::now().to_rfc3339(),
            completed_at: None,
            duration_seconds: None,
            devices: DeviceInfo {
                microphone: None,  // Could be enhanced to store actual device names
                system_audio: None,
            },
            audio_file: if create_checkpoints { "audio.mp4".to_string() } else { "".to_string() },
            transcript_file: "transcripts.json".to_string(),
            sample_rate: 48000,
            status: "recording".to_string(),
        };

        // Write initial metadata.json
        self.write_metadata(&meeting_folder, &metadata)?;

        self.meeting_folder = Some(meeting_folder);
        self.metadata = Some(metadata);

        Ok(())
    }

    /// Write metadata.json to disk (atomic write with temp file)
    fn write_metadata(&self, folder: &PathBuf, metadata: &MeetingMetadata) -> Result<()> {
        let metadata_path = folder.join("metadata.json");
        let temp_path = folder.join(".metadata.json.tmp");

        let json_string = serde_json::to_string_pretty(metadata)?;
        std::fs::write(&temp_path, json_string)?;
        std::fs::rename(&temp_path, &metadata_path)?;  // Atomic

        Ok(())
    }

    /// Write transcripts.json to disk (atomic write with temp file)
    fn write_transcripts_json(&self, folder: &PathBuf) -> Result<()> {
        write_transcripts_snapshot(&self.transcript_segments, folder, &self.transcript_io_lock)?;
        Ok(())
    }

    // in frontend/src-tauri/src/audio/recording_saver.rs
    pub fn get_stats(&self) -> (usize, u32) {
        if let Some(ref saver) = self.incremental_saver {
            if let Ok(guard) = saver.try_lock() {
                (guard.get_checkpoint_count() as usize, 48000)
            } else {
                (0, 48000)
            }
        } else {
            (0, 48000)
        }
    }

    /// Stop and save using incremental saving approach
    ///
    /// # Arguments
    /// * `app` - Tauri app handle for emitting events
    /// * `recording_duration` - Actual recording duration in seconds (from RecordingState)
    pub async fn stop_and_save<R: Runtime>(
        &mut self,
        app: &AppHandle<R>,
        recording_duration: Option<f64>
    ) -> Result<Option<String>, String> {
        info!("Stopping recording saver");

        // Stop accumulation
        if let Ok(mut is_saving) = self.is_saving.lock() {
            *is_saving = false;
        }

        // Señalizar el apagado del writer ANTES del sleep: el grace de 200ms
        // sirve a la vez para los últimos chunks y para que el writer observe
        // la cancelación.
        if let Some(token) = self.writer_shutdown.take() {
            token.cancel();
        }

        // Give time for final chunks
        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;

        // Join determinista del writer. A partir de aquí el ÚNICO que escribe
        // transcripts.json es este método — sin esto, el tick póstumo del writer
        // (hasta 10s después) escribía el store ya vaciado encima del archivo
        // final. timeout() consume el handle, por eso el abort_handle previo.
        if let Some(handle) = self.writer_handle.take() {
            let abort = handle.abort_handle();
            match tokio::time::timeout(tokio::time::Duration::from_secs(5), handle).await {
                Ok(Ok(())) => {}
                Ok(Err(e)) => warn!("Transcript writer terminó con error de join: {}", e),
                Err(_) => {
                    warn!("Transcript writer no terminó en 5s; abortando");
                    abort.abort();
                }
            }
        }

        // Escritura temprana best-effort: garantiza los transcripts en disco
        // aunque la finalización del audio falle más abajo (early-return de
        // FFmpeg). La escritura de después de FFmpeg sigue siendo la
        // autoritativa; esta es idéntica e idempotente (tmp + rename atómico).
        if let Some(folder) = &self.meeting_folder {
            if let Err(e) = self.write_transcripts_json(folder) {
                error!("❌ Early final transcript write failed: {}", e);
            }
        }

        // Check if incremental saver exists (indicates auto_save was enabled)
        let should_save_audio = self.incremental_saver.is_some();

        if !should_save_audio {
            info!("⚠️  No audio saver initialized (auto-save was disabled) - skipping audio finalization");
            return Ok(None);
        }

        // Finalize incremental saver (merge checkpoints into final audio.mp4)
        let final_audio_path = if let Some(saver_arc) = &self.incremental_saver {
            let mut saver = saver_arc.lock().await;
            match saver.finalize().await {
                Ok(path) => {
                    info!("✅ Successfully finalized audio: {}", path.display());
                    path
                }
                Err(e) => {
                    error!("❌ Failed to finalize incremental saver: {}", e);
                    return Err(format!("Failed to finalize audio: {}", e));
                }
            }
        } else {
            error!("No incremental saver initialized - cannot save recording");
            return Err("No incremental saver initialized".to_string());
        };

        // Save final transcripts.json with validation
        if let Some(folder) = &self.meeting_folder {
            if let Err(e) = self.write_transcripts_json(folder) {
                error!("❌ Failed to write final transcripts: {}", e);
                return Err(format!("Failed to save transcripts: {}", e));
            }

            // Verify transcripts were written correctly
            let transcript_path = folder.join("transcripts.json");
            if !transcript_path.exists() {
                error!("❌ Transcript file was not created at: {}", transcript_path.display());
                return Err("Transcript file verification failed".to_string());
            }
            info!("✅ Transcripts saved and verified at: {}", transcript_path.display());
        }

        // Update metadata to completed status with actual recording duration
        if let (Some(folder), Some(mut metadata)) = (&self.meeting_folder, self.metadata.clone()) {
            metadata.status = "completed".to_string();
            metadata.completed_at = Some(chrono::Utc::now().to_rfc3339());

            // Use actual recording duration from RecordingState (more accurate than transcript segments)
            // Falls back to last transcript segment if duration not provided
            metadata.duration_seconds = recording_duration.or_else(|| {
                if let Ok(store) = self.transcript_segments.lock() {
                    store.last().map(|seg| seg.audio_end_time)
                } else {
                    None
                }
            });

            if let Err(e) = self.write_metadata(folder, &metadata) {
                error!("❌ Failed to update metadata to completed: {}", e);
                return Err(format!("Failed to update metadata: {}", e));
            }

            info!("✅ Metadata updated with duration: {:?}s", metadata.duration_seconds);
        }

        // Emit save event with audio and transcript paths
        let save_event = serde_json::json!({
            "audio_file": final_audio_path.to_string_lossy(),
            "transcript_file": self.meeting_folder.as_ref()
                .map(|f| f.join("transcripts.json").to_string_lossy().to_string()),
            "meeting_name": self.meeting_name,
            "meeting_folder": self.meeting_folder.as_ref()
                .map(|f| f.to_string_lossy().to_string())
        });

        if let Err(e) = app.emit(events::RECORDING_SAVED, &save_event) {
            warn!("Failed to emit recording-saved event: {}", e);
        }

        // Clean up transcript segments
        if let Ok(mut store) = self.transcript_segments.lock() {
            store.clear();
        }

        Ok(Some(final_audio_path.to_string_lossy().to_string()))
    }

    /// Get the meeting folder path (for passing to backend)
    pub fn get_meeting_folder(&self) -> Option<&PathBuf> {
        self.meeting_folder.as_ref()
    }

    /// Get accumulated transcript segments (for reload sync)
    pub fn get_transcript_segments(&self) -> Vec<TranscriptSegment> {
        if let Ok(store) = self.transcript_segments.lock() {
            store.clone_vec()
        } else {
            Vec::new()
        }
    }

    /// Get meeting name (for reload sync)
    pub fn get_meeting_name(&self) -> Option<String> {
        self.meeting_name.clone()
    }
}

impl Default for RecordingSaver {
    fn default() -> Self {
        Self::new()
    }
}

/// Snapshot the transcript store and write transcripts.json atomically.
/// `io_lock` serializes the shared temp-file write+rename between the
/// debounced writer task and the synchronous final write in `stop_and_save`.
fn write_transcripts_snapshot(
    segments: &Arc<Mutex<TranscriptStore>>,
    folder: &PathBuf,
    io_lock: &Arc<Mutex<()>>,
) -> Result<usize> {
    let segments_clone = segments
        .lock()
        .map_err(|_| anyhow::anyhow!("Failed to lock transcript segments"))?
        .clone_vec();

    let json = serde_json::json!({
        "version": "1.0",
        "segments": segments_clone,
        "last_updated": chrono::Utc::now().to_rfc3339(),
        "total_segments": segments_clone.len()
    });
    // Compact JSON: the file is machine-read and pretty-printing doubles the bytes
    let json_string = serde_json::to_string(&json)
        .map_err(|e| anyhow::anyhow!("JSON serialization failed: {}", e))?;

    let transcript_path = folder.join("transcripts.json");
    let temp_path = folder.join(".transcripts.json.tmp");

    let _io_guard = io_lock
        .lock()
        .map_err(|_| anyhow::anyhow!("Transcript IO lock poisoned"))?;

    std::fs::write(&temp_path, &json_string)
        .map_err(|e| anyhow::anyhow!("Failed to write temp file {}: {}", temp_path.display(), e))?;
    std::fs::rename(&temp_path, &transcript_path)
        .map_err(|e| anyhow::anyhow!("Failed to rename transcript file: {}", e))?;

    Ok(segments_clone.len())
}

/// Spawnea el debounced transcript writer: escribe transcripts.json cada
/// `period` mientras `dirty` esté prendido, fuera del hilo async.
///
/// Contrato de apagado (patrón de graceful shutdown de tokio-util):
/// - En cancel: sale SIN escribir. Tras el join, el único escritor del archivo
///   es `stop_and_save`, que hace su propia escritura final síncrona.
/// - La cancelación solo se observa al tope del loop, así que el join espera a
///   que una escritura in-flight termine (no se corta a mitad de un write).
/// - `spawn_blocking` no es abortable: el guard `is_cancelled()` dentro del
///   closure evita que un write ya encolado corra después del cancel y pise el
///   archivo final con un store posiblemente vaciado.
fn spawn_transcript_writer(
    segments: Arc<Mutex<TranscriptStore>>,
    dirty: Arc<AtomicBool>,
    io_lock: Arc<Mutex<()>>,
    folder: PathBuf,
    shutdown: CancellationToken,
    period: std::time::Duration,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(period);
        loop {
            tokio::select! {
                biased;
                _ = shutdown.cancelled() => break,
                _ = interval.tick() => {
                    if dirty.swap(false, Ordering::Relaxed) {
                        let segments = segments.clone();
                        let folder = folder.clone();
                        let io_lock = io_lock.clone();
                        let token = shutdown.clone();
                        let write = tokio::task::spawn_blocking(move || {
                            if token.is_cancelled() {
                                return Ok(0);
                            }
                            write_transcripts_snapshot(&segments, &folder, &io_lock)
                        })
                        .await;
                        match write {
                            Ok(Ok(count)) => info!("Debounced transcript write: {} segments", count),
                            Ok(Err(e)) => warn!("Debounced transcript write failed: {}", e),
                            Err(e) => warn!("Transcript writer join error: {}", e),
                        }
                    }
                }
            }
        }
        info!("Transcript writer task ended");
    })
}

#[cfg(test)]
mod transcript_writer_tests {
    use super::*;
    use tempfile::tempdir;

    fn seg(sequence_id: u64) -> TranscriptSegment {
        TranscriptSegment {
            id: format!("seg_{}", sequence_id),
            text: format!("texto {}", sequence_id),
            audio_start_time: sequence_id as f64,
            audio_end_time: sequence_id as f64 + 1.0,
            duration: 1.0,
            display_time: "[00:00]".to_string(),
            confidence: 1.0,
            sequence_id,
            source_type: Some("user".to_string()),
        }
    }

    fn store_with(n: u64) -> Arc<Mutex<TranscriptStore>> {
        let store = Arc::new(Mutex::new(TranscriptStore::new()));
        {
            let mut guard = store.lock().expect("store lock");
            for i in 0..n {
                guard.upsert(seg(i));
            }
        }
        store
    }

    fn read_total_segments(folder: &std::path::Path) -> usize {
        let raw = std::fs::read_to_string(folder.join("transcripts.json")).expect("leer json");
        let json: serde_json::Value = serde_json::from_str(&raw).expect("parsear json");
        json["total_segments"].as_u64().expect("total_segments") as usize
    }

    /// REGRESIÓN del truncado post-stop (jul-2026): el tick póstumo del writer
    /// escribía el store ya vaciado por `stop_and_save` encima del archivo
    /// final → transcripts.json con 0 segmentos y el segmento de jornada no se
    /// persistía. La secuencia cancel → join → escritura final → clear debe
    /// dejar el archivo íntegro sin importar cuántos periodos pasen después.
    #[tokio::test]
    async fn el_stop_no_deja_que_un_tick_postumo_trunque_el_archivo() {
        let dir = tempdir().expect("tempdir");
        let folder = dir.path().to_path_buf();
        let store = store_with(3);
        let dirty = Arc::new(AtomicBool::new(true));
        let io_lock = Arc::new(Mutex::new(()));
        let token = CancellationToken::new();
        let period = std::time::Duration::from_millis(50);

        let handle = spawn_transcript_writer(
            store.clone(),
            dirty.clone(),
            io_lock.clone(),
            folder.clone(),
            token.clone(),
            period,
        );

        // Deja correr al menos un tick con los 3 segmentos.
        tokio::time::sleep(period * 3).await;

        // Tail: llega un 4º segmento justo antes del stop.
        store.lock().expect("store lock").upsert(seg(3));
        dirty.store(true, Ordering::Relaxed);

        // Secuencia exacta de stop_and_save: cancel → join → write final → clear.
        token.cancel();
        handle.await.expect("join del writer");
        write_transcripts_snapshot(&store, &folder, &io_lock).expect("escritura final");
        store.lock().expect("store lock").clear();

        // Con el bug, un tick póstumo reescribía el archivo con 0 segmentos.
        tokio::time::sleep(period * 4).await;
        assert_eq!(read_total_segments(&folder), 4, "el archivo final no debe truncarse");
    }

    /// En cancel el writer sale sin escribir: la escritura final es propiedad
    /// exclusiva del stop.
    #[tokio::test]
    async fn cancelado_no_escribe_aunque_este_dirty() {
        let dir = tempdir().expect("tempdir");
        let folder = dir.path().to_path_buf();
        let store = store_with(2);
        let dirty = Arc::new(AtomicBool::new(true));
        let io_lock = Arc::new(Mutex::new(()));
        let token = CancellationToken::new();

        // Cancel ANTES de spawnear: con `biased` el cancel gana al primer tick.
        token.cancel();
        let handle = spawn_transcript_writer(
            store,
            dirty,
            io_lock,
            folder.clone(),
            token,
            std::time::Duration::from_millis(20),
        );
        handle.await.expect("join del writer");

        assert!(
            !folder.join("transcripts.json").exists(),
            "un writer cancelado no debe escribir"
        );
    }

    /// Camino feliz: mientras está vivo, persiste al ritmo del periodo y apaga
    /// el flag dirty.
    #[tokio::test]
    async fn escribe_periodicamente_mientras_este_dirty() {
        let dir = tempdir().expect("tempdir");
        let folder = dir.path().to_path_buf();
        let store = store_with(5);
        let dirty = Arc::new(AtomicBool::new(true));
        let io_lock = Arc::new(Mutex::new(()));
        let token = CancellationToken::new();
        let period = std::time::Duration::from_millis(50);

        let handle = spawn_transcript_writer(
            store,
            dirty.clone(),
            io_lock,
            folder.clone(),
            token.clone(),
            period,
        );

        tokio::time::sleep(period * 3).await;
        assert_eq!(read_total_segments(&folder), 5);
        assert!(!dirty.load(Ordering::Relaxed), "el write debe apagar dirty");

        token.cancel();
        handle.await.expect("join del writer");
    }
}
