# Verdict: needs_changes

## Issues
- [major] Riesgo 1 / §0: 'SessionEnd no se puede representar en disco… close_scheduled exige CloseCause explícito', o sea que por construcción una salida, logout o apagado nunca deja una supresión persistida.
  - Evidence: close_owned_segment_for_exit (service.rs:393-407) corre en la task de salida o logout. En Exit va en `tauri::async_runtime::block_on` sobre el hilo principal (lib.rs:1789); en el logout es la task del comando. El loop del scheduler es otra task tokio (service.rs:321). El runtime de tauri ES multi-hilo: tauri-2.11.2/src/async_runtime.rs:222-223 `Runtime::Tokio(TokioRuntime::new().unwrap())`, así que el UNVERIFIED del spec se resuelve y el loop sigue haciendo ticks durante la salida. close_scheduled pone `owned=false` solo DESPUÉS del stop y del finalize (L807, L838, L896-899). Durante el stop, la fase es Stopping y `is_recording_active` = `Recording | Paused` (recording_phase.rs:61-62) devuelve false. Un tick de 30 s que caiga en esa ventana entra al brazo `(true, Some(_))` con `!is_rec` (L686-692), que con el diseño pasa a `release_after_external_stop` → `set_rearm(UserStop)`, y ESO se persiste. La ventana es el stop completo (flush, merge de checkpoints de hasta 1 h) más finalize_segment_native: segundos, no microsegundos. El `SessionEnd` final lo sobrescribe y borra el archivo solo si close_scheduled llega al paso 5. No llega si: (a) logout_cleanup agota su timeout de 30 s y suelta el future (lib.rs:159-167); (b) vence el timeout de 30 s de RunEvent::Exit (lib.rs:1793-1801); (c) Windows mata el proceso durante WM_ENDSESSION (el escenario B5, justo el apagado con jornada activa). En los tres casos, al reiniciar se restaura un UserStop que nadie pidió y la jornada queda suprimida hasta la siguiente hora en punto.
  - Fix: Tomar la retención ANTES del stop. En close_owned_segment_for_exit, tras hacer snapshot de `owned_since`: (1) `set_rearm(Some(Rearm::session_end(now)))`, que borra el archivo; (2) `owned.store(false)`, para que el tick concurrente vaya al brazo `(false, Some)`, choque con la retención SessionEnd y devuelva Armed sin arrancar, y nunca al brazo de 'paro externo'; (3) recién entonces close_scheduled(…, CloseCause::SessionEnd). Otra opción: un `AtomicBool closing_for_exit` en SchedulerShared que haga que evaluate_tick omita la detección de paro externo y el arranque. Añadir un test de política pura: 'si hay una retención de salida activa, la detección de paro externo nunca produce UserStop'. En el E2E manual, cambiar 'salir por el tray' por 'salir justo después de un tick y matar el proceso a mitad del guardado'.
- [major] §8 observe_stop_before_exit: 'Es idempotente con el tick… No-op si no somos dueños o si sigue grabando.'
  - Evidence: rotate_scheduled (service.rs:907-1029) corre dentro del tick y mantiene `owned=true` desde el stop (L927) hasta el nuevo arranque (L1003-1012). En medio hace stop, finalize_segment_native y emite eventos, y en todo ese tramo `is_recording_active_fn()` es false. observe_stop_before_exit corre en OTRA task (salida o logout) y ve `owned && !is_rec` dentro de ventana. Entonces registra y PERSISTE un UserStop falso y pone `owned=false`/`owned_since=None` mientras la rotación termina y vuelve a poner `owned=true` (L1011-1012). Queda un estado incoherente: somos dueños con un rearm activo. La misma carrera existe contra close_scheduled en el tick de auto-cierre (owned=true hasta L896). Además, graceful_shutdown_before_exit ahora toma `state.read()` y hace I/O en CADA salida, también dentro de WM_ENDSESSION, que es lo que B5 intenta acortar.
  - Fix: Quitar el §8 de B4. Su valor es bajo: un paro seguido de salida en menos de 30 s solo provoca un rearranque tras reiniciar, y el usuario lo puede detener. Si se conserva, protegerlo con un `AtomicBool transition_in_progress` que rotate_scheduled y close_scheduled activen antes del stop y limpien al terminar (con un guard RAII que se suelte en el Drop). observe_stop_before_exit sale sin hacer nada mientras esté activo, y además exige `recording_phase::current_phase() == Idle`.
- [minor] Regla 6 de restore: 'una supresión restaurada nunca dura más de lo que pudo durar cuando se creó' cubre los saltos de reloj hacia atrás.
  - Evidence: La regla solo acota `until - now <= span_max + 10 min`. Ejemplo: un AutoClose con set_at D 18:05 y until D+1 00:00, y el reloj retrocede a D 00:30 (RTC o zona horaria). `until - now` = 23.5 h ≤ 24 h 10 min → Restored, y el día D 'repetido' queda suprimido entero. Nada exige `now >= set_at - tolerancia`.
  - Fix: Añadir la regla 5-bis: `if now < set_at - CLOCK_SKEW_TOLERANCE → Rejected("clock_moved_back")`. Añadir un test: auto_close con set_at 18:05 y now 00:30 del mismo día → Rejected.
- [minor] restore: `version > RUNTIME_STATE_VERSION → Rejected("future_version")` seguido de `runtime_state::remove`.
  - Evidence: §7 borra el archivo en cualquier Rejected. Un downgrade dentro del mismo canal (reinstalar una NSIS vieja) destruiría el estado de la versión nueva. Los canales no comparten AppData (docs/CANALES_DISTRIBUCION.md), así que solo afecta al mismo canal. Contradice el espíritu de 'migraciones aditivas / version skew'.
  - Fix: Con future_version, ignorar el archivo sin borrarlo. Borrar solo en corrupt, inconsistent, clock_moved_back y expired.
- [minor] Directorio: `app_data_dir` (Roaming) para un estado de máquina.
  - Evidence: En Windows, tauri app_data_dir resuelve a %APPDATA% (Roaming). El propio spec marca como UNVERIFIED el efecto de los roaming profiles corporativos: una supresión puede 'viajar' a otro PC del mismo usuario. Es estado de runtime de este proceso y esta máquina, no una preferencia.
  - Fix: Usar `app.path().app_local_data_dir()` (%LOCALAPPDATA%\com.maity.ai; bajo MSIX va redirigido a LocalCache\Local). El Roaming no aporta nada aquí. Actualizar la ruta del paso de verificación manual.
- [minor] 'Un reingreso en <30 s (antes de que un tick vea "sin sesión") reanuda como máximo a los 15 min' y que SessionEnd → skip None sea inocuo.
  - Evidence: Mientras dura la retención, evaluate_tick devuelve (Armed, None): la UI muestra 'Armed' sin razón hasta 15 min tras un logout y login rápido. Además el comportamiento cambia de forma visible: tras logout y login, la jornada rearranca en vez de quedar suprimida hasta medianoche. Eso es una decisión de producto que Julio debe aprobar explícitamente (feedback_decisiones_explicar_en_prosa).
  - Fix: Mantener la liberación por `!has_session`, que es correcta porque evita arrancar con la sesión que se va. Liberar además la retención en la transición None→Some de set_current_user (o en clear_current_user) para no depender del tick. Presentar el cambio de comportamiento a Julio antes de commitear.
- [minor] Dependencia con B3 y B5 descrita como 'autocontenido'.
  - Evidence: Antes de B3, restaurar un AutoClose al abrir la app dispara el toast 'se reanudará a la siguiente hora en punto' (service.rs:98-100 vía ScheduledRecordingIndicator.tsx:33-35), en CADA arranque del resto del día, incluido el autostart. Hoy ese mensaje erróneo solo sale una vez en memoria; con B4 se repite. B5 puede cambiar qué hace graceful_shutdown_before_exit en WM_ENDSESSION (por ejemplo, no pasar por close_scheduled), y entonces no se pondría ninguna retención SessionEnd y reaparecería la carrera del issue 1.
  - Fix: Ordenar los commits B3 → B4, y B4 antes que B5 o coordinado con él. Documentar en B5 que cualquier ruta de salida con un segmento propio debe poner la retención SessionEnd antes del stop.
- [minor] Protocolo de cierre del commit.
  - Evidence: CLAUDE.md § graphify pide `graphify update .` tras modificar código. El spec no lo menciona. El comando de backup `git branch backup/...` es equivalente a `git checkout -b … ; git checkout -` del Protocolo Guardian: OK.
  - Fix: Añadir `graphify update .` después del build verde.

## Confirmed claims
- rearm_at vive solo en memoria: service.rs:252 `rearm_at: Arc<RwLock<Option<NaiveDateTime>>>`, L271 `Arc::new(RwLock::new(None))`; initialize (L303-308) solo carga settings.
- Exactamente 7 escritores de rearm_at, todos en service.rs: L604 y L674 (limpian), L689 y L939 (next_hour_boundary), L810, L841 y L899 (start_of_next_day). No hay escritores ni tests fuera de service.rs.
- close_owned_segment_for_exit (L393-407) reutiliza close_scheduled (L405), y close_scheduled suprime hasta medianoche en sus 3 salidas. Llamadores de close_scheduled: L405 y L547.
- graceful_shutdown_before_exit (lib.rs:1833-1861) es el embudo de tray.rs:69, lib.rs:161 (logout_cleanup, timeout de 30 s), lib.rs:1795 (RunEvent::Exit con block_on y timeout de 30 s) y rival_install.rs:78.
- Bug latente en memoria: tras logout con jornada activa y un nuevo login, el brazo (false, Some) pasa los gates NoSession/Registration (L585-595) y choca con el rearm hasta medianoche (L599-603). Contradice el comentario de L581-584 y ONBOARDING_Y_GATES.md:10.
- El UNVERIFIED del runtime queda resuelto: tauri-2.11.2 async_runtime.rs:222-223 usa `TokioRuntime::new()`, que es multi-hilo (tokio con rt-multi-thread, Cargo.toml:142). El loop sigue corriendo durante block_on de Exit.
- La retención en memoria durante la salida sí cumple una función: AuthContext.tsx:108-124 llama clear_current_user desde un efecto, después de logout_cleanup.
- start_backoff solo vive en memoria (L260). next_backoff pone halted_for_day hasta start_of_next_day (L208-214). UpdateSettings y CheckNow solo limpian start_backoff (L480, L486), nunca rearm_at.
- catch_up_on_start es un campo muerto (settings.rs:28 y :121; el servicio no lo lee).
- save_settings (settings.rs:202-210) serializa el struct completo con tokio::fs::write; tokio::fs ya se usa en el módulo y compila hoy.
- El setup (lib.rs:1370-1395) llama initialize bajo `scheduler_state.write()` antes de start(), solo si enabled; initialize_scheduled_recording (commands.rs:18) no tiene llamadores.
- ScheduledRecordingIndicator.tsx:33-35 muestra como toast cualquier `message` de scheduled-recording-skipped; prev_skip empieza en None (service.rs:432, 456-461).
- chrono tiene el feature serde (Cargo.toml:92); tempfile es dev-dependency (Cargo.toml:321) y ya se usa en audio_retention.rs:389.
- next_hour_boundary (schedule.rs:77-84) es determinista, así que la validación 'until == recálculo desde set_at' es viable.
- `use super::*` en un mod de tests hijo recoge los `use` privados del padre (Rust 2018+). backoff_tests seguirá compilando tras mover start_of_next_day.
- idle_unload (idle_unload.rs:187-191) solo lee settings bajo state.read() y no consulta rearm: no es un consumidor que haya que cambiar.

## Corrected design notes
La base del spec es sólida: una causa explícita (UserStop, AutoClose o SessionEnd), un archivo aparte con escritura atómica, un único escritor `set_rearm` y la carga en `initialize` antes del loop. Hay que corregir dos carreras antes de implementarlo.

1) La retención de salida se toma ANTES del stop. En `close_owned_segment_for_exit`:
   - snapshot de `owned_since`;
   - `set_rearm(Some(Rearm::session_end(now)))`, que borra el archivo;
   - `owned.store(false)`;
   - después, `close_scheduled(…, CloseCause::SessionEnd)`.

   Así el tick concurrente, que sigue corriendo porque el runtime de tauri es multi-hilo, entra a `(false, Some)` y queda retenido. Nunca llega a `(true, Some) && !is_rec`, que hoy fabricaría un UserStop persistido durante el stop o el finalize. Ese UserStop sobreviviría si logout_cleanup o Exit agotan su timeout de 30 s o si Windows mata el proceso en WM_ENDSESSION.

   Como refuerzo conviene un `AtomicBool transition_in_progress`. rotate_scheduled y close_scheduled lo activan antes del stop y un guard RAII lo suelta. Con él activo, evaluate_tick nunca interpreta un `!is_rec` como paro del usuario.

2) Quitar de B4 el §8 (`observe_stop_before_exit`). Choca con la ventana stop→restart de rotate_scheduled, en la que owned=true y is_rec=false, y persiste UserStops falsos. Si se quiere conservar, exigir `!transition_in_progress && recording_phase == Idle`.

3) En restore, añadir `now >= set_at - 10 min`. Si no, un reloj que retrocede dentro del mismo día restaura un AutoClose que suprime el día completo.

4) Con future_version, ignorar el archivo sin borrarlo.

5) Usar `app_local_data_dir` en vez de `app_data_dir` (Roaming): es estado de máquina y no debe viajar con el perfil.

6) Liberar SessionEnd también en la transición de sesión (clear_current_user o None→Some de set_current_user), no solo por sondeo del tick.

7) Consultar con Julio el cambio de comportamiento: tras logout y login la jornada rearranca, cuando hoy queda suprimida hasta medianoche.

8) Orden de commits: B3 antes de B4, para que el toast de un AutoClose restaurado diga 'cerrada por hoy' y no 'siguiente hora'. B5 debe mantener la invariante 'toda ruta de salida con segmento propio pone SessionEnd antes del stop'.

9) Tests nuevos:
   - política pura: 'con retención de salida o transition_in_progress, la detección de paro externo no produce UserStop';
   - restore con set_at futuro respecto de now → Rejected;
   - future_version no borra el archivo.

10) Al cerrar el commit: `graphify update .` tras `pnpm run tauri:build:debug` con exit 0.

Sin eventos de telemetría nuevos: no toca lint-telemetry, lint-tauri-events ni lint-cargo-deps.