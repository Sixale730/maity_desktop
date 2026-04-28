//! Motor de feedback en vivo durante la grabación.
//!
//! Suscribe al evento "transcript-update", mantiene rolling window 3 min,
//! corre NudgeEngine (heurístico puro) y TriggerEngine (señales léxicas),
//! llama Ollama gemma3:4b cuando hay señal y emite "coach-tip-update".

use crate::coach::nudge_engine::{evaluate_nudge, ConversationSnapshot};
use crate::coach::prompt::{build_user_prompt, MeetingType, COACH_SYSTEM_PROMPT, DEFAULT_TIPS_MODEL};
use crate::coach::trigger::{analyze_turn_with_context, SignalPriority, TurnContext};
use crate::recording_pipeline::get_active_live_feedback_config;
use crate::summary::llm_client::{generate_summary, LLMProvider};
use once_cell::sync::Lazy;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Listener, Manager, Runtime};
use tokio_util::sync::CancellationToken;
use tracing::{error, info, warn};

// ─── Globals ──────────────────────────────────────────────────────────────────

static CANCEL_TOKEN: Mutex<Option<CancellationToken>> = Mutex::new(None);
static EVENT_LISTENER: Mutex<Option<tauri::EventId>> = Mutex::new(None);

static FEEDBACK_STATE: Lazy<Mutex<Option<Arc<Mutex<FeedbackState>>>>> =
    Lazy::new(|| Mutex::new(None));

static HTTP_CLIENT: Lazy<Client> = Lazy::new(Client::new);

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
        }
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

    fn health_score(&self) -> u32 {
        let mut s = 50u32;
        let r = self.talk_ratio();
        if r > 0.30 && r < 0.65 {
            s += 20;
        } else if r > 0.85 {
            s = s.saturating_sub(15);
        }
        if self.user_questions >= 3 {
            s += 20;
        } else if self.user_questions > 0 {
            s += 10;
        }
        if self.longest_mono_secs < 30 {
            s += 10;
        } else if self.longest_mono_secs > 90 {
            s = s.saturating_sub(20);
        }
        s.min(100)
    }

    fn can_emit(&self, critical: bool) -> bool {
        // Post-price/objection suppression: 8s de silencio para no interrumpir negociación
        if let Some(t) = self.last_price_signal_at {
            if t.elapsed() < Duration::from_secs(8) {
                return false;
            }
        }
        // Primer minuto: gap mínimo 30s para no abrumar al inicio
        let session_secs = self.session_start.elapsed().as_secs();
        let gap = if session_secs < 60 || critical {
            Duration::from_secs(30)
        } else {
            Duration::from_secs(120)
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

    fn record_tip(&mut self, update: CoachTipUpdate) {
        self.last_tip_at = Some(Instant::now());
        self.previous_tips.push(update.tip.clone());
        if self.previous_tips.len() > 10 {
            self.previous_tips.remove(0);
        }
        self.tip_history.push(update);
        if self.tip_history.len() > 20 {
            self.tip_history.remove(0);
        }
    }
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

    // Leer config del pipeline activo
    let cfg = get_active_live_feedback_config(&app).await;
    let model = cfg
        .as_ref()
        .map(|c| c.model.clone())
        .unwrap_or_else(|| DEFAULT_TIPS_MODEL.to_string());
    // llama-server siempre en 127.0.0.1:11434 — API compatible con Ollama
    let endpoint = "http://127.0.0.1:11434".to_string();

    // Arrancar llama-server en background (puede tardar si el modelo es grande)
    {
        use crate::coach::llama_engine;
        use crate::state::AppState;
        use tauri::Manager as _;
        let app_bg = app.clone();
        let tips_model_id = if let Some(state) = app_bg.try_state::<AppState>() {
            let pool = state.db_manager.pool();
            sqlx::query_scalar::<_, String>(
                "SELECT tips_model_id FROM coach_settings WHERE id = '1'",
            )
            .fetch_optional(pool)
            .await
            .ok()
            .flatten()
            .unwrap_or_else(|| "qwen25-3b-q4".to_string())
        } else {
            "qwen25-3b-q4".to_string()
        };
        if llama_engine::is_binary_installed(&app_bg) && llama_engine::is_model_installed(&app_bg, &tips_model_id) {
            let app2 = app_bg.clone();
            tokio::spawn(async move {
                if let Err(e) = llama_engine::ensure_running(&app2, &tips_model_id, 11434).await {
                    warn!("No se pudo iniciar llama-server para tips en vivo: {}", e);
                }
            });
        }
    }
    let window_secs = cfg.as_ref().map(|c| c.context_window_secs).unwrap_or(180);
    let interval_secs = cfg.as_ref().map(|c| c.interval_secs).unwrap_or(45);

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
            return;
        };
        if payload.is_partial || payload.text.trim().is_empty() {
            return;
        }

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

            let has_critical = signals
                .iter()
                .any(|s| matches!(s.priority, SignalPriority::Critical));

            if !has_critical || !st.can_emit(true) {
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
                        if st.window.is_empty() || !st.can_emit(false) {
                            None
                        } else {
                            let snap = st.snapshot();
                            let nudge = evaluate_nudge(&snap);
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
                        if let Ok(mut st) = state_bg.lock() {
                            st.record_tip(update);
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
    endpoint: &str,
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

    let result = generate_summary(
        &HTTP_CLIENT,
        &LLMProvider::Ollama,
        model,
        "",
        COACH_SYSTEM_PROMPT,
        &user_prompt,
        Some(endpoint),
        None,
        None,
        Some(0.3),
        None,
        None,
        Some(&cancel),
    )
    .await;

    match result {
        Ok(raw) => {
            if let Some(update) =
                parse_gemma_response(&raw, trigger.as_deref(), session_secs)
            {
                let _ = app.emit("coach-tip-update", &update);
                info!("💡 Coach tip emitted: {}", update.tip);
                if let Ok(mut st) = state.lock() {
                    st.record_tip(update);
                }
            } else {
                warn!("Coach: Ollama respondió pero no se pudo parsear JSON");
                // Liberar el rate-limit para no bloquear el siguiente intento
                if let Ok(mut st) = state.lock() {
                    st.last_tip_at = None;
                }
            }
        }
        Err(e) => {
            warn!("Coach Ollama call failed: {}", e);
            // Liberar el rate-limit — Ollama puede no estar disponible
            if let Ok(mut st) = state.lock() {
                st.last_tip_at = None;
            }
        }
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
