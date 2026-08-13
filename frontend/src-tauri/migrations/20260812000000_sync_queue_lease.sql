-- Lease de ejecucion para los jobs de sync_queue.
-- claim_job fija hasta cuando el claim es valido; reset_stale_jobs revive los
-- jobs cuyo lease vencio. Migracion ADITIVA: los jobs previos quedan con
-- lease_expires_at NULL y siguen el camino legacy por updated_at.
ALTER TABLE sync_queue ADD COLUMN lease_expires_at TEXT;
