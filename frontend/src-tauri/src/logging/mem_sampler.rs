//! Muestreador de memoria por proceso — línea `[METRIC] mem-sample` al log
//! rotativo cada 30s, picos por sesión para el session-summary del coach y
//! snapshots bajo demanda en eventos de alta señal (kill del sidecar, recycle
//! ONNX, backlog, stop de grabación).
//!
//! Por qué existe: la auditoría RAM jul-2026 encontró CERO señales de memoria
//! en 60 MB de logs de campo — la app nunca medía su propio RSS ni el de sus
//! procesos hijos, así que "la memoria no se libera" era indemostrable. Este
//! módulo responde: ¿qué proceso retiene (maity-desktop, llama-helper,
//! WebView2) y se libera tras el stop?

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use log::{error, info, warn};
use sysinfo::{Pid, ProcessesToUpdate, System};

const SAMPLE_INTERVAL: Duration = Duration::from_secs(30);
/// Rate-limit de los warnings por condición (el sample sigue saliendo cada 30s).
const CONDITION_WARN_EVERY: Duration = Duration::from_secs(600);

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
    pub cpu_pct: f32,
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

/// Sample fresco bajo demanda, fallback pre-primer-tick. `System` nuevo →
/// `cpu_pct` sale 0 (sin delta previo); el llamador lo distingue porque la
/// edad del sample viene como `None`. Correr en `spawn_blocking`.
pub fn collect_fresh() -> Option<MemSample> {
    collect(&mut System::new())
}

/// Arranca el sampler periódico. Llamar UNA vez desde el setup de la app.
pub fn start() {
    tauri::async_runtime::spawn(async move {
        // El System persiste entre ticks: global_cpu_usage() necesita el
        // delta respecto al refresh anterior para dar valores reales.
        let mut sys = System::new();
        let mut warn_state = ConditionWarns::default();
        let mut interval = tokio::time::interval(SAMPLE_INTERVAL);
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        info!(
            "[MEM] sampler iniciado (cada {}s, warnings cada {}s por condición)",
            SAMPLE_INTERVAL.as_secs(),
            CONDITION_WARN_EVERY.as_secs()
        );
        loop {
            interval.tick().await;
            // El refresh de procesos recorre la tabla del OS: fuera del runtime.
            let joined = tokio::task::spawn_blocking(move || {
                let sample = collect(&mut sys);
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
            if let Some(s) = sample {
                log_sample("periodic", &s);
                warn_state.check(&s);
                // Solo el loop periódico alimenta el cache: los snapshots de
                // `snapshot_now` usan System fresco y su cpu_pct=0 lo contaminaría.
                if let Ok(mut cache) = LAST_SAMPLE.lock() {
                    *cache = Some((s, Instant::now()));
                }
            }
        }
    });
}

/// Snapshot inmediato con etiqueta, para eventos de alta señal. Fire-and-forget.
/// Nota: usa un `System` fresco, así que `cpu_pct` sale 0 (sin delta previo).
pub fn snapshot_now(reason: &str) {
    let reason = reason.to_string();
    tauri::async_runtime::spawn(async move {
        let sample = tokio::task::spawn_blocking(|| {
            let mut sys = System::new();
            collect(&mut sys)
        })
        .await
        .ok()
        .flatten();
        if let Some(s) = sample {
            log_sample(&reason, &s);
        }
    });
}

fn collect(sys: &mut System) -> Option<MemSample> {
    sys.refresh_memory();
    sys.refresh_cpu_usage();
    sys.refresh_processes(ProcessesToUpdate::All, true);

    let own_pid = sysinfo::get_current_pid().ok()?;

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
    let recording = !matches!(
        crate::audio::recording_phase::current_phase(),
        crate::audio::recording_phase::RecordingPhase::Idle
    );
    let lag_s = crate::audio::transcription::worker::transcription_lag_seconds();

    info!(
        "[METRIC] mem-sample reason={} app_rss_mb={} llama_rss_mb={} llama_procs={} webview_rss_mb={} webview_procs={} ffmpeg_procs={} sys_avail_mb={} sys_total_mb={} cpu_pct={:.0} recording={} lag_s={}",
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
        recording,
        lag_s,
    );

    MEM_APP_PEAK_MB.fetch_max(s.app_rss_mb, Ordering::Relaxed);
    MEM_LLAMA_PEAK_MB.fetch_max(s.llama_rss_mb, Ordering::Relaxed);
    MEM_WEBVIEW_PEAK_MB.fetch_max(s.webview_rss_mb, Ordering::Relaxed);
    SYS_AVAIL_MIN_MB.fetch_min(s.sys_avail_mb, Ordering::Relaxed);
    LLAMA_PROCS_MAX.fetch_max(s.llama_procs, Ordering::Relaxed);
}

/// Umbrales de alerta con rate-limit por condición.
#[derive(Default)]
struct ConditionWarns {
    last: [Option<Instant>; 5],
}

impl ConditionWarns {
    fn due(&mut self, idx: usize) -> bool {
        let now = Instant::now();
        match self.last[idx] {
            Some(t) if now.duration_since(t) < CONDITION_WARN_EVERY => false,
            _ => {
                self.last[idx] = Some(now);
                true
            }
        }
    }

    fn check(&mut self, s: &MemSample) {
        if s.llama_procs > 2 && self.due(0) {
            warn!(
                "[MEM] sidecar-pool-multiple: {} procesos llama-helper vivos ({} MB) — pool sin evicción u huérfanos",
                s.llama_procs, s.llama_rss_mb
            );
        }
        if s.llama_rss_mb > 3500 && self.due(1) {
            warn!(
                "[MEM] sidecar-kv-bloat: llama-helper en {} MB (pesos 4b ~2400 + KV@4096 — más que eso apunta a n_ctx grande)",
                s.llama_rss_mb
            );
        }
        if s.app_rss_mb > 4000 && self.due(2) {
            error!(
                "[MEM] app-rss-critical: maity-desktop en {} MB — cola llena o motores STT duplicados",
                s.app_rss_mb
            );
        } else if s.app_rss_mb > 2500 && self.due(2) {
            warn!("[MEM] app-rss-high: maity-desktop en {} MB", s.app_rss_mb);
        }
        if s.webview_rss_mb > 1200 && self.due(3) {
            warn!(
                "[MEM] webview-rss-high: {} MB en {} procesos WebView2",
                s.webview_rss_mb, s.webview_procs
            );
        }
        if s.sys_avail_mb < 1024 && self.due(4) {
            error!(
                "[MEM] system-memory-pressure: {} MB disponibles de {} MB — riesgo de swap/congelamiento",
                s.sys_avail_mb, s.sys_total_mb
            );
        }
    }
}
