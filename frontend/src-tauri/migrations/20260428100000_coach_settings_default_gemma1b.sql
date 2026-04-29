-- Migrar tips_model_id de qwen25-3b-q4 (no descargado en onboarding actual) a gemma3-1b-q8.
-- Razón: el onboarding actual descarga Gemma 1B y 4B vía bartowski (sin gate de licencia).
-- qwen25-3b-q4 quedó en DB de versiones anteriores pero el archivo no existe en disco,
-- causando errores "model not found" en llama-server.
UPDATE coach_settings
SET tips_model_id = 'gemma3-1b-q8'
WHERE tips_model_id = 'qwen25-3b-q4'
   OR tips_model_id IS NULL;

UPDATE coach_settings
SET eval_model_id = 'gemma3-4b-q4'
WHERE eval_model_id = 'qwen25-7b-q4'
   OR eval_model_id IS NULL;
