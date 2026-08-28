# Telemetría y diagnóstico remoto — inventario completo

> Última actualización: 2026-08-17 (ciclo v0.2.57 "fail-closed": contrato `ctx`
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
1. **JS directo:** `platformLogger` (`frontend/src/lib/platformLogger.ts`) →
   RPC `public.insert_platform_log` (SECURITY DEFINER; resuelve `user_id` desde
   `maity.users WHERE auth_id = auth.uid()`; traga excepciones — nunca rompe la
   app) → tabla `maity.platform_logs`. Lo usan `app.*`, `nav.*`, `health.*`,
   `device.profile`, `coach.session_summary` y el passthrough de `Analytics.track`.
2. **Outbox nativo (store-and-forward):** `telemetry::emit` (Rust) y
   `recordingLogService.log` (JS, vía comando) escriben al outbox SQLite
   `recording_logs` — cero red en el camino caliente, sobrevive crash,
   suspensión y **webview cerrado** (jornada/tray). La **única drenadora es
   `logging/telemetry/drain.rs`**: tick 30 s + `Notify`, `get_unsynced_logs(50)`
   → `get_valid_token` (sin sesión ⇒ diferir sin quemar intentos) → POST al
   mismo RPC → solo 2xx marca `synced_to_cloud`. `syncToCloud()` de JS se
   eliminó (ago-2026): dos drenadores = filas duplicadas.

Columnas útiles: `user_id`, `session_id`, `platform` (`'desktop'` | web),
`event_type`, `event_data` (jsonb, con el envelope `ctx` de abajo), `status`,
`error`, `app_version`, `device_info` (userAgent), `created_at` (hora de
inserción — el momento real del evento es `ctx.occurred_at`).

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

**App / salud — emisor `platformLogger` (JS) salvo donde se indica.**

| event_type | Quién lo emite | Cuándo | Payload clave |
|---|---|---|---|
| `app.open` / `app.close` | `layout.tsx` (`AppContent`) | arranque / cierre de la ventana main | — |
| `nav.page_view` | `usePageViewTracker` | cada navegación | ruta |
| `device.profile` | `healthHeartbeatService.start()` (comando `get_device_profile`) | **1× por sesión** | `cpu_cores`, `gpu_type`, `memory_gb`, `os`, `os_version`, `arch`, `build_channel`, `performance_tier` — *resource attributes*, NO se repiten en cada heartbeat (ver cardinalidad abajo) |
| `health.heartbeat` | `healthHeartbeatService` | cada 5 min activo / 15 min idle + start/stop de grabación | ver abajo (+ `err_budget`, `performance_tier`) |
| `coach.session_summary` | `useCoachMetricsTelemetry` (evento Rust `coach-metrics`) | al cerrar sesión de coach | métricas LLM + sidecar (timeouts, restarts, breaker) + picos de RAM + tier |
| `app.error` | `errorTelemetry` (JS) y **`telemetry/panics.rs` (Rust, `source:"rust-panic"`)** | error no manejado / boundary / panic (al outbox; se drena en el siguiente arranque) | ver abajo |

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
stub de PostHog) es analítica de producto de la UI (`coach_float.*`,
`preferences_viewed`, `microphone_selected`, …) con passthrough a
`platform_logs`; se documenta como esta única fila y el lint lo exime con
`// telemetry-allow:`. Si algún día se quiere inventariar, entra por la regla de
3 entradas.

### `health.heartbeat` (nuevo, jul-2026)

Fuente Rust: comando `get_health_snapshot` (`logging/commands.rs`) — UNA
invocación IPC que junta: el último `MemSample` del sampler periódico de 30s
(`logging/mem_sampler.rs`, costo ~0, `cpu_pct` real), fase de grabación
(`recording_phase`, lock-free) y lag de transcripción (AtomicU64).

`event_data`:

```jsonc
{
  "reason": "initial | interval | recording-start | recording-stop",
  "phase": "idle | starting | recording | paused | stopping",
  "uptime_s": 3600,            // desde el arranque del heartbeat (post-auth)
  "seq": 12,                   // contador por sesión; gaps delatan sleep del laptop
  "mem": {                     // MemSample del sampler (null si aún no hay tick)
    "app_rss_mb": 512,         // RSS del proceso maity-desktop
    "llama_rss_mb": 1024,      // suma de llama-helper por NOMBRE (caza huérfanos)
    "llama_procs": 1,
    "webview_rss_mb": 300,     // solo WebView2 con ancestro maity
    "webview_procs": 4,
    "ffmpeg_procs": 0,
    "sys_avail_mb": 8000, "sys_total_mb": 16000,
    "cpu_pct": 12.5
  },
  "mem_sample_age_s": 7,       // null = fallback fresco (cpu_pct sale 0)
  "peaks": { ... },            // SessionPeaks; OJO: el coach los resetea por sesión
  "lag_seconds": 0,
  "queue": { ... } | null      // último transcription-lag-update (6 campos); null en idle
}
```

Diseño: un solo interval de 5 min; la cadencia real la decide
`shouldEmitHeartbeat` por timestamps (sleep-safe: tras resume emite UNA vez).
Gate de sesión Supabase por tick (sin login → cero RPCs). Solo la ventana
principal lo corre (`isAuxWindowPath` excluye coach-float/recording-widget/
device-picker). Sin retry offline: un heartbeat perdido no se encola (mentiría
sobre `created_at`).

### `app.error` (jul-2026)

Fuentes (`frontend/src/lib/errorTelemetry.ts`):
- `window` / `unhandledrejection`: handlers globales (los rechazos de
  `invoke()` Rust llegan como strings → `name: 'UnhandledRejection'`).
- `error-boundary`: `ErrorBoundary.componentDidCatch`.
- `db-init` (jul-31, issue #64): `DbInitErrorGate` reporta el fallo de
  inicialización de la DB (`name: 'DbInitFailed'`) — antes el incidente era
  invisible remotamente.
- `rust` (jul-31, issue #60): **puente Rust ERROR→frontend**
  (`src-tauri/src/logging/rust_error_bridge.rs`). Un Layer de tracing captura
  los ERROR del crate (`log::error!` incluidos vía LogTracer), filtra por
  target (`app_lib*`; excluye `"frontend"` — anti-bucle — y crates de
  terceros), dedupea/capea (20/proceso, gap 2s) y los manda por canal mpsc a
  una task drenadora que emite el evento `rust-error`; el listener del
  frontend los reenvía con `name` = target Rust y `rust_ts_ms` = epoch ms del
  lado Rust (para correlacionar contra maity.log). Gaps conocidos: el fallback
  `fmt::init()` de main.rs no lleva el layer; eventos pre-listener se pierden
  del lado remoto (persisten en maity.log); los panics no pasan por tracing.

- `rust-panic` (ago-2026, ciclo v0.2.57): `telemetry/panics.rs` encadena un
  `panic::set_hook` al de main.rs (que sigue en Sentry) y escribe el panic a un
  `.jsonl` **síncrono** en disco (el proceso se muere; nada de red ni tracing
  dentro del hook — regla anti-reentrada); en el siguiente arranque se importa
  al outbox y `drain.rs` lo sube como `app.error` con `source:"rust-panic"`.

**Presupuesto por fuente, no compartido (ago-2026):** `window 8 ·
unhandledrejection 8 · error-boundary 5 · db-init 3 · rust 20`. Antes era un
cupo único de 20 y un render-loop de React se lo comía tirando los ERROR de
Rust que ya habían pagado la barrera de #60 (anti *noisy neighbor*). Dedup por
`name:message[:120]`, gap mínimo 2s, truncado (message 500 / stack 1500 /
componentStack 1000).

**Los limiters ya no son mudos:** `BridgeLimiter` (Rust) y `ErrorReportLimiter`
(JS) exponen `{sent, dropped_dedup, dropped_cap, dropped_gap, dropped_channel}`
— invariante `sent + Σdropped == intentos` — y viajan como `err_budget` en cada
`health.heartbeat` (contadores **monótonos por sesión** → en SQL, `max()` por
sesión y luego sumar). El dedup de Rust pasó de `BTreeSet` a `BTreeMap<String,u32>`
y publica `{top_suppressed ×3, suppressed_total}` (conteos, no texto). Gotcha
arreglado: el dedup miraba lo VISTO, no lo ENVIADO — un drop por gap
envenenaba el dedup y el primer error de cada ráfaga se perdía para siempre.

**Cardinalidad (`device.profile` vs heartbeat):** las dimensiones estáticas
(`cpu_cores`, `gpu_type`, `memory_gb`, `os_version`, `arch`, `build_channel`)
van SOLO en `device.profile` (1×/sesión) — repetirlas ×469 heartbeats es peso
muerto. Excepción deliberada: `performance_tier` va en ambos (4 valores, es el
slice-by más frecuente: "¿la fuga es solo en tier Low?"). Que no sea la puerta
para las otras 8. Beneficio: antes esos datos solo viajaban en
`coach.session_summary` — una usuaria que nunca abre el coach era invisible.
`ErrorTelemetryInitializer` se monta FUERA de ErrorBoundary/AuthGate
(invariante en `layout.test.ts`) para capturar errores pre-auth y sobrevivir
al fallback del boundary; solo la ventana principal lo monta (las aux hacen
early-return en el layout — si eso cambiara, el emit broadcast de `rust-error`
multiplicaría reportes; la barrera real es el dedup del lado Rust). Hook en
`logger.error`: descartado definitivamente (#63 cerrado como no-planeado).

`event_data`: `{source, name, message, stack, component_stack, rust_ts_ms,
pathname, dedup_key, seq, session_uptime_s}` + columna `error` = message.

## Nivel 3: logs locales (Rust)

- **Log rotativo** (`logging/file_logger.rs`): todo `tracing`/`log` de Rust +
  lo que el frontend manda por `log_frontend_event`.
- **`[METRIC] mem-sample`** (`logging/mem_sampler.rs`, del ciclo RAM 0.2.53):
  cada 30s, RSS por proceso + lag; snapshots extra en 7 eventos de alta señal
  (recording-start/stop, post-stop-60s/120s, transcription-backlog,
  onnx-recycle, sidecar-timeout). Warnings con umbral y rate-limit 10 min
  (`sidecar-pool-multiple`, `app-rss-critical`, `system-memory-pressure`...).
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
    `system-memory-pressure` (<1024 MB disponibles **sostenido 2 ticks = 60 s**;
    un pico de un tick no pregunta), `rust-panic` (al arranque siguiente, desde
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
  - Eventos: `incident.detected` (`{kind, message, detail}`, al armar — sirve
    para medir la tasa de aceptación por ausencia del segundo) e
    `incident.bundle_uploaded` (`{kind, object_path, bytes}`). Ambos vía el
    outbox (`emit_event` → `drain.rs`, single-writer).
  - Identidad: la carpeta es `auth.uid()` (claim `sub` del JWT que decodifica
    Rust), NO `maity.users.id` — es lo que compara la policy RLS.

## Queries de análisis (listas para pegar)

Serie de tiempo de RAM — LA query para cazar fugas:

```sql
select created_at, session_id, app_version,
       (event_data->'mem'->>'app_rss_mb')::int  as app_mb,
       (event_data->'mem'->>'llama_rss_mb')::int as llama_mb,
       (event_data->'mem'->>'webview_rss_mb')::int as webview_mb,
       event_data->>'phase' as phase, event_data->>'reason' as reason
from maity.platform_logs
where platform='desktop' and event_type='health.heartbeat'
  and created_at > now() - interval '7 days'
order by session_id, created_at;
```

Pendiente de crecimiento por versión (¿la versión X arregló la fuga?):

```sql
select app_version, session_id,
       max((event_data->'mem'->>'app_rss_mb')::int) -
       min((event_data->'mem'->>'app_rss_mb')::int) as growth_mb,
       count(*) as beats
from maity.platform_logs
where platform='desktop' and event_type='health.heartbeat'
group by 1, 2 having count(*) >= 3 order by growth_mb desc;
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
4. Solo si falta detalle: pedirle el Export ZIP (nivel 3) **o** que use
   Ajustes → "Enviar diagnóstico" (bundle en Storage
   `incident-bundles/{auth_uid}/`, ~200 KB de tail; si el incidente fue de RAM
   o panic probablemente ya se le ofreció solo) y leer `[METRIC]`.

## Prevención: los lints del pre-build (ago-2026)

| Script (`frontend/scripts/`) | Qué impide |
|---|---|
| `lint-telemetry.js` | (a) `insert_platform_log` fuera de `platformLogger.ts`/`drain.rs`; (b) catálogo TS ≠ Rust (incl. marcador `legacy`); (c) evento nuevo sin punto; (d) `'unknown'` en campos de versión; (e) capability sin `core:app:default`; (f) evento del catálogo sin fila en este doc; (g) `platformLogger.log`/`recordingLogService.log` con literal no catalogado o argumento dinámico. Escape por línea `// telemetry-allow: <razón>` (solo a/d/g). |
| `lint-tauri-acl.js` | Drift entre lo que el código **ejerce** y lo que la ACL **declara**, por ventana: `onCloseRequested` ⇒ `core:window:allow-destroy` (la librería llama `destroy()` si el handler no hace `preventDefault()` — el eslabón invisible que produjo los `app.error` de ACL en 13 usuarias); `.close()` ⇒ `allow-close`; `getVersion()` ⇒ `core:app:default`; `confirm(`/`alert(` ⇒ `dialog:allow-confirm`/`allow-message`. La ventana de un archivo se resuelve por *reachability de imports* desde `app/<aux>/page.tsx`; el root `layout.tsx` es solo-`main` (early-return aux antes de `AppContent`, invariante en `layout.test.ts`). Escape `// acl-allow: <razón>`. |
| `lint-tauri-events.js` | Espejo `events.rs` ↔ `tauri-events.ts` y cero literales inline en `emit`/`listen`. |
| `verify-helper-binary.js` | Sidecar `llama-helper` bundleado ≠ código (SHA-256 vs `cargo build`); ver CLAUDE.md § Gemma. El smoke post-build además le habla (`{"type":"version","id":1}`). |
| `layout.test.ts` (vitest) | `ErrorTelemetryInitializer` fuera de `AuthGate`/`AuthProvider`/`ErrorBoundary`/`DbInitErrorGate` (identidad y captura pre-login/pre-DB); `UpdateCheckProvider` fuera del auth gate; early-return aux antes de `AppContent`. |

## Lo que NO existe todavía

- **Reintentos/cola del bundle de incidente** (#61 se cerró best-effort):
  si Storage falla (bucket ausente hasta que la web aplique
  `docs/incident-bundles-bucket.sql`, sin red) el usuario ve el error y no se
  reintenta. Tampoco se suben SQLite ni audio, ni hay lectura de bundles desde
  la app.
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

Resueltos en el ciclo ago-2026 (v0.2.57): panics a la nube (`rust-panic`,
arriba); ciclo de vida de grabación desde Rust con `trigger` y dispositivo real
(el punto ciego principal: la jornada arranca headless); `app_version` honesto
(`'unknown'` fuera; NULL cuando no resuelve); `session_id` único de proceso;
drenadora nativa única; contadores de descarte y presupuesto por fuente.

Resueltos en el ciclo jul-31: Rust ERROR→DB (#60, puente `rust-error`); gate
de ventanas aux en initializers (#62 — el "triple worker" no existía, era la
lista de rutas triplicada); hook en `logger.error` (#63, cerrado como
no-planeado: 5 call-sites, cobertura ya dada por window handlers + #60).
