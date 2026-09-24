# Telemetría y diagnóstico remoto — inventario completo

> Última actualización: 2026-09-24 (0.2.62, issue #83 "¿por qué no grabó?":
> ciclo de vida del proceso (`app.start`/`app.exit`/`app.resumed` + marcador en
> disco), estado de la jornada en el latido (`idle_reason`, bloque `jornada`),
> configuración de jornada en `device.profile`, `autostart.changed`,
> `auth.logout`/`auth.session_lost`,
> `jornada.settings_changed`/`jornada.idle_reason_changed`, drenado por fila y la
> query persona × día; reconciliado con el código). Antes: 2026-08-17 (ciclo v0.2.57 "fail-closed": contrato `ctx`
> + `install_id`, drenadora nativa única, ciclo de vida de grabación desde Rust,
> `device.profile`, contadores de descarte, panics, y este doc pasa a ser
> **contrato ejecutable** — lo verifica `frontend/scripts/lint-telemetry.js`).
> Pregunta que responde este doc: **"¿qué información tenemos para diagnosticar
> un problema en producción sin pedirle nada al usuario?"**

> **Regla de oro (ago-2026): evento nuevo = 3 entradas.** Una constante en
> `frontend/src/lib/telemetry-events.ts`, su gemela en
> `src-tauri/src/logging/telemetry/catalog.rs` y una fila (con el nombre entre
> backticks) en la tabla de abajo. `lint-telemetry.js` falla el build si falta
> alguna, si un call site de `platformLogger.log`/`recordingLogService.log` usa
> un nombre no catalogado, si un evento nuevo no lleva punto (`app.error`, no
> `app_error`; los snake_case históricos van marcados `// legacy` y NO se
> renombran), si `insert_platform_log` se invoca fuera de los dos writers, si un
> campo de versión dice `'unknown'`, o si una capability pierde `core:app:default`.

## Los tres niveles (pirámide de observabilidad)

| Nivel | Qué es | Dónde vive | Volumen |
|---|---|---|---|
| **1. Métricas + eventos** | Estructurados, siempre activos | Supabase `maity.platform_logs` | ~50-100 filas/día/usuario |
| **2. Errores** | `app.error` con rate-limit | Supabase `maity.platform_logs` | ≤20/sesión/ventana |
| **3. Logs completos** | Log rotativo con `[METRIC]` | **Solo local**; export manual (ZIP) | miles de líneas/sesión |

Decisión de diseño (jul-2026, a raíz de la petición de "mandar los logs a la
DB"): los logs crudos **no** van a la nube — volumen (miles de líneas × usuarios),
privacidad (rutas, títulos de reunión; Maity se vende privacy-first) y ruido.
Lo que sí va: métricas de salud y errores, que es lo que se necesita para
diagnosticar remotamente. Los logs completos siguen siendo bajo demanda
(Settings → Logging → Export).

## Nivel 1-2: `maity.platform_logs` (Supabase)

**Pipeline (dos writers, y solo dos):**
1. **JS directo (solo ventana `main`):** `platformLogger` (`frontend/src/lib/platformLogger.ts`) →
   RPC `public.insert_platform_log` (SECURITY DEFINER; resuelve `user_id` desde
   `maity.users WHERE auth_id = auth.uid()`; traga excepciones — nunca rompe la
   app, **y tampoco avisa**: si el INSERT viola un CHECK responde 200 igual y
   `drain.rs` marca la fila como sincronizada; ver gotcha del `status` abajo)
   → tabla `maity.platform_logs`. Lo usan `app.open`/`app.close`, el `app.error`
   del webview, `nav.*`, el `health.heartbeat` del JS, `device.profile` y el
   passthrough de `Analytics.track` (`coach.session_summary` pasó al outbox
   nativo en sep-2026). El ciclo de vida del PROCESO
   (`app.start`/`app.exit`/`app.resumed`) NO va por aquí: va por el outbox.
2. **Outbox nativo (store-and-forward):** `telemetry::emit` (Rust:
   `emit_event`, o `emit_event_with_id` cuando la ruta necesita el id de la
   fila), `recordingLogService.log` (JS, vía comando) y, desde sep-2026 (#23 de la
   auditoría), **la analítica de las ventanas auxiliares** (`lib/auxAnalytics.ts`
   → comando `log_analytics_event` → `emit_webview_event`) escriben al outbox
   SQLite `recording_logs` — cero red en el camino caliente, sobrevive crash,
   suspensión y **webview cerrado** (jornada/tray). La **única drenadora es
   `logging/telemetry/drain.rs`**: tick 30 s + `Notify`, `get_unsynced_logs(50)`
   → `get_valid_token` (sin sesión ⇒ diferir sin quemar intentos) → POST al
   mismo RPC fila por fila. Desde 0.2.62 **cada fila se marca `synced_to_cloud`
   apenas recibe su 2xx** (antes se marcaba el lote al final y un corte a mitad
   re-posteaba filas ya subidas). Las rutas de salida (`app.exit`,
   `auth.logout`) suben SU fila con `drain::flush_row(app, id, budget)`: una
   fila concreta, con presupuesto acotado y el token de
   `cloud_sync::session::token_if_fresh` (reusa el vigente, **nunca refresca**:
   cortar un refresh a mitad de la salida perdería el `refresh_token` ya
   rotado); devuelve `FlushOutcome` (`Sent|AlreadySynced|NoSession|TokenStale|Timeout|Rejected(status)|Network`).
   Un reclamo por fila (`INFLIGHT`) impide que el loop y un `flush_row` posteen
   la misma fila, y `drain::set_exiting()` (lo llama `lifecycle::begin_exit`)
   apaga el loop durante la salida. `syncToCloud()` de JS se eliminó
   (ago-2026): dos drenadores = filas duplicadas.

> **Las ventanas aux (`coach-float`, `recording-widget`, `device-picker`) NO
> cargan `platformLogger`** (arrastra supabase-js: ~200 KB de chunk y un segundo
> cliente GoTrue con `autoRefreshToken` por webview — #23). Su `ctx` conserva
> `emitter: "webview"` y `window: <label real>` (lo toma Rust del webview que
> invoca, no del payload), así que las queries por `ctx` no cambian; lo que SÍ
> cambia es la **columna** `session_id` de esos eventos (`coach_float.*`): pasa
> de `desktop-…` (instancia propia de `platformLogger` en ese webview) a la de
> proceso `proc-…`. El fitness test `app/(aux)/layout.test.ts` prohíbe que el
> grafo aux alcance `platformLogger`/`supabase`. El comando valida nombre
> (`[A-Za-z0-9._:-]`, ≤128) y payload (objeto, ≤8 KB) y descarta con `warn!`.

Columnas útiles: `user_id`, `session_id`, `platform` (`'desktop'` | web),
`event_type`, `event_data` (jsonb, con el envelope `ctx` de abajo), `status`,
`error`, `app_version`, `device_info` (userAgent), `created_at` (hora de
inserción — el momento real del evento es `ctx.occurred_at`).

**`status` es un dominio cerrado** (CHECK `platform_logs_status_check`):
`success | error | timeout | skipped` (los del `platformLogger` JS y del ciclo
de vida de grabación) + `ok | partial | warning` (emisores Rust de
mantenimiento). El contrato es `docs/platform-logs-status.sql`; su espejo Rust
es `logging/telemetry/status.rs::TelemetryStatus` — `emit_event` solo acepta el
enum, y el test `todo_status_de_rust_esta_en_el_check_del_contrato` lee el SQL
en las dos direcciones; el TS (`PlatformLogStatus`) es subconjunto (segundo
test). `log_recording_event` (JS → outbox) degrada a NULL un valor fuera del
dominio y lo avisa con `warn!`. En SQL, "éxito" es `status in ('success','ok')`.

### Contrato `ctx` (envelope obligatorio en todo evento, ago-2026)

```jsonc
"ctx": { "install_id": "<uuid v4>", "app_version": "0.2.57", "session_id": "proc-…",
         "emitter": "rust|webview", "window": "main|coach-float|recording-widget|device-picker|null",
         "occurred_at": "<iso>", "schema": 1 }
```

- `install_id`: UUID v4 **aleatorio** persistido en el store `telemetry.json`
  (no derivado de hardware). Si el store se corrompe se regenera y el evento
  lleva `install_id_regenerated`. **Backfill:** las instalaciones existentes
  generan el suyo en el primer arranque post-0.2.57 — el corte en la serie NO
  es churn.
- `app_version`: de `app.package_info()` en Rust; si no resuelve **se omite la
  clave** (NULL honesto). Nunca `'unknown'` (lint d): un centinela ordena por
  encima de `'0.2.56'` en `max()` y esconde el NULL.
- `session_id`: **id de PROCESO** (`proc-…`), el mismo para heartbeats y eventos
  de grabación (antes había dos: `desktop-…` vs `session-…`, imposibles de
  joinear). El id de la grabación viaja como `recording_session_id` en el payload.
- `emitter`: `rust` para lo que nace en el chokepoint nativo (jornada, tray,
  scheduler); `webview` para React. Es la dimensión que hace auditable el modo
  dominante de uso (antes mary tenía 9 conversaciones y 0 `recording_started`).
- Fuente única: comando `get_telemetry_context` + `lib/telemetryContext.ts`
  (cache + single-flight); funciona en las 4 ventanas (comando propio, sin ACL).

> **Gotcha de auth (verificado jul-31)**: sin sesión Supabase el RPC devuelve
> **401 y el evento se pierde en silencio** — el rol `anon` no tiene USAGE
> sobre el schema `maity` y el cliente pide ese schema. En la práctica casi
> todo emisor corre tras el AuthGate, pero `app.error` pre-login (db-init,
> rust, window) NO aterriza para usuarios deslogueados. Al depurar telemetría
> con un perfil sin sesión: el request sale, el server lo rechaza — verificar
> con intercepción de red, no con la tabla.

> **Gotcha del CHECK de `status` (2026-09-10/11)**: el RPC traga la violación
> del CHECK y responde 200; `drain.rs` marca la fila como sincronizada y el
> evento desaparece sin rastro. Así se perdieron TODOS los `stt.*`, `audio.*` e
> `incident.*` desde que nacieron (mandaban `ok`/`partial`/`warning` contra un
> CHECK de cuatro valores): 0 filas all-time hasta ensanchar el CHECK
> (`docs/platform-logs-status.sql`). Un 2xx del RPC NO prueba que la fila
> exista; la query de control del runbook (`select event_type, status, count(*)
> … group by 1,2`) sí. Las filas quedaron en el SQLite local con
> `synced_to_cloud=1`; la migración `20260911000000_redrain_out_of_domain_status`
> las re-drena una vez que el CHECK acepta sus valores.

### Eventos que emite el desktop (inventario = catálogo; lo verifica el lint)

Los nombres marcados **legacy** conservan el snake_case del emisor JS original
para no romper la serie histórica; los eventos nuevos son dot-namespaced.

**Ciclo de vida de grabación — emisor Rust** (`recording_helpers::initialize_recording`
y `recording_lifecycle`, el chokepoint que comparten UI, tray, scheduler y
rotación; `trigger: Option<String>` baja por toda la cadena de firmas, así que
un entrypoint nuevo no compila sin declarar su trigger). Van al outbox y los
drena `drain.rs`; en el payload: `trigger` (`ui|tray|scheduler|scheduler_rotation|meeting_detector`),
`recording_session_id`, `mic_device`/`mic_source` y `sys_device`/`sys_source`
(`preference|system_default|fallback`, truncados a 64).

| event_type | Cuándo | Payload clave |
|---|---|---|
| `recording_started` (legacy) | POST-commit del `StartGate` en `initialize_recording` | trigger, dispositivos reales, `recording_session_id` |
| `recording_start_failed` (legacy) | `Err` de cualquiera de los dos start paths (incluido el `StartGate` ocupado) | trigger, `error`, `code`, `suppressed` |
| `recording_stopped` (legacy) | `stop_recording_reporting()` | duración, trigger, `recording_session_id` |
| `recording.segment_discarded` | `finalize_segment_native` descarta un segmento de jornada por contenido insuficiente | `words_total`, `threshold`, `trigger` (`rotation`/`close`); `status` = `skipped` |

> **`recording.segment_discarded` (ago-2026, #4 del piloto Dingler).** La jornada headless
> guardaba una hora de silencio como conversación: 80 de 144 conversaciones del piloto no eran
> analizables y todas viajaban a la nube gastando cuota. Ahora un segmento por debajo de
> `MIN_SEGMENT_WORDS` (250 palabras, **ambos canales**) no crea reunión local ni encola outbox.
> **No se reusó `save_skipped_no_transcripts`**: ese nombre afirma "no transcripts" y aquí sí los
> hay, sólo que pocos — sería la misma razón falsa que costó el hallazgo #1. Es además el primer
> evento que emite `scheduled_recording/service.rs`, que hasta ahora no emitía telemetría ninguna:
> sin él el descarte sería invisible y no habría con qué calibrar el umbral.

> **`recording_start_failed` está rate-limitado (ago-2026).** En el piloto Dingler
> una usuaria sin micrófono produjo **965 filas en 8 h** — el 27 % de
> `platform_logs` de todo el piloto — porque `emit_event` escribe al outbox sin
> ningún límite y el scheduler reintentaba cada 30 s. La causa se atacó en origen
> (back-off del scheduler, ver CLAUDE.md § Gate de Sesión), y como defensa en
> profundidad `emit_start_failed` (`recording_lifecycle.rs`, el **único** emisor:
> envuelve los dos start paths) lleva un limiter calcado de `BridgeLimiter`.
> Clave = **`código clasificado:trigger`** (p.ej. `mic_not_found:scheduler`), no el
> mensaje crudo — éste trae nombres de dispositivo y daría cardinalidad infinita
> sin agrupar nada. Cap 20/proceso + gap de 2 s, y **dedup sobre lo ENVIADO, no
> sobre lo VISTO** (misma invariante que los otros dos limiters). El payload gana
> `code` (para agrupar en SQL sin parsear `error`) y `suppressed` (volumen
> descartado), así que el descarte es visible en vez de silencioso.

**Mantenimiento local — emisor Rust.** Fuera del ciclo de vida de grabación: son
tareas de proceso, así que su payload **no** lleva `trigger` ni
`recording_session_id` y el `session_id` de la columna es el de proceso
(`process_session_id()`).

| event_type | Cuándo | Payload clave |
|---|---|---|
| `audio.retention_swept` | Una pasada de `audio_retention::sweep_once` liberó audio (sólo se emite si `meetings_swept > 0` o `failed > 0`) | `meetings_swept`, `bytes_freed`, `retention_days`, `failed`; `status` = `ok` \| `partial` |
| `audio.checkpoint_integrity` | El cierre de una grabación (`recording_saver.rs::stop_and_save` → `IncrementalAudioSaver::finalize`) produjo un `audio.mp4` con huecos o anómalo. Sólo se emite si `FinalizeReport::is_anomalous()`: checkpoint perdido, encode con error, o merge <100 KB con ≥4 checkpoints (la firma de las carpetas de 8 KB/h del piloto). Un cierre sano NO deja fila | `checkpoint_count`, `missing`, `encode_errors`, `merged_bytes`, `merged_duration_est_secs`; `status` = `partial` |
| `stt.engine_lifecycle` | Carga o descarga **real** de un motor STT local (`engine.rs::ensure_stt_warm` / `unload_stt`, y el reciclado de `parakeet_engine.rs`) | `action` = `loaded` \| `unloaded`; `reason` = `login` \| `registration` \| `prewarm` \| `recording_start` \| `download_complete` \| `logout` \| `idle` \| `recycle_failed` \| `batch` \| `batch_done`; `provider`, `model`, `elapsed_ms` (sólo en `loaded`), `tier`; `status` = `ok` \| `error` |
| `stt.batch_job` | Un job de transcripción por lote terminó (`batch/planner.rs::process_queue`; una fila por intento terminal, éxito o fallo) | `trigger` = `manual` \| `rotation` \| `auto_close` (el ORIGEN del segmento — se conserva en crash recovery porque decide la política de descarte); `recovered` = `true` si la fila venía de una recuperación post-crash (`last_error='crash_recovery'` al reclamarla; fiable en el intento 1); `outcome` = `saved` \| `discarded` \| `finalize_failed` \| `transcribe_failed`; `attempts`; con éxito además `audio_secs`, `voiced_secs`, `wall_ms`, `rtf`, `words`, `segments`; `status` = `ok` \| `error` |
| `stt.batch_deferred` | El gate híbrido difirió un job (`batch/planner.rs::gate`); **latch por episodio**: la misma razón consecutiva NO re-emite (un episodio de presión de horas sería una fila cada 5 min) | `reason` = `pressure` \| `headroom` \| `cpu` \| `streaming_active`; `level` = `normal` \| `elevated` \| `critical`; `status` = `ok` |

> **`stt.engine_lifecycle` (sep-2026, #02).** Parakeet se precargaba en el
> `setup()` sin sesión y nunca se descargaba: 600 MB residentes desde el login
> para siempre. Hoy la carga va gateada por sesión + registro y la descarga
> ocurre en logout (todo tier) y en reposo fuera de la ventana de jornada (tier
> Low). Este evento fecha cada transición; **no** se metió como campo de
> `health.heartbeat` porque tocar `MemSample` rompe cuatro sitios a la vez y un
> booleano cada 15 min no dice *cuándo* ni *por qué* cambió. Sólo se emite en
> transiciones reales: `set_registration_status` reinvoca la precarga en cada
> refetch y un "ya estaba cargado" no deja fila. `status = error` con
> `reason = recycle_failed` significa que el reciclado drop-then-load (tier Low)
> soltó la sesión y no pudo recargarla: el worker del transcriptor alimenta su
> breaker y reintenta a los 5 min.

> **`audio.retention_swept` (sep-2026, #27).** Ninguna ruta de código borraba
> carpetas de reunión: el `audio.mp4` se acumulaba para siempre (~29 MB/h con el
> bitrate nuevo, ~86 MB/h con el viejo). El barrido libera `audio.mp4` y el
> `.checkpoints/` residual de las reuniones con un `finalize_conversation`
> completado hace al menos `audio_retention_days` días, y **conserva siempre**
> `transcripts.json` y `metadata.json`. Se emite **sólo cuando hubo trabajo**: un
> evento cada 6 h diciendo "no había nada" sería la misma tormenta de filas que
> costó 965 eventos en 8 h en el piloto Dingler. `status` distingue una pasada
> limpia (`ok`) de una con reuniones que fallaron y se reintentarán (`partial`).
> El emisor es Rust vía `emit_event` → outbox → `drain.rs`; el `session_id` de la
> columna es el de proceso (`process_session_id()`), porque el barrido no
> pertenece a ninguna grabación.

**Ciclo de vida del proceso, sesión y jornada — emisor Rust, outbox (desde
0.2.62, #83).** Responden "¿por qué X no grabó el día Y?" (query más abajo).
TODOS van por el outbox nativo (`emit_event`/`emit_event_with_id` →
`recording_logs` → `drain.rs`). La columna `session_id` de todos es
`context::process_session_id()` (`proc-…`).

| event_type | Emisor | Cuándo | Payload clave |
|---|---|---|---|
| `app.start` | `logging/telemetry/lifecycle.rs::emit_start` | 1× por proceso, en un spawn después del init de la DB (el marcador ya se rotó en `lifecycle::rotate_at_boot`, primera sentencia del `setup()`). `status` `warning` si `prev_exit_clean` es `false`; si no, `ok` | `lifecycle_schema` (1), `build` (`release\|debug`), `build_channel` (`store\|direct`), `started_at_boot`, `autostart_state`, `started_at`, `os_boot_at`, `first_run`, `marker_status` (`ok\|missing\|corrupt\|foreign`), `prev_session_id`, `prev_version` (nunca `'unknown'`: `null`), `prev_version_source` (`marker\|outbox\|null`; `outbox` solo en release y sin marcador usable), `version_changed`, `prev_started_at`, `prev_last_alive_at`, `prev_uptime_s`, `prev_exit_reason`, `prev_exit_detail`, `prev_exit_source` (`observed\|intent\|inferred\|null`), `prev_exit_clean` (`null` = sin marcador usable: primer arranque o upgrade desde una versión anterior a 0.2.62), `prev_exit_interrupted` (salida empezada y no terminada), `prev_recording_active_at_exit`, `prev_panicked`, `prev_panic_count`, `os_rebooted_since_prev`, `downtime_s`, `clock_skew`. Desde 0.2.62 (Inicio rápido, ver § Inicio rápido de Windows): `os_logon_at` (rfc3339 o `null` — hora de logon de la sesión de Windows actual, `WTSQuerySessionInformationW`/`WTSSessionInfo`; `null` fuera de Windows o si la API falla) y `logon_changed_since_prev` (`bool\|null` — la hora de logon cambió más de 2 s respecto del marcador anterior; `null` si falta en alguno de los dos lados, p. ej. marcador escrito por una versión anterior a 0.2.62). Total: 29 claves |
| `app.exit` | `lifecycle.rs::begin_exit` + `lifecycle.rs::emit_exit_row` | en cada salida registrada; emit-once (la primera ruta que llega gana). `begin_exit` escribe primero el bloque `exit` del marcador (durable) y apaga la drenadora; después `emit_exit_row` inserta en el outbox con tope de 750 ms (`EXIT_ROW_TIMEOUT`; 400 ms en fin de sesión, `EXIT_ROW_TIMEOUT_SESSION_END`). `flush_row` solo en la bandeja (3 s, después del stop), en `exit_for_update` (3 s) y en el hook de `direct_update_install` (2 s); instalación rival, `RunEvent::Exit` y fin de sesión NO suben la fila (sube en el siguiente arranque). `update`/`store_api` no deja fila: su intención la lee el siguiente `app.start`. `status` `ok` | `lifecycle_schema`, `reason` (tabla de motivos abajo), `detail`, `exit_code`, `uptime_s`, `recording_active`, `recording_phase`, `session_end_kind` (`logoff\|shutdown\|unknown\|close_app`), `critical`, `build` |
| `app.resumed` | `lifecycle.rs::spawn_alive_ticker` (ticker propio de 60 s) | el reloj de pared saltó más de 180 s entre dos ticks (suspensión); también deja `last_resume` en el marcador. `status` `ok` | `suspended_at`, `resumed_at` (rfc3339), `gap_s` |
| `autostart.changed` | `autostart_state.rs::reconcile` (`reconcile_with`) | `autostart_state` difiere de la línea base `last_autostart_state` del marcador; la línea base avanza SOLO si la fila quedó en el outbox. Sin línea base (primer arranque) solo se fija, sin fila; un `unknown` no toca la línea base. Disparadores: `boot` (lo llama `lifecycle::emit_start` justo después de `app.start`) y `settings_toggle`/`bootstrap` (comando `autostart_reconcile`, con allowlist). `status` `ok` | `from`, `to`, `trigger` (`boot\|settings_toggle\|bootstrap`), `mechanism` (`startup_task\|run_key\|plugin`), `disabled_at` |
| `auth.logout` | `lib.rs::logout_cleanup` → `logging/telemetry/auth.rs::emit_logout` | el usuario pide el logout desde cualquier botón (`AuthContext.signOut(surface)` → `invoke('logout_cleanup', { surface })`). La fila se escribe ANTES del stop de la grabación; después corren en paralelo el stop (≤30 s) y un `flush_row` de 3 s con el token de quien sale. Al final borra la marca `last_login_user`. `status` `ok` | `reason` (`"user"`), `surface` (`settings\|sidebar\|chat_sidebar\|onboarding_badge\|account_error\|unknown`; fuera del dominio ⇒ `unknown`), `maity_user_id`, `recording_was_active`, `recording_phase` |
| `auth.session_lost` | comando `telemetry_auth_session_lost` (`logging/telemetry/auth.rs`), invocado desde `AuthContext` | un `SIGNED_OUT` que el usuario no pidió (`webview_signed_out`), o un arranque sin sesión con marca `last_login_user` en el marcador y un error de `getSession` NO reintentable (`boot_no_session`, decisión en `lib/authSessionLost.ts`; una red caída nunca lo emite). La marca se consume solo si la fila quedó en el outbox. `status` `warning` | `source` (`webview_signed_out\|boot_no_session`), `maity_user_id`, `recording_was_active`, `error_name` (solo `[A-Za-z0-9_.]`, ≤64) |
| `jornada.settings_changed` | `ScheduledRecordingService::update_settings` (`scheduled_recording/service.rs`, único punto de persistencia) | solo si `status_snapshot::changed_fields` encuentra diff (el gate de activación guarda dos veces con el mismo contenido y eso deja una sola fila). `status` `ok` | `from`/`to` (`JornadaConfig`, ver `device.profile`) y `changed` (nombres de campo de `JornadaConfig`) |
| `jornada.idle_reason_changed` | `scheduled_recording/service.rs::spawn_idle_reason_emit` (vía `status_snapshot::take_idle_transition`) | tras cada publicación de la instantánea del scheduler (`initialize`, `start`, `update_settings` y cada tick) si `idle_reason` cambió respecto del último emitido; `pending`/`initializing` ni se emiten ni reemplazan el último valor; tope de 200 por proceso. `status` `ok` | `from`/`to` (`idle_reason` o `null`), `recording_phase`, `jornada` (el bloque del latido). Es la línea de tiempo preferente de la query porque va por el outbox y sobrevive sin red |
| `app.window_shown` | `logging/telemetry/window_shown.rs` (`note_app_ready`/`note_fallback_shown`, llamados desde `lib.rs`) | **1× por proceso.** Mide, desde el inicio de `setup()` (`mark_setup_start()`, primera sentencia del closure, antes de `rotate_at_boot`), quién terminó mostrando la main window: si el `app-ready` del frontend llega antes que el fallback de 3 s de `lib.rs`, `shown_by: "app_ready"`; si gana el fallback (el frontend tardó más de 3 s), `shown_by: "fallback"` y se espera hasta 60 s un `app-ready` tardío — si llega, se emite con `app_ready_ms` puesto; si no, se emite a los 60 s con `app_ready_ms: null`. No lleva latencia de ventana en `app.start` a propósito: `app.start` se emite antes de que cargue el webview. `status` `ok` | `shown_by` (`app_ready\|fallback`), `shown_ms` (desde `setup()`), `app_ready_ms` (`número\|null`), `started_at_boot`, `fallback_after_ms` (3000), `late_ready_wait_ms` (60000) |

> (i) `app.exit` se escribe al salir, pero casi siempre se DRENA en el siguiente arranque tras el login. La hora real es `ctx.occurred_at`, nunca `created_at`.
> (ii) El marcador `lifecycle.json` (`lifecycle-debug.json` en debug), en `app_local_data_dir`, es la verdad; la fila es best-effort: si Windows mata el proceso antes del commit del outbox, el motivo viaja como `app.start.prev_exit_reason`. Campos: `exit` (motivo observado, `begun_at_ms`/`done_at_ms`), `exit_intent` (`update` o `session_end`, escrita ANTES de una salida que puede no pasar por `RunEvent::Exit`), `last_resume`, y dos que se arrastran entre arranques: `last_autostart_state` (línea base de `autostart.changed`) y `last_login_user` (marca de `auth.session_lost`).
> (iii) Las filas escritas sin sesión (antes del login) se atribuyen a quien inicie sesión después, porque el RPC resuelve `auth.uid()` al drenar. `auth.*` llevan `maity_user_id` en el payload para atribuirlas bien.
> (iv) Ninguno de estos eventos se emite desde JS con `platformLogger`.
> (v) **`autostart_toggled` ≠ `autostart.changed`.** `autostart_toggled` (passthrough de `Analytics.track` en `components/settings/PreferenceSettings.tsx`, canal MSIX y directo) solo registra los toggles hechos DENTRO de la app, va por JS directo y queda fuera del catálogo. `autostart.changed` compara el estado REAL contra la línea base del marcador, así que también ve el Administrador de tareas y el bootstrap de instalación nueva.

**App / salud — emisor `platformLogger` (JS) salvo donde se indica.**

| event_type | Quién lo emite | Cuándo | Payload clave |
|---|---|---|---|
| `app.open` / `app.close` | `app/(main)/layout.tsx` (`AppContent`) | `app.open`: cada MONTAJE del documento main: el arranque **y cada recarga** (`window.location.href` al detener una grabación manual, `reload()` de ErrorBoundary/ChunkErrorRecovery/useConversationLive); un `referrer` no vacío delata la recarga. `app.close`: el primer `onCloseRequested`/`beforeunload`/`pagehide` del documento; la X **esconde a la bandeja**, el proceso sigue vivo. Prod, 30 días al 2026-09-23: 203 `app.open` (13 con referrer), 41 `app.close`, y 9 procesos siguieron emitiendo >10 min después de su `app.close`. **Ninguno es ciclo de vida del proceso: para eso `app.start`/`app.exit`.** | `app.open`: `referrer`, `screen`, `viewport`, `language` |
| `nav.page_view` | `usePageViewTracker` | cada navegación | ruta |
| `device.profile` | `healthHeartbeatService.start()` (comando `get_device_profile`) | **1× por sesión** | `cpu_cores`, `gpu_type`, `memory_gb`, `os`, `os_version`, `arch`, `build_channel`, `performance_tier` — *resource attributes*, NO se repiten en cada heartbeat (ver cardinalidad abajo). Desde 0.2.60 (en 0.2.59 solo el build piloto: 1 de 27 perfiles): `started_at_boot` (bool — el proceso arrancó por autostart del OS, no a mano) y `autostart_state` (`enabled\|enabledByPolicy\|disabled\|disabledByUser\|disabledByPolicy\|unknown` — StartupTask WinRT bajo MSIX, plugin autostart en el resto; `disabledByUser` = apagado en Task Manager y la app NO puede reactivarlo, solo mandar a `ms-settings:startupapps`). Desde 0.2.62: `signature_kind` (`store\|developer\|enterprise\|system\|none\|unknown`, null fuera de MSIX — `Package.Current.SignatureKind`; solo `store` recibe updates de la Store, así que `build_channel=store` + `developer` = copia de prueba que nunca se actualiza). Desde 0.2.62 (#83): `jornada` = `null` o `JornadaConfig` `{enabled, configured_by_user, windows: [{days_of_week (ISO, 1 = lunes), start_time "HH:MM", end_time "HH:MM"}] (máx. 3), windows_count, auto_close_enabled, auto_close_time, hourly_rotation_enabled, grace_period_minutes}`, en hora LOCAL de la PC (`status_snapshot::jornada_config`; `null` = el scheduler aún no publicó nada). Es solo la CONFIGURACIÓN: `device.profile` NO lleva `idle_reason` ni el estado dinámico de la jornada, que van en `health.heartbeat`. El JS re-emite el perfil (sin fijar su latch) mientras `jornada` sea `null`, hasta 3 emisiones por proceso (`DEVICE_PROFILE_MAX_EMITS`). En canal directo `autostart_state` puede decir `disabledByUser` (Task Manager, `StartupApproved\Run`) con el mismo predicado que auto-launch 0.5.0. También: `autostart_disabled_at` (`null` o rfc3339), `autostart_mechanism` (`startup_task\|run_key\|plugin`), `package_installed_at` (`null` o rfc3339, instalada o ACTUALIZADA por última vez) y `package_installed_at_source` (`null\|package\|nsis_uninstall_key`). Desde 0.2.62: `hiberboot_enabled` (`bool\|null` — `HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Power!HiberbootEnabled`, `0`→`false`, distinto de `0`→`true`, `null` fuera de Windows o si no se pudo leer el registro; con Fast Startup activo un "apagado" no reinicia el kernel, así que `os_boot_at` no cambia) |
| `health.heartbeat` | `healthHeartbeatService` (JS) **y `logging/mem_sampler.rs` (Rust, `reason:"native"`)** | JS: cada 5 min activo / 15 min idle + start/stop de grabación. Rust: cada 15 min, SOLO si el webview lleva >20 min sin pedir `get_health_snapshot` (tray / ventana congelada) | ver abajo (+ `err_budget`, `performance_tier`). Etiquetar con `event_data->'ctx'->>'emitter'` (`webview` vs `rust`); para unir la serie de un mismo proceso, agrupar por `event_data->'ctx'->>'session_id'` (la COLUMNA `session_id` difiere entre emisores) |
| `coach.session_summary` | **`coach/live_feedback.rs::stop()` (Rust, outbox)** — hasta 0.2.59 lo reenviaba el hook `useCoachMetricsTelemetry` desde el evento Tauri `coach-metrics` | al cerrar una sesión de coach **que existió**: sin `start()` previo no hay fila. Hasta 0.2.59 cada arranque de grabación dejaba una fila fantasma (`coach_mode:'transcript'`, voz `null`) porque `start()` llama a `stop()` primero; los históricos se filtran con `ctx->>'emitter'='webview' and user_voiced_ms is null and llm_parse_total=0` | métricas LLM + sidecar (timeouts, restarts, cooldowns, idle_kills, breaker) + picos de RAM + tier. `sidecar_idle_kills` debe ser 0 en Medium+ con tips LLM (lease de sesión, #03 auditoría). Desde F5 (sep-2026) también `coach_mode` (`transcript`\|`audio`), `user_voiced_ms`, `interlocutor_voiced_ms`, `longest_user_mono_ms`, `audio_session_ms`; en modo lote `coach_mode='audio'` y los contadores LLM/sidecar deben ser 0 (`longest_user_mono_ms` calibra `INTERRUPT_MS`). Columna `session_id` = `proc-…`, `ctx.emitter='rust'` (como el latido nativo); sobrevive al webview dormido en tray — en el piloto del 2026-09-10 solo 1 de 9 segmentos dejó summary |
| `app.error` | `errorTelemetry` (JS: window, unhandledrejection, error-boundary, db-init), **`logging/rust_error_bridge.rs` (Rust, `source:"rust"`, outbox)** y **`telemetry/panics.rs` (Rust, `source:"rust-panic"`, outbox)** | error no manejado / boundary / `log::error!` de Rust / panic (los de Rust al outbox; el panic se drena en el siguiente arranque) | ver abajo |

**Guardado post-grabación — emisor `recordingLogService` (JS → outbox `recording_logs`).**
Todos legacy. Payload común: `recording_session_id`, `meeting_id`, `is_call_api`.

| event_type | Cuándo |
|---|---|
| `meeting_id_generated` | al arrancar (`useRecordingStart`) |
| `buffer_flush_completed` | flush de 500 ms al detener |
| `sqlite_save_attempted` / `sqlite_save_succeeded` / `sqlite_save_failed` | guardado local (`useRecordingStop`) |
| `save_deferred_audio_only` | 0 transcripts **pero hay checkpoints de audio**. Desde ago-2026 (2ª iteración) ya NO se difiere al diálogo de recuperación: se fusiona el audio en `audio.mp4` best-effort, se marca el registro guardado y se avisa con toast "Abrir carpeta". El nombre se conserva por catálogo (`legacy`) |
| `save_skipped_no_transcripts` | 0 transcripts y sin audio: nada que ofrecer |
| `cloud_sync_enqueued` / `cloud_sync_enqueue_failed` | encolado en la sync queue offline-first |

**Fuera del catálogo (a propósito):** `Analytics.track(...)` (`lib/analytics.ts`,
stub de PostHog) es analítica de producto de la UI (`preferences_viewed`,
`microphone_selected`, …) con passthrough a `platform_logs`; se documenta como
esta única fila y el lint lo exime con `// telemetry-allow:`. Su gemelo para las
ventanas auxiliares es `trackAux(...)` (`lib/auxAnalytics.ts`, `coach_float.*`),
que va por el outbox nativo (ver Pipeline) con la misma exención. Si algún día
se quiere inventariar, entra por la regla de 3 entradas.

**`insert_user_feedback` (tabla `maity.user_feedback`, no `platform_logs`):**
desde sep-2026 (#23) el ÚNICO escritor es Rust — `save_user_feedback` guarda en
SQLite y `cloud_sync/feedback.rs::spawn_sync` postea la RPC best-effort (un
intento, sin outbox: paridad con el fire-and-forget que hacían coach-float y
`SessionFeedbackModal` con supabase-js). `p_message` = `message` o, si no hay,
`rating`; `p_metadata` = `{platform, rating, meeting_id}` ∪ metadata del
frontend. No volver a llamar la RPC desde JS: el `p_id` UNIQUE rechazaría el
segundo POST con ruido.

### `health.heartbeat` (jul-2026; doble emisor desde sep-2026)

Fuente Rust: comando `get_health_snapshot` (`logging/commands.rs`) — UNA
invocación IPC que junta: el último `MemSample` del sampler periódico
(`logging/mem_sampler.rs`, **30 s grabando / 60 s en idle**, costo ~0,
`cpu_pct` y `proc_cpu_pct` reales), fase de grabación (`recording_phase`,
lock-free) y lag de transcripción (AtomicU64). La frescura del sample **no es
un techo fijo**: leerla de `mem_sample_age_s`, nunca asumir 30 s.

`event_data`:

```jsonc
{
  "reason": "initial | interval | recording-start | recording-stop | native",
  //          └─ los 4 primeros: emisor JS (ctx.emitter="webview")
  //             "native": emisor Rust del mem_sampler (ctx.emitter="rust")
  "phase": "idle | starting | recording | paused | stopping",
  "uptime_s": 3600,            // JS: desde el arranque del heartbeat (post-auth).
                               // Rust: desde el arranque del sampler (≈ del proceso).
  "seq": 12,                   // contador por emisor; gaps delatan sleep del laptop
  "mem": {                     // MemSample del sampler (null si aún no hay tick)
    "app_rss_mb": 512,         // RSS del proceso maity-desktop
    "llama_rss_mb": 1024,      // suma de llama-helper por NOMBRE (caza huérfanos)
    "llama_procs": 1,
    "webview_rss_mb": 300,     // solo WebView2 con ancestro maity
    "webview_procs": 4,
    "ffmpeg_procs": 0,
    "sys_avail_mb": 8000, "sys_total_mb": 16000,
    "cpu_pct": 12.5,           // CPU del SISTEMA (0-100), de global_cpu_usage()
    "proc_cpu_pct": 37.5       // CPU de maity-desktop, normalizado ×nb_cpus:
                               // 100 % = UN core, NO la máquina entera.
                               // 0 en snapshots ad-hoc y en la primera muestra.
  },
  "mem_sample_age_s": 7,       // null = fallback fresco (cpu_pct sale 0); 0 en el nativo
  "peaks": { ... },            // SessionPeaks; OJO: el coach los resetea por sesión
  "lag_seconds": 0,
  "queue": { ... } | null,     // último transcription-lag-update (6 campos); null en
                               // idle. AUSENTE en el nativo: lo alimenta un listener
                               // del webview, que es justo lo que está muerto.
  "idle_reason": null,         // desde 0.2.62, AMBOS emisores, NIVEL SUPERIOR (no dentro de jornada);
                               // dominio cerrado (tabla abajo). null = grabando/arrancando/deteniendo
  "jornada": null | {          // desde 0.2.62, AMBOS emisores; null = scheduler aún no inicializado
    "enabled": true, "configured_by_user": true, "loop_running": true,
    "scheduler_phase": "disabled | idle | armed | recording | grace",
    "in_window": true,         // pertenencia al horario; IGNORA enabled (igual que ScheduledStatus.in_window)
    "skip": null,              // SkipReason::as_str: manual_in_progress | transcription_not_ready |
                               // rearming_next_hour | closed_for_day | no_session | registration_incomplete |
                               // no_input_device | mic_access_denied | start_backoff
    "rearm_cause": null,       // user_stop | auto_close | session_end, solo mientras el rearme está vigente
    "rearm_until": null,       // "YYYY-MM-DDTHH:MM:SS" en hora LOCAL de la PC
    "backoff": null,           // { "code": mic_not_found|mic_permission_denied|mic_in_use|mic_format_unsupported|audio_unknown, "consecutive": 1, "halted_for_day": false }
    "settings_load": "ok | missing | error"
  }
}
```

> El nativo tampoco lleva `err_budget.webview` (limiter del JS) y manda
> `performance_tier: null`. `idle_reason` y `jornada` salen de la MISMA función en
> los dos emisores (`scheduled_recording/status_snapshot.rs::heartbeat_fields`):
> `get_health_snapshot` los pone en `HealthSnapshot` y el JS los copia al
> payload; `mem_sampler::emit_native_heartbeat` los pone directo. Leen una
> instantánea publicada por el scheduler, nunca el `RwLock` del servicio.

> El bloque `jornada` es lo ÚLTIMO que publicó el scheduler (`status_snapshot::SLOT`), no
> lo que está pasando en este instante. Desde 0.2.62 (F2), un arranque de jornada publica
> `scheduler_phase: "recording"`, `skip: null` ANTES de llamar a
> `start_recording_with_meeting_name` (`status_snapshot::publish_starting`, misma guarda
> `gen`/`loop_running` que `publish_tick`) — así el latido `recording-start`, que dispara
> el listener del evento `recording-started` de ese mismo arranque, ya no trae la fase del
> tick ANTERIOR (p. ej. `armed`/`no_session`). Para una grabación MANUAL (tray, botón) el
> bloque `jornada` sigue siendo el del último tick del scheduler hasta el siguiente
> (≤ `check_interval_seconds`, por defecto 30 s): en ese caso la verdad son `phase`
> (nivel superior del payload de grabación) e `idle_reason`, no `jornada`.

**`idle_reason` — dominio cerrado (desde 0.2.62)**

| fase de grabación | condición | valor |
|---|---|---|
| recording / starting / stopping | — | `null` |
| paused | — | `paused_by_user` |
| idle | snapshot del scheduler ausente | `initializing` |
| idle | `!enabled && !configured_by_user` | `jornada_unconfigured` |
| idle | `!enabled` | `jornada_off` |
| idle | `!loop_running` | `scheduler_stopped` (o `initializing` si el loop aún no arrancó ninguna vez en este proceso) |
| idle | rearme vigente con causa `session_end` | `session_ending` |
| idle | `!in_window` | `outside_window` |
| idle | skip `NoSession` | `no_session` |
| idle | skip `RegistrationIncomplete` | `no_registration` |
| idle | rearme vigente causa `auto_close` | `closed_for_day` |
| idle | rearme vigente causa `user_stop` | `stopped_by_user` |
| idle | backoff.code `mic_not_found` | `mic_not_found` |
| idle | backoff.code `mic_permission_denied` | `mic_permission_denied` |
| idle | backoff.code `mic_in_use` | `mic_in_use` |
| idle | backoff con otro code, o skip `TranscriptionNotReady`/`StartBackoff` | `start_failed` |
| idle | cualquier otro caso (skip `ManualInProgress` recién terminado, primer tick, etc.) | `pending` |

- `transcription_not_ready` NO se usa en telemetría porque esconde `mic_in_use`. El string de la UI (`SkipReason::as_str`) no cambia.
- Los 16 valores no nulos viven en `IDLE_REASONS` (`scheduled_recording/status_snapshot.rs`), en el mismo orden de precedencia que `fn idle_reason`: `paused_by_user`, `initializing`, `jornada_unconfigured`, `jornada_off`, `scheduler_stopped`, `session_ending`, `outside_window`, `no_session`, `no_registration`, `closed_for_day`, `stopped_by_user`, `mic_not_found`, `mic_permission_denied`, `mic_in_use`, `start_failed`, `pending`. Un valor nuevo exige una fila aquí, una rama en `fn idle_reason` y otra en la query.
- `closed_for_day` dura hasta el siguiente inicio de ventana (un turno 22-06 que cierra a las 06:00 conserva 22:00-00:00); `stopped_by_user`, hasta la siguiente hora en punto. Los dos sobreviven al reinicio de la app (`scheduled_recording_runtime.json`). `session_ending` es una retención solo en memoria (≤15 min) mientras se sale, se cierra sesión o se apaga; ninguna de esas rutas escribe supresión a disco.

Diseño (emisor JS): un solo interval de 5 min; la cadencia real la decide
`shouldEmitHeartbeat` por timestamps (sleep-safe: tras resume emite UNA vez).
Gate de sesión Supabase por tick (sin login → cero RPCs). Solo la ventana
principal lo corre: las aux viven en el route group `app/(aux)` con un root
layout sin initializers (#23), y `isAuxWindowPath` queda como gate defensivo.
Sin retry offline: un heartbeat perdido no se encola (mentiría sobre
`created_at`).

Diseño (emisor Rust, sep-2026 — hallazgo #14 de la auditoría de recursos): el
JS vive dentro de `AuthGate` y WebView2 **suspende el JS con la ventana
oculta**, así que en tray o con el webview congelado el latido desaparece justo
cuando una fuga importa. El loop de `mem_sampler` emite entonces el MISMO
`event_type` con `reason:"native"` cada 15 min, gateado por
`crate::state::has_session`. Desduplicación: `get_health_snapshot` tiene UN solo
invoker en todo el frontend, así que cada llamada marca "el webview está vivo"
(`mem_sampler::record_js_snapshot`) y el nativo solo emite si ese sello lleva
>20 min sin refrescarse (umbral por encima de los 15 min de la cadencia idle
del JS, para que un idle sano nunca produzca dos series).
**A diferencia del JS, el nativo SÍ se encola**: va por el outbox
(`emit_event` → `recording_logs` → `drain.rs`, single-writer), así que un latido
sin red se sube al reconectar. La frase "sin retry offline" de arriba aplica
SOLO al emisor JS; para el nativo el event time real está en
`ctx.occurred_at`, no en `created_at`.
**Consecuencia para el análisis:** la COLUMNA `session_id` difiere entre
emisores — el JS manda el suyo (`desktop-…`, de `platformLogger`) y el nativo el
de proceso (`proc-…`, de `context::process_session_id()`) —, así que agrupar por
esa columna **parte en dos** la serie de un mismo proceso; mezclarlas es
imposible, son valores distintos. Lo que SÍ une a los dos emisores es
`event_data->'ctx'->>'session_id'`, idéntico en ambos por el contrato `ctx` de
arriba (el JS lo toma de Rust vía `get_telemetry_context`). `emitter` no
desmezcla nada: sirve para ETIQUETAR y filtrar (p. ej. `emitter='rust' and
reason='native'` = jornada sin webview).

### Motivos de salida (`app.exit.reason` y `app.start.prev_exit_reason`, desde 0.2.62)

| motivo | tipo | significado |
|---|---|---|
| `tray_quit` | observado | "Salir" de la bandeja (`tray.rs`, `ExitHint::TrayQuit`). |
| `rival_install` | observado | se instaló el otro canal (Store ↔ directo) y esta copia se desinstala (`rival_install.rs`). |
| `update` | observado o intención | detail `store_button` (observado: comando `exit_for_update`), `nsis` (observado: hook de `direct_update_install`) o `store_api` (solo intención: `store_update.rs` llama `record_update_intent` antes de que la Store instale, y Windows cierra Maity sin `RunEvent::Exit`). |
| `restart` | observado | `ExitRequested` con `RESTART_EXIT_CODE`. |
| `app_exit` | observado | `ExitRequested` `Some(code)` sin motivo propio. |
| `last_window_closed` | observado | `ExitRequested` `None`; es una regresión tipo 0.2.57 (la X mataba la app). |
| `os_session_end` | observado o intención | cierre de sesión o apagado de Windows (`session_end.rs`). Detail y `session_end_kind` `logoff\|shutdown\|unknown`, más `critical`. Si Windows mató el proceso antes del bloque `exit`, sale de la intención `session_end` que el subclass escribió en `WM_QUERYENDSESSION`. |
| `external_close` | observado o intención | Restart Manager `CLOSEAPP` SIN apagado del sistema (instalador/desinstalación); `session_end_kind` `close_app`. |
| `loop_destroyed` | observado | WM_QUIT u otra causa rara. |
| `process_exit_after_cleanup` | observado | centinela (`ExitSentinel` en la tabla de recursos): el proceso salió por `cleanup_before_exit` sin `RunEvent::Exit`. |
| `crash_panic` | inferido | pánico en el hilo `main` dentro de `[started_at, last_alive + 120 s]` del proceso anterior (pánicos de otros hilos solo suben `prev_panicked`). |
| `os_restart_unclean` | inferido | cambió `os_boot` sin salida registrada. Con Inicio rápido un apagado NO cambia `os_boot`: ese caso lo cubre `os_session_end_unclean` (ver § Inicio rápido de Windows). |
| `os_session_end_unclean` | inferido | desde 0.2.62: cambió la hora de logon de Windows (`logon_changed_since_prev: true`) sin cambiar `os_boot` y sin salida, intención ni pánico de `main` registrados — terminó la sesión de Windows (cierre de sesión o apagado con Inicio rápido) y Windows mató a Maity antes de que dejara rastro. Es la versión inferida de `os_session_end`. |
| `unclean` | inferido | matado ("Finalizar tarea"), crash nativo, "Apagar de todos modos". |

Precedencia al arrancar (`lifecycle.rs::summarize_prev`): (1) exit observado
(`prev_exit_source: observed`) — si es `os_session_end`, `external_close` o
`process_exit_after_cleanup` y hay intención `update`, gana `update` (detail =
el de sesión o, si no hay, el `via` de la intención); (2) intención `update`
(`intent`); (3) intención `session_end` ⇒ `os_session_end` con su detail, o
`external_close` si el detail es `close_app` (`intent`); (4) `crash_panic`;
(5) `os_restart_unclean`; (6) `os_session_end_unclean`; (7) `unclean` (los
cuatro últimos `inferred`). Los tres primeros dan `prev_exit_clean: true`; los
inferidos, `false`. Las intenciones no caducan por edad. Sin marcador usable
(`marker_status` `missing`, `corrupt` o `foreign`) todos los `prev_exit_*` van
`null`.

### Inicio rápido de Windows (Fast Startup, desde 0.2.62)

`os_boot_at` sale de `sysinfo::System::boot_time()`, que en Windows es "ahora −
`GetTickCount64`". Con Inicio rápido activo, "Apagar" cierra la sesión del
usuario e HIBERNA el kernel: al encender, `GetTickCount64` sigue contando desde
el arranque anterior y `os_boot_at` no cambia (observado el 2026-09-24: mismo
`os_boot_at` antes y después de un apagado). Por eso `os_rebooted_since_prev`
solo detecta reinicios reales, y una app muerta en un apagado con Inicio rápido
salía como `unclean`.

Lo que sí cambia es la SESIÓN del usuario: el marcador guarda `os_logon_ms` (hora
de logon de la sesión de Windows, `WTSQuerySessionInformationW` con
`WTSSessionInfo`, `lifecycle.rs::os_logon_ms`) y `app.start` la publica como
`os_logon_at` y la compara en `logon_changed_since_prev` (tolerancia 2 s). Logon
distinto + boot igual + sin salida registrada ⇒ `os_session_end_unclean`.
`device.profile.hiberboot_enabled` dice qué equipos tienen el Inicio rápido
activo. Marcadores de versiones anteriores no traen `os_logon_ms`:
`logon_changed_since_prev` va `null` y el motivo cae a `unclean` como antes.

### `app.error` (jul-2026)

Fuentes (`frontend/src/lib/errorTelemetry.ts`):
- `window` / `unhandledrejection`: handlers globales (los rechazos de
  `invoke()` Rust llegan como strings → `name: 'UnhandledRejection'`).
- `error-boundary`: `ErrorBoundary.componentDidCatch`.
- `db-init` (jul-31, issue #64): `DbInitErrorGate` reporta el fallo de
  inicialización de la DB (`name: 'DbInitFailed'`) — antes el incidente era
  invisible remotamente.
- `rust` (jul-31, issue #60; **outbox desde sep-2026**): **puente Rust ERROR→outbox**
  (`src-tauri/src/logging/rust_error_bridge.rs`). Un Layer de tracing captura
  los ERROR del crate (`log::error!` incluidos vía LogTracer), filtra por
  target (`app_lib*`; excluye `"frontend"` — anti-bucle —, crates de terceros
  y los módulos del propio camino del outbox — `logging/telemetry/*`,
  `recording_log.rs` — para que un `error!` ahí no se auto-alimente),
  dedupea/capea (20/proceso, gap 2s) y los manda por canal mpsc a una task
  drenadora que los escribe al outbox con `emit_event` (`name` = target Rust,
  `rust_ts_ms` = epoch ms del lado Rust para correlacionar contra maity.log,
  `dedup_key` = la del limiter sin la elipsis del JS, `seq` = nº de envío,
  `session_uptime_s` desde el init del logging; `pathname`/`stack`/
  `component_stack` = null). Columna `session_id` = `proc-…`,
  `ctx.emitter='rust'`. Hasta 0.2.59 la drenadora emitía el evento Tauri
  `rust-error` y `errorTelemetry.ts` lo reenviaba: con la ventana en tray
  WebView2 dormía (6 de 8 ERROR del piloto del 2026-09-10 perdidos) y los
  pre-listener también se perdían — ambos huecos cerrados. Gaps que quedan: el
  fallback `fmt::init()` de main.rs no lleva el layer; los ERROR pre-`AppState`
  se descartan con `warn!`; los panics no pasan por tracing (los sube `panics.rs`).

- `rust-panic` (ago-2026, ciclo v0.2.57): `telemetry/panics.rs` encadena un
  `panic::set_hook` al de main.rs (que sigue en Sentry) y escribe el panic a un
  `.jsonl` **síncrono** en disco (el proceso se muere; nada de red ni tracing
  dentro del hook — regla anti-reentrada); en el siguiente arranque se importa
  al outbox y `drain.rs` lo sube como `app.error` con `source:"rust-panic"`.

**Presupuesto por fuente, no compartido (ago-2026):** `window 8 ·
unhandledrejection 8 · error-boundary 5 · db-init 3` en el JS; los ERROR de
Rust ya no pasan por ese limiter (desde sep-2026 van al outbox con su propio
`BridgeLimiter`: 20/proceso, gap 2s, message 1000). Antes era un cupo único
de 20 y un render-loop de React se lo comía tirando los ERROR de Rust que ya
habían pagado la barrera de #60 (anti *noisy neighbor*). Dedup por
`name:message[:120]`, gap mínimo 2s, truncado (message 500 / stack 1500 /
componentStack 1000).

**Los limiters ya no son mudos:** `BridgeLimiter` (Rust) y `ErrorReportLimiter`
(JS) exponen `{sent, dropped_dedup, dropped_cap, dropped_gap, dropped_channel}`
— invariante `sent + Σdropped == intentos` — y viajan como `err_budget` en cada
`health.heartbeat` (contadores **monótonos por sesión** → en SQL, `max()` por
sesión y luego sumar). **Ojo con `err_budget.rust` desde el doble emisor
(sep-2026):** ese contador es del proceso y lo publican LOS DOS latidos (el JS
lo reenvía dentro del snapshot), pero bajo columnas `session_id` distintas
(`desktop-…` vs `proc-…`) — hacer `max()` por esa columna y sumar cuenta el
mismo presupuesto dos veces. Agrupar por `event_data->'ctx'->>'session_id'` (id
de proceso) o restringir a `emitter='webview'`.

El dedup de Rust pasó de `BTreeSet` a `BTreeMap<String,u32>`
y publica `{top_suppressed ×3, suppressed_total}` (conteos, no texto). Gotcha
arreglado: el dedup miraba lo VISTO, no lo ENVIADO — un drop por gap
envenenaba el dedup y el primer error de cada ráfaga se perdía para siempre.

**Cardinalidad (`device.profile` vs heartbeat):** las dimensiones estáticas
(`cpu_cores`, `gpu_type`, `memory_gb`, `os_version`, `arch`, `build_channel`)
van SOLO en `device.profile` (1×/sesión) — repetirlas ×469 heartbeats es peso
muerto. Excepción deliberada: `performance_tier` va en ambos (4 valores, es el
slice-by más frecuente: "¿la fuga es solo en tier Low?"). Que no sea la puerta
para las otras 8. Segunda excepción deliberada (0.2.62, #83): `idle_reason` y
el bloque `jornada` del latido son estado DINÁMICO (cambian durante el día), y
un perfil 1×/sesión no dice a qué hora dejó de grabar. El horario estático
(días/horas) NO se repite en el latido: vive en `device.profile.jornada` y en
`jornada.settings_changed`. Beneficio: antes esos datos solo viajaban en
`coach.session_summary` — una usuaria que nunca abre el coach era invisible.
`ErrorTelemetryInitializer` se monta FUERA de ErrorBoundary/AuthGate
(invariante en `layout.test.ts`) para capturar errores pre-auth y sobrevivir
al fallback del boundary; solo la ventana principal lo monta (las aux cuelgan
del root layout de `app/(aux)`, sin initializers). Los ERROR de Rust ya no
dependen de ningún webview (van al outbox). Hook en
`logger.error`: descartado definitivamente (#63 cerrado como no-planeado).

`event_data`: `{source, name, message, stack, component_stack, pathname,
dedup_key, seq, session_uptime_s}` + columna `error` = message. En
`source:"rust"` se añade `rust_ts_ms` y `stack`/`component_stack`/`pathname`
van `null` (el JS ya no manda `rust_ts_ms`).

## Nivel 3: logs locales (Rust)

- **Log rotativo** (`logging/file_logger.rs`): todo `tracing`/`log` de Rust +
  lo que el frontend manda por `log_frontend_event`.
- **`[METRIC] mem-sample`** (`logging/mem_sampler.rs`, del ciclo RAM 0.2.53;
  cadencia por fase desde sep-2026): **30 s grabando / 60 s en idle**, RSS por
  proceso + `cpu_pct` (sistema) + `proc_cpu_pct` (Maity, ×nb_cpus) + lag;
  snapshots extra en 8 call sites de alta señal, con **8 valores distintos de
  `reason`** (los que se grepean en el log): `recording-start`,
  `recording-stop`, `post-stop-60s`, `post-stop-120s`, `transcription-backlog`,
  `onnx-recycle`, `sidecar-timeout-strikes` y `sidecar-timeout-legacy`.
  El refresh de procesos pide un `ProcessRefreshKind` **ligero** (solo
  `with_memory()`): `name`/`parent` salen del snapshot del OS y no dependen del
  kind, así que el sampler dejó de pagar `GetProcessIoCounters` y
  `GetProcessTimes`+`GetSystemTimes` sobre ~300 procesos **en cada tick** (más
  `GetModuleFileNameExW`, que con el kind viejo era `with_exe(OnlyIfNotSet)`:
  1× por proceso NUEVO, no por tick).
  **Gotchas de implementación (#14, sep-2026):** en sysinfo 0.32.1
  `ProcessRefreshKind::nothing()` NO existe (es 0.33+): el constructor vacío es
  `new()`. `refresh_memory()`/`refresh_cpu_usage()` se mantienen —
  `global_cpu_usage()` viene de la query PDH, no del refresh de procesos. La
  cadencia por fase se implementa con `tokio::time::sleep(next_interval(phase))`
  porque tokio 1.49 no tiene `Interval::set_period`. **Regla derivada:** ninguna
  semántica puede volver a contarse en TICKS — la presión sostenida pasó de
  `PRESSURE_SUSTAINED_SAMPLES` a `PRESSURE_SUSTAINED_SECS = 60` medida con
  `Instant`, porque "2 ticks" valdría 60 s grabando y 120 s en idle y el texto
  del incidente mentiría en silencio. `cpu_pct` (sistema) **no se reinterpreta**:
  el CPU propio entró como campo NUEVO `proc_cpu_pct` (×nb_cpus, 100 % = un
  core) para no romper las series históricas.
  Warnings con umbral y rate-limit 10 min (`sidecar-pool-multiple`,
  `app-rss-critical`, `system-memory-pressure`...).
  **Nivel de presión consultable (#22, sep-2026):** el mismo loop publica
  `mem_sampler::pressure_level()` (`Normal | Elevated | Critical`, `AtomicU8`) con
  histéresis doble — subir a `Elevated` exige avail bajo umbral sostenido ≥60 s
  (la MISMA racha del incidente); `Critical` es inmediato (RSS crítico o avail
  bajo la mitad del umbral); **bajar** exige avail > umbral+300 MB sostenido
  ≥60 s, y un `Critical` sin recuperación completa decae a `Elevated`, no a
  `Normal`. Cada transición deja UNA línea `[MEM] pressure-level: a->b` con clave
  sin números (las cifras cambiantes se comían plazas de `app.error`).
  Consumidores actuales: el warmup del sidecar se salta con `Elevated+` (o con
  avail bajo umbral en el arranque, sample fresco), `call_ollama_and_emit` cede
  el tick LLM del coach, y el `idle_unload` del STT descarga sin esperar los
  10 min. Staleness ≤ la cadencia de la fase (60 s en idle): apto para
  decisiones de minutos, no de milisegundos. Antes del primer tick devuelve
  `Normal` (fail-open: sin datos no se bloquea nada).
- **Export**: Settings → Logging → Export (`export_logs`) genera ZIP con logs +
  `system_info.txt` + `recording_lifecycle_logs.json` (SQLite).
- **Bundle de incidente con consentimiento** (#61, ago-2026;
  `logging/incident.rs`): la excepción CONSENTIDA a "los logs crudos no van a la
  nube". Cuando Rust detecta un umbral crítico, un panic del proceso anterior o
  el usuario lo pide, la main muestra "¿Enviar diagnóstico a Maity?"
  (`components/incident/IncidentReportDialog.tsx`) y, solo si acepta, sube a
  Supabase Storage (bucket privado `incident-bundles`, contrato en
  `docs/incident-bundles-bucket.sql`, ruta `{auth_uid}/{YYYYMMDD-HHMMSS}-{kind}-{proc}.txt`)
  un `.txt` con: cabecera JSON (`ctx`, `device`, último `mem-sample`, picos,
  fase, lag) + `system_info` + **tail ≤200 KB** del log rotativo (por `seek`,
  archivo más nuevo y, si sobra presupuesto, el anterior). Sin audio, sin
  transcripciones, sin SQLite. **Nunca automático, nunca reintentos** (bucket
  ausente → error corto al usuario; el ZIP local sigue disponible).
  - Triggers (`kind`): `app-rss-critical` (>4000 MB RSS, inmediato),
    `system-memory-pressure` (<1024 MB disponibles **sostenido ≥60 s reales**,
    ventana medida con `Instant` desde el primer sample bajo umbral — ya NO es
    un conteo de ticks: con la cadencia por fase "2 ticks" valdría 60 s
    grabando y 120 s en idle; un pico de un tick no pregunta), `rust-panic`
    (al arranque siguiente, desde
    `panics.rs::import_pending`), `manual` (Ajustes → Diagnóstico y Soporte →
    "Enviar diagnóstico").
  - Dedupe (`incident::arm`): 1 prompt por `kind` por proceso + cooldown
    **7 días** por `kind` persistido en `incident-prefs.json` + "No volver a
    preguntar" (`never_ask`, no aplica al manual). Con 331 avisos de presión en
    30 días (16 usuarias) sin esto el diálogo sería spam.
  - Transporte push+pull: `incident-detected` (evento Tauri) **y** slot
    `take_pending_incident` — WebView2 suspende el JS con la ventana oculta
    (tray/jornada) y el push se pierde; el diálogo hace pull al montar y en
    `visibilitychange`.
  - Eventos: `incident.detected` (`{kind, message, detail}`, al armar),
    `incident.bundle_uploaded` (`{kind, object_path, bytes}`) e
    `incident.upload_failed` (`{kind, status, code, message}`; `status: 0` +
    `code: "network"` cuando no hubo respuesta). Los tres vía el outbox
    (`emit_event` → `drain.rs`, single-writer). Columna `status`: `warning` en
    `detected` y `upload_failed`, `ok` en `bundle_uploaded`. Tasa de aceptación =
    `detected` sin `bundle_uploaded` NI `upload_failed`; antes del tercero
    (2026-09-10) "declinó" y "falló" se veían igual y el primer bundle real
    falló sin que la nube lo supiera. **Esa tasa estuvo estructuralmente vacía
    hasta el 2026-09-11**: los tres eventos violaban el CHECK de `status` y el
    RPC los tragaba (ver gotcha del `status`).
  - Identidad: la carpeta es `auth.uid()` (claim `sub` del JWT que decodifica
    Rust), NO `maity.users.id` — es lo que compara la policy RLS.
  - **`Content-Type` SIN parámetros** (`incident::BUNDLE_CONTENT_TYPE` =
    `text/plain`): Storage compara el subtipo LITERAL contra
    `allowed_mime_types`, así que `text/plain; charset=utf-8` es un 415
    `InvalidMimeType` envuelto en HTTP 400 — y el cliente lo traducía como
    "destino no disponible". El test
    `content_type_esta_en_el_contrato_del_bucket` lee el SQL del contrato y
    falla si la constante no está listada tal cual. El mensaje al usuario
    manda por el `code` del cuerpo (`upload_error_message(status, body)`); el
    status HTTP es solo fallback. El bucket también lista
    `text/plain; charset=utf-8` mientras viva el build piloto 0.2.59.

## Queries de análisis (listas para pegar)

Serie de tiempo de RAM — LA query para cazar fugas:

```sql
select created_at, session_id, app_version,
       -- 'webview' = heartbeat del JS · 'rust' = latido nativo del mem_sampler.
       -- La COLUMNA session_id ya difiere entre ambos (desktop-… vs proc-…), así
       -- que un proceso aparece como DOS series; emitter es la etiqueta que las
       -- explica. Para unirlas: event_data->'ctx'->>'session_id'.
       event_data->'ctx'->>'emitter' as emitter,
       (event_data->'mem'->>'app_rss_mb')::int  as app_mb,
       (event_data->'mem'->>'llama_rss_mb')::int as llama_mb,
       (event_data->'mem'->>'webview_rss_mb')::int as webview_mb,
       (event_data->'mem'->>'proc_cpu_pct')::float as proc_cpu_pct, -- ×nb_cpus: 100 = 1 core
       event_data->>'phase' as phase, event_data->>'reason' as reason
from maity.platform_logs
where platform='desktop' and event_type='health.heartbeat'
  and created_at > now() - interval '7 days'
order by emitter, session_id, created_at;
```

Pendiente de crecimiento por versión (¿la versión X arregló la fuga?):

```sql
select app_version,
       event_data->'ctx'->>'emitter' as emitter,
       event_data->'ctx'->>'install_id' as install_id,
       session_id,
       max((event_data->'mem'->>'app_rss_mb')::int) -
       min((event_data->'mem'->>'app_rss_mb')::int) as growth_mb,
       count(*) as beats
from maity.platform_logs
where platform='desktop' and event_type='health.heartbeat'
group by 1, 2, 3, 4 having count(*) >= 3 order by growth_mb desc;
```

> La COLUMNA `session_id` del latido nativo es el id de PROCESO
> (`proc-<epoch>-<rand>`) y la del JS es la suya (`desktop-…`). Son valores
> distintos, así que esta query devuelve **dos filas por proceso** (una por
> emisor) aunque no se agrupe por `emitter`: la segmentación no evita ninguna
> mezcla, solo etiqueta lo que ya viene partido. Para el crecimiento del proceso
> COMPLETO hay que agrupar por `event_data->'ctx'->>'session_id'`, que sí es el
> mismo en ambos emisores. Para "¿hubo jornada sin webview?":
> `emitter='rust' and reason='native'` — cada fila es 15 min de app viva con el
> frontend suspendido.

¿La app se abre sola? — autostart por usuario (caso Dingler sep-2026: "no se
abre sola" era indistinguible de "la abren a mano"). Una fila por instalación
con su último perfil; `started_at_boot=false` recurrente + `autostart_state`
`enabled` = arranca a mano aunque el mecanismo esté bien (¿boot lento? ¿la
cierran?); `disabledByUser` = apagado en Task Manager (la app no puede
reactivarlo — toca guiar al usuario a `ms-settings:startupapps`):

```sql
select distinct on (pl.event_data->'ctx'->>'install_id')
       u.email,
       pl.created_at,
       pl.app_version,
       pl.event_data->>'build_channel'    as canal,
       pl.event_data->>'started_at_boot'  as arranco_al_boot,
       pl.event_data->>'autostart_state'  as autostart,
       pl.event_data->>'signature_kind'   as firma -- desde 0.2.62; developer = la Store no la actualiza
from maity.platform_logs pl
join maity.users u on u.id = pl.user_id
where pl.platform = 'desktop' and pl.event_type = 'device.profile'
  and pl.created_at > now() - interval '30 days'
  -- opcional: and u.company_id = '<company_id>'
order by pl.event_data->'ctx'->>'install_id', pl.created_at desc;
```

**¿Por qué no grabó? — persona × día hábil (#83)**

Reglas de lectura:
- (a) La hora del evento es `coalesce(ctx.occurred_at, created_at)`: 295 filas desktop de 30 días (pre-0.2.57) no traen `occurred_at`, y `app.exit` se drena al día siguiente.
- (b) La atribución es `user_id in (u.id, u.auth_id)`, pero `event_data->>'maity_user_id'` gana cuando existe (`auth.*`).
- (c) Las versiones se comparan como `int[]`, nunca como texto.
- (d) Dedupe por `(ctx.session_id, event_type, ctx.occurred_at)`.
- (e) La línea de tiempo preferente es `jornada.idle_reason_changed`: va por el outbox, sobrevive sin red y se pondera en segundos dentro del día. Después vienen los latidos, porque el latido JS no se encola sin red.
- (f) "Sesión de Maity cerrada" SOLO cuando hay `auth.logout`/`auth.session_lost` o `idle_reason='no_session'`. Nunca por "no hubo latido".
- (g) Una causa explícita previa (logout, `tray_quit`, update) gana a "posible desinstalación". Esa etiqueta solo queda para ≥ 7 días de silencio hasta hoy sin ningún evento ni conversación posterior, y no se puede probar.
- (h) El fallback de versión es `not ant_nueva`: la salida anterior a un día sin señal es de una versión sin eventos de salida.
- (i) `days_of_week` solo cuenta si `windows_count = 1`. `in_window` ya considera todas las ventanas.
- (j) Si el mismo proceso sigue vivo al día siguiente, o hay un `app.resumed` que cubre el día, la causa es "PC suspendida".
- (k) En días que grabaron, `motivo_parcial` = `pausada` / `detenida por el usuario` / `cerrada temprano` (10 min o más en ese estado, o salida por la bandeja ese día).
- (l) El día es CDMX, pero `in_window` se calcula en la PC con su propia hora local.
- (m) Las causas posibles son: grabó, grabó parcial, jornada sin configurar, jornada apagada, fuera de horario, sin micrófono / permiso, pausada, detenida por el usuario, cerrada por el usuario, sesión de Maity cerrada, registro incompleto, PC apagada / suspendida / sin sesión de Windows, sin arranque con Windows, cerrada para actualizar, crash / cierre forzado, falla al arrancar, posible desinstalación, versión < 0.2.62 y silencio reciente. Hay además dos cajones residuales: "abierta sin grabar (…)" y "sin señal (causa no identificada)".
- (n) Validada en prod el 2026-09-23 (solo SELECT) con Dingler, del 1 al 23 de sep: sin datos de 0.2.62 todo cae en los cajones legacy.

```sql
with p as (
  select '<company_id>'::uuid company_id, 'America/Mexico_City'::text tz,
         date '2026-09-01' d_desde, date '2026-09-23' d_hasta,
         array[date '2026-09-16']::date[] feriados,   -- días inhábiles (16-sep, 3er lunes de nov, 25-dic…)
         array['karen','rita']::text[] excluir,       -- managers (ej. Dingler): nombre de pila en minúscula
         array[0,2,62] v_nueva,                       -- primera versión con los eventos de #83
         interval '30 days' lookback,                 -- cuánto mirar atrás para el último estado conocido
         interval '7 days' silencio_desinstalacion
),
team as (
  select u.id, u.auth_id, initcap(split_part(trim(u.first_name),' ',1)) nombre
  from maity.users u, p
  where u.company_id = p.company_id
    and lower(split_part(trim(u.first_name),' ',1)) <> all (p.excluir)
),
raw as (
  select l.id, l.user_id, l.event_type, l.event_data, l.app_version, l.created_at
  from maity.platform_logs l, p
  where l.platform = 'desktop'
    and l.created_at >= (p.d_desde::timestamp at time zone p.tz) - p.lookback
),
ev0 as (
  -- atribución: maity_user_id del payload (auth.*) gana a la columna user_id (RPC al drenar)
  select t.id uid, r.event_type et, r.event_data d,
         r.event_data->'ctx'->>'session_id' sid,
         coalesce((r.event_data->'ctx'->>'occurred_at')::timestamptz, r.created_at) ts,
         coalesce(string_to_array(substring(coalesce(nullif(r.app_version,'unknown'), r.event_data->'ctx'->>'app_version')
                  from '^[0-9]+\.[0-9]+\.[0-9]+'), '.')::int[], array[0]) >= p.v_nueva nueva,
         row_number() over (partition by t.id, r.event_data->'ctx'->>'session_id', r.event_type,
                                         r.event_data->'ctx'->>'occurred_at',
                                         case when r.event_data->'ctx'->>'occurred_at' is null then r.id end
                            order by r.id) rn
  from raw r cross join p
  join team t on case when r.event_data->>'maity_user_id' is not null
                      then r.event_data->>'maity_user_id' = t.id::text
                      else r.user_id in (t.id, t.auth_id) end
),
ev as (   -- dedupe por (ctx.session_id, event_type, ctx.occurred_at)
  select uid, et, d, sid, ts, nueva,
         case when et = 'jornada.idle_reason_changed' then d->>'to'
              when et = 'health.heartbeat' then d->>'idle_reason' end ir
  from ev0 where rn = 1
),
tl as (   -- línea de tiempo del motivo: transiciones del outbox, cortadas por arranques y salidas
  select uid, sid, ts s0, ir, lead(ts) over (partition by uid order by ts) s1
  from ev where et in ('jornada.idle_reason_changed', 'app.start', 'app.exit')
),
dias as (
  select d::date dia, (d::date::timestamp at time zone p.tz) t0,
         ((d::date + 1)::timestamp at time zone p.tz) t1, extract(isodow from d)::int dow
  from p, generate_series(p.d_desde, p.d_hasta, interval '1 day') d
  where extract(isodow from d) <= 5 and d::date <> all (p.feriados)
),
conv as (
  select c.user_id uid, (c.started_at at time zone p.tz)::date dia, count(*) n
  from maity.omi_conversations c join team t on t.id = c.user_id cross join p
  where c.started_at >= (p.d_desde::timestamp at time zone p.tz)
    and c.started_at <  ((p.d_hasta + 1)::timestamp at time zone p.tz)
    and not coalesce(c.deleted, false) and not coalesce(c.discarded, false)
  group by 1, 2
),
f as (
  select t.id uid, t.nombre, d.dia, d.dow, coalesce(cv.n, 0) conv_n, x.*, tw.*,
         ant.ts ant_ts, coalesce(ant.nueva, false) ant_nueva,
         hb_ant.ts hb_ant_ts, lo_ant.ts logout_ant_ts, ir_ant.ir ir_ant,
         coalesce(sig.d->>'prev_exit_reason',
                  case when sal_ant.et = 'app.exit' then sal_ant.d->>'reason' end) prev_salida,
         (vivo.x is not null) vivo_todo_el_dia, (susp.x is not null) suspendida,
         aut.estado autostart, jor.j horario, (post.x is not null) hay_senal_despues
  from team t cross join dias d
  left join conv cv on cv.uid = t.id and cv.dia = d.dia
  cross join lateral (
    select count(*) n_ev,
           count(*) filter (where e.et = 'recording_started') rec_started,
           count(*) filter (where e.et = 'recording.segment_discarded') seg_desc,
           count(*) filter (where e.et = 'health.heartbeat') hb,
           count(*) filter (where e.et = 'health.heartbeat' and e.d->>'phase' in ('recording','starting','stopping')) hb_rec,
           count(*) filter (where e.et = 'health.heartbeat' and e.d->>'phase' = 'paused') hb_pausa,
           mode() within group (order by e.ir)
             filter (where e.et = 'health.heartbeat' and e.ir not in ('pending','initializing')) motivo_hb,
           count(*) filter (where e.et = 'recording_start_failed'
                              and e.d->>'code' in ('mic_not_found','mic_permission_denied')) fallo_mic,
           count(*) filter (where e.et = 'recording_start_failed'
                              and coalesce(e.d->>'code','') not in ('mic_not_found','mic_permission_denied')) fallo_arranque,
           count(*) filter (where e.et in ('auth.logout','auth.session_lost')) logout,
           (array_agg(e.d->>'reason' order by e.ts desc) filter (where e.et = 'app.exit'))[1] salida_dia,
           count(*) filter (where e.et = 'app.start'
                              and e.d->>'prev_exit_reason' in ('unclean','crash_panic')) arranque_sucio,
           count(*) filter (where e.et = 'app.resumed') resumed,
           coalesce(bool_or(e.nueva), false) nueva
    from ev e where e.uid = t.id and e.ts >= d.t0 and e.ts < d.t1
  ) x
  left join lateral (   -- segundos por idle_reason dentro del día (solo tramos de un proceso vivo ese día)
    select (array_agg(z.ir order by z.secs desc))[1] motivo_tl,
           coalesce(sum(z.secs) filter (where z.ir = 'paused_by_user'), 0) s_pausa,
           coalesce(sum(z.secs) filter (where z.ir = 'stopped_by_user'), 0) s_detenida,
           coalesce(sum(z.secs) filter (where z.ir = 'closed_for_day'), 0) s_cerrada
    from (select s.ir, sum(extract(epoch from least(coalesce(s.s1, now()), d.t1) - greatest(s.s0, d.t0))) secs
          from tl s
          where s.uid = t.id and s.ir is not null and s.ir not in ('pending','initializing')
            and s.s0 < d.t1 and coalesce(s.s1, now()) > d.t0
            and (s.s0 >= d.t0 or exists (select 1 from ev e2 where e2.uid = t.id and e2.sid = s.sid
                                                        and e2.ts >= d.t0 and e2.ts < d.t1))
          group by s.ir) z
  ) tw on true
  left join lateral (select e.ts, e.nueva, e.sid from ev e where e.uid = t.id and e.ts < d.t0
                     order by e.ts desc limit 1) ant on true
  left join lateral (select max(e.ts) ts from ev e where e.uid = t.id and e.ts < d.t0
                       and e.et = 'health.heartbeat') hb_ant on true
  left join lateral (select max(e.ts) ts from ev e where e.uid = t.id and e.ts < d.t0
                       and e.et in ('auth.logout','auth.session_lost')) lo_ant on true
  left join lateral (select e.ir from ev e where e.uid = t.id and e.ts < d.t0
                       and e.et = 'jornada.idle_reason_changed' order by e.ts desc limit 1) ir_ant on true
  left join lateral (select e.et, e.d from ev e where e.uid = t.id and e.ts < d.t0
                       and e.et in ('app.start','app.exit') order by e.ts desc limit 1) sal_ant on true
  left join lateral (select e.d from ev e where e.uid = t.id and e.ts >= d.t0 and e.et = 'app.start'
                     order by e.ts limit 1) sig on true
  left join lateral (   -- el mismo proceso siguió vivo todo el día (mismo ctx.session_id después, o su marcador)
    select 1 x from ev e where e.uid = t.id and e.sid = ant.sid and e.ts >= d.t1
    union all
    select 1 from ev e where e.uid = t.id and e.et = 'app.start' and e.ts >= d.t1
      and e.d->>'prev_session_id' = ant.sid and (e.d->>'prev_last_alive_at')::timestamptz >= d.t1
    limit 1) vivo on true
  left join lateral (select 1 x from ev e where e.uid = t.id and e.et = 'app.resumed'
                       and (e.d->>'suspended_at')::timestamptz < d.t1
                       and (e.d->>'resumed_at')::timestamptz > d.t0 limit 1) susp on true
  left join lateral (select coalesce(e.d->>'to', e.d->>'autostart_state') estado from ev e
                     where e.uid = t.id and e.ts < d.t1
                       and (e.et = 'autostart.changed' or e.d ? 'autostart_state')
                     order by e.ts desc limit 1) aut on true
  left join lateral (select coalesce(e.d->'to', e.d->'jornada') j from ev e
                     where e.uid = t.id and e.ts < d.t1
                       and (e.et = 'jornada.settings_changed'
                            or (e.et = 'device.profile' and jsonb_typeof(e.d->'jornada') = 'object'))
                     order by e.ts desc limit 1) jor on true
  left join lateral (select 1 x from ev e where e.uid = t.id and e.ts >= d.t1
                     union all
                     select 1 from maity.omi_conversations c where c.user_id = t.id and c.started_at >= d.t1
                       and not coalesce(c.deleted, false)
                     limit 1) post on true
),
g as (
  select f.*, coalesce(motivo_tl, motivo_hb) motivo,
         case when s_pausa >= 600 or hb_pausa > 0 then 'pausada'
              when s_detenida >= 600 then 'detenida por el usuario'
              when s_cerrada >= 600 or salida_dia = 'tray_quit' then 'cerrada temprano'
         end motivo_parcial
  from f
)
select nombre, dia,
  case
    -- 1) grabó (parcial = pausada / detenida / cerrada temprano)
    when conv_n > 0 or seg_desc > 0 or rec_started > 0 or hb_rec > 0
      then case when motivo_parcial is null then 'grabó' else 'grabó parcial' end
    -- 2) sin ninguna señal ese día: una causa explícita previa gana a "posible desinstalación"
    when n_ev = 0 and (logout_ant_ts > coalesce(hb_ant_ts, '-infinity')
                       or (vivo_todo_el_dia and ir_ant = 'no_session')) then 'sesión de Maity cerrada'
    when n_ev = 0 and prev_salida = 'tray_quit' then 'cerrada por el usuario'
    when n_ev = 0 and prev_salida in ('update','rival_install') then 'cerrada para actualizar'
    when n_ev = 0 and (suspendida or vivo_todo_el_dia) then 'PC apagada / suspendida / sin sesión de Windows'
    when n_ev = 0 and not hay_senal_despues
         and (ant_ts is null or now() - ant_ts >= (select silencio_desinstalacion from p)) then 'posible desinstalación'
    when n_ev = 0 and prev_salida in ('os_session_end','os_restart_unclean','os_session_end_unclean')
      then case when autostart in ('enabled','enabledByPolicy') then 'PC apagada / suspendida / sin sesión de Windows'
                else 'sin arranque con Windows' end
    when n_ev = 0 and prev_salida is not null then 'crash / cierre forzado'
    when n_ev = 0 and not hay_senal_despues then 'silencio reciente'
    when n_ev = 0 and not ant_nueva then 'versión < 0.2.62'
    when n_ev = 0 then 'sin señal (causa no identificada)'
    -- 3) Maity corrió pero no grabó
    when motivo = 'jornada_unconfigured' then 'jornada sin configurar'
    when motivo = 'jornada_off' then 'jornada apagada'
    when motivo in ('outside_window','closed_for_day')
         or (coalesce((horario->>'windows_count')::int, 0) = 1
             and not coalesce(horario->'windows'->0->'days_of_week' @> to_jsonb(dow), true)) then 'fuera de horario'
    when motivo = 'no_session' or logout > 0 then 'sesión de Maity cerrada'
    when motivo = 'no_registration' then 'registro incompleto'
    when motivo in ('mic_not_found','mic_permission_denied') or fallo_mic > 0 then 'sin micrófono / permiso'
    when motivo = 'paused_by_user' or hb_pausa > 0 then 'pausada'
    when motivo = 'stopped_by_user' then 'detenida por el usuario'
    when salida_dia = 'tray_quit' then 'cerrada por el usuario'
    when motivo = 'session_ending' or salida_dia = 'os_session_end' or resumed > 0
      then 'PC apagada / suspendida / sin sesión de Windows'
    when salida_dia = 'update' then 'cerrada para actualizar'
    when arranque_sucio > 0 then 'crash / cierre forzado'
    when motivo in ('mic_in_use','start_failed','scheduler_stopped') or fallo_arranque > 0 then 'falla al arrancar'
    when not nueva then 'versión < 0.2.62'
    when hb = 0 then 'abierta sin grabar (sin latido: sin red)'
    else 'abierta sin grabar (causa no identificada)'
  end causa,
  motivo_parcial, motivo, conv_n, n_ev, hb, hb_rec, hb_pausa, fallo_mic, salida_dia, prev_salida, autostart
from g order by nombre, dia;
```

Resumen por persona: envolverla en `select nombre, causa, count(*) from (…) q group by 1, 2 order by 1, 3 desc`.

Arranques y salidas por versión (#83):
```sql
select app_version, count(*) arranques,
       count(*) filter (where (event_data->>'started_at_boot')::boolean) con_windows,
       count(*) filter (where (event_data->>'prev_exit_clean')::boolean is false) tras_cierre_sucio,
       string_agg(distinct event_data->>'prev_exit_reason', ', ') motivos_previos,
       string_agg(distinct event_data->>'prev_exit_source', ', ') fuentes_previas, -- observed|intent|inferred
       count(*) filter (where (event_data->>'prev_panicked')::boolean) tras_panic,
       count(*) filter (where (event_data->>'version_changed')::boolean) tras_update,
       percentile_disc(0.5) within group (order by (event_data->>'downtime_s')::bigint) downtime_mediana_s
from maity.platform_logs
where platform = 'desktop' and event_type = 'app.start' and created_at > now() - interval '30 days'
group by 1 order by 1 desc;

select app_version, event_data->>'reason' motivo, event_data->>'detail' detalle, count(*) salidas,
       count(*) filter (where (event_data->>'recording_active')::boolean) grabando,
       percentile_disc(0.5) within group (order by (event_data->>'uptime_s')::bigint) uptime_mediana_s
from maity.platform_logs
where platform = 'desktop' and event_type = 'app.exit' and created_at > now() - interval '30 days'
group by 1, 2, 3 order by 1 desc, 4 desc;
```

Top de errores por versión:

```sql
select app_version, event_data->>'dedup_key' as error_key, count(*) as sesiones
from maity.platform_logs
where platform='desktop' and event_type='app.error'
  and created_at > now() - interval '14 days'
group by 1, 2 order by sesiones desc limit 20;
```

## Runbook: "un usuario reporta que Maity traba su máquina"

1. Query de serie de tiempo de RAM filtrada por su `user_id` → ¿`app_rss_mb`
   crece monotónicamente? ¿`llama_procs` > 1 (huérfanos)? ¿`sys_avail_mb`
   colapsa? ¿en qué `phase` crece?
2. `app.error` de sus sesiones → ¿algo truena antes del síntoma?
3. `coach.session_summary` → ¿sidecar_restarts/breaker_opens altos?
   ¿`sidecar_idle_kills > 0` en Medium+? = regresión del lease de #03.
4. Solo si falta detalle: pedirle el Export ZIP (nivel 3) **o** que use
   Ajustes → "Enviar diagnóstico" (bundle en Storage
   `incident-bundles/{auth_uid}/`, ~200 KB de tail; si el incidente fue de RAM
   o panic probablemente ya se le ofreció solo) y leer `[METRIC]`.

## Runbook: "un manager pregunta por qué X no grabó el día Y"

1. Correr la query de persona × día filtrada a esa persona.
2. Si la causa es un cajón "sin señal": mirar el `app.start` siguiente
   (`prev_exit_reason`/`prev_exit_source`, `prev_version`, `downtime_s`,
   `started_at_boot`, `os_rebooted_since_prev`).
3. Si es "crash / cierre forzado": buscar `app.error` con `source=rust-panic`
   del arranque siguiente.
4. Si es "fuera de horario" o "jornada apagada": leer
   `jornada.settings_changed` (quién cambió qué y cuándo) y la línea de tiempo
   de `jornada.idle_reason_changed`.
5. Si es "posible desinstalación": preguntarle al manager, porque nada en la
   nube lo prueba.
6. Si es "versión < 0.2.62": usar la heurística vieja (latidos idle sin fallos
   = jornada apagada o sin horario; pausa y luego silencio = pausada; códigos
   de mic = micrófono).

## Prevención: los lints del pre-build (ago-2026)

| Script (`frontend/scripts/`) | Qué impide |
|---|---|
| `lint-telemetry.js` | (a) `insert_platform_log` fuera de `platformLogger.ts`/`drain.rs`; (b) catálogo TS ≠ Rust (incl. marcador `legacy`); (c) evento nuevo sin punto; (d) `'unknown'` en campos de versión; (e) capability sin `core:app:default`; (f) evento del catálogo sin fila en este doc; (g) `platformLogger.log`/`recordingLogService.log` con literal no catalogado o argumento dinámico. Escape por línea `// telemetry-allow: <razón>` (solo a/d/g). |
| `lint-tauri-acl.js` | Drift entre lo que el código **ejerce** y lo que la ACL **declara**, por ventana: `onCloseRequested` ⇒ `core:window:allow-destroy` (la librería llama `destroy()` si el handler no hace `preventDefault()` — el eslabón invisible que produjo los `app.error` de ACL en 13 usuarias); `.close()` ⇒ `allow-close`; `getVersion()` ⇒ `core:app:default`; `confirm(`/`alert(` ⇒ `dialog:allow-confirm`/`allow-message`. La ventana de un archivo se resuelve por *reachability de imports* desde `app/<aux>/page.tsx`; el root `layout.tsx` es solo-`main` (early-return aux antes de `AppContent`, invariante en `layout.test.ts`). Escape `// acl-allow: <razón>`. |
| `lint-tauri-events.js` | Espejo `events.rs` ↔ `tauri-events.ts` y cero literales inline en `emit`/`listen`. |
| `verify-helper-binary.js` | Sidecar `llama-helper` bundleado ≠ código (SHA-256 vs `cargo build`); ver CLAUDE.md § Gemma. El smoke post-build además le habla (`{"type":"version","id":1}`). |
| `layout.test.ts` (vitest) | `ErrorTelemetryInitializer` fuera de `AuthGate`/`AuthProvider`/`ErrorBoundary`/`DbInitErrorGate` (identidad y captura pre-login/pre-DB); `UpdateCheckProvider` fuera del auth gate; early-return aux antes de `AppContent`. |

## Lo que NO existe todavía

- **Desinstalación**: no hay evento. MSIX no ofrece hook y el uninstaller NSIS
  mata el proceso. Se infiere en la nube: silencio ≥ 7 días sin eventos ni
  conversaciones posteriores y sin causa explícita previa. Con
  `autostart_state=enabled` conocido es casi seguro, porque prender la PC abre
  Maity. Tampoco se distingue "PC apagada" de "no la abrió" cuando el arranque
  con Windows está apagado, ni quién usó una PC compartida (las filas sin
  sesión se atribuyen al siguiente login).
- **Reintentos/cola del bundle de incidente** (#61 se cerró best-effort):
  si Storage falla (sin red, policy, MIME…) el usuario ve el error, se emite
  `incident.upload_failed` y no se reintenta; el prompt automático ya consumió
  su cooldown de 7 días al armarse, así que la vía de reintento es Ajustes →
  "Enviar diagnóstico" (el toast lo dice). El bucket `incident-bundles` existe
  en producción desde el 2026-09-10 (04:15Z; contrato en
  `docs/incident-bundles-bucket.sql`). Tampoco se suben SQLite ni audio, ni
  hay lectura de bundles desde la app.
- ~~**`probe_microphone_access` (B4 del ciclo v0.2.57)**~~ — **HECHO (ago-2026,
  ciclo piloto Dingler).** `audio/devices/discovery.rs::probe_microphone_access`
  abre y suelta un input stream corto y devuelve el `AudioStartError`
  clasificado; se expone como comando `check_microphone_ready` (en
  `spawn_blocking`) que responde el mismo `AudioDeviceErrorPayload` del evento
  `audio-device-error`. `trigger_audio_permission` quedó como wrapper booleano
  encima — una sola implementación. Consumidor: el preflight de la jornada en
  `ScheduledRecordingSettings.tsx`.
  Sigue **prohibido** llamarla desde `initialize_recording` (un
  `build_input_stream` extra en el arranque toca el pipeline de audio) **y desde
  cualquier bucle**: en particular NO se metió en `usePermissionCheck`, que hace
  poll cada 5 s mientras no encuentra micrófono — ahí cambiaría una tormenta de
  telemetría por una de audio, en la misma máquina que la sufría.
- **Versión del helper en la nube:** desde 0.2.57 `sidecar.rs` loguea
  `Sidecar helper vX (protocol N)` al spawn (nivel 3, local). Subirla a
  `coach.session_summary` sería una línea más; no se hizo para no ampliar el
  payload sin una pregunta concreta que responder.
- **`Analytics.track` fuera del catálogo** (ver inventario): entra por la regla
  de 3 entradas el día que se quiera analizar.

Resueltos en el ciclo 0.2.62 (#83). Telemetría: el ciclo de vida del proceso
sale de un marcador síncrono en disco (`app.start`/`app.exit`/`app.resumed`;
sobrevive a que Windows mate el proceso antes del outbox); `idle_reason` y el
bloque `jornada` van en ambos latidos, con `jornada.idle_reason_changed` por el
outbox como línea de tiempo preferente; `device.profile.jornada` y
`jornada.settings_changed` cubren el horario estático; el autostart real del
canal directo (`disabledByUser` cuando Task Manager lo apaga) se reporta con
`autostart.changed`; `package_installed_at`; `auth.logout` desde Rust y
`auth.session_lost` solo en pérdidas reales (nunca por red caída); el outbox
drena por fila (sin duplicados) y `flush_row` sube la fila de salida con el
token de quien sale. Arreglos que esa telemetría hace visibles:
- El logout del sidebar del chat ya pasa por `AuthContext.signOut` →
  `logout_cleanup` (antes se saltaba el guardado de la grabación).
- El update NSIS va por `direct_update_install`: se niega con grabación o
  post-proceso y cierra DB y sidecar antes de que el plugin salga.
- Salir, cerrar sesión o apagar ya no suprimen la jornada hasta medianoche; el
  cierre automático avisa "día cerrado" y el turno nocturno conserva sus horas
  antes de medianoche.
- El paro del usuario y el día cerrado se persisten entre reinicios
  (`scheduled_recording_runtime.json`).
- "Evaluar ahora" evalúa en el acto (`reset_immediately`).
- El fin de sesión de Windows con grabación activa va acotado a < 5 s
  (`lib.rs::run_session_end_exit`).
- Recargar el webview ya no suelta al usuario en Rust
  (`lib/authRelease.ts::shouldReleaseRustUser`).
- Una sesión perdida a media grabación guarda el segmento
  (`session_lost_cleanup`) antes de `clear_current_user`.
- La recuperación de checkpoints tolera chunks truncados: los excluye y los
  renombra a `.mp4.bad`, sin borrar audio.

Resueltos en el ciclo sep-2026 (v0.2.60): dominio cerrado de `status`
(`TelemetryStatus` + contrato `docs/platform-logs-status.sql` + re-drenado de
las filas que el CHECK rechazó en silencio — `stt.*`, `audio.*` e `incident.*`
llevaban 0 filas all-time); `coach.session_summary` y el puente de ERROR de
Rust emitidos desde Rust por el outbox (sobreviven al webview dormido en tray:
8 de 9 summaries y 6 de 8 ERROR del día piloto se habían perdido) y sin filas
fantasma del coach al arrancar.

Resueltos en el ciclo ago-2026 (v0.2.57): panics a la nube (`rust-panic`,
arriba); ciclo de vida de grabación desde Rust con `trigger` y dispositivo real
(el punto ciego principal: la jornada arranca headless); `app_version` honesto
(`'unknown'` fuera; NULL cuando no resuelve); `session_id` único de proceso;
drenadora nativa única; contadores de descarte y presupuesto por fuente.

Resueltos en el ciclo jul-31: Rust ERROR→DB (#60, puente `rust-error`); gate
de ventanas aux en initializers (#62 — el "triple worker" no existía, era la
lista de rutas triplicada); hook en `logger.error` (#63, cerrado como
no-planeado: 5 call-sites, cobertura ya dada por window handlers + #60).
