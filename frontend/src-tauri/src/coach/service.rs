use log::{info, warn};
use once_cell::sync::Lazy;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, EventId, Listener, Runtime};
use tokio::sync::RwLock;
use tokio_util::sync::CancellationToken;

use super::prompt;

const SUGGESTION_INTERVAL: Duration = Duration::from_secs(30);
const MIN_NEW_WORDS: usize = 50;
const MAX_CONTEXT_SEGMENTS: usize = 40;

#[derive(Serialize, Clone)]
pub struct CoachSuggestion {
    pub text: String,
}

struct CoachState {
    /// Accumulated transcript segments: (speaker, text)
    segments: Vec<(String, String)>,
    /// Total word count at time of last suggestion
    words_at_last_suggestion: usize,
    /// When the last suggestion was generated
    last_suggestion_time: Instant,
    /// Whether the coach is active
    is_active: bool,
    /// Model name for Built-in AI
    model_name: String,
    /// App data directory for model resolution
    app_data_dir: PathBuf,
    /// Cancellation token for the timer task
    cancel_token: Option<CancellationToken>,
    /// Event listener ID for cleanup
    listener_id: Option<EventId>,
}

static COACH_STATE: Lazy<Arc<RwLock<CoachState>>> = Lazy::new(|| {
    Arc::new(RwLock::new(CoachState {
        segments: Vec::new(),
        words_at_last_suggestion: 0,
        last_suggestion_time: Instant::now(),
        is_active: false,
        model_name: String::new(),
        app_data_dir: PathBuf::new(),
        cancel_token: None,
        listener_id: None,
    }))
});

/// Start the coach service: listen to transcript-update events and periodically call Built-in AI.
pub async fn start<R: Runtime>(
    app: &AppHandle<R>,
    model_name: String,
    app_data_dir: PathBuf,
) -> Result<(), String> {
    let mut state = COACH_STATE.write().await;

    if state.is_active {
        return Err("Coach is already active".to_string());
    }

    // Reset state
    state.segments.clear();
    state.words_at_last_suggestion = 0;
    state.last_suggestion_time = Instant::now();
    state.is_active = true;
    state.model_name = model_name;
    state.app_data_dir = app_data_dir;

    let cancel_token = CancellationToken::new();
    state.cancel_token = Some(cancel_token.clone());

    // Register transcript-update listener
    let state_for_listener = COACH_STATE.clone();
    let listener_id = app.listen("transcript-update", move |event| {
        if let Ok(update) = serde_json::from_str::<crate::audio::transcription::TranscriptUpdate>(
            event.payload(),
        ) {
            if update.is_partial {
                return;
            }

            let text = update.text.trim().to_string();
            if text.is_empty() {
                return;
            }

            let speaker = update
                .source_type
                .clone()
                .unwrap_or_else(|| "user".to_string());

            let state_clone = state_for_listener.clone();
            tokio::spawn(async move {
                let mut s = state_clone.write().await;
                if s.is_active {
                    s.segments.push((speaker, text));
                    if s.segments.len() > MAX_CONTEXT_SEGMENTS {
                        let excess = s.segments.len() - MAX_CONTEXT_SEGMENTS;
                        s.segments.drain(..excess);
                    }
                }
            });
        }
    });

    state.listener_id = Some(listener_id);

    // Spawn timer task
    let app_handle = app.clone();
    let state_for_timer = COACH_STATE.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(5));

        loop {
            tokio::select! {
                _ = cancel_token.cancelled() => {
                    info!("Coach timer task cancelled");
                    break;
                }
                _ = interval.tick() => {
                    let should_generate = {
                        let s = state_for_timer.read().await;
                        if !s.is_active {
                            break;
                        }
                        let current_words: usize = s.segments.iter().map(|(_, t)| t.split_whitespace().count()).sum();
                        let new_words = current_words.saturating_sub(s.words_at_last_suggestion);
                        new_words >= MIN_NEW_WORDS && s.last_suggestion_time.elapsed() >= SUGGESTION_INTERVAL
                    };

                    if should_generate {
                        let (segments_snapshot, model, data_dir) = {
                            let s = state_for_timer.read().await;
                            (s.segments.clone(), s.model_name.clone(), s.app_data_dir.clone())
                        };

                        match generate_suggestion(&segments_snapshot, &model, &data_dir).await {
                            Ok(suggestion) => {
                                let _ = app_handle.emit("coach-suggestion", CoachSuggestion {
                                    text: suggestion,
                                });

                                let mut s = state_for_timer.write().await;
                                s.last_suggestion_time = Instant::now();
                                s.words_at_last_suggestion = s.segments.iter().map(|(_, t)| t.split_whitespace().count()).sum();
                            }
                            Err(e) => {
                                warn!("Coach suggestion generation failed: {}", e);
                                let _ = app_handle.emit("coach-error", serde_json::json!({
                                    "error": e,
                                }));
                            }
                        }
                    }
                }
            }
        }
    });

    info!("Coach service started");
    Ok(())
}

/// Stop the coach service.
pub async fn stop<R: Runtime>(app: &AppHandle<R>) {
    let mut state = COACH_STATE.write().await;

    if !state.is_active {
        return;
    }

    state.is_active = false;

    if let Some(token) = state.cancel_token.take() {
        token.cancel();
    }

    if let Some(listener_id) = state.listener_id.take() {
        app.unlisten(listener_id);
    }

    state.segments.clear();
    state.words_at_last_suggestion = 0;

    info!("Coach service stopped");
}

/// Check if the coach is active.
pub async fn is_active() -> bool {
    let state = COACH_STATE.read().await;
    state.is_active
}

/// Generate a suggestion using the Built-in AI sidecar (llama-helper).
async fn generate_suggestion(
    segments: &[(String, String)],
    model_name: &str,
    app_data_dir: &PathBuf,
) -> Result<String, String> {
    if segments.is_empty() {
        return Err("No transcript context available".to_string());
    }

    let user_prompt = prompt::build_user_prompt(segments);

    crate::summary::summary_engine::generate_with_builtin(
        app_data_dir,
        model_name,
        prompt::SYSTEM_PROMPT,
        &user_prompt,
        None, // No cancellation token for individual requests
    )
    .await
    .map(|text| text.trim().to_string())
    .map_err(|e| format!("Built-in AI error: {}", e))
}
