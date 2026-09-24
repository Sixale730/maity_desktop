---
slug: telemetria-ciclo-vida-83
repo: maity_desktop
status: approved
base_commit: 2cc397a69ec1eb0e89915c89cae0b449c52589d7
approved_at: 2026-09-23T19:30:00-06:00
---

# Spec: telemetría para saber por qué alguien dejó de grabar (#83) + 9 bugs de salida, sesión y jornada

## Contexto

Issue #83: en un piloto de 10 personas (Windows 11, casi todas en la Store, flota en 0.2.57/0.2.58) no se puede
saber desde `maity.platform_logs` por qué alguien no grabó un día hábil: jornada apagada, fuera de horario, sin
micrófono, pausada, app cerrada, PC apagada o desinstalada. La telemetría actual no registra la salida del
proceso (`app.close` es solo la ventana escondida a la bandeja: 41 de 203 `app.open` en 30 días), ni el estado de la
jornada (el scheduler calcula el motivo de omisión cada tick y lo tira), ni cambios de autostart, ni logout.

El análisis encontró además bugs que causan o esconden "dejó de grabar": el logout del sidebar del chat no guarda
la grabación (B1), el update NSIS mata el proceso sin guardarla (B2), el aviso tras el cierre automático miente (B3),
los estados "detenida / día cerrado" se pierden al reiniciar (B4), el apagado de Windows bloquea hasta 30 s (B5), un
logout+login deja la jornada apagada hasta medianoche, cada recarga del webview suelta al usuario en Rust, una sesión
perdida a media grabación pierde el segmento, el turno nocturno pierde 22:00–00:00, "Evaluar ahora" espera 30 s y la
recuperación borra los checkpoints aunque el merge falle.

Resultado buscado: con SQL sobre `platform_logs` se clasifica cada persona × día hábil sin grabación en una causa
(criterio del issue) y los bugs quedan arreglados, cada uno en su propio commit.

### Decisiones tomadas con el usuario
1. **Alcance: todo** — la telemetría de #83 (T1–T5) y los bugs B1–B5, más los cuatro bugs nuevos que se ofrecieron
   (recarga suelta al usuario, sesión perdida pierde segmento, turno nocturno, "Evaluar ahora"). Un commit por arreglo.
2. **Archivos compartidos en secuencia**: varias tareas tocan `lib.rs`, `service.rs`, `AuthContext.tsx`, etc., encadenadas
   por `deps`. Se ejecuta SOLO con el motor serial (`/spec-execute telemetria-ciclo-vida-83`, sin `--parallel`);
   `check-spec` reporta 49 "already owned" a propósito y ningún otro error. Archivos compartidos: `lib.rs` (12 tareas),
   `scheduled_recording/service.rs` (6), `logging/telemetry/lifecycle.rs` (5), `contexts/AuthContext.tsx` (5),
   `logging/commands.rs` (4), `healthHeartbeatService.ts` (4), `rival_install.rs` (3) y 17 archivos más con 2 tareas cada uno
   (ver `contract.md` §0).
   **Contrato vinculante**: `contract.md` (mapa de dueños §0, nombres/esquemas/APIs §1, diseño por parte §2-§8). Los informes
   de investigación y sus dos rondas de revisión adversarial están en `research/` (`areas/` = diseño + 1.ª revisión,
   `areas2/`/`areas3/` = 2.ª revisión, `plan-agent-review.md`); si un informe choca con el contrato, gana el contrato, y si el
   contrato choca con el bloque "Ajustes del líder" al final de un narrativo del plan, gana el bloque.
3. **Web**: la Q11 de la skill `piloto-analisis` del repo web NO se edita desde aquí; se abre un issue en
   `Sixale730/maity` con la especificación (regla del usuario: cambios de la web = issue en la web).
4. Slug `telemetria-ciclo-vida-83`.
5. Decisiones técnicas del líder (revisadas por dos rondas de refutadores por área): marcador síncrono en disco como
   fuente de verdad del ciclo de vida (la fila del outbox es best-effort); `auth.logout` desde Rust (outbox + flush con
   el token de quien sale); sin `ShutdownBlockReasonCreate` ni checkpoint temprano en el fin de sesión (riesgo de pantalla
   de bloqueo en cada apagado; se revisa tras E2E); `logoff` y `apagado` se distinguen por el `lParam` capturado con un
   subclass del HWND de `main`; el marcador y el estado de la jornada viven en `app_local_data_dir` (no viajan con el perfil).

### Hechos ya verificados durante el planeo (no re-investigar)

Telemetría y outbox
- `frontend/scripts/lint-telemetry.js:218-223` — el check (f) solo va catálogo→doc (substring con backticks); documentar antes del código no rompe el build. (b) espejo TS↔Rust por regex (`:92-110`). (d) prohíbe `'unknown'` en líneas con "version" en `logging/telemetry` y TS.
- `frontend/src-tauri/src/logging/telemetry/emit.rs:41-49` — `emit_event(app, session_id, event_type, payload, status, error, meeting_id)`; `:103-110` descarta si no hay `AppState`; `:114` tira el rowid que devuelve `log_event` (`database/repositories/recording_log.rs:35`); `:131` hace `drain_notify().notify_one()`.
- `logging/telemetry/drain.rs:23-27` TICK 30 s, LIMIT 50, 5 s de arranque; `:49-131` `drain_once` sin mutex, lee oldest-first (`recording_log.rs:70`), difiere sin sesión (`:66-74`), `get_valid_token` puede refrescar (`:75`), marca SOLO al final del lote (`:124-130`) ⇒ un timeout a mitad duplica filas.
- `cloud_sync/session.rs:136-142` — `decide_token_action` puro (Reuse/Refresh) para el camino sin refresh.
- El RPC resuelve `user_id` desde `auth.uid()` al drenar: filas del outbox sin sesión se atribuyen al siguiente login (TELEMETRIA.md:39-40); `platform_logs.user_id` = `maity.users.id` en 6866/6866 filas de 30 días.
- `logging/telemetry/panics.rs:19` nombre privado del `.jsonl`; `:30-68` hook síncrono `{ts_ms,message,location}`; `:73-130` `import_pending` lo borra; cableado en `lib.rs:1060-1066` tras el init de DB (`lib.rs:696`, `block_on`). `panic = "unwind"` (Cargo.toml raíz:29): pánicos de tasks tokio no matan el proceso pero sí se anotan.
- `logging/telemetry/context.rs:13-14` `telemetry.json` solo guarda `install_id`; plugin-store escribe no-atómico (`tauri-plugin-store-2.4.2 store.rs:296`) ⇒ no usarlo para estado nuevo.
- `logging/commands.rs:328-340` `HealthSnapshot` (literal en 3 sitios: `:364`, tests `:493`, `:535`); `:345-372` `get_health_snapshot()` sin AppHandle; `:399-483` `DeviceProfile`/`get_device_profile` (un literal `:454`; `incident.rs:327` también lo serializa).
- `logging/mem_sampler.rs:377-415` `emit_native_heartbeat` arma su propio `json!`; `:300-313` gate `should_emit_native_heartbeat && has_session`; `:71` patrón `static LAST_SAMPLE: Mutex<Option<…>> = Mutex::new(None)` (compila en este toolchain).
- `services/healthHeartbeatService.ts:177-179` gate de sesión Supabase; `:189-197` `device.profile` 1× con latch `{...profile}`; `:211-233` campos del latido elegidos a mano; latidos JS NO se encolan sin red.
- `rust_error_bridge.rs:282-285` excluye `app_lib::logging::telemetry` (un `log::error!` ahí no hace bucle, pero no se usa `error!` en el módulo nuevo).
- `recording_start_failed` lleva `code` clasificado (`audio/device_errors.rs:89-95`: mic_permission_denied, mic_not_found, mic_in_use, mic_format_unsupported, audio_unknown).

Salida del proceso
- `lib.rs:1786-1824` único handler `RunEvent::Exit` (`block_on`: graceful ≤30 s → `db_manager.cleanup()` cierra el pool → kill del sidecar); `ExitRequested` no se maneja.
- `tray.rs:60-78` "quit": spawn, estado Stopping, graceful ≤60 s, `app.exit(0)`. `rival_install.rs:68-129` graceful → checkpoint/backup → `launch_detached_uninstaller` → `db.cleanup()` (pool cerrado) → `exit(0)` a los 800 ms.
- `tao-0.35.2 platform_impl/windows/event_loop.rs:2382-2392`: `WM_QUERYENDSESSION` sin procesar; `WM_ENDSESSION(TRUE)` → `loop_destroyed()` → `RunEvent::Exit` SIN `ExitRequested` y sin `lParam`. `:255-257,283-284` WM_QUIT también destruye el loop. `runner.rs:307` Destroyed→Destroyed es no-op; `runner.rs:371` salir de Destroyed hace panic (no volver al loop tras un cierre de Restart Manager).
- `tauri-runtime-wry-2.11.2 lib.rs:4192-4194` LoopDestroyed→Exit; `:4318-4331` última ventana destruida → `ExitRequested{code:None}`; `:4361-4373` `RequestExit(code)` → `ExitRequested{Some}`. `tauri-2.11.2 app.rs:77` `RESTART_EXIT_CODE = i32::MAX`; `:219-232` `ExitRequested` es `#[non_exhaustive]`; `:1100-1112` `cleanup_before_exit` solo tray/resources/ocultar; `async_runtime.rs:222-223` runtime tokio multi-hilo (el loop del scheduler sigue corriendo durante el `block_on` de Exit).
- `tauri-plugin-updater-2.10.0 updater.rs:794` extract → `:837-840` `on_before_exit()` → `:854-863` ShellExecuteW (resultado ignorado) → `:865` `std::process::exit(0)`: RunEvent::Exit NO corre en el update NSIS. `updater lib.rs:107-110` hook por defecto = `cleanup_before_exit`; `Builder` (`:127-134`) sin `on_before_exit`; `UpdaterBuilder::on_before_exit` (`updater.rs:288-291`) es `Fn()` síncrono y REEMPLAZA el default. JS `@tauri-apps/plugin-updater` 2.10.0 tiene `download()`/`install()`/`downloadAndInstall()`.
- `components/updates/UpdateDialog.tsx:128` `downloadAndInstall` + `:174 relaunch()` sin chequeo de grabación; Store: `:210-227` `exit(0)` y `:238-242` se niegan grabando. `services/updateService.ts:350-370` `downloadAndInstall` sin llamadores. `tauri.conf.json:73` capability con `updater:default`.
- `store_update.rs:164-201` `store_install_updates` se niega grabando; `:78-92` conversión del HWND de tauri (windows 0.61) a windows 0.58.
- Tras `drop(stop_gate)` (`audio/recording_lifecycle.rs:795`) la fase ya es Idle pero el guardado streaming sigue en JS (`hooks/useRecordingStop.ts:407-459`); en modo lote el planner transcribe en Idle con ffmpeg `kill_on_drop` (`audio/transcription/batch/decoder.rs:117`) que `process::exit` no dispara. `UpdateCheckProvider` vive fuera de `RecordingStateProvider` (`app/(main)/layout.tsx:834` vs `:544`).
- Microsoft (ms700677, wm-queryendsession/wm-endsession, ExitWindowsEx): QES a todas las ventanas top-level antes que ES; sin ventana visible ni reason string la app tiene ~5 s en ES; `ENDSESSION_CLOSEAPP` (0x1) lo usa Restart Manager y también `EWX_RESTARTAPPS` (reinicio del sistema); `EWX_FORCE` no manda QES. `windows 0.58`: `SetWindowSubclass/DefSubclassProc` ya disponibles por `Win32_UI_Shell_PropertiesSystem`; `SetProcessShutdownParameters` por `Win32_System_Threading` (ya habilitado); faltan `Win32_UI_WindowsAndMessaging` y `Win32_System_Shutdown` (evitables con literales + extern `user32`).
- `audio/recording_phase.rs:61-63` `is_session_active` = Recording|Paused (Stopping cuenta como no-grabando); `:164-192` `StartGate::acquire` (CAS Idle→Starting) es el candado único de arranque; `:237-258` `StopGate` (Drop Stopping→Idle).
- `audio/recording_lifecycle.rs:603-663` el stop espera ≤120 s la transcripción ANTES del flush final y del merge (`:701-704`, 300 s) ⇒ en fin de sesión se pierde la cola; `incremental_saver.rs:167-253` semáforo de 1 encode, `:175-208` el nombre del checkpoint sale de `checkpoint_count` antes de incrementar; `:534-611` recuperación concatena todo `.mp4` y un concat fallido devuelve `failed`; `hooks/useTranscriptRecovery.ts:270-278` llama `cleanup_checkpoints` AUNQUE el merge haya fallado (borra el audio).

Jornada
- `scheduled_recording/service.rs:61-88` `SkipReason` privado; `:98-100` mensaje "siguiente hora en punto"; `:240-261` `SchedulerShared` en memoria; `rearm_at` (`:252`) escritores: `:689` (paro del usuario, next_hour_boundary), `:810/:841/:899` (`close_scheduled`, start_of_next_day), `:939` (carrera de rotación); lectores `:598-606`, `:670-677`.
- `service.rs:393-407` `close_owned_segment_for_exit` reusa `close_scheduled` ⇒ salida, logout (`lib.rs:157-169` `logout_cleanup`), rival y Exit ponen hoy "suprimir hasta medianoche": un logout+login en el mismo proceso deja la jornada apagada el resto del día (contradice `service.rs:581-584` y ONBOARDING_Y_GATES.md:10).
- `service.rs:499-711` `evaluate_tick`; `:422-425` intervalo con `check_interval_seconds` (30 s); `:483-488` `CheckNow` usa `tick.reset()` = now + period (tokio 1.49 `interval.rs:524-526`; `reset_immediately` en `:556-558`).
- `service.rs:157-173` `StartFailureKind::Other.skip_reason()` = `TranscriptionNotReady` aunque el error sea `mic_in_use`/`audio_unknown`; `:1761` `record_start_failure` devuelve `kind.skip_reason()`.
- `service.rs:345-358` `update_settings` único punto de persistencia (`settings.rs:202-210` no atómico; la UI lo llama 2 veces por acción); `settings.rs:13-132` campos y defaults (`enabled` false, ventana L-V 09-18, `auto_close_time` 18:00); UI edita solo `windows[0]` (`ScheduledRecordingSettings.tsx:57-59`).
- `schedule.rs:36-57` ventanas semiabiertas y nocturnas; `:67-72` `active_window_at` ignora `enabled`; `:139-172` `next_fire_at`; `service.rs:714-718` `start_of_next_day` privado. Turno 22–06 que cierra a las 06:00 queda suprimido hasta las 00:00 ⇒ pierde 22:00–00:00.
- `lib.rs:1370-1395` el scheduler se inicializa en un spawn bajo `write()` y solo arranca si `enabled`; `commands.rs:46-75` toma `write()` a través de `start()/stop()`; `lib.rs:1839-1840` el graceful mantiene `read()` durante todo el cierre ⇒ los lectores del latido NO deben tocar ese RwLock.

Sesión y autostart
- `shared/components/shell-v5/SidebarFooterV5.tsx:36-38` `supabase.auth.signOut()` directo (montado por Maity Chat vía `CombinedSidebar`); los únicos `.auth.signOut(` son ese y `contexts/AuthContext.tsx:925`. La web borró shell-v5 (`Sixale730/maity b0f8de1e`): la copia del desktop ya es un fork adaptado.
- `AuthContext.tsx:895-941` `signOut`: `logout_cleanup` (`:905`) → `cloud_sync_clear_session` (`:911`) → estado local → `supabase.auth.signOut()` (`:925`); `signOutPromise` se guarda pero no se revisa al entrar (doble clic = doble logout). `:108-124` el efecto llama `clear_current_user` también al MONTAR con `maityUser` aún null (lo dice `database/commands.rs:521`): cada recarga (`useConversationLive.ts:306`, `ChunkErrorRecovery.tsx:65/103`, `ErrorBoundary.tsx:68`, `layout.tsx:746`) suelta al usuario en Rust a media jornada; `service.rs:1288-1292` sin usuario el segmento termina `Failed`.
- auth-js 2.93.3: `getSession` devuelve `session:null` ante CUALQUIER error de refresh, incluido red (`GoTrueClient.js:1235-1237`), pero solo borra la sesión en errores no reintentables (`:1920-1926`, `:1985-1992`) ⇒ arranque offline con token vencido NO es sesión perdida. `AuthContext.tsx:412` ignora `error`; `:446` suscribe después de `getSession`. `PreferenceSettings.tsx:505` `onClick={signOut}` (romperá el tipo al añadir parámetro).
- `startup_task.rs` estados StartupTask bajo MSIX; `auto-launch-0.5.0 windows.rs` `is_enabled` = valor `Run` REG_SZ && cola de 8 bytes de `StartupApproved\Run` en cero; `enable()` reescribe 0x02; `logging/commands.rs:430-444` mapea a enabled/disabled (nunca `disabledByUser` en canal directo). Valor `Run` = `Maity` (productName). `rival_install.rs:134` `NSIS_UNINSTALL_SUBKEY`; el NSIS de Tauri CLI 2.9.6 no escribe `InstallDate`. `Package.InstalledDate()` disponible con features actuales (`windows-0.58 ApplicationModel/mod.rs:1684`).
- `lib.rs:618-632` `STARTED_AT_BOOT` (`--autostart` o StartupTask); `hooks/useAutostartBootstrap.ts:76-86` habilita autostart 1× en canal directo; `PreferenceSettings.tsx:140-178` ya manda `autostart_toggled` por `Analytics.track`.
- Build: `build.rs` = `tauri_build::build()` sin AppManifest ⇒ los comandos propios nuevos no necesitan capability.

Prod y línea base (2026-09-23, SELECT de solo lectura)
- `device.profile` con `autostart_state`: solo desde 0.2.60 (TELEMETRIA.md:215 dice 0.2.59 por error); 0.2.57 ×16 instalaciones y 0.2.58 ×11 sin él. 295 filas desktop sin `ctx.occurred_at` (pre-0.2.57).
- Latidos 0.2.56 se cortan a ~3000-3300 s de uptime: firma del deadlock de auth-js al primer refresh (arreglado el 09-10); solo contexto.
- `node scripts/lint-telemetry.js` OK (28 eventos); `npm run test` 64 archivos / 513 tests; `cargo test --lib scheduled_recording` 51 passed.

## Alcance

### Dentro
- Contrato de 8 eventos nuevos (`app.start`, `app.exit`, `app.resumed`, `autostart.changed`, `auth.logout`, `auth.session_lost`,
  `jornada.settings_changed`, `jornada.idle_reason_changed`), campos nuevos en `health.heartbeat` y `device.profile`, y la
  query persona × día hábil en `docs/TELEMETRIA.md`.
- Drenado del outbox por fila y flush dirigido de una fila con token vigente.
- Jornada: causa del rearme y retención de fin de sesión (logout+login ya no apaga el día), `closed_for_day` y turno nocturno (B3),
  "Evaluar ahora" inmediato, supresión persistida (B4), instantánea del scheduler con `idle_reason` y transiciones, configuración en
  `device.profile` y `jornada.settings_changed`.
- Ciclo de vida: marcador síncrono, `app.start` con causa del cierre anterior, `app.resumed`, `app.exit` con motivo, `ExitRequested`,
  tipo de fin de sesión de Windows, salida acotada en fin de sesión (B5), recuperación de checkpoints robusta.
- Updates: comando `direct_update_install` (B2), diálogo NSIS por Rust, salidas de la Store por Rust, ACL `updater:allow-check`.
- Autostart real en canal directo, fecha de instalación, `autostart.changed` y aviso en Ajustes.
- Sesión: logout del chat por `signOut` (B1), recarga no suelta al usuario, `auth.logout`, `auth.session_lost`, sesión perdida guarda.
- Docs de reglas: TELEMETRIA, REGLAS_AUDIO_GRABACION, CANALES_DISTRIBUCION, NUBE_CUENTAS_SYNC, ONBOARDING_Y_GATES y CLAUDE.md.

### Fuera
- Editar el repo web (`C:\maity`): la Q11/Q11b y la tabla de lectura van como issue de `Sixale730/maity` (lo abre el líder tras aprobar).
- `ShutdownBlockReasonCreate` y checkpoint temprano en QES (tras E2E, en otro ciclo).
- Finalizar al arrancar un segmento streaming desde `transcripts.json` (marcador `.session_end_pending.json`): mejora de recuperación que
  va a issue aparte; aquí la recuperación sigue siendo cola de lote + `autoRecoverAll`.
- Telemetría anónima sin sesión (necesitaría un RPC público nuevo): lo pre-login sigue esperando en el outbox.
- Hora de logon de Windows, fallback del saver cuando `switch_audio_device` tomó el manager, supresión por usuario.
- Release, bump de versión y publicación en la Store (lo hace Julio con `/build` y `/store-msix`).
- La copia desactualizada de la skill `piloto-analisis` en este repo (se menciona en el issue web).

## Criterios de aceptación

- **AC-1** — Los 8 eventos nuevos están en `catalog.rs`, `telemetry-events.ts` y `docs/TELEMETRIA.md`, con payloads, `idle_reason`, motivos de salida y campos de `device.profile` del contrato. Evidencia: `cd /c/maity_desktop/frontend && node scripts/lint-telemetry.js` → `OK` con 36 eventos.
- **AC-2** — El drenado marca cada fila tras su 2xx, no duplica filas cuando un flush y el loop coinciden, y `flush_row` sube una fila concreta sin refrescar token. Evidencia: `cargo test --lib logging::telemetry` y `cargo test --lib database::repositories::recording_log` verdes con tests de reclamo/flush.
- **AC-3** — Salir, cerrar sesión, instalación rival o apagar no dejan supresión de día: tras logout+login en el mismo proceso la jornada rearranca en ≤ 1 tick; `close_owned_segment_for_exit` pone la retención `SessionEnd` antes del stop. Evidencia: tests puros en `scheduled_recording` + comprobación manual (matriz E2E).
- **AC-4** — Tras el cierre automático dentro del horario el skip es `closed_for_day` con mensaje "…siguiente horario" y el rearme dura hasta el siguiente inicio de ventana (turno 22–06 conserva 22:00–00:00). Evidencia: `cargo test --lib scheduled_recording` con tabla día/noche/fin de semana.
- **AC-5** — "Evaluar ahora" evalúa en el siguiente instante (`reset_immediately`). Evidencia: `service.rs` muestra `reset_immediately` en `CheckNow`.
- **AC-6** — El paro del usuario y el cierre del día sobreviven al reinicio; salida/logout/apagado nunca escriben supresión a disco; registros vencidos, corruptos o con reloj movido se descartan; versión futura se ignora sin borrar. Evidencia: `cargo test --lib scheduled_recording::runtime_state` verde + comprobación manual (7) de la matriz.
- **AC-7** — `health.heartbeat` de ambos emisores lleva `idle_reason` (dominio de 16 valores) y el bloque `jornada`; el scheduler emite `jornada.idle_reason_changed` por el outbox en cada transición. Evidencia: tests de tabla de `idle_reason` y de claves serializadas de `HealthSnapshot`; `invoke('get_health_snapshot')` en DevTools muestra ambos campos.
- **AC-8** — `device.profile.jornada` lleva la configuración y `jornada.settings_changed` se emite una sola vez por cambio real (el gate que guarda dos veces produce una fila). Evidencia: test puro de `changed_fields` + comprobación manual (6).
- **AC-9** — En canal directo `autostart_state` dice `disabledByUser` (con `autostart_disabled_at`) cuando el Administrador de tareas lo apagó, con el mismo predicado que auto-launch; `package_installed_at` existe en MSIX y NSIS. Evidencia: tests de `classify_direct` y conversión FILETIME + comprobación manual (5).
- **AC-10** — Cada proceso emite `app.start` con `prev_version`, `prev_exit_reason/source/clean`, `downtime_s`, `prev_session_id` y `prev_panicked`; el marcador vive en `lifecycle.json` (debug en `lifecycle-debug.json`); una suspensión >180 s emite `app.resumed`. Evidencia: `cargo test --lib logging::telemetry::lifecycle` (tabla de `summarize_prev`) + comprobación manual (4) y (10).
- **AC-11** — `app.exit` registra `tray_quit`, `rival_install`, `update`, `restart`, `app_exit`, `last_window_closed`, `os_session_end` (logoff/shutdown), `external_close`; el marcador se escribe antes de todo y el insert del outbox está acotado a 750 ms. Evidencia: tabla de `classify_exit` y de `session_end::classify` en tests + comprobación manual (1) y (2).
- **AC-12** — En fin de sesión de Windows el hilo principal queda acotado (presupuesto total < 5 s, sin merge, finalize ni espera de transcripción dentro de WM_ENDSESSION); el scheduler y los arranques quedan congelados; todas las demás salidas conservan el camino actual. Evidencia: test de invariante de presupuestos + comprobación manual (3).
- **AC-13** — La recuperación valida cada checkpoint, concatena los válidos (`partial`), renombra los malos sin borrarlos y el frontend ya no borra `.checkpoints` tras un merge fallido. Evidencia: test del builder de la lista y `useTranscriptRecovery.ts` condiciona `cleanup_checkpoints` al estado.
- **AC-14** — El update NSIS pasa por `direct_update_install`: se niega con grabación o post-proceso en curso; el hook cierra DB y sidecar solo tras un `extract` exitoso y deja `app.exit` `update`/`nsis`; la capability queda en `updater:allow-check` y un fitness test impide instalar desde JS. Evidencia: tests de `direct_update` y de `UpdateDialog.test.tsx` + comprobación manual (11).
- **AC-15** — "Cerrar Maity para actualizar" (Store) sale por el comando Rust `exit_for_update` y el StoreContext deja intención; el siguiente `app.start` reporta `prev_exit_reason = update`. Evidencia: test de `UpdateDialog.test.tsx` y de `summarize_prev` con intención pendiente.
- **AC-16** — `autostart.changed` compara contra la línea base del marcador (primer arranque = solo línea base; avanza solo si la fila quedó en el outbox) y Ajustes avisa en canal directo cuando Task Manager lo apagó. Evidencia: test puro de `decide_change` + comprobación manual (5).
- **AC-17** — Todo logout pasa por `AuthContext.signOut` → `logout_cleanup` y la re-entrada devuelve el mismo promise. Evidencia: `authSignOut.fitness.test.ts` verde (y falla contra el SidebarFooterV5 viejo).
- **AC-18** — Recargar el webview con sesión viva no llama `clear_current_user` ni `cloud_sync_clear_session`. Evidencia: test de `shouldReleaseRustUser` en `lib/authRelease.test.ts`.
- **AC-19** — `auth.logout` se emite desde Rust con `surface` y se sube con el token de quien sale; `auth.session_lost` solo se emite por SIGNED_OUT espontáneo o arranque sin sesión con marca previa y error no reintentable (nunca por red caída). Evidencia: tests de `logout_payload`, `should_emit_session_lost` y `lib/authSessionLost.test.ts` + comprobación manual (9).
- **AC-20** — Si la sesión se cae a media grabación, la grabación se detiene y guarda antes de soltar al usuario y un re-login reanuda la jornada. Evidencia: `AuthContext.tsx` espera `session_lost_cleanup` antes de `clear_current_user`; comprobación manual con `__pollDebug.forceTokenRefresh()` tras revocar la sesión.
- **AC-21** — Cada tarea de código termina con `cd /c/maity_desktop/frontend && npm run tauri:build:debug` → exit 0, y sus tests (`cargo test --lib <módulo>` / `npm run test`) verdes.
- **AC-22** — La query "¿Por qué no grabó? — persona × día hábil" de `docs/TELEMETRIA.md` corre en prod (solo SELECT) sin error y distingue las causas del issue más parcial, suspensión y "sin red". Evidencia: ejecución con `mcp__supabase__execute_sql` registrada en el narrativo de A1.
- **AC-23** — CLAUDE.md, REGLAS_AUDIO_GRABACION.md, CANALES_DISTRIBUCION.md, NUBE_CUENTAS_SYNC.md y ONBOARDING_Y_GATES.md describen las reglas nuevas y TELEMETRIA.md coincide con el código (cada nombre del contrato existe en el código). Evidencia: `ruta:línea` de cada sección + `node scripts/lint-telemetry.js` OK.
- **AC-24** — Comprobación manual: Julio corre la matriz E2E de 11 escenarios de `verify.md` en NSIS y MSIX y cada día de prueba cae en la causa esperada de la query.

## Qué NO hacer
- No `git push`: lo hace Julio.
- No ejecutar con `--parallel`: los archivos compartidos en secuencia chocarían entre worktrees.
- No editar `C:\maity` (repo web) ni la copia de la skill `piloto-analisis` de este repo.
- No usar la palabra que empieza con "shut" y acaba con "down" en comandos Bash, títulos ni mensajes de commit (el guard los bloquea): Edit/Grep/Read y "apagado".
- No volver a `supabase.auth.signOut()` directo, ni meter `await` de supabase-js dentro de `onAuthStateChange`.
- No persistir una supresión de la jornada desde ninguna ruta de salida, logout o apagado; no persistir el back-off.
- No hacer merge, finalize, emits, getters de ventana, tray ni notificaciones dentro de `WM_ENDSESSION`; no borrar audio en esa ruta.
- No cerrar el pool de la DB antes de que el plugin del updater haya extraído el instalador.
- No usar `telemetry.json` (plugin-store, no atómico, guarda `install_id`) para estado nuevo.
- No `'unknown'` en campos de versión (null); no `log::error!` en `logging/telemetry/*`; no `.lock().unwrap()`.
- No cambiar el intervalo de checkpoints (30 s), la extensión `.mp4` ni el bitrate (reglas #08/#18/#27).
- No añadir eventos Tauri nuevos (solo comandos) ni capabilities para comandos propios.
