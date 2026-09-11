-- Dominio de la columna `status` de maity.platform_logs (maity_desktop, sep-2026).
--
-- Este repo NO tiene migraciones de Postgres (viven en Sixale730/maity): este
-- archivo es el contrato que la web debe aplicar como migración. Se aplica a
-- mano en producción desde el desktop (Management API) el día que se mergea
-- el ciclo; la fecha real de aplicación se anota abajo.
--
-- Por qué existe (2026-09-10/11): el CHECK original admitía solo
-- 'success' | 'error' | 'timeout' | 'skipped' (los valores del platformLogger
-- JS). Los emisores Rust nuevos (stt.batch_job, stt.batch_deferred,
-- stt.engine_lifecycle, audio.retention_swept, audio.checkpoint_integrity,
-- incident.detected, incident.upload_failed, incident.bundle_uploaded) mandan
-- 'ok' | 'partial' | 'warning'. El RPC maity.insert_platform_log es SECURITY
-- DEFINER con `EXCEPTION WHEN OTHERS THEN NULL`: la violación del CHECK se
-- traga y responde 200; el drain del desktop toma el 2xx por éxito y marca la
-- fila del outbox como sincronizada. Resultado: CERO filas de esos ocho
-- eventos aterrizaron jamás, sin ningún aviso.
--
-- Decisión: conservar la semántica de los emisores (ok/partial/warning dicen
-- algo que success/error no dicen) y ENSANCHAR el CHECK. No se toca el RPC:
-- cambiar `RETURNS void` exige `DROP FUNCTION` y lo comparten web y móvil.
--
-- Contrato ejecutable: `TelemetryStatus` (src-tauri/src/logging/telemetry/status.rs)
-- es el espejo Rust de esta lista y su test
-- `todo_status_de_rust_esta_en_el_check_del_contrato` lee este archivo en las
-- dos direcciones (variante sin literal, o literal sin variante = build rojo).
-- `PlatformLogStatus` (lib/platformLogger.ts) debe ser subconjunto (segundo test).
--
-- Cómo aplicar (un solo statement = una transacción; ninguna fila existente
-- puede violar el CHECK nuevo porque es superconjunto del viejo y NULL sigue
-- permitido). Verificar ANTES el nombre real del constraint — si no coincide,
-- el `add` crearía un segundo CHECK y el estrecho seguiría rechazando:
--
--   select conname, pg_get_constraintdef(oid)
--   from pg_constraint
--   where conrelid = 'maity.platform_logs'::regclass and contype = 'c';
--
-- y DESPUÉS repetir la query: exactamente un CHECK sobre `status` con los 7 valores.
-- Nombre verificado en producción el 2026-09-11: platform_logs_status_check.
--
-- Aplicado en producción: 2026-09-11 17:20Z (Management API, desde el desktop;
-- verificado antes y después con la query de arriba).

alter table maity.platform_logs
  drop constraint if exists platform_logs_status_check,
  add constraint platform_logs_status_check
    check (status is null or status in (
      'success', 'error', 'timeout', 'skipped',   -- dominio original (platformLogger JS)
      'ok', 'partial', 'warning'                  -- emisores Rust (sep-2026)
    ));
