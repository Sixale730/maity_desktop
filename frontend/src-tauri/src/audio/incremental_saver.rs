use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};
use anyhow::{Result, anyhow};
use log::{info, warn, error};
use super::encode::encode_single_audio;
use super::recording_state::AudioChunk;
use serde::{Serialize, Deserialize};

use super::ffmpeg::find_ffmpeg_path;

/// Audio data without device type (we only store mixed audio)
#[derive(Clone)]
struct AudioData {
    data: Vec<f32>,
    // sample_rate: u32,
}

/// Incremental audio saver that writes checkpoints every 30 seconds
/// to minimize memory usage and enable crash recovery
pub struct IncrementalAudioSaver {
    checkpoint_buffer: Vec<AudioData>,
    buffered_samples: usize,  // running total of interleaved samples in buffer
    checkpoint_interval_samples: usize,  // 30s at 48kHz = 1,440,000 samples (per channel)
    checkpoint_count: u32,
    pending_encodes: Arc<AtomicU32>,  // background encodes still in flight
    encode_errors: Arc<AtomicU32>,
    checkpoints_dir: PathBuf,
    meeting_folder: PathBuf,
    sample_rate: u32,
    channels: u16,  // 1 = mono, 2 = stereo (L=mic, R=system)
}

impl IncrementalAudioSaver {
    /// Create a new incremental saver
    ///
    /// # Arguments
    /// * `meeting_folder` - Path to the meeting folder (contains .checkpoints/)
    /// * `sample_rate` - Sample rate of audio (typically 48000)
    /// * `channels` - Number of audio channels (1=mono, 2=stereo L=mic R=system)
    pub fn new(meeting_folder: PathBuf, sample_rate: u32, channels: u16) -> Result<Self> {
        let checkpoints_dir = meeting_folder.join(".checkpoints");

        // Verify checkpoints directory exists
        if !checkpoints_dir.exists() {
            return Err(anyhow!("Checkpoints directory does not exist: {}", checkpoints_dir.display()));
        }

        info!("IncrementalAudioSaver: {} channels, {}Hz, 30s checkpoints", channels, sample_rate);

        Ok(Self {
            checkpoint_buffer: Vec::new(),
            buffered_samples: 0,
            // 30 seconds worth of samples (accounting for channels)
            // For stereo: 48000 * 30 * 2 = 2,880,000 interleaved samples
            checkpoint_interval_samples: sample_rate as usize * 30 * channels as usize,
            checkpoint_count: 0,
            pending_encodes: Arc::new(AtomicU32::new(0)),
            encode_errors: Arc::new(AtomicU32::new(0)),
            checkpoints_dir,
            meeting_folder,
            sample_rate,
            channels,
        })
    }

    /// Add an audio chunk to the buffer
    /// Automatically saves a checkpoint when buffer reaches 30 seconds
    pub fn add_chunk(&mut self, chunk: AudioChunk) -> Result<()> {
        self.buffered_samples += chunk.data.len();
        self.checkpoint_buffer.push(AudioData {
            data: chunk.data,
            // sample_rate: chunk.sample_rate,
        });

        // Save checkpoint when buffer reaches threshold (30 seconds)
        if self.buffered_samples >= self.checkpoint_interval_samples {
            self.spawn_checkpoint_encode();
        }

        Ok(())
    }

    /// Move the buffered audio into a blocking task that encodes the checkpoint.
    /// The FFmpeg encode takes 1-4s on loaded machines; running it inline
    /// blocked a tokio worker (and the saver's AsyncMutex) that long every 30s.
    /// `finalize()` waits for `pending_encodes` before merging.
    fn spawn_checkpoint_encode(&mut self) {
        let chunks = std::mem::take(&mut self.checkpoint_buffer);
        self.buffered_samples = 0;
        if chunks.is_empty() {
            warn!("Attempted to save empty checkpoint, skipping");
            return;
        }

        let checkpoint_path = self.checkpoints_dir
            .join(format!("audio_chunk_{:03}.mp4", self.checkpoint_count));
        self.checkpoint_count += 1;
        let checkpoint_number = self.checkpoint_count;

        let sample_rate = self.sample_rate;
        let channels = self.channels;
        let pending = self.pending_encodes.clone();
        let errors = self.encode_errors.clone();
        pending.fetch_add(1, Ordering::SeqCst);

        tokio::task::spawn_blocking(move || {
            // Decrement even if the encode panics
            struct PendingGuard(Arc<AtomicU32>);
            impl Drop for PendingGuard {
                fn drop(&mut self) {
                    self.0.fetch_sub(1, Ordering::SeqCst);
                }
            }
            let _guard = PendingGuard(pending);

            let total: usize = chunks.iter().map(|c| c.data.len()).sum();
            let mut audio_data: Vec<f32> = Vec::with_capacity(total);
            for c in &chunks {
                audio_data.extend_from_slice(&c.data);
            }

            match encode_single_audio(
                bytemuck::cast_slice(&audio_data),
                sample_rate,
                channels,
                &checkpoint_path,
            ) {
                Ok(()) => {
                    let duration_seconds =
                        audio_data.len() as f32 / (sample_rate as f32 * channels as f32);
                    info!("Saved checkpoint {}: {:.2}s of audio ({} samples)",
                          checkpoint_number, duration_seconds, audio_data.len());
                }
                Err(e) => {
                    errors.fetch_add(1, Ordering::SeqCst);
                    error!("Failed to encode checkpoint {}: {}", checkpoint_number, e);
                }
            }
        });
    }

    /// Finalize the recording: save final checkpoint, merge all checkpoints, cleanup
    ///
    /// Returns the path to the final merged audio.mp4 file
    pub async fn finalize(&mut self) -> Result<PathBuf> {
        info!("Finalizing incremental recording...");

        // Save final buffer if not empty
        if !self.checkpoint_buffer.is_empty() {
            info!("Saving final checkpoint with remaining {} chunks", self.checkpoint_buffer.len());
            self.spawn_checkpoint_encode();
        }

        // Wait for background encodes: their files must exist before the merge
        let wait_start = std::time::Instant::now();
        while self.pending_encodes.load(Ordering::SeqCst) > 0 {
            if wait_start.elapsed() > std::time::Duration::from_secs(300) {
                return Err(anyhow!(
                    "Timed out waiting for {} checkpoint encode(s) to finish",
                    self.pending_encodes.load(Ordering::SeqCst)
                ));
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
        let failed = self.encode_errors.load(Ordering::SeqCst);
        if failed > 0 {
            warn!("{} checkpoint(s) failed to encode; merge will skip their files", failed);
        }

        if self.checkpoint_count == 0 {
            return Err(anyhow!("No audio checkpoints to merge - recording may have failed"));
        }

        // Merge all checkpoints using FFmpeg concat
        let final_audio_path = self.meeting_folder.join("audio.mp4");
        self.merge_checkpoints(&final_audio_path).await?;

        // Clean up checkpoints directory
        info!("Cleaning up {} checkpoint files", self.checkpoint_count);
        if let Err(e) = std::fs::remove_dir_all(&self.checkpoints_dir) {
            warn!("Failed to clean up checkpoints directory: {}", e);
            // Non-fatal - user can manually delete
        }

        info!("Finalized recording: {}", final_audio_path.display());

        Ok(final_audio_path)
    }

    /// Merge all checkpoint files into final audio.mp4 using FFmpeg concat
    /// Uses concat demuxer for fast merging without re-encoding
    async fn merge_checkpoints(&self, output: &PathBuf) -> Result<()> {
        info!("Merging {} checkpoints into final audio file...", self.checkpoint_count);

        // Create concat list file for FFmpeg
        let list_file = self.checkpoints_dir.join("concat_list.txt");
        let mut list_content = String::new();

        let mut missing = 0u32;
        for i in 0..self.checkpoint_count {
            let checkpoint_path = self.checkpoints_dir
                .join(format!("audio_chunk_{:03}.mp4", i));

            // A failed background encode leaves a gap; losing 30s beats
            // failing the whole recording, so skip with a warning.
            if !checkpoint_path.exists() {
                warn!("Checkpoint file missing (encode failed?), skipping: {}", checkpoint_path.display());
                missing += 1;
                continue;
            }

            // Use absolute path for FFmpeg (required for safe mode)
            let abs_path = checkpoint_path.canonicalize()?;
            list_content.push_str(&format!("file '{}'\n", abs_path.display()));
        }

        if missing == self.checkpoint_count {
            return Err(anyhow!("All {} checkpoint files are missing", missing));
        }

        std::fs::write(&list_file, list_content)?;

        let ffmpeg_path = find_ffmpeg_path()
            .ok_or_else(|| anyhow!("FFmpeg not found. Please install FFmpeg to finalize recordings."))?;
        info!("Using FFmpeg at: {:?}", ffmpeg_path);

        // Run FFmpeg concat command
        // Using concat demuxer with copy codec for fast merging (no re-encoding)
        
        let mut command = std::process::Command::new(ffmpeg_path);
        
        command.args(&[
            "-f", "concat",          // Use concat demuxer
            "-safe", "0",            // Allow absolute paths
            "-i", list_file.to_str().ok_or_else(|| anyhow::anyhow!("List file path contains invalid UTF-8: {:?}", list_file))?,
            "-c", "copy",            // Copy codec - no re-encoding!
            "-y",                    // Overwrite output file
            output.to_str().ok_or_else(|| anyhow::anyhow!("Output path contains invalid UTF-8: {:?}", output))?
        ]);

        // Hide console window on Windows to prevent CMD popup during finalization
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            command.creation_flags(CREATE_NO_WINDOW);
        }

        let ffmpeg_output = command.output()?;

        if !ffmpeg_output.status.success() {
            let stderr = String::from_utf8_lossy(&ffmpeg_output.stderr);
            error!("FFmpeg merge failed: {}", stderr);
            return Err(anyhow!("FFmpeg concat failed: {}", stderr));
        }

        // Verify output file was created
        if !output.exists() {
            return Err(anyhow!("Merged audio file was not created: {}", output.display()));
        }

        info!("Successfully merged {} checkpoints → {}",
              self.checkpoint_count, output.display());

        Ok(())
    }

    /// Get the meeting folder path
    pub fn get_meeting_folder(&self) -> &PathBuf {
        &self.meeting_folder
    }

    /// Get current checkpoint count
    pub fn get_checkpoint_count(&self) -> u32 {
        self.checkpoint_count
    }
}

/// Audio recovery status for transcript recovery feature
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioRecoveryStatus {
    pub status: String, // "success" | "partial" | "failed" | "none"
    pub chunk_count: u32,
    pub estimated_duration_seconds: f64,
    pub audio_file_path: Option<String>,
    pub message: String,
}

/// Recover audio from checkpoint files
/// This is called by the transcript recovery system to merge audio chunks after a crash
#[tauri::command]
pub async fn recover_audio_from_checkpoints(
    meeting_folder: String,
    _sample_rate: u32
) -> Result<AudioRecoveryStatus, String> {
    info!("Starting audio recovery for folder: {}", meeting_folder);

    let folder_path = PathBuf::from(&meeting_folder);
    let checkpoints_dir = folder_path.join(".checkpoints");

    // Check if checkpoints directory exists
    if !checkpoints_dir.exists() {
        info!("No checkpoints directory found at: {}", checkpoints_dir.display());
        return Ok(AudioRecoveryStatus {
            status: "none".to_string(),
            chunk_count: 0,
            estimated_duration_seconds: 0.0,
            audio_file_path: None,
            message: "No audio checkpoints found".to_string(),
        });
    }

    // Scan for checkpoint files
    let mut checkpoint_files: Vec<_> = std::fs::read_dir(&checkpoints_dir)
        .map_err(|e| format!("Failed to read checkpoints directory: {}", e))?
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            entry.path().extension().and_then(|s| s.to_str()) == Some("mp4")
        })
        .collect();

    if checkpoint_files.is_empty() {
        info!("No checkpoint files found in: {}", checkpoints_dir.display());
        return Ok(AudioRecoveryStatus {
            status: "none".to_string(),
            chunk_count: 0,
            estimated_duration_seconds: 0.0,
            audio_file_path: None,
            message: "No audio checkpoint files found".to_string(),
        });
    }

    // Sort by filename (audio_chunk_000.mp4, audio_chunk_001.mp4, etc.)
    checkpoint_files.sort_by_key(|entry| entry.path());

    let chunk_count = checkpoint_files.len() as u32;
    let estimated_duration = (chunk_count as f64) * 30.0; // 30 seconds per chunk

    info!("Found {} checkpoint files, estimated duration: {:.2}s", chunk_count, estimated_duration);

    // Create FFmpeg concat file
    let concat_file_path = checkpoints_dir.join("concat_list.txt");
    let mut concat_content = String::new();

    for entry in &checkpoint_files {
        let path = entry.path().canonicalize()
            .map_err(|e| format!("Failed to canonicalize path: {}", e))?;
        concat_content.push_str(&format!("file '{}'\n", path.display()));
    }

    std::fs::write(&concat_file_path, concat_content)
        .map_err(|e| format!("Failed to write concat file: {}", e))?;

    // Run FFmpeg to merge chunks
    let output_path = folder_path.join("audio.mp4");
    let output_path_str = output_path.to_str()
        .ok_or("Invalid output path")?
        .to_string();

    let ffmpeg_path = find_ffmpeg_path()
        .ok_or_else(|| "FFmpeg not found. Please install FFmpeg to recover audio.".to_string())?;
    info!("Using FFmpeg at: {:?}", ffmpeg_path);

    let mut command = std::process::Command::new(ffmpeg_path);

    command.args(&[
        "-f", "concat",
        "-safe", "0",
        "-i", concat_file_path.to_str().ok_or_else(|| format!("Concat file path contains invalid UTF-8: {:?}", concat_file_path))?,
        "-c", "copy",
        "-y", // Overwrite if exists
        &output_path_str
    ]);

    // Hide console window on Windows
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let ffmpeg_result = command.output();

    match ffmpeg_result {
        Ok(output) if output.status.success() => {
            // Clean up concat file
            let _ = std::fs::remove_file(concat_file_path);

            info!("Successfully recovered audio: {}", output_path_str);

            Ok(AudioRecoveryStatus {
                status: "success".to_string(),
                chunk_count,
                estimated_duration_seconds: estimated_duration,
                audio_file_path: Some(output_path_str),
                message: format!("Successfully recovered {} audio chunks", chunk_count),
            })
        }
        Ok(output) => {
            let error = String::from_utf8_lossy(&output.stderr);
            error!("FFmpeg recovery failed: {}", error);
            Ok(AudioRecoveryStatus {
                status: "failed".to_string(),
                chunk_count,
                estimated_duration_seconds: estimated_duration,
                audio_file_path: None,
                message: format!("FFmpeg failed: {}", error),
            })
        }
        Err(e) => {
            error!("Failed to run FFmpeg: {}", e);
            Ok(AudioRecoveryStatus {
                status: "failed".to_string(),
                chunk_count,
                estimated_duration_seconds: estimated_duration,
                audio_file_path: None,
                message: format!("Failed to run FFmpeg: {}", e),
            })
        }
    }
}

/// Clean up checkpoint files after successful recording or recovery
/// This command is called by the frontend after successful save to clean up checkpoint files
#[tauri::command]
pub async fn cleanup_checkpoints(meeting_folder: String) -> Result<(), String> {
    info!("Cleaning up checkpoints for folder: {}", meeting_folder);

    let folder_path = PathBuf::from(&meeting_folder);
    let checkpoints_dir = folder_path.join(".checkpoints");

    if checkpoints_dir.exists() {
        std::fs::remove_dir_all(&checkpoints_dir)
            .map_err(|e| format!("Failed to remove checkpoints directory: {}", e))?;
        info!("Successfully cleaned up checkpoints directory");
    } else {
        info!("No checkpoints directory to clean up");
    }

    Ok(())
}

/// Check if a meeting folder has audio checkpoint files
/// Returns true if .checkpoints/ directory exists and contains .mp4 files
#[tauri::command]
pub async fn has_audio_checkpoints(meeting_folder: String) -> Result<bool, String> {
    let folder_path = PathBuf::from(&meeting_folder);
    let checkpoints_dir = folder_path.join(".checkpoints");

    // Check if checkpoints directory exists
    if !checkpoints_dir.exists() {
        return Ok(false);
    }

    // Scan for .mp4 checkpoint files
    let has_mp4_files = std::fs::read_dir(&checkpoints_dir)
        .map_err(|e| format!("Failed to read checkpoints directory: {}", e))?
        .filter_map(|entry| entry.ok())
        .any(|entry| {
            entry.path().extension().and_then(|s| s.to_str()) == Some("mp4")
        });

    Ok(has_mp4_files)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use super::super::recording_state::DeviceType;

    #[tokio::test]
    async fn test_checkpoint_creation() {
        // Create temp meeting folder
        let temp_dir = tempdir().unwrap();
        let meeting_folder = temp_dir.path().join("Test_Meeting");
        std::fs::create_dir_all(&meeting_folder).unwrap();
        std::fs::create_dir_all(meeting_folder.join(".checkpoints")).unwrap();

        let mut saver = IncrementalAudioSaver::new(
            meeting_folder.clone(),
            48000,
            2  // stereo (L=mic, R=system)
        ).unwrap();

        // Add 60 seconds worth of audio (should create 2 checkpoints).
        // Pipeline emits interleaved stereo chunks, so 0.5s @ 48kHz stereo = 48000 samples
        // (not 24000, which would be 0.5s mono).
        for i in 0..120u64 {  // 120 chunks of 0.5s each
            let chunk = AudioChunk {
                data: vec![0.5f32; 48000],  // 0.5s stereo interleaved @ 48kHz
                sample_rate: 48000,
                timestamp: i as f64 * 0.5,
                chunk_id: i,
                device_type: DeviceType::Mixed,
                ended_by_silence: true,
            };
            saver.add_chunk(chunk).unwrap();
        }

        // Verify 2 checkpoints created
        assert_eq!(saver.checkpoint_count, 2);

        // Finalize and verify merge
        let final_path = saver.finalize().await.unwrap();
        assert!(final_path.exists());

        // Verify checkpoints directory deleted
        assert!(!meeting_folder.join(".checkpoints").exists());
    }

    #[tokio::test]
    async fn test_empty_recording() {
        let temp_dir = tempdir().unwrap();
        let meeting_folder = temp_dir.path().join("Empty_Test");
        std::fs::create_dir_all(&meeting_folder).unwrap();
        std::fs::create_dir_all(meeting_folder.join(".checkpoints")).unwrap();

        let mut saver = IncrementalAudioSaver::new(
            meeting_folder.clone(),
            48000,
            2  // stereo (L=mic, R=system)
        ).unwrap();

        // Try to finalize without adding any chunks
        let result = saver.finalize().await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("No audio checkpoints"));
    }
}
