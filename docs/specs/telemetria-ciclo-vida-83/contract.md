# Contrato — telemetria-ciclo-vida-83

Contrato vinculante para los redactores de tareas de la spec `docs/specs/telemetria-ciclo-vida-83/`.
Manda sobre los informes de investigación (`areas/spec-*.md`) y sus revisiones (`areas*/verify-*.md`):
si algo choca, gana este documento. Los informes sirven para el detalle (file:line, código de referencia).

Repo: `C:\maity_desktop` (rama `main`, sin push). Rust en `frontend/src-tauri/src`, TS en `frontend/src`.
Versión actual 0.2.61; todo lo nuevo se documenta como "desde 0.2.62".

## 0. Mapa de dueños (orden de ejecución = orden de la tabla; motor SERIAL)

Decisión del usuario: **un commit por arreglo**. Varios archivos los comparten tareas **en secuencia**
(cada una depende de la anterior que toca ese archivo). Por eso la spec se ejecuta SOLO con el motor
serial (`/spec-execute telemetria-ciclo-vida-83`, sin `--parallel`) y `check-spec` reporta
"already owned" para esos archivos a propósito. Ninguna tarea puede tocar archivos fuera de su lista.

| id | parte | título (ASCII) | archivos | deps | riesgo |
|---|---|---|---|---|---|
| A1 | A | Contrato de eventos 83 en catalogo y TELEMETRIA | `frontend/src-tauri/src/logging/telemetry/catalog.rs`, `frontend/src/lib/telemetry-events.ts`, `docs/TELEMETRIA.md` | — | low |
| A2 | A | Drenado por fila y flush dirigido del outbox | `frontend/src-tauri/src/logging/telemetry/drain.rs`, `frontend/src-tauri/src/logging/telemetry/emit.rs`, `frontend/src-tauri/src/database/repositories/recording_log.rs`, `frontend/src-tauri/src/cloud_sync/session.rs` | A1 | medium |
| J1 | J | Causa del rearme y retencion de fin de sesion | `frontend/src-tauri/src/scheduled_recording/service.rs`, `frontend/src-tauri/src/lib.rs`, `frontend/src-tauri/src/rival_install.rs`, `frontend/src-tauri/src/database/commands.rs` | A2 | high |
| J2 | J | Aviso de dia cerrado y turno nocturno | `frontend/src-tauri/src/scheduled_recording/service.rs`, `frontend/src-tauri/src/scheduled_recording/schedule.rs`, `frontend/src/components/scheduled-recording/ScheduledRecordingSettings.tsx`, `docs/ONBOARDING_Y_GATES.md` | J1 | medium |
| J3 | J | Evaluar ahora evalua de inmediato | `frontend/src-tauri/src/scheduled_recording/service.rs` | J2 | low |
| J4 | J | Supresion de la jornada persistida entre reinicios | `frontend/src-tauri/src/scheduled_recording/runtime_state.rs`, `frontend/src-tauri/src/scheduled_recording/mod.rs`, `frontend/src-tauri/src/scheduled_recording/service.rs`, `docs/ONBOARDING_Y_GATES.md` | J3 | high |
| J5 | J | Instantanea del scheduler e idle_reason con transiciones | `frontend/src-tauri/src/scheduled_recording/status_snapshot.rs`, `frontend/src-tauri/src/scheduled_recording/mod.rs`, `frontend/src-tauri/src/scheduled_recording/service.rs`, `frontend/src-tauri/src/scheduled_recording/settings.rs` | J4 | medium |
| J6 | J | idle_reason y bloque jornada en health.heartbeat | `frontend/src-tauri/src/logging/commands.rs`, `frontend/src-tauri/src/logging/mem_sampler.rs`, `frontend/src/services/healthHeartbeatService.ts`, `frontend/src/services/healthHeartbeatService.test.ts` | J5 | medium |
| J7 | J | Configuracion de jornada en device.profile y settings_changed | `frontend/src-tauri/src/scheduled_recording/service.rs`, `frontend/src-tauri/src/scheduled_recording/settings.rs`, `frontend/src-tauri/src/scheduled_recording/status_snapshot.rs`, `frontend/src-tauri/src/logging/commands.rs`, `frontend/src/services/healthHeartbeatService.ts`, `frontend/src/services/healthHeartbeatService.test.ts` | J6 | medium |
| P1a | P | Estado real del autostart en canal directo | `frontend/src-tauri/src/autostart_state.rs`, `frontend/src-tauri/src/utils.rs`, `frontend/src-tauri/src/lib.rs`, `frontend/src-tauri/src/logging/commands.rs`, `frontend/src/services/healthHeartbeatService.ts` | J7 | medium |
| P1b | P | Fecha de instalacion del paquete en device.profile | `frontend/src-tauri/src/utils.rs`, `frontend/src-tauri/src/rival_install.rs`, `frontend/src-tauri/src/logging/commands.rs`, `frontend/src/services/healthHeartbeatService.ts` | P1a | medium |
| L1 | L | Marcador de ciclo de vida app.start y app.resumed | `frontend/src-tauri/src/logging/telemetry/lifecycle.rs`, `frontend/src-tauri/src/logging/telemetry/mod.rs`, `frontend/src-tauri/src/logging/telemetry/panics.rs`, `frontend/src-tauri/src/lib.rs` | P1b | high |
| L2 | L | app.exit con motivo y ExitRequested | `frontend/src-tauri/src/logging/telemetry/lifecycle.rs`, `frontend/src-tauri/src/lib.rs`, `frontend/src-tauri/src/tray.rs`, `frontend/src-tauri/src/rival_install.rs` | L1 | high |
| E1 | L | Tipo de fin de sesion de Windows via subclass | `frontend/src-tauri/src/session_end.rs`, `frontend/src-tauri/src/lib.rs`, `frontend/src-tauri/src/logging/telemetry/lifecycle.rs`, `frontend/src-tauri/Cargo.toml` | L2 | high |
| E2a | L | Flush acotado de la grabacion para fin de sesion | `frontend/src-tauri/src/audio/recording_lifecycle.rs`, `frontend/src-tauri/src/audio/recording_manager.rs`, `frontend/src-tauri/src/audio/recording_saver.rs`, `frontend/src-tauri/src/audio/incremental_saver.rs`, `frontend/src-tauri/src/audio/recording_phase.rs` | E1 | high |
| E2b | L | Fin de sesion de Windows no bloquea 30 s | `frontend/src-tauri/src/lib.rs`, `frontend/src-tauri/src/session_end.rs`, `docs/REGLAS_AUDIO_GRABACION.md` | E2a | high |
| E3 | L | Recuperacion tolera chunks truncados sin borrar audio | `frontend/src-tauri/src/audio/incremental_saver.rs`, `frontend/src/hooks/useTranscriptRecovery.ts`, `frontend/src/hooks/useTranscriptRecovery.test.ts` | E2b | high |
| U1 | U | Comando direct_update_install para el update NSIS | `frontend/src-tauri/src/direct_update.rs`, `frontend/src-tauri/src/lib.rs`, `docs/CANALES_DISTRIBUCION.md` | E3 | high |
| U2 | U | Dialogo NSIS usa direct_update_install y respeta el post-proceso | `frontend/src/components/updates/UpdateDialog.tsx`, `frontend/src/components/updates/UpdateDialog.test.tsx`, `frontend/src/services/updateService.ts`, `frontend/src/lib/postStopState.ts`, `frontend/src/hooks/useRecordingStop.ts` | U1 | high |
| L3 | L | Salidas por update de la Store registradas desde Rust | `frontend/src-tauri/src/logging/telemetry/lifecycle.rs`, `frontend/src-tauri/src/lib.rs`, `frontend/src-tauri/src/store_update.rs`, `frontend/src/components/updates/UpdateDialog.tsx`, `frontend/src/components/updates/UpdateDialog.test.tsx` | U2 | high |
| U4 | U | ACL del updater solo check y fitness test | `frontend/src-tauri/tauri.conf.json`, `frontend/src/components/updates/updaterInstall.fitness.test.ts` | L3 | medium |
| P2 | P | autostart.changed contra linea base y aviso en Ajustes | `frontend/src-tauri/src/autostart_state.rs`, `frontend/src-tauri/src/logging/telemetry/lifecycle.rs`, `frontend/src-tauri/src/lib.rs`, `frontend/src/hooks/useAutostartBootstrap.ts`, `frontend/src/components/settings/PreferenceSettings.tsx` | U4 | medium |
| S1 | S | Logout del sidebar del chat pasa por logout_cleanup | `frontend/src/shared/components/shell-v5/SidebarFooterV5.tsx`, `frontend/src/contexts/AuthContext.tsx`, `frontend/src/contexts/authSignOut.fitness.test.ts`, `docs/NUBE_CUENTAS_SYNC.md` | P2 | high |
| S2 | S | Recargar el webview no suelta al usuario en Rust | `frontend/src/contexts/AuthContext.tsx`, `frontend/src/lib/authRelease.ts`, `frontend/src/lib/authRelease.test.ts` | S1 | high |
| S3a | S | auth.logout desde logout_cleanup con flush | `frontend/src-tauri/src/logging/telemetry/auth.rs`, `frontend/src-tauri/src/logging/telemetry/mod.rs`, `frontend/src-tauri/src/lib.rs` | S2 | high |
| S3b | S | signOut con superficie desde cada boton | `frontend/src/contexts/AuthContext.tsx`, `frontend/src/components/settings/PreferenceSettings.tsx`, `frontend/src/components/Sidebar/SidebarControls.tsx`, `frontend/src/shared/components/shell-v5/SidebarFooterV5.tsx`, `frontend/src/components/Onboarding/OnboardingAccountBadge.tsx`, `frontend/src/app/(main)/layout.tsx` | S3a | medium |
| S4 | S | auth.session_lost solo en perdidas reales | `frontend/src-tauri/src/logging/telemetry/auth.rs`, `frontend/src-tauri/src/lib.rs`, `frontend/src-tauri/src/database/commands.rs`, `frontend/src/contexts/AuthContext.tsx`, `frontend/src/lib/authSessionLost.ts`, `frontend/src/lib/authSessionLost.test.ts` | S3b | high |
| S5 | S | Sesion perdida a media grabacion guarda antes de soltar | `frontend/src-tauri/src/lib.rs`, `frontend/src/contexts/AuthContext.tsx` | S4 | high |
| Z1 | Z | Reglas en CLAUDE.md y TELEMETRIA reconciliada con el codigo | `CLAUDE.md`, `docs/TELEMETRIA.md` | S5 | low |

Archivos compartidos en secuencia (intencional): `lib.rs` (J1, P1a, L1, L2, E1, E2b, U1, L3, P2, S3a, S4, S5),
`service.rs` (J1, J2, J3, J4, J5, J7), `status_snapshot.rs` (J5, J7), `scheduled_recording/mod.rs` (J4, J5),
`logging/commands.rs` (J6, J7, P1a, P1b), `healthHeartbeatService.ts` (J6, J7, P1a, P1b),
`lifecycle.rs` (L1, L2, E1, L3, P2), `logging/telemetry/mod.rs` (L1, S3a), `rival_install.rs` (J1, P1b, L2),
`utils.rs` (P1a, P1b), `session_end.rs` (E1, E2b), `incremental_saver.rs` (E2a, E3),
`autostart_state.rs` (P1a, P2), `UpdateDialog.tsx` + test (U2, L3), `AuthContext.tsx` (S1, S2, S3b, S4, S5),
`SidebarFooterV5.tsx` (S1, S3b), `PreferenceSettings.tsx` (P2, S3b), `auth.rs` (S3a, S4),
`ONBOARDING_Y_GATES.md` (J2, J4), `TELEMETRIA.md` (A1, Z1).

## 1. Nombres y esquemas compartidos (NO renombrar)

### 1.1 Eventos nuevos (8) — 3 entradas cada uno (A1 los registra todos)

| event_type | constante Rust / TS | emisor | status | cuándo |
|---|---|---|---|---|
| `app.start` | `APP_START` | Rust `logging/telemetry/lifecycle.rs`, outbox | `ok` (`warning` si el proceso anterior terminó sucio) | 1× por proceso, tras init de la DB |
| `app.exit` | `APP_EXIT` | Rust `lifecycle.rs`, outbox (insert ≤750 ms) + `flush_row` en salidas propias | `ok` | cada salida registrada |
| `app.resumed` | `APP_RESUMED` | Rust `lifecycle.rs` (ticker 60 s), outbox | `ok` | el reloj de pared saltó >180 s entre ticks (suspensión) |
| `autostart.changed` | `AUTOSTART_CHANGED` | Rust `autostart_state.rs::reconcile`, outbox | `ok` | `autostart_state` distinto de la línea base persistida |
| `auth.logout` | `AUTH_LOGOUT` | Rust `logout_cleanup` (lib.rs) vía `logging/telemetry/auth.rs`, outbox + `flush_row` 3 s | `ok` | logout pedido por el usuario |
| `auth.session_lost` | `AUTH_SESSION_LOST` | comando Rust invocado desde JS, outbox | `warning` | SIGNED_OUT que el usuario no pidió, o arranque sin sesión con marca de login previa y error NO reintentable |
| `jornada.settings_changed` | `JORNADA_SETTINGS_CHANGED` | Rust `ScheduledRecordingService::update_settings`, outbox | `ok` | cambió algún campo de `JornadaConfig` (diff guard) |
| `jornada.idle_reason_changed` | `JORNADA_IDLE_REASON_CHANGED` | Rust scheduler (`service.rs`), outbox | `ok` | cambió `idle_reason` (ignorando `pending`/`initializing`), tope 200/proceso |

Constantes en `catalog.rs` en un bloque nuevo `// ── Ciclo de vida del proceso, sesión y jornada (emisor: Rust; #83, desde 0.2.62) ──`
(`pub const X: &str = "a.b";`, una por línea, sin `// legacy`). Gemelas TS una línea cada una en
`telemetry-events.ts`. Columna `session_id` de todos = `context::process_session_id()`.

### 1.2 `health.heartbeat`: campos nuevos (AMBOS emisores: JS y nativo)

```jsonc
"idle_reason": null | "<IDLE_REASON>",          // top-level; tabla 1.3
"jornada": null | {                              // null = scheduler aún no inicializado
  "enabled": true, "configured_by_user": true, "loop_running": true,
  "scheduler_phase": "disabled|idle|armed|recording|grace",
  "in_window": true,                             // pertenencia al horario; IGNORA enabled (igual que ScheduledStatus.in_window)
  "skip": null | "<SkipReason::as_str>",         // strings existentes + "closed_for_day"
  "rearm_cause": null | "user_stop|auto_close|session_end",   // solo mientras el rearme está vigente
  "rearm_until": null | "YYYY-MM-DDTHH:MM:SS",   // hora LOCAL de la PC
  "backoff": null | { "code": "mic_not_found|mic_permission_denied|mic_in_use|mic_format_unsupported|audio_unknown",
                      "consecutive": 1, "halted_for_day": false },
  "settings_load": "ok|missing|error"
}
```
`jornada` es estado dinámico (segunda excepción de cardinalidad, documentada en TELEMETRIA.md). El
horario estático NO va en el latido: vive en `device.profile.jornada` y en `jornada.settings_changed`.

### 1.3 `idle_reason` — dominio cerrado (primera fila que aplica gana)

| fase de grabación | condición | valor |
|---|---|---|
| recording / starting / stopping | — | `null` |
| paused | — | `paused_by_user` |
| idle | snapshot del scheduler ausente | `initializing` |
| idle | `!enabled && !configured_by_user` | `jornada_unconfigured` |
| idle | `!enabled` | `jornada_off` |
| idle | `!loop_running` | `scheduler_stopped` |
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

`pub const IDLE_REASONS: &[&str]` en `status_snapshot.rs` con los 16 valores no nulos; un test verifica que
`idle_reason()` solo devuelve valores de ahí. `transcription_not_ready` NO se usa en telemetría (esconde
`mic_in_use`); el string de la UI (`SkipReason::as_str`) no cambia.

### 1.4 `device.profile`: campos nuevos (desde 0.2.62)

- `jornada`: `null | JornadaConfig` = `{enabled, configured_by_user, windows: [{days_of_week (ISO 1=lunes), start_time "HH:MM", end_time "HH:MM"}] (máx 3), windows_count, auto_close_enabled, auto_close_time, hourly_rotation_enabled, grace_period_minutes}` (hora LOCAL de la PC).
- `autostart_state`: en canal directo ahora puede valer `disabledByUser` (Task Manager) con el MISMO predicado que auto-launch 0.5.0.
- `autostart_disabled_at`: `null | rfc3339` (FILETIME de `StartupApproved\Run`, bytes 4..12, solo si la cola no es cero).
- `autostart_mechanism`: `startup_task | run_key | plugin`.
- `package_installed_at`: `null | rfc3339`; `package_installed_at_source`: `null | package | nsis_uninstall_key` ("instalada o ACTUALIZADA por última vez").
- El JS re-emite `device.profile` (sin fijar el latch) mientras `jornada` sea `null`, máx. 3 ticks.

### 1.5 Marcador de ciclo de vida

Archivo `lifecycle.json` (release) / `lifecycle-debug.json` (`cfg!(debug_assertions)`) en `app.path().app_local_data_dir()`.
Escritura con `std::fs`: `.tmp` + `sync_all` (si durable) + `rename`; si el rename falla, reintento a los 20 ms y
luego escritura in-place + `sync_all`. Un solo `static MARKER: std::sync::Mutex<Option<MarkerSlot>>`; el lock
cubre la E/S (documentado); nunca `log::error!` en el módulo (bridge), `warn!` fuera del lock y con rate-limit.
Campos desconocidos se ignoran (sin `deny_unknown_fields`); `#[serde(default)]` en todo.

```jsonc
{ "schema": 1, "proc_session_id": "proc-…", "version": "0.2.62", "build": "release|debug",
  "build_channel": "store|direct", "started_at_ms": 0, "last_alive_ms": 0, "os_boot_ms": null,
  "exit": null | { "reason": "…", "detail": null, "exit_code": null, "begun_at_ms": 0, "done_at_ms": null,
                   "recording_active": false, "session_end_kind": null, "critical": false },
  "exit_intent": null | { "reason": "update|session_end", "via": "store_button|store_api|nsis|null",
                          "detail": null, "target_version": null, "at_ms": 0 },
  "last_resume": null | { "suspended_at_ms": 0, "resumed_at_ms": 0, "gap_s": 0 },
  "last_autostart_state": null,                 // se ARRASTRA entre arranques (P2)
  "last_login_user": null | { "maity_user_id": "…", "since_ms": 0 }   // se ARRASTRA entre arranques (S4)
}
```
Rotación: al arrancar se lee el anterior y se escribe el nuevo **al inicio de `setup()`** (antes del init de la DB,
para que un cuelgue de la DB aparezca como "arrancó y nunca vivió"); el resumen del anterior queda en un `OnceLock`
y `app.start` se emite (spawn) **después** del init de la DB. Las intenciones NO caducan por edad: toda intención
no borrada pertenece al proceso anterior. Marcador de otro `build_channel` ⇒ `marker_status: "foreign"` y se ignora.

### 1.6 Payloads

- **`app.start`**: `{lifecycle_schema:1, build, build_channel, started_at_boot, autostart_state, started_at, os_boot_at,
  first_run, marker_status: ok|missing|corrupt|foreign, prev_session_id, prev_version, prev_version_source: marker|outbox|null,
  version_changed, prev_started_at, prev_last_alive_at, prev_uptime_s, prev_exit_reason, prev_exit_detail,
  prev_exit_source: observed|intent|inferred|null, prev_exit_clean (null = sin marcador: primer arranque o upgrade desde <0.2.62),
  prev_exit_interrupted (exit.begun sin done), prev_recording_active_at_exit, prev_panicked, prev_panic_count,
  os_rebooted_since_prev, downtime_s, clock_skew}`. `prev_version` nunca `'unknown'` (lint d): `null`.
- **`app.exit`**: `{lifecycle_schema:1, reason, detail, exit_code, uptime_s, recording_active, recording_phase, session_end_kind, critical, build}`.
- **`app.resumed`**: `{suspended_at, resumed_at, gap_s}` (rfc3339).
- **`autostart.changed`**: `{from, to, trigger: boot|settings_toggle|bootstrap, mechanism, disabled_at}`.
- **`auth.logout`**: `{reason:"user", surface: settings|sidebar|chat_sidebar|onboarding_badge|account_error|unknown, maity_user_id, recording_was_active, recording_phase}`.
- **`auth.session_lost`**: `{source: webview_signed_out|boot_no_session, maity_user_id, recording_was_active, error_name}`.
- **`jornada.settings_changed`**: `{from: JornadaConfig, to: JornadaConfig, changed: [nombres de campo]}`.
- **`jornada.idle_reason_changed`**: `{from: IDLE_REASON|null, to: IDLE_REASON|null, recording_phase, jornada: <bloque 1.2>}`.

### 1.7 Motivos de salida (`app.exit.reason` y `app.start.prev_exit_reason`)

Observados (los escribe `begin_exit` en el marcador ANTES de cualquier otra cosa):
`tray_quit` · `rival_install` · `update` (detail `store_button|store_api|nsis`) · `restart` (ExitRequested con RESTART_EXIT_CODE) ·
`app_exit` (ExitRequested `Some(code)` sin motivo propio) · `last_window_closed` (ExitRequested `None`: regresión tipo 0.2.57) ·
`os_session_end` (detail `logoff|shutdown|unknown`, `critical`) · `external_close` (Restart Manager `CLOSEAPP` SIN apagado del sistema:
instalador/desinstalación) · `loop_destroyed` (WM_QUIT u otra causa rara) · `process_exit_after_cleanup` (centinela: salió sin RunEvent::Exit).
Solo inferidos al arrancar: `update` (intención pendiente), `crash_panic` (pánico en el hilo `main` durante la vida del proceso),
`os_restart_unclean` (cambió `os_boot` sin salida registrada; Fast Startup lo debilita), `unclean` (matado / crash nativo / "Apagar de todos modos").
Precedencia en `summarize_prev`: exit observado (si es `os_session_end`/`external_close` y hay intención `update` ⇒ `update` con el detail de sesión) →
intención pendiente → `crash_panic` → `os_restart_unclean` → `unclean`.

### 1.8 APIs Rust compartidas (firmas fijas)

- A2: `emit::emit_event_with_id(app, session_id, event_type, payload, status, error, meeting_id) -> Option<i64>`;
  `drain::flush_row(app, id: i64, budget: Duration) -> FlushOutcome` (`Sent|AlreadySynced|NoSession|TokenStale|Timeout|Rejected(u16)|Network`);
  `drain::set_exiting()`; `cloud_sync::session::token_if_fresh(app) -> Option<String>` (nunca refresca);
  `RecordingLogRepository::{get_by_id, last_app_version_excluding_session}`.
- J1: `ScheduledRecordingService::begin_session_end(&self)` / `cancel_session_end(&self)` (async: el rearme vive en un tokio RwLock); bandera estática sin lock `scheduled_recording::service::mark_session_ending()` / `clear_session_ending_flag()` (síncronas; la llama primero toda ruta de salida); `cancel_session_end` también se llama en `set_current_user` (None→Some) y al final de `clear_current_user`; tipos `RearmCause`, `Rearm`, `CloseTrigger`.
- J5: `status_snapshot::heartbeat_fields(rec: RecordingPhase, now: NaiveDateTime) -> (Option<&'static str>, Option<JornadaTelemetry>)`, `IDLE_REASONS`.
- J7: `status_snapshot::jornada_config() -> Option<JornadaConfig>`.
- P1a: `autostart_state::current(app) -> AutostartSnapshot {state, disabled_at, mechanism}`; `utils::filetime_ticks_to_rfc3339(u64) -> Option<String>`.
- L1: `lifecycle::rotate_at_boot(app)`, `lifecycle::emit_start(app)`, `swap_last_autostart_state(&str) -> Option<String>`,
  `set_last_login_user(&str)`, `peek_last_login_user()`, `take_last_login_user()`.
- L2: `lifecycle::note_exit_requested(Option<i32>)`, `begin_exit(Option<ExitHint>) -> Option<ExitRecord>`,
  `emit_exit_row(app, &ExitRecord, timeout: Duration) -> Option<i64>` con `EXIT_ROW_TIMEOUT` = 750 ms (salidas normales) y `EXIT_ROW_TIMEOUT_SESSION_END` = 400 ms (rama de fin de sesión), `finish_exit()`.
- E1: `session_end::install(&WebviewWindow)`, `session_end::observed() -> Option<SessionEndInfo>`,
  `lifecycle::note_session_ending(kind)`, `lifecycle::clear_session_ending()`.
- E2a: `recording_lifecycle::flush_recording_for_session_end(t0, SessionEndBudgets) -> SessionEndFlushReport`;
  `recording_phase::set_session_ending()` (StartGate::acquire se niega mientras esté puesto).
- L3: comando `exit_for_update`; `lifecycle::record_update_intent(via, target_version)`, `clear_update_intent()`.

### 1.9 Reglas transversales

- Protocolo de build: toda tarea de código cierra con `npm run tauri:build:debug` exit 0 (10-20 min: correr en
  background con log y `EXIT=$?`). Los tests `#[cfg(test)]` NO los compila el build: correr `cargo test --lib <módulo>`.
- **Guard de shell**: NINGÚN comando Bash, título ni mensaje de commit puede contener la palabra que empieza con
  "shut" y termina con "down" (el nombre de la API de Windows y de `graceful_..._before_exit`): usar Edit/Grep/Read y decir
  "apagado"/"fin de sesión". Nada de `python -c`/`node -e`.
- `.lock().unwrap()` prohibido; tokio RwLock: snapshot en statement propio, nada de `if let` sobre un guard.
- Sin eventos Tauri nuevos (solo comandos; los comandos propios no necesitan capability: no hay AppManifest).
- El callback de `onAuthStateChange` sigue SÍNCRONO: invocaciones diferidas con `setTimeout(…, 0)`, sin `await`.
- Frontend: `logger` de `@/lib/logger`, nunca `console.*` nuevo.
- Rama de respaldo (Guardian) la crea Julio antes de ejecutar: `git branch backup/2026-09-23-telemetria-83`.
- Sin `git push`. Commits con el mensaje exacto del plan (Conventional Commits en español + ` (S1)`).

### 1.10 Criterios de aceptación (definidos en spec.md)

AC-1 contrato registrado · AC-2 drenado sin duplicados + flush dirigido · AC-3 salir/cerrar sesión no suprime la jornada ·
AC-4 día cerrado + turno nocturno · AC-5 Evaluar ahora inmediato · AC-6 supresión persistida · AC-7 latido con idle_reason/jornada +
transiciones · AC-8 config de jornada + settings_changed · AC-9 autostart real + fecha de instalación · AC-10 app.start/app.resumed ·
AC-11 app.exit con motivo · AC-12 fin de sesión acotado · AC-13 recuperación robusta · AC-14 update NSIS seguro · AC-15 update Store
registrado · AC-16 autostart.changed + aviso · AC-17 todo logout por signOut · AC-18 recarga no suelta al usuario · AC-19 auth.logout /
session_lost · AC-20 sesión perdida guarda · AC-21 build + tests por tarea · AC-22 query de clasificación · AC-23 docs de reglas ·
AC-24 matriz E2E manual.

## 2. Parte A — Contrato y drenado

### 2.1 A1 — contrato en catálogo y TELEMETRIA.md (solo docs + constantes)
- `catalog.rs` + `telemetry-events.ts`: las 8 constantes de 1.1 (TS una línea cada una, sin reformatear).
- `docs/TELEMETRIA.md`: cabecera (última actualización #83 / 0.2.62); bloque nuevo "Ciclo de vida del proceso, sesión y jornada
  (desde 0.2.62, #83)" con la tabla de los 8 eventos (payloads de 1.6) y notas (app.exit se drena al siguiente arranque; hora real
  `ctx.occurred_at`; marcador = verdad, fila = best-effort; filas pre-login se atribuyen al siguiente login); corregir la fila
  `app.open`/`app.close` (montaje del documento / ventana a la bandeja; recargas; cifras de prod 30 d: 203 open, 13 con referrer,
  41 close, 9 procesos vivos >10 min tras su close); fila `device.profile` ("Desde 0.2.60" en vez de 0.2.59 + campos 1.4); bloque
  jsonc del latido (1.2) + tabla `idle_reason` (1.3); excepción de cardinalidad; tabla de motivos de salida (1.7); query
  "¿Por qué no grabó? — persona × día hábil" + queries de `app.start`/`app.exit`; runbook "un manager pregunta por qué X no grabó";
  "Lo que NO existe": desinstalación inferida; "Resueltos en el ciclo 0.2.62 (#83)" (redactado como contrato: "desde 0.2.62").
- Reglas de la query (vinculantes): hora `coalesce(ctx.occurred_at, created_at)`; `user_id in (u.id, u.auth_id)` pero atribución
  preferente por `event_data->>'maity_user_id'` cuando exista; comparar versiones como `int[]`; dedupe por
  `(ctx.session_id, event_type, ctx.occurred_at)`; línea de tiempo preferente = `jornada.idle_reason_changed` (outbox, sobrevive
  sin red) y luego latidos; dimensión parcial `motivo_parcial` en días que grabaron (pausada / detenida / cerrada temprano);
  "sesión de Maity cerrada" SOLO con `auth.logout`/`auth.session_lost` o `idle_reason='no_session'` (nunca por `hb=0`); una causa
  explícita previa (logout, tray_quit) gana a "posible desinstalación"; el fallback de versión es `not ant_nueva` (sin exigir
  `sig_start is null`); `days_of_week` solo si `windows_count = 1`; `app.resumed`/huecos del mismo proceso ⇒ "PC suspendida".
  Causas de salida: grabó · grabó parcial (pausada/detenida/cerrada temprano) · jornada sin configurar · jornada apagada · fuera de
  horario · sin micrófono/permiso · pausada · detenida por el usuario · cerrada por el usuario · sesión de Maity cerrada ·
  registro incompleto · PC apagada/suspendida/sin sesión de Windows · sin arranque con Windows · cerrada para actualizar ·
  crash/cierre forzado · falla al arrancar · posible desinstalación · versión < 0.2.62 · silencio reciente.
- Validar la query en prod con `mcp__supabase__execute_sql` (cargar con ToolSearch `select:mcp__supabase__execute_sql`):
  SOLO SELECT, `LIMIT` chicos; debe correr sin error (hoy todo cae en buckets legacy). Base: `areas/spec-docs-sql-T5.md` §1 E7
  corregida por `areas2/verify-docs-sql-T5.md`.
- NO toca el repo web (`C:\maity`): Q11 va como issue del repo web (fuera de la spec).

### 2.2 A2 — drenado por fila y flush dirigido
- `drain_once`: marcar cada fila en cuanto recibe 2xx (`mark_as_synced(&[id])`), no al final del lote; `static INFLIGHT:
  std::sync::Mutex<HashSet<i64>>` de filas reclamadas (guard RAII que las libera); saltarse las reclamadas.
- `flush_row(app, id, budget)`: deadline; si la fila ya está sincronizada ⇒ `AlreadySynced`; si la tiene el loop ⇒ esperar
  (poll 50 ms) hasta el deadline; si no, reclamarla, token con `token_if_fresh` (sin refresh: cancelar un refresh a mitad de salida
  perdería el refresh_token rotado), POST con `.timeout(restante)`, marcar al 2xx.
- `static EXITING: AtomicBool` + `set_exiting()`: con EXITING, `drain_once` retorna sin hacer nada (no refresca ni postea en salida).
- `emit.rs`: `write_to_outbox` devuelve `Option<i64>` (rowid de `log_event`, recording_log.rs:35); `emit_event_with_id`;
  `emit_event` delega y descarta el id (ningún llamador cambia).
- `recording_log.rs`: `get_by_id`, `last_app_version_excluding_session(pool, proc_session_id)` (guardado con `json_valid`),
  tests con `setup_pool` (max_connections 1) + `sqlx::migrate!`.
- `session.rs`: `token_if_fresh` con `decide_token_action == Reuse`.
- Lint (a) intacto: `insert_platform_log` solo en drain.rs. Base: `areas/spec-lifecycle-T2.md` §(f) + `areas2/verify-autostart-logout-T3-T4-B1.md` (drain) + `plan-agent-review.md` #2.

## 3. Parte J — Jornada

### 3.1 J1 — causa del rearme y retención de fin de sesión (bug: logout+login deja la jornada apagada hasta medianoche)
- `rearm_at: Option<NaiveDateTime>` ⇒ `rearm: Option<Rearm { until, cause: RearmCause, set_at }>`; `RearmCause::{UserStop, AutoClose, SessionEnd}`
  (`as_str` = user_stop|auto_close|session_end); `Serialize/Deserialize` para J4.
- Escritores: paro del usuario (L689) y carrera de rotación (L939) ⇒ `UserStop` (next_hour_boundary); `close_scheduled` recibe
  `trigger: CloseTrigger::{AutoClose, SessionEnd}`: `AutoClose` (desde `evaluate_tick` L547) ⇒ rearme `AutoClose`
  (hasta `start_of_next_day` por ahora; J2 lo cambia); `SessionEnd` ⇒ NO escribe rearme de día.
- `session_ending: Arc<AtomicBool>` en `SchedulerShared`; `begin_session_end()`: pone el flag y un rearme en memoria
  `SessionEnd` (until = now + 15 min), idempotente; `cancel_session_end()` lo quita. `close_owned_segment_for_exit` pone la
  retención ANTES del stop (snapshot owned_since → hold → `owned=false` → `close_scheduled(…, SessionEnd)`).
- `graceful_shutdown_before_exit` (lib.rs) llama `begin_session_end()` como PRIMERA sentencia (antes del early return
  `!is_recording()`), vía `try_state` + `read()` con timeout 200 ms (nunca bloquear la salida). `rival_install.rs`: si
  `launch_detached_uninstaller` falla, `cancel_session_end()`.
- En `evaluate_tick`, tras el early return de `!enabled`: si hay retención `SessionEnd` ⇒ liberarla cuando `!has_session` o venció el
  tope (y limpiar el flag); mientras siga vigente ⇒ `return (Armed, None)` sin mutar nada (sin toast). Así un logout+login reanuda en ≤30 s.
- Tests puros: `rearm_for_close(trigger, now)`, `should_release_hold(rearm, has_session, now)`, que el trigger de salida nunca produce
  `AutoClose`. Base: `areas/verify-jornada-telemetry-B3.md` #1, `areas2/verify-jornada-persist-B4.md` #1, `plan-agent-review.md` P0-1.

### 3.2 J2 — aviso de día cerrado y turno nocturno (B3 + bug nuevo)
- `SkipReason::ClosedForDay` (`as_str` "closed_for_day", mensaje "La jornada de hoy ya se cerró; la grabación se reanudará en tu
  siguiente horario."); el arm en ventana devuelve `ClosedForDay` para causa `AutoClose` y `RearmingNextHour` para `UserStop`.
- Hasta cuándo dura `AutoClose`: `schedule::next_fire_at(now, settings).unwrap_or(start_of_next_day(now))` (turno 22–06 que cierra a
  las 06:00 ya no se come 22:00–00:00). Mover `start_of_next_day` a `schedule.rs` (pub).
- UI: pista de cierre automático en `ScheduledRecordingSettings.tsx` ("Tras el cierre, la jornada no vuelve a arrancar hasta tu siguiente horario.").
- `ONBOARDING_Y_GATES.md:23`: `rearm` con causa; mensajes por causa.
- Tests: mapeo causa→skip; mensaje sin "siguiente hora"; tabla de `until` para ventana diurna, nocturna y viernes→lunes.

### 3.3 J3 — "Evaluar ahora" inmediato
- `CheckNow` (service.rs:~487): `tick.reset_immediately()` en vez de `reset()` (tokio 1.49 `reset` = now + period).

### 3.4 J4 — supresión persistida entre reinicios (B4)
- Nuevo `scheduled_recording/runtime_state.rs`: archivo `scheduled_recording_runtime.json` en `app_local_data_dir`; solo persisten
  `UserStop` y `AutoClose` (`PersistedCause` sin `SessionEnd`: irrepresentable en disco); formato `{version:1, rearm:{cause, until, set_at}}`;
  escritura atómica tmp+rename serializada por `persist_lock` (tokio Mutex propio); `set_rearm` = ÚNICO escritor de `shared.rearm`,
  toca disco solo si cambia la proyección persistible y NUNCA mientras `session_ending`.
- `restore(content, now)` puro: corrupt/inconsistent/expired/clock_moved_back ⇒ borrar; `future_version` ⇒ ignorar SIN borrar;
  UserStop: `until == next_hour_boundary(set_at)`, span ≤1 h; AutoClose: `set_at < until ≤ set_at + 8 d`; `now >= set_at − 10 min`;
  `until − now ≤ span + 10 min`. Carga en `initialize()` antes del loop. No se persiste back-off. Sin `observe_stop_before_exit`.
- Doc: sección "Supresión de la jornada persistida (0.2.62)" en ONBOARDING_Y_GATES.md (qué se persiste, dónde, validación,
  "toda ruta de salida marca session_ending antes de detener", CheckNow/guardar solo levantan el back-off).
- Base: `areas/spec-jornada-persist-B4.md` + correcciones de `areas/verify-jornada-persist-B4.md` y `areas2/verify-jornada-persist-B4.md`.

### 3.5 J5 — instantánea del scheduler, idle_reason y transiciones
- Nuevo `scheduled_recording/status_snapshot.rs`: `static SLOT: std::sync::Mutex<Option<Slot>>` (patrón `mem_sampler::LAST_SAMPLE`);
  publicado por `initialize`, `start` (generación del loop +1), `stop`, `update_settings` y el tick (tras escribir la fase, TODOS los ticks);
  `publish_tick(gen, …)` ignora generaciones viejas. Lectores nunca tocan el RwLock del servicio.
- `StartBackoff` gana `code: &'static str` = `classify_device_error(raw).code()` en `record_start_failure`.
- `idle_reason(rec, view)` puro según 1.3 + `IDLE_REASONS`; `heartbeat_fields(rec, now)` (1.2).
- `jornada.idle_reason_changed`: el servicio calcula `idle_reason` tras cada publicación y emite (outbox) cuando cambia respecto del
  último emitido; `pending`/`initializing` no se emiten ni reemplazan el último valor; tope 200/proceso.
- `SkipReason` y `StartFailureKind` pasan a `pub(crate)`. Base: `areas/spec-jornada-telemetry-B3.md` Commit 2 + ambas revisiones.

### 3.6 J6 — latido
- `HealthSnapshot` gana `idle_reason` + `jornada` (3 literales + tests de claves); `get_health_snapshot` los llena con `heartbeat_fields`
  (sin AppHandle); `emit_native_heartbeat` igual; el JS los recoge en el payload; interfaces TS; test de paso en `healthHeartbeatService.test.ts`.

### 3.7 J7 — configuración de jornada
- `JornadaConfig` (1.4) + `From<&ScheduledRecordingSettings>` + `changed_fields` puro; `ScheduleWindow` deriva `PartialEq`.
- `update_settings`: diff calculado bajo `shared.settings.write()`, emisión (spawn, outbox) tras soltar el guard, solo si hay cambios.
- `DeviceProfile.jornada` (Rust) + tipo TS; el JS no fija el latch de `device.profile` mientras `jornada` sea null (máx 3 ticks).

## 4. Parte P — Autostart e instalación

### 4.1 P1a — autostart real en canal directo
- Nuevo `autostart_state.rs` (`mod autostart_state;` en lib.rs + comando `autostart_get_state` registrado): `current(app)`:
  MSIX ⇒ StartupTask (como hoy, mecanismo `startup_task`); directo Windows ⇒ predicado EXACTO de auto-launch 0.5.0: valor `Run`
  REG_SZ (`get_value::<String>`) presente Y (`StartupApproved\Run` ausente, len<8 o últimos 8 bytes cero) ⇒ `enabled`; `Run` presente
  y cola no cero ⇒ `disabledByUser` + `disabled_at` (FILETIME bytes 4..12); sin `Run` ⇒ `disabled`; mecanismo `run_key`; otros SO ⇒ plugin.
- `utils::filetime_ticks_to_rfc3339`; `get_device_profile` usa `current()` y agrega `autostart_disabled_at`, `autostart_mechanism`; espejo TS.
- Tests: tabla `classify_direct`, conversión FILETIME. Base: `areas/spec-autostart-logout-T3-T4-B1.md` §6 + revisiones.

### 4.2 P1b — `package_installed_at`
- `utils::package_installed_at()`: MSIX `Package::Current().InstalledDate()` dentro del mismo `with_mta` que `signature_kind`;
  directo: last-write de `Uninstall\Maity` (HKCU y luego HKLM; `NSIS_UNINSTALL_SUBKEY` pasa a `pub(crate)`); dev ⇒ None.
- `DeviceProfile.package_installed_at` + `_source`; espejo TS.

### 4.3 P2 — `autostart.changed`
- `reconcile(app, trigger)` con `RECONCILE_LOCK`: snapshot `current()`; previo = `lifecycle::swap_last_autostart_state` (marcador 1.5);
  `decide_change(prev, cur)` puro (sin previo ⇒ solo línea base; igual ⇒ nada); emitir con `emit_event_with_id` y avanzar la línea base
  solo si la fila quedó en el outbox. Disparadores: `boot` (desde `lifecycle` al emitir `app.start`), `settings_toggle`
  (PreferenceSettings tras cada toggle OK), `bootstrap` (useAutostartBootstrap tras `enable()`: evento disabled→enabled esperado en
  instalación nueva). Comando `autostart_reconcile(trigger)` con allowlist.
- PreferenceSettings: en canal directo, si `autostart_get_state` dice `disabledByUser`, aviso ámbar ("Lo desactivaste desde el
  Administrador de tareas de Windows; si lo activas aquí se vuelve a habilitar.").
- Documentar (en Z1) que `autostart_toggled` (Analytics.track) ya existía para toggles en la app.

## 5. Parte L — Ciclo de vida del proceso y salidas

### 5.1 L1 — marcador, `app.start`, `app.resumed`
- Nuevo `logging/telemetry/lifecycle.rs` (declarado en `logging/telemetry/mod.rs`): marcador 1.5, `rotate_at_boot` al inicio de
  `setup()` (lib.rs), `emit_start` (spawn) tras el init de la DB; `summarize_prev` puro (1.6/1.7); `prev_version` por marcador o,
  en release y sin marcador, por `last_app_version_excluding_session` (fuente `outbox`); `os_boot_ms` de `sysinfo::System::boot_time()`.
- `panics.rs`: `pub(crate)` del nombre/ruta del archivo, `parse_panic_ts` puro, y el hook agrega `thread` (nombre del hilo) a cada línea;
  `crash_panic` solo si hubo pánico del hilo `main` dentro de `[started_at, last_alive + 120 s]`; los demás ⇒ `prev_panicked` + `unclean`.
- Ticker propio de 60 s: `last_alive_ms` (no durable); si el reloj de pared saltó >180 s ⇒ `last_resume` en el marcador + evento `app.resumed`.
- `app.start` incluye `autostart_state` (vía `autostart_state::current`) y `started_at_boot` (`crate::STARTED_AT_BOOT`).
- Accesores arrastrados: `swap_last_autostart_state`, `set/peek/take_last_login_user`.
- Tests: `parse_marker`, `summarize_prev` (tabla de casos: missing, fallback outbox, observado, intención, pánico main vs no-main,
  os_boot cambió, sucio, clock skew, foreign), escritura atómica en `tempdir`. Base: `areas/spec-lifecycle-T2.md` (a)-(c) + `areas3/verify-lifecycle-T2.md`.

### 5.2 L2 — `app.exit` y `ExitRequested`
- `.run` pasa a `match`: `ExitRequested { code, .. }` ⇒ `note_exit_requested(code)` (sin `prevent_exit`); `Exit` ⇒ `begin_exit(None)`
  PRIMERO (marcador durable con `begun_at_ms` + `drain::set_exiting()`), luego `emit_exit_row` (≤750 ms), luego el camino actual SIN
  cambios, al final `finish_exit()` (`done_at_ms`).
- Clasificación pura `classify_exit`: hint propio gana; `Programmatic(RESTART_EXIT_CODE)` ⇒ `restart`; `Programmatic(c)` ⇒ `app_exit`;
  `UserInteraction` ⇒ `last_window_closed`; `NotSeen` ⇒ `os_session_end` si `GetSystemMetrics(SM_SHUTTINGDOWN) != 0`
  (extern `user32`, sin feature nueva) con detail `unknown`, si no `loop_destroyed`. (E1 agrega el tipo exacto.)
- Salidas propias: bandeja (`begin_exit(TrayQuit)` + fila ANTES del stop, `flush_row` 3 s DESPUÉS del stop, luego `exit(0)`);
  rival (tras `launch_detached_uninstaller` OK y ANTES de `db.cleanup()`: begin_exit + fila, sin flush).
- Centinela: un `Resource` en `app.resources_table()` cuyo `Drop`, si `EXIT_BEGUN` sigue en false, escribe el bloque exit
  `process_exit_after_cleanup` (cubre `cleanup_before_exit` sin RunEvent::Exit).
- Tests: tabla `classify_exit`, emit-once. Base: `areas/spec-lifecycle-T2.md` (d)-(g) + `areas3/verify-lifecycle-T2.md`.

### 5.3 E1 — tipo de fin de sesión de Windows
- Nuevo `session_end.rs` (`pub mod session_end;` en lib.rs; `install` en setup tras el hook de la ventana main): `SetWindowSubclass`
  (ya disponible por `Win32_UI_Shell`) en el HWND de `main` (conversión como store_update.rs:78-92), id `0x4D41_4954`; QES ⇒ registrar
  tipo + `lifecycle::note_session_ending(kind)`; ES(FALSE) ⇒ limpiar + `clear_session_ending()` (borra la intención solo si es `session_end`);
  ES(TRUE) ⇒ `record_if_absent` (reemplaza registros más viejos que el TTL de 120 s); WM_NCDESTROY ⇒ quitar subclass; siempre
  `DefSubclassProc`; `catch_unwind` alrededor del cuerpo. La misma subclass se aplica a las demás ventanas top-level del hilo (incluida la oculta de tao que dispara `loop_destroyed`) vía `EnumThreadWindows`; una intención `session_end` con detail `close_app` se resume como `external_close`.
- `classify(lparam, shutting_down)` puro: CLOSEAPP con apagado ⇒ `Logoff` si hay bit LOGOFF, si no `Shutdown` (+ `close_app:true`);
  CLOSEAPP sin apagado ⇒ `CloseApp` (Restart Manager); LOGOFF ⇒ `Logoff`; resto ⇒ `Shutdown`; `critical` por bit.
  `observed()`: registro fresco o fallback `SM_SHUTTINGDOWN`. `lifecycle::classify_exit` lo usa: `os_session_end` (detail
  logoff|shutdown|unknown) o `external_close` (CloseApp sin apagado).
- Constantes WM_* / ENDSESSION_* / SM_SHUTTINGDOWN: preferir literales + extern `user32` (sin feature nueva); `Cargo.toml` solo si el
  implementador opta por `Win32_UI_WindowsAndMessaging` (y lo justifica). Tests: tabla `classify`, celda con TTL, constantes vs windows (cfg windows).
- Base: `areas/spec-session-end-B5.md` §2 + `areas/verify-session-end-B5.md` #1.

### 5.4 E2a — flush acotado (capa de grabación, todavía sin cablear)
- `recording_phase.rs`: `static SESSION_ENDING: AtomicBool` + `set_session_ending()`; `StartGate::acquire` se niega mientras esté puesto
  ("session ending").
- `flush_recording_for_session_end(t0, budgets)`: StopGate (si no ⇒ NotRecording) → tomar el manager → `stop_streams_and_force_flush`
  (acotado) → `recording_saver.flush_for_session_end(soft, hard)` (prelude de quiesce extraído de `stop_and_save`: 5 s normal / ≤1 s
  aquí; `transcripts.json` temprano; `incremental_saver.flush_for_session_end`: checkpoint final solo si obtiene el slot antes de
  `soft`, espera hasta `hard`; un chunk fallido se RENOMBRA a `.failed`, nunca se borra; nunca merge ni `remove_dir_all`) →
  `mem::forget` de gate y manager. Sin emits, finalize, mark_pending, tray ni notificaciones.
- Tests sin ffmpeg (permiso del semáforo tomado a mano ⇒ SkippedSlow; buffer vacío ⇒ SkippedEmpty); tests existentes de
  `stop_and_save` siguen verdes. Base: `areas/spec-session-end-B5.md` §3.2-3.3 + ambas revisiones.

### 5.5 E2b — rama de fin de sesión en `RunEvent::Exit`
- Si `session_end::observed()` es Some (o `begin_exit` clasificó `os_session_end`/`external_close`): `recording_phase::set_session_ending()`,
  `begin_session_end()` del scheduler (try_state + timeout 200 ms), y en `block_on`: `spawn(flush_recording_for_session_end)` +
  `timeout_at(t0 + HARD)`; DB cleanup en spawn + timeout 0.5 s (se OMITE si la fase era `Stopping` al entrar: finalize en vuelo); sidecar
  spawn + timeout 0.3 s; `log::logger().flush()`; `lifecycle::finish_exit()`. Presupuestos sin reason string: STREAM 1 s, SOFT 1.5 s,
  HARD 2.5 s; con `MARKER_WRITE_ALLOWANCE` 0.3 s + congelado 0.2 s + fila 0.4 s + DB 0.5 s + sidecar 0.3 s ⇒ total 4.2 s < 5 s (test de invariante). Para `CloseApp` sin apagado: `app.cleanup_before_exit()` + `std::process::exit(0)`
  (no volver a un loop Destroyed). Todas las demás salidas: camino actual idéntico.
- En setup (dentro de `session_end::install`): `SetProcessShutdownParameters(0x3FF, 0)` (Win32_System_Threading ya habilitado) para
  que Maity reciba QES/ES antes que sus hijos ffmpeg/llama-helper.
- SIN `ShutdownBlockReasonCreate` (podría mostrar la pantalla de bloqueo en cada apagado; queda para después de E2E) y SIN checkpoint
  temprano en QES.
- Doc: sección "Fin de sesión de Windows con grabación activa" en REGLAS_AUDIO_GRABACION.md (hilos, prohibiciones dentro de
  WM_ENDSESSION, presupuestos, `mem::forget(StopGate)`, contrato de recuperación, "no reintroducir el graceful de 30 s en fin de sesión").

### 5.6 E3 — recuperación robusta (bug nuevo: se borran checkpoints tras un merge fallido)
- `recover_audio_from_checkpoints`: si el concat falla, validar cada `.mp4` (`ffmpeg -v error -i f -f null -` con el ffmpeg resuelto
  del repo), concatenar solo los válidos ⇒ `status: "partial"` + nombres excluidos; los excluidos se renombran a `.bad` (no se borran).
- `useTranscriptRecovery.ts`: `cleanup_checkpoints` solo si `status === 'success'` o (`partial` sin excluidos).
- Tests: builder puro de la lista; integración ffmpeg `#[ignore]`.

### 5.7 L3 — salidas por update de la Store
- Comando `exit_for_update` en lifecycle.rs (registrado en lib.rs): se niega si la fase no es Idle (`Err("recording_active")`);
  `begin_exit(Update{via: store_button})` + fila (750 ms) + `flush_row` 3 s + `app.exit(0)`.
- `store_update.rs`: `record_update_intent(store_api, …)` justo antes de `imp::install`; `clear_update_intent()` en todo resultado que
  no sea `Completed` (incluido `Err`).
- `UpdateDialog.tsx` `handleCloseToUpdate`: `invoke('exit_for_update')` en vez de `exit(0)`; toast de grabación en curso si el Err es
  `recording_active`; test actualizado.

## 6. Parte U — Updater NSIS

### 6.1 U1 — `direct_update_install` (Rust)
- Nuevo `direct_update.rs` (+ `pub mod` y registro en lib.rs): `Unsupported` bajo MSIX/Mac App Store; single-flight (`Busy`);
  rechazo si fase ≠ Idle o si `batch_transcription_queue` tiene filas `processing` (`PostProcessing`); `updater_builder().on_before_exit(hook)`;
  `check` → `download` con progreso por `Channel<DirectUpdateEvent>` (misma forma serde que el DownloadEvent del plugin) → `StartGate::acquire`
  (si falla ⇒ `RecordingActive`) → `install` dentro de `spawn_blocking`.
- Hook (sync, en el hilo de spawn_blocking; `catch_unwind`): `EXIT_HOOK_RAN = true` → `lifecycle::begin_exit(Update{via: nsis})`
  → `block_on { emit_exit_row + flush_row(2 s); db.cleanup (5 s); log flush; force_shutdown_sidecar (5 s) }` → `cleanup_before_exit()`
  solo si no hubo pánico. Falla tras el hook: revisar `EXIT_HOOK_RAN` ANTES de soltar el gate (si corrió: `mem::forget(gate)` +
  `request_restart`; si no: `drop(gate)`). Sin el brazo `if false`.
- Doc: sección B2 en CANALES_DISTRIBUCION.md (process::exit sin RunEvent::Exit, único camino, rechazos, hook después de extract,
  nunca cerrar el pool antes, protege solo ≥0.2.62 y requiere release de GitHub).
- Base: `areas/spec-nsis-update-B2.md` + ambas revisiones.

### 6.2 U2 — diálogo NSIS
- `UpdateDialog.tsx`: pre-chequeo (fase ≠ idle o bandera post-stop ⇒ toast de grabación/post-proceso); `invoke('direct_update_install',
  { onEvent: Channel })` con el mismo switch de progreso; mapeo de outcomes (restarting, noUpdate, recordingActive, postProcessing, busy,
  unsupported, error); ref de "en vuelo" que evita que un re-check del tray reinicie el diálogo; sin `downloadAndInstall`/`relaunch` en esa ruta.
- Nuevo `lib/postStopState.ts` (flag de módulo, NO contexto: UpdateCheckProvider vive fuera de RecordingStateProvider); `useRecordingStop.ts`
  lo pone desde que empieza el stop hasta el estado terminal (COMPLETED/IDLE/ERROR).
- `updateService.ts`: borrar el `downloadAndInstall` muerto y exportar `DirectInstallOutcome`.
- Tests: describe "canal directo (NSIS)" con `check()` mockeado a un Update disponible.

### 6.3 U4 — ACL
- `tauri.conf.json`: en la capability main, `updater:default` ⇒ `updater:allow-check` (verificar `lint-tauri-acl.js` y build).
- `updaterInstall.fitness.test.ts`: falla si en `src/**` (sin tests) aparece `downloadAndInstall(` o `.install(` sobre un Update del plugin
  o `plugin:updater|install`.

## 7. Parte S — Sesión

### 7.1 S1 — logout del sidebar del chat (B1)
- `SidebarFooterV5.tsx`: `useAuth().signOut()` (comentario sin el literal `.auth.signOut(`; nota "adaptación desktop: la web borró shell-v5").
- `AuthContext.signOut`: guard de re-entrada (`if (signOutPromise.current) return signOutPromise.current`).
- `authSignOut.fitness.test.ts`: sin `.auth.signOut(` en `src/**/*.{ts,tsx}` fuera de `contexts/AuthContext.tsx`, `src/shared/maity-shared/**`
  y tests; quitar comentarios antes de buscar. `docs/NUBE_CUENTAS_SYNC.md`: regla "todo logout pasa por AuthContext.signOut".

### 7.2 S2 — recargar no suelta al usuario (bug nuevo)
- El efecto de AuthContext (~L108-124) llama `clear_current_user` + `cloud_sync_clear_session` solo si la inicialización de auth terminó y
  no hay usuario, o en una transición real Some→None; nunca durante la carga inicial del montaje. Decisión pura en `lib/authRelease.ts`
  (`shouldReleaseRustUser(prevId, nextId, authReady)`) + test.

### 7.3 S3a — `auth.logout` (Rust)
- Nuevo `logging/telemetry/auth.rs` (+ `pub mod auth;`): `LogoutFacts`, `logout_payload` puro, `emit_logout`.
- `logout_cleanup(app, surface: Option<String>)` (el nombre `surface` se mantiene: la clave de invoke depende del nombre): snapshot de fase,
  `maity_user_id`, emitir `auth.logout` con `emit_event_with_id` PRIMERO, luego `join!(stop ≤30 s, flush_row(id, 3 s))`; `take_last_login_user()`.
  Surface fuera de la allowlist ⇒ `unknown`.

### 7.4 S3b — superficie
- `signOut(surface?: LogoutSurface)` con normalización (`typeof surface === 'string'`), `invoke('logout_cleanup', { surface })`;
  `PreferenceSettings.tsx:~505` ⇒ `() => void signOut('settings')` (obligatorio: el tipo nuevo rompe `onClick={signOut}`);
  `SidebarControls` ⇒ `'sidebar'`; `SidebarFooterV5` ⇒ `'chat_sidebar'`.

### 7.5 S4 — `auth.session_lost`
- Comando Rust `telemetry_auth_session_lost(source, error_name)` (allowlist `webview_signed_out|boot_no_session`); `boot_no_session` exige
  `peek_last_login_user()`; la marca se toma solo si la fila quedó en el outbox; payload 1.6; status warning.
- `set_current_user` (`database/commands.rs`): en la transición None→Some, `lifecycle::set_last_login_user(id)` solo si cambió.
- AuthContext: rama SIGNED_OUT espontánea (no `isSigningOut`) ⇒ `setTimeout(() => void invoke(...), 0)`; en `initialize()`
  desestructurar `{ data, error }` y emitir `boot_no_session` solo si no hay sesión y (`error == null` o error NO reintentable,
  `isAuthRetryableFetchError` falso) y `navigator.onLine !== false`. Lógica pura en `lib/authSessionLost.ts` + test. Sin `native_refresh_rejected`.

### 7.6 S5 — sesión perdida a media grabación (bug nuevo)
- Comando `session_lost_cleanup` en lib.rs (junto a `logout_cleanup`): `graceful_shutdown_before_exit` ≤30 s (pone la retención
  SessionEnd de J1, que se libera sola al no haber sesión; un re-login reanuda la jornada).
- AuthContext: en la misma rama SIGNED_OUT espontánea, `sessionLostCleanupRef.current = invoke('session_lost_cleanup')`; el efecto de
  liberación espera ese promise (con catch) antes de `clear_current_user` (sin usuario el segmento no se puede guardar, service.rs:1288).

## 8. Parte Z — Docs finales

### 8.1 Z1 — CLAUDE.md y TELEMETRIA.md
- CLAUDE.md: bullets breves con puntero a su doc: todo logout por `AuthContext.signOut` (B1) y la recarga no suelta al usuario;
  updater NSIS solo por `direct_update_install` (B2); rearme con causa, día cerrado, supresión persistida y "toda salida marca
  session_ending antes de detener" (B3/B4); fin de sesión de Windows acotado (B5); frase de telemetría #83 (eventos, latido, marcador,
  `app.close` ≠ salida, desinstalación inferida).
- TELEMETRIA.md: reconciliar con el código real (grep de cada nombre/campo del contrato), mencionar `autostart_toggled`, quitar
  marcas de "contrato" pendientes; `node scripts/lint-telemetry.js` OK.
