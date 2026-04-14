// audio/transcription/spill_queue.rs
//
// C.2 — Disk-backed overflow buffer for audio chunks.
//
// When the in-memory `work_receiver` channel (2000-slot bounded) fills up
// during a CPU spike or circuit-breaker open period, chunks that would
// otherwise be dropped are serialized to disk inside the meeting folder.
// A background drainer reads them back once the in-memory queue has room.
//
// Format is bincode-encoded `SpilledChunk { sample_rate, device_type, samples }`.
// One file per chunk, named `spill_<chunk_id>.bin`. Files are deleted after
// successful reintroduction into the channel.
//
// This module is intentionally lightweight; the goal is "no data loss under
// burst" not "general-purpose queue". We do not currently persist across
// process restarts — files on disk during a crash are recovered post-mortem
// via the existing checkpoint recovery flow.

use log::{debug, warn};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize)]
pub struct SpilledChunk {
    pub chunk_id: u64,
    pub sample_rate: u32,
    pub samples: Vec<f32>,
    pub device_type: u8, // 0 mic, 1 sys, 2 mixed — mirrors recording_state::DeviceType
}

/// Manages the spill directory lifecycle for one recording.
pub struct SpillQueue {
    dir: PathBuf,
    enabled: bool,
}

impl SpillQueue {
    pub fn new(meeting_folder: &PathBuf) -> Self {
        let dir = meeting_folder.join("spill");
        let enabled = match std::fs::create_dir_all(&dir) {
            Ok(_) => true,
            Err(e) => {
                warn!("C.2 spill queue disabled — could not create {}: {}", dir.display(), e);
                false
            }
        };
        Self { dir, enabled }
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    pub fn path_for(&self, chunk_id: u64) -> PathBuf {
        self.dir.join(format!("spill_{:010}.bin", chunk_id))
    }

    /// Serialize and write a chunk. Returns Ok on success, or an error
    /// describing the cause of the write failure (full disk etc.). Callers
    /// should treat Err as a hard data-loss signal and surface to the user.
    pub fn write(&self, chunk: &SpilledChunk) -> Result<PathBuf, String> {
        if !self.enabled {
            return Err("spill queue disabled".into());
        }
        let bytes = bincode::serialize(chunk)
            .map_err(|e| format!("bincode serialize failed: {}", e))?;
        let path = self.path_for(chunk.chunk_id);
        std::fs::write(&path, bytes)
            .map_err(|e| format!("spill write failed {}: {}", path.display(), e))?;
        debug!("spill: wrote {} ({} samples)", path.display(), chunk.samples.len());
        Ok(path)
    }

    /// Read back a spilled chunk by path. Deletes the file on success to keep
    /// the directory bounded.
    pub fn read_and_delete(&self, path: &PathBuf) -> Result<SpilledChunk, String> {
        let bytes = std::fs::read(path)
            .map_err(|e| format!("spill read failed {}: {}", path.display(), e))?;
        let chunk: SpilledChunk = bincode::deserialize(&bytes)
            .map_err(|e| format!("bincode deserialize failed: {}", e))?;
        if let Err(e) = std::fs::remove_file(path) {
            warn!("spill: failed to delete {} after read: {}", path.display(), e);
        }
        Ok(chunk)
    }

    /// List spill files currently on disk, oldest first (by lexical sort on
    /// the chunk_id component, which is zero-padded).
    pub fn list(&self) -> Vec<PathBuf> {
        let mut out = Vec::new();
        if !self.enabled {
            return out;
        }
        let read_dir = match std::fs::read_dir(&self.dir) {
            Ok(r) => r,
            Err(_) => return out,
        };
        for entry in read_dir.flatten() {
            let p = entry.path();
            if p.extension().and_then(|e| e.to_str()) == Some("bin") {
                out.push(p);
            }
        }
        out.sort();
        out
    }
}
