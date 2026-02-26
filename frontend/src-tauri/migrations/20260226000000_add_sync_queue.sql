-- Sync queue for offline-first cloud save
-- Jobs are enqueued immediately after local SQLite save and processed
-- in background with exponential backoff (max 10 attempts)
CREATE TABLE IF NOT EXISTS sync_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_type TEXT NOT NULL,         -- 'save_conversation' | 'save_transcript_segments' | 'finalize_conversation'
    meeting_id TEXT NOT NULL,
    payload TEXT NOT NULL,          -- JSON with data to execute the job
    status TEXT NOT NULL DEFAULT 'pending',  -- pending | in_progress | completed | failed
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 10,
    next_retry_at TEXT,             -- ISO 8601; NULL = ready immediately
    last_error TEXT,
    depends_on INTEGER,             -- sync_queue.id of prerequisite job
    result_data TEXT,               -- JSON result (e.g. { "conversation_id": "uuid" })
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    FOREIGN KEY (depends_on) REFERENCES sync_queue(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status) WHERE status IN ('pending', 'in_progress');
CREATE INDEX IF NOT EXISTS idx_sync_queue_meeting ON sync_queue(meeting_id);
CREATE INDEX IF NOT EXISTS idx_sync_queue_next_retry ON sync_queue(next_retry_at) WHERE status = 'pending';
