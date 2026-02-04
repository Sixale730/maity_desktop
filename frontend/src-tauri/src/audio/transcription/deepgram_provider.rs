// audio/transcription/deepgram_provider.rs
//
// Deepgram Realtime transcription provider using WebSocket streaming.
// Implements TranscriptionProvider trait for seamless integration.

use super::provider::{TranscriptionError, TranscriptionProvider, TranscriptResult};
use async_trait::async_trait;
use futures::{SinkExt, StreamExt};
use log::{debug, error, info, warn};
use serde::Deserialize;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio_tungstenite::{
    connect_async,
    tungstenite::{http::Request, Message},
    MaybeTlsStream, WebSocketStream,
};

// Type alias kept for potential future use with WebSocket streaming
#[allow(dead_code)]
type WsStream = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;

// ============================================================================
// DEEPGRAM API RESPONSE TYPES
// ============================================================================

#[derive(Debug, Deserialize)]
struct DeepgramResponse {
    #[serde(rename = "type")]
    #[allow(dead_code)]
    response_type: Option<String>,
    channel: Option<DeepgramChannel>,
    is_final: Option<bool>,
    #[allow(dead_code)]
    speech_final: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct DeepgramChannel {
    alternatives: Vec<DeepgramAlternative>,
}

#[derive(Debug, Deserialize)]
struct DeepgramAlternative {
    transcript: String,
    confidence: f32,
}

// ============================================================================
// DEEPGRAM PROVIDER CONFIGURATION
// ============================================================================

#[derive(Debug, Clone)]
pub struct DeepgramConfig {
    /// User's own API key (long-lived, stored in settings)
    pub api_key: String,
    /// Temporary token from cloud proxy (short-lived, ~5 min TTL)
    pub cloud_token: Option<String>,
    /// Whether to use cloud proxy token instead of user's API key
    pub use_cloud_proxy: bool,
    pub model: String,
    pub language: String,
    pub encoding: String,
    pub sample_rate: u32,
    pub channels: u8,
    pub punctuate: bool,
    pub interim_results: bool,
}

impl Default for DeepgramConfig {
    fn default() -> Self {
        Self {
            api_key: String::new(),
            cloud_token: None,
            use_cloud_proxy: false,
            model: "nova-3".to_string(),
            language: "es-419".to_string(), // Latin American Spanish by default
            encoding: "linear16".to_string(),
            sample_rate: 16000,
            channels: 1,
            punctuate: true,
            interim_results: true,
        }
    }
}

// ============================================================================
// DEEPGRAM REALTIME TRANSCRIBER
// ============================================================================

/// Maximum number of reconnection attempts before failing
const MAX_RECONNECT_ATTEMPTS: u32 = 3;

/// Delay between reconnection attempts (milliseconds)
const RECONNECT_DELAY_MS: u64 = 1000;

pub struct DeepgramRealtimeTranscriber {
    config: DeepgramConfig,
    is_connected: Arc<Mutex<bool>>,
}

impl DeepgramRealtimeTranscriber {
    /// Create a new Deepgram transcriber with the given API key
    pub fn new(api_key: String) -> Self {
        let mut config = DeepgramConfig::default();
        config.api_key = api_key;

        Self {
            config,
            is_connected: Arc::new(Mutex::new(false)),
        }
    }

    /// Create a new Deepgram transcriber using cloud proxy token
    /// This is used when the user doesn't have their own API key
    pub fn with_cloud_token(token: String) -> Self {
        let mut config = DeepgramConfig::default();
        config.cloud_token = Some(token);
        config.use_cloud_proxy = true;

        Self {
            config,
            is_connected: Arc::new(Mutex::new(false)),
        }
    }

    /// Create with full configuration
    pub fn with_config(config: DeepgramConfig) -> Self {
        Self {
            config,
            is_connected: Arc::new(Mutex::new(false)),
        }
    }

    /// Set the transcription model (e.g., "nova-2", "nova-2-general")
    pub fn set_model(&mut self, model: String) {
        self.config.model = model;
    }

    /// Set the language (e.g., "es", "en", "multi")
    pub fn set_language(&mut self, language: String) {
        self.config.language = language;
    }

    /// Update the cloud proxy token (for token refresh)
    pub fn set_cloud_token(&mut self, token: String) {
        self.config.cloud_token = Some(token);
        self.config.use_cloud_proxy = true;
    }

    /// Check if using cloud proxy
    pub fn is_using_cloud_proxy(&self) -> bool {
        self.config.use_cloud_proxy
    }

    /// Get the effective authentication token (cloud token or API key)
    fn get_auth_token(&self) -> Option<&str> {
        if self.config.use_cloud_proxy {
            self.config.cloud_token.as_deref()
        } else if !self.config.api_key.is_empty() {
            Some(&self.config.api_key)
        } else {
            None
        }
    }

    /// Get the authorization header format based on token type
    fn get_auth_header(&self) -> Option<String> {
        self.get_auth_token().map(|token| {
            // Both cloud proxy and user API keys use "Token" format
            // Note: Cloud proxy now returns the API key directly (not JWT)
            // because /v1/auth/grant requires a paid Deepgram plan
            format!("Token {}", token)
        })
    }

    /// Build the WebSocket URL with query parameters
    fn build_websocket_url(&self, language_override: Option<&str>) -> String {
        let language = language_override.unwrap_or(&self.config.language);

        // Handle special language values
        // "auto-translate" or "auto" should omit language param (Deepgram defaults to English)
        // or we can try to use a valid language code
        let language_param = match language {
            "auto-translate" | "auto" | "detect" => {
                // Nova-2 doesn't support detect_language, so we default to Spanish
                // since all users speak Spanish
                println!("🌐 [DEEPGRAM] auto-translate detectado, usando idioma por defecto (es)");
                "language=es".to_string()
            }
            lang => {
                println!("🌐 [DEEPGRAM] Usando idioma específico: {}", lang);
                format!("language={}", lang)
            }
        };

        format!(
            "wss://api.deepgram.com/v1/listen?\
            model={}&\
            {}&\
            encoding={}&\
            sample_rate={}&\
            channels={}&\
            punctuate={}&\
            interim_results={}",
            self.config.model,
            language_param,
            self.config.encoding,
            self.config.sample_rate,
            self.config.channels,
            self.config.punctuate,
            self.config.interim_results
        )
    }

    /// Convert f32 audio samples to 16-bit PCM bytes
    fn convert_to_pcm16(&self, audio: &[f32]) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(audio.len() * 2);

        for &sample in audio {
            // Clamp to valid range and convert to i16
            let clamped = sample.clamp(-1.0, 1.0);
            let pcm_sample = (clamped * 32767.0) as i16;
            bytes.extend_from_slice(&pcm_sample.to_le_bytes());
        }

        bytes
    }

    /// Connect to Deepgram WebSocket and transcribe audio
    async fn transcribe_via_websocket(
        &self,
        audio: Vec<f32>,
        language: Option<String>,
    ) -> Result<TranscriptResult, TranscriptionError> {
        // Get authentication header (works for both cloud proxy and user API key)
        let auth_header = self.get_auth_header().ok_or_else(|| {
            TranscriptionError::EngineFailed(
                "Deepgram authentication not configured (no API key or cloud token)".to_string(),
            )
        })?;

        // Build URL with language override if provided
        let url = self.build_websocket_url(language.as_deref());
        debug!("Deepgram WebSocket URL: {}", url.split('?').next().unwrap_or(&url));

        // Create WebSocket request with authorization header
        let request = Request::builder()
            .uri(&url)
            .header("Authorization", &auth_header)
            .header("Host", "api.deepgram.com")
            .header("Upgrade", "websocket")
            .header("Connection", "Upgrade")
            .header("Sec-WebSocket-Version", "13")
            .header("Sec-WebSocket-Key", generate_websocket_key())
            .body(())
            .map_err(|e| TranscriptionError::EngineFailed(format!("Failed to build request: {}", e)))?;

        // Connect to WebSocket
        println!("🔗 [DEEPGRAM] Conectando a WebSocket...");
        let (ws_stream, _response) = connect_async(request)
            .await
            .map_err(|e| {
                println!("❌ [DEEPGRAM] Error de conexión WebSocket: {}", e);
                TranscriptionError::EngineFailed(format!("WebSocket connection failed: {}", e))
            })?;

        println!("🟢 [DEEPGRAM] WebSocket conectado exitosamente");
        info!("Connected to Deepgram WebSocket");
        *self.is_connected.lock().await = true;

        let (mut write, mut read) = ws_stream.split();

        // Convert audio to PCM16 bytes
        let audio_bytes = self.convert_to_pcm16(&audio);
        println!("🔵 [DEEPGRAM] Enviando {} bytes de audio ({} muestras)", audio_bytes.len(), audio.len());
        debug!("Sending {} bytes of audio to Deepgram", audio_bytes.len());

        // Send audio data
        write
            .send(Message::Binary(audio_bytes))
            .await
            .map_err(|e| {
                println!("❌ [DEEPGRAM] Error al enviar audio: {}", e);
                TranscriptionError::EngineFailed(format!("Failed to send audio: {}", e))
            })?;

        println!("✅ [DEEPGRAM] Audio enviado correctamente");

        // Send close frame to signal end of audio
        write
            .send(Message::Text(r#"{"type": "CloseStream"}"#.to_string()))
            .await
            .map_err(|e| TranscriptionError::EngineFailed(format!("Failed to send close: {}", e)))?;

        // Collect transcription results
        let mut final_text = String::new();
        let mut final_confidence: f32 = 0.0;
        let mut confidence_count: u32 = 0;
        let mut is_partial = true;

        // Set timeout for receiving responses
        // FIX: Increased from 30s to 60s for long conversations and slow network conditions
        let timeout = tokio::time::Duration::from_secs(60);
        let result = tokio::time::timeout(timeout, async {
            while let Some(msg) = read.next().await {
                match msg {
                    Ok(Message::Text(text)) => {
                        println!("📨 [DEEPGRAM] Mensaje recibido: {} chars", text.len());
                        if let Ok(response) = serde_json::from_str::<DeepgramResponse>(&text) {
                            // Check if this is a transcript result
                            if let Some(channel) = response.channel {
                                if let Some(alt) = channel.alternatives.first() {
                                    if !alt.transcript.is_empty() {
                                        println!(
                                            "🟣 [DEEPGRAM] Transcripción recibida: '{}' (confianza: {:.2}, is_final: {:?})",
                                            alt.transcript, alt.confidence, response.is_final
                                        );
                                        debug!(
                                            "Deepgram transcript: '{}' (confidence: {:.2}, is_final: {:?})",
                                            alt.transcript, alt.confidence, response.is_final
                                        );

                                        // Append transcript
                                        if !final_text.is_empty() {
                                            final_text.push(' ');
                                        }
                                        final_text.push_str(&alt.transcript);

                                        // Update confidence
                                        final_confidence += alt.confidence;
                                        confidence_count += 1;

                                        // Check if this is the final result
                                        if response.is_final.unwrap_or(false) {
                                            is_partial = false;
                                        }
                                    }
                                }
                            }
                        }
                    }
                    Ok(Message::Close(_)) => {
                        debug!("Deepgram WebSocket closed");
                        break;
                    }
                    Err(e) => {
                        warn!("WebSocket error: {}", e);
                        break;
                    }
                    _ => {}
                }
            }
            Ok::<(), TranscriptionError>(())
        })
        .await;

        *self.is_connected.lock().await = false;

        // Handle timeout
        if result.is_err() {
            return Err(TranscriptionError::EngineFailed(
                "Deepgram response timeout after 60 seconds".to_string(),
            ));
        }

        // Calculate average confidence
        let avg_confidence = if confidence_count > 0 {
            final_confidence / confidence_count as f32
        } else {
            0.0
        };

        let result_text = final_text.trim().to_string();
        println!(
            "✅ [DEEPGRAM] Transcripción completa: '{}' (confianza: {:.2}, parcial: {})",
            if result_text.chars().count() > 50 { format!("{}...", result_text.chars().take(50).collect::<String>()) } else { result_text.clone() },
            avg_confidence,
            is_partial
        );

        Ok(TranscriptResult {
            text: result_text,
            confidence: Some(avg_confidence),
            is_partial,
        })
    }
}

#[async_trait]
impl TranscriptionProvider for DeepgramRealtimeTranscriber {
    async fn transcribe(
        &self,
        audio: Vec<f32>,
        language: Option<String>,
    ) -> Result<TranscriptResult, TranscriptionError> {
        // Validate audio length
        let minimum_samples = 1600; // 100ms at 16kHz
        if audio.len() < minimum_samples {
            return Err(TranscriptionError::AudioTooShort {
                samples: audio.len(),
                minimum: minimum_samples,
            });
        }

        println!(
            "🎤 [DEEPGRAM] Iniciando transcripción: {} muestras (~{:.2}s), idioma: {:?}",
            audio.len(),
            audio.len() as f64 / 16000.0,
            language
        );
        info!(
            "Deepgram transcribing {} samples (~{:.2}s)",
            audio.len(),
            audio.len() as f64 / 16000.0
        );

        // Retry logic for network resilience
        let mut last_error = None;
        for attempt in 1..=MAX_RECONNECT_ATTEMPTS {
            match self.transcribe_via_websocket(audio.clone(), language.clone()).await {
                Ok(result) => return Ok(result),
                Err(e) => {
                    // Log error without exposing sensitive data
                    let error_msg = e.to_string();
                    let safe_msg = if error_msg.contains("api_key") || error_msg.contains("Token") {
                        "Authentication or connection error (details redacted)".to_string()
                    } else {
                        error_msg
                    };

                    if attempt < MAX_RECONNECT_ATTEMPTS {
                        warn!(
                            "Deepgram attempt {}/{} failed: {}. Retrying in {}ms...",
                            attempt, MAX_RECONNECT_ATTEMPTS, safe_msg, RECONNECT_DELAY_MS
                        );
                        tokio::time::sleep(tokio::time::Duration::from_millis(RECONNECT_DELAY_MS)).await;
                    } else {
                        error!(
                            "Deepgram failed after {} attempts: {}",
                            MAX_RECONNECT_ATTEMPTS, safe_msg
                        );
                    }
                    last_error = Some(e);
                }
            }
        }

        Err(last_error.unwrap_or_else(|| {
            TranscriptionError::EngineFailed("Unknown error after retry attempts".to_string())
        }))
    }

    async fn is_model_loaded(&self) -> bool {
        // Deepgram is cloud-based, "ready" if API key or cloud token is configured
        self.get_auth_token().is_some()
    }

    async fn get_current_model(&self) -> Option<String> {
        if self.get_auth_token().is_some() {
            Some(self.config.model.clone())
        } else {
            None
        }
    }

    fn provider_name(&self) -> &'static str {
        "Deepgram"
    }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/// Generate a random WebSocket key
fn generate_websocket_key() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let key: [u8; 16] = rng.gen();
    base64_encode(&key)
}

/// Simple base64 encoding (avoiding external dependency)
fn base64_encode(data: &[u8]) -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::new();

    for chunk in data.chunks(3) {
        let mut buffer = [0u8; 4];
        buffer[0] = chunk[0] >> 2;
        buffer[1] = ((chunk[0] & 0x03) << 4) | (chunk.get(1).unwrap_or(&0) >> 4);
        buffer[2] = ((chunk.get(1).unwrap_or(&0) & 0x0f) << 2) | (chunk.get(2).unwrap_or(&0) >> 6);
        buffer[3] = chunk.get(2).unwrap_or(&0) & 0x3f;

        for (i, &idx) in buffer.iter().enumerate() {
            if i < chunk.len() + 1 {
                result.push(ALPHABET[idx as usize] as char);
            } else {
                result.push('=');
            }
        }
    }

    result
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_config_default() {
        let config = DeepgramConfig::default();
        assert_eq!(config.model, "nova-3");
        assert_eq!(config.language, "es-419");
        assert_eq!(config.sample_rate, 16000);
    }

    #[test]
    fn test_pcm_conversion() {
        let transcriber = DeepgramRealtimeTranscriber::new("test_key".to_string());

        // Test conversion of silence
        let silence = vec![0.0f32; 100];
        let pcm = transcriber.convert_to_pcm16(&silence);
        assert_eq!(pcm.len(), 200); // 100 samples * 2 bytes

        // All values should be 0
        for byte in &pcm {
            assert_eq!(*byte, 0);
        }

        // Test conversion of max values
        let max_signal = vec![1.0f32, -1.0f32];
        let pcm = transcriber.convert_to_pcm16(&max_signal);
        assert_eq!(pcm.len(), 4);

        // +1.0 should become 32767 (0x7FFF)
        assert_eq!(pcm[0], 0xFF);
        assert_eq!(pcm[1], 0x7F);

        // -1.0 should become -32767 (0x8001)
        let neg_value = i16::from_le_bytes([pcm[2], pcm[3]]);
        assert_eq!(neg_value, -32767);
    }

    #[test]
    fn test_websocket_url_building() {
        let transcriber = DeepgramRealtimeTranscriber::new("test_api_key".to_string());
        let url = transcriber.build_websocket_url(None);

        assert!(url.contains("model=nova-3"));
        assert!(url.contains("language=es-419"));
        assert!(url.contains("sample_rate=16000"));
        assert!(url.contains("encoding=linear16"));
    }

    #[test]
    fn test_websocket_url_with_language_override() {
        let transcriber = DeepgramRealtimeTranscriber::new("test_api_key".to_string());
        let url = transcriber.build_websocket_url(Some("en"));

        assert!(url.contains("language=en"));
    }

    #[tokio::test]
    async fn test_model_loaded_without_key() {
        let transcriber = DeepgramRealtimeTranscriber::new(String::new());
        assert!(!transcriber.is_model_loaded().await);
    }

    #[tokio::test]
    async fn test_model_loaded_with_key() {
        let transcriber = DeepgramRealtimeTranscriber::new("test_key".to_string());
        assert!(transcriber.is_model_loaded().await);
    }

    #[tokio::test]
    async fn test_provider_name() {
        let transcriber = DeepgramRealtimeTranscriber::new("test_key".to_string());
        assert_eq!(transcriber.provider_name(), "Deepgram");
    }

    #[tokio::test]
    async fn test_audio_too_short() {
        let transcriber = DeepgramRealtimeTranscriber::new("test_key".to_string());
        let short_audio = vec![0.0f32; 100]; // Only 100 samples (< 1600 minimum)

        let result = transcriber.transcribe(short_audio, None).await;
        assert!(matches!(result, Err(TranscriptionError::AudioTooShort { .. })));
    }
}
