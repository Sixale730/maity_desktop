-- §4.1 Force coach_settings.tips_model_id = 'gemma3-4b-q4' para todos los registros existentes.
--
-- Razón: el plan PLAN_COACH_FLOATING_GAUGE.md elimina gemma3-1b-q8 del proyecto:
--   - % JSON malformado de Gemma 1B Q8 ~33% en sesion real (muy alto)
--   - Gemma 4B Q4 baja a ~10%
--   - Unificar a un solo modelo simplifica RAM, descarga y onboarding
--
-- Esta migracion es idempotente: aplica solo a registros con tips_model_id = 'gemma3-1b-q8'
-- o NULL. Las migraciones previas (20260428200000) ya migraron el grueso de usuarios; esta
-- captura registros nuevos creados entre esa migracion y la baja completa de 1b.
--
-- Notar: si el usuario tiene 'gemma3-1b-q8' descargado pero no 'gemma3-4b-q4',
-- el coach va a fallar la resolucion del modelo al iniciar. La logica de
-- onboarding.rs (commit 12) detecta este caso post-update y dispara el
-- ModelDownloadStep automaticamente para forzar descarga del 4b.

UPDATE coach_settings
SET tips_model_id = 'gemma3-4b-q4'
WHERE tips_model_id = 'gemma3-1b-q8'
   OR tips_model_id IS NULL;
