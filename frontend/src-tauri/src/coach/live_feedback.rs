//! Motor de feedback en vivo durante la grabación.
//!
//! Suscribe al evento "transcript-update", mantiene rolling window 3 min,
//! corre NudgeEngine (heurístico puro) y TriggerEngine (señales léxicas),
//! llama Ollama gemma3:4b cuando hay señal y emite "coach-tip-update".

use crate::coach::llama_engine;
use crate::coach::nudge_engine::{evaluate_nudge, ConversationSnapshot};
use crate::coach::prompt::{build_user_prompt, MeetingType, COACH_SYSTEM_PROMPT, DEFAULT_TIPS_MODEL};
use crate::coach::trigger::{analyze_turn_with_context, SignalPriority, TurnContext};
use crate::recording_pipeline::get_active_live_feedback_config;
use crate::summary::llm_client::{generate_summary, LLMProvider};
use once_cell::sync::Lazy;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Listener, Manager, Runtime};
use tokio_util::sync::CancellationToken;
#[allow(unused_imports)]
use tracing::{error, info, warn};

// ─── Globals ──────────────────────────────────────────────────────────────────

static CANCEL_TOKEN: Mutex<Option<CancellationToken>> = Mutex::new(None);
static EVENT_LISTENER: Mutex<Option<tauri::EventId>> = Mutex::new(None);

static FEEDBACK_STATE: Lazy<Mutex<Option<Arc<Mutex<FeedbackState>>>>> =
    Lazy::new(|| Mutex::new(None));

static HTTP_CLIENT: Lazy<Client> = Lazy::new(Client::new);

// §1.5.2 % JSON malformado del LLM. Globals para que cualquier path (worker, listener
// directo) pueda contribuir sin pasar el state por todos lados. Reset en start().
static LLM_PARSE_TOTAL: AtomicU64 = AtomicU64::new(0);
static LLM_PARSE_FAILED: AtomicU64 = AtomicU64::new(0);

// ─── Public types (emitted to frontend) ──────────────────────────────────────

/// Payload emitido como evento "coach-tip-update".
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoachTipUpdate {
    pub tip: String,
    pub tip_type: String,
    pub category: String,
    pub priority: String,
    pub confidence: f64,
    pub trigger: Option<String>,
    pub timestamp_secs: u64,
}

// ─── Internal types ───────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
struct TranscriptEntry {
    text: String,
    speaker: String,
    arrived_at: Instant,
}

struct FeedbackState {
    window: VecDeque<TranscriptEntry>,
    session_start: Instant,
    last_tip_at: Option<Instant>,
    last_price_signal_at: Option<Instant>,
    last_nudge_type: Option<String>,
    previous_tips: Vec<String>,
    tip_history: Vec<CoachTipUpdate>,
    user_word_count: u64,
    user_turns: u32,
    interlocutor_turns: u32,
    user_questions: u32,
    longest_mono_secs: u32,
    mono_start: Option<Instant>,
    last_interlocutor_text: Option<String>,
    turn_ctx: TurnContext,
    /// §1.5.1 TTFB primer tip: timestamp del primer tip emitido en la sesion.
    /// None hasta que record_tip() detecta que es el primero. Se emite "coach-metrics"
    /// con ttfb_first_tip_ms en ese momento.
    first_tip_emitted_at: Option<Instant>,
    /// §1.5.3 Sliding window de las ultimas 100 latencias del sidecar Gemma en ms.
    /// Se calcula p95 al cierre de sesion para detectar tail latency. 4b es ~2-4x mas
    /// lento que 1b; si p95 > 6s hay que rever cooldown 20s o considerar 3b como fallback.
    llm_latencies_ms: VecDeque<u64>,
    /// §1.5.4 Contadores de origen de tips. Sweet spot esperado: ~30-50% heuristico.
    /// Si sale 100% LLM, el loop §6 no esta disparando (bug). Si sale 80% heuristico,
    /// las plantillas dominan y el LLM no aporta valor (revisar umbrales o quitar §6).
    tips_from_llm: u32,
    tips_from_heuristic: u32,
}

impl FeedbackState {
    fn new() -> Self {
        Self {
            window: VecDeque::new(),
            session_start: Instant::now(),
            last_tip_at: None,
            last_price_signal_at: None,
            last_nudge_type: None,
            previous_tips: Vec::new(),
            tip_history: Vec::new(),
            user_word_count: 0,
            user_turns: 0,
            interlocutor_turns: 0,
            user_questions: 0,
            longest_mono_secs: 0,
            mono_start: None,
            last_interlocutor_text: None,
            turn_ctx: TurnContext::default(),
            first_tip_emitted_at: None,
            llm_latencies_ms: VecDeque::with_capacity(100),
            tips_from_llm: 0,
            tips_from_heuristic: 0,
        }
    }

    /// §1.5.3 Registra una latencia LLM en la sliding window (cap 100).
    fn push_llm_latency(&mut self, ms: u64) {
        self.llm_latencies_ms.push_back(ms);
        if self.llm_latencies_ms.len() > 100 {
            self.llm_latencies_ms.pop_front();
        }
    }

    /// §1.5.3 Calcula p95 sobre la sliding window de latencias. Devuelve None si vacia.
    fn llm_latency_p95_ms(&self) -> Option<u64> {
        if self.llm_latencies_ms.is_empty() {
            return None;
        }
        let mut sorted: Vec<u64> = self.llm_latencies_ms.iter().copied().collect();
        sorted.sort_unstable();
        let idx = ((sorted.len() as f64) * 0.95) as usize;
        let idx = idx.min(sorted.len() - 1);
        Some(sorted[idx])
    }

    fn session_secs(&self) -> u32 {
        self.session_start.elapsed().as_secs() as u32
    }

    fn user_wpm(&self) -> f32 {
        let mins = self.session_start.elapsed().as_secs_f32() / 60.0;
        if mins < 0.1 {
            0.0
        } else {
            self.user_word_count as f32 / mins
        }
    }

    fn talk_ratio(&self) -> f32 {
        let total = self.user_turns + self.interlocutor_turns;
        if total == 0 {
            0.5
        } else {
            self.user_turns as f32 / total as f32
        }
    }

    /// §1.1 Score de salud de la conversacion (0-100). Empieza en 70.
    /// Bajan: monologos largos, talk_ratio extremo (>80% o <15%), pocas preguntas en
    ///        sesiones largas, profanity detectado en ultimo turno (TurnContext).
    /// Suben: talk_ratio balanceado (40-60%), preguntas, turns interlocutor.
    /// Es algoritmo simple v1 — iterar despues con datos reales (decision §14).
    fn health_score(&self) -> u32 {
        let mut s: i32 = 70;
        let r = self.talk_ratio();
        let session_secs = self.session_secs();

        // Penalizaciones
        if self.longest_mono_secs > 120 {
            s -= 20;
        } else if self.longest_mono_secs > 60 {
            s -= 10;
        }
        if r > 0.80 {
            s -= 15;
        }
        if r < 0.15 && session_secs > 180 {
            // Audience-mode legitimo: usuario escucha a interlocutor activo (>=5 turns).
            // Sin esa condicion penalizamos como conversacion pasiva.
            if self.interlocutor_turns < 5 {
                s -= 10;
            }
        }
        if self.user_questions == 0 && session_secs > 300 {
            s -= 10;
        }
        // NOTA: profanity penalization (§1.1) aplazado — TurnContext aun no expone
        // profanity_detected; trigger.rs solo lo emite como signal. Sumar en V2 cuando
        // tengamos TurnContext.profanity_detected o un last_signal cacheado en FeedbackState.

        // Bonificaciones
        if r >= 0.40 && r <= 0.60 {
            s += 5;
        }
        if self.user_turns > 0 {
            let q_ratio = self.user_questions as f32 / self.user_turns as f32;
            if q_ratio > 0.20 {
                s += 10;
            }
        }
        if self.interlocutor_turns >= 3 {
            s += 5;
        }

        s.clamp(0, 100) as u32
    }

    fn can_emit(&self, critical: bool) -> bool {
        // §5.3 Hard cap: maximo 6 tips por minuto, red de seguridad sin importar otras condiciones.
        // Con cooldown 20s el limite teorico de un solo trigger es 3 tips/min; 6 deja margen 2x
        // para cuando sumemos triggers adicionales (heuristico 3s en Fase 3). El usuario percibe
        // "coach atento" sin spam.
        let now_secs = self.session_secs() as u64;
        let cutoff = now_secs.saturating_sub(60);
        let recent = self
            .tip_history
            .iter()
            .filter(|t| t.timestamp_secs >= cutoff)
            .count();
        if recent >= 6 {
            return false;
        }

        // Post-price/objection suppression: 8s de silencio para no interrumpir negociación
        if let Some(t) = self.last_price_signal_at {
            if t.elapsed() < Duration::from_secs(8) {
                return false;
            }
        }
        // §5.2 Cooldown realista: critical 15s, primer minuto 30s, sesion madura 20s.
        // Antes era 30s/120s — el 120s madura ahogaba la cadencia (1 tip cada 2 min).
        // 20s nos deja margen para coexistir con nudge §5.6 (15s) y futuro heuristico §6 (3s).
        let session_secs = self.session_start.elapsed().as_secs();
        let gap = if critical {
            Duration::from_secs(15)
        } else if session_secs < 60 {
            Duration::from_secs(30)
        } else {
            Duration::from_secs(20)
        };
        self.last_tip_at.map_or(true, |t| t.elapsed() >= gap)
    }

    fn prune(&mut self, window_secs: u32) {
        let cutoff = Duration::from_secs(window_secs as u64);
        while self
            .window
            .front()
            .map_or(false, |e| e.arrived_at.elapsed() > cutoff)
        {
            self.window.pop_front();
        }
    }

    fn window_text(&self) -> String {
        self.window
            .iter()
            .map(|e| {
                let label = if e.speaker == "user" {
                    "USUARIO"
                } else {
                    "INTERLOCUTOR"
                };
                format!("{}: {}", label, e.text)
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    fn snapshot(&self) -> ConversationSnapshot {
        ConversationSnapshot {
            user_talk_ratio: self.talk_ratio(),
            user_questions: self.user_questions,
            session_duration_sec: self.session_secs(),
            user_wpm: self.user_wpm(),
            longest_user_monologue_sec: self.longest_mono_secs,
            health_score: self.health_score(),
            last_nudge_type: self.last_nudge_type.clone(),
        }
    }

    /// §1.5.1 Marca el primer tip emitido y devuelve el TTFB en ms si fue el primero.
    /// Devuelve None si ya habia sido marcado en esta sesion.
    fn mark_first_tip_if_needed(&mut self) -> Option<u128> {
        if self.first_tip_emitted_at.is_some() {
            return None;
        }
        let elapsed_ms = self.session_start.elapsed().as_millis();
        self.first_tip_emitted_at = Some(Instant::now());
        Some(elapsed_ms)
    }

    fn record_tip(&mut self, update: CoachTipUpdate) {
        self.last_tip_at = Some(Instant::now());

        // Dedup semantico: previous_tips es la fuente de verdad para Jaccard §4.2.
        // No usamos HashSet exact-match porque el LLM genera parafrasis y la comparacion
        // caracter-por-caracter las acepta como distintas; Jaccard sobre tokens >2 chars
        // las atrapa.
        self.previous_tips.push(update.tip.clone());
        if self.previous_tips.len() > 10 {
            self.previous_tips.remove(0);
        }
        self.tip_history.push(update);
        // Cap 100 (mas alto que los 20 originales) para que el hard cap §5.3 cuente de forma
        // confiable los tips del ultimo minuto. El frontend muestra solo los ultimos 50.
        if self.tip_history.len() > 100 {
            self.tip_history.remove(0);
        }
    }
}

// §4.2 Dedup Jaccard 0.85 sobre ultimos 5 tips ────────────────────────────────
//
// Por que 0.85 sobre 5: ventana suficiente para atrapar parafrasis recientes sin
// descartar ideas legitimas que se repiten 30 min despues. 0.85 tolera reformulaciones
// leves (articulos, conectores) pero atrapa "que te preocupa" vs "que es lo que te preocupa".
// Filtramos tokens <=2 chars para que sea sobre contenido semantico, no estructura sintactica.

const TIP_DEDUP_THRESHOLD: f32 = 0.85;
const TIP_DEDUP_WINDOW: usize = 5;

fn tip_similarity(a: &str, b: &str) -> f32 {
    let normalize = |s: &str| {
        s.to_lowercase()
            .split_whitespace()
            .filter(|t| t.len() > 2)
            .map(String::from)
            .collect::<std::collections::HashSet<String>>()
    };
    let ta = normalize(a);
    let tb = normalize(b);
    if ta.is_empty() || tb.is_empty() {
        return 0.0;
    }
    let inter = ta.intersection(&tb).count() as f32;
    let union = ta.union(&tb).count() as f32;
    if union == 0.0 {
        0.0
    } else {
        inter / union
    }
}

fn is_duplicate_tip(candidate: &str, previous: &[String]) -> bool {
    previous
        .iter()
        .rev()
        .take(TIP_DEDUP_WINDOW)
        .any(|prev| tip_similarity(prev, candidate) >= TIP_DEDUP_THRESHOLD)
}

// ─── Inbound event payload ────────────────────────────────────────────────────

#[derive(Deserialize)]
struct TranscriptPayload {
    text: String,
    is_partial: bool,
    source_type: Option<String>,
}

// ─── Ollama response parsing ──────────────────────────────────────────────────

#[derive(Deserialize, Default)]
struct GemmaCoachJson {
    tip: Option<String>,
    tip_type: Option<String>,
    category: Option<String>,
    priority: Option<String>,
    confidence: Option<f64>,
}

// ─── Public API ───────────────────────────────────────────────────────────────

/// Inicia el motor de feedback en vivo. Llamar justo después de "recording-started".
pub async fn start<R: Runtime + 'static>(app: AppHandle<R>) -> Result<(), String> {
    // Detener sesión anterior si existe
    stop(&app);

    // §1.5.5 Reset de contadores globales por sesion.
    // FeedbackState::new() resetea los campos del state mas abajo automaticamente.
    LLM_PARSE_TOTAL.store(0, Ordering::Relaxed);
    LLM_PARSE_FAILED.store(0, Ordering::Relaxed);

    // Leer config del pipeline activo
    let cfg = get_active_live_feedback_config(&app).await;
    let configured_model = cfg
        .as_ref()
        .map(|c| c.model.clone())
        .unwrap_or_else(|| DEFAULT_TIPS_MODEL.to_string());
    // Endpoint conceptual: el sidecar BuiltInAI (singleton SidecarManager) gestionado
    // por summary::summary_engine. No hay HTTP, lo deja solo para logging compatible.
    let endpoint = "builtin-ai-sidecar".to_string();

    // Resolver el modelo efectivo: el configurado si está descargado, sino auto-detect.
    // Prioridad: Gemma 4B (default actual) → Gemma 1B → otros instalados.
    let model = {
        use crate::coach::model_registry;
        use crate::state::AppState;
        use tauri::Manager as _;

        let from_db = if let Some(state) = app.try_state::<AppState>() {
            let pool = state.db_manager.pool();
            sqlx::query_scalar::<_, String>(
                "SELECT tips_model_id FROM coach_settings WHERE id = '1'",
            )
            .fetch_optional(pool)
            .await
            .ok()
            .flatten()
        } else {
            None
        };

        let candidates: Vec<String> = std::iter::empty::<String>()
            .chain(from_db.into_iter())
            .chain(std::iter::once(configured_model.clone()))
            // §4.1 Eliminar 1b de candidatos: unificamos a 4b (% JSON malformado ~33% -> ~10%).
            .chain(["gemma3-4b-q4", "qwen25-3b-q4"].iter().map(|s| s.to_string()))
            .collect();

        let installed = candidates
            .iter()
            .find(|id| {
                model_registry::get_model(id).is_some()
                    && llama_engine::is_model_installed(&app, id)
                    && !llama_engine::map_to_builtin_id(id).is_empty()
            })
            .cloned()
            .unwrap_or_else(|| DEFAULT_TIPS_MODEL.to_string());

        let model_path = llama_engine::model_file_path(&app, &installed);
        let model_ok = model_path.as_ref().map(|p| p.exists()).unwrap_or(false);
        info!(
            "🔍 Coach model '{}': {:?} (exists={})",
            installed, model_path, model_ok
        );

        if !model_ok {
            warn!(
                "Coach: modelo '{}' no instalado — tips deshabilitados",
                installed
            );
        }

        installed
    };
    let window_secs = cfg.as_ref().map(|c| c.context_window_secs).unwrap_or(180);
    // §5.6 Default 15s (antes 45s). El nudge loop evalua talk_ratio/monologo/preguntas y
    // dispara tips de pacing. A 45s se pierden monologos cortos: si el usuario empieza a
    // monologar en el segundo 5, no recibe tip "haz pausa, pregunta" hasta el segundo 50.
    // A 15s detectamos a tiempo sin saturar (cooldown 20s evita LLM calls innecesarios).
    let interval_secs = cfg.as_ref().map(|c| c.interval_secs).unwrap_or(15);

    let token = CancellationToken::new();
    if let Ok(mut lock) = CANCEL_TOKEN.lock() {
        *lock = Some(token.clone());
    }

    let state = Arc::new(Mutex::new(FeedbackState::new()));
    if let Ok(mut lock) = FEEDBACK_STATE.lock() {
        *lock = Some(Arc::clone(&state));
    }

    // ── Listener de transcripciones ───────────────────────────────────────────
    let state_ev = Arc::clone(&state);
    let app_ev = app.clone();
    let model_ev = model.clone();
    let endpoint_ev = endpoint.clone();
    let token_ev = token.clone();

    let listener_id = app.listen("transcript-update", move |event| {
        let Ok(payload) = serde_json::from_str::<TranscriptPayload>(event.payload()) else {
            warn!("🪲 Coach: payload transcript-update inválido");
            return;
        };
        if payload.is_partial || payload.text.trim().is_empty() {
            return;
        }
        info!(
            "📥 Coach listener received: speaker={:?}, words={}",
            payload.source_type,
            payload.text.split_whitespace().count()
        );

        let speaker = payload
            .source_type
            .as_deref()
            .unwrap_or("user")
            .to_string();

        // Extraer datos bajo el mutex y decidir si llamar a Ollama
        let task = {
            let Ok(mut st) = state_ev.lock() else { return };

            // Actualizar métricas conversacionales
            if speaker == "user" {
                st.user_turns += 1;
                st.user_word_count += payload.text.split_whitespace().count() as u64;
                if payload.text.contains('?') {
                    st.user_questions += 1;
                }
                if st.mono_start.is_none() {
                    st.mono_start = Some(Instant::now());
                }
                if let Some(s) = st.mono_start {
                    let mono = s.elapsed().as_secs() as u32;
                    if mono > st.longest_mono_secs {
                        st.longest_mono_secs = mono;
                    }
                }
            } else {
                st.interlocutor_turns += 1;
                st.last_interlocutor_text = Some(payload.text.clone());
                st.mono_start = None;
            }

            st.window.push_back(TranscriptEntry {
                text: payload.text.clone(),
                speaker: speaker.clone(),
                arrived_at: Instant::now(),
            });
            st.prune(window_secs);

            st.turn_ctx.last_speaker = Some(speaker.clone());
            st.turn_ctx.total_turns += 1;
            if speaker == "user" {
                st.turn_ctx.consecutive_user_turns += 1;
            } else {
                st.turn_ctx.consecutive_user_turns = 0;
            }

            // Detectar señales heurísticas (microsegundos, sin LLM)
            let last_interlocutor = st.last_interlocutor_text.clone();
            let signals = analyze_turn_with_context(
                &payload.text,
                &speaker,
                st.session_secs(),
                &st.turn_ctx.clone(),
                last_interlocutor.as_deref(),
            );

            // Suprimir 8s después de señal de precio/objeción para no interrumpir negociación
            let has_price_or_objection = signals.iter().any(|s| {
                s.signal_id.contains("price") || s.signal_id.contains("objection")
            });
            if has_price_or_objection {
                st.last_price_signal_at = Some(Instant::now());
            }

            // §5.1 Destrabar listener: aceptar critical+important siempre, soft solo si pasaron 35s
            // Antes solo critical pasaba el filtro, ahogando el 90% de señales útiles (price,
            // objection, hesitation, satisfaction, enthusiasm) que vienen como Important.
            let has_actionable = signals.iter().any(|s| {
                matches!(
                    s.priority,
                    SignalPriority::Critical | SignalPriority::Important
                )
            });
            let has_soft_aged = signals
                .iter()
                .any(|s| matches!(s.priority, SignalPriority::Soft))
                && st
                    .last_tip_at
                    .map_or(true, |t| t.elapsed() >= Duration::from_secs(35));

            if !(has_actionable || has_soft_aged) {
                return;
            }
            let is_critical = signals
                .iter()
                .any(|s| matches!(s.priority, SignalPriority::Critical));
            if !st.can_emit(is_critical) {
                return;
            }

            // Bloquear el rate-limit optimístamente antes de hacer el spawn
            st.last_tip_at = Some(Instant::now());
            let signal_id = signals.into_iter().next().map(|s| s.signal_id);
            Some((
                st.window_text(),
                st.session_secs(),
                st.previous_tips.clone(),
                signal_id,
            ))
        };

        if let Some((window_text, session_secs, prev_tips, signal_id)) = task {
            let app2 = app_ev.clone();
            let state2 = Arc::clone(&state_ev);
            let model2 = model_ev.clone();
            let endpoint2 = endpoint_ev.clone();
            let token2 = token_ev.clone();
            tokio::spawn(async move {
                call_ollama_and_emit(
                    &app2,
                    &state2,
                    window_text,
                    session_secs,
                    prev_tips,
                    signal_id,
                    &model2,
                    &endpoint2,
                    token2,
                )
                .await;
            });
        }
    });

    if let Ok(mut lock) = EVENT_LISTENER.lock() {
        *lock = Some(listener_id);
    }

    // ── Loop de nudge (NudgeEngine, sin LLM) ─────────────────────────────────
    let state_bg = Arc::clone(&state);
    let app_bg = app.clone();
    let token_bg = token.clone();
    let model_bg = model.clone();
    let endpoint_bg = endpoint.clone();

    tokio::spawn(async move {
        info!(
            "🎯 Coach nudge loop started (interval={}s, window={}s)",
            interval_secs, window_secs
        );
        let mut ticker =
            tokio::time::interval(Duration::from_secs(interval_secs as u64));
        ticker.tick().await; // descartar primer tick inmediato

        loop {
            tokio::select! {
                _ = ticker.tick() => {
                    let task = {
                        let Ok(mut st) = state_bg.lock() else { continue };
                        st.prune(window_secs);
                        let win_len = st.window.len();
                        let can_em = st.can_emit(false);
                        if st.window.is_empty() || !can_em {
                            info!(
                                "⏰ Nudge tick @ {}s — skip (window={}, can_emit={})",
                                st.session_secs(), win_len, can_em
                            );
                            None
                        } else {
                            let snap = st.snapshot();
                            let nudge = evaluate_nudge(&snap);
                            info!(
                                "⏰ Nudge tick @ {}s — window={}, ratio={:.2}, mono={}s, q={}, health={}, should_nudge={} ({:?})",
                                snap.session_duration_sec, win_len, snap.user_talk_ratio,
                                snap.longest_user_monologue_sec, snap.user_questions, snap.health_score,
                                nudge.should_nudge, nudge.nudge_type
                            );
                            if !nudge.should_nudge {
                                None
                            } else {
                                let nudge_type_str = nudge
                                    .nudge_type
                                    .as_ref()
                                    .map(|n| format!("{:?}", n));
                                // Bloquear rate-limit antes de salir del mutex
                                st.last_tip_at = Some(Instant::now());
                                st.last_nudge_type = nudge_type_str.clone();
                                Some((
                                    nudge.tip,
                                    nudge.category.clone(),
                                    nudge.severity.clone(),
                                    nudge_type_str,
                                    st.window_text(),
                                    st.session_secs(),
                                    st.previous_tips.clone(),
                                    snap.session_duration_sec,
                                ))
                            }
                        }
                    };

                    let Some((nudge_tip, category, severity, trigger_str, window_text, session_secs, prev_tips, dur)) = task else {
                        continue;
                    };

                    if let Some(tip_text) = nudge_tip {
                        // Tip heurístico listo — no necesita Ollama
                        let update = CoachTipUpdate {
                            tip: tip_text,
                            tip_type: "observation".to_string(),
                            category,
                            priority: severity,
                            confidence: 0.9,
                            trigger: trigger_str,
                            timestamp_secs: dur as u64,
                        };
                        let _ = app_bg.emit("coach-tip-update", &update);
                        let ttfb_ms = if let Ok(mut st) = state_bg.lock() {
                            let ttfb = st.mark_first_tip_if_needed();
                            st.tips_from_heuristic += 1; // §1.5.4 nudge predefinido = heuristico
                            st.record_tip(update);
                            ttfb
                        } else {
                            None
                        };
                        if let Some(ms) = ttfb_ms {
                            info!("[METRIC] TTFB primer tip: {}ms", ms);
                            let _ = app_bg.emit(
                                "coach-metrics",
                                serde_json::json!({ "ttfb_first_tip_ms": ms as u64 }),
                            );
                        }
                    } else {
                        // Nudge sin tip predefinido → llamar a Ollama
                        call_ollama_and_emit(
                            &app_bg,
                            &state_bg,
                            window_text,
                            session_secs,
                            prev_tips,
                            trigger_str,
                            &model_bg,
                            &endpoint_bg,
                            token_bg.clone(),
                        )
                        .await;
                    }
                }
                _ = token_bg.cancelled() => {
                    info!("🛑 Coach nudge loop cancelled");
                    break;
                }
            }
        }
    });

    // ── §6 Loop heuristico cada 3s (tips directos sin LLM) ───────────────────
    // Reutiliza can_emit (cooldown + hard cap §5.3) y dedup §4.2 (is_duplicate_tip).
    // Cubre los casos urgentes/extremos donde la latencia LLM (2-4s) es inaceptable.
    let state_he = Arc::clone(&state);
    let app_he = app.clone();
    let token_he = token.clone();
    tokio::spawn(async move {
        info!("🎯 Coach heuristic loop started (interval=3s)");
        let mut ticker = tokio::time::interval(Duration::from_secs(3));
        ticker.tick().await; // descartar primer tick inmediato

        loop {
            tokio::select! {
                _ = ticker.tick() => {
                    let task = {
                        let Ok(mut st) = state_he.lock() else { continue };
                        if st.window.is_empty() {
                            // Sin actividad aun -> no evaluar; ahorra logs ruidosos al inicio.
                            None
                        } else {
                            let snap = st.snapshot();
                            match evaluate_health_tips(&snap) {
                                None => None,
                                Some(h) => {
                                    let is_critical = h.priority == "critical";
                                    if !st.can_emit(is_critical) {
                                        None
                                    } else if is_duplicate_tip(h.tip, &st.previous_tips) {
                                        None
                                    } else {
                                        // Bloquear rate-limit antes de emit.
                                        st.last_tip_at = Some(Instant::now());
                                        Some((h, snap.session_duration_sec))
                                    }
                                }
                            }
                        }
                    };

                    let Some((h, dur)) = task else { continue };
                    let update = CoachTipUpdate {
                        tip: h.tip.to_string(),
                        tip_type: "observation".to_string(),
                        category: h.category.to_string(),
                        priority: h.priority.to_string(),
                        confidence: 1.0, // textos curados, alta confianza
                        trigger: Some(h.trigger.to_string()),
                        timestamp_secs: dur as u64,
                    };
                    let _ = app_he.emit("coach-tip-update", &update);
                    info!(
                        "[heuristic] tip directo emitido: trigger={} priority={}",
                        h.trigger, h.priority
                    );
                    let ttfb_ms = if let Ok(mut st) = state_he.lock() {
                        let ttfb = st.mark_first_tip_if_needed();
                        st.tips_from_heuristic += 1; // §1.5.4 ratio
                        st.record_tip(update);
                        ttfb
                    } else {
                        None
                    };
                    if let Some(ms) = ttfb_ms {
                        info!("[METRIC] TTFB primer tip: {}ms (heuristic)", ms);
                        let _ = app_he.emit(
                            "coach-metrics",
                            serde_json::json!({ "ttfb_first_tip_ms": ms as u64 }),
                        );
                    }
                }
                _ = token_he.cancelled() => {
                    info!("🛑 Coach heuristic loop cancelled");
                    break;
                }
            }
        }
    });

    info!(
        "✅ Live feedback started (model={}, endpoint={})",
        model, endpoint
    );
    Ok(())
}

/// Detiene el motor de feedback en vivo. Llamar cuando se detiene la grabación.
pub fn stop<R: Runtime>(app: &AppHandle<R>) {
    if let Ok(mut lock) = CANCEL_TOKEN.lock() {
        if let Some(token) = lock.take() {
            token.cancel();
        }
    }
    if let Ok(mut lock) = EVENT_LISTENER.lock() {
        if let Some(id) = lock.take() {
            app.unlisten(id);
        }
    }

    // §1.5.2 + §1.5.3 + §1.5.4 Emit summary de metricas al cierre de sesion.
    let parse_total = LLM_PARSE_TOTAL.load(Ordering::Relaxed);
    let parse_failed = LLM_PARSE_FAILED.load(Ordering::Relaxed);
    let (p95_ms, tips_llm, tips_heur) = if let Ok(outer) = FEEDBACK_STATE.lock() {
        match outer.as_ref().and_then(|arc| arc.lock().ok()) {
            Some(s) => (s.llm_latency_p95_ms(), s.tips_from_llm, s.tips_from_heuristic),
            None => (None, 0, 0),
        }
    } else {
        (None, 0, 0)
    };
    let parse_failed_pct = if parse_total > 0 {
        (parse_failed as f64 / parse_total as f64) * 100.0
    } else {
        0.0
    };
    let total_tips = tips_llm + tips_heur;
    let heur_pct = if total_tips > 0 {
        (tips_heur as f64 / total_tips as f64) * 100.0
    } else {
        0.0
    };
    info!(
        "[METRIC] session-summary llm_parse_total={} llm_parse_failed={} ({:.1}%) llm_latency_p95_ms={:?} tips_from_llm={} tips_from_heuristic={} heuristic_pct={:.1}%",
        parse_total, parse_failed, parse_failed_pct, p95_ms, tips_llm, tips_heur, heur_pct
    );
    let _ = app.emit(
        "coach-metrics",
        serde_json::json!({
            "session_summary": {
                "llm_parse_total": parse_total,
                "llm_parse_failed": parse_failed,
                "llm_parse_failed_pct": parse_failed_pct,
                "llm_latency_p95_ms": p95_ms,
                "tips_from_llm": tips_llm,
                "tips_from_heuristic": tips_heur,
                "heuristic_pct": heur_pct,
            }
        }),
    );

    if let Ok(mut lock) = FEEDBACK_STATE.lock() {
        *lock = None;
    }
    info!("🛑 Live feedback stopped");
}

// ─── Llamada a Ollama ─────────────────────────────────────────────────────────

async fn call_ollama_and_emit<R: Runtime>(
    app: &AppHandle<R>,
    state: &Arc<Mutex<FeedbackState>>,
    window_text: String,
    session_secs: u32,
    previous_tips: Vec<String>,
    trigger: Option<String>,
    model: &str,
    _endpoint: &str,
    cancel: CancellationToken,
) {
    let minute = session_secs / 60;
    let user_prompt = build_user_prompt(
        &window_text,
        MeetingType::Auto,
        minute,
        &previous_tips,
        trigger.as_deref(),
    );

    let app_data_dir = match app.path().app_data_dir() {
        Ok(p) => p,
        Err(e) => {
            warn!("Coach: no se pudo obtener app_data_dir: {}", e);
            if let Ok(mut st) = state.lock() {
                st.last_tip_at = None;
            }
            return;
        }
    };

    let builtin_model = llama_engine::map_to_builtin_id(model);
    info!(
        "🦙 Coach calling sidecar: model={} (builtin={}), prompt_len={} chars",
        model, builtin_model, user_prompt.len()
    );

    // Retry on parse failure: Gemma 4B Q4 ocasionalmente genera JSON malformado
    // (sobre todo con prompts largos). Reintentar baja la tasa de fallo de ~33% a ~5%.
    // No reintentamos en errores de generate (red/timeout) porque generate_summary
    // ya tiene su propia lógica interna y reintentarlo es más costoso.
    const MAX_PARSE_ATTEMPTS: u32 = 2;
    let mut update: Option<CoachTipUpdate> = None;
    let mut last_raw: Option<String> = None;

    for attempt in 1..=MAX_PARSE_ATTEMPTS {
        // §1.5.3 Medir latencia LLM por llamada para sliding window p95.
        let llm_start = Instant::now();
        let result = generate_summary(
            &HTTP_CLIENT,
            &LLMProvider::BuiltInAI,
            builtin_model,
            "",
            COACH_SYSTEM_PROMPT,
            &user_prompt,
            None,
            None,
            Some(200),       // max_tokens — tips son cortos, evita timeout en CPU
            Some(0.3),
            None,
            Some(&app_data_dir),
            Some(&cancel),
        )
        .await;
        let latency_ms = llm_start.elapsed().as_millis() as u64;

        match result {
            Ok(raw) => {
                if let Ok(mut st) = state.lock() {
                    st.push_llm_latency(latency_ms);
                }
                // §1.5.2 Contar parse total/failed para % JSON malformado.
                let total = LLM_PARSE_TOTAL.fetch_add(1, Ordering::Relaxed) + 1;
                if let Some(parsed) = parse_gemma_response(&raw, trigger.as_deref(), session_secs) {
                    update = Some(parsed);
                    break;
                }
                let failed = LLM_PARSE_FAILED.fetch_add(1, Ordering::Relaxed) + 1;
                let pct = (failed as f64 / total.max(1) as f64) * 100.0;
                warn!(
                    "[METRIC] LLM JSON malformed {}/{} ({:.1}%). intento {}/{}, raw preview: {}",
                    failed,
                    total,
                    pct,
                    attempt,
                    MAX_PARSE_ATTEMPTS,
                    &raw[..raw.len().min(120)]
                );
                last_raw = Some(raw);
            }
            Err(e) => {
                warn!("Coach LLM call failed: {}", e);
                if let Ok(mut st) = state.lock() {
                    st.last_tip_at = None;
                }
                return;
            }
        }
    }

    let Some(update) = update else {
        warn!(
            "Coach: parse JSON falló tras {} intentos — descartando tick",
            MAX_PARSE_ATTEMPTS
        );
        if let Ok(mut st) = state.lock() {
            st.last_tip_at = None;
        }
        let _ = last_raw; // suppress unused
        return;
    };

    // §4.2 Dedup Jaccard 0.85 contra ultimos 5 previous_tips. Atrapa parafrasis del LLM
    // que el dedup exact-match anterior dejaba pasar.
    let is_dup = state
        .lock()
        .map(|s| is_duplicate_tip(&update.tip, &s.previous_tips))
        .unwrap_or(false);
    if is_dup {
        warn!("Coach: tip duplicado descartado (Jaccard >= 0.85)");
        return;
    }
    let _ = app.emit("coach-tip-update", &update);
    info!("💡 Coach tip emitted: {}", update.tip);
    let ttfb_ms = if let Ok(mut st) = state.lock() {
        let ttfb = st.mark_first_tip_if_needed();
        st.tips_from_llm += 1; // §1.5.4 ratio LLM vs heuristico
        st.record_tip(update);
        ttfb
    } else {
        None
    };
    if let Some(ms) = ttfb_ms {
        info!("[METRIC] TTFB primer tip: {}ms", ms);
        let _ = app.emit(
            "coach-metrics",
            serde_json::json!({ "ttfb_first_tip_ms": ms as u64 }),
        );
    }
}

fn is_quality_tip(tip: &CoachTipUpdate) -> bool {
    // Descartar tips con confianza demasiado baja
    if tip.confidence < 0.3 {
        return false;
    }
    // Descartar jerga abstracta — tips sin frase concreta
    const BLOCKLIST: &[&str] = &[
        "empatiza", "rapport", "spin", "latte", "heard", "framework",
        "conecta", "escucha activa", "meddpicc", "genera confianza",
    ];
    let lower = tip.tip.to_lowercase();
    if BLOCKLIST.iter().any(|w| lower.contains(w)) {
        return false;
    }
    // Tips correctivos/observacionales deben incluir frase textual (comilla o dos puntos)
    if matches!(tip.tip_type.as_str(), "corrective" | "observation") {
        if !tip.tip.contains('\'') && !tip.tip.contains(':') {
            return false;
        }
    }
    true
}

fn parse_gemma_response(
    raw: &str,
    trigger: Option<&str>,
    session_secs: u32,
) -> Option<CoachTipUpdate> {
    let json_str = extract_json(raw)?;
    let parsed: GemmaCoachJson = serde_json::from_str(&json_str).ok()?;
    let tip = parsed.tip?.trim().to_string();
    if tip.is_empty() {
        return None;
    }
    let update = CoachTipUpdate {
        tip,
        tip_type: parsed
            .tip_type
            .unwrap_or_else(|| "observation".to_string()),
        category: parsed.category.unwrap_or_else(|| "pacing".to_string()),
        priority: parsed.priority.unwrap_or_else(|| "soft".to_string()),
        confidence: parsed.confidence.unwrap_or(0.5),
        trigger: trigger.map(str::to_string),
        timestamp_secs: session_secs as u64,
    };
    if !is_quality_tip(&update) {
        warn!("Coach: tip descartado por filtro de calidad (confidence={:.2}, tip='{}')", update.confidence, update.tip);
        return None;
    }
    Some(update)
}

/// Devuelve el historial de tips de la sesión activa (para `coach_get_session_tips`).
pub fn get_session_tips() -> Vec<CoachTipUpdate> {
    let Ok(outer) = FEEDBACK_STATE.lock() else { return Vec::new(); };
    let Some(ref arc) = *outer else { return Vec::new(); };
    let Ok(state) = arc.lock() else { return Vec::new(); };
    state.tip_history.clone()
}

fn extract_json(text: &str) -> Option<String> {
    let text = text.trim();
    if text.starts_with('{') {
        return Some(text.to_string());
    }
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    if end > start {
        Some(text[start..=end].to_string())
    } else {
        None
    }
}

// §6 Loop heuristico 3s — tips directos sin LLM ──────────────────────────────
//
// Inspiracion: Effect 5 de CoachContext.tsx de Poncho. Cada 3s recalcula health_score
// y, cuando cae a zonas criticas, emite tips hardcoded en <10ms sin pasar por el
// sidecar Gemma. Cubre los casos urgentes/extremos donde la latencia LLM (~2-4s)
// es inaceptable. Reutiliza can_emit() (cooldown + hard cap §5.3) y dedup §4.2.

#[derive(Debug, Clone)]
struct HeuristicTip {
    tip: &'static str,
    category: &'static str,
    priority: &'static str,
    trigger: &'static str,
}

/// Evalua snapshot conversacional y devuelve un tip hardcoded si cae en zona critica.
/// Orden de prioridad: monologo en curso > health <= 10 > health <= 25 > health <= 40
/// > talk_ratio > 0.85. Solo emite uno por tick (el primero que matche).
fn evaluate_health_tips(snap: &ConversationSnapshot) -> Option<HeuristicTip> {
    // Monologo en curso > 90s — critico, dispara antes que health.
    if snap.longest_user_monologue_sec > 90 {
        return Some(HeuristicTip {
            tip: "Llevas más de 1.5 min hablando. Haz una pausa.",
            category: "pacing",
            priority: "critical",
            trigger: "heuristic_monologue_long",
        });
    }
    // Health <= 10 — urgente.
    if snap.health_score <= 10 {
        return Some(HeuristicTip {
            tip: "Atención: la conversación necesita mejorar urgentemente. Pregúntale: '¿cómo te sientes con lo que hemos hablado hasta ahora?'",
            category: "service",
            priority: "critical",
            trigger: "heuristic_health_critical",
        });
    }
    // Health <= 25 — perdiendo conexion.
    if snap.health_score <= 25 {
        return Some(HeuristicTip {
            tip: "Estás perdiendo conexión. Haz una pausa y pregunta: '¿esto te está haciendo sentido?'",
            category: "rapport",
            priority: "important",
            trigger: "heuristic_health_low",
        });
    }
    // Health <= 40 — ritmo no fluye.
    if snap.health_score <= 40 {
        return Some(HeuristicTip {
            tip: "El ritmo no está fluyendo. Cambia de tema o haz una pregunta abierta.",
            category: "pacing",
            priority: "important",
            trigger: "heuristic_health_pacing",
        });
    }
    // Dominancia > 0.85 con sesion > 90s.
    if snap.user_talk_ratio > 0.85 && snap.session_duration_sec > 90 {
        return Some(HeuristicTip {
            tip: "Estás dominando la conversación. Pregúntale: '¿qué piensas tú sobre esto?'",
            category: "listening",
            priority: "important",
            trigger: "heuristic_dominance",
        });
    }
    None
}

// ─── Tests ────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;

    fn make_tip(secs: u64, text: &str) -> CoachTipUpdate {
        CoachTipUpdate {
            tip: text.to_string(),
            tip_type: "observation".to_string(),
            category: "pacing".to_string(),
            priority: "soft".to_string(),
            confidence: 0.7,
            trigger: None,
            timestamp_secs: secs,
        }
    }

    // §4.2 tip_similarity / is_duplicate_tip ──────────────────────────────────

    #[test]
    fn jaccard_atrapa_parafrasis_leves() {
        // Reformulacion mínima (1 palabra extra al final) sobre frase larga: jaccard >=0.85.
        // Atrapa el patron tipico del LLM repitiendo el mismo consejo con un detalle agregado.
        let a = "preguntale que piensa sobre esto y por que";
        let b = "preguntale que piensa sobre esto y por que importa";
        let sim = tip_similarity(a, b);
        assert!(sim >= 0.85, "esperaba >=0.85, got {}", sim);
    }

    #[test]
    fn jaccard_separa_ideas_distintas() {
        // Tips con tema completamente distinto deben quedar lejos del umbral.
        let a = "Llevas más de un minuto hablando, haz pausa";
        let b = "Pregúntale por su presupuesto disponible";
        let sim = tip_similarity(a, b);
        assert!(sim < 0.85, "esperaba <0.85, got {}", sim);
    }

    #[test]
    fn jaccard_ignora_tokens_cortos() {
        // Tokens <= 2 chars (es, lo, de, a, el) no aportan al score.
        let a = "Es bueno escuchar más al cliente";
        let b = "bueno escuchar al cliente más";
        let sim = tip_similarity(a, b);
        // Con tokens cortos filtrados ambos sets son {bueno, escuchar, más, cliente},
        // identicos -> similarity == 1.0
        assert!(sim >= 0.99, "esperaba ~1.0, got {}", sim);
    }

    #[test]
    fn is_duplicate_tip_solo_revisa_ventana_5() {
        let mut prev = vec![
            "tip viejo lejano sin relacion alguna".to_string(),
        ];
        // Agregamos 5 tips intermedios distintos para que el "viejo" salga de la ventana.
        for i in 0..5 {
            prev.push(format!("intermedio numero {} sobre cosas distintas", i));
        }
        // Candidate identico al viejo, pero el viejo ya no esta en los ultimos 5.
        let candidate = "tip viejo lejano sin relacion alguna";
        assert!(
            !is_duplicate_tip(candidate, &prev),
            "no debe marcar duplicado si esta fuera de la ventana 5"
        );
    }

    #[test]
    fn is_duplicate_tip_marca_dentro_ventana() {
        let prev = vec![
            "uno dos tres cuatro cinco seis siete".to_string(),
            "uno dos tres cuatro cinco seis siete ocho".to_string(),
        ];
        let candidate = "uno dos tres cuatro cinco seis siete";
        assert!(
            is_duplicate_tip(candidate, &prev),
            "debe marcar duplicado: identico al ultimo"
        );
    }

    // §5.3 hard cap 6/min ─────────────────────────────────────────────────────

    #[test]
    fn hard_cap_bloquea_a_partir_del_sexto_tip_en_60s() {
        let mut st = FeedbackState::new();
        // Simulamos sesion en t=120s. timestamp_secs >= 60 cae dentro del minuto.
        // Como session_secs() depende de session_start (Instant real) y no podemos
        // viajar en el tiempo, ajustamos session_start hacia atras:
        st.session_start = Instant::now() - Duration::from_secs(120);
        for i in 0..6 {
            st.tip_history.push(make_tip(80 + i, &format!("tip #{}", i)));
        }
        assert!(
            !st.can_emit(false),
            "con 6 tips en el ultimo minuto debe rechazar"
        );
        assert!(
            !st.can_emit(true),
            "hard cap aplica incluso a critical (red de seguridad)"
        );
    }

    #[test]
    fn hard_cap_permite_emitir_con_5_tips() {
        let mut st = FeedbackState::new();
        st.session_start = Instant::now() - Duration::from_secs(120);
        // last_tip_at lejano para que cooldown no aplique.
        st.last_tip_at = None;
        for i in 0..5 {
            st.tip_history.push(make_tip(80 + i, &format!("tip #{}", i)));
        }
        assert!(
            st.can_emit(false),
            "con 5 tips en el ultimo minuto debe permitir el sexto"
        );
    }

    // §5.2 cooldown 15s/30s/20s ────────────────────────────────────────────────

    #[test]
    fn cooldown_critical_es_15s() {
        let mut st = FeedbackState::new();
        st.session_start = Instant::now() - Duration::from_secs(300); // sesion madura
        st.last_tip_at = Some(Instant::now() - Duration::from_secs(10));
        assert!(
            !st.can_emit(true),
            "10s desde ultimo tip < 15s critical -> bloquea"
        );
        st.last_tip_at = Some(Instant::now() - Duration::from_secs(20));
        assert!(
            st.can_emit(true),
            "20s desde ultimo tip >= 15s critical -> permite"
        );
    }

    #[test]
    fn cooldown_primer_minuto_es_30s() {
        let mut st = FeedbackState::new();
        // Sesion recien iniciada: session_secs < 60.
        st.session_start = Instant::now() - Duration::from_secs(40);
        st.last_tip_at = Some(Instant::now() - Duration::from_secs(20));
        assert!(
            !st.can_emit(false),
            "20s en primer minuto < 30s -> bloquea"
        );
        st.last_tip_at = Some(Instant::now() - Duration::from_secs(31));
        assert!(
            st.can_emit(false),
            "31s en primer minuto >= 30s -> permite"
        );
    }

    #[test]
    fn cooldown_sesion_madura_es_20s() {
        let mut st = FeedbackState::new();
        st.session_start = Instant::now() - Duration::from_secs(300);
        st.last_tip_at = Some(Instant::now() - Duration::from_secs(15));
        assert!(
            !st.can_emit(false),
            "15s en sesion madura < 20s -> bloquea"
        );
        st.last_tip_at = Some(Instant::now() - Duration::from_secs(21));
        assert!(
            st.can_emit(false),
            "21s en sesion madura >= 20s -> permite"
        );
    }

    // §1.5.1 TTFB primer tip ───────────────────────────────────────────────────

    #[test]
    fn mark_first_tip_solo_devuelve_ms_la_primera_vez() {
        let mut st = FeedbackState::new();
        let first = st.mark_first_tip_if_needed();
        assert!(first.is_some(), "primer tip debe devolver Some(ms)");
        let second = st.mark_first_tip_if_needed();
        assert!(
            second.is_none(),
            "segundo tip debe devolver None (ya marcado)"
        );
    }

    // §1.5.3 p95 latencia ──────────────────────────────────────────────────────

    #[test]
    fn p95_latencia_calcula_correctamente() {
        let mut st = FeedbackState::new();
        for ms in 1..=100u64 {
            st.push_llm_latency(ms);
        }
        // p95 sobre 100 valores 1..=100 -> sorted[95] == 96.
        assert_eq!(st.llm_latency_p95_ms(), Some(96));
    }

    // §1.1 health_score ───────────────────────────────────────────────────────

    #[test]
    fn health_score_baseline_es_70_en_estado_inicial() {
        let st = FeedbackState::new();
        // Sin turns no hay datos. talk_ratio() default 0.5 (esta en zona neutra,
        // ni penaliza ni bonifica los rangos > 0.85 / < 0.15 / 0.40-0.60).
        // Pero r=0.5 cae en 0.40-0.60 -> +5. Por interlocutor_turns < 3 no suma.
        // user_turns=0 -> ratio preguntas no aplica. mono < 60 -> no penaliza.
        // Resultado: 70 + 5 = 75.
        let h = st.health_score();
        assert!(h >= 70 && h <= 80, "health inicial cerca de 70-80, got {}", h);
    }

    #[test]
    fn health_score_baja_con_monologo_largo() {
        let mut st = FeedbackState::new();
        st.longest_mono_secs = 130; // > 120 -> -20
        let h = st.health_score();
        assert!(h <= 60, "monologo > 2min debe bajar health, got {}", h);
    }

    #[test]
    fn health_score_baja_con_dominancia() {
        let mut st = FeedbackState::new();
        st.user_turns = 9;
        st.interlocutor_turns = 1; // ratio 0.9 -> -15
        let h = st.health_score();
        assert!(h <= 60, "dominancia >0.80 debe bajar health, got {}", h);
    }

    #[test]
    fn health_score_sube_con_balance_y_preguntas() {
        let mut st = FeedbackState::new();
        st.user_turns = 5;
        st.interlocutor_turns = 5; // ratio 0.5 -> +5
        st.user_questions = 2; // q_ratio 0.4 > 0.20 -> +10
        // interlocutor_turns >= 3 -> +5
        let h = st.health_score();
        assert!(h >= 85, "balance + preguntas + turns interloc >=3 sube health, got {}", h);
    }

    #[test]
    fn health_score_audience_mode_legitimo_no_penaliza() {
        let mut st = FeedbackState::new();
        st.session_start = Instant::now() - Duration::from_secs(240); // > 180s
        st.user_turns = 1;
        st.interlocutor_turns = 8; // ratio ~0.11 < 0.15, pero interlocutor activo
        // Audience-mode legitimo (interlocutor_turns >= 5): no penaliza por ratio bajo.
        let h = st.health_score();
        // Solo bonificacion +5 por interlocutor_turns >= 3 (ratio 0.11 no es 0.40-0.60).
        assert!(h >= 70, "audience-mode con interlocutor activo no penaliza, got {}", h);
    }

    #[test]
    fn health_score_audience_pasivo_si_penaliza() {
        let mut st = FeedbackState::new();
        st.session_start = Instant::now() - Duration::from_secs(240);
        // ratio < 0.15 con interlocutor < 5 turns: 1/8 = 0.125 < 0.15 y interloc 4 < 5.
        // Pero queremos un caso pasivo *real*, asi que: usuario casi mudo y otro habla
        // poco — silencio incomodo. interlocutor_turns=4 (<5 pero >=3 da +5).
        st.user_turns = 0;
        st.interlocutor_turns = 4;
        let h = st.health_score();
        // Penalizacion -10 (audience pasivo) + bonificacion +5 (interlocutor>=3) -> ~65.
        assert!(h < 70, "audience-mode pasivo penaliza, got {}", h);
    }

    #[test]
    fn health_score_clampea_a_0_y_100() {
        // Penalizaciones agresivas
        let mut st = FeedbackState::new();
        st.session_start = Instant::now() - Duration::from_secs(600);
        st.longest_mono_secs = 200;     // -20
        st.user_turns = 100;
        st.interlocutor_turns = 0;       // ratio 1.0 > 0.80 -> -15
        st.user_questions = 0;           // session > 300 -> -10
        let h = st.health_score();
        // 70 - 20 - 15 - 10 = 25, clampea bien arriba de 0.
        assert!(h <= 30, "muchas penalizaciones bajan a <=30, got {}", h);
        assert!(h >= 0);
    }

    // §6 evaluate_health_tips ─────────────────────────────────────────────────

    fn make_snap(health: u32, ratio: f32, mono: u32, session: u32) -> ConversationSnapshot {
        ConversationSnapshot {
            user_talk_ratio: ratio,
            user_questions: 0,
            session_duration_sec: session,
            user_wpm: 0.0,
            longest_user_monologue_sec: mono,
            health_score: health,
            last_nudge_type: None,
        }
    }

    #[test]
    fn heuristic_dispara_critical_con_health_le_10() {
        let snap = make_snap(8, 0.5, 0, 200);
        let h = evaluate_health_tips(&snap).expect("debe disparar");
        assert_eq!(h.priority, "critical");
        assert_eq!(h.trigger, "heuristic_health_critical");
    }

    #[test]
    fn heuristic_monologo_largo_tiene_prioridad_sobre_health() {
        // Aunque el health sea alto, monologo > 90s dispara primero.
        let snap = make_snap(80, 0.5, 100, 200);
        let h = evaluate_health_tips(&snap).expect("debe disparar");
        assert_eq!(h.trigger, "heuristic_monologue_long");
    }

    #[test]
    fn heuristic_no_dispara_en_zona_sana() {
        let snap = make_snap(75, 0.5, 30, 60);
        assert!(evaluate_health_tips(&snap).is_none());
    }

    #[test]
    fn heuristic_dispara_dominancia_solo_con_sesion_madura() {
        let early = make_snap(60, 0.95, 0, 60); // sesion < 90s
        assert!(evaluate_health_tips(&early).is_none());
        let mature = make_snap(60, 0.95, 0, 120);
        let h = evaluate_health_tips(&mature).expect("dispara con sesion >90s");
        assert_eq!(h.trigger, "heuristic_dominance");
    }

    #[test]
    fn p95_latencia_caps_a_100_muestras() {
        let mut st = FeedbackState::new();
        // Empujamos 150, debe quedar solo con las ultimas 100.
        for ms in 1..=150u64 {
            st.push_llm_latency(ms);
        }
        assert_eq!(st.llm_latencies_ms.len(), 100);
        // Las ultimas 100 son 51..=150. Sort y p95 -> sorted[95] == 146.
        assert_eq!(st.llm_latency_p95_ms(), Some(146));
    }
}
