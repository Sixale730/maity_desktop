use ndarray::{Array1, Array2, Array3, IxDyn};
use ort::execution_providers::CPUExecutionProvider;
use ort::inputs;
use ort::session::builder::GraphOptimizationLevel;
use ort::session::Session;
use ort::value::TensorRef;

use std::collections::HashMap;
use std::fs;
use std::path::Path;

use super::preprocessor;

#[derive(thiserror::Error, Debug)]
pub enum CanaryError {
    #[error("ORT error")]
    Ort(#[from] ort::Error),
    #[error("I/O error")]
    Io(#[from] std::io::Error),
    #[error("ndarray shape error")]
    Shape(#[from] ndarray::ShapeError),
    #[error("Model output not found: {0}")]
    OutputNotFound(String),
    #[error("Vocab token not found: {0}")]
    TokenNotFound(String),
    #[error("Decoding error: {0}")]
    DecodingError(String),
}

pub struct CanaryModel {
    encoder: Session,
    decoder: Session,
    vocab: Vec<String>,
    _token_to_id: HashMap<String, i64>,
    eos_token_id: i64,
    // Special tokens for Canary
    start_of_context_id: i64,
    source_lang_ids: HashMap<String, i64>, // "es" -> id, "en" -> id, etc.
    pnc_token_id: i64,
}

impl Drop for CanaryModel {
    fn drop(&mut self) {
        log::debug!("Dropping CanaryModel with {} vocab tokens", self.vocab.len());
    }
}

impl CanaryModel {
    pub fn new<P: AsRef<Path>>(model_dir: P, quantized: bool) -> Result<Self, CanaryError> {
        let encoder = Self::init_session(&model_dir, "encoder-model", quantized)?;
        let decoder = Self::init_session(&model_dir, "decoder-model", quantized)?;

        let (vocab, token_to_id) = Self::load_vocab(&model_dir)?;

        // Find special token IDs
        let eos_token_id = *token_to_id
            .get("<|endoftext|>")
            .ok_or_else(|| CanaryError::TokenNotFound("<|endoftext|>".to_string()))?;

        let start_of_context_id = *token_to_id
            .get("<|startofcontext|>")
            .ok_or_else(|| CanaryError::TokenNotFound("<|startofcontext|>".to_string()))?;

        let pnc_token_id = *token_to_id
            .get("<|pnc|>")
            .ok_or_else(|| CanaryError::TokenNotFound("<|pnc|>".to_string()))?;

        // Build language token map
        let mut source_lang_ids = HashMap::new();
        for lang in &["es", "en", "de", "fr"] {
            let token = format!("<|{lang}|>");
            if let Some(&id) = token_to_id.get(&token) {
                source_lang_ids.insert(lang.to_string(), id);
            }
        }

        log::info!(
            "Loaded Canary vocabulary with {} tokens, eos={}, start_of_context={}, pnc={}, langs={:?}",
            vocab.len(),
            eos_token_id,
            start_of_context_id,
            pnc_token_id,
            source_lang_ids.keys().collect::<Vec<_>>()
        );

        Ok(Self {
            encoder,
            decoder,
            vocab,
            _token_to_id: token_to_id,
            eos_token_id,
            start_of_context_id,
            source_lang_ids,
            pnc_token_id,
        })
    }

    fn init_session<P: AsRef<Path>>(
        model_dir: P,
        model_name: &str,
        try_quantized: bool,
    ) -> Result<Session, CanaryError> {
        let providers = vec![CPUExecutionProvider::default().build()];

        let model_filename = if try_quantized {
            let quantized_name = format!("{}.int8.onnx", model_name);
            let quantized_path = model_dir.as_ref().join(&quantized_name);
            if quantized_path.exists() {
                log::info!("Loading quantized Canary model: {}", quantized_name);
                quantized_name
            } else {
                let regular_name = format!("{}.onnx", model_name);
                log::info!("Quantized not found, loading: {}", regular_name);
                regular_name
            }
        } else {
            let regular_name = format!("{}.onnx", model_name);
            log::info!("Loading Canary model: {}", regular_name);
            regular_name
        };

        let session = Session::builder()?
            .with_optimization_level(GraphOptimizationLevel::Level3)?
            .with_execution_providers(providers)?
            .with_parallel_execution(true)?
            .commit_from_file(model_dir.as_ref().join(&model_filename))?;

        for input in &session.inputs {
            log::info!(
                "Canary '{}' input: name={}, type={:?}",
                model_filename,
                input.name,
                input.input_type
            );
        }
        for output in &session.outputs {
            log::info!(
                "Canary '{}' output: name={}, type={:?}",
                model_filename,
                output.name,
                output.output_type
            );
        }

        Ok(session)
    }

    fn load_vocab<P: AsRef<Path>>(
        model_dir: P,
    ) -> Result<(Vec<String>, HashMap<String, i64>), CanaryError> {
        let vocab_path = model_dir.as_ref().join("vocab.txt");
        let content = fs::read_to_string(vocab_path)?;

        let mut vocab = Vec::new();
        let mut token_to_id = HashMap::new();

        for (idx, line) in content.lines().enumerate() {
            let token = line.trim().to_string();
            if !token.is_empty() {
                token_to_id.insert(token.clone(), idx as i64);
                vocab.push(token);
            }
        }

        Ok((vocab, token_to_id))
    }

    /// Build the initial decoder input tokens for Canary.
    /// Format: [<|startofcontext|>, <|lang|>, <|pnc|>]
    fn build_prompt_tokens(&self, language: Option<&str>) -> Vec<i64> {
        let lang = language.unwrap_or("es");
        let lang_id = self
            .source_lang_ids
            .get(lang)
            .copied()
            .unwrap_or_else(|| {
                // Fallback to Spanish
                self.source_lang_ids
                    .get("es")
                    .copied()
                    .unwrap_or(self.start_of_context_id)
            });

        vec![self.start_of_context_id, lang_id, self.pnc_token_id]
    }

    /// Encode audio features using the encoder.
    /// Input: mel spectrogram [1, n_frames, 128]
    /// Output: encoder hidden states
    pub fn encode(
        &mut self,
        mel_features: &Array3<f32>,
    ) -> Result<ndarray::ArrayD<f32>, CanaryError> {
        log::trace!("Running Canary encoder...");

        let mel_dyn = mel_features.clone().into_dyn();
        let audio_length = Array1::from_vec(vec![mel_features.shape()[1] as i64]).into_dyn();

        let inputs = inputs![
            "audio_signal" => TensorRef::from_array_view(mel_dyn.view())?,
            "length" => TensorRef::from_array_view(audio_length.view())?,
        ];

        let outputs = self.encoder.run(inputs)?;

        let encoder_output = outputs
            .get("outputs")
            .or_else(|| outputs.get("encoder_output"))
            .or_else(|| outputs.get("last_hidden_state"))
            .ok_or_else(|| {
                let available: Vec<_> = outputs.keys().collect();
                CanaryError::OutputNotFound(format!(
                    "encoder output (available: {:?})",
                    available
                ))
            })?
            .try_extract_array::<f32>()?;

        Ok(encoder_output.to_owned())
    }

    /// Autoregressive decoder step.
    /// Takes encoder output and current token sequence, returns logits for next token.
    fn decoder_step(
        &mut self,
        encoder_output: &ndarray::ArrayViewD<f32>,
        decoder_input_ids: &Array2<i64>,
    ) -> Result<ndarray::ArrayD<f32>, CanaryError> {
        log::trace!(
            "Canary decoder step: input_ids shape {:?}",
            decoder_input_ids.shape()
        );

        let decoder_ids_dyn = decoder_input_ids.clone().into_dyn();

        let inputs = inputs![
            "encoder_hidden_states" => TensorRef::from_array_view(encoder_output.view())?,
            "decoder_input_ids" => TensorRef::from_array_view(decoder_ids_dyn.view())?,
        ];

        let outputs = self.decoder.run(inputs)?;

        let logits = outputs
            .get("logits")
            .or_else(|| outputs.get("outputs"))
            .ok_or_else(|| {
                let available: Vec<_> = outputs.keys().collect();
                CanaryError::OutputNotFound(format!(
                    "decoder logits (available: {:?})",
                    available
                ))
            })?
            .try_extract_array::<f32>()?;

        Ok(logits.to_owned())
    }

    /// Greedy autoregressive decoding.
    /// Generates tokens one-by-one until EOS or max_tokens.
    pub fn greedy_decode(
        &mut self,
        encoder_output: &ndarray::ArrayD<f32>,
        language: Option<&str>,
        max_tokens: usize,
    ) -> Result<String, CanaryError> {
        let prompt_tokens = self.build_prompt_tokens(language);
        let mut generated_ids: Vec<i64> = prompt_tokens;

        let encoder_view = encoder_output.view();

        for step in 0..max_tokens {
            // Build decoder input: all tokens generated so far
            let seq_len = generated_ids.len();
            let decoder_input =
                Array2::from_shape_vec((1, seq_len), generated_ids.clone())
                    .map_err(|e| CanaryError::DecodingError(format!("Shape error: {}", e)))?;

            let logits = self.decoder_step(&encoder_view, &decoder_input)?;

            // Get logits for the last position
            let logits_shape = logits.shape();
            let vocab_size = *logits_shape.last().unwrap_or(&0);
            let last_pos = logits_shape.get(1).copied().unwrap_or(1) - 1;

            // Extract logits for last token position
            let last_logits: Vec<f32> = (0..vocab_size)
                .map(|v| {
                    logits
                        .get(IxDyn(&[0, last_pos, v]))
                        .copied()
                        .unwrap_or(f32::NEG_INFINITY)
                })
                .collect();

            // Greedy: argmax
            let next_token = last_logits
                .iter()
                .enumerate()
                .max_by(|(_, a), (_, b)| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
                .map(|(idx, _)| idx as i64)
                .unwrap_or(self.eos_token_id);

            if next_token == self.eos_token_id {
                log::debug!(
                    "Canary EOS reached at step {} (total tokens: {})",
                    step,
                    generated_ids.len()
                );
                break;
            }

            generated_ids.push(next_token);
        }

        // Decode tokens to text (skip prompt tokens)
        let prompt_len = self.build_prompt_tokens(language).len();
        let output_tokens = &generated_ids[prompt_len..];

        let text: String = output_tokens
            .iter()
            .filter_map(|&id| {
                let idx = id as usize;
                if idx < self.vocab.len() {
                    let token = &self.vocab[idx];
                    // Skip special tokens in output
                    if token.starts_with("<|") && token.ends_with("|>") {
                        None
                    } else {
                        Some(token.replace('\u{2581}', " "))
                    }
                } else {
                    None
                }
            })
            .collect();

        Ok(text.trim().to_string())
    }

    /// Transcribe raw audio samples (16kHz mono f32).
    pub fn transcribe_samples(
        &mut self,
        samples: Vec<f32>,
        language: Option<&str>,
    ) -> Result<String, CanaryError> {
        // 1. Compute log-mel spectrogram
        let mel = preprocessor::compute_log_mel_spectrogram(&samples);
        log::debug!(
            "Canary mel spectrogram shape: {:?} from {} samples",
            mel.shape(),
            samples.len()
        );

        // 2. Encode
        let encoder_output = self.encode(&mel)?;
        log::debug!("Canary encoder output shape: {:?}", encoder_output.shape());

        // 3. Greedy decode
        let text = self.greedy_decode(&encoder_output, language, 256)?;
        log::debug!("Canary transcription: '{}'", text);

        Ok(text)
    }
}
