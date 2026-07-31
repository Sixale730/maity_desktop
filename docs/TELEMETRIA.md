# Telemetría y diagnóstico remoto — inventario completo

> Última actualización: 2026-07-31 (ciclo issues #60/#62/#64: puente Rust
> ERROR→DB, gates de ventanas aux, telemetría de db-init).
> Pregunta que responde este doc: **"¿qué información tenemos para diagnosticar
> un problema en producción sin pedirle nada al usuario?"**

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

**Pipeline:** frontend `platformLogger` (`frontend/src/lib/platformLogger.ts`)
→ RPC `insert_platform_log` (SECURITY DEFINER; resuelve `user_id` desde
`maity.users WHERE auth_id = auth.uid()`; traga excepciones — nunca rompe la
app) → tabla `maity.platform_logs`.

Columnas útiles: `user_id`, `session_id` (`desktop-<ts>-<rand>`, uno por
proceso/ventana), `platform` (`'desktop'` | web), `event_type`, `event_data`
(jsonb), `status`, `error`, `app_version` (**lleno desde este ciclo** — antes
el desktop mandaba null), `device_info` (userAgent), `created_at`.

> **Gotcha de auth (verificado jul-31)**: sin sesión Supabase el RPC devuelve
> **401 y el evento se pierde en silencio** — el rol `anon` no tiene USAGE
> sobre el schema `maity` y el cliente pide ese schema. En la práctica casi
> todo emisor corre tras el AuthGate, pero `app.error` pre-login (db-init,
> rust, window) NO aterriza para usuarios deslogueados. Al depurar telemetría
> con un perfil sin sesión: el request sale, el server lo rechaza — verificar
> con intercepción de red, no con la tabla.

### Eventos que emite el desktop

| event_type | Quién lo emite | Cuándo | Payload clave |
|---|---|---|---|
| `app.open` / `app.close` | `layout.tsx` | arranque / cierre de la ventana | — |
| `nav.page_view` | `usePageViewTracker` | cada navegación | ruta |
| `coach.session_summary` | `useCoachMetricsTelemetry` (evento Rust `coach-metrics`) | al cerrar sesión de coach | métricas LLM + sidecar (timeouts, restarts, breaker) + picos de RAM + tier |
| `health.heartbeat` | `healthHeartbeatService` | cada 5 min activo / 15 min idle + start/stop de grabación | ver abajo |
| `app.error` | `errorTelemetry` | error no manejado / boundary | ver abajo |
| eventos de `recordingLogService` | sync del ciclo de vida de grabación | al sincronizar | por-grabación |
| `Analytics.track(...)` | stub de PostHog (`lib/analytics.ts`) | call-sites legacy | passthrough a platform_logs |

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

Presupuesto: máx 20 envíos/sesión/ventana, dedup por `name:message[:120]`,
gap mínimo 2s, truncado (message 500 / stack 1500 / componentStack 1000).
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
4. Solo si falta detalle: pedirle el Export ZIP (nivel 3) y leer `[METRIC]`.

## Lo que NO existe todavía

- **Bundle de incidente con consentimiento** (#61): subir el tail del log
  rotativo a Supabase Storage al detectar crash/umbral de RAM. El patrón
  canal→drenadora de `rust_error_bridge.rs` es la base para emitir el evento
  desde los warnings del `mem_sampler`.
- **Panics a la nube**: los panics no pasan por tracing → el puente `rust`
  no los ve (quedan en maity.log y en Sentry si está activo).

Resueltos en el ciclo jul-31: Rust ERROR→DB (#60, puente `rust-error`); gate
de ventanas aux en initializers (#62 — el "triple worker" no existía, era la
lista de rutas triplicada); hook en `logger.error` (#63, cerrado como
no-planeado: 5 call-sites, cobertura ya dada por window handlers + #60).
