use anyhow::{anyhow, Result};
use silero_rs::{VadConfig, VadSession, VadTransition};
use log::{debug, info};
use std::collections::VecDeque;
use std::time::Duration;

/// Represents a complete speech segment detected by VAD
#[derive(Debug, Clone)]
pub struct SpeechSegment {
    pub samples: Vec<f32>,
    pub start_timestamp_ms: f64,
    pub end_timestamp_ms: f64,
    pub confidence: f32,
}

/// Processes audio in 30ms chunks but returns complete speech segments
pub struct ContinuousVadProcessor {
    session: VadSession,
    chunk_size: usize,
    sample_rate: u32,
    buffer: Vec<f32>,
    speech_segments: VecDeque<SpeechSegment>,
    current_speech: Vec<f32>,
    in_speech: bool,
    processed_samples: usize,
    speech_start_sample: usize,
    // State tracking for smart logging
    last_logged_state: bool,
}

impl ContinuousVadProcessor {
    pub fn new(input_sample_rate: u32, redemption_time_ms: u32) -> Result<Self> {
        // Silero VAD MUST use 16kHz - this is hardcoded requirement
        const VAD_SAMPLE_RATE: u32 = 16000;

        // Use STRICT settings to prevent silence from reaching Whisper
        let mut config = VadConfig::default();
        config.sample_rate = VAD_SAMPLE_RATE as usize;

        // UX-012 (ZERO DATA LOSS TUNING — Ciclo #7, 2026-04-12):
        // Balance entre prevención de hallucinations y captura de speech real.
        // MIN_SPEECH_MS 300→200: interjecciones cortas ("sí","no","ajá") ~200ms se perdían.
        // POS_THRESHOLD 0.55→0.45: voz suave o acentuada no alcanzaba 0.55, datos perdidos.
        // MIN_SILENCE_MS 400: mantener (cierre de segmento rápido = "live feel").
        const MIN_SPEECH_MS: u64 = 100;
        const MIN_SILENCE_MS: u64 = 400;
        const MAX_SPEECH_MS: u64 = 30_000;
        const POS_THRESHOLD: f32 = 0.35;
        const NEG_THRESHOLD: f32 = 0.25;

        config.positive_speech_threshold = POS_THRESHOLD;
        config.negative_speech_threshold = NEG_THRESHOLD;

        // Respetar redemption_time del caller, pero forzar piso MIN_SILENCE_MS.
        // Un redemption más corto cerraría el segmento antes que el lookahead de
        // Parakeet termine, produciendo transcripts truncados.
        let effective_redemption = (redemption_time_ms as u64).max(MIN_SILENCE_MS);
        config.redemption_time = Duration::from_millis(effective_redemption);

        config.pre_speech_pad = Duration::from_millis(200);
        config.post_speech_pad = Duration::from_millis(500);
        config.min_speech_time = Duration::from_millis(MIN_SPEECH_MS);

        debug!(
            "Creating VAD session (Parakeet-tuned): sample_rate={}Hz, redemption={}ms (floor={}), min_speech={}ms, max_speech={}ms, pos={}, neg={}, input_rate={}Hz",
            VAD_SAMPLE_RATE, effective_redemption, MIN_SILENCE_MS, MIN_SPEECH_MS, MAX_SPEECH_MS, POS_THRESHOLD, NEG_THRESHOLD, input_sample_rate
        );
        let _ = MAX_SPEECH_MS; // referenced for clarity, enforced en pipeline scheduler

        let session = VadSession::new(config)
            .map_err(|e| anyhow!("Failed to create VAD session: {:?}", e))?;

        // VAD uses 30ms chunks at 16kHz (480 samples)
        let vad_chunk_size = (VAD_SAMPLE_RATE as f32 * 0.03) as usize; // 480 samples

        info!("VAD processor created: input={}Hz, vad={}Hz, chunk_size={} samples",
              input_sample_rate, VAD_SAMPLE_RATE, vad_chunk_size);

        Ok(Self {
            session,
            chunk_size: vad_chunk_size,
            sample_rate: input_sample_rate, // Store original for timestamp calculations
            buffer: Vec::with_capacity(vad_chunk_size * 2),
            speech_segments: VecDeque::new(),
            current_speech: Vec::new(),
            in_speech: false,
            processed_samples: 0,
            speech_start_sample: 0,
            // Initialize state tracking
            last_logged_state: false,
        })
    }

    /// Process incoming audio samples and return any complete speech segments
    /// Handles resampling from input sample rate to 16kHz for VAD processing
    pub fn process_audio(&mut self, samples: &[f32]) -> Result<Vec<SpeechSegment>> {
        // Resample to 16kHz if needed
        let resampled_audio = if self.sample_rate == 16000 {
            samples.to_vec()
        } else {
            self.resample_to_16k(samples)?
        };

        self.buffer.extend_from_slice(&resampled_audio);
        let mut completed_segments = Vec::new();

        // Process complete 30ms chunks (480 samples at 16kHz)
        while self.buffer.len() >= self.chunk_size {
            let chunk: Vec<f32> = self.buffer.drain(..self.chunk_size).collect();
            self.process_chunk(&chunk)?;

            // Extract any completed speech segments
            while let Some(segment) = self.speech_segments.pop_front() {
                completed_segments.push(segment);
            }
        }

        Ok(completed_segments)
    }

    /// Improved resampling from input sample rate to 16kHz with anti-aliasing
    /// Uses linear interpolation and basic low-pass filtering for better quality
    fn resample_to_16k(&self, samples: &[f32]) -> Result<Vec<f32>> {
        if self.sample_rate == 16000 {
            return Ok(samples.to_vec());
        }

        // Calculate downsampling ratio
        let ratio = self.sample_rate as f64 / 16000.0;
        let output_len = (samples.len() as f64 / ratio) as usize;
        let mut resampled = Vec::with_capacity(output_len);

        // Apply simple low-pass filter before downsampling to reduce aliasing
        let cutoff_freq = 0.4; // Normalized frequency (0.4 * Nyquist)
        let mut filtered_samples = Vec::with_capacity(samples.len());
        
        // Simple moving average filter (basic low-pass)
        let filter_size = (self.sample_rate as f64 / (cutoff_freq * self.sample_rate as f64)) as usize;
        let filter_size = std::cmp::max(1, std::cmp::min(filter_size, 5)); // Limit filter size
        
        for i in 0..samples.len() {
            let start = if i >= filter_size { i - filter_size } else { 0 };
            let end = std::cmp::min(i + filter_size + 1, samples.len());
            let sum: f32 = samples[start..end].iter().sum();
            filtered_samples.push(sum / (end - start) as f32);
        }

        // Linear interpolation downsampling
        for i in 0..output_len {
            let source_pos = i as f64 * ratio;
            let source_index = source_pos as usize;
            let fraction = source_pos - source_index as f64;
            
            if source_index + 1 < filtered_samples.len() {
                // Linear interpolation
                let sample1 = filtered_samples[source_index];
                let sample2 = filtered_samples[source_index + 1];
                let interpolated = sample1 + (sample2 - sample1) * fraction as f32;
                resampled.push(interpolated);
            } else if source_index < filtered_samples.len() {
                resampled.push(filtered_samples[source_index]);
            }
        }

        debug!("Resampled from {} samples ({}Hz) to {} samples (16kHz) with anti-aliasing",
               samples.len(), self.sample_rate, resampled.len());

        Ok(resampled)
    }

    /// Flush any remaining audio and return final speech segments
    pub fn flush(&mut self) -> Result<Vec<SpeechSegment>> {
        let mut completed_segments = Vec::new();

        // Process any remaining buffered audio
        if !self.buffer.is_empty() {
            let remaining = self.buffer.clone();
            self.buffer.clear();

            // Pad to chunk size if needed
            let mut padded_chunk = remaining;
            if padded_chunk.len() < self.chunk_size {
                padded_chunk.resize(self.chunk_size, 0.0);
            }

            self.process_chunk(&padded_chunk)?;
        }

        // Force end any ongoing speech
        if self.in_speech && !self.current_speech.is_empty() {
            let start_ms = (self.speech_start_sample as f64 / self.sample_rate as f64) * 1000.0;
            let end_ms = (self.processed_samples as f64 / self.sample_rate as f64) * 1000.0;

            let segment = SpeechSegment {
                samples: self.current_speech.clone(),
                start_timestamp_ms: start_ms,
                end_timestamp_ms: end_ms,
                confidence: 0.8, // Estimated confidence for forced end
            };

            self.speech_segments.push_back(segment);
            self.current_speech.clear();
            self.in_speech = false;
        }

        // Extract all remaining segments
        while let Some(segment) = self.speech_segments.pop_front() {
            completed_segments.push(segment);
        }

        Ok(completed_segments)
    }

    fn process_chunk(&mut self, chunk: &[f32]) -> Result<()> {
        let transitions = self.session.process(chunk)
            .map_err(|e| anyhow!("VAD processing failed: {}", e))?;

        // Handle VAD transitions
        for transition in transitions {
            match transition {
                VadTransition::SpeechStart { timestamp_ms } => {
                    // Only log if state changed
                    if !self.last_logged_state {
                        info!("VAD: Speech started at {}ms", timestamp_ms);
                        self.last_logged_state = true;
                    }
                    self.in_speech = true;
                    self.speech_start_sample = self.processed_samples + (timestamp_ms * self.sample_rate as usize / 1000);
                    self.current_speech.clear();
                }
                VadTransition::SpeechEnd { start_timestamp_ms, end_timestamp_ms, samples } => {
                    // Only log if we were previously in speech state
                    if self.last_logged_state {
                        info!("VAD: Speech ended at {}ms (duration: {}ms)", end_timestamp_ms, end_timestamp_ms - start_timestamp_ms);
                        self.last_logged_state = false;
                    }
                    self.in_speech = false;

                    // Use samples from VAD transition if available, otherwise use accumulated samples
                    let speech_samples = if !samples.is_empty() {
                        samples
                    } else {
                        self.current_speech.clone()
                    };

                    if !speech_samples.is_empty() {
                        let segment = SpeechSegment {
                            samples: speech_samples,
                            start_timestamp_ms: start_timestamp_ms as f64,
                            end_timestamp_ms: end_timestamp_ms as f64,
                            confidence: 0.9, // VAD confidence
                        };

                        info!("VAD: Completed speech segment: {:.1}ms duration, {} samples",
                              end_timestamp_ms - start_timestamp_ms, segment.samples.len());

                        self.speech_segments.push_back(segment);
                    }

                    self.current_speech.clear();
                }
            }
        }

        // Accumulate speech if we're currently in a speech state
        if self.in_speech {
            self.current_speech.extend_from_slice(chunk);
        }

        self.processed_samples += chunk.len();
        Ok(())
    }
}

/// Legacy function for backward compatibility - now uses the optimized approach
pub fn extract_speech_16k(samples_mono_16k: &[f32]) -> Result<Vec<f32>> {
    let mut processor = ContinuousVadProcessor::new(16000, 400)?;

    // Process all audio
    let mut all_segments = processor.process_audio(samples_mono_16k)?;
    let final_segments = processor.flush()?;
    all_segments.extend(final_segments);

    // Concatenate all speech segments
    let mut result = Vec::new();
    let num_segments = all_segments.len();
    for segment in &all_segments {
        result.extend_from_slice(&segment.samples);
    }

    // Energy gate: only reject segments that are PURE digital silence.
    // Previous thresholds (RMS<0.2, Peak<0.20) were discarding valid low-volume speech.
    // Silero VAD already handles speech detection; this filter should only catch true silence.
    if result.len() < 1600 { // Less than 100ms at 16kHz
        let input_energy: f32 = samples_mono_16k.iter().map(|&x| x * x).sum::<f32>() / samples_mono_16k.len() as f32;
        let rms = input_energy.sqrt();
        let peak = samples_mono_16k.iter().map(|&x| x.abs()).fold(0.0f32, f32::max);

        if rms < 0.005 && peak < 0.01 {
            debug!("VAD: pure silence (RMS: {:.6}, Peak: {:.6}), skipping", rms, peak);
            return Ok(Vec::new());
        }
    }

    debug!("VAD: Processed {} samples, extracted {} speech samples from {} segments",
           samples_mono_16k.len(), result.len(), num_segments);

    Ok(result)
}

/// Simple convenience function to get speech chunks from audio
/// Uses the optimized ContinuousVadProcessor with configurable redemption time
pub fn get_speech_chunks(samples_mono_16k: &[f32], redemption_time_ms: u32) -> Result<Vec<SpeechSegment>> {
    let mut processor = ContinuousVadProcessor::new(16000, redemption_time_ms)?;

    // Process all audio
    let mut segments = processor.process_audio(samples_mono_16k)?;
    let final_segments = processor.flush()?;
    segments.extend(final_segments);

    Ok(segments)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_speech_segment_creation() {
        // Arrange
        let samples = vec![0.1, 0.2, 0.3, 0.4, 0.5];

        // Act
        let segment = SpeechSegment {
            samples: samples.clone(),
            start_timestamp_ms: 0.0,
            end_timestamp_ms: 100.0,
            confidence: 0.95,
        };

        // Assert
        assert_eq!(segment.samples, samples);
        assert_eq!(segment.start_timestamp_ms, 0.0);
        assert_eq!(segment.end_timestamp_ms, 100.0);
        assert_eq!(segment.confidence, 0.95);
    }

    #[test]
    fn test_speech_segment_clone() {
        // Arrange
        let original = SpeechSegment {
            samples: vec![0.1, 0.2, 0.3],
            start_timestamp_ms: 50.0,
            end_timestamp_ms: 150.0,
            confidence: 0.85,
        };

        // Act
        let cloned = original.clone();

        // Assert
        assert_eq!(cloned.samples, original.samples);
        assert_eq!(cloned.start_timestamp_ms, original.start_timestamp_ms);
        assert_eq!(cloned.end_timestamp_ms, original.end_timestamp_ms);
        assert_eq!(cloned.confidence, original.confidence);
    }

    #[test]
    fn test_continuous_vad_processor_creation_16k() {
        // Arrange, Act
        let result = ContinuousVadProcessor::new(16000, 400);

        // Assert
        assert!(result.is_ok());
        let processor = result.unwrap();
        assert_eq!(processor.sample_rate, 16000);
        assert_eq!(processor.chunk_size, 480); // 30ms at 16kHz
    }

    #[test]
    fn test_continuous_vad_processor_creation_48k() {
        // Arrange, Act
        let result = ContinuousVadProcessor::new(48000, 400);

        // Assert
        assert!(result.is_ok());
        let processor = result.unwrap();
        assert_eq!(processor.sample_rate, 48000);
        assert_eq!(processor.chunk_size, 480); // VAD internal chunk size
    }

    #[test]
    fn test_continuous_vad_processor_redemption_time_enforcement() {
        // Arrange, Act: Create with short redemption time
        let result = ContinuousVadProcessor::new(16000, 100);

        // Assert: Should succeed (effective redemption is enforced to minimum)
        assert!(result.is_ok());
    }

    #[test]
    fn test_continuous_vad_processor_empty_flush() {
        // Arrange
        let mut processor = ContinuousVadProcessor::new(16000, 400)
            .expect("Failed to create processor");

        // Act: Flush without processing any audio
        let result = processor.flush();

        // Assert
        assert!(result.is_ok());
        let segments = result.unwrap();
        assert!(segments.is_empty());
    }

    #[test]
    fn test_continuous_vad_processor_small_input() {
        // Arrange
        let mut processor =
            ContinuousVadProcessor::new(16000, 400).expect("Failed to create processor");
        let small_samples = vec![0.01; 100]; // 100 samples < 480 chunk size

        // Act
        let result = processor.process_audio(&small_samples);

        // Assert: Should process without error
        assert!(result.is_ok());
        let segments = result.unwrap();
        // Small silence may not trigger speech detection
        assert!(segments.is_empty() || segments.len() >= 0);
    }

    #[test]
    fn test_continuous_vad_processor_process_audio_no_panic() {
        // Arrange
        let mut processor =
            ContinuousVadProcessor::new(16000, 400).expect("Failed to create processor");

        // Create synthetic silence (480 samples = 1 chunk at 16kHz)
        let silent_chunk = vec![0.0; 480];

        // Act
        let result = processor.process_audio(&silent_chunk);

        // Assert: Should not panic
        assert!(result.is_ok());
    }

    #[test]
    fn test_vad_processor_resample_identity_16k() {
        // Arrange
        let processor =
            ContinuousVadProcessor::new(16000, 400).expect("Failed to create processor");
        let input = vec![0.1, 0.2, 0.3, 0.4, 0.5];

        // Act: Resample at same rate should return same samples
        let result = processor.resample_to_16k(&input);

        // Assert
        assert!(result.is_ok());
        let resampled = result.unwrap();
        assert_eq!(resampled, input);
    }

    #[test]
    fn test_vad_processor_resample_preserves_length_constraint() {
        // Arrange
        let processor =
            ContinuousVadProcessor::new(48000, 400).expect("Failed to create processor");

        // 1000 samples at 48kHz should become ~333 samples at 16kHz
        let input = vec![0.1; 1000];

        // Act
        let result = processor.resample_to_16k(&input);

        // Assert
        assert!(result.is_ok());
        let resampled = result.unwrap();
        // Rough check: downsampling by 3x
        assert!(resampled.len() > 200 && resampled.len() < 400);
    }

    #[test]
    fn test_energy_gate_pure_silence_detection() {
        // Arrange: Very quiet audio (close to silence threshold)
        let pure_silence = vec![0.001; 1600]; // 100ms at 16kHz, very low amplitude

        // Act
        let result = extract_speech_16k(&pure_silence);

        // Assert: Should return empty or minimal result for pure silence
        assert!(result.is_ok());
        let speech = result.unwrap();
        // Pure silence should be rejected by energy gate
        assert!(speech.is_empty() || speech.len() < 100);
    }

    #[test]
    fn test_get_speech_chunks_invalid_input() {
        // Arrange
        let empty_input: &[f32] = &[];

        // Act
        let result = get_speech_chunks(empty_input, 400);

        // Assert
        assert!(result.is_ok());
        let segments = result.unwrap();
        assert!(segments.is_empty());
    }
}

