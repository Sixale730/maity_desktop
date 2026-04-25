-- Wave C2+C3: tabla de embeddings para búsqueda semántica local.
-- Embeddings se calculan via Ollama (modelo recomendado: nomic-embed-text 768d).
-- Storage: BLOB con f32 little-endian concatenados.

CREATE TABLE IF NOT EXISTS transcript_embeddings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_id TEXT NOT NULL,
    segment_id TEXT NOT NULL,
    text TEXT NOT NULL,
    embedding BLOB NOT NULL,
    model TEXT NOT NULL,
    dim INTEGER NOT NULL,
    audio_start_time REAL,
    audio_end_time REAL,
    source_type TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(meeting_id, segment_id, model)
);

CREATE INDEX IF NOT EXISTS idx_transcript_embeddings_meeting ON transcript_embeddings(meeting_id);
CREATE INDEX IF NOT EXISTS idx_transcript_embeddings_model ON transcript_embeddings(model);
