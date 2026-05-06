-- Multi-account privacy isolation
-- Adds user_id to meetings and sync_queue so each Supabase user only sees their own data.
-- Legacy rows (user_id NULL) become invisible — privacy > legacy data access.
-- Sync queue legacy jobs are deleted to avoid stuck-forever state (the worker filters by user_id).

ALTER TABLE meetings ADD COLUMN user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_meetings_user_id ON meetings(user_id);

ALTER TABLE sync_queue ADD COLUMN user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_sync_queue_user_id ON sync_queue(user_id);

-- Legacy sync_queue jobs without user_id can never be processed (worker filters by user_id).
-- Delete them to avoid accumulating stuck-forever rows. Meetings stay (just become invisible).
DELETE FROM sync_queue WHERE user_id IS NULL;
