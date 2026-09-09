-- Cola persistente de transcripcion por lote (F2 de la migracion a lote,
-- sep-2026). Patron outbox como sync_queue: las filas se crean al ARRANCAR el
-- segmento (status 'recording') para que la recuperacion post-crash viva en
-- Rust, no en el webview.
--
-- ADITIVA (regla de canales Store/NSIS, docs/CANALES_DISTRIBUCION.md): sin
-- DROP ni RENAME; las versiones viejas simplemente ignoran la tabla.
--
-- status:       'recording' | 'pending' | 'processing' | 'done' | 'discarded' | 'failed'
-- trigger_kind: 'manual' | 'rotation' | 'auto_close' | 'crash_recovery'
--               (se llama trigger_kind porque TRIGGER es palabra reservada)
-- Las filas terminales se CONSERVAN (paridad con la regla #26 de sync_queue).
CREATE TABLE IF NOT EXISTS batch_transcription_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folder_path TEXT NOT NULL UNIQUE,
    meeting_local_id TEXT,
    segment_started_at TEXT,
    trigger_kind TEXT NOT NULL DEFAULT 'manual',
    status TEXT NOT NULL DEFAULT 'recording',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    user_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_batch_queue_status
    ON batch_transcription_queue(status);
