# T5: docs, classification SQL and skill Q11 (issue #83)

## Summary
T5 has two jobs. First, it writes the field contract that T1-T4 must emit. Second, it updates the docs that explain those fields. The core is a person × business-day classification query for SQL over maity.platform_logs; the final version appears in the design below. It ran without error against prod on 2026-09-23 (Dingler, 1-23 Sep, 16 business days × 10 people) and put every legacy row into the "versión < 0.2.62" / "posible desinstalación" buckets. A synthetic JSON check also confirmed the new-field expressions (mode+filter, jsonb days_of_week containment, the prev_exit_clean/prev_exit_reason logic). A header-chained variant (Q11b) was validated against the web skill's real header, and so was an extended Q11. docs/TELEMETRIA.md gets these changes: six new rows plus a lifecycle block; app.open/app.close corrected (hide-to-tray and hard reloads, backed by prod numbers); the device.profile row fixed (autostart_state is really reliable from 0.2.60, not 0.2.59) with the 0.2.62 jornada/package_installed_at fields; the jornada block and the closed idle_reason domain for the heartbeat; the query, a runbook, an entry under "Lo que NO existe" explaining how uninstall is inferred, and a paragraph listing what was fixed in 0.2.62. ONBOARDING_Y_GATES (B1/B3/B4), REGLAS_AUDIO_GRABACION (B5), CANALES_DISTRIBUCION (B2) and CLAUDE.md get targeted edits. On the web side: queries.sql Q11 is replaced, Q11b is added, SKILL.md is rewritten from about L149 to L165 plus four smaller spots, and report-a-template.md is updated. lib/generated/piloto-skill.generated.ts must be regenerated or prompt-docs.test.ts fails. The stale desktop copy of the skill (5 tracked files that differ from the web copy and have no Q11, Q-1 or feriados) should become a pointer stub. Commits: desktop C1 (contract, before T1-T4 code), C2 (rules docs, after the B fixes), C3 (skill stub); web W1, committed with explicit paths because the web tree has unrelated modified files. Nothing is pushed.

## Current behavior
- Lint (f) only checks catalog→doc (every Rust catalog name must appear backticked in TELEMETRIA.md), it does NOT check doc→catalog, so documenting events before the code lands is safe for the build. — frontend/scripts/lint-telemetry.js:218-223 `const missing = [...rustCat.keys()].filter((name) => !doc.includes(`\`${name}\``));`
- Current catalogs contain none of the #83 events (app.start, app.exit, autostart.changed, auth.logout, auth.session_lost, jornada.settings_changed). — frontend/src-tauri/src/logging/telemetry/catalog.rs:21-69 and frontend/src/lib/telemetry-events.ts:18-65 (only APP_OPEN/APP_CLOSE/APP_ERROR/... in the App block)
- app.open fires on every mount of the main document (including hard reloads); app.close fires on the FIRST of onCloseRequested/beforeunload/pagehide per document, deduped, and the X only hides to tray. — frontend/src/app/(main)/layout.tsx:408-467 (`if (hasEmittedOpenRef.current) return`, `let hasEmittedClose = false`, `event.preventDefault(); emitClose()`); hard nav at frontend/src/hooks/useRecordingStop.ts:552 `window.location.href = `/conversations?localId=...``; reloads in ErrorBoundary.tsx:68, ChunkErrorRecovery.tsx:65/103, useConversationLive.ts:306, layout.tsx:746; Rust hide at lib.rs:925-926 `api.prevent_close()`
- Prod (30 d): 203 app.open, of which 13 have a non-empty referrer (= hard reload/navigation). Of 41 app.close, only 1 is followed by app.open in the same process within 2 min, and 9 processes kept emitting >10 min after their app.close (hidden to tray). So app.close is neither process exit nor reliable on reload. — MCP execute_sql 2026-09-23: referrer '' ×190 (186 procs), 'http://tauri.localhost/' ×8, '/conversations?id=' ×4, '/settings' ×1; closes=41, seguido_de_open_mismo_proceso=1, proceso_sigue_vivo_10min=9
- device.profile's autostart_state/started_at_boot are present systematically from 0.2.60 (only 1 of 27 0.2.59 profiles has them); signature_kind appears only on 0.2.61 dev builds (2 of 5). TELEMETRIA.md:215 says 'Desde 0.2.59'. The web SKILL.md:160 says '≥ 0.2.60' (correct). — MCP: 0.2.57 110/0, 0.2.58 39/0, 0.2.59 27/1, 0.2.60 19/19, 0.2.61 5/5 (has_sig 2)
- In the last 30 days platform_logs.user_id is always maity.users.id (6866/6866, 0 by auth_id), and 295 desktop rows lack ctx.occurred_at (pre-0.2.57 builds), so the event time must be coalesce(occurred_at, created_at). Rust occurred_at has nanoseconds and casts fine. — MCP: total 6866, by_id 6866, by_auth 0, no_occ 295; '2026-09-23T15:00:00.558787500+00:00'::timestamptz → '2026-09-23 15:00:00.558788+00'
- Heartbeat phase values in prod: recording/idle/paused/starting/stopping; reason: initial/interval/recording-start/recording-stop/native. No heartbeat has a 'jornada' key yet. — MCP group-by on health.heartbeat 30 d (e.g. recording/interval/webview 1041, idle/native/rust 208, paused/interval 20, paused/native 13)
- The scheduler's skip reasons (source of the idle_reason vocabulary) are private, loop-local and only surface as a UI event; RearmingNextHour covers three causes with one 'next hour' message. — frontend/src-tauri/src/scheduled_recording/service.rs:61-88 (`enum SkipReason` / `as_str` → manual_in_progress, transcription_not_ready, rearming_next_hour, no_session, registration_incomplete, no_input_device, mic_access_denied, start_backoff); :98-100 `"Grabación de jornada detenida; se reanudará a la siguiente hora en punto."`
- The single chokepoint for persisting jornada settings is update_settings. — frontend/src-tauri/src/scheduled_recording/service.rs:345-358 `pub async fn update_settings<R: Runtime>(...) { save_settings(app_handle, &settings)... *self.shared.settings.write().await = settings.clone();`
- days_of_week uses ISO numbering (1=Monday), which matches Postgres extract(isodow). — frontend/src-tauri/src/scheduled_recording/settings.rs:100-101 `(mapea directo a chrono::Weekday::number_from_monday())` `pub days_of_week: Vec<u8>`; schedule.rs:25 `wd.number_from_monday() as u8`
- recording_start_failed carries a classified `code` (mic_permission_denied | mic_not_found | mic_in_use | mic_format_unsupported | audio_unknown) plus trigger/suppressed; there is no trigger on recording_stopped. — audio/recording_lifecycle.rs:205-227 `json!({ "trigger": trigger, "code": code, "suppressed": suppressed })`; audio/device_errors.rs:89-95; prod sample of recording_stopped has only duration_seconds + recording_session_id
- The Chat sidebar footer signs out by calling supabase.auth.signOut() directly, which skips logout_cleanup (this is B1). — frontend/src/shared/components/shell-v5/SidebarFooterV5.tsx:37 `await supabase.auth.signOut();`
- tauri-plugin-updater 2.10.0 on Windows runs the optional on_before_exit hook, ShellExecutes the installer and exits the process (B2). — tauri-plugin-updater-2.10.0/src/updater.rs:288 `/// Function to run before we run the installer and exit the app through std::process::exit(0) on Windows`; :836-839 `if let Some(on_before_exit) = self.on_before_exit.as_ref() { ... on_before_exit(); }`
- tao does not handle WM_QUERYENDSESSION, and it turns WM_ENDSESSION into loop destruction (B5). — tao-0.35.2/src/platform_impl/windows/event_loop.rs:2382-2386 `// We don't process WM_QUERYENDSESSION yet ...` `win32wm::WM_ENDSESSION => {`; our Exit handler calls graceful_shutdown_before_exit at lib.rs:1795 (fn at lib.rs:1833)
- The web skill's Q11 already exists (per-person snapshot using created_at). It says the #83 blind spots will be filled later and that Q11 should then be updated. — C:\maity\.claude\skills\piloto-analisis\queries.sql:288-313; SKILL.md:149-165 (L165 `Los puntos ciegos ... están en maity_desktop#83. Cuando se implemente, actualizar Q11 y esta tabla.`)
- Queries that start with `with` (Q4, Q6, Q11) are meant to be chained onto the header by replacing that `with` with a comma. The skill never writes this down. — queries.sql:36-99 header ends in `fr as (...)` with no final select; Q4 at :217 starts `with dias as (`; verified by running header + Q11b with `with`→`,` in MCP (success)
- Editing the web skill requires regenerating lib/generated/piloto-skill.generated.ts; otherwise the vitest prompt-docs test fails. — C:\maity\scripts\gen-prompt-docs.mjs:3-10,21-27 (SOURCES = SKILL.md, queries.sql, report-a-template.md → lib/generated/piloto-skill.generated.ts); C:\maity\CLAUDE.md:455 `Al editar la skill corre pnpm run gen:prompt-docs`; test lib/services/prompt-docs/__tests__/prompt-docs.test.ts:14-24
- The desktop copy of the skill is stale: all 5 tracked files differ from the web copy, and it has no Q-1, no feriados, no started_at window fix and no Q11. Its only desktop reference is CLAUDE.md:46 (and the gitignored ejemplo HTML at .gitignore:134). — diff -q: all five files differ; `diff queries.sql` shows missing Q-1/Q11/Q10/feriados; Grep 'piloto-analisis' in C:\maity_desktop → CLAUDE.md:46, .gitignore:134, files of the skill itself
- The web repo has unrelated uncommitted changes, so W1 must stage explicit paths only. — cd C:\maity && git status --short → ` M api/conversations.ts`, ` M lib/services/omi/index.ts`, ` M lib/services/omi/memory-extractor.service.ts`, `?? lib/services/omi/__tests__/memory-extractor.test.ts`

## Design
## 0. Field contract (T5 owns it; T1–T4 must emit exactly this)

The doc and the SQL depend on these names. Any rename in T1–T4 means changing it here and in the SQL (see open questions).

| Where | Key | Type / domain |
|---|---|---|
| `health.heartbeat` (BOTH emitters: JS `healthHeartbeatService.ts` ~L211-233 fields are picked explicitly, and the Rust `mem_sampler.rs::emit_native_heartbeat` builds its own json) | `jornada` | object `{enabled: bool, configured_by_user: bool, in_window: bool, scheduler_phase: "disabled|idle|armed|recording|grace", idle_reason: string|null}` |
| idle_reason (closed domain) | | `null` (recording/grace) · `jornada_off` · `outside_window` · `no_session` · `registration_incomplete` · `no_input_device` · `mic_access_denied` · `start_backoff` · `transcription_not_ready` · `manual_in_progress` · `stopped_by_user` · `closed_for_today` · `rotation_pending` (the last three replace `rearming_next_hour`, B3). Must be computable when the loop is NOT running (enabled=false → `jornada_off`). `in_window` = local time falls inside a configured window EVEN IF enabled=false (`schedule::active_window_at` ignores enabled) |
| `device.profile` | `jornada` | `{enabled, configured_by_user, days_of_week:[1..7 ISO], start_time:"HH:MM", end_time:"HH:MM" (windows[0], local PC time), windows_count, auto_close_enabled, auto_close_time}` |
| `device.profile` | `package_installed_at` | ISO string or null |
| `app.start` | payload | `started_at_boot: bool, autostart_state, prev_exit_clean: bool|null (null = first run), prev_exit_reason: string|null (from the sync marker), prev_exit_at, prev_version, downtime_s: int`; status `ok`/`warning` (unclean) |
| `app.exit` | payload | `reason: tray_quit|os_shutdown|logoff|update_restart|rival_uninstall|other`, `recording_active: bool`, `uptime_s`; status `ok` |
| `autostart.changed` | payload | `from`, `to` (same domain as autostart_state), `source: startup|user|bootstrap` |
| `auth.logout` | payload | `source` (which button), `recording_active`; status `success` |
| `auth.session_lost` | payload | `event`, `had_recording`; status `warning`; MUST go through the outbox (without a session the RPC returns 401, TELEMETRIA.md:108-114) |
| `jornada.settings_changed` | payload | `from`, `to` (shape of device.profile.jornada), `changed: [keys]`; emitted only when there is a diff, from `service.rs:345` |

## 1. docs/TELEMETRIA.md (commit C1 = E1–E7; commit C2 = E8–E10)

**E1, L3-6 header:** start with `> Última actualización: 2026-09-XX (0.2.62, issue #83 "¿por qué no grabó?": \`app.start\`/\`app.exit\`, jornada en el latido y en \`device.profile\`, \`autostart.changed\`, \`auth.logout\`/\`auth.session_lost\`, \`jornada.settings_changed\` y la query persona × día). Antes: 2026-08-17 (ciclo v0.2.57 …)` and keep the rest of the paragraph.

**E2, new block between L207 and L209 (before "**App / salud**"):**
```
**Ciclo de vida del proceso, sesión y jornada (desde 0.2.62, issue #83).** Responden "¿por qué X no grabó el día Y?" (query "¿Por qué no grabó?" abajo). Todo va al outbox nativo salvo `auth.logout`.

| event_type | Emisor | Cuándo | Payload clave |
|---|---|---|---|
| `app.start` | Rust, `setup()` tras init de la DB (outbox) | 1× por proceso | `started_at_boot`, `autostart_state`, `prev_exit_clean` (`false` = el proceso anterior murió sin cierre registrado: crash, "Finalizar tarea", corte de luz, updater NSIS < 0.2.62; `null` = primer arranque), `prev_exit_reason` (motivo del marcador del proceso anterior), `prev_exit_at`, `prev_version` (≠ `ctx.app_version` ⇒ hubo actualización), `downtime_s`; `status` = `ok` \| `warning` (sucio) |
| `app.exit` | Rust; el marcador en disco se escribe ANTES, síncrono (patrón `telemetry/panics.rs`), y luego el outbox | cada salida registrada | `reason` = `tray_quit` \| `os_shutdown` \| `logoff` \| `update_restart` \| `rival_uninstall` \| `other`; `recording_active`; `uptime_s`; `status` = `ok` |
| `autostart.changed` | Rust | `autostart_state` distinto del último visto (se compara en cada arranque y tras cada toggle) | `from`, `to`, `source` = `startup` \| `user` \| `bootstrap`; `status` = `ok` |
| `auth.logout` | JS, `AuthContext.signOut` (`platformLogger`, ANTES de `supabase.auth.signOut()`, con sesión viva) | logout pedido por el usuario, desde cualquier botón (B1) | `source`, `recording_active`; `status` = `success` |
| `auth.session_lost` | JS → outbox (sin sesión el RPC da 401) | `SIGNED_OUT` que el usuario no pidió (refresh token revocado o vencido) | `event`, `had_recording`; `status` = `warning`. Se drena al siguiente login y se atribuye a quien inicie sesión |
| `jornada.settings_changed` | Rust, `ScheduledRecordingService::update_settings` (`scheduled_recording/service.rs:345`, único punto de persistencia) | cambió algún campo; sin diff no emite (la UI guarda dos veces por acción) | `from` / `to` con la forma de `device.profile.jornada`, `changed`; `status` = `ok` |

> **`app.exit` se escribe al salir pero se DRENA en el siguiente arranque tras el login**: la hora real es `ctx.occurred_at`. Si Windows mata el proceso durante `WM_ENDSESSION` antes de que el outbox haga commit, el motivo sobrevive en el marcador y viaja como `app.start.prev_exit_reason`. Por eso la query lee `coalesce(app.exit.reason, siguiente app.start.prev_exit_reason)` y solo cuenta como "crash / cierre forzado" `prev_exit_clean=false` **sin** motivo.
> **`window_close` no existe**: la X esconde a la bandeja (`lib.rs:925-926`, `api.prevent_close()`) y el proceso sigue vivo. `os_shutdown` y `logoff` se separan con el `lParam` de `WM_ENDSESSION`, que tao descarta (`tao …/event_loop.rs:2382-2386`); ver B5 en `docs/REGLAS_AUDIO_GRABACION.md`.
> Las filas pre-login (`app.start` antes de iniciar sesión) se atribuyen al usuario que inicia sesión después (`drain.rs` resuelve `auth.uid()` al drenar). En una PC compartida eso atribuye mal.
```

**E3, replace L213 (app.open/app.close row):**
`| \`app.open\` / \`app.close\` | \`app/(main)/layout.tsx:408-467\` (\`AppContent\`) | \`app.open\`: cada montaje del documento main, o sea el arranque **y cada recarga dura** (\`window.location.href\` al detener una grabación manual, \`useRecordingStop.ts:552\`; \`reload()\` de ErrorBoundary/ChunkErrorRecovery/useConversationLive). Un \`referrer\` no vacío delata la recarga (13 de 203 en 30 días). \`app.close\`: el PRIMER \`onCloseRequested\`/\`beforeunload\`/\`pagehide\` de ese documento, deduplicado. La X **esconde a la bandeja** (9 de 41 procesos siguieron vivos >10 min) y en una recarga el RPC suele morir con la página (13 recargas, 1 \`app.close\`). **Ninguno es ciclo de vida del proceso: para eso \`app.start\`/\`app.exit\`.** | \`app.open\`: \`referrer\`, \`screen\`, \`viewport\`, \`language\` |`

**E4, L215 device.profile row:** change "Desde 0.2.59 (caso Dingler)" to "Desde 0.2.60 (en 0.2.59 solo el build piloto: 1 de 27 perfiles)". Append: "Desde 0.2.62: `jornada` = `{enabled, configured_by_user, days_of_week (ISO, 1 = lunes), start_time, end_time (HH:MM en hora LOCAL de la PC, de `windows[0]`, que es la única que edita la UI), windows_count, auto_close_enabled, auto_close_time}`; `package_installed_at`; en canal directo `autostart_state` también lee `StartupApproved\Run` (Task Manager) y puede decir `disabledByUser`."

**E5, heartbeat jsonc (L260-289):** add before the closing `}`:
```
  "jornada": {                 // desde 0.2.62, AMBOS emisores
    "enabled": true, "configured_by_user": true,
    "in_window": true,         // hora LOCAL dentro de una ventana, aunque la jornada esté apagada
    "scheduler_phase": "disabled | idle | armed | recording | grace",
    "idle_reason": null        // null = grabando o en gracia; dominio cerrado, tabla abajo
  }
```
Then add after L292 a table with one row per idle_reason value: meaning plus source (SkipReason / settings / schedule). Include these two rows:
- `stopped_by_user`: re-arms at the next hour, `next_hour_boundary`.
- `closed_for_today`: auto-close already closed the day and it resumes TOMORROW. Before 0.2.62 it said "siguiente hora" (B3).

Rule: a new value needs a row here plus a branch in the query. Add B4 persistence note: since 0.2.62 `stopped_by_user`/`closed_for_today`/`halted_for_day` survive a restart; before, a restart inside the window started the jornada at once.

**E6, cardinality paragraph L386-391:** append "Segunda excepción deliberada (0.2.62): el bloque `jornada` del latido cambia durante el día (ventana, motivo), y un perfil 1×/sesión no dice a qué hora dejó de grabar. El horario (días/horas) NO se repite: vive en `device.profile.jornada` y en `jornada.settings_changed`."

**E7, new queries after the autostart query (L551-573):** the heading "¿Por qué no grabó? — persona × día hábil (#83)", a reading guide, and the SQL below. Then two small queries (validated, 0 rows today):
```sql
select app_version, count(*) arranques,
       count(*) filter (where (event_data->>'started_at_boot')::boolean) con_windows,
       count(*) filter (where (event_data->>'prev_exit_clean')::boolean is false and event_data->>'prev_exit_reason' is null) tras_cierre_sucio,
       string_agg(distinct event_data->>'prev_exit_reason', ', ') motivos_previos,
       percentile_disc(0.5) within group (order by (event_data->>'downtime_s')::bigint) downtime_mediana_s
from maity.platform_logs
where platform='desktop' and event_type='app.start' and created_at > now() - interval '30 days'
group by 1 order by 1 desc;
```
plus the same shape for `app.exit` grouped by `event_data->>'reason'` with `count(*) filter (where (event_data->>'recording_active')::boolean)`.

Reading rules to write above the SQL:
- (a) Event time is `ctx.occurred_at`, falling back to `created_at` (295 of 6,866 desktop rows lack it).
- (b) `user_id in (u.id, u.auth_id)`: 100% `users.id` today, but it is cheap insurance.
- (c) Compare versions as `int[]`, never as text (`'unknown'` sorts above everything and `'0.2.100' < '0.2.62'`).
- (d) The first matching branch wins. The order goes from strongest evidence to weakest.
- (e) "posible desinstalación" = at least 7 days of silence up to today, with no later event or conversation. It cannot be proven (see "Lo que NO existe").
- (f) The day is CDMX, while `in_window` is computed on the PC, in its own local time.
- (g) Conversations count as "vida después" because 0.2.56 heartbeats stop after about 55 min (auth-js deadlock) while recording goes on.
- (h) Validated 2026-09-23 against prod: with no 0.2.62 data every day falls into "versión < 0.2.62" or "posible desinstalación".

**Classification SQL (final, validated on prod 2026-09-23):**
```sql
with p as (
  select '<company_id>'::uuid company_id, 'America/Mexico_City'::text tz,
         date '2026-09-01' d_desde, date '2026-09-23' d_hasta,
         array[date '2026-09-16']::date[] feriados,       -- días inhábiles (16-sep, 3er lunes de nov, 25-dic…)
         array['karen']::text[] excluir,                  -- managers, nombre de pila en minúscula
         array[0,2,62] v_nueva,                           -- primera versión con los eventos de #83
         interval '30 days' lookback,                     -- cuánto mirar atrás para el último estado conocido
         interval '7 days' silencio_desinstalacion
),
team as (
  select u.id, u.auth_id, initcap(split_part(trim(u.first_name),' ',1)) nombre
  from maity.users u, p
  where u.company_id = p.company_id and lower(split_part(trim(u.first_name),' ',1)) <> all (p.excluir)
),
ev as (
  select t.id uid, l.event_type et, l.event_data d,
         coalesce((l.event_data->'ctx'->>'occurred_at')::timestamptz, l.created_at) ts,
         coalesce(string_to_array(substring(coalesce(nullif(l.app_version,'unknown'), l.event_data->'ctx'->>'app_version')
                                            from '^[0-9]+\.[0-9]+\.[0-9]+'), '.')::int[], array[0]) >= p.v_nueva nueva
  from maity.platform_logs l join team t on l.user_id in (t.id, t.auth_id) cross join p
  where l.platform = 'desktop' and l.created_at >= (p.d_desde::timestamp at time zone p.tz) - p.lookback
),
dias as (
  select d::date dia, (d::date::timestamp at time zone p.tz) t0, ((d::date + 1)::timestamp at time zone p.tz) t1,
         extract(isodow from d)::int dow
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
  select t.nombre, d.dia, d.dow, coalesce(cv.n, 0) conv_n, x.*,
         coalesce(case when prev.et = 'app.exit' then prev.d->>'reason' end, sig.d->>'prev_exit_reason') prev_salida,
         ant.ts ant_ts, coalesce(ant.nueva, false) ant_nueva, hb_ant.ts hb_ant_ts, lo_ant.ts logout_ant_ts,
         aut.estado autostart, jor.j horario, sig.d sig_start, (post.x is not null) hay_senal_despues
  from team t cross join dias d
  left join conv cv on cv.uid = t.id and cv.dia = d.dia
  cross join lateral (
    select count(*) n_ev,
           count(*) filter (where e.et = 'recording_started') rec_started,
           count(*) filter (where e.et = 'recording.segment_discarded') seg_desc,
           count(*) filter (where e.et = 'health.heartbeat') hb,
           count(*) filter (where e.et = 'health.heartbeat' and e.d->>'phase' in ('recording','starting','stopping')) hb_rec,
           count(*) filter (where e.et = 'health.heartbeat' and e.d->>'phase' = 'paused') hb_pausa,
           count(*) filter (where e.et = 'health.heartbeat' and e.d ? 'jornada') hb_j,
           bool_or((e.d->'jornada'->>'enabled')::boolean) filter (where e.et = 'health.heartbeat') j_on,
           bool_or((e.d->'jornada'->>'configured_by_user')::boolean) filter (where e.et = 'health.heartbeat') j_config,
           bool_or((e.d->'jornada'->>'in_window')::boolean) filter (where e.et = 'health.heartbeat') j_en_ventana,
           mode() within group (order by e.d->'jornada'->>'idle_reason')
             filter (where e.et = 'health.heartbeat' and (e.d->'jornada'->>'in_window')::boolean) motivo,
           count(*) filter (where e.et = 'recording_start_failed' and e.d->>'code' in ('mic_not_found','mic_permission_denied')) fallo_mic,
           count(*) filter (where e.et in ('auth.logout','auth.session_lost')) logout,
           (array_agg(e.d->>'reason' order by e.ts desc) filter (where e.et = 'app.exit'))[1] salida_dia,
           count(*) filter (where e.et = 'app.start' and (e.d->>'prev_exit_clean')::boolean is false
                                  and e.d->>'prev_exit_reason' is null) arranque_sucio,
           coalesce(bool_or(e.nueva), false) nueva
    from ev e where e.uid = t.id and e.ts >= d.t0 and e.ts < d.t1
  ) x
  left join lateral (select e.et, e.d from ev e where e.uid = t.id and e.ts < d.t0 and e.et in ('app.start','app.exit')
                     order by e.ts desc limit 1) prev on true
  left join lateral (select e.ts, e.nueva from ev e where e.uid = t.id and e.ts < d.t0 order by e.ts desc limit 1) ant on true
  left join lateral (select max(e.ts) ts from ev e where e.uid = t.id and e.ts < d.t0 and e.et = 'health.heartbeat') hb_ant on true
  left join lateral (select max(e.ts) ts from ev e where e.uid = t.id and e.ts < d.t0
                       and e.et in ('auth.logout','auth.session_lost')) lo_ant on true
  left join lateral (select coalesce(e.d->>'to', e.d->>'autostart_state') estado from ev e
                     where e.uid = t.id and e.ts < d.t1 and (e.et = 'autostart.changed' or e.d ? 'autostart_state')
                     order by e.ts desc limit 1) aut on true
  left join lateral (select coalesce(e.d->'to', e.d->'jornada') j from ev e
                     where e.uid = t.id and e.ts < d.t1
                       and (e.et = 'jornada.settings_changed' or (e.et = 'device.profile' and e.d ? 'jornada'))
                     order by e.ts desc limit 1) jor on true
  left join lateral (select e.d from ev e where e.uid = t.id and e.ts >= d.t0 and e.et = 'app.start' order by e.ts limit 1) sig on true
  left join lateral (select 1 x from ev e where e.uid = t.id and e.ts >= d.t1
                     union all
                     select 1 from maity.omi_conversations c where c.user_id = t.id and c.started_at >= d.t1
                       and not coalesce(c.deleted, false)
                     limit 1) post on true
)
select nombre, dia,
  case
    when conv_n > 0 then 'grabó'
    when seg_desc > 0 then 'grabó: descartado por poco contenido'
    when rec_started > 0 or hb_rec > 0 then 'grabó: sin conversación guardada ese día (pendiente de subir, fallida o fechada otro día)'
    -- sin ninguna señal ese día
    when n_ev = 0 and not hay_senal_despues and (ant_ts is null or now() - ant_ts >= (select silencio_desinstalacion from p))
         then 'sin señal (posible desinstalación)'
    when n_ev = 0 and logout_ant_ts > coalesce(hb_ant_ts, '-infinity') then 'sesión de Maity cerrada'
    when n_ev = 0 and prev_salida in ('os_shutdown','logoff') and autostart in ('enabled','enabledByPolicy')
         then 'PC apagada / sin sesión de Windows'
    when n_ev = 0 and prev_salida in ('os_shutdown','logoff') then 'sin arranque con Windows (PC apagada o no la abrió)'
    when n_ev = 0 and prev_salida = 'tray_quit' then 'cerrada por el usuario'
    when n_ev = 0 and prev_salida = 'update_restart' then 'cerrada para actualizar y no reabrió'
    when n_ev = 0 and (sig_start->>'prev_exit_clean')::boolean is false and prev_salida is null then 'crash / cierre forzado'
    when n_ev = 0 and not hay_senal_despues then 'sin señal (silencio reciente)'
    when n_ev = 0 and not ant_nueva and sig_start is null then 'sin señal (versión < 0.2.62: Maity no corrió, causa desconocida)'
    when n_ev = 0 then 'sin señal (causa no identificada)'
    -- Maity corrió pero no grabó
    when hb = 0 and nueva then 'sesión de Maity cerrada'          -- los dos latidos exigen sesión
    when hb_j > 0 and j_on is not true and j_config is not true then 'jornada sin configurar'
    when hb_j > 0 and j_on is not true then 'jornada apagada'
    when hb_j > 0 and (j_en_ventana is not true
         or not coalesce(horario->'days_of_week' @> to_jsonb(dow), true)) then 'fuera de horario'
    when motivo = 'no_session' or logout > 0 then 'sesión de Maity cerrada'
    when motivo = 'registration_incomplete' then 'registro incompleto'
    when motivo in ('no_input_device','mic_access_denied') or fallo_mic > 0 then 'sin micrófono / permiso'
    when hb_pausa > 0 then 'pausada por el usuario'
    when motivo = 'stopped_by_user' then 'detenida por el usuario'
    when salida_dia = 'tray_quit' then 'cerrada por el usuario'
    when salida_dia in ('os_shutdown','logoff') then 'PC apagada / sin sesión de Windows'
    when arranque_sucio > 0 then 'crash / cierre forzado'
    when motivo = 'transcription_not_ready' then 'motor de transcripción no listo'
    when hb_j = 0 and hb > 0 then 'abierta sin grabar (versión < 0.2.62: jornada apagada o fuera de horario)'
    when hb = 0 then 'corrió sin latido (versión < 0.2.62)'
    else 'abierta sin grabar (causa no identificada)'
  end causa,
  conv_n, n_ev, hb, hb_rec, hb_pausa, fallo_mic, motivo, salida_dia, prev_salida, autostart
from f order by nombre, dia;
```
To see a per-person summary, wrap it in `select nombre, causa, count(*) … from (…) q group by 1,2`.

**E8 (C2), new runbook after L585-596, "un manager pregunta por qué X no grabó el día Y":**
1. Run the query filtered to that person.
2. If the result is a "sin señal" bucket, look at the process that came next: `app.start` (`prev_version`, `downtime_s`, `started_at_boot`).
3. If the result is "crash / cierre forzado", look at `app.error source=rust-panic` from the next boot.
4. If the result is "fuera de horario" or "jornada apagada", read `jornada.settings_changed` to see who changed it and when.
5. If it is "posible desinstalación", ask the manager. Nothing in the cloud proves it.

**E9 (C2), "Lo que NO existe todavía" (L608+), new first bullet:**
"**Desinstalación**: no hay evento. MSIX no ofrece hook de desinstalación y el uninstaller NSIS mata el proceso por nombre. Se infiere en la nube: silencio ≥ 7 días sin eventos ni conversaciones posteriores; con `autostart_state=enabled` conocido es casi seguro, porque prender la PC abre Maity. Tampoco se distingue 'PC apagada' de 'no la abrió' cuando el arranque con Windows está apagado, ni quién usó una PC compartida (las filas pre-login se atribuyen al siguiente login)."

**E10 (C2), after L638, "Resueltos en el ciclo 0.2.62 (#83)":** one paragraph listing app.start/app.exit with the sync marker, jornada in heartbeat and profile, autostart.changed incl. StartupApproved, auth.logout for every button (B1), the NSIS updater saving the recording (B2), the correct re-arm message (B3), day state persisted (B4), bounded WM_ENDSESSION (B5).

## 2. Other docs (commit C2; the B-fix implementers fill the `<…>` placeholders or hand them to T5)

- **docs/ONBOARDING_Y_GATES.md L13 "Logout" bullet**, append: "**Todo** cierre de sesión pasa por `AuthContext.signOut` (0.2.62, B1). El footer del sidebar de Maity Chat (`shared/components/shell-v5/SidebarFooterV5.tsx:37`) llamaba `supabase.auth.signOut()` directo y se saltaba `logout_cleanup`: la grabación activa no se detenía ni se guardaba por el camino de logout. Guard: `<guard ESLint/test de B1>`. Telemetría: `auth.logout` con `source`."
- **Same doc L23 bullet "No reusar rearm_at"**, append: "desde 0.2.62 el re-armado lleva causa (`stopped_by_user` \| `closed_for_today` \| `rotation_pending`) y cada una tiene su mensaje: tras el auto-cierre ya no dice 'siguiente hora' sino 'mañana' (B3)."
- **Same doc, new section after L27:** "## El estado del día de la jornada sobrevive al reinicio (0.2.62, B4)". Content:
  - What is persisted: re-arm with its cause, `halted_for_day`, back-off, and the local date.
  - Where: `<archivo de B4>`. It is NOT `scheduled_recording_settings.json`, because `update_settings` is the settings chokepoint and emits `jornada.settings_changed`.
  - Expiry: when the local day changes.
  - Before: `SchedulerShared` lived only in memory (`service.rs:240-261`), so restarting inside the window started the jornada at once.
  - Escape hatch: `CheckNow` / saving settings still lifts the stop.
- **docs/REGLAS_AUDIO_GRABACION.md, new section before L68 ("Recuperación…"):** "## Apagado o cierre de sesión de Windows con grabación activa (0.2.62, B5)". Content:
  - tao does not handle `WM_QUERYENDSESSION`.
  - `WM_ENDSESSION(TRUE)` becomes `RunEvent::Exit` without `ExitRequested`, and the `lParam` is dropped (`tao-0.35.2 …/event_loop.rs:2382-2386`).
  - Before: the handler blocked up to 30 s in `graceful_shutdown_before_exit` (`lib.rs:1795`) inside the message.
  - Fix: `<mecanismo y presupuesto de B5>`.
  - The recovery safety net at next boot is still `autoRecoverAll` plus 30 s checkpoints.
  - Telemetry: `app.exit` `os_shutdown|logoff` + `recording_active`.
- **docs/CANALES_DISTRIBUCION.md, new section before L21:** "## Updater NSIS (GitHub Releases): guardar la grabación antes de instalar (0.2.62, B2)". Content:
  - Before: `downloadAndInstall` (`UpdateDialog.tsx`, `services/updateService.ts`) → tauri-plugin-updater 2.10.0 runs `on_before_exit`, ShellExecutes the installer and exits with `std::process::exit(0)` (`updater.rs:288`, `:836-839`), with no `RunEvent::Exit`, no graceful shutdown and no recording check.
  - Fix: `<B2: se niega grabando como la Store + on_before_exit/guardado>`.
  - `app.exit reason=update_restart`.
  - Also at L23 after "Windows cierra Maity para aplicar el paquete", add: "(mecanismo UNVERIFIED; si Windows mata sin `WM_ENDSESSION`, el siguiente `app.start` sale con `prev_exit_clean=false` y `prev_version` menor a la actual, que es como se distingue de un crash)".
- **CLAUDE.md:**
  - L52 block: add bullet "El updater NSIS sale con `std::process::exit(0)` sin `RunEvent::Exit`: guardar/negar grabando antes (B2, `docs/CANALES_DISTRIBUCION.md`)".
  - L219 bullet: append "…por CUALQUIER botón: todo signOut pasa por `AuthContext.signOut` (B1)".
  - L221 bullet: append "el estado del día (detenida, cerrada por hoy, alto) persiste al reiniciar (B4); el re-armado distingue sus tres causas (B3)".
  - L305-310 Telemetría: add a sentence: "**¿Por qué no grabó? (#83, 0.2.62)**: `app.start`/`app.exit` (marcador síncrono), bloque `jornada` en el latido y `device.profile`, `autostart.changed`, `auth.logout`/`auth.session_lost`, `jornada.settings_changed`; query persona × día en `docs/TELEMETRIA.md`. `app.close` NO es cierre del proceso; la desinstalación se infiere."
  - The audio rules paragraph (~L132): append "apagado de Windows grabando: ver B5".
  - L46: see §4.

## 3. Web skill C:\maity\.claude\skills\piloto-analisis (commit W1)

**queries.sql:**
- L2: "Q0…Q9" → "Q-1…Q11b".
- After L17, add: "-- Las Q que empiezan con `with` se encadenan al encabezado cambiando ese `with` por una coma."
- Replace L288-313 (Q11). New Q11 is the validated per-person snapshot. Its CTEs:
  - `ev` (with `ts` = coalesce(occurred_at, created_at))
  - `dp`, `hb` (+ `event_data->'jornada' j`), `st` (last app.start), `ex` (last app.exit), `au` (last autostart.changed), `lo` (last auth.logout/session_lost)
- New Q11 columns: nombre, version, version_vista, canal, firma (`signature_kind`), instalada (`package_installed_at`), autostart = coalesce(au.to, st.autostart_state, dp.autostart_state), autostart_cambio ("from→to el fecha"), jornada = coalesce(hb.j, dp.d->'jornada'), ultimo_heartbeat, ultima_fase, ultimo_motivo (`hb.j->>'idle_reason'`), ultimo_arranque ("fecha (con Windows|a mano)[ tras cierre SUCIO]"), ultima_salida ("motivo fecha"), ultimo_logout, ultima_conversacion, dias_app_abierta, hb_grabando, hb_pausa, fallos_al_grabar.
- Every time window in Q11 uses `ts` rather than `created_at`.
- Add Q11b right after it: the classification above adapted to the header. Adaptations:
  - CTE names `k83`, `ev83`, `dias83`, `f83`, so they don't collide with the header's `conv`.
  - Days come from `p.j_desde…p.j_hasta` minus `p.feriados`.
  - `conv_n = (select count(*) from conv c where c.nombre = t.nombre and c.dia = d.dia)`, reusing the header's `conv`, which already filters deleted/discarded and the started_at/created_at cutoff.
  - Everything is joined by `nombre`.
  - Validated chained onto the real header on 2026-09-23.

**SKILL.md:**
- L29: "Q0…Q9" → "Q-1…Q11b".
- L75: "| Q11, Q11b | A: por qué no graba cada quien, **por día** (Q11b: tabla persona × causa con conteo de días) y qué versión tiene (Q11); en B la versión en la tarjeta y la acción, nunca el diagnóstico |".
- L185 dispatch: "Q11 + Q11b".
- Replace L149-165 with a new section titled "### Diagnóstico de quién no graba (Q11 + Q11b) — obligatorio en A". It contains:
  - (i) One sentence each on what Q11 and Q11b return.
  - (ii) A table **causa (Q11b) → lectura → acción en B**:
    - grabó → — → —
    - descartado por poco contenido → graba silencio → —
    - sin conversación guardada → A only; check Q9 / the batch queue → —
    - jornada sin configurar / apagada → "Encender la grabación de la jornada"
    - fuera de horario → "Ajustar el horario de la jornada a su horario real"
    - sin micrófono / permiso → headset / permission
    - pausada → "Reanudar Maity"
    - detenida por el usuario → "Dejar Maity grabando toda la jornada"
    - cerrada por el usuario → "Dejar Maity en la bandeja; no usar Salir"
    - sesión de Maity cerrada → "Volver a iniciar sesión"
    - registro incompleto → "Terminar el registro"
    - PC apagada / sin sesión de Windows → not Maity's issue; no action
    - sin arranque con Windows → "Activar el inicio con Windows"
    - cerrada para actualizar → "Abrir Maity después de actualizar"
    - crash / cierre forzado → A only (a bug for Maity)
    - motor no listo → A only
    - posible desinstalación → "Preguntar si Maity sigue instalada"
    - versión < 0.2.62 → "Actualizar Maity"; in A, fall back to the old heuristic (idle heartbeats with no failures = jornada off or no schedule; paused then silence = paused; mic codes = mic)
    - silencio reciente → wait
  - (iii) Keep the three current caveat bullets from L162-164: the version is the last one reported; 0.2.56 telemetry is unreliable; nobody paused in Dingler.
  - (iv) Replace L165 with: "Implementado en 0.2.62 (maity_desktop#83); contrato en `C:\maity_desktop\docs\TELEMETRIA.md` → '¿Por qué no grabó?'. Sigue sin poder saberse: desinstalación (inferida), PC apagada vs no abierta con el arranque con Windows apagado, y quién usó una PC compartida."
  - (v) Add a gotcha dated 2026-09-XX: "`app.exit` llega en el SIGUIENTE arranque: la hora es `ctx.occurred_at`; filtrar por `created_at` lo cuenta el día equivocado."

**report-a-template.md L28-33:** retitle to "## Quién no graba y por qué (Q11 + Q11b)". Keep the Q11 table and add columns "Último arranque / salida" and "Jornada". Add a second table "| Persona | Días hábiles | Grabó | <causa> … |" from Q11b. Keep the version sentence. Replace "No hay evento de desinstalación: 'sin señal' = Maity no corrió" with the new inference wording.

**Then:** `cd C:\maity && npm run gen:prompt-docs` (regenerates `lib/generated/piloto-skill.generated.ts`), then `npm test -- lib/services/prompt-docs/__tests__/prompt-docs.test.ts`.

## 4. Stale desktop copy (commit C3)

Recommendation: **replace, don't sync.** A second copy drifts by construction (it has already drifted in all 5 files), and the web copy is the one wired to `gen:prompt-docs` and `/admin/prompts`.
- `git rm` `build-report-b.mjs`, `queries.sql`, `report-a-template.md`, `report-b-skeleton.html`.
- Rewrite `.claude/skills/piloto-analisis/SKILL.md` as a stub. Same `name`/`description`/`argument-hint`, so `/piloto-analisis` still works from a desktop session. Body: "La skill canónica vive en `C:\maity\.claude\skills\piloto-analisis\` (repo web). Leer su `SKILL.md` y `queries.sql` de ahí y seguirla; los datos del piloto van a `C:\maity\docs\`. No duplicar archivos aquí."
- CLAUDE.md:46: change "Definicion: `.claude/skills/piloto-analisis/SKILL.md`" to "Definición canónica en el repo web: `C:\maity\.claude\skills\piloto-analisis\SKILL.md` (aquí solo un puntero)".
- The gitignored local `report-interno-ejemplo-dingler.html` (.gitignore:134) stays on disk untouched.
- Alternative, if the user prefers: copy the web files over the desktop ones in the same commit as W1. That drifts again at the next edit.

## 5. Ordering

1. C1 before any T1–T4 code commit. Lint (f) is then satisfied at every intermediate commit, and implementers code against the contract. If T1–T4 land first, each one must add its backticked row itself.
2. B1–B5 and T1–T4.
3. C2, which fills the placeholders.
4. C3 and W1 are independent; W1 should land after C1 so the field names are final.

No push, in either repo.

## Files to change
- `C:\maity_desktop\docs\TELEMETRIA.md` — C1: E1 header; E2 new block with 6 event rows (`app.start`, `app.exit`, `autostart.changed`, `auth.logout`, `auth.session_lost`, `jornada.settings_changed`) plus 3 notes; E3 corrected app.open/app.close row; E4 device.profile row (0.2.60 correction + 0.2.62 `jornada`, `package_installed_at`, StartupApproved); E5 `jornada` block in the heartbeat jsonc + idle_reason table + B4 note; E6 cardinality exception; E7 '¿Por qué no grabó?' query + app.start/app.exit queries + reading rules. C2: E8 runbook, E9 uninstall inference in 'Lo que NO existe todavía', E10 'Resueltos en el ciclo 0.2.62'.
- `C:\maity_desktop\docs\ONBOARDING_Y_GATES.md` — C2: L13 Logout bullet (B1: every signOut goes through AuthContext.signOut, SidebarFooterV5.tsx:37, guard, auth.logout); L23 rearm causes/messages (B3); new section after L27 'El estado del día de la jornada sobrevive al reinicio' (B4).
- `C:\maity_desktop\docs\REGLAS_AUDIO_GRABACION.md` — C2: new section before L68 'Apagado o cierre de sesión de Windows con grabación activa (0.2.62, B5)'.
- `C:\maity_desktop\docs\CANALES_DISTRIBUCION.md` — C2: new section before L21 'Updater NSIS (GitHub Releases): guardar la grabación antes de instalar (B2)'; UNVERIFIED note at L23 on how the Store closes the app and how prev_exit_clean/prev_version show it.
- `C:\maity_desktop\CLAUDE.md` — C2: L52 B2 bullet; L219 B1 append; L221 B3/B4 append; L305-310 #83 telemetry sentence; audio rules line for B5. C3: L46 points to the canonical web skill.
- `C:\maity_desktop\.claude\skills\piloto-analisis\SKILL.md` — C3: replaced by a pointer stub (same frontmatter) to C:\maity\.claude\skills\piloto-analisis\.
- `C:\maity_desktop\.claude\skills\piloto-analisis\queries.sql, build-report-b.mjs, report-a-template.md, report-b-skeleton.html` — C3: git rm (stale duplicates of the web skill).
- `C:\maity\.claude\skills\piloto-analisis\queries.sql` — W1: L2 header 'Q-1…Q11b'; chaining note after L17; replace Q11 (L288-313) with the extended per-person snapshot using ctx.occurred_at and the new events; add Q11b (person × business day classification, CTEs k83/ev83/dias83/f83, reuses the header's p/team/conv).
- `C:\maity\.claude\skills\piloto-analisis\SKILL.md` — W1: L29 file tree 'Q-1…Q11b'; L75 table row 'Q11, Q11b'; replace L149-165 with 'Diagnóstico de quién no graba (Q11 + Q11b)' (causa → lectura → acción en B table, caveats, what still cannot be known); L185 dispatch; new dated gotcha about app.exit draining at the next boot.
- `C:\maity\.claude\skills\piloto-analisis\report-a-template.md` — W1: L28-33 section retitled Q11 + Q11b, extra columns, second table person × causa, new uninstall inference wording.
- `C:\maity\lib\generated\piloto-skill.generated.ts` — W1: regenerated with `npm run gen:prompt-docs` (never hand-edited).

## Commits
- **docs(telemetria): contrato de eventos de #83 y query de por qué no grabó**
  docs/TELEMETRIA.md E1-E7. It adds the 6 new event rows with payload/status domains, the `jornada` heartbeat block and the closed idle_reason table, the device.profile fields for 0.2.62 plus the 0.2.60 correction, and the corrected meaning of app.open/app.close backed by prod numbers. It also adds the person × business-day classification query and the app.start/app.exit queries. Verify with `node frontend/scripts/lint-telemetry.js`: it passes with or without the catalog entries, because check (f) only goes catalog→doc. This commit is doc-only; run the full tauri:build:debug only if the orchestrator's policy requires it for doc commits. Must land BEFORE the T1-T4 code commits.
- **docs: reglas de logout, updater NSIS, estado de jornada y apagado de Windows (#83)** (deps: B1, B2, B3, B4, B5, T1, T2, T3, T4 commits and C1)
  ONBOARDING_Y_GATES.md (B1 L13, B3 L23, new B4 section after L27), REGLAS_AUDIO_GRABACION.md (new B5 section before L68), CANALES_DISTRIBUCION.md (new B2 section before L21 + L23 note), CLAUDE.md (L52, L219, L221, L305-310, audio rules line), and TELEMETRIA.md E8-E10 (runbook, uninstall inference, 'Resueltos en 0.2.62'). The <…> placeholders get the real names from the B1-B5/T1-T4 commits.
- **chore(skill): piloto-analisis del desktop apunta a la copia canónica del repo web**
  git rm of the 4 stale files; SKILL.md becomes a pointer stub with the same frontmatter; CLAUDE.md:46 points to C:\maity\.claude\skills\piloto-analisis\SKILL.md. The gitignored ejemplo HTML is not touched.
- **feat(skill): piloto-analisis clasifica por qué no graba cada persona cada día (Q11b, #83)** (deps: C1 (field names final))
  Web repo C:\maity. Changes: queries.sql (Q11 extended to use ctx.occurred_at and the new events, new Q11b, chaining note, header count), SKILL.md (Q11/Q11b table, new diagnosis section, dispatch, gotcha), report-a-template.md (Q11 + Q11b tables), and the regenerated lib/generated/piloto-skill.generated.ts from `npm run gen:prompt-docs`. Run `npm test -- lib/services/prompt-docs/__tests__/prompt-docs.test.ts`. Stage ONLY these four paths: the web tree has unrelated modified files (api/conversations.ts, lib/services/omi/*). No push.

## Tests
- frontend/scripts/lint-telemetry.js (run with `node frontend/scripts/lint-telemetry.js` from C:\maity_desktop): After C1 and after each T1-T4 commit: check (f) finds every catalog name backticked in docs/TELEMETRIA.md (`app.start`, `app.exit`, `autostart.changed`, `auth.logout`, `auth.session_lost`, `jornada.settings_changed`).
- C:\maity lib/services/prompt-docs/__tests__/prompt-docs.test.ts (vitest): After W1 and gen:prompt-docs: the generated module matches SKILL.md/queries.sql/report-a-template.md byte for byte.
- Supabase prod via mcp__supabase__execute_sql (SELECT only): Done 2026-09-23. The standalone classification ran for Dingler 2026-09-01..23 (16 business days × 10 people); every row landed in 'grabó'/'versión < 0.2.62'/'posible desinstalación'/'sin micrófono'/'silencio reciente' buckets. Also done: Q11b chained onto the real web header (`with`→`,`), extended Q11, the app.start query (0 rows, valid), and a synthetic VALUES check of the new-field expressions (mode+filter → 'stopped_by_user', unclean start counted, days_of_week @> 3 true / @> 6 false). Re-run once 0.2.62 data exists (see manual verification).
- Synthetic end-to-end (optional, SQL only): Replace the `ev` CTE with `select ... union all values (...)` rows that simulate: app.exit tray_quit then a silent day; app.exit os_shutdown + autostart enabled; app.start prev_exit_clean=false without a reason; heartbeat jornada enabled=false; heartbeat in_window=false; auth.logout. Assert each day gets the expected causa.

## Risks
- T1-T4 implementers pick different key names or domains (e.g. flat `jornada_enabled` instead of `jornada.enabled`, `window_close` as a reason, idle_reason keeping `rearming_next_hour`). The SQL would then silently fall through to the 'causa no identificada' / legacy buckets without erroring. → Land C1 first as the written contract and point T1-T4 at it. After 0.2.62 data exists, run a control query: `select event_data->'jornada'->>'idle_reason', count(*) … group by 1` plus a distinct over `app.exit` reasons, to catch values outside the domain.
- auth.session_lost emitted with platformLogger is lost silently: with no session the RPC returns 401 (TELEMETRIA.md:108-114). The same happens to auth.logout if it is sent after supabase.auth.signOut(). → The contract says session_lost goes through the outbox and auth.logout goes BEFORE signOut. Call this out to T4.
- app.exit written during WM_ENDSESSION may never reach SQLite, so a shutdown would be classified as a crash. → The query falls back to the next app.start.prev_exit_reason (the sync marker from T2) and only counts 'crash' when prev_exit_clean=false AND there is no reason. T2 must write the marker synchronously before the outbox, following the panics.rs pattern.
- Rows emitted before login get attributed to whoever logs in next (drain.rs resolves auth.uid() at drain time). On shared PCs this assigns app.start/app.exit/session_lost to the wrong person. → Documented in E2 and E9, and in the SKILL.md 'what cannot be known' list. No code change in T5.
- 'posible desinstalación' is a heuristic (≥7 days of silence with no later event or conversation) and currently tags 94 Dingler person-days. Reading it as fact in a report would be wrong. → The label says 'posible'; B only gets the action 'Preguntar si Maity sigue instalada'; the threshold is a parameter in `p`.
- The web commit could sweep in the unrelated dirty files (api/conversations.ts, lib/services/omi/*). → `git add` with the four explicit paths only; check with `git diff --cached --stat` before committing.
- Deleting the desktop skill files could break someone's habit of running /piloto-analisis from the desktop repo. → The stub keeps the same name/description/argument-hint and redirects to the web copy; syncing instead is offered as an alternative.
- The per-day query does 8 lateral lookups per person-day over `ev`. That is fine for pilot sizes (10 people × ~20 days, ~7k desktop rows/30 days) but slow for a whole fleet over months. → Keep `company_id` and `lookback` mandatory. For fleet-wide use, pre-aggregate into daily rows or add an index on (event_type, created_at) if needed.

## Manual verification
- After C1: `node frontend/scripts/lint-telemetry.js` → OK.
- After T1-T4 land and a local 0.2.62 debug build runs: in Supabase, `select event_type, event_data from maity.platform_logs where event_data->'ctx'->>'install_id' = '<dev install>' and event_type in ('app.start','app.exit','autostart.changed','auth.logout','jornada.settings_changed','health.heartbeat','device.profile') order by created_at desc limit 20`. Confirm the key names match the contract exactly: jornada.enabled/in_window/idle_reason, prev_exit_clean/prev_exit_reason, reason.
- Run the classification query on the dev user for a day with each staged scenario: tray Salir; Windows sign-out; turn jornada off; stop the jornada recording; kill the process in Task Manager (expect 'crash / cierre forzado' the next day). Each day should get the expected causa.
- Web: `npm run gen:prompt-docs`, then `npm test -- lib/services/prompt-docs/__tests__/prompt-docs.test.ts` passes, then `git diff --cached --stat` shows only the 4 skill/generated paths.
- Open /admin/prompts on the web (admin) and confirm the skill text shows Q11b (served from the generated module).
- Desktop: after C3, `/piloto-analisis` in a desktop session loads the stub and reads the web SKILL.md.

## Open questions
- Final names and domains in T1-T4 must match the contract in §0: the nested `jornada` object vs flat keys; the app.exit reason set (is `window_close` dropped, and are `rival_uninstall`/`other` added?); prev_exit_* naming; autostart.changed `source`. Who arbitrates if T2 chooses differently? Recommendation: C1 is the contract.
- auth.logout emitter: JS platformLogger before signOut (recommended) or Rust inside logout_cleanup (outbox, drained at the next login)? Is auth.session_lost wanted if it can only arrive at the next login?
- B4 file name and exact persisted fields, the B5 mechanism and time budget, the B2 mechanism (refuse while recording, on_before_exit hook, or both), the NSIS source for `package_installed_at`: needed to fill the C2 placeholders.
- Desktop skill copy: pointer stub (recommended) or full sync with the web copy?
- Holidays: is a per-query `feriados` array enough, or does the user want a maity.holidays table (a DB migration, out of T5 scope)?
- Is 7 days of trailing silence the right threshold for 'posible desinstalación'?

## Unverified
- How the Microsoft Store install (store_update.rs RequestDownloadAndInstallStorePackageUpdatesAsync) closes Maity: WM_ENDSESSION, WM_CLOSE or a hard terminate. The doc note is marked UNVERIFIED.
- How long Windows waits in WM_ENDSESSION before killing the app (commonly ~5 s). Not verified; the B5 section leaves the budget as a placeholder.
- Field names that T1-T4 will actually emit. The SQL was validated against the proposed contract using synthetic JSON only; no real 0.2.62 rows exist yet.
- The line numbers lib.rs:1786-1824 (Exit handler range), tray.rs:60-78, rival_install.rs:68-129, UpdateDialog.tsx ~128/210-227 and updateService.ts ~365 come from the background brief. I re-verified only lib.rs:925-926 (prevent_close), lib.rs:1795/1833 (graceful_shutdown_before_exit), lib.rs:618-632 (STARTED_AT_BOOT), tao event_loop.rs:2382-2386, updater.rs:288/836-839 and SidebarFooterV5.tsx:37.
- Whether the web `npm test -- <file>` form passes the path filter through to `vitest run` as expected; a fallback is `npx vitest run <file>`, which prompts under nightshift.