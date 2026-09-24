---
slug: fixes-pre-0262
run_id: wf_437f7958-ff5
base_commit: 7ac377442d633f9ce9d4196d1431f2b1522e59bd
head_commit: 57333f9e55a86f7babb4a6fd9e32ff94f6ee4451
status: executed
---

# Reporte de ejecución: fixes-pre-0262

> REFERENCIA HISTÓRICA — este reporte describe una corrida ya terminada; no re-ejecutar sus tareas.

## Resumen
Se ejecutaron las 6 tareas de la spec `fixes-pre-0262` (F1 a F6). Cada una dejó un commit local en `main` encima de `7ac3774`. No falló ninguna tarea, ninguna necesitó correcciones y el árbol de trabajo quedó limpio. Cada tarea tuvo 2 refutadores y ninguno la refutó. Re-ejecuté las tres métricas de seguimiento sobre el HEAD `57333f9` y las tres están en verde: `cargo test --lib` dio 976 passed y 3 ignored (antes 958), vitest dio 564/564 y `lint-telemetry` dio OK con 37 eventos. Veredicto: listo para la compuerta manual (`tauri:build:debug` más el E2E). Hay dos reservas menores: la garantía de "exactamente una fila" de `app.window_shown` y dos afirmaciones de los docs que se presentan como observadas cuando son inferidas. Las detallo en Riesgos.

## Criterios de aceptación
| AC | Evidencia (comando o archivo:línea) | Resultado |
|---|---|---|
| AC-1 | `recording_manager.rs`: `save_recording_only(&mut self, app, recording_duration: Option<f64>)` ya no lee el estado. `recording_lifecycle.rs:825`: `manager.save_recording_only(&app, captured_duration_seconds)`. `recording_state.rs` tiene el nuevo `mod duration` con 3 tests: `cleanup_borra_el_inicio_y_la_duracion_activa_queda_en_none`, `las_pausas_cerradas_se_restan` y `stop_recording_conserva_el_inicio`. Los 976 de `cargo test --lib` pasan. | cumplido |
| AC-2 | `status_snapshot.rs`: `publish_starting(gen)` usa la misma guarda `slot.gen != gen \|\| !slot.loop_running` y pone `phase=Recording` y `skip=None`. `service.rs`: `evaluate_tick(..., gen)` llama a `publish_starting(gen)` antes de `start_recording_with_meeting_name`. El test serial `slot_static_gen_y_loop_running_descartan_ticks_tardios` se extendió con tres casos: generación vieja (se ignora), generación vigente (queda `recording`/`None`) y después de `publish_stopped` (se ignora). No se creó un test nuevo sobre el SLOT. Diferencia menor: el test llama a `heartbeat_fields(RecordingPhase::Idle, …)` y el AC dice `Recording`. El bloque `jornada` copia el SLOT sin mirar la fase de grabación, así que el resultado es el mismo. | cumplido |
| AC-3 | `logging/commands.rs`: la función pura `parse_hiberboot_enabled` más `read_hiberboot_enabled` (winreg HKLM `...\Session Manager\Power!HiberbootEnabled`, con `None` fuera de Windows). Tests: 0→false, ≠0→true, ausente→None y serialización del campo. `healthHeartbeatService.ts`: `hiberboot_enabled: boolean \| null`. `docs/TELEMETRIA.md` fila `device.profile`: "Desde 0.2.62: `hiberboot_enabled`…". | cumplido |
| AC-4 | `lifecycle.rs`: `os_logon_ms` en `LifecycleMarker`, `BootPrev`, `PrevInput` y `StartExtras` (`MARKER_SCHEMA` no se subió). `LOGON_TOLERANCE_MS = 2_000`. La rama `os_session_end_unclean` va después de `os_restart_unclean` y antes de `unclean`. Tests nuevos: 11b, 11c, 11d, 11e (bordes de tolerancia), 11f (marcador viejo y lado actual sin logon dan `null`/`unclean`) y `filetime_to_unix_ms`. El test de claves exige `obj.len() == 29`. Pasa dentro de los 976. | cumplido |
| AC-5 | `grep -n os_session_end_unclean docs/TELEMETRIA.md` encuentra: tabla de motivos `:441`, precedencia `:450`, sección "Inicio rápido de Windows" `:470` y query `:908`. La fila `app.start` lista `os_logon_at` y `logon_changed_since_prev` ("Total: 29 claves"). | cumplido |
| AC-6 | Módulo `logging/telemetry/window_shown.rs`. Es una máquina de estados `ShownTracker` con un latch `emitted`, un payload con las 6 claves exactas y la emisión vía `emit::emit_event` (outbox). Está cableado en `lib.rs`: `mark_setup_start`, `note_app_ready` en el listener de `APP_READY` y `note_fallback_shown` en el fallback. El evento está en `catalog.rs` y `telemetry-events.ts` y tiene su fila en TELEMETRIA. `lint-telemetry` dice "OK (37 eventos, 12 legacy)". Los 5 tests pasan: ready primero, fallback con ready tardío, fallback sin ready, doble llamada y claves. La reserva sobre "exactamente una por proceso" está en Riesgos. | cumplido (con reserva) |
| AC-7 | `NUBE_CUENTAS_SYNC.md:35`: el título se conserva, así que el puntero de `CLAUDE.md:241` resuelve. Se añadieron dos subsecciones, "Recargar el webview…" y "Sesión perdida…", con citas a `authRelease.ts:23-31/44-51`, `AuthContext.tsx:139/148-183/553-565` y `lib.rs:223-244`. `ONBOARDING_Y_GATES.md:25` menciona `reset_immediately` (`service.rs:837-845`; `tick.reset_immediately()` vive en `service.rs:844`), y se corrigió la afirmación de LocalCache en la línea del runtime. `CANALES_DISTRIBUCION.md` tiene el bloque "CORRECCION (2026-09-24)" con la migración NSIS→Store marcada "SIN verificar". `CLAUDE.md:51` y `:199` quedaron reescritos. La reserva sobre lo observado frente a lo inferido está en Riesgos. | cumplido (con reserva) |
| AC-8 | Lo re-ejecuté en esta revisión: `npm run test` da Test Files 68/68 y Tests 564/564. `node scripts/lint-telemetry.js` da OK con 37 eventos. | cumplido |

## Tareas
| Tarea | Riesgo | Correcciones | Refutadores | Verificación | Commit |
|---|---|---|---|---|---|
| F1 | medium | 0 | 2 no sostenidas | verde | `8786ce5` |
| F2 | medium | 0 | 2 no sostenidas | verde | `4eb58ba` |
| F3 | medium | 0 | 2 no sostenidas | verde | `951d78e` |
| F4 | high | 0 | 2 no sostenidas | verde | `9a4b995` |
| F5 | medium | 0 | 2 no sostenidas | verde | `8af92c8` |
| F6 | medium | 0 | 2 no sostenidas | verde | `57333f9` |

## Commits
- `8786ce5` · fix(grabacion): metadata.json guarda la duración de la grabación (S2) · F1
- `4eb58ba` · fix(telemetria): el latido recording-start trae el bloque jornada de la jornada que arranca (S2) · F2
- `951d78e` · feat(telemetria): hiberboot_enabled en device.profile para leer el Inicio rápido de Windows (S2) · F3
- `9a4b995` · feat(telemetria): hora de logon de Windows en app.start y razón os_session_end_unclean para el Inicio rápido (S2) · F4
- `8af92c8` · feat(telemetria): evento app.window_shown con quién mostró la ventana y cuánto tardó el frontend (S2) · F5
- `57333f9` · docs: reglas de recarga y sesión perdida, reset_immediately y AppData real bajo MSIX (S2) · F6

Los archivos de cada commit coinciden con los `filesChanged` que reportó el workflow. No hay archivos fuera de alcance ni sueltos. La rama `backup/2026-09-24-fixes-pre-0262` existe y apunta a `7ac3774`.

## Fallos
Ninguno. `git status --short` sale vacío.

## Riesgos
- **No verificado:** `npm run tauri:build:debug` no corrió sobre este HEAD, ni sobre el código de #83. Es la compuerta obligatoria antes del bump.
- **Tampoco verificado:** el E2E (a)-(e). En concreto:
  - F1: ningún test construye un `RecordingManager`, así que la escritura de `metadata.json` solo se comprueba con el E2E (a).
  - F4: la llamada `unsafe` a `WTSQuerySessionInformationW`/`WTSFreeMemory` y el `read_unaligned` de `WTSINFOW` no los cubre ningún test (solo la conversión pura de FILETIME). La feature `Win32_System_RemoteDesktop` la valida el build.
- **AC-6, "exactamente una fila por proceso":** en la práctica no está garantizado.
  1. Si el proceso sale menos de 60 s después de un fallback y sin app-ready, no queda fila, porque la espera vive en un `spawn` en memoria.
  2. Si otra ruta muestra la ventana antes de los 3 s, el fallback no se arma porque ve `is_visible()`. Por ejemplo, el handler de single-instance hace `window.show()` en `lib.rs` hacia la línea 740. En ese caso la fila sale como `app_ready` si el frontend llega, o no sale nunca si no llega.
  3. `mark_setup_start()` no es literalmente la primera sentencia del `setup()`: va después de dos `log::info!`, aunque sí antes de `rotate_at_boot`. El doc de TELEMETRIA dice "primera sentencia"; el desfase es despreciable.
- **AC-7, afirmaciones de los docs:** `CANALES_DISTRIBUCION.md` pone `scheduled_recording_runtime.json` entre los archivos "observados" el 09-24, y `CLAUDE.md:51` dice que el MSIX usa "los mismos archivos reales (DB, modelos, …)". Los hechos de la spec solo registran como observados la SQLite, `lifecycle.json` y los logs. Lo del runtime de jornada y los modelos sale de la regla de Microsoft, no de una observación. Conviene matizarlo o confirmarlo en el E2E.
- **F2:** el arreglo solo cubre los arranques de jornada. Para una grabación manual, el bloque `jornada` del latido sigue siendo el del último tick (hasta 30 s de retraso). Está documentado en TELEMETRIA.
- **Métricas de seguimiento:**
  - vitest: 564, igual que la línea base. Ninguna tarea añadió tests TS.
  - Eventos del catálogo: 37, antes 36.
  - `cargo test --lib`: 976 passed y 3 ignored, antes 958. Los +18 son 3 de F1, 4 de F3, 6 de F4 y 5 de F5. F2 extendió un test existente.
  - En el verify de F3, `src/app/(aux)/coach-float/page.feedback.test.tsx` falló una vez y pasó al re-correr. Es un test inestable que ya existía y no tiene que ver con estos cambios. En mi corrida pasó.
- **Refutadores:** 2 por tarea, 12 en total, ninguno refutó. No falta ninguno.
- **Deuda:** no se añadió deuda nueva. El código muerto (`RecordingManager::stop_recording`, `cleanup_without_save`) sigue ahí porque la spec lo dejó fuera de alcance. `graphify update .` no se corrió.

## Lecciones propuestas para CLAUDE.md
- En los docs de post-mortem, separar lo "observado (fecha, archivo)" de lo "inferido de la regla" cuando se describe el comportamiento del MSIX. En F6 se mezclaron el runtime de jornada y los modelos con lo observado.
- Una telemetría "1× por proceso" que dependa de una espera en memoria (p. ej. `app.window_shown`, 60 s) debe documentar que se pierde si el proceso sale antes.

## Qué queda para Julio
- Revisar los 6 commits locales (`8786ce5`..`57333f9`) y hacer el push manual (el agente no hace push).
- Compuerta obligatoria: `cd frontend && npm run tauri:build:debug` con exit 0 sobre `57333f9`. Si el smoke falla por una instancia corriendo, matar el PID y re-correr. `cargo test --lib` completo ya dio verde en esta revisión (976/0/3).
- Pruebas E2E con un MSIX local (`/store-msix`) y la NSIS debug, más la matriz de 11 escenarios de `docs/specs/telemetria-ciclo-vida-83/verify.md`:
  - (a) Grabar y detener: `metadata.json` de la carpeta de la grabación con `duration_seconds` numérico.
  - (b) Arranque de jornada: el latido `recording-start` trae `jornada.scheduler_phase=recording` y `skip=null`.
  - (c) Finalizar la tarea de Maity y cerrar sesión de Windows: el siguiente `app.start` trae `logon_changed_since_prev=true` y `os_session_end_unclean`.
  - (d) Apagar con Fast Startup: `hiberboot_enabled=true`, `os_rebooted_since_prev=false`, `logon_changed_since_prev=true` y `os_session_end` observado.
  - (e) Cada arranque deja una fila `app.window_shown`. Con la PC cargada debe salir `shown_by=fallback` con `app_ready_ms` numérico.
- En el E2E, confirmar también:
  - Si bajo MSIX, con datos previos, `scheduled_recording_runtime.json` y los modelos se usan en su ubicación real. Si no se confirma, suavizar esa frase en `CANALES_DISTRIBUCION.md` y `CLAUDE.md:51`.
  - Que un proceso que sale antes de 60 s tras un fallback es aceptable sin fila.
- Correr la query "¿Por qué no grabó? — persona × día hábil" sobre el usuario de pruebas para los días del E2E, y confirmar que un día con `os_session_end_unclean` cae en "PC apagada / suspendida / sin sesión de Windows".
- Correr `graphify update .`.
- Después: `/build patch` (0.2.62), `/store-msix` y bump de `maity.system_config['desktop_store_latest_version']`.
