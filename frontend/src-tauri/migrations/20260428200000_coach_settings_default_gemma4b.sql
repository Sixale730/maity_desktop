-- Migrar tips_model_id a gemma3-4b-q4 (default mejor calidad/velocidad).
-- Razón: el modelo 1B no genera contenido coherente para coaching en español,
-- repite fragmentos del system prompt en lugar de seguir instrucciones.
-- Gemma 4B con GPU offload (RTX 3050 4GB) cabe casi entero en VRAM y es viable.
UPDATE coach_settings
SET tips_model_id = 'gemma3-4b-q4'
WHERE tips_model_id = 'gemma3-1b-q8'
   OR tips_model_id = 'qwen25-3b-q4'
   OR tips_model_id IS NULL;

UPDATE coach_settings
SET eval_model_id = 'gemma3-4b-q4'
WHERE eval_model_id = 'gemma3-4b-q4'
   OR eval_model_id IS NULL;
