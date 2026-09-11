-- Re-drenar los eventos que el CHECK de maity.platform_logs rechazó en silencio.
--
-- Hasta el 2026-09-11 los emisores Rust mandaban status 'ok' | 'partial' |
-- 'warning' contra un CHECK que solo admitía success/error/timeout/skipped; el
-- RPC tragaba la excepción y respondía 200, así que drain.rs marcó esas filas
-- como sincronizadas sin que llegaran (docs/platform-logs-status.sql). Las
-- filas siguen aquí intactas: al volver a synced_to_cloud = 0 la drenadora las
-- reenvía con su payload original (ctx.occurred_at conserva la hora real).
--
-- Sin duplicados posibles: ninguna de estas filas existió jamás en la nube.
-- Aditiva e idempotente (version-skew seguro entre canales). Requiere que el
-- CHECK ya esté ensanchado en producción cuando corra este build; si no, se
-- re-marcarían y se perderían otra vez.
update recording_logs
   set synced_to_cloud = 0
 where synced_to_cloud = 1
   and status in ('ok', 'partial', 'warning');
