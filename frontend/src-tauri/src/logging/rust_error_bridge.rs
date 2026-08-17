//! Puente Rust ERROR → frontend → `app.error` en maity.platform_logs (issue #60).
//!
//! Un `Layer` de tracing captura los eventos ERROR del crate (los ~100
//! `log::error!` llegan igual, vía el LogTracer implícito de
//! `SubscriberInitExt::init()`), los filtra/dedupea y los manda por un canal
//! mpsc acotado. Una task drenadora (arrancada en el `setup()` de lib.rs con el
//! AppHandle) los emite como evento `rust-error`; el listener del frontend
//! (`errorTelemetry.ts`, solo ventana principal) los reenvía como `app.error`
//! con `source:'rust'`.
//!
//! ## Por qué canal y NO `app.emit` directo desde `on_event`
//! `on_event` corre síncrono en el thread que logueó, potencialmente bajo locks
//! arbitrarios (incluidos internos de Tauri); `app.emit` serializa e itera
//! ventanas bajo el state de Tauri y puede loguear transitivamente (wry/tao vía
//! `log`) → deadlock por inversión de locks o reentrada del subscriber. Con el
//! canal, dentro de `on_event` solo hay filtro + visitor + dedup + `try_send`:
//! nada bloquea, nada loguea, nada re-entra.
//!
//! ## REGLA: PROHIBIDO loguear dentro de este módulo
//! Ni `log::*` ni `tracing::*` en `on_event` NI en la drenadora — un log aquí
//! puede re-entrar el propio layer. Todos los fallos se descartan en silencio
//! (el log rotativo ya tiene el error original).
//!
//! ## Filtro por target
//! Solo pasan `app_lib` / `app_lib::*`. Excluye a propósito:
//! - `"frontend"` (`log_frontend_event` re-emite errores de JS como
//!   `tracing::error!(target: "frontend")` → sería un bucle JS→Rust→JS);
//! - crates de terceros (tauri/wry/sqlx/reqwest…): ruido sin accionable.
//! OJO: un futuro `log::error!(target: "custom", ...)` NO pasa el filtro —
//! usar el target implícito (`module_path!`) para que cuente.
//!
//! ## Gaps conocidos (documentados en docs/TELEMETRIA.md)
//! - El fallback `tracing_subscriber::fmt::init()` de main.rs (cuando falla el
//!   file logging) no lleva este layer.
//! - Eventos emitidos antes de que el frontend monte su listener se pierden
//!   del lado remoto (Tauri no encola emits); persisten en maity.log.
//! - Los panics no pasan por tracing (fuera de alcance; ver issue #60).

use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::collections::{BTreeMap, BTreeSet};

use tauri::Emitter;
use tokio::sync::mpsc;
use tracing::field::{Field, Visit};
use tracing::{Event, Level, Subscriber};
use tracing_log::NormalizeEvent;
use tracing_subscriber::layer::{Context, Layer};

/// Cap de envíos por proceso (espejo del `ErrorReportLimiter` del frontend).
const MAX_REPORTS_PER_PROCESS: usize = 20;
/// Gap mínimo entre envíos (anti-ráfaga).
const MIN_GAP_MS: u64 = 2_000;
/// Truncado del mensaje en el payload.
const MAX_MESSAGE_CHARS: usize = 1_000;
/// Capacidad del canal: los ERROR son raros (≤20 tras el cap); 64 da margen
/// para el buffer entre `init_file_logging` y el `start()` del setup.
const CHANNEL_CAPACITY: usize = 64;

#[derive(Clone, Debug, serde::Serialize)]
pub struct RustErrorPayload {
    pub target: String,
    pub message: String,
    /// Epoch millis del lado Rust: el pipeline (canal → drenadora → webview →
    /// gap del limiter JS → RPC) puede retrasar `created_at` varios segundos;
    /// esto permite correlacionar exacto contra las líneas de maity.log.
    pub ts_ms: u64,
}

/// Contadores del limiter para el `err_budget` del heartbeat. Monótonos por
/// proceso (en SQL: `max()` por sesión y luego sumar). Invariante:
/// `sent + dropped_dedup + dropped_cap + dropped_gap == intentos que llegaron
/// al limiter` (`dropped_channel` se cuenta aparte, post-limiter).
#[derive(Debug, Clone, serde::Serialize)]
pub struct BridgeBudget {
    pub sent: u64,
    pub dropped_dedup: u64,
    pub dropped_cap: u64,
    pub dropped_gap: u64,
    pub dropped_channel: u64,
    /// Ocurrencias que NO se enviaron (dedup incluido) — el denominador que un
    /// limiter mudo hacía invisible: "20 errores" podía significar 20 o 20.000.
    pub suppressed_total: u64,
    /// Top 3 claves más repetidas (conteos; la clave ya viene truncada a 120).
    pub top_suppressed: Vec<SuppressedEntry>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct SuppressedEntry {
    pub key: String,
    pub count: u64,
}

/// Dedup + cap + gap, con estado propio (no estático) para que los tests usen
/// instancias frescas. En producción vive dentro del único `RustErrorLayer` y
/// se registra en `GLOBAL_LIMITER` para el snapshot del heartbeat.
struct BridgeLimiter {
    max_per_process: usize,
    min_gap_ms: u64,
    sent: AtomicUsize,
    last_sent_ms: AtomicU64,
    dropped_dedup: AtomicU64,
    dropped_cap: AtomicU64,
    dropped_gap: AtomicU64,
    /// Ocurrencias por clave (rollup de suprimidos). Antes era un `BTreeSet`
    /// sin conteo: dedup permanente pero mudo.
    seen: Mutex<BTreeMap<String, u64>>,
    /// Claves ya ENVIADAS. Separado de `seen` a propósito: un drop por cap/gap
    /// no debe envenenar el dedup — antes, un error descartado por el gap de
    /// 2 s quedaba marcado como visto y su siguiente ocurrencia jamás se
    /// enviaba (se perdía el PRIMER error de cada ráfaga).
    sent_keys: Mutex<BTreeSet<String>>,
}

impl BridgeLimiter {
    fn new(max_per_process: usize, min_gap_ms: u64) -> Self {
        Self {
            max_per_process,
            min_gap_ms,
            sent: AtomicUsize::new(0),
            last_sent_ms: AtomicU64::new(0),
            dropped_dedup: AtomicU64::new(0),
            dropped_cap: AtomicU64::new(0),
            dropped_gap: AtomicU64::new(0),
            seen: Mutex::new(BTreeMap::new()),
            sent_keys: Mutex::new(BTreeSet::new()),
        }
    }

    /// true si este error debe enviarse. Dedup por `target:message[..120]`
    /// sobre lo ENVIADO; cada descarte incrementa su contador.
    fn allows(&self, target: &str, message: &str, now_ms: u64) -> bool {
        let key = format!("{}:{}", target, truncate_chars(message, 120));
        {
            let Ok(mut seen) = self.seen.lock() else { return false };
            *seen.entry(key.clone()).or_insert(0) += 1;
        }
        {
            let Ok(sent_keys) = self.sent_keys.lock() else { return false };
            if sent_keys.contains(&key) {
                self.dropped_dedup.fetch_add(1, Ordering::Relaxed);
                return false;
            }
        }
        if self.sent.load(Ordering::Relaxed) >= self.max_per_process {
            self.dropped_cap.fetch_add(1, Ordering::Relaxed);
            return false;
        }
        let last = self.last_sent_ms.load(Ordering::Relaxed);
        if last != 0 && now_ms.saturating_sub(last) < self.min_gap_ms {
            self.dropped_gap.fetch_add(1, Ordering::Relaxed);
            return false;
        }
        self.sent.fetch_add(1, Ordering::Relaxed);
        self.last_sent_ms.store(now_ms, Ordering::Relaxed);
        if let Ok(mut sent_keys) = self.sent_keys.lock() {
            sent_keys.insert(key);
        }
        true
    }

    fn budget(&self, dropped_channel: u64) -> BridgeBudget {
        let sent = self.sent.load(Ordering::Relaxed) as u64;
        let (top_suppressed, occurrences_total) = match self.seen.lock() {
            Ok(seen) => {
                let total: u64 = seen.values().sum();
                let mut entries: Vec<(&String, &u64)> = seen.iter().collect();
                entries.sort_by(|a, b| b.1.cmp(a.1));
                (
                    entries
                        .into_iter()
                        .take(3)
                        .map(|(key, count)| SuppressedEntry {
                            key: key.clone(),
                            count: *count,
                        })
                        .collect(),
                    total,
                )
            }
            Err(_) => (Vec::new(), 0),
        };
        BridgeBudget {
            sent,
            dropped_dedup: self.dropped_dedup.load(Ordering::Relaxed),
            dropped_cap: self.dropped_cap.load(Ordering::Relaxed),
            dropped_gap: self.dropped_gap.load(Ordering::Relaxed),
            dropped_channel,
            suppressed_total: occurrences_total.saturating_sub(sent),
            top_suppressed,
        }
    }
}

/// El limiter de producción, para el snapshot del heartbeat. Lo puebla
/// `make_layer()`; los layers de test usan instancias propias y no lo tocan.
static GLOBAL_LIMITER: OnceLock<Arc<BridgeLimiter>> = OnceLock::new();
/// Descartes por canal lleno (post-limiter, pre-drenadora).
static DROPPED_CHANNEL: AtomicU64 = AtomicU64::new(0);

/// Snapshot de contadores para `get_health_snapshot` (None si el layer de
/// producción nunca se creó — p. ej. el fallback `fmt::init()` de main.rs).
pub fn budget_snapshot() -> Option<BridgeBudget> {
    GLOBAL_LIMITER
        .get()
        .map(|limiter| limiter.budget(DROPPED_CHANNEL.load(Ordering::Relaxed)))
}

/// Truncado seguro por caracteres (no parte UTF-8 a la mitad).
fn truncate_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    s.chars().take(max).collect()
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Visitor que extrae SOLO el campo `message` del evento (los `log::error!`
/// bridgeados traen el texto formateado ahí).
#[derive(Default)]
struct MessageVisitor {
    message: String,
}

impl Visit for MessageVisitor {
    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        if field.name() == "message" && self.message.is_empty() {
            self.message = truncate_chars(&format!("{:?}", value), MAX_MESSAGE_CHARS);
        }
    }

    fn record_str(&mut self, field: &Field, value: &str) {
        if field.name() == "message" && self.message.is_empty() {
            self.message = truncate_chars(value, MAX_MESSAGE_CHARS);
        }
    }
}

pub struct RustErrorLayer {
    tx: mpsc::Sender<RustErrorPayload>,
    limiter: Arc<BridgeLimiter>,
}

impl<S: Subscriber> Layer<S> for RustErrorLayer {
    fn on_event(&self, event: &Event<'_>, _ctx: Context<'_, S>) {
        // CRÍTICO: los eventos bridgeados desde el crate `log` (LogTracer, o
        // sea el ~96% de los errores del codebase) llevan
        // `event.metadata().target() == "log"`; el target REAL solo aparece en
        // la metadata normalizada. Sin esto, el filtro descartaba todos los
        // `log::error!` (bug cazado en el e2e del ciclo jul-31).
        let normalized = event.normalized_metadata();
        let meta = normalized.as_ref().unwrap_or_else(|| event.metadata());
        if *meta.level() != Level::ERROR {
            return;
        }
        let target = meta.target();
        // Exacto o con separador: `app_lib2::x` NO debe pasar.
        if !(target == "app_lib" || target.starts_with("app_lib::")) {
            return;
        }
        let mut visitor = MessageVisitor::default();
        event.record(&mut visitor);
        if visitor.message.is_empty() {
            return;
        }
        if !self.limiter.allows(target, &visitor.message, now_ms()) {
            return;
        }
        // try_send: jamás bloquea. Canal lleno o drenadora ausente → drop
        // contado (el error ya está en maity.log; el contador delata el hueco).
        if self
            .tx
            .try_send(RustErrorPayload {
                target: target.to_string(),
                message: visitor.message,
                ts_ms: now_ms(),
            })
            .is_err()
        {
            DROPPED_CHANNEL.fetch_add(1, Ordering::Relaxed);
        }
    }
}

/// Receiver estacionado entre `make_layer()` (main, sin runtime) y `start()`
/// (setup de Tauri). Lo que se loguee en ese lapso queda buffered en el canal.
static PENDING_RX: Mutex<Option<mpsc::Receiver<RustErrorPayload>>> = Mutex::new(None);

/// Crea el layer para el registry de `init_file_logging`. Llamar UNA vez.
pub fn make_layer() -> RustErrorLayer {
    let (tx, rx) = mpsc::channel(CHANNEL_CAPACITY);
    if let Ok(mut slot) = PENDING_RX.lock() {
        *slot = Some(rx);
    }
    let limiter = Arc::new(BridgeLimiter::new(MAX_REPORTS_PER_PROCESS, MIN_GAP_MS));
    // Registrar para el err_budget del heartbeat (ignora un doble make_layer).
    let _ = GLOBAL_LIMITER.set(limiter.clone());
    RustErrorLayer { tx, limiter }
}

/// Arranca la task drenadora con el AppHandle (desde `setup()` de lib.rs,
/// patrón `mem_sampler::start`). Sin `make_layer()` previo es no-op.
pub fn start(app: tauri::AppHandle) {
    let rx = PENDING_RX.lock().ok().and_then(|mut slot| slot.take());
    let Some(mut rx) = rx else { return };
    tauri::async_runtime::spawn(async move {
        while let Some(payload) = rx.recv().await {
            // Fallo de emit → ignorar. JAMÁS loguear aquí (reentrada).
            let _ = app.emit(crate::events::RUST_ERROR, &payload);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use tracing_subscriber::layer::SubscriberExt;

    /// Layer con canal y limiter propios (aislado de otros tests).
    fn test_layer(capacity: usize, gap_ms: u64) -> (RustErrorLayer, mpsc::Receiver<RustErrorPayload>) {
        let (tx, rx) = mpsc::channel(capacity);
        (
            RustErrorLayer {
                tx,
                limiter: Arc::new(BridgeLimiter::new(MAX_REPORTS_PER_PROCESS, gap_ms)),
            },
            rx,
        )
    }

    #[test]
    fn eventos_bridgeados_de_log_pasan_el_filtro() {
        // Regresión del bug del e2e jul-31: los `log::error!` (LogTracer)
        // llevan metadata.target()=="log" — sin NormalizeEvent el filtro los
        // descartaba TODOS. LogTracer global: init una vez por proceso.
        let _ = tracing_log::LogTracer::init();
        log::set_max_level(log::LevelFilter::Trace);

        let (layer, mut rx) = test_layer(64, 0);
        let subscriber = tracing_subscriber::registry().with(layer);
        tracing::subscriber::with_default(subscriber, || {
            log::error!(target: "app_lib::database::commands", "bridged boom");
            log::error!(target: "frontend", "no debe pasar");
        });

        let got = rx.try_recv().expect("el log::error! bridgeado debe pasar el filtro");
        assert_eq!(got.target, "app_lib::database::commands");
        assert_eq!(got.message, "bridged boom");
        assert!(rx.try_recv().is_err());
    }

    #[test]
    fn matriz_de_filtro_por_target_y_nivel() {
        let (layer, mut rx) = test_layer(64, 0);
        let subscriber = tracing_subscriber::registry().with(layer);
        tracing::subscriber::with_default(subscriber, || {
            tracing::error!(target: "app_lib::audio::worker", "boom uno");
            tracing::error!(target: "app_lib", "boom dos");
            tracing::error!(target: "app_lib2::x", "no debe pasar");
            tracing::error!(target: "frontend", "bucle JS, no debe pasar");
            tracing::error!(target: "tauri::runtime", "tercero, no debe pasar");
            tracing::warn!(target: "app_lib::audio::worker", "warn no pasa");
        });

        let first = rx.try_recv().expect("app_lib::* debe pasar");
        assert_eq!(first.target, "app_lib::audio::worker");
        assert_eq!(first.message, "boom uno");
        assert!(first.ts_ms > 0);
        let second = rx.try_recv().expect("app_lib exacto debe pasar");
        assert_eq!(second.target, "app_lib");
        assert!(rx.try_recv().is_err(), "solo 2 eventos debieron pasar el filtro");
    }

    #[test]
    fn visitor_extrae_mensaje_formateado() {
        let (layer, mut rx) = test_layer(64, 0);
        let subscriber = tracing_subscriber::registry().with(layer);
        tracing::subscriber::with_default(subscriber, || {
            let code = 11;
            tracing::error!(target: "app_lib::db", "malformed (code {})", code);
        });
        assert_eq!(rx.try_recv().unwrap().message, "malformed (code 11)");
    }

    #[test]
    fn limiter_dedup_cap_y_gap() {
        let lim = BridgeLimiter::new(3, 2_000);
        assert!(lim.allows("t", "a", 10_000));
        assert!(!lim.allows("t", "a", 20_000), "dedup por key ya ENVIADA");
        assert!(!lim.allows("t", "b", 10_500), "dentro del gap de 2s");
        // Fix del envenenamiento: el drop por gap NO marca la key como enviada,
        // así que la siguiente ocurrencia de "b" sí sale.
        assert!(lim.allows("t", "b", 13_000), "gap-drop no envenena el dedup");
        assert!(lim.allows("t", "c", 16_000));
        assert!(!lim.allows("t", "d", 30_000), "cap de 3 alcanzado");

        // Contadores: 3 enviados, 1 dedup (a), 1 gap (b@10500), 1 cap (d).
        let budget = lim.budget(0);
        assert_eq!(budget.sent, 3);
        assert_eq!(budget.dropped_dedup, 1);
        assert_eq!(budget.dropped_gap, 1);
        assert_eq!(budget.dropped_cap, 1);
        // Invariante: sent + Σdropped == intentos que llegaron al limiter (6).
        assert_eq!(
            budget.sent + budget.dropped_dedup + budget.dropped_gap + budget.dropped_cap,
            6
        );
        // suppressed_total = ocurrencias no enviadas; top incluye a "t:a" (2 ocurrencias).
        assert_eq!(budget.suppressed_total, 3);
        assert!(budget
            .top_suppressed
            .iter()
            .any(|e| e.key == "t:a" && e.count == 2));
    }

    #[test]
    fn canal_lleno_no_bloquea() {
        // Capacidad 1: el segundo try_send cae al canal lleno y se descarta.
        let (layer, mut rx) = test_layer(1, 0);
        let subscriber = tracing_subscriber::registry().with(layer);
        tracing::subscriber::with_default(subscriber, || {
            tracing::error!(target: "app_lib::a", "primero");
            tracing::error!(target: "app_lib::a", "segundo distinto");
        });
        assert_eq!(rx.try_recv().unwrap().message, "primero");
        assert!(rx.try_recv().is_err(), "el excedente se descarta sin bloquear");
    }

    #[test]
    fn truncado_seguro_utf8() {
        let s = "ñ".repeat(150);
        let t = truncate_chars(&s, 120);
        assert_eq!(t.chars().count(), 120);
    }
}
