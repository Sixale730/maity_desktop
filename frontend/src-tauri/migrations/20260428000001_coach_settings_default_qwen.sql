-- Actualizar IDs de modelos coach a Qwen2.5 (Apache 2.0, descarga libre)
-- Los modelos Gemma requieren autenticación en HuggingFace y no se pueden descargar programáticamente.
UPDATE coach_settings
SET tips_model_id = 'qwen25-3b-q4',
    eval_model_id = 'qwen25-7b-q4'
WHERE tips_model_id = 'gemma3-4b-q4'
   OR eval_model_id = 'gemma3-12b-q4';
