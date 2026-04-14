-- B.2 — Live transcript streaming to SQLite during recording.
--
-- Prior to this migration, the transcript JSON was rewritten monolithically
-- on every new segment (see recording_saver.rs::write_transcripts_json).
-- At 3600+ segments per hour that I/O pattern is pathological.
--
-- This table receives batched INSERTs while recording. At finalize_recording,
-- the contents are dumped to the canonical transcripts.json on disk and the
-- rows for that meeting are purged. If the app crashes mid-recording, the
-- rows survive and transcripts.json can be rebuilt from this table.
--
-- Schema is intentionally minimal — mirrors the TranscriptSegment struct in
-- `audio::recording_saver`. Only fields needed to rebuild the JSON are stored.

CREATE TABLE IF NOT EXISTS transcript_segments_live (
    meeting_id        TEXT NOT NULL,
    sequence_id       INTEGER NOT NULL,
    segment_id        TEXT NOT NULL,
    text              TEXT NOT NULL,
    audio_start_time  REAL NOT NULL,
    audio_end_time    REAL NOT NULL,
    duration          REAL NOT NULL,
    display_time      TEXT NOT NULL,
    confidence        REAL NOT NULL,
    source_type       TEXT,          -- "user" | "interlocutor" | NULL
    created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (meeting_id, sequence_id)
);

-- Fast lookup by meeting during reconstruction.
CREATE INDEX IF NOT EXISTS idx_transcript_segments_live_meeting
    ON transcript_segments_live (meeting_id, sequence_id);
