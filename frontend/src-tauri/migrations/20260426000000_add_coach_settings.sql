-- Coach settings: modelos por propósito y pipeline activo
CREATE TABLE IF NOT EXISTS coach_settings (
    id TEXT PRIMARY KEY DEFAULT '1',
    tips_model TEXT NOT NULL DEFAULT 'gemma3:4b',
    eval_model TEXT NOT NULL DEFAULT 'gemma3:12b',
    chat_model TEXT NOT NULL DEFAULT 'gemma3:4b',
    ollama_endpoint TEXT NOT NULL DEFAULT 'http://localhost:11434',
    enabled INTEGER NOT NULL DEFAULT 1,
    active_pipeline_id TEXT NOT NULL DEFAULT 'local_parakeet_gemma'
);

INSERT OR IGNORE INTO coach_settings (id) VALUES ('1');
