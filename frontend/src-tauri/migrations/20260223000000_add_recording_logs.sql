-- Recording lifecycle logs for diagnostics and debugging
CREATE TABLE IF NOT EXISTS recording_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    event_data TEXT,
    status TEXT,
    error TEXT,
    meeting_id TEXT,
    app_version TEXT,
    device_info TEXT,
    synced_to_cloud BOOLEAN DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_recording_logs_session ON recording_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_recording_logs_meeting ON recording_logs(meeting_id);
CREATE INDEX IF NOT EXISTS idx_recording_logs_synced ON recording_logs(synced_to_cloud) WHERE synced_to_cloud = 0;
