-- Añadir columnas GGUF al esquema de coach_settings.
-- Las columnas antiguas (tips_model, eval_model, ollama_endpoint) se mantienen
-- para compatibilidad con grabaciones anteriores.

ALTER TABLE coach_settings ADD COLUMN tips_model_id TEXT NOT NULL DEFAULT 'gemma3-4b-q4';
ALTER TABLE coach_settings ADD COLUMN eval_model_id TEXT NOT NULL DEFAULT 'gemma3-12b-q4';
ALTER TABLE coach_settings ADD COLUMN local_llm_endpoint TEXT NOT NULL DEFAULT 'http://127.0.0.1:11434';
