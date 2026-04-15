use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::sync::mpsc;
use anyhow::Result;

use super::devices::AudioDevice;
use super::buffer_pool::AudioBufferPool;

/// Device type for audio chunks
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum DeviceType {
    Microphone,
    System,
    Mixed,  // Combined mic+system for WAV recording only
}

/// Audio chunk with metadata for processing
#[derive(Debug, Clone)]
pub struct AudioChunk {
    pub data: Vec<f32>,
    pub sample_rate: u32,
    pub timestamp: f64,
    pub chunk_id: u64,
    pub device_type: DeviceType,
}

/// Processed audio chunk (post-VAD) for recording
#[derive(Debug, Clone)]
pub struct ProcessedAudioChunk {
    pub data: Vec<f32>,
    pub sample_rate: u32,
    pub timestamp: f64,
    pub device_type: DeviceType,
}

/// Comprehensive error types for audio system
#[derive(Debug, Clone)]
pub enum AudioError {
    DeviceDisconnected,
    StreamFailed,
    ProcessingFailed,
    TranscriptionFailed,
    ChannelClosed,
    InitializationFailed,
    ConfigurationError,
    PermissionDenied,
    BufferOverflow,
    SampleRateUnsupported,
}

impl AudioError {
    /// Check if error is recoverable (can attempt reconnection)
    pub fn is_recoverable(&self) -> bool {
        match self {
            // Device disconnect is now recoverable - we can attempt reconnection
            AudioError::DeviceDisconnected => true,
            AudioError::StreamFailed => true,
            AudioError::ProcessingFailed => true,
            AudioError::TranscriptionFailed => true,
            AudioError::ChannelClosed => false,
            AudioError::InitializationFailed => false,
            AudioError::ConfigurationError => false,
            AudioError::PermissionDenied => false,
            AudioError::BufferOverflow => true,
            AudioError::SampleRateUnsupported => false,
        }
    }

    /// Get user-friendly error message
    pub fn user_message(&self) -> &'static str {
        match self {
            AudioError::DeviceDisconnected => "Audio device was disconnected",
            AudioError::StreamFailed => "Audio stream encountered an error",
            AudioError::ProcessingFailed => "Audio processing failed",
            AudioError::TranscriptionFailed => "Speech transcription failed",
            AudioError::ChannelClosed => "Audio channel was closed unexpectedly",
            AudioError::InitializationFailed => "Failed to initialize audio system",
            AudioError::ConfigurationError => "Audio configuration error",
            AudioError::PermissionDenied => "Microphone permission denied",
            AudioError::BufferOverflow => "Audio buffer overflow",
            AudioError::SampleRateUnsupported => "Audio sample rate not supported",
        }
    }
}

/// Recording statistics
#[derive(Debug, Default)]
pub struct RecordingStats {
    pub chunks_processed: u64,
    pub total_duration: f64,
    pub last_activity: Option<Instant>,
}

/// Unified state management for audio recording
pub struct RecordingState {
    // Core recording state
    is_recording: AtomicBool,
    is_paused: AtomicBool,
    is_reconnecting: AtomicBool,  // NEW: Attempting to reconnect to device

    // Audio devices
    microphone_device: Mutex<Option<Arc<AudioDevice>>>,
    system_device: Mutex<Option<Arc<AudioDevice>>>,
    // Track which device is disconnected for reconnection attempts
    disconnected_device: Mutex<Option<(Arc<AudioDevice>, DeviceType)>>,

    // Audio pipeline
    audio_sender: Mutex<Option<mpsc::UnboundedSender<AudioChunk>>>,

    // Memory optimization
    buffer_pool: AudioBufferPool,

    // Error handling
    error_count: AtomicU32,
    recoverable_error_count: AtomicU32,
    last_error: Mutex<Option<AudioError>>,
    // FIX C2: Usar Arc en lugar de Box para poder clonar y liberar lock antes de llamar
    error_callback: Mutex<Option<Arc<dyn Fn(&AudioError) + Send + Sync>>>,

    // Statistics
    stats: Mutex<RecordingStats>,

    // Recording start time for accurate timestamps
    recording_start: Mutex<Option<Instant>>,
    // Pause time tracking
    pause_start: Mutex<Option<Instant>>,
    total_pause_duration: Mutex<std::time::Duration>,

    // Real-time audio levels (f32 bits stored as u32 for atomic access)
    mic_rms_level: AtomicU32,
    sys_rms_level: AtomicU32,
    mic_peak_level: AtomicU32,
    sys_peak_level: AtomicU32,
}

impl RecordingState {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            is_recording: AtomicBool::new(false),
            is_paused: AtomicBool::new(false),
            is_reconnecting: AtomicBool::new(false),
            microphone_device: Mutex::new(None),
            system_device: Mutex::new(None),
            disconnected_device: Mutex::new(None),
            audio_sender: Mutex::new(None),
            buffer_pool: AudioBufferPool::new(16, 48000), // Pool of 16 buffers with 48kHz samples capacity
            error_count: AtomicU32::new(0),
            recoverable_error_count: AtomicU32::new(0),
            last_error: Mutex::new(None),
            error_callback: Mutex::new(None),
            stats: Mutex::new(RecordingStats::default()),
            recording_start: Mutex::new(None),
            pause_start: Mutex::new(None),
            total_pause_duration: Mutex::new(std::time::Duration::ZERO),
            mic_rms_level: AtomicU32::new(0),
            sys_rms_level: AtomicU32::new(0),
            mic_peak_level: AtomicU32::new(0),
            sys_peak_level: AtomicU32::new(0),
        })
    }

    // Recording control
    pub fn start_recording(&self) -> Result<()> {
        self.is_recording.store(true, Ordering::SeqCst);
        *self.recording_start.lock()
            .map_err(|e| anyhow::anyhow!("recording_start lock poisoned: {e}"))? = Some(Instant::now());
        self.error_count.store(0, Ordering::SeqCst);
        self.recoverable_error_count.store(0, Ordering::SeqCst);
        *self.last_error.lock()
            .map_err(|e| anyhow::anyhow!("last_error lock poisoned: {e}"))? = None;
        Ok(())
    }

    pub fn stop_recording(&self) {
        self.is_recording.store(false, Ordering::SeqCst);
        self.is_paused.store(false, Ordering::SeqCst);
        // Clear pause tracking when stopping
        match self.pause_start.lock() {
            Ok(mut guard) => *guard = None,
            Err(e) => { log::error!("pause_start lock poisoned in stop_recording: {e}"); }
        }
        // CRITICAL: Clear audio sender to close the pipeline channel
        // This ensures the pipeline loop exits properly after processing all chunks
        match self.audio_sender.lock() {
            Ok(mut guard) => *guard = None,
            Err(e) => { log::error!("audio_sender lock poisoned in stop_recording: {e}"); }
        }
        // CRITICAL: Clear device references to release microphone/speaker
        // Without this, Arc<AudioDevice> references persist and keep the mic active
        match self.microphone_device.lock() {
            Ok(mut guard) => *guard = None,
            Err(e) => { log::error!("microphone_device lock poisoned in stop_recording: {e}"); }
        }
        match self.system_device.lock() {
            Ok(mut guard) => *guard = None,
            Err(e) => { log::error!("system_device lock poisoned in stop_recording: {e}"); }
        }
        match self.disconnected_device.lock() {
            Ok(mut guard) => *guard = None,
            Err(e) => { log::error!("disconnected_device lock poisoned in stop_recording: {e}"); }
        }
        log::info!("Recording stopped, device references cleared");
    }

    pub fn pause_recording(&self) -> Result<()> {
        if !self.is_recording() {
            return Err(anyhow::anyhow!("Cannot pause when not recording"));
        }
        if self.is_paused() {
            return Err(anyhow::anyhow!("Recording is already paused"));
        }

        self.is_paused.store(true, Ordering::SeqCst);
        *self.pause_start.lock()
            .map_err(|e| anyhow::anyhow!("pause_start lock poisoned: {e}"))? = Some(Instant::now());
        log::info!("Recording paused");
        Ok(())
    }

    pub fn resume_recording(&self) -> Result<()> {
        if !self.is_recording() {
            return Err(anyhow::anyhow!("Cannot resume when not recording"));
        }
        if !self.is_paused() {
            return Err(anyhow::anyhow!("Recording is not paused"));
        }

        // Calculate pause duration and add to total
        if let Some(pause_start) = self.pause_start.lock()
            .map_err(|e| anyhow::anyhow!("pause_start lock poisoned: {e}"))?.take() {
            let pause_duration = pause_start.elapsed();
            *self.total_pause_duration.lock()
                .map_err(|e| anyhow::anyhow!("total_pause_duration lock poisoned: {e}"))? += pause_duration;
            log::info!("Recording resumed after pause of {:.2}s", pause_duration.as_secs_f64());
        }

        self.is_paused.store(false, Ordering::SeqCst);
        Ok(())
    }

    pub fn is_recording(&self) -> bool {
        self.is_recording.load(Ordering::SeqCst)
    }

    pub fn is_paused(&self) -> bool {
        self.is_paused.load(Ordering::SeqCst)
    }

    pub fn is_active(&self) -> bool {
        self.is_recording() && !self.is_paused()
    }

    // Real-time audio level methods
    pub fn set_audio_level(&self, device_type: DeviceType, rms: f32, peak: f32) {
        match device_type {
            DeviceType::Microphone => {
                self.mic_rms_level.store(rms.to_bits(), Ordering::Relaxed);
                self.mic_peak_level.store(peak.to_bits(), Ordering::Relaxed);
            }
            DeviceType::System => {
                self.sys_rms_level.store(rms.to_bits(), Ordering::Relaxed);
                self.sys_peak_level.store(peak.to_bits(), Ordering::Relaxed);
            }
            DeviceType::Mixed => {} // Ignore mixed chunks
        }
    }

    pub fn get_audio_levels(&self) -> (f32, f32, f32, f32) {
        (
            f32::from_bits(self.mic_rms_level.load(Ordering::Relaxed)),
            f32::from_bits(self.mic_peak_level.load(Ordering::Relaxed)),
            f32::from_bits(self.sys_rms_level.load(Ordering::Relaxed)),
            f32::from_bits(self.sys_peak_level.load(Ordering::Relaxed)),
        )
    }

    // Reconnection state management
    /// Attempts to start reconnection. Returns true if successfully started,
    /// false if a reconnection is already in progress (race condition prevention).
    pub fn start_reconnecting(&self, device: Arc<AudioDevice>, device_type: DeviceType) -> bool {
        // Use compare_exchange to atomically check and set the flag
        // This prevents race conditions where multiple threads try to start reconnecting
        match self.is_reconnecting.compare_exchange(
            false,  // expected: not currently reconnecting
            true,   // new value: now reconnecting
            Ordering::SeqCst,
            Ordering::SeqCst,
        ) {
            Ok(_) => {
                // Successfully claimed the reconnection lock
                match self.disconnected_device.lock() {
                    Ok(mut guard) => *guard = Some((device, device_type)),
                    Err(e) => log::error!("disconnected_device lock poisoned in start_reconnecting: {e}"),
                }
                log::info!("Started reconnection attempt for device");
                true
            }
            Err(_) => {
                // Another thread is already reconnecting
                log::info!("Reconnection already in progress, skipping");
                false
            }
        }
    }

    pub fn stop_reconnecting(&self) {
        self.is_reconnecting.store(false, Ordering::SeqCst);
        match self.disconnected_device.lock() {
            Ok(mut guard) => *guard = None,
            Err(e) => log::error!("disconnected_device lock poisoned in stop_reconnecting: {e}"),
        }
        log::info!("Stopped reconnection attempt");
    }

    pub fn is_reconnecting(&self) -> bool {
        self.is_reconnecting.load(Ordering::SeqCst)
    }

    pub fn get_disconnected_device(&self) -> Option<(Arc<AudioDevice>, DeviceType)> {
        self.disconnected_device.lock().ok().and_then(|guard| guard.clone())
    }

    // Device management
    pub fn set_microphone_device(&self, device: Arc<AudioDevice>) {
        match self.microphone_device.lock() {
            Ok(mut guard) => *guard = Some(device),
            Err(e) => log::error!("microphone_device lock poisoned in set: {e}"),
        }
    }

    pub fn set_system_device(&self, device: Arc<AudioDevice>) {
        match self.system_device.lock() {
            Ok(mut guard) => *guard = Some(device),
            Err(e) => log::error!("system_device lock poisoned in set: {e}"),
        }
    }

    pub fn get_microphone_device(&self) -> Option<Arc<AudioDevice>> {
        self.microphone_device.lock().ok().and_then(|guard| guard.clone())
    }

    pub fn get_system_device(&self) -> Option<Arc<AudioDevice>> {
        self.system_device.lock().ok().and_then(|guard| guard.clone())
    }

    // Audio pipeline management
    pub fn set_audio_sender(&self, sender: mpsc::UnboundedSender<AudioChunk>) {
        match self.audio_sender.lock() {
            Ok(mut guard) => *guard = Some(sender),
            Err(e) => log::error!("audio_sender lock poisoned in set: {e}"),
        }
    }

    pub fn send_audio_chunk(&self, chunk: AudioChunk) -> Result<()> {
        // Don't send audio chunks when paused
        if self.is_paused() {
            return Ok(()); // Silently discard chunks while paused
        }

        let sender_guard = self.audio_sender.lock()
            .map_err(|e| anyhow::anyhow!("audio_sender lock poisoned: {e}"))?;
        if let Some(sender) = sender_guard.as_ref() {
            sender.send(chunk).map_err(|_| anyhow::anyhow!("Failed to send audio chunk"))?;
            drop(sender_guard); // Release lock before acquiring stats lock

            // Update statistics
            if let Ok(mut stats) = self.stats.lock() {
                stats.chunks_processed += 1;
                stats.last_activity = Some(Instant::now());
            }
            Ok(())
        } else {
            // Return an error when no sender is available (pipeline not ready)
            Err(anyhow::anyhow!("Audio pipeline not ready - no sender available"))
        }
    }

    // Error handling
    pub fn set_error_callback<F>(&self, callback: F)
    where
        F: Fn(&AudioError) + Send + Sync + 'static,
    {
        match self.error_callback.lock() {
            Ok(mut guard) => *guard = Some(Arc::new(callback)),
            Err(e) => log::error!("error_callback lock poisoned in set: {e}"),
        }
    }

    pub fn report_error(&self, error: AudioError) {
        let count = self.error_count.fetch_add(1, Ordering::SeqCst) + 1;
        let mut should_stop = false;

        // Track recoverable vs non-recoverable errors separately
        if error.is_recoverable() {
            let recoverable_count = self.recoverable_error_count.fetch_add(1, Ordering::SeqCst) + 1;
            log::warn!("Recoverable audio error ({}): {:?}", recoverable_count, error);

            if recoverable_count >= 10 {
                log::error!("Too many recoverable errors ({}), will stop recording", recoverable_count);
                should_stop = true;
            }
        } else {
            log::error!("Non-recoverable audio error: {:?}", error);
            should_stop = true;
        }

        // Fallback: stop recording after too many total errors
        if count >= 15 {
            log::error!("Too many total audio errors ({}), will stop recording", count);
            should_stop = true;
        }

        // Update last error
        match self.last_error.lock() {
            Ok(mut guard) => *guard = Some(error.clone()),
            Err(e) => log::error!("last_error lock poisoned in report_error: {e}"),
        }

        // Clone callback and release lock BEFORE calling to prevent deadlock
        let callback_clone = match self.error_callback.lock() {
            Ok(guard) => guard.clone(),
            Err(e) => {
                log::error!("error_callback lock poisoned in report_error: {e}");
                None
            }
        };
        if let Some(callback) = callback_clone {
            callback(&error);
        }

        // DEADLOCK FIX: Call stop_recording AFTER releasing all locks above
        // Previously, stop_recording was called while locks could still be held,
        // and stop_recording itself acquires multiple locks.
        if should_stop {
            self.stop_recording();
        }
    }

    pub fn get_error_count(&self) -> u32 {
        self.error_count.load(Ordering::SeqCst)
    }

    pub fn get_recoverable_error_count(&self) -> u32 {
        self.recoverable_error_count.load(Ordering::SeqCst)
    }

    pub fn get_last_error(&self) -> Option<AudioError> {
        self.last_error.lock().ok().and_then(|guard| guard.clone())
    }

    pub fn has_fatal_error(&self) -> bool {
        match self.last_error.lock() {
            Ok(guard) => {
                if let Some(error) = guard.as_ref() {
                    !error.is_recoverable() && self.error_count.load(Ordering::SeqCst) > 0
                } else {
                    false
                }
            }
            Err(_) => false,
        }
    }

    // Statistics
    pub fn get_stats(&self) -> RecordingStats {
        self.stats.lock().ok()
            .map(|guard| guard.clone())
            .unwrap_or_default()
    }

    pub fn get_recording_duration(&self) -> Option<f64> {
        self.recording_start.lock().ok()
            .and_then(|guard| guard.map(|start| start.elapsed().as_secs_f64()))
    }

    pub fn get_active_recording_duration(&self) -> Option<f64> {
        let start = self.recording_start.lock().ok().and_then(|guard| *guard)?;
        let total_duration = start.elapsed().as_secs_f64();
        let pause_duration = self.get_total_pause_duration();
        let current_pause = if self.is_paused() {
            self.pause_start.lock().ok()
                .and_then(|guard| guard.map(|p| p.elapsed().as_secs_f64()))
                .unwrap_or(0.0)
        } else {
            0.0
        };
        Some(total_duration - pause_duration - current_pause)
    }

    pub fn get_total_pause_duration(&self) -> f64 {
        self.total_pause_duration.lock().ok()
            .map(|guard| guard.as_secs_f64())
            .unwrap_or(0.0)
    }

    pub fn get_current_pause_duration(&self) -> Option<f64> {
        if self.is_paused() {
            self.pause_start.lock().ok()
                .and_then(|guard| guard.map(|start| start.elapsed().as_secs_f64()))
        } else {
            None
        }
    }

    // Memory management
    pub fn get_buffer_pool(&self) -> AudioBufferPool {
        self.buffer_pool.clone()
    }

    // Cleanup
    pub fn cleanup(&self) {
        self.stop_recording();
        self.stop_reconnecting();

        // Clear all mutex-guarded state; log but do not panic on poisoned locks
        macro_rules! clear_lock {
            ($field:expr, $val:expr, $name:literal) => {
                match $field.lock() {
                    Ok(mut guard) => *guard = $val,
                    Err(e) => log::error!("{} lock poisoned in cleanup: {e}", $name),
                }
            };
        }

        clear_lock!(self.microphone_device, None, "microphone_device");
        clear_lock!(self.system_device, None, "system_device");
        clear_lock!(self.disconnected_device, None, "disconnected_device");
        clear_lock!(self.audio_sender, None, "audio_sender");
        clear_lock!(self.last_error, None, "last_error");
        clear_lock!(self.error_callback, None, "error_callback");
        clear_lock!(self.stats, RecordingStats::default(), "stats");
        clear_lock!(self.recording_start, None, "recording_start");
        clear_lock!(self.pause_start, None, "pause_start");
        clear_lock!(self.total_pause_duration, std::time::Duration::ZERO, "total_pause_duration");
        self.error_count.store(0, Ordering::SeqCst);
        self.recoverable_error_count.store(0, Ordering::SeqCst);

        // Clear buffer pool to free memory
        self.buffer_pool.clear();
    }
}

impl Default for RecordingState {
    fn default() -> Self {
        Self {
            is_recording: AtomicBool::new(false),
            is_paused: AtomicBool::new(false),
            is_reconnecting: AtomicBool::new(false),
            microphone_device: Mutex::new(None),
            system_device: Mutex::new(None),
            disconnected_device: Mutex::new(None),
            audio_sender: Mutex::new(None),
            buffer_pool: AudioBufferPool::new(16, 48000), // Pool of 16 buffers with 48kHz samples capacity
            error_count: AtomicU32::new(0),
            recoverable_error_count: AtomicU32::new(0),
            last_error: Mutex::new(None),
            error_callback: Mutex::new(None),
            stats: Mutex::new(RecordingStats::default()),
            recording_start: Mutex::new(None),
            pause_start: Mutex::new(None),
            total_pause_duration: Mutex::new(std::time::Duration::ZERO),
            mic_rms_level: AtomicU32::new(0),
            sys_rms_level: AtomicU32::new(0),
            mic_peak_level: AtomicU32::new(0),
            sys_peak_level: AtomicU32::new(0),
        }
    }
}

// Thread-safe cloning for RecordingStats
impl Clone for RecordingStats {
    fn clone(&self) -> Self {
        Self {
            chunks_processed: self.chunks_processed,
            total_duration: self.total_duration,
            last_activity: self.last_activity,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    mod audio_error {
        use super::*;

        #[test]
        fn recoverable_errors() {
            assert!(AudioError::DeviceDisconnected.is_recoverable());
            assert!(AudioError::StreamFailed.is_recoverable());
            assert!(AudioError::ProcessingFailed.is_recoverable());
            assert!(AudioError::TranscriptionFailed.is_recoverable());
            assert!(AudioError::BufferOverflow.is_recoverable());
        }

        #[test]
        fn non_recoverable_errors() {
            assert!(!AudioError::ChannelClosed.is_recoverable());
            assert!(!AudioError::InitializationFailed.is_recoverable());
            assert!(!AudioError::ConfigurationError.is_recoverable());
            assert!(!AudioError::PermissionDenied.is_recoverable());
            assert!(!AudioError::SampleRateUnsupported.is_recoverable());
        }

        #[test]
        fn user_messages_are_nonempty() {
            let errors = [
                AudioError::DeviceDisconnected,
                AudioError::StreamFailed,
                AudioError::ProcessingFailed,
                AudioError::TranscriptionFailed,
                AudioError::ChannelClosed,
                AudioError::InitializationFailed,
                AudioError::ConfigurationError,
                AudioError::PermissionDenied,
                AudioError::BufferOverflow,
                AudioError::SampleRateUnsupported,
            ];
            for err in errors {
                assert!(!err.user_message().is_empty(), "{:?} has empty message", err);
            }
        }
    }

    mod device_type {
        use super::*;

        #[test]
        fn equality_variants() {
            assert_eq!(DeviceType::Microphone, DeviceType::Microphone);
            assert_ne!(DeviceType::Microphone, DeviceType::System);
            assert_ne!(DeviceType::System, DeviceType::Mixed);
        }

        #[test]
        fn is_copy() {
            let a = DeviceType::Microphone;
            let b = a; // would not compile if not Copy
            assert_eq!(a, b);
        }
    }

    mod recording_state {
        use super::*;

        #[test]
        fn new_starts_inactive() {
            let state = RecordingState::new();
            assert!(!state.is_recording());
            assert!(!state.is_paused());
            assert!(!state.is_active());
            assert!(!state.is_reconnecting());
        }

        #[test]
        fn start_recording_flips_flag_and_resets_errors() {
            let state = RecordingState::new();
            state.report_error(AudioError::StreamFailed);
            state.report_error(AudioError::StreamFailed);
            assert!(state.get_error_count() >= 2);

            state.start_recording().unwrap();
            assert!(state.is_recording());
            assert!(state.is_active());
            assert_eq!(state.get_error_count(), 0);
            assert_eq!(state.get_recoverable_error_count(), 0);
            assert!(state.get_last_error().is_none());
        }

        #[test]
        fn stop_recording_clears_flags() {
            let state = RecordingState::new();
            state.start_recording().unwrap();
            state.stop_recording();
            assert!(!state.is_recording());
            assert!(!state.is_paused());
        }

        #[test]
        fn pause_requires_recording() {
            let state = RecordingState::new();
            assert!(state.pause_recording().is_err());
        }

        #[test]
        fn double_pause_fails() {
            let state = RecordingState::new();
            state.start_recording().unwrap();
            state.pause_recording().unwrap();
            assert!(state.pause_recording().is_err());
        }

        #[test]
        fn resume_requires_pause() {
            let state = RecordingState::new();
            state.start_recording().unwrap();
            assert!(state.resume_recording().is_err());
        }

        #[test]
        fn pause_and_resume_toggle_correctly() {
            let state = RecordingState::new();
            state.start_recording().unwrap();
            state.pause_recording().unwrap();
            assert!(state.is_paused());
            assert!(!state.is_active());
            state.resume_recording().unwrap();
            assert!(!state.is_paused());
            assert!(state.is_active());
        }

        #[test]
        fn audio_levels_roundtrip_mic_and_system() {
            let state = RecordingState::new();
            state.set_audio_level(DeviceType::Microphone, 0.3, 0.7);
            state.set_audio_level(DeviceType::System, 0.4, 0.8);
            let (mic_rms, mic_peak, sys_rms, sys_peak) = state.get_audio_levels();
            assert!((mic_rms - 0.3).abs() < 1e-6);
            assert!((mic_peak - 0.7).abs() < 1e-6);
            assert!((sys_rms - 0.4).abs() < 1e-6);
            assert!((sys_peak - 0.8).abs() < 1e-6);
        }

        #[test]
        fn mixed_device_type_does_not_update_levels() {
            let state = RecordingState::new();
            state.set_audio_level(DeviceType::Microphone, 0.5, 0.9);
            state.set_audio_level(DeviceType::Mixed, 999.0, 999.0);
            let (mic_rms, _, _, _) = state.get_audio_levels();
            assert!((mic_rms - 0.5).abs() < 1e-6);
        }

        #[test]
        fn report_error_triggers_callback_and_increments_counter() {
            let state = RecordingState::new();
            let count = Arc::new(std::sync::atomic::AtomicU32::new(0));
            let count_clone = count.clone();
            state.set_error_callback(move |_err| {
                count_clone.fetch_add(1, Ordering::SeqCst);
            });

            state.report_error(AudioError::StreamFailed);
            assert_eq!(state.get_error_count(), 1);
            assert_eq!(state.get_recoverable_error_count(), 1);
            assert_eq!(count.load(Ordering::SeqCst), 1);
        }

        #[test]
        fn non_recoverable_error_stops_recording_and_is_fatal() {
            let state = RecordingState::new();
            state.start_recording().unwrap();
            state.report_error(AudioError::InitializationFailed);
            assert!(!state.is_recording(), "non-recoverable error should stop recording");
            assert!(state.has_fatal_error());
        }

        #[test]
        fn reconnection_start_prevents_double_start() {
            use crate::audio::devices::{AudioDevice, DeviceType as TauriDeviceType};
            let state = RecordingState::new();
            let device = Arc::new(AudioDevice {
                name: "mic".into(),
                device_type: TauriDeviceType::Input,
            });

            assert!(state.start_reconnecting(device.clone(), DeviceType::Microphone));
            assert!(state.is_reconnecting());
            assert!(!state.start_reconnecting(device.clone(), DeviceType::Microphone),
                "second start should fail because reconnection is in progress");

            state.stop_reconnecting();
            assert!(!state.is_reconnecting());
            assert!(state.get_disconnected_device().is_none());
        }
    }
}