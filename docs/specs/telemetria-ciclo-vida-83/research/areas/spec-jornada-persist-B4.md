# B4: que la supresión de la jornada sobreviva al reinicio (rearm por paro del usuario y cierre del día)

## Summary
Hoy la supresión de la jornada vive solo en memoria (`SchedulerShared.rearm_at`, service.rs:252). Por eso un reinicio dentro de la ventana vuelve a arrancar la jornada aunque el usuario la haya detenido o el cierre por hora fija ya haya cerrado el día.

La trampa: la ruta de salida también pone una supresión hasta el día siguiente. `close_owned_segment_for_exit` (service.rs:393-407) llama a `close_scheduled`, que en sus 3 salidas hace `rearm_at = start_of_next_day(now)` (service.rs:810, 841, 899). `logout_cleanup` (lib.rs:157-169) y `rival_install` (rival_install.rs:78) pasan por esa misma ruta. Si se persiste `rearm_at` sin más, una salida, un logout o un apagado a mitad del día dejarían la jornada apagada hasta mañana.

Diseño:
1. Cambiar `Option<NaiveDateTime>` por `Option<Rearm { until, cause, set_at }>` con `RearmCause::{UserStop, AutoClose, SessionEnd}`.
2. `close_scheduled` recibe un `CloseCause` explícito: `AutoClose` desde el tick y `SessionEnd` desde la salida o el logout.
3. Solo se persisten `UserStop` (siguiente hora en punto) y `AutoClose` (medianoche). Van a un JSON de estado aparte, `app_data_dir/scheduled_recording_runtime.json`, con escritura atómica (tmp + rename) y serializada por un Mutex propio. `SessionEnd` es una retención solo en memoria: evita que el loop rearranque durante los hasta 30 s de la salida o antes de `clear_current_user`, y se suelta en cuanto el loop ve que ya no hay sesión (tope de 15 min).
4. La carga se hace en `initialize()` (service.rs:303), que corre una vez en el setup (lib.rs:1379), antes del loop. Una validación pura acepta el registro solo si `until` coincide con el recálculo desde `set_at`, `now < until` y `until - now <= span_max(cause) + 10 min`. Así se descartan registros vencidos, corruptos y saltos de reloj.
5. `start_backoff.halted_for_day` NO se persiste: reiniciar es un gesto legítimo de "reintenta".
6. Un hook pequeño y recomendado en `graceful_shutdown_before_exit` registra un paro del usuario que el tick de 30 s todavía no había visto.

Efecto lateral buscado: hoy un logout con jornada activa deja la jornada suprimida hasta medianoche aunque se vuelva a iniciar sesión en el mismo proceso. Con este cambio arranca en el siguiente tick tras volver a iniciar sesión. Es un solo commit.

## Current behavior
- La supresión de re-arranque vive solo en memoria y el estado nace vacío en cada proceso. — service.rs:250-252 `/// Instante hasta el cual NO se debe (re)arrancar ... rearm_at: Arc<RwLock<Option<NaiveDateTime>>>`; service.rs:271 `rearm_at: Arc::new(RwLock::new(None))`; `initialize` (service.rs:303-308) solo carga settings.
- Existen exactamente 7 escritores de rearm_at: 2 que limpian al vencer, 2 que ponen la siguiente hora y 3 que ponen el día siguiente. — Grep `rearm_at` en src-tauri/src: service.rs:604 (vence en `(false, Some)`), :674 (vence en `(false, None)`), :689 `Some(schedule::next_hour_boundary(now))` (el usuario detuvo NUESTRA grabación dentro de ventana), :810/:841/:899 `Some(start_of_next_day(now))` (close_scheduled: carrera Ok(false), lote, normal), :939 `Some(schedule::next_hour_boundary(now))` (rotate_scheduled Ok(false): el usuario ganó el StopGate). No hay escritores fuera de service.rs.
- CRÍTICO: la ruta de salida pone hoy una supresión hasta medianoche, porque close_owned_segment_for_exit reutiliza close_scheduled. — service.rs:393-407 `close_owned_segment_for_exit` ... `close_scheduled(app, &self.shared, &settings, since, now).await;`; close_scheduled comentario L895 `// 5. Reposo + supresión del re-arranque por el resto del día.` L899 `*shared.rearm_at.write().await = Some(start_of_next_day(now));`. En memoria no importa al salir porque el proceso muere; si se persiste tal cual, un reinicio o apagado a mitad del día suprimiría la jornada hasta mañana.
- graceful_shutdown_before_exit es el embudo común de tray quit, RunEvent::Exit, logout_cleanup y rival_install. — lib.rs:1833-1844 `if !is_recording().await { return; } ... service.close_owned_segment_for_exit(app)`; llamadores: tray.rs:69, lib.rs:161 (logout_cleanup), lib.rs:1795 (RunEvent::Exit), rival_install.rs:78.
- Bug latente en memoria: logout con jornada activa y nuevo login en el mismo proceso deja la jornada suprimida hasta medianoche. — AuthContext.tsx:905 `await invoke('logout_cleanup')` → close_scheduled pone rearm = start_of_next_day. Tras el login, el tick `(false, Some)` pasa el gate de sesión (service.rs:585) y el de registro (:593) y luego choca con `if now < until { return (Armed, Some(RearmingNextHour)) }` (:599-603). El comentario de :581-584 promete lo contrario ("al loguearse, el siguiente tick la inicia").
- La supresión de la ruta de salida SÍ cumple hoy una función en memoria: impide que el loop, que sigue corriendo, rearranque durante la salida o antes de clear_current_user. — El loop es una task tokio independiente (service.rs:321 `tokio::spawn(run_scheduler_loop...)`). RunEvent::Exit hace `block_on` hasta 30 s (lib.rs:1789-1801). En el logout, `clear_current_user` corre después de logout_cleanup + cloud_sync_clear_session vía el efecto AuthContext.tsx:108-124. Si la supresión se quita sin más, un tick en esa ventana arrancaría una grabación. (Que otras tasks avancen durante `block_on` depende de que el runtime de tauri sea multi-hilo: UNVERIFIED en el código de tauri, pero coincide con el diseño actual.)
- El paro del usuario solo se detecta por sondeo del tick (≤30 s). Un paro seguido de salida antes del siguiente tick no deja rearm. — service.rs:686-692: el brazo `(true, Some(_))` con `!is_rec` es el único que detecta el paro externo. No hay señal desde stop_recording: `stop_recording_reporting` (recording_lifecycle.rs:460-481) no lleva causa ni avisa al scheduler. graceful_shutdown_before_exit sale en `if !is_recording().await { return; }` (lib.rs:1834) sin mirar ownership.
- start_backoff también vive solo en memoria. halted_for_day de MicAccessDenied dura hasta medianoche y se reinicia con cada proceso. — service.rs:260 `start_backoff: Arc<RwLock<Option<StartBackoff>>>`; next_backoff L208-214 `(start_of_next_day(now), true)` al 5.º fallo; CheckNow y UpdateSettings lo limpian (L480, L486).
- catch_up_on_start es un campo muerto: el servicio nunca lo lee. — Grep `catch_up_on_start` en src-tauri/src: solo settings.rs:28 (declaración), :121 (default true) y tests. En TS solo el tipo en services/scheduledRecordingService.ts:24; ScheduledRecordingSettings.tsx no lo edita.
- El settings JSON no es lugar para estado de runtime: update_settings serializa el struct completo y la UI lo llama dos veces por acción. — settings.rs:202-210 `save_settings` → `serde_json::to_string_pretty(settings)` + `tokio::fs::write`; service.rs:345-358 `update_settings` es el único escritor.
- Existen helpers reutilizables: next_hour_boundary, start_of_next_day, el patrón de escritura atómica y la resolución de app_data_dir. — schedule.rs:77-84 `pub fn next_hour_boundary`; service.rs:714-718 `fn start_of_next_day` (privada); recording_saver.rs:625-631 `let temp_path = folder.join(format!(".{}.tmp", filename)); std::fs::write(&temp_path...); std::fs::rename(&temp_path, &transcript_path)`; panics.rs:31 `app.path().app_data_dir()`; settings.rs:135-143 (patrón get_*_path + create_dir_all). tauri-plugin-store 2.4.2 NO es atómico (store.rs:296 `fs::write(&self.path, bytes)`), así que no se usa.
- El servicio se inicializa una sola vez en el setup, bajo el write lock, antes de arrancar el loop, y solo arranca si enabled. — lib.rs:1373-1395: `let mut service = scheduler_state.write().await; service.initialize(...)`, luego `if settings.enabled { service.start(...) }`. `initialize_scheduled_recording` (commands.rs:18) no tiene llamadores (código muerto).
- El frontend muestra como toast cualquier `message` de scheduled-recording-skipped. Una supresión restaurada al arrancar producirá un toast con el mensaje de la causa. — ScheduledRecordingIndicator.tsx:33-36 `const message = event.payload?.message; if (message) toast.info(message)`; service.rs:456-461 emite cuando `prev_skip != skip` (prev_skip inicia en None).

## Design
## 0. Decisiones (qué se persiste y qué no)

| Estado | ¿Persistir? | Por qué |
|---|---|---|
| `UserStop`: el usuario detuvo la grabación de jornada dentro de ventana (service.rs:689) o ganó la carrera en la rotación (:939). `until` = `next_hour_boundary(set_at)` | **SÍ** | Es una intención explícita del usuario. Rearrancar tras reiniciar es un problema de privacidad (quizá paró por una conversación privada). |
| `AutoClose`: cierre por hora fija (close_scheduled invocado desde el tick, service.rs:547; incluye las ramas Ok(false) :810, lote :841 y normal :899). `until` = `start_of_next_day(set_at)` | **SÍ** | El día ya se cerró. Rearrancar tras reiniciar abre un segmento de overtime nuevo. |
| `SessionEnd`: salida de la app, logout, instalación rival y apagado de Windows (close_scheduled invocado desde `close_owned_segment_for_exit`) | **NUNCA**. Solo retención en memoria | Salir, reiniciar, apagar o cerrar sesión NO es "no quiero grabar hoy". Tras reiniciar, la jornada debe reanudarse. |
| `start_backoff` (incluye `halted_for_day`) | **NO** | Reiniciar es un reintento legítimo (el usuario concedió el permiso de micrófono y reinicia). El costo de reintentar es acotado: 2 ticks para NoInputDevice, ~23 min / 5 intentos para MicAccessDenied, más un posible segundo toast. El costo de un alto viejo es una jornada perdida. |
| `owned` / `owned_since` / `grace_deadline` | NO | Una grabación no sobrevive al proceso. La recupera `autoRecoverAll`. |

`catch_up_on_start` sigue siendo un campo muerto. La supresión persistida manda sobre el "catch-up" (que es el comportamiento por defecto). Documentarlo en el doc-comment de `settings.rs:27`, sin cablearlo.

## 1. Tipos nuevos: `scheduled_recording/runtime_state.rs` (nuevo, `pub mod runtime_state;` en mod.rs)

```rust
use chrono::{Duration, NaiveDateTime};
use serde::{Deserialize, Serialize};

/// Por qué la jornada no debe (re)arrancar antes de `until`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RearmCause {
    /// El usuario detuvo NUESTRA grabación (dentro de ventana o en la frontera de rotación).
    UserStop,
    /// Cierre por hora fija: el día ya se cerró.
    AutoClose,
    /// Salida / logout / apagado. SOLO memoria: jamás se persiste.
    SessionEnd,
}
impl RearmCause {
    pub(crate) fn as_str(self) -> &'static str { /* "user_stop" | "auto_close" | "session_end" */ }
    fn persisted(self) -> Option<PersistedCause> { match self { UserStop => Some(PersistedCause::UserStop), AutoClose => Some(PersistedCause::AutoClose), SessionEnd => None } }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Rearm { pub until: NaiveDateTime, pub cause: RearmCause, pub set_at: NaiveDateTime }

/// Tope de la retención en memoria de SessionEnd (backstop si la sesión nunca se limpia).
pub(crate) const SESSION_END_HOLD_MINUTES: i64 = 15;
/// Tolerancia a correcciones de reloj (NTP al arrancar, RTC desfasado).
const CLOCK_SKEW_TOLERANCE_MINUTES: i64 = 10;
pub(crate) const RUNTIME_STATE_VERSION: u32 = 1;
const FILE_NAME: &str = "scheduled_recording_runtime.json";

impl Rearm {
    pub(crate) fn user_stop(now: NaiveDateTime) -> Self { Self { until: super::schedule::next_hour_boundary(now), cause: RearmCause::UserStop, set_at: now } }
    pub(crate) fn auto_close(now: NaiveDateTime) -> Self { Self { until: super::schedule::start_of_next_day(now), cause: RearmCause::AutoClose, set_at: now } }
    pub(crate) fn session_end(now: NaiveDateTime) -> Self { Self { until: now + Duration::minutes(SESSION_END_HOLD_MINUTES), cause: RearmCause::SessionEnd, set_at: now } }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum PersistedCause { UserStop, AutoClose }   // sin SessionEnd a propósito: no es representable en disco

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
struct PersistedRearm { cause: PersistedCause, until: NaiveDateTime, set_at: NaiveDateTime }

#[derive(Debug, Serialize, Deserialize)]
struct RuntimeStateFile { version: u32, #[serde(default)] rearm: Option<PersistedRearm> }
```
- Formato en disco (NaiveDateTime local; chrono con feature `serde`, Cargo.toml:92, lo serializa ISO sin offset y el roundtrip es exacto al nanosegundo):
  `{"version":1,"rearm":{"cause":"user_stop","until":"2026-09-23T11:00:00","set_at":"2026-09-23T10:17:42.123456789"}}`
- Sin `deny_unknown_fields`: los campos futuros son aditivos (version skew Store↔NSIS, docs/CANALES_DISTRIBUCION.md).

### Funciones puras (testeables sin AppHandle)
```rust
/// None = no hay nada que persistir (None o SessionEnd) → el archivo se BORRA.
pub(crate) fn serialize_state(rearm: Option<&Rearm>) -> Option<String>;

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum RestoreOutcome { Restored(Rearm), Empty, Expired, Rejected(&'static str) }

/// Parse + validación. `content` = contenido del archivo.
pub(crate) fn restore(content: &str, now: NaiveDateTime) -> RestoreOutcome {
    // 1. serde falla → Rejected("corrupt")   (incluye cause desconocida como "session_end")
    // 2. version > RUNTIME_STATE_VERSION → Rejected("future_version")
    // 3. rearm None → Empty
    // 4. expected = match cause { UserStop => next_hour_boundary(set_at), AutoClose => start_of_next_day(set_at) };
    //    if until != expected → Rejected("inconsistent")
    // 5. if now >= until → Expired
    // 6. max_span = UserStop: 1h, AutoClose: 24h;
    //    if until - now > max_span + CLOCK_SKEW_TOLERANCE → Rejected("clock_moved_back")
    // 7. Restored(Rearm { until, cause: mapped, set_at })
}
```
Notas sobre la validación:
- Regla 6 = invariante: "una supresión restaurada nunca dura más de lo que pudo durar cuando se creó". Cubre un RTC reseteado al pasado (until años "en el futuro") y permite el NTP de arranque (segundos o minutos hacia atrás).
- DST (NaiveDateTime local, igual que todo el scheduler, service.rs:444): en el salto de primavera `until` puede ser una hora inexistente, pero se compara como naive → vence al cruzarla. En el retroceso de otoño `until - now` ≤ 1 h + tolerancia → se conserva. México casi no usa DST desde 2022, pero el test lo fija.
- Salto de reloj hacia adelante → Expired → se borra. Si luego el reloj se corrige, la supresión ya se perdió y la jornada se reanuda (fail-open aceptado; documentarlo).
- Cambio de zona horaria: la semántica sigue siendo wall-clock local ("hasta las 11:00 locales"). Aceptado.

### I/O (async, tokio::fs)
```rust
fn state_path<R: Runtime>(app: &AppHandle<R>) -> anyhow::Result<PathBuf>  // app_data_dir()/FILE_NAME + create_dir_all (patrón settings.rs:135-143 / panics.rs:31)
pub(crate) async fn read_raw<R>(app) -> Option<String>                     // NotFound → None
pub(crate) async fn write_to_path(path: &Path, content: Option<String>) -> std::io::Result<()>
   // Some → tmp `.scheduled_recording_runtime.json.tmp` + tokio::fs::rename (patrón recording_saver.rs:625-631; en Windows rename reemplaza al existente)
   // None → tokio::fs::remove_file, ignorando NotFound
pub(crate) async fn remove<R>(app)
```
`write_to_path` recibe `&Path` para poder testearla con `tempfile::tempdir()` (dev-dep, Cargo.toml:321; precedente en audio_retention.rs:389).

Directorio: `app_data_dir` y no `app_config_dir`: config = intención del usuario que la UI reescribe entera; runtime = estado de máquina. En Windows ambos resuelven a Roaming\com.maity.ai (bajo MSIX, redirigido). UNVERIFIED: el efecto de roaming profiles corporativos (una supresión podría "viajar" de PC); con los topes de 1 h / 24 h el daño está acotado.

## 2. Mover `start_of_next_day` a `schedule.rs`
Mover `fn start_of_next_day` (service.rs:713-718) tal cual a schedule.rs como `pub fn start_of_next_day` (es lógica pura de horarios, cabecera de schedule.rs:1-5). En service.rs: `use super::schedule::start_of_next_day;`. `next_backoff` (:210) y `backoff_tests` (:1869, vía `use super::*`, que incluye imports privados del padre) siguen compilando sin cambios.

## 3. `SchedulerShared` (service.rs:240-276)
- Reemplazar `rearm_at: Arc<RwLock<Option<NaiveDateTime>>>` por `rearm: Arc<RwLock<Option<Rearm>>>` (actualizar el doc-comment de :250-251 y el de :257-259, que menciona `rearm_at`).
- Añadir `persist_lock: Arc<tokio::sync::Mutex<()>>`. Serializa la escritura del archivo entre la task del loop y la de salida/logout. Es un Mutex propio, no uno de los RwLock del contrato de locks, así que puede cruzar el await de I/O. Dentro no se toma ningún otro guard de forma sostenida: solo un snapshot en statement propio.
- Si T1 ya añadió un campo de causa junto a `rearm_at`, fundirlo en este `Rearm`.

## 4. Helper único de escritura (service.rs, junto a `start_of_next_day`)
```rust
/// ÚNICO escritor de `shared.rearm`. Actualiza memoria y refleja en disco SOLO si cambió.
/// SessionEnd/None ⇒ el archivo se borra (jamás se persiste una supresión de salida).
async fn set_rearm<R: Runtime>(app: &AppHandle<R>, shared: &SchedulerShared, value: Option<Rearm>) {
    let prev = std::mem::replace(&mut *shared.rearm.write().await, value); // guard muere al fin del statement
    if prev == value { return; }
    let _io = shared.persist_lock.lock().await;
    let snap = *shared.rearm.read().await;          // último valor en memoria gana (dos escritores concurrentes)
    let path = match runtime_state::state_path(app) { Ok(p) => p, Err(e) => { warn!(...); return; } };
    if let Err(e) = runtime_state::write_to_path(&path, runtime_state::serialize_state(snap.as_ref())).await {
        warn!("[scheduled] no se pudo persistir la supresión ({:?}): {}", snap.map(|r| r.cause.as_str()), e);
    }
}
```
Si el I/O falla: solo `warn!`. La memoria sigue mandando en este proceso, igual que hoy.

## 5. Reemplazo de los 7 escritores
- **:597-606 (`(false, Some)`)**:
  ```rust
  let rearm = *shared.rearm.read().await;
  if let Some(r) = rearm {
      if now < r.until {
          return (SchedulerPhase::Armed, r.cause.skip_reason());
      }
      set_rearm(app, shared, None).await;
  }
  ```
  Añadir `fn skip_reason(self) -> Option<SkipReason>` en `RearmCause` (vive en service.rs porque SkipReason es privado):
  - UserStop → `Some(RearmingNextHour)`.
  - AutoClose → `Some(RearmingNextHour)` hoy, o la variante de B3 (p. ej. `ClosedForToday`) si B3 ya está en el árbol.
  - SessionEnd → `None`: retención silenciosa de ≤1 tick; evita un toast falso de "se reanudará a la siguiente hora" durante el logout.
- **:669-677 (`(false, None)`)**: `if let Some(r) = rearm { if now >= r.until { set_rearm(app, shared, None).await; } }`.
- **:686-692 y :700-705**: extraer
  ```rust
  /// NUESTRA grabación terminó sin que la cerráramos (paro del usuario / UI / tray / widget).
  async fn release_after_external_stop<R: Runtime>(app, shared, in_window: bool, now) {
      shared.owned.store(false, Ordering::SeqCst);
      *shared.owned_since.write().await = None;
      if in_window { set_rearm(app, shared, Some(Rearm::user_stop(now))).await; }
  }
  ```
  - `(true, Some)` + `!is_rec` → `release_after_external_stop(app, shared, true, now).await; (Armed, Some(RearmingNextHour))`.
  - `(true, None)` + `!is_rec` → `release_after_external_stop(app, shared, false, now).await; (Idle, None)`.
  - La semántica no cambia.
- **close_scheduled (:782)**: nueva firma `close_scheduled(app, shared, settings, owned_since, now, cause: CloseCause)` con
  ```rust
  #[derive(Debug, Clone, Copy, PartialEq, Eq)]
  enum CloseCause { AutoClose, SessionEnd }
  fn rearm_for_close(cause: CloseCause, now: NaiveDateTime) -> Rearm { match cause { CloseCause::AutoClose => Rearm::auto_close(now), CloseCause::SessionEnd => Rearm::session_end(now) } }  // pura, testeable
  ```
  - En :810, :841 y :899: `set_rearm(app, shared, Some(rearm_for_close(cause, now))).await;`.
  - Llamadores: :547 → `CloseCause::AutoClose`; :405 (`close_owned_segment_for_exit`) → `CloseCause::SessionEnd`.
  - Actualizar el doc-comment de :780-781 ("supresión del re-arranque por el resto del día" solo aplica a AutoClose) y el de :390-392: "NUNCA persiste supresión: tras reiniciar/apagar la jornada se reanuda".
- **rotate_scheduled :939**: `set_rearm(app, shared, Some(Rearm::user_stop(now))).await;` (es un paro del usuario en la frontera de hora).

## 6. Liberar la retención SessionEnd (evaluate_tick, justo después del early-return `!settings.enabled`, service.rs:510)
```rust
let rearm_snapshot = *shared.rearm.read().await;
if matches!(rearm_snapshot, Some(r) if r.cause == RearmCause::SessionEnd)
    && !crate::state::has_session(app).await
{
    // El logout ya limpió current_user_id: la retención cumplió su función.
    // Al volver a iniciar sesión, el siguiente tick arranca la jornada (promesa de :581-584).
    set_rearm(app, shared, None).await;
}
```
- En la salida de la app la sesión NO se limpia → la retención dura lo que dura la salida (tope de 15 min, muy por encima de los ≤30 s de `graceful` + cleanup).
- Un reingreso en <30 s (antes de que un tick vea "sin sesión") reanuda como máximo a los 15 min.
- `has_session` es una lectura de RwLock barata y solo se consulta mientras exista la retención.

## 7. Carga al arrancar (service.rs:303 `initialize`)
Después de cargar settings:
```rust
let now = Local::now().naive_local();
match runtime_state::read_raw(app_handle).await.map(|c| runtime_state::restore(&c, now)) {
    Some(RestoreOutcome::Restored(r)) => {
        info!("[scheduled] supresión restaurada: {} hasta {}", r.cause.as_str(), r.until);
        *self.shared.rearm.write().await = Some(r);   // sin set_rearm: el disco ya coincide
    }
    Some(RestoreOutcome::Expired) | Some(RestoreOutcome::Empty) => { runtime_state::remove(app_handle).await; }
    Some(RestoreOutcome::Rejected(why)) => { warn!("[scheduled] estado de supresión descartado ({})", why); runtime_state::remove(app_handle).await; }
    None => {}
}
```
- Corre una sola vez, bajo el write lock del setup (lib.rs:1376), ANTES de `start()`. Sin carrera con el loop.
- Se restaura aunque `enabled=false`: es inocuo y coincide con el comportamiento en memoria si el usuario activa la jornada a mitad de hora.
- Interacción con los gates: la supresión se consulta DESPUÉS de `NoSession`/`RegistrationIncomplete` (:585-595), así que sobrevive a los primeros ticks sin sesión mientras el webview llama a `set_current_user`.
- El primer tick con sesión emite `scheduled-recording-skipped` con el mensaje de la causa → toast informativo al abrir la app. Es deseado.

## 8. (Recomendado, pequeño) paro del usuario no observado antes de salir: service.rs + lib.rs:1833-1836
Nuevo método público:
```rust
/// Si el usuario detuvo NUESTRA grabación y la app sale antes del siguiente tick (≤30 s),
/// registra el paro igual que lo haría el tick. No-op si no somos dueños o si sigue grabando.
pub async fn observe_stop_before_exit<R: Runtime>(&self, app: &AppHandle<R>) {
    if !self.shared.owned.load(Ordering::SeqCst) || crate::audio::recording_commands::is_recording_active_fn() { return; }
    let settings = self.shared.settings.read().await.clone();
    if !settings.enabled { return; }
    let now = Local::now().naive_local();
    let in_window = schedule::active_window_at(now, &settings).is_some();
    release_after_external_stop(app, &self.shared, in_window, now).await;
}
```
En `graceful_shutdown_before_exit`, ANTES del `if !is_recording().await { return; }`:
```rust
if let Some(state) = app.try_state::<scheduled_recording::commands::ScheduledRecordingState>() {
    state.read().await.observe_stop_before_exit(app).await;
}
```
- Es idempotente con el tick: los dos producen el mismo `Rearm::user_stop` dentro de la misma hora.
- Cubre también el logout, que pasa por `logout_cleanup`.
- Si hay conflicto de merge con T2/B5 (tocan la misma función), mantener esta llamada como primera sentencia.

## 9. Accesor para T1 (opcional)
`pub async fn rearm_snapshot(&self) -> Option<(&'static str, NaiveDateTime)>` → `(cause.as_str(), until)`, para `idle_reason` en el heartbeat/device.profile. Sin eventos de telemetría nuevos en B4, así que no toca `lint-telemetry.js` ni `events.rs`.

## 10. Docs (mismo commit)
Nueva sección en `docs/ONBOARDING_Y_GATES.md`, después de "Back-off del arranque de jornada" (termina en :27): **"Supresión de la jornada persistida (#83/B4, sep-2026)"**.
- La tabla del §0.
- Archivo, formato y validación (incluidos topes y tolerancia).
- **Regla "no revertir"**: `close_owned_segment_for_exit` usa `CloseCause::SessionEnd`, que NUNCA toca disco. Salida, logout, apagado e instalación rival no suprimen tras reiniciar.
- `start_backoff` no se persiste, y por qué.
- `catch_up_on_start` sigue muerto.
- Corregir el bullet de :23 (`rearm_at` → `rearm`).

## Files to change
- `frontend/src-tauri/src/scheduled_recording/runtime_state.rs` — NUEVO: `RearmCause`, `Rearm` (constructores user_stop/auto_close/session_end), `PersistedCause`/`PersistedRearm`/`RuntimeStateFile` (serde, version 1), `serialize_state` y `restore` puros, I/O async `state_path`/`read_raw`/`write_to_path` (tmp + rename)/`remove` en app_data_dir/scheduled_recording_runtime.json, más `#[cfg(test)] mod tests`.
- `frontend/src-tauri/src/scheduled_recording/mod.rs` — Añadir `pub mod runtime_state;`.
- `frontend/src-tauri/src/scheduled_recording/schedule.rs` — Recibir `pub fn start_of_next_day` movida desde service.rs:713-718 (sin cambios de lógica) más un test del cruce de medianoche.
- `frontend/src-tauri/src/scheduled_recording/service.rs` — SchedulerShared: `rearm_at` → `rearm: Option<Rearm>` + `persist_lock`. Helpers `set_rearm` (único escritor), `release_after_external_stop`, `RearmCause::skip_reason`, `CloseCause` + `rearm_for_close`. `close_scheduled` recibe `cause` (547 → AutoClose, 405 → SessionEnd). Reemplazo de los 7 escritores (604, 674, 689, 810, 841, 899, 939). Liberar SessionEnd sin sesión al inicio de evaluate_tick. Carga en `initialize`. Nuevo `observe_stop_before_exit` y `rearm_snapshot` opcional. Actualizar doc-comments de 250-259, 390-392 y 780-781. Tests de `rearm_for_close`.
- `frontend/src-tauri/src/lib.rs` — graceful_shutdown_before_exit (1833): llamar `observe_stop_before_exit` antes del early-return `!is_recording()` (3-4 líneas). Opcional pero recomendado; si se omite, el resto del diseño se sostiene.
- `frontend/src-tauri/src/scheduled_recording/settings.rs` — Solo doc-comment de `catch_up_on_start` (L27): documentar que está muerto y que la supresión persistida manda. Sin cambio de struct ni de serialización.
- `docs/ONBOARDING_Y_GATES.md` — Nueva sección 'Supresión de la jornada persistida' (qué se persiste, formato, validación, regla no-revertir de SessionEnd, backoff no persistido) y corrección del bullet :23 (`rearm_at` → `rearm`).

## Commits
- **fix(jornada): el paro del usuario y el cierre del día sobreviven al reinicio sin que salir o apagar suprima la jornada** (deps: B3 (mensaje correcto tras el cierre del día) si ya introdujo una SkipReason propia para el cierre: mapear AutoClose a ella en RearmCause::skip_reason. Si T1 añadió un campo de causa junto a rearm_at, fundirlo en Rearm. Sin esos commits, B4 es autocontenido.)
  Persiste la supresión de re-arranque del scheduler en app_data_dir/scheduled_recording_runtime.json (escritura atómica tmp+rename, serializada con Mutex propio). Solo dos causas tocan disco: UserStop (hasta la siguiente hora en punto) y AutoClose (hasta medianoche). close_scheduled recibe un CloseCause explícito: la ruta de salida/logout/instalación rival/apagado (close_owned_segment_for_exit) usa SessionEnd, una retención SOLO en memoria (tope 15 min) que se libera en cuanto el loop ve que no hay sesión. Antes ponía rearm = start_of_next_day, que al persistirse habría apagado la jornada hasta mañana tras cualquier reinicio, y que en memoria dejaba suprimida la jornada tras un logout+login en el mismo proceso. La carga ocurre en initialize(), antes del loop, con validación pura (until coherente con set_at, no vencido, dentro de span_max + 10 min de tolerancia de reloj); registros vencidos, corruptos o de reloj retrocedido se descartan y borran. start_backoff no se persiste (reiniciar es un reintento legítimo). graceful_shutdown_before_exit registra un paro del usuario que el tick de 30 s aún no vio. start_of_next_day se mueve a schedule.rs. Docs: sección nueva en docs/ONBOARDING_Y_GATES.md. Tests: runtime_state::tests + rearm_for_close. Build: pnpm run tauri:build:debug exit 0. Refs #83 (B4).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

## Tests
- frontend/src-tauri/src/scheduled_recording/runtime_state.rs #[cfg(test)] mod tests: roundtrip: serialize_state(Some(&Rearm::user_stop(10:17:42.5))) → restore(…, 10:40) == Restored con until 11:00 y set_at exacto (sin pérdida de nanos). Lo mismo para auto_close(18:05) → until día+1 00:00.
- runtime_state.rs tests: salida_o_logout_nunca_persiste: serialize_state(Some(&Rearm::session_end(now))) == None y serialize_state(None) == None (el archivo se borra). Un JSON escrito a mano con "cause":"session_end" → Rejected("corrupt").
- runtime_state.rs tests: vencimiento: user_stop de 10:17 restaurado a las 11:00:00 → Expired; a las 12:00 → Expired. auto_close de 18:05 restaurado a las 23:59 → Restored; al día+1 00:00 → Expired; al día+1 09:00 → Expired.
- runtime_state.rs tests: inconsistente: user_stop con until = set_at + 3 h (no es next_hour_boundary) → Rejected("inconsistent"); auto_close con until = set_at + 2 días → Rejected("inconsistent").
- runtime_state.rs tests: reloj: set_at 2026-09-23 10:17 y now 2026-09-20 10:00 (RTC al pasado) → Rejected("clock_moved_back"); now = set_at − 2 min (NTP al arrancar) → Restored; retroceso DST: user_stop a las 01:50 y now 01:05 del mismo día → Restored (until − now = 55 min).
- runtime_state.rs tests: formato: "no es json" → Rejected("corrupt"); version 2 → Rejected("future_version"); {"version":1} sin rearm → Empty; un campo desconocido extra → sigue restaurando (compatibilidad aditiva).
- runtime_state.rs tests (#[tokio::test], tempfile::tempdir): write_to_path(Some) crea el archivo y no deja .tmp; un segundo write lo reemplaza; write_to_path(None) lo borra; write_to_path(None) sin archivo es Ok.
- frontend/src-tauri/src/scheduled_recording/service.rs nuevo mod rearm_tests: rearm_for_close(CloseCause::SessionEnd, now).cause == SessionEnd y serialize_state(Some(&…)) == None (regresión clave de B4); rearm_for_close(AutoClose, now).until == start_of_next_day(now); RearmCause::SessionEnd.skip_reason() == None; UserStop → Some(RearmingNextHour).
- frontend/src-tauri/src/scheduled_recording/schedule.rs tests: start_of_next_day(2026-06-29 23:30) == 2026-06-30 00:00 y start_of_next_day(00:00) == día siguiente (se fija tras moverla). backoff_tests::permiso_denegado_escala_y_luego_para sigue verde sin tocarlo.
- cargo test -p <crate app> scheduled_recording + pnpm run tauri:build:debug: Todos los tests del módulo verdes y el build integrado con exit 0 (protocolo obligatorio del repo).

## Risks
- Persistir por error una supresión desde la ruta de salida o logout apagaría la jornada de toda la flota hasta mañana tras cualquier reinicio o apagado. Es el fallo más caro posible. → SessionEnd no se puede representar en disco (PersistedCause no tiene esa variante; serialize_state devuelve None). close_scheduled exige CloseCause explícito, sin default. Hay un test de regresión para rearm_for_close(SessionEnd) y un E2E manual de apagado y salida con jornada activa.
- Si se quita la supresión en memoria de la ruta de salida, el loop podría rearrancar una grabación durante los ≤30 s del RunEvent::Exit o entre logout_cleanup y clear_current_user. → La retención SessionEnd en memoria (tope 15 min) se conserva y solo se libera cuando el tick ve que no hay sesión. Durante la salida la sesión sigue viva, así que la retención dura hasta que muere el proceso.
- Un paro que no fue del usuario (error del pipeline o pérdida del dispositivo terminan la grabación) se registra como UserStop y ahora sobrevive al reinicio. Suprime hasta 1 h donde antes el reinicio la 'arreglaba'. → Es la misma semántica de hoy en memoria (service.rs:686-692). El tope es de 1 h y un tick. stop_recording no lleva causa; distinguirla queda como open question y no bloquea B4.
- Turnos nocturnos: AutoClose usa start_of_next_day (comportamiento previo), así que un cierre a las 06:00 suprime hasta la medianoche siguiente y se come 22:00-00:00 del turno. Persistirlo lo vuelve inmune al reinicio. → El defecto ya existe hoy en memoria (service.rs:899). Queda en open_questions (acotar until al inicio de la siguiente ventana). La UI edita una sola ventana diurna 09-18 en el piloto.
- Dos escritores concurrentes (task del loop y task de salida) sobre el mismo .tmp podrían corromper el archivo. → persist_lock (tokio Mutex) serializa write y rename, y se escribe el snapshot de memoria tomado dentro del lock (gana el último). Si el archivo sale corrupto, restore lo rechaza y lo borra (fail-open: la jornada se reanuda).
- Violar el contrato de locks de SchedulerShared (guard vivo cruzando un await) congela el loop, como ya pasó en 0.2.52. → set_rearm usa std::mem::replace en un statement propio y snapshots `let x = *lock.read().await;`. Nunca `if let` sobre un guard. persist_lock es un Mutex aparte que no se toma bajo ningún guard de los RwLock.
- Conflicto de merge en graceful_shutdown_before_exit (lib.rs:1833) con T2 (motivo de app.exit) y B5 (WM_ENDSESSION). → El cambio en lib.rs son 3-4 líneas al inicio de la función y es opcional. Si choca, se puede quedar fuera de B4 sin romper el resto. Crear rama de respaldo (Protocolo Guardian: toca lib.rs y más de 3 archivos) con `git branch backup/2026-09-23-b4-supresion-persistida`, sin checkout.
- Cambio de comportamiento visible: tras un logout y login en el mismo proceso, la jornada ahora arranca en ≤30 s (antes quedaba suprimida hasta medianoche). → Es lo que promete el comentario de service.rs:581-584 y la regla de ONBOARDING_Y_GATES.md:10. Queda documentado en la sección nueva y en el commit.
- Toast al abrir la app con el mensaje de la causa restaurada; antes de B3, el cierre del día dice 'se reanudará a la siguiente hora en punto'. → Mapear AutoClose a la SkipReason de B3 si ya está en el árbol (depends_on). Si no, el mensaje es igual de incorrecto que hoy en memoria y B3 lo corrige.

## Manual verification
- Preparación: jornada activada con una ventana que cubra la hora actual, rotación ON y auto_close_time lejos. Archivo en instalación directa: %APPDATA%\com.maity.ai\scheduled_recording_runtime.json; bajo MSIX: la ruta redirigida del paquete (%LOCALAPPDATA%\Packages\<pkg>\LocalCache\Roaming\com.maity.ai\). Los logs con prefijo [scheduled] van en el log rotativo.
- Paro del usuario: esperar a que arranque la jornada y detenerla desde la UI a las hh:15. En ≤30 s el archivo debe tener cause user_stop y until hh+1:00. Salir por el tray y volver a abrir: log 'supresión restaurada: user_stop hasta …', toast informativo, sin grabar hasta hh+1:00; a hh+1:00 (≤30 s) arranca sola y el archivo desaparece.
- Paro seguido de salida rápida (paso 8): detener la jornada y salir por el tray en menos de 10 s. Al volver a abrir dentro de la misma hora no graba y el archivo tiene user_stop.
- Cierre del día: poner auto_close_time = ahora + 3 min y gracia 0. Tras el cierre (notificación 'Jornada guardada'), el archivo tiene auto_close hasta 00:00 del día siguiente. Reiniciar la app: no graba el resto del día.
- Salida con jornada activa (CRÍTICO): con la jornada grabando, salir por el tray. El segmento se guarda y NO queda archivo (o no cambia). Volver a abrir: la jornada rearranca en ≤30 s tras la sesión.
- Apagado o reinicio de Windows con la jornada grabando: tras el reinicio y el login, la jornada rearranca (ningún archivo con auto_close ni user_stop).
- Logout con la jornada grabando y nuevo login en el mismo proceso: el segmento se guarda, no queda archivo y la jornada rearranca en ≤30 s tras el login (antes quedaba suprimida hasta medianoche).
- Robustez: escribir 'basura' en el archivo → al abrir, warn 'estado de supresión descartado (corrupt)', archivo borrado y la jornada arranca. Editar until a +3 días → Rejected, borrado y arranca. Poner version 2 → descartado.
- Backoff no persistido: simular MicAccessDenied (privacidad de micrófono OFF) hasta el alto del día y reiniciar la app → vuelve a intentar (comportamiento esperado, documentado).
- Regresión: rotación por hora y cierre con reunión en gracia funcionan igual; `cargo test` del módulo scheduled_recording verde; `cd frontend && pnpm run tauri:build:debug` con exit 0.

## Open questions
- ¿Guardar ajustes de jornada o apagar y volver a activar la jornada debería levantar una supresión AutoClose o UserStop vigente? Hoy, en memoria, NO la levanta (UpdateSettings y CheckNow solo limpian start_backoff, service.rs:480/486). El diseño mantiene esa paridad.
- ¿La supresión debería ser por usuario? Un UserStop de la cuenta A aplicaría a la cuenta B tras reiniciar en un PC compartido. Se propone no hacerlo (va en dirección fail-safe: no graba); si se quiere, guardar user_id y compararlo en el tick, porque al cargar todavía no hay current_user_id.
- Turnos nocturnos: ¿acotar el until de AutoClose al inicio de la siguiente ventana en vez de a medianoche? Es un defecto previo que B4 hace inmune al reinicio.
- ¿Distinguir el paro del usuario del fin de grabación por error del pipeline? Requeriría que stop_recording_reporting lleve una causa hacia el scheduler; fuera de B4.
- ¿Añadir una línea en CLAUDE.md (sección 'Gates, sesión y onboarding') con la regla 'SessionEnd jamás persiste supresión'? Solo con aprobación explícita de Julio; B4 la documenta en docs/ONBOARDING_Y_GATES.md.
- ¿T1 quiere un evento de telemetría al restaurar o descartar (p. ej. jornada.suppression_restored)? Si sí, lo emite T1 con sus 3 entradas; B4 solo expone rearm_snapshot().

## Unverified
- Que otras tasks tokio (el loop del scheduler) avancen mientras RunEvent::Exit hace tauri::async_runtime::block_on (lib.rs:1789): se asume runtime multi-hilo, pero no lo verifiqué en el código de tauri-2.11.2. Hasta que se verifique, la retención SessionEnd en memoria se mantiene por prudencia.
- Que en Windows, bajo MSIX, app_data_dir y app_config_dir resuelvan al mismo Roaming\com.maity.ai redirigido, y el efecto de los roaming profiles corporativos sobre un archivo en Roaming.
- Que `use super::*` en backoff_tests recoja el `use super::schedule::start_of_next_day;` privado del módulo padre (debería, según las reglas de glob imports de Rust 2018); si no compila, llamar `schedule::start_of_next_day` en el test.
- Los nombres exactos que introduzcan B3 (SkipReason para el cierre del día) y T1 (campo de causa del rearm): este spec se adapta a ellos pero no pudo verlos.
- Que tokio::fs::rename reemplace atómicamente al archivo existente en Windows con antivirus: std usa MoveFileExW con MOVEFILE_REPLACE_EXISTING; un bloqueo transitorio del AV solo produciría un warn! y el estado quedaría en memoria.