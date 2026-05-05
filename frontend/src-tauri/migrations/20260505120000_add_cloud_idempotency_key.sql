-- Add cloud_idempotency_key for deterministic dedup against maity.omi_conversations.
-- Generated client-side once per meeting, persisted on first cloud sync attempt,
-- reused on retries so idempotency holds across network failures.
-- Mirrors the UNIQUE column maity.omi_conversations.idempotency_key in Supabase.
ALTER TABLE meetings ADD COLUMN cloud_idempotency_key TEXT;
