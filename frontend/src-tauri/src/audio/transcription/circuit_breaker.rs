// audio/transcription/circuit_breaker.rs
//
// B.1 — Simple circuit breaker for the transcription engine.
//
// Protects the worker loop from cascading failures when the engine (Whisper,
// Parakeet, Moonshine, or Deepgram) is in a bad state (crashed, network down,
// model unloaded, etc.). Without this, repeated calls to a dying engine waste
// CPU, pile up errors in logs, and eventually exhaust the queue.
//
// State machine:
//   Closed   (normal)   → transcription attempts go through.
//   Open     (degraded) → attempts are skipped; chunks are still consumed so
//                         the queue keeps draining. Opens when `failure_threshold`
//                         failures occur within `failure_window`.
//   HalfOpen (probing)  → exactly one attempt is allowed; if it succeeds we
//                         close the circuit, otherwise we re-open it.
//
// Emits `transcription-circuit-open` / `-closed` events for UI visibility.

use log::{info, warn};
use std::sync::atomic::{AtomicU32, AtomicU64, AtomicU8, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Runtime};

/// State encoded as u8 to fit in an atomic.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum CircuitState {
    Closed = 0,
    Open = 1,
    HalfOpen = 2,
}

impl CircuitState {
    fn from_u8(v: u8) -> Self {
        match v {
            1 => Self::Open,
            2 => Self::HalfOpen,
            _ => Self::Closed,
        }
    }

    fn as_str(&self) -> &'static str {
        match self {
            Self::Closed => "closed",
            Self::Open => "open",
            Self::HalfOpen => "half_open",
        }
    }
}

/// Circuit breaker with configurable thresholds. All fields are internally
/// thread-safe; clone cheaply via Arc in the surrounding struct.
pub struct CircuitBreaker {
    state: AtomicU8,
    /// Nanoseconds since UNIX epoch when the breaker last opened. Zero means
    /// never opened. We use `AtomicU64` for lock-free access in the worker hot
    /// loop. Conversion back and forth via `Instant` is not possible across
    /// processes, so we store elapsed time as "last_open_instant" captured at
    /// breaker creation and update monotonically.
    last_open_millis_since_epoch_of_breaker: AtomicU64,
    failure_count: AtomicU32,
    /// First-failure-in-window timestamp (ms since breaker birth).
    first_failure_millis: AtomicU64,
    /// Instant the breaker was constructed; used as epoch for atomic ms counters.
    birth: Instant,

    // Configuration (immutable after construction)
    failure_threshold: u32,
    failure_window: Duration,
    open_duration: Duration,
}

impl CircuitBreaker {
    pub fn new(failure_threshold: u32, failure_window: Duration, open_duration: Duration) -> Self {
        Self {
            state: AtomicU8::new(CircuitState::Closed as u8),
            last_open_millis_since_epoch_of_breaker: AtomicU64::new(0),
            failure_count: AtomicU32::new(0),
            first_failure_millis: AtomicU64::new(0),
            birth: Instant::now(),
            failure_threshold,
            failure_window,
            open_duration,
        }
    }

    pub fn state(&self) -> CircuitState {
        CircuitState::from_u8(self.state.load(Ordering::Relaxed))
    }

    fn elapsed_millis(&self) -> u64 {
        self.birth.elapsed().as_millis() as u64
    }

    /// Returns whether a transcription attempt should proceed right now.
    /// Callers must report the outcome via `record_success` / `record_failure`.
    pub fn allow_attempt(&self) -> bool {
        match self.state() {
            CircuitState::Closed => true,
            CircuitState::HalfOpen => true,
            CircuitState::Open => {
                // Transition to HalfOpen if the open window has elapsed.
                let opened_at_ms = self.last_open_millis_since_epoch_of_breaker.load(Ordering::Relaxed);
                if self.elapsed_millis().saturating_sub(opened_at_ms) >= self.open_duration.as_millis() as u64 {
                    // Try to move from Open → HalfOpen. If someone else beat us,
                    // fall through to the HalfOpen return anyway.
                    let _ = self.state.compare_exchange(
                        CircuitState::Open as u8,
                        CircuitState::HalfOpen as u8,
                        Ordering::SeqCst,
                        Ordering::SeqCst,
                    );
                    true
                } else {
                    false
                }
            }
        }
    }

    pub fn record_success<R: Runtime>(&self, app: &AppHandle<R>) {
        let previous = self.state();
        self.failure_count.store(0, Ordering::Relaxed);
        self.first_failure_millis.store(0, Ordering::Relaxed);
        self.state.store(CircuitState::Closed as u8, Ordering::SeqCst);
        if previous != CircuitState::Closed {
            info!("Transcription circuit breaker → CLOSED (recovered from {})", previous.as_str());
            let _ = app.emit(
                "transcription-circuit-closed",
                serde_json::json!({ "previous_state": previous.as_str() }),
            );
        }
    }

    /// Record a failure. Emits `transcription-circuit-open` when the threshold
    /// is crossed. Returns the new state.
    pub fn record_failure<R: Runtime>(&self, app: &AppHandle<R>, reason: &str) -> CircuitState {
        let now_ms = self.elapsed_millis();
        let window_ms = self.failure_window.as_millis() as u64;

        // Reset window if last failure was too long ago.
        let first_ms = self.first_failure_millis.load(Ordering::Relaxed);
        if first_ms == 0 || now_ms.saturating_sub(first_ms) > window_ms {
            self.first_failure_millis.store(now_ms, Ordering::Relaxed);
            self.failure_count.store(1, Ordering::Relaxed);
        } else {
            self.failure_count.fetch_add(1, Ordering::Relaxed);
        }

        let count = self.failure_count.load(Ordering::Relaxed);
        let state = self.state();

        if state == CircuitState::HalfOpen {
            // HalfOpen probe failed → re-open.
            self.state.store(CircuitState::Open as u8, Ordering::SeqCst);
            self.last_open_millis_since_epoch_of_breaker
                .store(now_ms, Ordering::SeqCst);
            warn!(
                "Transcription circuit breaker → OPEN (HalfOpen probe failed: {})",
                reason
            );
            let _ = app.emit(
                "transcription-circuit-open",
                serde_json::json!({
                    "reason": reason,
                    "failure_count": count,
                    "open_for_secs": self.open_duration.as_secs(),
                }),
            );
            return CircuitState::Open;
        }

        if state == CircuitState::Closed && count >= self.failure_threshold {
            self.state.store(CircuitState::Open as u8, Ordering::SeqCst);
            self.last_open_millis_since_epoch_of_breaker
                .store(now_ms, Ordering::SeqCst);
            warn!(
                "Transcription circuit breaker → OPEN ({} failures in {}s, last reason: {})",
                count,
                self.failure_window.as_secs(),
                reason
            );
            let _ = app.emit(
                "transcription-circuit-open",
                serde_json::json!({
                    "reason": reason,
                    "failure_count": count,
                    "open_for_secs": self.open_duration.as_secs(),
                }),
            );
            return CircuitState::Open;
        }

        state
    }
}

impl Default for CircuitBreaker {
    fn default() -> Self {
        // 5 failures in 30s → open for 60s
        Self::new(5, Duration::from_secs(30), Duration::from_secs(60))
    }
}

/// Convenience alias for the Arc-wrapped breaker the worker passes around.
pub type SharedCircuitBreaker = Arc<CircuitBreaker>;
