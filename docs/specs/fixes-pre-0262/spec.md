---
slug: fixes-pre-0262
repo: maity_desktop
status: approved
base_commit: 62b7e984fdbbfdce26b495c07169e6b16b2988e0
approved_at: 2026-09-24T22:15:34Z
---

# Spec: cinco arreglos antes del bump a 0.2.62 (duración en metadata, bloque jornada al arrancar, Fast Startup, app.window_shown, docs)

## Contexto

El 2026-09-24 se revisaron los logs del MSIX 0.2.61.0 de prueba (hecho desde `main` con todo #83) y las filas de
`maity.platform_logs` del usuario de pruebas. #83 funciona de punta a punta, pero salieron cinco problemas:

1. `metadata.json` nunca guarda la duración de la grabación (`Recording duration from state: None` en todas las grabaciones desde al menos el 09-22).
2. El `health.heartbeat` con `reason: recording-start` de un arranque de jornada trae un bloque `jornada` de hace
   ~150 ms (`scheduler_phase: armed`, `skip: no_session`) mientras `phase` ya es `recording`.
3. Con el Inicio rápido de Windows (Fast Startup), un "apagado" no reinicia el kernel: `os_boot_at` no cambia y, si la
   app muere sin registrar salida, `app.start` dice `unclean` en vez de algo que apunte al apagado. Pasó el 09-24:
   `os_boot_at` idéntico antes y después de un apagado.
4. No hay dato de cuántas veces la ventana principal la muestra el fallback de 3 s (el frontend tardó 4.1 s el 09-24).
5. Documentación: CLAUDE.md apunta a reglas que no existen en `NUBE_CUENTAS_SYNC.md`, y tres docs afirman que el MSIX
   redirige AppData, lo que el 09-24 resultó falso en una máquina que ya tenía datos de NSIS/dev.

Resultado buscado: los cinco arreglados, con tests por módulo verdes, antes de `/build patch` (0.2.62).

### Decisiones tomadas con el usuario
1. Fast Startup se arregla completo, no solo con bandera: `device.profile.hiberboot_enabled` + hora de logon de Windows
   en el marcador y en `app.start` + razón inferida nueva. Motivo: arreglar la inferencia, no solo señalarla.
2. La razón nueva se llama `os_session_end_unclean` ("terminó la sesión de Windows —cierre de sesión o apagado con
   Fast Startup— sin salida registrada"). Precedencia: después de `os_restart_unclean`, antes de `unclean`. Motivo:
   es la versión inferida de `os_session_end` (observada).
3. Evento nuevo `app.window_shown`, una fila por proceso, emitido desde Rust por el outbox. Si ganó el fallback, se
   espera el app-ready tardío hasta **60 s** y luego se emite (con `app_ready_ms: null` si nunca llegó).
4. El bloque `jornada` se arregla en código (publicar la fase antes de arrancar), no solo documentándolo.
5. Política de verificación igual que #83: cada tarea corre solo los tests de su módulo; `tauri:build:debug` es la
   compuerta final manual antes del bump. Motor serial (sin `--parallel`).
6. Se trabaja con la skill de specs (`/spec-new` → `/spec-execute`), commits locales, sin push.

### Hechos ya verificados durante el planeo (no re-investigar)

Rutas relativas a `frontend/src-tauri/src/` salvo que se diga otra cosa.

**F1 — duración**
- `audio/recording_lifecycle.rs:606-618` — `stop_recording_reporting` captura `captured_duration_seconds: Option<f64>`
  = `get_active_recording_duration()` (tiempo activo, sin pausas) `.or_else(get_recording_duration)` ANTES del teardown.
  Log `:628-631` "Captured wall-clock recording duration". Se usa en telemetría (`:641`) y en el evento `RECORDING_STOPPED` (`:925`).
- `audio/recording_manager.rs:262-296` — `stop_streams_and_force_flush`: `state.stop_recording()` en `:277` (limpia
  `pause_start` e `is_paused`) y `state.cleanup()` en `:292` (limpia `recording_start`, `pause_start` y pone
  `total_pause_duration` en cero; `audio/recording_state.rs:519-546`, `:538-540`).
- `audio/recording_manager.rs:298-322` — `save_recording_only(&mut self, app)` lee `self.state.get_active_recording_duration()`
  (`:303`) → `None` → `self.recording_saver.stop_and_save(app, recording_duration)` (`:307`).
- Único llamador de `save_recording_only`: `audio/recording_lifecycle.rs:825` (dentro de `tokio::time::timeout(300 s, …)`);
  `captured_duration_seconds` está en scope ahí.
- `audio/recording_saver.rs:32-46` `MeetingMetadata { duration_seconds: Option<f64>, … }` sin atributos serde; se escribe en
  `stop_and_save` (`:555-574`). Si recibe `None` cae a `store.last().audio_end_time`, vacío en modo lote.
- Nadie LEE `metadata.json.duration_seconds` (planner lee solo `meeting_name`, `audio/transcription/batch/planner.rs:537-549`;
  retención parchea `audio_file`/`audio_deleted_at`, `audio/audio_retention.rs:279-305`). Es rastro de auditoría.
- `RecordingManager::stop_recording` (`recording_manager.rs:336-372`) y `cleanup_without_save` (`:490`) no tienen llamadores.
- Ningún test del crate construye un `RecordingManager` (exige dispositivos; `recording_lifecycle.rs:1153`). Tests de
  `RecordingState` en `audio/recording_state.rs:589+` (`mod tests`, `RecordingState::new()`, `start_recording().unwrap()`,
  `pause_recording()`, `resume_recording()`); no hay test de duración ni de `cleanup`.

**F2 — bloque jornada**
- `scheduled_recording/status_snapshot.rs:47` `static SLOT`; `:78` `begin_loop() -> u64` (generación); `:98-107`
  `publish_stopped`; `:113-131` `publish_tick(gen, phase, skip, rearm, backoff)` ignora si `slot.gen != gen || !slot.loop_running`.
- `status_snapshot.rs:403-416` `heartbeat_fields(rec, now)` clona el SLOT; `idle_reason` se deriva al leer (Recording → `None`),
  pero el bloque `jornada` (`JornadaTelemetry::from_view`, `:309-324`) copia `phase`/`skip` tal como se publicaron.
- `status_snapshot.rs:854-895` — `slot_static_gen_y_loop_running_descartan_ticks_tardios` es el ÚNICO test que toca el
  `static SLOT` (los demás no lo leen para no correr en paralelo sobre él).
- `scheduled_recording/service.rs:750-756` `run_scheduler_loop(…, gen: u64, …)`; `:781-782` llama
  `evaluate_tick(&app, &shared, &settings, now, &mut process_monitor)`; `:792-803` `publish_tick(gen, …)` DESPUÉS.
- `service.rs:856-862` firma `evaluate_tick(app, shared, settings, now, process_monitor) -> (SchedulerPhase, Option<SkipReason>)`;
  su único llamador es `:782`.
- `service.rs:969-1018` — rama `(false, Some(_))`: gates sesión (`:976`), registro (`:984`), rearme (`:994-1003`),
  grabación manual (`:1006`), back-off (`:1012`); luego `start_recording_with_meeting_name` en `:1019`, que confirma la
  fase (`audio/recording_helpers.rs:545-546`) y emite `recording-started` (`audio/recording_lifecycle.rs:315`) ANTES de volver.
- El latido lo dispara `frontend/src/services/healthHeartbeatService.ts:227-229` (escucha `recording-started` → `tick('recording-start')`)
  → `invoke('get_health_snapshot')` (`logging/commands.rs:350-384`, que llama `status_snapshot::heartbeat_fields`).

**F3 — hiberboot en device.profile**
- `logging/commands.rs:411-453` `struct DeviceProfile` (`#[derive(Debug, serde::Serialize)]`, sin `Default`);
  `:455-506` `get_device_profile` (los valores solo-Windows van con `cfg` y `with_mta`, `:461-466`); 4 literales en tests `:608-722`.
- Patrón de lectura de registro a reusar: `autostart_state.rs:213-233` (`winreg::RegKey::predef(...).open_subkey_with_flags(..., KEY_READ)`,
  `get_value`). `winreg = "0.56"` ya es dependencia (`frontend/src-tauri/Cargo.toml:300`).
- TS: `interface DeviceProfile` en `frontend/src/services/healthHeartbeatService.ts:151-178`; el payload se esparce
  (`{ ...this.deviceProfile }`, `:265`), así que un campo nuevo llega sin más código TS.
- `docs/TELEMETRIA.md:257` fila `device.profile` (una línea larga; campos inline con "Desde 0.2.xx").

**F4 — logon de Windows y razón nueva**
- `logging/telemetry/lifecycle.rs:47` `MARKER_SCHEMA = 1`; `:58` `OS_BOOT_TOLERANCE_MS = 120_000`.
- `lifecycle.rs:67-87` `LifecycleMarker` con `#[serde(default)]` a nivel struct, deriva `Default`, sin `deny_unknown_fields`.
  Precedente de campo nuevo sin bump de schema: `last_autostart_state`, `last_login_user` (`:83-86`); test
  `parse_marker_ignora_campos_desconocidos_y_schema_futuro` (`:1363-1376`) y `parse_marker_campos_faltantes_toman_default` (`:1379`).
- `lifecycle.rs:159-165` `struct BootPrev { read, panics, now_ms, os_boot_ms, build_channel }`; `:195-200` `os_boot_ms()` =
  `sysinfo::System::boot_time()*1000` (en Windows = ahora − `GetTickCount64`, que sigue contando tras un apagado con Fast Startup).
- `lifecycle.rs:328-405` `rotate_at_boot`: arma el `LifecycleMarker` (`:358-372`) y `BOOT_PREV.set(...)` (`:399-405`).
- `lifecycle.rs:410-476` `emit_start`: arma `PrevInput` (`:437-444`) y `StartExtras` (`:445-452`), emite `catalog::APP_START`.
- `lifecycle.rs:544-552` `PrevInput`; `:555-562` `StartExtras`; `:564-590` `PrevSummary` (incluye `os_rebooted_since_prev`).
- `lifecycle.rs:596-719` `summarize_prev`: `os_rebooted` en `:661-664`; cadena de motivo `:669-695`: exit observado →
  intent `update` → intent `session_end` → `crash_panic` → `os_restart_unclean` (`:691-692`) → `unclean` (`:694`).
- `lifecycle.rs:723-753` `to_payload` (27 claves); test de claves exactas `:1669-1692` con `assert_eq!(obj.len(), 27)` (`:1686`).
  Tests de motivo: `caso_11_boot_del_so_distinto_es_os_restart_unclean` (`:1608`).
- `windows` 0.58 (`Cargo.toml:272-296`, solo Windows) NO tiene `Win32_System_RemoteDesktop`. Sí tiene `Win32_Foundation` y
  `Win32_Security`. API a usar: `WTSQuerySessionInformationW(WTS_CURRENT_SERVER_HANDLE, WTS_CURRENT_SESSION, WTSSessionInfo, &mut PWSTR, &mut u32)`
  → `*const WTSINFOW` con `LogonTime: i64` (FILETIME, ticks de 100 ns desde 1601) → `WTSFreeMemory`. Verificar nombres exactos
  contra el crate en `~/.cargo/registry/src/*/windows-0.58*/src/Windows/Win32/System/RemoteDesktop/mod.rs`.
- `utils.rs:38-53` `filetime_ticks_to_rfc3339(ticks: u64)` (constante `FILETIME_UNIX_EPOCH_DIFF_SECS = 11_644_473_600`).
- `frontend/scripts/lint-exe-imports.js:54` solo prohíbe DLLs de DirectX en carga; `wtsapi32.dll` (sistema) no choca.
- `docs/TELEMETRIA.md`: fila `app.start` `:236`; tabla de motivos `:413-440` (`os_restart_unclean` en `:428`, precedencia
  en `:437`); query "¿Por qué no grabó?" mapea `prev_salida in ('os_session_end','os_restart_unclean')` en `:875-876` (y `:895`)
  a `'PC apagada / suspendida / sin sesión de Windows'`.

**F5 — app.window_shown**
- `lib.rs:94` `pub(crate) static STARTED_AT_BOOT: AtomicBool`; `:101` `static MAIN_WINDOW_PLACEMENT_DONE: AtomicBool`.
- `lib.rs:863-885` listener de `events::APP_READY`: `first_ready = !MAIN_WINDOW_PLACEMENT_DONE.swap(true)`, `show()`, y solo en
  el primero `minimize()` (boot) o `set_focus()`.
- `lib.rs:887-907` fallback: `std::thread::spawn` + `sleep(3 s)`; si `!window.is_visible()` → `warn!`, `MAIN_WINDOW_PLACEMENT_DONE.store(true)`,
  `show()` y minimize/focus según `STARTED_AT_BOOT`. **El fallback YA respeta el arranque por boot** (no hay bug que arreglar ahí).
- `lib.rs:769` `rotate_at_boot` y `:816` `emit_start` (al inicio del setup, antes de que cargue el webview: `app.start` no puede
  llevar la latencia del app-ready).
- `logging/telemetry/emit.rs:41-49` `pub async fn emit_event(app, session_id: &str, event_type: &str, payload: Value, status: Option<TelemetryStatus>, error: Option<&str>, meeting_id: Option<&str>)`;
  `context::process_session_id()` da el `session_id` de proceso (ver uso en `lifecycle.rs:414`).
- `logging/telemetry/catalog.rs:60-65` bloque "Ciclo de vida del proceso" (`APP_START`, `APP_EXIT`, `APP_RESUMED`, …);
  `frontend/src/lib/telemetry-events.ts:58-60` espejo TS (`APP_START: 'app.start'`, …).
- `logging/telemetry/mod.rs:27-35` lista de `pub mod` (auth, catalog, context, drain, emit, lifecycle, panics, recording_session, status).
- `frontend/scripts/lint-telemetry.js` exige: catálogo espejo Rust↔TS, naming dot-namespaced, single writer, fila en el
  inventario de `docs/TELEMETRIA.md` con el nombre entre backticks. No revisa campos. Hoy: `OK (36 eventos, 12 legacy)`.
- Regla de cardinalidad: `docs/TELEMETRIA.md:501-511`.

**F6 — docs**
- `frontend/src/lib/authRelease.ts:4-9` (síntoma), `:23-31` `shouldReleaseRustUser(prevId, nextId, authReady)`: `if (nextId) return false; if (prevId) return true; return authReady`;
  `:44-51` `isBootSessionUncertain`. `frontend/src/contexts/AuthContext.tsx:139` `authReady = !isLoading && !user && !bootSessionUncertainRef.current`;
  efecto `:148-183` (usa la regla en `:158`). Test `frontend/src/lib/authRelease.test.ts` (6 + 4 casos). Commit `95560ee`.
- Sesión perdida: `frontend/src/lib/authSessionLost.ts:4-12,21-41` (fuentes `webview_signed_out` y `boot_no_session`; la red
  caída nunca cuenta), Rust `logging/telemetry/auth.rs:82-111` (`should_emit_session_lost`, exige el marcador de último login)
  y `:200-202`. Orden en `AuthContext.tsx:553-565`: se asigna `sessionLostCleanupRef.current` síncrono (`:555`), luego en
  `setTimeout(0)` `telemetry_auth_session_lost` (`:557-558`) y `session_lost_cleanup` (`:560`); el efecto de liberación espera
  esa promesa (`:164-169`), no suelta si hubo re-login (`:171`) y si no llama `clear_current_user` + `cloud_sync_clear_session` (`:173-181`).
  Comando Rust `session_lost_cleanup` en `lib.rs:223-244` (envuelve `graceful_shutdown_before_exit` con timeout de 30 s, nunca
  falla; pone un hold SessionEnd a la jornada que liberan `clear_current_user` o `set_current_user`). Tests
  `authSessionLost.test.ts`, `auth.rs:278-330`. AC-20 de #83 (`__pollDebug.forceTokenRefresh()`) sigue manual. Commits `2fa3d3c`, `9426c68`.
- `docs/NUBE_CUENTAS_SYNC.md:35-42` sección "Todo logout pasa por AuthContext.signOut (sep-2026, #83)": no menciona la regla
  de recarga ni `session_lost_cleanup`. `CLAUDE.md:241` enuncia ambas y manda a esa sección (puntero colgante). Hoy solo están
  en `docs/TELEMETRIA.md:1041-1044`.
- `scheduled_recording/service.rs:837-845` brazo `CheckNow`: limpia `start_backoff` y llama `tick.reset_immediately()` (antes
  `reset()` esperaba 30 s). `docs/ONBOARDING_Y_GATES.md:22` no lo dice; `:38` ("solo levantan el back-off, no la supresión") es
  correcto. `:33` afirma que `scheduled_recording_runtime.json` "bajo MSIX va redirigido a LocalCache" — falso en la máquina del 09-24.
- MSIX y AppData (Microsoft Learn, "Understanding how packaged desktop apps run on Windows", sección AppData en Windows 10 1903+):
  los archivos y carpetas NUEVOS bajo AppData (Local, Roaming) se redirigen a una ubicación privada por paquete; al abrir un
  archivo, el SO busca primero en la privada y, si no existe, abre el de AppData real, y ese archivo NO se virtualiza.
  Observado el 2026-09-24 (MSIX 0.2.61.0 sideload, máquina con datos previos de NSIS/dev): la DB
  `%APPDATA%\com.maity.ai\meeting_minutes.sqlite` se escribió en su lugar real (mtime = salida del MSIX, 10:37:30), igual que
  `%LOCALAPPDATA%\com.maity.ai\lifecycle.json` (creado nuevo por el MSIX, `build_channel: store`) y los logs
  `%LOCALAPPDATA%\Maity\logs`; `%LOCALAPPDATA%\Packages\Sixale.Maity_q5b9hqhck1xz0\LocalCache` no tenía datos de Maity.
  Observado el 2026-07-27 (`docs/CANALES_DISTRIBUCION.md:15`): en una máquina SIN datos previos, sqlite, onboarding y modelos
  fueron a `LocalCache\Roaming\com.maity.ai`. `frontend/Package.appxmanifest` declara el namespace `desktop6` pero no usa
  `FileSystemWriteVirtualization` ni `unvirtualizedResources`.
- Rutas bajo Local (`app_local_data_dir` o `dirs::data_local_dir`): marcador `logging/telemetry/lifecycle.rs:134-140,334`,
  runtime de jornada `scheduled_recording/runtime_state.rs:10,32,169-175`, logs `logging/file_logger.rs:24-27`,
  `rival_install.rs:241-243,286,291`. Bajo Roaming: DB `database/manager.rs:99-120`, modelos, `panics.rs:19,60`.
- El marcador de otro canal se lee como `Foreign` (`lifecycle.rs:305-318`) y `rotate_at_boot` lo sobrescribe sin arrastrar
  `last_autostart_state`/`last_login_user` (`:352-357`): con los dos canales instalados, cada arranque pisa el del otro.
- `CLAUDE.md:51` ("Store y descarga directa NO comparten DB ni modelos (el MSIX instalado redirige AppData)") y `CLAUDE.md:199`
  ("bajo MSIX el AppData va redirigido") también quedan inexactos.

**Líneas base (2026-09-24, HEAD `62b7e98`)**: vitest 564/564; `cargo test --lib` 958 passed / 3 ignored; `lint-telemetry` OK
36 eventos, 12 legacy.

## Alcance

### Dentro
- F1: pasar la duración capturada a `save_recording_only`; tests de `RecordingState`.
- F2: `evaluate_tick` recibe `gen`; `status_snapshot::publish_starting(gen)` antes de arrancar la jornada; test serial extendido; nota en TELEMETRIA.
- F3: `device.profile.hiberboot_enabled`; tipo TS; fila en TELEMETRIA.
- F4: feature `Win32_System_RemoteDesktop`; `os_logon_ms` en marcador/BootPrev/PrevInput/StartExtras; `app.start` +2 claves;
  razón `os_session_end_unclean`; tabla de motivos, precedencia, fila `app.start`, sección Fast Startup y query en TELEMETRIA.
- F5: módulo `logging/telemetry/window_shown.rs`, evento `app.window_shown` (catálogo Rust + TS + fila TELEMETRIA), cableado en `lib.rs`.
- F6: `NUBE_CUENTAS_SYNC.md` (recarga + sesión perdida), `ONBOARDING_Y_GATES.md` (`reset_immediately`, corrección de `:33`),
  `CANALES_DISTRIBUCION.md` y `CLAUDE.md` (comportamiento real de AppData bajo MSIX).

### Fuera
- Bump de versión, `/build`, `/store-msix`, push.
- Borrar código muerto (`RecordingManager::stop_recording`, `cleanup_without_save`).
- Cambiar `MARKER_SCHEMA` o el significado de campos existentes.
- La fila `app.start` NO lleva latencias de ventana (se emite antes de que cargue el webview).
- Verificar en máquina limpia qué pasa con los datos al migrar NSIS → Store (queda marcado "no verificado").
- Cualquier cambio en la web (`C:\maity`): la Q11 va por el issue maity#171.
- Editar la spec histórica de #83 (`docs/specs/telemetria-ciclo-vida-83/**`).

## Criterios de aceptación

- **AC-1** — `save_recording_only` recibe la duración como parámetro y el único llamador pasa `captured_duration_seconds`;
  `RecordingState` tiene tests de que `cleanup()` deja `get_active_recording_duration()` en `None` y de que las pausas se
  restan. Evidencia: `cd /c/maity_desktop/frontend/src-tauri && cargo test --lib audio::recording_state` → ok; `recording_lifecycle.rs`
  en la llamada a `save_recording_only` muestra `captured_duration_seconds`.
- **AC-2** — Un arranque de jornada publica `phase=Recording`, `skip=None` en el SLOT antes de llamar a
  `start_recording_with_meeting_name`, con la misma guarda `gen`/`loop_running` que `publish_tick`. Evidencia:
  `cargo test --lib scheduled_recording` → ok, con el test serial del SLOT cubriendo `publish_starting` (gen vigente aplica
  y `heartbeat_fields(RecordingPhase::Recording, now)` da `jornada.scheduler_phase = recording` y `skip = None`; gen vieja y loop detenido se ignoran).
- **AC-3** — `device.profile` trae `hiberboot_enabled: bool|null` leído de HKLM `SYSTEM\CurrentControlSet\Control\Session Manager\Power`
  `HiberbootEnabled` (0 → false, ≠0 → true, error/ausente/no Windows → null), con la conversión en una función pura testeada.
  Evidencia: `cargo test --lib logging::commands` → ok; `interface DeviceProfile` tiene el campo; fila `device.profile` de
  TELEMETRIA lo lista "Desde 0.2.62".
- **AC-4** — El marcador guarda `os_logon_ms` (hora de logon de la sesión de Windows actual; `None` fuera de Windows o si la
  API falla) y `app.start` agrega `os_logon_at` y `logon_changed_since_prev` (29 claves). `summarize_prev` devuelve
  `os_session_end_unclean` (`inferred`, `clean=false`) cuando cambió el logon (tolerancia 2 s), NO cambió el boot y no hubo
  salida, intención ni pánico de `main`; `os_restart_unclean` sigue ganando si cambió el boot; un marcador viejo sin el campo
  da `logon_changed_since_prev = null` y cae a `unclean`. Evidencia: `cargo test --lib logging::telemetry::lifecycle` → ok con
  casos nuevos y el test de claves en 29.
- **AC-5** — `docs/TELEMETRIA.md` documenta: la sección Fast Startup (por qué `os_boot_at` no cambia, `hiberboot_enabled`,
  logon), `os_session_end_unclean` en la tabla de motivos y en la precedencia, las dos claves nuevas en la fila `app.start`, y
  la query "¿Por qué no grabó?" mapea `os_session_end_unclean` a `'PC apagada / suspendida / sin sesión de Windows'` igual que
  `os_session_end`/`os_restart_unclean`. Evidencia: `grep -n os_session_end_unclean docs/TELEMETRIA.md` muestra tabla,
  precedencia y query.
- **AC-6** — Cada proceso emite exactamente una fila `app.window_shown` por el outbox con
  `{ shown_by: "app_ready"|"fallback", shown_ms, app_ready_ms, started_at_boot, fallback_after_ms: 3000, late_ready_wait_ms: 60000 }`
  (ms desde el inicio de `setup()`): `app_ready` si el app-ready llegó antes que el fallback; si ganó el fallback, se emite al
  llegar el app-ready tardío o a los 60 s con `app_ready_ms: null`. El evento está en `catalog.rs`, `telemetry-events.ts` y el
  inventario de TELEMETRIA. Evidencia: `cargo test --lib logging::telemetry::window_shown` → ok (casos: ready primero, fallback
  + ready tardío, fallback sin ready, doble llamada no emite dos veces); `node scripts/lint-telemetry.js` → `OK (37 eventos …)`.
- **AC-7** — Docs corregidos: `NUBE_CUENTAS_SYNC.md` tiene las reglas de recarga (`shouldReleaseRustUser`) y de sesión perdida
  (`session_lost_cleanup` y su orden) con el puntero de `CLAUDE.md:241` resolviendo; `ONBOARDING_Y_GATES.md` menciona
  `reset_immediately` y ya no dice que el runtime va a LocalCache; `CANALES_DISTRIBUCION.md`, `CLAUDE.md:51` y `CLAUDE.md:199`
  describen el comportamiento real (redirección solo de archivos/carpetas nuevos; con datos previos de NSIS/dev, el MSIX usa
  los mismos en su lugar), con la migración NSIS→Store marcada "no verificada". Evidencia: cada afirmación trae `ruta:línea`
  que un refutador puede abrir y coincide con el código.
- **AC-8** — Sin regresiones: `npm run test` verde (≥ 564), `node scripts/lint-telemetry.js` OK. Evidencia: los comandos.
**Compuerta final manual (fuera del motor, obligatoria antes del bump; no es un AC de tarea):** `npm run tauri:build:debug`
exit 0 y `cargo test --lib` completo verde sobre el HEAD final, y el E2E (a)-(e) de `verify.md` (`manual[1]`-`manual[3]`).

## Qué NO hacer
- No `git push`: lo hace Julio.
- No correr con `--parallel`: F2-F5 comparten `docs/TELEMETRIA.md` en secuencia.
- No crear un test nuevo que lea o escriba el `static SLOT` de `status_snapshot.rs`: extender el test serial existente
  (los tests de un binario corren en hilos paralelos).
- No subir `MARKER_SCHEMA` ni volver `LifecycleMarker` estricto (`deny_unknown_fields`): los campos nuevos son `Option` con default.
- No emitir `app.window_shown` desde el webview ni meter latencias en `app.start`.
- No agregar crates nuevos: `winreg` ya está; para WTS solo se agrega la feature `Win32_System_RemoteDesktop` a `windows` 0.58.
- No tocar el intervalo del fallback (3 s) ni el comportamiento de show/minimize/focus.
- No borrar el código muerto de `recording_manager.rs` en esta spec.
- No usar `python -c` / `node -e` (nightshift); scripts a archivo si hacen falta.
- No afirmar en docs que la migración NSIS→Store conserva los datos: no está verificado.
