//! Muestreador de memoria por proceso — línea `[METRIC] mem-sample` al log
//! rotativo cada 30 s grabando / 60 s en idle, picos por sesión para el
//! session-summary del coach, snapshots bajo demanda en eventos de alta señal
//! (kill del sidecar, recycle ONNX, backlog, stop de grabación) y **latido
//! nativo** `health.heartbeat` cuando el webview lleva rato sin dar señales
//! (tray / ventana congelada: WebView2 suspende el JS y el heartbeat del
//! frontend desaparece justo cuando una fuga importa).
//!
//! Por qué existe: la auditoría RAM jul-2026 encontró CERO señales de memoria
//! en 60 MB de logs de campo — la app nunca medía su propio RSS ni el de sus
//! procesos hijos, así que "la memoria no se libera" era indemostrable. Este
//! módulo responde: ¿qué proceso retiene (maity-desktop, llama-helper,
//! WebView2) y se libera tras el stop?

use std::sync::atomic::{AtomicU64, AtomicU8, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use log::{error, info, warn};
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
use tauri::{AppHandle, Runtime};

use super::incident::{IncidentKind, IncidentPayload};
use crate::audio::recording_phase::{current_phase, RecordingPhase};

/// Cadencia grabando (fase != Idle): la ventana donde una fuga se paga en
/// audio perdido, así que se mide fino.
const SAMPLE_INTERVAL_ACTIVE: Duration = Duration::from_secs(30);
/// Cadencia en Idle: la app pasa la mayor parte de la jornada aquí y el
/// refresh recorre la tabla de procesos del OS. 60 s sigue dando ~8 muestras
/// antes de que un incidente de RAM sea relevante.
const SAMPLE_INTERVAL_IDLE: Duration = Duration::from_secs(60);
/// Rate-limit de los warnings por condición (el sample sigue saliendo a la
/// cadencia de la fase).
const CONDITION_WARN_EVERY: Duration = Duration::from_secs(600);
/// Umbral de `app-rss-critical` (MB de RSS de maity-desktop).
pub const APP_RSS_CRITICAL_MB: u64 = 4000;
/// Umbral de `system-memory-pressure` (MB disponibles en el sistema).
pub const SYS_AVAIL_PRESSURE_MB: u64 = 1024;
/// Ventana REAL (segundos, medida con `Instant`) bajo `SYS_AVAIL_PRESSURE_MB`
/// para considerar la presión SOSTENIDA. Antes era un conteo de ticks
/// (`2 × SAMPLE_INTERVAL`), lo que ataba la promesa del doc a la cadencia: con
/// cadencia por fase, "2 ticks" valdría 60 s grabando y 120 s en idle y el
/// mensaje del incidente mentiría. Un pico de un solo tick (otra app abriendo)
/// no amerita pedirle un diagnóstico al usuario (#61).
pub const PRESSURE_SUSTAINED_SECS: u64 = 60;
/// Margen de recuperación (MB por ENCIMA de `SYS_AVAIL_PRESSURE_MB`) para
/// bajar de nivel de presión. Sin este margen el nivel oscilaría con la
/// memoria bailando alrededor del umbral (el riesgo de histéresis del #22).
pub const PRESSURE_RECOVERY_MARGIN_MB: u64 = 300;
/// Ventana REAL (segundos, `Instant`) que la recuperación debe sostenerse para
/// bajar de nivel. Igual que `PRESSURE_SUSTAINED_SECS`, nunca en ticks.
pub const PRESSURE_RECOVERY_SECS: u64 = 60;
/// Cadencia del latido nativo (`reason: "native"`) cuando el webview está mudo.
const NATIVE_HEARTBEAT_EVERY: Duration = Duration::from_secs(15 * 60);
/// Silencio del webview que se considera "muerto/suspendido". Por encima del
/// `IDLE_EMIT_EVERY_MS` del JS (15 min) para que un idle normal NUNCA produzca
/// dos latidos.
const JS_HEARTBEAT_SILENCE: Duration = Duration::from_secs(20 * 60);

// ── Picos de la sesión (los consume el session-summary del coach) ──
static MEM_APP_PEAK_MB: AtomicU64 = AtomicU64::new(0);
static MEM_LLAMA_PEAK_MB: AtomicU64 = AtomicU64::new(0);
static MEM_WEBVIEW_PEAK_MB: AtomicU64 = AtomicU64::new(0);
static SYS_AVAIL_MIN_MB: AtomicU64 = AtomicU64::new(u64::MAX);
static LLAMA_PROCS_MAX: AtomicU64 = AtomicU64::new(0);

/// Último sample del loop periódico, para que `get_health_snapshot` lo lea
/// sin pagar otro refresh de procesos (y con `cpu_pct` real, que necesita el
/// delta del `System` persistente del sampler).
static LAST_SAMPLE: Mutex<Option<(MemSample, Instant)>> = Mutex::new(None);

/// Nivel de presión de memoria publicado por el loop periódico (#22 de la
/// auditoría: "la presión se observa pero nunca se actúa"). Lo actualiza SOLO
/// el sampler periódico (los snapshots ad-hoc usan `System` fresco y no tienen
/// racha); staleness máximo ≈ la cadencia de la fase (60 s en idle) — aceptable
/// para sus consumidores (warmup del sidecar, tips LLM, idle_unload, planner
/// del lote), que toman decisiones de minutos, no de milisegundos.
static PRESSURE_LEVEL: AtomicU8 = AtomicU8::new(0);

/// Nivel de presión de memoria del sistema, con histéresis (ver
/// `ConditionWarns::update_pressure_level`). Orden total: `Normal < Elevated
/// < Critical`, así los consumidores pueden escribir `level >= Elevated`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PressureLevel {
    #[default]
    Normal = 0,
    Elevated = 1,
    Critical = 2,
}

impl PressureLevel {
    pub fn as_str(self) -> &'static str {
        match self {
            PressureLevel::Normal => "normal",
            PressureLevel::Elevated => "elevated",
            PressureLevel::Critical => "critical",
        }
    }

    fn from_u8(v: u8) -> Self {
        match v {
            2 => PressureLevel::Critical,
            1 => PressureLevel::Elevated,
            _ => PressureLevel::Normal,
        }
    }
}

/// Nivel de presión vigente. Barato (un load atómico): se puede consultar en
/// cualquier camino caliente. Antes del primer tick del sampler devuelve
/// `Normal` (fail-open a propósito: sin datos no se bloquea nada).
pub fn pressure_level() -> PressureLevel {
    PressureLevel::from_u8(PRESSURE_LEVEL.load(Ordering::Relaxed))
}

/// Memoria disponible del sistema según el ÚLTIMO sample del loop periódico
/// (`None` antes del primer tick). Para chequeos de headroom (p. ej. "¿alcanza
/// para cargar Parakeet?") — la frescura es la del sampler, no la del instante.
pub fn last_sys_avail_mb() -> Option<u64> {
    last_sample().map(|(s, _)| s.sys_avail_mb)
}

/// CPU del SISTEMA (0-100) según el ÚLTIMO sample del loop periódico (`None`
/// antes del primer tick; el primer tick sale 0 por falta de delta — el gate
/// del planner de lote lo trata como "libre", fail-open coherente con
/// `pressure_level`).
pub fn last_cpu_pct() -> Option<f32> {
    last_sample().map(|(s, _)| s.cpu_pct)
}

/// Última vez que el webview pidió `get_health_snapshot`. Es la prueba de vida
/// más barata que hay: `healthHeartbeatService.ts` es el ÚNICO invoker de ese
/// comando en todo el frontend (verificado por grep; a propósito SIN número de
/// línea: es lo único de la referencia que no envejece), así que su silencio
/// significa literalmente "el heartbeat del JS no está corriendo".
static LAST_JS_SNAPSHOT_AT: Mutex<Option<Instant>> = Mutex::new(None);

/// Una muestra de memoria/CPU del ecosistema de procesos de Maity.
#[derive(Debug, Clone, serde::Serialize)]
pub struct MemSample {
    pub app_rss_mb: u64,
    pub llama_rss_mb: u64,
    pub llama_procs: u64,
    pub webview_rss_mb: u64,
    pub webview_procs: u64,
    pub ffmpeg_procs: u64,
    pub sys_avail_mb: u64,
    pub sys_total_mb: u64,
    /// CPU del SISTEMA completo (0-100), de `global_cpu_usage()` (query PDH).
    /// NO se renombra ni se reinterpreta: hay series históricas en
    /// `maity.platform_logs` y las queries de `docs/TELEMETRIA.md` asumen esta
    /// semántica.
    pub cpu_pct: f32,
    /// CPU del proceso maity-desktop, normalizado **×nb_cpus**: 100 % = UN core
    /// completo, no la máquina entera (sysinfo, `windows/process.rs:996-998`).
    /// 0.0 en los snapshots ad-hoc (`System` fresco, sin baseline previa) y en
    /// la primerísima muestra del sampler (el delta arranca en ceros, así que
    /// ese primer valor es un promedio desde el arranque, no un instantáneo:
    /// ignorarlo en el análisis).
    pub proc_cpu_pct: f32,
}

/// Picos observados desde el último `reset_session_peaks()`.
#[derive(Debug, Clone, serde::Serialize)]
pub struct SessionPeaks {
    pub app_rss_peak_mb: u64,
    pub llama_rss_peak_mb: u64,
    pub webview_rss_peak_mb: u64,
    pub sys_avail_min_mb: u64,
    pub llama_procs_max: u64,
}

pub fn reset_session_peaks() {
    MEM_APP_PEAK_MB.store(0, Ordering::Relaxed);
    MEM_LLAMA_PEAK_MB.store(0, Ordering::Relaxed);
    MEM_WEBVIEW_PEAK_MB.store(0, Ordering::Relaxed);
    SYS_AVAIL_MIN_MB.store(u64::MAX, Ordering::Relaxed);
    LLAMA_PROCS_MAX.store(0, Ordering::Relaxed);
}

pub fn session_peaks() -> SessionPeaks {
    let avail_min = SYS_AVAIL_MIN_MB.load(Ordering::Relaxed);
    SessionPeaks {
        app_rss_peak_mb: MEM_APP_PEAK_MB.load(Ordering::Relaxed),
        llama_rss_peak_mb: MEM_LLAMA_PEAK_MB.load(Ordering::Relaxed),
        webview_rss_peak_mb: MEM_WEBVIEW_PEAK_MB.load(Ordering::Relaxed),
        sys_avail_min_mb: if avail_min == u64::MAX { 0 } else { avail_min },
        llama_procs_max: LLAMA_PROCS_MAX.load(Ordering::Relaxed),
    }
}

/// Último sample del sampler periódico + edad en segundos. `None` solo antes
/// del primer tick (el interval del sampler dispara inmediato al arrancar).
pub fn last_sample() -> Option<(MemSample, u64)> {
    LAST_SAMPLE
        .lock()
        .ok()?
        .as_ref()
        .map(|(s, t)| (s.clone(), t.elapsed().as_secs()))
}

/// Marca "el webview está vivo". La llama `get_health_snapshot`
/// (`logging/commands.rs`), único consumidor IPC del sampler, para que el
/// latido nativo no duplique al del frontend.
pub fn record_js_snapshot() {
    match LAST_JS_SNAPSHOT_AT.lock() {
        Ok(mut slot) => *slot = Some(Instant::now()),
        Err(e) => warn!("[MEM] LAST_JS_SNAPSHOT_AT envenenado: {}", e),
    }
}

fn last_js_snapshot_at() -> Option<Instant> {
    LAST_JS_SNAPSHOT_AT.lock().ok().and_then(|slot| *slot)
}

/// Sample fresco bajo demanda, fallback pre-primer-tick. `System` nuevo →
/// `cpu_pct` y `proc_cpu_pct` salen 0 (sin delta previo); el llamador lo
/// distingue porque la edad del sample viene como `None`. Correr en
/// `spawn_blocking`.
pub fn collect_fresh() -> Option<MemSample> {
    collect(&mut System::new(), false)
}

/// Arranca el sampler periódico. Llamar UNA vez desde el setup de la app.
/// Recibe el `AppHandle` para armar el incidente con consentimiento (#61)
/// cuando un umbral crítico se sostiene y para emitir el latido nativo; el
/// emit sale de ESTA task (no de un layer de tracing), así que no hay riesgo
/// de reentrada del subscriber.
pub fn start<R: Runtime>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        // El System persiste entre ticks: global_cpu_usage() y el cpu_usage()
        // del proceso propio necesitan el delta respecto al refresh anterior.
        let mut sys = System::new();
        let mut warn_state = ConditionWarns::default();
        let started_at = Instant::now();
        let mut native_seq: u64 = 0;
        // Sembrado con el arranque a propósito: si arrancara en None, el PRIMER
        // tick (inmediato) emitiría un latido nativo antes de que el webview
        // alcance a montar su heartbeat 'initial' y duplicaríamos el beat.
        let mut last_native_at: Option<Instant> = Some(started_at);
        info!(
            "[MEM] sampler iniciado ({}s grabando / {}s idle, warnings cada {}s por condición, \
             latido nativo cada {}s si el webview lleva {}s mudo)",
            SAMPLE_INTERVAL_ACTIVE.as_secs(),
            SAMPLE_INTERVAL_IDLE.as_secs(),
            CONDITION_WARN_EVERY.as_secs(),
            NATIVE_HEARTBEAT_EVERY.as_secs(),
            JS_HEARTBEAT_SILENCE.as_secs()
        );
        loop {
            // Primer tick INMEDIATO (como el `interval` de antes): se muestrea
            // y luego se duerme. tokio 1.49 no tiene `Interval::set_period`, así
            // que la cadencia variable se hace con `sleep` al final del ciclo;
            // efecto lateral deseado: no hay catch-up de ticks perdidos (era el
            // `MissedTickBehavior::Skip` de antes).
            let joined = tokio::task::spawn_blocking(move || {
                let sample = collect(&mut sys, true);
                (sys, sample)
            })
            .await;
            let (sys_back, sample) = match joined {
                Ok(v) => v,
                Err(e) => {
                    warn!("[MEM] sampler join error: {} — sampler detenido", e);
                    return;
                }
            };
            sys = sys_back;

            let now = Instant::now();
            let phase = current_phase();

            if let Some(s) = sample {
                log_sample("periodic", &s);
                let incident = warn_state.check(&s, now);
                // Nivel de presión (#22): DESPUÉS de check() (que mantiene la
                // racha `pressure_since`). Log de transición con clave SIN
                // números — las cifras cambiantes en el mensaje se comían una
                // plaza de `app.error` por aviso (el hallazgo original).
                let (prev_level, new_level) = warn_state.update_pressure_level(&s, now);
                if prev_level != new_level {
                    info!(
                        "[MEM] pressure-level: {}->{}",
                        prev_level.as_str(),
                        new_level.as_str()
                    );
                }
                PRESSURE_LEVEL.store(new_level as u8, Ordering::Relaxed);
                // Solo el loop periódico alimenta el cache: los snapshots de
                // `snapshot_now` usan System fresco y su cpu_pct=0 lo contaminaría.
                if let Ok(mut cache) = LAST_SAMPLE.lock() {
                    *cache = Some((s.clone(), now));
                }

                // Latido nativo: tapa el punto ciego del heartbeat JS (tray,
                // ventana oculta, webview congelado). `has_session` se consulta
                // DESPUÉS del gate barato para no pagar el lock async en cada tick.
                if should_emit_native_heartbeat(last_js_snapshot_at(), last_native_at, now)
                    && crate::state::has_session(&app).await
                {
                    native_seq += 1;
                    emit_native_heartbeat(
                        &app,
                        &s,
                        phase,
                        started_at.elapsed().as_secs(),
                        native_seq,
                    )
                    .await;
                    last_native_at = Some(now);
                }

                // Incidente con consentimiento (#61): `arm` dedupea (1 por kind
                // por proceso + cooldown persistido), así que llamarlo en cada
                // tick crítico es barato y correcto.
                if let Some(kind) = incident {
                    let payload = IncidentPayload {
                        kind,
                        ts_ms: std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .map(|d| d.as_millis() as u64)
                            .unwrap_or(0),
                        message: incident_message(kind, &s),
                        detail: serde_json::to_value(&s).unwrap_or(serde_json::Value::Null),
                    };
                    super::incident::arm(&app, payload).await;
                }
            }

            tokio::time::sleep(next_interval(phase)).await;
        }
    });
}

/// Cadencia del sampler por fase. PURA para poder testear la regla sin dormir.
/// Idle es donde la app pasa la jornada: allí el refresh de procesos es puro
/// costo, así que se paga la mitad de veces.
fn next_interval(phase: RecordingPhase) -> Duration {
    if phase == RecordingPhase::Idle {
        SAMPLE_INTERVAL_IDLE
    } else {
        SAMPLE_INTERVAL_ACTIVE
    }
}

/// ¿Toca latido nativo? PURA. Dos condiciones: (a) el webview lleva más de
/// `JS_HEARTBEAT_SILENCE` sin pedir `get_health_snapshot` — o nunca lo pidió —,
/// y (b) han pasado ≥ `NATIVE_HEARTBEAT_EVERY` desde el último latido nativo.
/// El umbral (a) está por ENCIMA del `IDLE_EMIT_EVERY_MS` del JS (15 min) a
/// propósito: un idle sano nunca debe producir dos series de latidos.
fn should_emit_native_heartbeat(
    last_js_seen: Option<Instant>,
    last_native: Option<Instant>,
    now: Instant,
) -> bool {
    if let Some(js) = last_js_seen {
        if now.duration_since(js) < JS_HEARTBEAT_SILENCE {
            return false;
        }
    }
    match last_native {
        Some(t) => now.duration_since(t) >= NATIVE_HEARTBEAT_EVERY,
        None => true,
    }
}

/// Latido `health.heartbeat` emitido desde Rust. Reusa el MISMO `event_type`
/// que el JS (cero cambios de catálogo/lint) y se distingue en SQL por
/// `ctx.emitter = 'rust'` (lo inyecta `emit_event`) + `reason = "native"`.
///
/// Va por el outbox (`emit_event` → `recording_logs` → `drain.rs`), nunca por
/// HTTP propio: `insert_platform_log` tiene single writer (lint check (a)).
/// Consecuencia asumida: a diferencia del heartbeat JS, este SÍ se encola sin
/// red; el event time real viaja en `ctx.occurred_at`, no en `created_at`.
async fn emit_native_heartbeat<R: Runtime>(
    app: &AppHandle<R>,
    s: &MemSample,
    phase: RecordingPhase,
    uptime_s: u64,
    seq: u64,
) {
    let payload = serde_json::json!({
        "reason": "native",
        "phase": phase.as_str(),
        // Desde el arranque del sampler (setup de la app) ≈ arranque del
        // proceso. El del JS cuenta desde el mount POST-AUTH: no son
        // comparables entre emisores.
        "uptime_s": uptime_s,
        "seq": seq,
        // El sample es de ESTE tick: por construcción la edad es 0.
        "mem": s,
        "mem_sample_age_s": 0,
        "peaks": session_peaks(),
        "lag_seconds": crate::audio::transcription::worker::transcription_lag_seconds(),
        // Sin `queue` (lo alimenta un listener del webview) y sin
        // `err_budget.webview` (limiter del JS): desde Rust no existen.
        "err_budget": { "rust": super::rust_error_bridge::budget_snapshot() },
        // El tier lo resuelve `get_device_profile` en el frontend; el emisor
        // nativo lo deja explícitamente nulo en vez de inventarlo.
        "performance_tier": serde_json::Value::Null,
    });

    super::telemetry::emit::emit_event(
        app,
        super::telemetry::context::process_session_id(),
        super::telemetry::catalog::HEALTH_HEARTBEAT,
        payload,
        None,
        None,
        None,
    )
    .await;
}

/// Snapshot inmediato con etiqueta, para eventos de alta señal. Fire-and-forget.
/// Nota: usa un `System` fresco, así que `cpu_pct` y `proc_cpu_pct` salen 0
/// (sin delta previo) — por eso pide el mismo kind ligero SIN el segundo
/// refresh de CPU: pagar un snapshot extra de la tabla de procesos para
/// producir un 0 no tiene sentido.
pub fn snapshot_now(reason: &str) {
    let reason = reason.to_string();
    tauri::async_runtime::spawn(async move {
        let sample = tokio::task::spawn_blocking(|| {
            let mut sys = System::new();
            collect(&mut sys, false)
        })
        .await
        .ok()
        .flatten();
        if let Some(s) = sample {
            log_sample(&reason, &s);
        }
    });
}

/// `measure_proc_cpu`: solo el loop periódico (System persistente) lo pide.
/// Con un `System` fresco no hay baseline y el valor sería un promedio desde
/// el arranque disfrazado de instantáneo.
fn collect(sys: &mut System, measure_proc_cpu: bool) -> Option<MemSample> {
    // Antes de cualquier refresh: si no hay pid propio, el sample no sirve.
    let own_pid = sysinfo::get_current_pid().ok()?;

    sys.refresh_memory();
    // global_cpu_usage() sale de ESTA query PDH, no del refresh de procesos.
    sys.refresh_cpu_usage();
    // Kind LIGERO. `refresh_processes(All, true)` equivale a
    // `.with_memory().with_cpu().with_disk_usage().with_exe(OnlyIfNotSet)`
    // (sysinfo 0.32.1, common/system.rs:298-301) y de ahí solo usábamos
    // `memory`. Lo que se ahorra POR PROCESO Y POR TICK: GetProcessIoCounters
    // (disk_usage) y GetProcessTimes+GetSystemTimes (cpu). GetModuleFileNameExW
    // (exe) también se deja de pagar, pero era `with_exe(OnlyIfNotSet)`: 1× por
    // proceso NUEVO, no por tick — no inflar el ahorro con él.
    // `name()` y `parent()` NO dependen del kind: salen del snapshot de
    // NtQuerySystemInformation (windows/system.rs:307-312 y 330-332), así que
    // los procesos nuevos siguen llegando completos y `has_ancestor` sigue
    // funcionando. `remove_dead_processes = true` se mantiene: sin él el
    // HashMap crece toda la jornada y `has_ancestor` podría resolver contra
    // PIDs muertos reciclados.
    // OJO sysinfo 0.32.1: el constructor vacío es `new()`; `nothing()` es API
    // de 0.33+ y NO compila aquí.
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::new().with_memory(),
    );

    // CPU del proceso propio: segundo refresh acotado a NUESTRO pid. Cuesta un
    // snapshot más de la tabla (NtQuerySystemInformation se ejecuta igual con
    // `Some`), pero solo paga GetProcessTimes/GetSystemTimes UNA vez en lugar
    // de ~300. Con `remove_dead_processes = false` este refresh solo limpia el
    // flag `updated` de nuestro pid y no borra nada (common/system.rs:362-371).
    // El delta es contra el refresh de CPU del tick ANTERIOR (30-60 s), muy por
    // encima de MINIMUM_CPU_UPDATE_INTERVAL (200 ms): no hace falta sleep.
    let proc_cpu_pct = if measure_proc_cpu {
        sys.refresh_processes_specifics(
            ProcessesToUpdate::Some(&[own_pid]),
            false,
            ProcessRefreshKind::new().with_cpu(),
        );
        sys.process(own_pid).map(|p| p.cpu_usage()).unwrap_or(0.0)
    } else {
        0.0
    };

    let mut app_rss: u64 = 0;
    let mut llama_rss: u64 = 0;
    let mut llama_procs: u64 = 0;
    let mut webview_rss: u64 = 0;
    let mut webview_procs: u64 = 0;
    let mut ffmpeg_procs: u64 = 0;

    for (pid, process) in sys.processes() {
        let name = process.name();
        if *pid == own_pid {
            app_rss = process.memory();
        } else if name.eq_ignore_ascii_case("llama-helper.exe")
            || name.eq_ignore_ascii_case("llama-helper")
        {
            // Por NOMBRE, no por PID: así también cuentan los huérfanos que el
            // pool ya no referencia (kill fallido, app previa muerta).
            llama_rss += process.memory();
            llama_procs += 1;
        } else if name.eq_ignore_ascii_case("msedgewebview2.exe") {
            // Solo los renderers NUESTROS: la cadena de parents llega a este PID.
            if has_ancestor(sys, *pid, own_pid, 5) {
                webview_rss += process.memory();
                webview_procs += 1;
            }
        } else if name.eq_ignore_ascii_case("ffmpeg.exe") || name.eq_ignore_ascii_case("ffmpeg") {
            if has_ancestor(sys, *pid, own_pid, 3) {
                ffmpeg_procs += 1;
            }
        }
    }

    Some(MemSample {
        app_rss_mb: app_rss / 1024 / 1024,
        llama_rss_mb: llama_rss / 1024 / 1024,
        llama_procs,
        webview_rss_mb: webview_rss / 1024 / 1024,
        webview_procs,
        ffmpeg_procs,
        sys_avail_mb: sys.available_memory() / 1024 / 1024,
        sys_total_mb: sys.total_memory() / 1024 / 1024,
        cpu_pct: sys.global_cpu_usage(),
        proc_cpu_pct,
    })
}

fn has_ancestor(sys: &System, mut pid: Pid, target: Pid, max_depth: u32) -> bool {
    for _ in 0..max_depth {
        match sys.process(pid).and_then(|p| p.parent()) {
            Some(parent) => {
                if parent == target {
                    return true;
                }
                pid = parent;
            }
            None => return false,
        }
    }
    false
}

fn log_sample(reason: &str, s: &MemSample) {
    let recording = !matches!(current_phase(), RecordingPhase::Idle);
    let lag_s = crate::audio::transcription::worker::transcription_lag_seconds();

    info!(
        "[METRIC] mem-sample reason={} app_rss_mb={} llama_rss_mb={} llama_procs={} webview_rss_mb={} webview_procs={} ffmpeg_procs={} sys_avail_mb={} sys_total_mb={} cpu_pct={:.0} proc_cpu_pct={:.1} recording={} lag_s={}",
        reason,
        s.app_rss_mb,
        s.llama_rss_mb,
        s.llama_procs,
        s.webview_rss_mb,
        s.webview_procs,
        s.ffmpeg_procs,
        s.sys_avail_mb,
        s.sys_total_mb,
        s.cpu_pct,
        s.proc_cpu_pct,
        recording,
        lag_s,
    );

    MEM_APP_PEAK_MB.fetch_max(s.app_rss_mb, Ordering::Relaxed);
    MEM_LLAMA_PEAK_MB.fetch_max(s.llama_rss_mb, Ordering::Relaxed);
    MEM_WEBVIEW_PEAK_MB.fetch_max(s.webview_rss_mb, Ordering::Relaxed);
    SYS_AVAIL_MIN_MB.fetch_min(s.sys_avail_mb, Ordering::Relaxed);
    LLAMA_PROCS_MAX.fetch_max(s.llama_procs, Ordering::Relaxed);
}

fn incident_message(kind: IncidentKind, s: &MemSample) -> String {
    match kind {
        IncidentKind::AppRssCritical => format!(
            "maity-desktop en {} MB de RAM (umbral {} MB)",
            s.app_rss_mb, APP_RSS_CRITICAL_MB
        ),
        IncidentKind::SystemMemoryPressure => format!(
            "{} MB disponibles de {} MB durante ≥{} s",
            s.sys_avail_mb, s.sys_total_mb, PRESSURE_SUSTAINED_SECS
        ),
        other => other.as_str().to_string(),
    }
}

/// Umbrales de alerta con rate-limit por condición.
///
/// Slots: 0 sidecar-pool-multiple, 1 sidecar-kv-bloat, 2 app-rss-high,
/// 3 webview-rss-high, 4 system-memory-pressure, 5 app-rss-critical. Antes
/// `app-rss-critical` compartía el slot 2 con `app-rss-high` vía `else if`, y
/// un warn "high" tapaba el "critical" 10 min.
#[derive(Default)]
struct ConditionWarns {
    last: [Option<Instant>; 6],
    /// Instante del PRIMER sample de la racha bajo `SYS_AVAIL_PRESSURE_MB`
    /// (`None` = sin racha). Ventana en SEGUNDOS, no en ticks: la cadencia del
    /// sampler ahora depende de la fase y un conteo de ticks haría que
    /// "sostenido" significara 60 s grabando y 120 s en idle.
    /// La comparten el incidente (#61) y la subida a `Elevated` (#22): UNA
    /// sola definición de "presión sostenida".
    pressure_since: Option<Instant>,
    /// Racha de recuperación: avail por encima de umbral+margen Y RSS lejos
    /// del crítico. Solo bajar de nivel la consume (histéresis doble del #22).
    recovery_since: Option<Instant>,
    /// Nivel vigente según ESTE estado (la copia publicada vive en
    /// `PRESSURE_LEVEL`; el loop la sincroniza tras cada tick).
    level: PressureLevel,
}

impl ConditionWarns {
    fn due(&mut self, idx: usize, now: Instant) -> bool {
        match self.last[idx] {
            Some(t) if now.duration_since(t) < CONDITION_WARN_EVERY => false,
            _ => {
                self.last[idx] = Some(now);
                true
            }
        }
    }

    /// Detección PURA del incidente (sin cooldown: eso lo hace `incident::arm`).
    /// `app-rss-critical` es inmediato; `system-memory-pressure` exige que la
    /// racha bajo umbral lleve ≥ `PRESSURE_SUSTAINED_SECS` de reloj — así la
    /// promesa del doc ("sostenido 60 s") vale igual a 30 s que a 60 s de
    /// cadencia. Prioridad al de la app: es el que Maity puede arreglar.
    /// `now` se inyecta para poder testear la ventana sin dormir.
    fn detect_incident(&mut self, s: &MemSample, now: Instant) -> Option<IncidentKind> {
        if s.sys_avail_mb < SYS_AVAIL_PRESSURE_MB {
            if self.pressure_since.is_none() {
                self.pressure_since = Some(now);
            }
        } else {
            self.pressure_since = None;
        }
        if s.app_rss_mb > APP_RSS_CRITICAL_MB {
            return Some(IncidentKind::AppRssCritical);
        }
        if let Some(since) = self.pressure_since {
            if now.duration_since(since).as_secs() >= PRESSURE_SUSTAINED_SECS {
                return Some(IncidentKind::SystemMemoryPressure);
            }
        }
        None
    }

    /// Máquina de estados del nivel de presión (#22). Llamar DESPUÉS de
    /// `detect_incident` en el mismo tick (esa función mantiene la racha
    /// `pressure_since` que la subida a `Elevated` reusa). Devuelve
    /// `(anterior, nuevo)` para que el loop loguee la transición y publique el
    /// atómico. Reglas:
    /// - `→ Critical` es INMEDIATO: RSS de la app sobre el umbral crítico, o
    ///   avail por debajo de la MITAD del umbral de presión (con la mitad del
    ///   umbral no hay "sostenido" que valga: cargar cualquier cosa ahí tira
    ///   la máquina a swap).
    /// - `Normal → Elevated`: avail bajo umbral SOSTENIDO ≥
    ///   `PRESSURE_SUSTAINED_SECS` (la misma racha del incidente).
    /// - Bajar de nivel (desde Elevated O Critical) exige recuperación
    ///   SOSTENIDA: avail > umbral + `PRESSURE_RECOVERY_MARGIN_MB` y RSS lejos
    ///   del crítico durante ≥ `PRESSURE_RECOVERY_SECS`. Sin recuperación
    ///   completa, un Critical cuya causa desapareció baja a `Elevated` (no a
    ///   `Normal`): el sistema sigue apretado.
    fn update_pressure_level(&mut self, s: &MemSample, now: Instant) -> (PressureLevel, PressureLevel) {
        let prev = self.level;

        let recovered_sample = s.sys_avail_mb > SYS_AVAIL_PRESSURE_MB + PRESSURE_RECOVERY_MARGIN_MB
            && s.app_rss_mb < APP_RSS_CRITICAL_MB.saturating_sub(PRESSURE_RECOVERY_MARGIN_MB);
        if recovered_sample {
            self.recovery_since.get_or_insert(now);
        } else {
            self.recovery_since = None;
        }

        let critical_now =
            s.app_rss_mb > APP_RSS_CRITICAL_MB || s.sys_avail_mb < SYS_AVAIL_PRESSURE_MB / 2;
        let elevated_sustained = self
            .pressure_since
            .is_some_and(|t| now.duration_since(t).as_secs() >= PRESSURE_SUSTAINED_SECS);
        let recovery_sustained = self
            .recovery_since
            .is_some_and(|t| now.duration_since(t).as_secs() >= PRESSURE_RECOVERY_SECS);

        self.level = if critical_now {
            PressureLevel::Critical
        } else {
            match prev {
                PressureLevel::Critical | PressureLevel::Elevated => {
                    if recovery_sustained {
                        PressureLevel::Normal
                    } else {
                        PressureLevel::Elevated
                    }
                }
                PressureLevel::Normal => {
                    if elevated_sustained {
                        PressureLevel::Elevated
                    } else {
                        PressureLevel::Normal
                    }
                }
            }
        };
        (prev, self.level)
    }

    /// Loguea los warnings con rate-limit y devuelve el incidente (si lo hay)
    /// para que el loop lo arme.
    fn check(&mut self, s: &MemSample, now: Instant) -> Option<IncidentKind> {
        if s.llama_procs > 2 && self.due(0, now) {
            warn!(
                "[MEM] sidecar-pool-multiple: {} procesos llama-helper vivos ({} MB) — pool sin evicción u huérfanos",
                s.llama_procs, s.llama_rss_mb
            );
        }
        if s.llama_rss_mb > 3500 && self.due(1, now) {
            warn!(
                "[MEM] sidecar-kv-bloat: llama-helper en {} MB (pesos 4b ~2400 + KV@4096 — más que eso apunta a n_ctx grande)",
                s.llama_rss_mb
            );
        }
        if s.app_rss_mb > APP_RSS_CRITICAL_MB {
            if self.due(5, now) {
                error!(
                    "[MEM] app-rss-critical: maity-desktop en {} MB — cola llena o motores STT duplicados",
                    s.app_rss_mb
                );
            }
        } else if s.app_rss_mb > 2500 && self.due(2, now) {
            warn!("[MEM] app-rss-high: maity-desktop en {} MB", s.app_rss_mb);
        }
        if s.webview_rss_mb > 1200 && self.due(3, now) {
            warn!(
                "[MEM] webview-rss-high: {} MB en {} procesos WebView2",
                s.webview_rss_mb, s.webview_procs
            );
        }
        if s.sys_avail_mb < SYS_AVAIL_PRESSURE_MB && self.due(4, now) {
            error!(
                "[MEM] system-memory-pressure: {} MB disponibles de {} MB — riesgo de swap/congelamiento",
                s.sys_avail_mb, s.sys_total_mb
            );
        }
        self.detect_incident(s, now)
    }
}

#[cfg(test)]
mod incident_detection_tests {
    use super::*;

    fn sample(app_rss_mb: u64, sys_avail_mb: u64) -> MemSample {
        MemSample {
            app_rss_mb,
            llama_rss_mb: 0,
            llama_procs: 0,
            webview_rss_mb: 0,
            webview_procs: 0,
            ffmpeg_procs: 0,
            sys_avail_mb,
            sys_total_mb: 8000,
            cpu_pct: 0.0,
            proc_cpu_pct: 0.0,
        }
    }

    #[test]
    fn rss_critical_dispara_al_primer_sample() {
        let mut w = ConditionWarns::default();
        let t0 = Instant::now();
        assert_eq!(w.detect_incident(&sample(APP_RSS_CRITICAL_MB, 4000), t0), None);
        assert_eq!(
            w.detect_incident(&sample(APP_RSS_CRITICAL_MB + 1, 4000), t0),
            Some(IncidentKind::AppRssCritical)
        );
    }

    #[test]
    fn presion_de_sistema_exige_la_ventana_en_segundos() {
        let mut w = ConditionWarns::default();
        let t0 = Instant::now();
        assert_eq!(
            w.detect_incident(&sample(500, 900), t0),
            None,
            "primer sample: la ventana acaba de abrir"
        );
        assert_eq!(
            w.detect_incident(
                &sample(500, 900),
                t0 + Duration::from_secs(PRESSURE_SUSTAINED_SECS - 1)
            ),
            None,
            "un segundo antes de la ventana: aún no"
        );
        assert_eq!(
            w.detect_incident(
                &sample(500, 900),
                t0 + Duration::from_secs(PRESSURE_SUSTAINED_SECS)
            ),
            Some(IncidentKind::SystemMemoryPressure),
            "al cumplirse la ventana: sostenido"
        );
    }

    #[test]
    fn la_presion_sostenida_no_depende_de_la_cadencia() {
        // Grabando (30 s): 3 samples. Idle (60 s): 2 samples. Mismo resultado
        // en segundos — que es justo lo que promete docs/TELEMETRIA.md.
        let t0 = Instant::now();
        let mut activo = ConditionWarns::default();
        assert_eq!(activo.detect_incident(&sample(500, 900), t0), None);
        assert_eq!(
            activo.detect_incident(&sample(500, 900), t0 + Duration::from_secs(30)),
            None
        );
        assert_eq!(
            activo.detect_incident(&sample(500, 900), t0 + Duration::from_secs(60)),
            Some(IncidentKind::SystemMemoryPressure)
        );

        let mut idle = ConditionWarns::default();
        assert_eq!(idle.detect_incident(&sample(500, 900), t0), None);
        assert_eq!(
            idle.detect_incident(&sample(500, 900), t0 + Duration::from_secs(60)),
            Some(IncidentKind::SystemMemoryPressure)
        );
    }

    #[test]
    fn un_sample_sano_reabre_la_ventana_de_presion() {
        let mut w = ConditionWarns::default();
        let t0 = Instant::now();
        w.detect_incident(&sample(500, 900), t0);
        assert_eq!(
            w.detect_incident(&sample(500, 3000), t0 + Duration::from_secs(30)),
            None,
            "sample sano: se cierra la racha"
        );
        assert_eq!(
            w.detect_incident(&sample(500, 900), t0 + Duration::from_secs(60)),
            None,
            "la ventana vuelve a empezar, no hereda los 30 s previos"
        );
        assert_eq!(
            w.detect_incident(&sample(500, 900), t0 + Duration::from_secs(120)),
            Some(IncidentKind::SystemMemoryPressure)
        );
    }

    #[test]
    fn rss_critical_tiene_prioridad_sobre_presion() {
        let mut w = ConditionWarns::default();
        let t0 = Instant::now();
        w.detect_incident(&sample(500, 900), t0);
        assert_eq!(
            w.detect_incident(
                &sample(APP_RSS_CRITICAL_MB + 100, 900),
                t0 + Duration::from_secs(PRESSURE_SUSTAINED_SECS)
            ),
            Some(IncidentKind::AppRssCritical)
        );
    }

    #[test]
    fn incident_message_incluye_cifras_y_la_ventana_en_segundos() {
        let m = incident_message(IncidentKind::AppRssCritical, &sample(4500, 900));
        assert!(m.contains("4500"));
        let m = incident_message(IncidentKind::SystemMemoryPressure, &sample(500, 900));
        assert!(m.contains("900") && m.contains("8000"));
        assert!(
            m.contains(&PRESSURE_SUSTAINED_SECS.to_string()),
            "el mensaje debe imprimir la ventana real, no un producto de constantes: {}",
            m
        );
    }
}

#[cfg(test)]
mod pressure_level_tests {
    use super::*;

    fn sample(app_rss_mb: u64, sys_avail_mb: u64) -> MemSample {
        MemSample {
            app_rss_mb,
            llama_rss_mb: 0,
            llama_procs: 0,
            webview_rss_mb: 0,
            webview_procs: 0,
            ffmpeg_procs: 0,
            sys_avail_mb,
            sys_total_mb: 8000,
            cpu_pct: 0.0,
            proc_cpu_pct: 0.0,
        }
    }

    /// Un tick completo como lo hace el loop: check (mantiene la racha) +
    /// update del nivel.
    fn tick(w: &mut ConditionWarns, s: &MemSample, now: Instant) -> PressureLevel {
        let _ = w.detect_incident(s, now);
        w.update_pressure_level(s, now).1
    }

    const HEALTHY: u64 = SYS_AVAIL_PRESSURE_MB + PRESSURE_RECOVERY_MARGIN_MB + 100;

    #[test]
    fn arranca_en_normal_y_un_pico_de_un_tick_no_sube() {
        let mut w = ConditionWarns::default();
        let t0 = Instant::now();
        assert_eq!(tick(&mut w, &sample(500, 900), t0), PressureLevel::Normal);
        assert_eq!(
            tick(&mut w, &sample(500, HEALTHY), t0 + Duration::from_secs(30)),
            PressureLevel::Normal,
            "un pico aislado bajo umbral no debe subir el nivel"
        );
    }

    #[test]
    fn presion_sostenida_sube_a_elevated() {
        let mut w = ConditionWarns::default();
        let t0 = Instant::now();
        tick(&mut w, &sample(500, 900), t0);
        assert_eq!(
            tick(
                &mut w,
                &sample(500, 900),
                t0 + Duration::from_secs(PRESSURE_SUSTAINED_SECS)
            ),
            PressureLevel::Elevated,
            "la MISMA ventana del incidente sube el nivel"
        );
    }

    #[test]
    fn critical_es_inmediato_por_rss_y_por_media_ventana_de_avail() {
        let mut w = ConditionWarns::default();
        let t0 = Instant::now();
        assert_eq!(
            tick(&mut w, &sample(APP_RSS_CRITICAL_MB + 1, HEALTHY), t0),
            PressureLevel::Critical,
            "RSS crítico: sin esperar racha"
        );

        let mut w2 = ConditionWarns::default();
        assert_eq!(
            tick(&mut w2, &sample(500, SYS_AVAIL_PRESSURE_MB / 2 - 1), t0),
            PressureLevel::Critical,
            "avail bajo la MITAD del umbral: sin esperar racha"
        );
    }

    #[test]
    fn bajar_exige_recuperacion_sostenida() {
        let mut w = ConditionWarns::default();
        let t0 = Instant::now();
        tick(&mut w, &sample(500, 900), t0);
        let t1 = t0 + Duration::from_secs(PRESSURE_SUSTAINED_SECS);
        assert_eq!(tick(&mut w, &sample(500, 900), t1), PressureLevel::Elevated);

        // Un sample sano NO baja de inmediato (histéresis).
        let t2 = t1 + Duration::from_secs(30);
        assert_eq!(
            tick(&mut w, &sample(500, HEALTHY), t2),
            PressureLevel::Elevated,
            "la recuperación acaba de empezar"
        );
        // Recuperación sostenida los segundos requeridos: baja a Normal.
        let t3 = t2 + Duration::from_secs(PRESSURE_RECOVERY_SECS);
        assert_eq!(tick(&mut w, &sample(500, HEALTHY), t3), PressureLevel::Normal);
    }

    #[test]
    fn oscilar_alrededor_del_umbral_no_baja_el_nivel() {
        let mut w = ConditionWarns::default();
        let t0 = Instant::now();
        tick(&mut w, &sample(500, 900), t0);
        let t1 = t0 + Duration::from_secs(PRESSURE_SUSTAINED_SECS);
        assert_eq!(tick(&mut w, &sample(500, 900), t1), PressureLevel::Elevated);

        // Por encima del umbral pero DENTRO del margen de recuperación: la
        // racha de recuperación nunca abre y el nivel no baja.
        let t2 = t1 + Duration::from_secs(60);
        assert_eq!(
            tick(&mut w, &sample(500, SYS_AVAIL_PRESSURE_MB + 100), t2),
            PressureLevel::Elevated
        );
        let t3 = t2 + Duration::from_secs(600);
        assert_eq!(
            tick(&mut w, &sample(500, SYS_AVAIL_PRESSURE_MB + 100), t3),
            PressureLevel::Elevated,
            "10 min en la zona gris: sigue Elevated (histéresis doble)"
        );
    }

    #[test]
    fn critical_sin_recuperar_baja_solo_a_elevated() {
        let mut w = ConditionWarns::default();
        let t0 = Instant::now();
        assert_eq!(
            tick(&mut w, &sample(APP_RSS_CRITICAL_MB + 500, 900), t0),
            PressureLevel::Critical
        );
        // El RSS bajó pero el sistema sigue apretado (avail bajo umbral).
        let t1 = t0 + Duration::from_secs(30);
        assert_eq!(
            tick(&mut w, &sample(500, 900), t1),
            PressureLevel::Elevated,
            "sin recuperación completa: Critical decae a Elevated, no a Normal"
        );
    }

    #[test]
    fn una_recaida_reinicia_la_racha_de_recuperacion() {
        let mut w = ConditionWarns::default();
        let t0 = Instant::now();
        tick(&mut w, &sample(500, 900), t0);
        let t1 = t0 + Duration::from_secs(PRESSURE_SUSTAINED_SECS);
        assert_eq!(tick(&mut w, &sample(500, 900), t1), PressureLevel::Elevated);

        let t2 = t1 + Duration::from_secs(30);
        tick(&mut w, &sample(500, HEALTHY), t2); // recuperación abre
        let t3 = t2 + Duration::from_secs(30);
        tick(&mut w, &sample(500, 900), t3); // recaída: racha se cierra
        let t4 = t3 + Duration::from_secs(PRESSURE_RECOVERY_SECS);
        assert_eq!(
            tick(&mut w, &sample(500, HEALTHY), t4),
            PressureLevel::Elevated,
            "la recuperación vuelve a contar desde cero tras la recaída"
        );
    }

    #[test]
    fn el_orden_del_enum_permite_comparar_por_severidad() {
        assert!(PressureLevel::Normal < PressureLevel::Elevated);
        assert!(PressureLevel::Elevated < PressureLevel::Critical);
    }
}

#[cfg(test)]
mod cadencia_tests {
    use super::*;

    #[test]
    fn next_interval_es_30s_grabando_y_60s_en_idle() {
        assert_eq!(next_interval(RecordingPhase::Idle), SAMPLE_INTERVAL_IDLE);
        for phase in [
            RecordingPhase::Starting,
            RecordingPhase::Recording,
            RecordingPhase::Paused,
            RecordingPhase::Stopping,
        ] {
            assert_eq!(
                next_interval(phase),
                SAMPLE_INTERVAL_ACTIVE,
                "toda fase no-idle muestrea fino: {:?}",
                phase
            );
        }
    }

    #[test]
    fn la_cadencia_idle_es_mas_laxa_que_la_activa() {
        assert!(SAMPLE_INTERVAL_ACTIVE < SAMPLE_INTERVAL_IDLE);
    }
}

#[cfg(test)]
mod latido_nativo_tests {
    use super::*;

    #[test]
    fn no_emite_si_el_webview_pidio_snapshot_hace_poco() {
        let t0 = Instant::now();
        let now = t0 + Duration::from_secs(60 * 60);
        let js_vivo = Some(now - Duration::from_secs(5 * 60));
        assert!(
            !should_emit_native_heartbeat(js_vivo, None, now),
            "el JS está vivo: el nativo se calla aunque nunca haya emitido"
        );
    }

    #[test]
    fn emite_si_el_webview_lleva_mas_de_20_min_mudo() {
        let now = Instant::now() + Duration::from_secs(60 * 60);
        let js_mudo = Some(now - (JS_HEARTBEAT_SILENCE + Duration::from_secs(1)));
        assert!(should_emit_native_heartbeat(js_mudo, None, now));
    }

    #[test]
    fn el_umbral_del_js_esta_por_encima_de_su_cadencia_idle() {
        // El heartbeat JS emite cada 15 min en idle; el nativo espera 20 para
        // no duplicar la serie en una jornada idle normal.
        assert!(JS_HEARTBEAT_SILENCE > NATIVE_HEARTBEAT_EVERY);
    }

    #[test]
    fn respeta_su_propia_cadencia_de_15_min() {
        let now = Instant::now() + Duration::from_secs(60 * 60);
        let js_mudo = Some(now - Duration::from_secs(60 * 60));
        let recien = Some(now - (NATIVE_HEARTBEAT_EVERY - Duration::from_secs(1)));
        assert!(
            !should_emit_native_heartbeat(js_mudo, recien, now),
            "un tick a los 14:59 no debe emitir"
        );
        let justo = Some(now - NATIVE_HEARTBEAT_EVERY);
        assert!(should_emit_native_heartbeat(js_mudo, justo, now));
    }

    #[test]
    fn sin_actividad_previa_del_js_emite_al_cumplirse_la_cadencia() {
        // Caso tray desde el arranque: el loop siembra `last_native` con el
        // instante de arranque, así que el primer latido sale a los 15 min de
        // uptime, no a los 30 s.
        let arranque = Instant::now();
        assert!(!should_emit_native_heartbeat(
            None,
            Some(arranque),
            arranque + Duration::from_secs(30)
        ));
        assert!(should_emit_native_heartbeat(
            None,
            Some(arranque),
            arranque + NATIVE_HEARTBEAT_EVERY
        ));
    }
}
