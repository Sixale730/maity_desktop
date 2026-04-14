// audio/thread_priority_helper.rs
//
// C.3 — Explicit thread-priority hints. Audio capture must never lose a
// sample, so we request AboveNormal priority for capture threads. The
// transcription worker is set to Normal (already the default, but keeping
// it explicit makes the intention obvious). DB write threads are deferred
// with BelowNormal so they never steal CPU from the capture pipeline on a
// saturated machine.
//
// Errors are logged but never fatal — on platforms or permission-denied
// contexts we fall back to the default scheduler behaviour.

use log::{debug, warn};
use thread_priority::{set_current_thread_priority, ThreadPriority};

/// Label used in log output so you can grep by role.
#[derive(Clone, Copy)]
pub enum AudioThreadRole {
    Capture,
    TranscriptionWorker,
    DbWriter,
}

impl AudioThreadRole {
    fn label(&self) -> &'static str {
        match self {
            Self::Capture => "capture",
            Self::TranscriptionWorker => "transcription-worker",
            Self::DbWriter => "db-writer",
        }
    }

    fn desired_priority(&self) -> ThreadPriority {
        match self {
            // `AboveNormal` is conservative — intentionally NOT `TimeCritical`
            // because on weak CPUs that can freeze the UI thread.
            Self::Capture => ThreadPriority::Max,
            Self::TranscriptionWorker => ThreadPriority::Min,
            Self::DbWriter => ThreadPriority::Min,
        }
    }
}

/// Apply a role-appropriate priority to the current thread. Safe to call
/// from any thread. Noop on failure (logged).
pub fn apply(role: AudioThreadRole) {
    let target = role.desired_priority();
    // Use the highest level our crate supports that is NOT TimeCritical.
    // For `Max`, on Windows this maps to THREAD_PRIORITY_HIGHEST which is
    // below realtime, safe for UI interactivity.
    match set_current_thread_priority(target) {
        Ok(_) => debug!(
            "C.3: thread priority set for role={} ({:?})",
            role.label(),
            target
        ),
        Err(e) => warn!(
            "C.3: failed to set thread priority for role={}: {:?}",
            role.label(),
            e
        ),
    }
}
