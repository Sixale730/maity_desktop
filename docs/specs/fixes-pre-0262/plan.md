# Plan: cinco arreglos antes del bump a 0.2.62

Spec: `spec.md` · Verificación: `verify.md`

## Tareas

El bloque JSON es la fuente de verdad para `/spec-execute`: se copia verbatim a `args.plan`.
Campos por tarea: `id` (único), `title`, `files` (rutas relativas, no vacío), `deps` (ids), `risk` (`low` = 0 refutadores; `medium` = 2; `high` = 2 + lente de seguridad + implementador Opus), `tdd` (solo si `verify.tests` es true), `suites` (claves de `verify.suites`; vacío = `verify.default`), `verify` (comandos propios; vacío = usar suites), `criteria` (ids AC-n), `commit` (mensaje exacto, con tag de fase).

`docs/TELEMETRIA.md` lo comparten F2, F3, F4 y F5 A PROPÓSITO y EN SECUENCIA (cadena de `deps`), igual que en #83: cada
tarea documenta su propio cambio. `check-spec` lo reporta como "already owned": es intencional.

```json
{
  "spec": "fixes-pre-0262",
  "phaseTag": "S2",
  "tasks": [
    {
      "id": "F1",
      "title": "metadata.json guarda la duracion capturada antes del teardown",
      "files": [
        "frontend/src-tauri/src/audio/recording_manager.rs",
        "frontend/src-tauri/src/audio/recording_lifecycle.rs",
        "frontend/src-tauri/src/audio/recording_state.rs"
      ],
      "deps": [],
      "risk": "medium",
      "tdd": false,
      "suites": [],
      "verify": [
        "cd /c/maity_desktop/frontend/src-tauri && cargo test --lib audio::recording_state"
      ],
      "criteria": ["AC-1"],
      "commit": "fix(grabacion): metadata.json guarda la duración de la grabación (S2)"
    },
    {
      "id": "F2",
      "title": "La jornada publica su fase antes de arrancar y el latido recording-start ya no trae el bloque jornada viejo",
      "files": [
        "frontend/src-tauri/src/scheduled_recording/service.rs",
        "frontend/src-tauri/src/scheduled_recording/status_snapshot.rs",
        "docs/TELEMETRIA.md"
      ],
      "deps": [],
      "risk": "medium",
      "tdd": false,
      "suites": [],
      "verify": [
        "cd /c/maity_desktop/frontend/src-tauri && cargo test --lib scheduled_recording",
        "cd /c/maity_desktop/frontend/src-tauri && cargo test --lib logging::commands"
      ],
      "criteria": ["AC-2"],
      "commit": "fix(telemetria): el latido recording-start trae el bloque jornada de la jornada que arranca (S2)"
    },
    {
      "id": "F3",
      "title": "hiberboot_enabled en device.profile",
      "files": [
        "frontend/src-tauri/src/logging/commands.rs",
        "frontend/src/services/healthHeartbeatService.ts",
        "docs/TELEMETRIA.md"
      ],
      "deps": ["F2"],
      "risk": "medium",
      "tdd": false,
      "suites": [],
      "verify": [
        "cd /c/maity_desktop/frontend/src-tauri && cargo test --lib logging::commands",
        "cd /c/maity_desktop/frontend && npm run test"
      ],
      "criteria": ["AC-3", "AC-8"],
      "commit": "feat(telemetria): hiberboot_enabled en device.profile para leer el Inicio rápido de Windows (S2)"
    },
    {
      "id": "F4",
      "title": "Hora de logon de Windows en el marcador y app.start, y razon os_session_end_unclean",
      "files": [
        "frontend/src-tauri/Cargo.toml",
        "frontend/src-tauri/src/logging/telemetry/lifecycle.rs",
        "docs/TELEMETRIA.md"
      ],
      "deps": ["F3"],
      "risk": "high",
      "tdd": false,
      "suites": [],
      "verify": [
        "cd /c/maity_desktop/frontend/src-tauri && cargo test --lib logging::telemetry::lifecycle",
        "cd /c/maity_desktop/frontend && node scripts/lint-telemetry.js"
      ],
      "criteria": ["AC-4", "AC-5"],
      "commit": "feat(telemetria): hora de logon de Windows en app.start y razón os_session_end_unclean para el Inicio rápido (S2)"
    },
    {
      "id": "F5",
      "title": "Evento app.window_shown: quien mostro la ventana principal y cuanto tardo el frontend",
      "files": [
        "frontend/src-tauri/src/logging/telemetry/window_shown.rs",
        "frontend/src-tauri/src/logging/telemetry/mod.rs",
        "frontend/src-tauri/src/logging/telemetry/catalog.rs",
        "frontend/src/lib/telemetry-events.ts",
        "frontend/src-tauri/src/lib.rs",
        "docs/TELEMETRIA.md"
      ],
      "deps": ["F4"],
      "risk": "medium",
      "tdd": false,
      "suites": [],
      "verify": [
        "cd /c/maity_desktop/frontend/src-tauri && cargo test --lib logging::telemetry::window_shown",
        "cd /c/maity_desktop/frontend && node scripts/lint-telemetry.js",
        "cd /c/maity_desktop/frontend && npm run test"
      ],
      "criteria": ["AC-6", "AC-8"],
      "commit": "feat(telemetria): evento app.window_shown con quién mostró la ventana y cuánto tardó el frontend (S2)"
    },
    {
      "id": "F6",
      "title": "Docs: recarga y sesion perdida en NUBE_CUENTAS_SYNC, reset_immediately, y AppData real bajo MSIX",
      "files": [
        "docs/NUBE_CUENTAS_SYNC.md",
        "docs/ONBOARDING_Y_GATES.md",
        "docs/CANALES_DISTRIBUCION.md",
        "CLAUDE.md"
      ],
      "deps": ["F5"],
      "risk": "medium",
      "tdd": false,
      "suites": [],
      "verify": [
        "cd /c/maity_desktop/frontend && node scripts/lint-telemetry.js"
      ],
      "criteria": ["AC-7"],
      "commit": "docs: reglas de recarga y sesión perdida, reset_immediately y AppData real bajo MSIX (S2)"
    }
  ]
}
```

## Parte F — arreglos previos al bump

Todas las rutas Rust son relativas a `frontend/src-tauri/src/`. Los hechos con `ruta:línea` están en `spec.md` § Hechos
ya verificados: no re-explorar. Correr `cargo test` en FOREGROUND con timeout 600000 (un `cargo test` en background lo mató
el reaper por RAM baja). Nunca `python -c` / `node -e`.

### F1. metadata.json guarda la duración capturada antes del teardown
1. `audio/recording_manager.rs:298-322`: cambiar la firma a
   `pub async fn save_recording_only<R: tauri::Runtime>(&mut self, app: &tauri::AppHandle<R>, recording_duration: Option<f64>) -> Result<()>`.
   Quitar la lectura `self.state.get_active_recording_duration()` de `:303` (a esa altura `cleanup()` ya borró el inicio) y usar
   el parámetro. Cambiar el log a `"Recording duration (captured before teardown): {:?}s"`. Doc-comment de 1-2 líneas:
   el llamador DEBE capturar la duración antes de `stop_streams_and_force_flush`, porque `state.stop_recording()` (`:277`)
   limpia la pausa abierta y `state.cleanup()` (`:292`) borra `recording_start` y `total_pause_duration`.
2. `audio/recording_lifecycle.rs:825`: `manager.save_recording_only(&app, captured_duration_seconds)`.
   `captured_duration_seconds` es `Option<f64>` y ya está en scope (`:610`); si el borrow checker lo pide, es `Copy`.
3. `audio/recording_state.rs` `mod tests` (desde `:589`): agregar un submódulo `mod duration` con:
   - `cleanup_borra_el_inicio_y_la_duracion_activa_queda_en_none`: `new()`, `start_recording().unwrap()`,
     `get_active_recording_duration().is_some()`, `cleanup()`, `get_active_recording_duration() == None`.
   - `las_pausas_cerradas_se_restan`: `start_recording`, `pause_recording`, dormir ~60 ms, `resume_recording`, dormir ~20 ms;
     `get_active_recording_duration()` < `get_recording_duration()` y la diferencia ≥ ~50 ms. Usar márgenes amplios; sin
     asserts de igualdad exacta de tiempo.
   - `stop_recording_conserva_el_inicio`: `start_recording`, `stop_recording()`, `get_recording_duration().is_some()`
     (documenta por qué la captura del lifecycle sirve aunque el auto-stop por error llame `stop_recording` antes).
- Importadores conocidos: `save_recording_only` tiene un solo llamador (`recording_lifecycle.rs:825`). `RecordingManager::stop_recording`
  (`:336`, código muerto) NO se toca.
- Resultado esperado: el log de parada dice la duración capturada y `metadata.json` queda con `duration_seconds` numérico.

### F2. La jornada publica su fase antes de arrancar
1. `scheduled_recording/status_snapshot.rs`: nueva función junto a `publish_tick` (`:113`):
   `pub(super) fn publish_starting(gen: u64)`: toma el lock de `SLOT`; si `slot.gen != gen || !slot.loop_running` no hace nada;
   si no, `slot.phase = SchedulerPhase::Recording; slot.skip = None;` y deja `rearm` y `backoff` como están. Doc-comment:
   se publica ANTES de `start_recording_with_meeting_name` porque ese arranque emite `recording-started` y el latido
   `recording-start` lee el SLOT antes de que el loop llegue a `publish_tick`; si el arranque falla, el `publish_tick` del
   mismo tick lo sobrescribe y no hubo `recording-started`.
2. `scheduled_recording/service.rs:856-862`: agregar `gen: u64` a `evaluate_tick` (último parámetro) y pasarlo en el único
   llamador (`:781-782`, `gen` ya existe en `run_scheduler_loop`).
3. `service.rs`, rama `(false, Some(_))`, justo antes de `start_recording_with_meeting_name` (`:1019`) y DESPUÉS del back-off
   (`:1012`): `status_snapshot::publish_starting(gen);`.
4. Extender el test serial `slot_static_gen_y_loop_running_descartan_ticks_tardios` (`status_snapshot.rs:858`), NO crear otro
   que toque el `static`: antes de `publish_stopped()`, con la generación vigente, `publish_tick(gen, Armed, Some(NoSession), None, None)`,
   luego `publish_starting(gen_actual.saturating_sub(1))` → `heartbeat_fields(RecordingPhase::Recording, now)` sigue con
   `jornada.skip == Some(no_session)`; luego `publish_starting(gen_actual)` → el bloque `jornada` trae la fase `recording` y
   `skip` `None` (usar los campos reales de `JornadaTelemetry`, `:309-324`). Tras `publish_stopped()`, un `publish_starting(gen_actual)`
   no cambia `phase` (queda `Disabled`).
5. `docs/TELEMETRIA.md`, sección del `health.heartbeat` (bloque `jornada`, ~`:330-352`): una nota de 2-3 líneas: el bloque es
   lo último que publicó el scheduler; un arranque de jornada publica `recording` antes de arrancar (desde 0.2.62), así que el
   latido `recording-start` ya no trae la fase del tick anterior; para una grabación manual el bloque sigue siendo el del último
   tick hasta el siguiente (≤ 30 s), y `phase`/`idle_reason` son la verdad.
- Resultado esperado: el latido `recording-start` de una jornada trae `jornada.scheduler_phase = recording`, `skip = null`.

### F3. hiberboot_enabled en device.profile
1. `logging/commands.rs`: función pura `pub(crate) fn hiberboot_from_raw(raw: Option<u32>) -> Option<bool>` (`Some(0)` → `Some(false)`,
   `Some(_)` → `Some(true)`, `None` → `None`) y un lector `#[cfg(target_os = "windows")] fn read_hiberboot_enabled() -> Option<bool>` con
   `winreg::RegKey::predef(winreg::enums::HKEY_LOCAL_MACHINE).open_subkey_with_flags(r"SYSTEM\CurrentControlSet\Control\Session Manager\Power", winreg::enums::KEY_READ)`
   `.and_then(|k| k.get_value::<u32, _>("HiberbootEnabled")).ok()` → `hiberboot_from_raw`. En no-Windows, `None`. Mismo patrón que
   `autostart_state.rs:213-233`. No necesita `with_mta` (registro, no COM).
2. `struct DeviceProfile` (`:411-453`): campo `pub hiberboot_enabled: Option<bool>,` con doc-comment ("`HiberbootEnabled` de
   HKLM; `true` = Inicio rápido activo: un apagado no reinicia el kernel y `os_boot_at` no cambia; desde 0.2.62"). Llenarlo en
   `get_device_profile` (`:455-506`). Actualizar los 4 literales de test (`:608-722`).
3. Tests en el `mod tests` de `commands.rs`: tabla de `hiberboot_from_raw` (0, 1, 2, None).
4. `frontend/src/services/healthHeartbeatService.ts:151-178` `interface DeviceProfile`: `hiberboot_enabled?: boolean | null` con
   comentario de una línea.
5. `docs/TELEMETRIA.md:257` fila `device.profile`: agregar `hiberboot_enabled` (Desde 0.2.62, `bool|null`, qué significa).
- Resultado esperado: `device.profile` en `platform_logs` trae `hiberboot_enabled`.

### F4. Hora de logon de Windows y razón os_session_end_unclean
1. `frontend/src-tauri/Cargo.toml:272-296`: agregar `"Win32_System_RemoteDesktop"` a las features de `windows` 0.58 (solo esa
   línea; sin crates nuevos).
2. `logging/telemetry/lifecycle.rs`: lector `#[cfg(target_os = "windows")] fn os_logon_ms() -> Option<u64>`:
   `WTSQuerySessionInformationW(WTS_CURRENT_SERVER_HANDLE, WTS_CURRENT_SESSION, WTSSessionInfo, &mut buf, &mut bytes)`; si `Ok`
   y `buf` no nulo y `bytes >= size_of::<WTSINFOW>()`, leer `(*(buf.0 as *const WTSINFOW)).LogonTime` (i64 FILETIME) y SIEMPRE
   `WTSFreeMemory(buf.0 as _)`. Convertir con una función pura `pub(crate) fn filetime_to_unix_ms(ticks: i64) -> Option<u64>`
   (≤ 0 o anterior a 1970 → `None`; misma época que `utils.rs:38-53`, `11_644_473_600 s`). No-Windows → `None`. Comentar el
   `unsafe`. Verificar los nombres exactos contra el crate (`~/.cargo/registry/src/*/windows-0.58*/src/Windows/Win32/System/RemoteDesktop/mod.rs`).
3. `LifecycleMarker` (`:67-87`): `pub os_logon_ms: Option<u64>,` (default por el `#[serde(default)]` del struct; NO subir
   `MARKER_SCHEMA`). Escribirlo en `rotate_at_boot` (`:358-372`) con el valor leído una vez al inicio de `rotate_at_boot`
   (junto a `os_boot`, `:330`). `BootPrev` (`:159-165`) + `os_logon_ms`; `BOOT_PREV.set` (`:399-405`).
4. `PrevInput` (`:544-552`) + `os_logon_ms: Option<u64>`; `StartExtras` (`:555-562`) + `os_logon_ms: Option<u64>`; llenarlos en
   `emit_start` (`:437-452`) desde `boot.os_logon_ms`. `PrevSummary` (`:564-590`) + `logon_changed_since_prev: Option<bool>`.
5. `summarize_prev` (`:596-719`): junto a `os_rebooted` (`:661`), `let logon_changed = match (marker.os_logon_ms, input.os_logon_ms) { (Some(a), Some(b)) => Some(a.abs_diff(b) > LOGON_TOLERANCE_MS), _ => None };`
   con `const LOGON_TOLERANCE_MS: u64 = 2_000;` junto a `OS_BOOT_TOLERANCE_MS` (`:58`). En la cadena de motivo (`:669-695`),
   entre `os_restart_unclean` y `unclean`: `else if logon_changed == Some(true) { ("os_session_end_unclean".to_string(), None, "inferred", false) }`.
   Actualizar el doc-comment de precedencia (`:596-600`). En la rama sin marcador usable (`:602-619`) el campo queda `None` (default).
6. `to_payload` (`:723-753`): `"os_logon_at": extras.os_logon_ms.and_then(ms_to_rfc3339)` (junto a `os_boot_at`) y
   `"logon_changed_since_prev": self.logon_changed_since_prev` (junto a `os_rebooted_since_prev`). Test de claves (`:1669-1692`):
   agregar ambas a la lista y `obj.len()` 27 → 29.
7. Tests nuevos (módulo de tests existente; seguir el estilo de `caso_11_boot_del_so_distinto_es_os_restart_unclean`, `:1608`):
   - logon distinto + boot igual + sin exit/intent/pánico → `os_session_end_unclean`, `inferred`, `prev_exit_clean == Some(false)`, `logon_changed_since_prev == Some(true)`.
   - logon distinto + boot distinto → `os_restart_unclean` (gana el boot).
   - logon distinto + exit observado `os_session_end` → sigue `os_session_end` observado.
   - logon igual (diferencia ≤ 2 s) + boot igual → `unclean`, `logon_changed_since_prev == Some(false)`.
   - marcador sin `os_logon_ms` (JSON viejo) → `logon_changed_since_prev == None`, `unclean`; parse OK.
   - `filetime_to_unix_ms`: 0 → None; un FILETIME conocido → ms esperados; negativo → None.
8. `docs/TELEMETRIA.md`:
   - Fila `app.start` (`:236`): `os_logon_at`, `logon_changed_since_prev` (Desde 0.2.62).
   - Tabla de motivos (`:413-440`): fila `os_session_end_unclean` | inferido | cambió la hora de logon de Windows sin cambiar el
     boot y sin salida registrada (cierre de sesión o apagado con Inicio rápido). Cambiar la nota de `os_restart_unclean` (`:428`)
     para apuntar a la sección nueva. Precedencia (`:437`): insertar el paso nuevo y renumerar.
   - Sección nueva corta "Inicio rápido de Windows (Fast Startup)": `os_boot_at` sale de `GetTickCount64`, que sigue contando tras
     un apagado con Inicio rápido (el kernel hiberna); por eso existe el logon (la sesión del usuario SÍ se cierra) y
     `device.profile.hiberboot_enabled` dice qué equipos lo tienen.
   - Query "¿Por qué no grabó?" (`:860-900`): agregar `'os_session_end_unclean'` a las listas `prev_salida in (...)` que hoy
     tienen `'os_session_end','os_restart_unclean'` (`:875`, y `:895` si aplica).
- Resultado esperado: en una PC con Inicio rápido, una app muerta antes de un cierre de sesión o apagado se clasifica como
  `os_session_end_unclean` y cae en "PC apagada / sin sesión".

### F5. Evento app.window_shown
1. `logging/telemetry/window_shown.rs` (nuevo), doc de módulo corto (qué mide, una fila por proceso, por qué no va en `app.start`):
   - `pub const FALLBACK_AFTER_MS: u64 = 3_000; pub const LATE_READY_WAIT_MS: u64 = 60_000;`
   - `static SETUP_START: OnceLock<std::time::Instant>`; `pub fn mark_setup_start()` (idempotente) y `fn elapsed_ms() -> u64` (0 si no se marcó).
   - Máquina de estados PURA y testeable (sin statics en los tests): `#[derive(Default)] pub(crate) struct ShownTracker { fallback_ms: Option<u64>, app_ready_ms: Option<u64>, emitted: bool }` con
     `fn on_app_ready(&mut self, at_ms: u64) -> Option<ShownPayload>` (primer ready: si no hubo fallback → emitir `app_ready` con `shown_ms = at_ms`; si hubo → emitir `fallback` con `shown_ms = fallback_ms`, `app_ready_ms = at_ms`; ya emitido → `None`),
     `fn on_fallback_shown(&mut self, at_ms: u64) -> bool` (registra y devuelve `true` si hay que armar la espera; `false` si ya emitió o ya había ready),
     `fn on_wait_expired(&mut self) -> Option<ShownPayload>` (si no emitió: `fallback` con `app_ready_ms = None`).
     `ShownPayload { shown_by: &'static str, shown_ms: u64, app_ready_ms: Option<u64> }` y `fn to_json(&self, started_at_boot: bool) -> serde_json::Value`
     con claves exactas `shown_by, shown_ms, app_ready_ms, started_at_boot, fallback_after_ms, late_ready_wait_ms`.
   - `static TRACKER: Mutex<ShownTracker>` y funciones públicas `pub fn note_app_ready<R: Runtime>(app: &AppHandle<R>)`,
     `pub fn note_fallback_shown<R: Runtime>(app: &AppHandle<R>)` (si arma la espera: `tauri::async_runtime::spawn` que duerme
     `LATE_READY_WAIT_MS` y llama `on_wait_expired`). La emisión: `tauri::async_runtime::spawn(emit::emit_event(&app, context::process_session_id(), catalog::APP_WINDOW_SHOWN, payload.to_json(crate::STARTED_AT_BOOT.load(Relaxed)), Some(TelemetryStatus::Ok), None, None))`
     (clonar el `AppHandle`). Lock con `unwrap_or_else(|e| e.into_inner())`, nunca `.unwrap()`.
   - Tests del tracker: ready primero → una emisión `app_ready`; fallback y luego ready → una emisión `fallback` con `app_ready_ms`;
     fallback y expira → `fallback` con `app_ready_ms: null`; segundo ready / expira después de emitir → `None`; claves exactas del JSON (6).
2. `logging/telemetry/mod.rs`: `pub mod window_shown;` y una línea en el doc del módulo.
3. `logging/telemetry/catalog.rs` bloque de ciclo de vida (`:60-65`): `pub const APP_WINDOW_SHOWN: &str = "app.window_shown";`
   `frontend/src/lib/telemetry-events.ts` (`:58-60`): `APP_WINDOW_SHOWN: 'app.window_shown',`.
4. `lib.rs`: al inicio del closure de `setup` (antes de `rotate_at_boot`, `:769`) `logging::telemetry::window_shown::mark_setup_start();`.
   En el listener de `APP_READY` (`:864`), al entrar (antes de `show()`): `logging::telemetry::window_shown::note_app_ready(&app_handle_for_show);`.
   En el fallback (`:891-905`), dentro del `if !window.is_visible()`, después de `show()`: `note_fallback_shown(&app_handle_for_fallback)`.
   No cambiar el intervalo de 3 s ni la lógica de show/minimize/focus (el fallback YA respeta `STARTED_AT_BOOT`).
5. `docs/TELEMETRIA.md`: fila nueva en el inventario (`:146-260`, junto a `app.start`/`app.exit`) con `` `app.window_shown` ``,
   emisor Rust, una por proceso, campos y significado (`shown_by=fallback` = el frontend tardó más de 3 s; `app_ready_ms: null` =
   nunca señaló en 60 s), Desde 0.2.62. Respetar la regla de cardinalidad (`:501-511`).
- Resultado esperado: `lint-telemetry` OK con 37 eventos; una fila `app.window_shown` por arranque.

### F6. Docs: recarga, sesión perdida, reset_immediately y AppData real bajo MSIX
Todo con `ruta:línea` de `spec.md` § Hechos (F6); nada de afirmaciones sin fuente. Español, tono de los docs existentes.
1. `docs/NUBE_CUENTAS_SYNC.md`, dentro o justo después de "Todo logout pasa por AuthContext.signOut (sep-2026, #83)" (`:35-42`):
   - Subsección "Recargar el webview NO suelta al usuario en Rust": síntoma (recarga → `maityUser=null` en el primer render →
     `clear_current_user` → jornada sin sesión, STT descargado, segmento `Failed`), regla `shouldReleaseRustUser` (solo Some→None o
     init terminado sin usuario; boot incierto por red no suelta), `authReady`, dónde vive y su test.
   - Subsección "Sesión perdida a media grabación": qué cuenta como pérdida real (`webview_signed_out`, `boot_no_session`; la red
     caída nunca), el orden (telemetría → `session_lost_cleanup` 30 s con hold SessionEnd → `clear_current_user` en el efecto, salvo
     re-login), tests y que AC-20 de #83 sigue manual.
   - Si el título de la sección cambia, actualizar el puntero de `CLAUDE.md:241` para que resuelva.
2. `docs/ONBOARDING_Y_GATES.md`: `:22` agregar que `CheckNow` usa `tick.reset_immediately()` (evalúa en el siguiente instante, no
   30 s después; `service.rs:837-845`); `:33` reemplazar "bajo MSIX va redirigido a LocalCache, así que Store y NSIS tienen cada
   uno el suyo" por el comportamiento real (ver 3) y la consecuencia para este archivo.
3. `docs/CANALES_DISTRIBUCION.md:15`: agregar una CORRECCIÓN (2026-09-24) sin borrar la del 07-27: la regla de Microsoft (solo
   se redirigen archivos/carpetas NUEVOS; si existe el de AppData real, el SO lo abre y no lo virtualiza), las dos observaciones
   (07-27 máquina sin datos → LocalCache; 09-24 máquina con datos de NSIS/dev → DB, modelos, marcador, runtime de jornada,
   WebView2 y logs en su lugar real), consecuencias (los canales comparten datos si NSIS llegó primero; `rival_install` es lo
   que evita dos procesos sobre la misma SQLite; el marcador de ciclo de vida de otro canal se lee `Foreign` y se pisa) y
   "migración NSIS→Store: conservación de datos NO verificada".
4. `CLAUDE.md:51` y `:199`: reescribir en una línea cada una con la regla real ("el MSIX solo redirige lo que crea nuevo; en una
   máquina con datos previos de NSIS/dev usa los mismos — ver `docs/CANALES_DISTRIBUCION.md`"), manteniendo el resto de la regla
   de `rival_install` intacto.
- Resultado esperado: ningún doc afirma que el MSIX siempre redirige AppData; CLAUDE.md apunta a reglas que existen.

## Verificación

Ver `verify.md`. Cada tarea corre sus `verify`; después, 2 refutadores independientes intentan demostrar que no cumple sus
`criteria` (F4 con lente de seguridad por el `unsafe` de WTS). Una sola corrección por tarea. El build integrado
`tauri:build:debug` y el `cargo test --lib` completo son la compuerta final manual (spec.md, después de AC-8), antes del bump.

## Commit

Un commit por tarea con el mensaje de `commit`. **Sin `git push`** — lo hace Julio.
