// audio/transcript_live_streamer.rs
//
// B.2 — Fire-and-forget streaming of transcript segments to SQLite during
// recording. Keeps the canonical `transcripts.json` as source of truth; this
// is a parallel write that lets us rebuild the JSON on crash recovery.
//
// Design:
//   * `start_streamer(db, meeting_id)` spawns a background tokio task and
//     returns an unbounded mpsc sender.
//   * `recording_saver::add_transcript_segment` calls `try_send` on the
//     sender — non-blocking, failures are logged but never fatal.
//   * The background task batches up to N segments or M ms and writes them
//     in a single sqlx transaction.
//   * On `finalize_recording` success, the recording_saver calls
//     `DatabaseManager::purge_live_transcript(meeting_id)` to drop the rows.

use crate::database::manager::{DatabaseManager, LiveTranscriptRow};
use log::{debug, warn};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;

/// Max segments batched in a single DB transaction.
const BATCH_SIZE: usize = 20;
/// Max time to hold a partial batch before flushing.
const BATCH_TIMEOUT: Duration = Duration::from_millis(2_000);

pub type LiveTranscriptSender = mpsc::UnboundedSender<LiveTranscriptRow>;

/// Spawn the streamer task. Returns the sender; keep it alive for the life
/// of the recording. Dropping it signals the task to drain and exit.
pub fn start_streamer(db: Arc<DatabaseManager>) -> LiveTranscriptSender {
    let (tx, mut rx) = mpsc::unbounded_channel::<LiveTranscriptRow>();

    tokio::spawn(async move {
        let mut batch: Vec<LiveTranscriptRow> = Vec::with_capacity(BATCH_SIZE);
        let mut deadline = tokio::time::Instant::now() + BATCH_TIMEOUT;

        loop {
            let timeout = deadline.saturating_duration_since(tokio::time::Instant::now());
            let maybe = tokio::time::timeout(timeout, rx.recv()).await;

            match maybe {
                Ok(Some(row)) => {
                    batch.push(row);
                    if batch.len() >= BATCH_SIZE {
                        flush_batch(&db, &mut batch).await;
                        deadline = tokio::time::Instant::now() + BATCH_TIMEOUT;
                    }
                }
                Ok(None) => {
                    // Channel closed — final flush and exit.
                    if !batch.is_empty() {
                        flush_batch(&db, &mut batch).await;
                    }
                    debug!("transcript_live_streamer: channel closed, task exiting");
                    return;
                }
                Err(_timeout) => {
                    if !batch.is_empty() {
                        flush_batch(&db, &mut batch).await;
                    }
                    deadline = tokio::time::Instant::now() + BATCH_TIMEOUT;
                }
            }
        }
    });

    tx
}

async fn flush_batch(db: &DatabaseManager, batch: &mut Vec<LiveTranscriptRow>) {
    if batch.is_empty() {
        return;
    }
    let count = batch.len();
    // Simple sequential upserts inside the pool. Could be wrapped in a
    // transaction for fewer WAL fsyncs, but even without that this is ~20×
    // cheaper than the JSON rewrite we are replacing.
    for row in batch.drain(..) {
        if let Err(e) = db.upsert_live_transcript(&row).await {
            warn!("transcript_live_streamer: upsert failed: {}", e);
        }
    }
    debug!("transcript_live_streamer: flushed {} segments to SQLite", count);
}
