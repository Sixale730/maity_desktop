CREATE TABLE IF NOT EXISTS user_feedback (
  id              TEXT PRIMARY KEY,
  meeting_id      TEXT,
  feedback_type   TEXT NOT NULL,
  rating          TEXT,
  message         TEXT,
  metadata        TEXT,
  synced_to_cloud INTEGER NOT NULL DEFAULT 0,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_feedback_meeting_id ON user_feedback(meeting_id);
CREATE INDEX IF NOT EXISTS idx_user_feedback_type ON user_feedback(feedback_type);
