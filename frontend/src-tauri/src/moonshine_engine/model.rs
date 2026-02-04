use ndarray::{Array2, Array4, ArrayD};
use ort::execution_providers::CPUExecutionProvider;
use ort::inputs;
use ort::session::builder::GraphOptimizationLevel;
use ort::session::Session;
use ort::value::{Tensor, TensorRef};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

/// Output from a single decoder step
struct DecoderStepOutput {
    /// Logits tensor for next token prediction
    logits: ArrayD<f32>,
    /// Updated past_key_values for next step
    new_cache: HashMap<String, ArrayD<f32>>,
}

const MAX_TOKENS: usize = 1024;
const EOS_TOKEN_ID: i64 = 2; // End of sequence token
const BOS_TOKEN_ID: i64 = 1; // Beginning of sequence token

// Moonshine-base decoder configuration (from config.json)
const DECODER_NUM_LAYERS: usize = 8;
const NUM_KEY_VALUE_HEADS: usize = 8;
const HEAD_DIM: usize = 56; // 416/8 = 52, padded to multiple of 8 for efficiency

#[derive(thiserror::Error, Debug)]
pub enum MoonshineError {
    #[error("ORT error: {0}")]
    Ort(#[from] ort::Error),
    #[error("I/O error")]
    Io(#[from] std::io::Error),
    #[error("ndarray shape error")]
    Shape(#[from] ndarray::ShapeError),
    #[error("Tokenizer error: {0}")]
    Tokenizer(String),
    #[error("Model input not found: {0}")]
    InputNotFound(String),
    #[error("Model output not found: {0}")]
    OutputNotFound(String),
    #[error("JSON parse error: {0}")]
    JsonParse(String),
}

/// Simple tokenizer that parses HuggingFace tokenizer.json format
/// This avoids the C++ runtime conflicts caused by the tokenizers crate on Windows
pub struct SimpleTokenizer {
    /// Map from token ID to token string
    id_to_token: HashMap<u32, String>,
    /// Map from token string to token ID
    token_to_id: HashMap<String, u32>,
}

impl SimpleTokenizer {
    /// Load tokenizer from HuggingFace tokenizer.json format
    pub fn from_file<P: AsRef<Path>>(path: P) -> Result<Self, MoonshineError> {
        let content = fs::read_to_string(path.as_ref())
            .map_err(|e| MoonshineError::Tokenizer(format!("Failed to read tokenizer file: {}", e)))?;

        let json: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| MoonshineError::JsonParse(format!("Failed to parse tokenizer JSON: {}", e)))?;

        let mut id_to_token = HashMap::new();
        let mut token_to_id = HashMap::new();

        // Parse the model.vocab section which contains the vocabulary
        // HuggingFace tokenizer.json format has vocab in model.vocab as {"token": id, ...}
        if let Some(model) = json.get("model") {
            if let Some(vocab) = model.get("vocab") {
                if let Some(vocab_obj) = vocab.as_object() {
                    for (token, id_value) in vocab_obj {
                        if let Some(id) = id_value.as_u64() {
                            let id = id as u32;
                            id_to_token.insert(id, token.clone());
                            token_to_id.insert(token.clone(), id);
                        }
                    }
                }
            }
        }

        // Also check for added_tokens which may contain special tokens
        if let Some(added_tokens) = json.get("added_tokens") {
            if let Some(tokens_array) = added_tokens.as_array() {
                for token_obj in tokens_array {
                    if let (Some(id), Some(content)) = (
                        token_obj.get("id").and_then(|v| v.as_u64()),
                        token_obj.get("content").and_then(|v| v.as_str())
                    ) {
                        let id = id as u32;
                        id_to_token.insert(id, content.to_string());
                        token_to_id.insert(content.to_string(), id);
                    }
                }
            }
        }

        if id_to_token.is_empty() {
            return Err(MoonshineError::Tokenizer(
                "No vocabulary found in tokenizer.json".to_string()
            ));
        }

        log::info!("Loaded Moonshine tokenizer with {} tokens", id_to_token.len());

        Ok(Self {
            id_to_token,
            token_to_id,
        })
    }

    /// Decode token IDs to text
    pub fn decode(&self, token_ids: &[u32], skip_special_tokens: bool) -> Result<String, MoonshineError> {
        let mut result = String::new();

        for &id in token_ids {
            if let Some(token) = self.id_to_token.get(&id) {
                // Skip special tokens if requested
                if skip_special_tokens {
                    // Common special tokens to skip
                    if token == "<s>" || token == "</s>" || token == "<pad>" ||
                       token == "<unk>" || token == "[CLS]" || token == "[SEP]" ||
                       token == "[PAD]" || token == "[UNK]" || token == "<|endoftext|>" {
                        continue;
                    }
                }

                // Handle byte-level BPE tokens (like "Ġ" for space)
                let decoded_token = token
                    .replace("Ġ", " ")  // GPT-style space marker
                    .replace("▁", " ")  // SentencePiece space marker
                    .replace("Ċ", "\n"); // GPT-style newline marker

                result.push_str(&decoded_token);
            } else {
                // Unknown token - skip or add placeholder
                log::trace!("Unknown token ID: {}", id);
            }
        }

        Ok(result)
    }

    /// Get vocabulary size
    #[allow(dead_code)]
    pub fn vocab_size(&self) -> usize {
        self.id_to_token.len()
    }
}

pub struct MoonshineModel {
    encoder: Session,
    decoder: Session,
    tokenizer: SimpleTokenizer,
}

impl Drop for MoonshineModel {
    fn drop(&mut self) {
        log::debug!("Dropping MoonshineModel");
    }
}

impl MoonshineModel {
    pub fn new<P: AsRef<Path>>(model_dir: P) -> Result<Self, MoonshineError> {
        let encoder = Self::init_session(&model_dir, "encoder_model")?;
        let decoder = Self::init_session(&model_dir, "decoder_model_merged")?;
        let tokenizer = Self::load_tokenizer(&model_dir)?;

        log::info!(
            "Loaded Moonshine model from {}",
            model_dir.as_ref().display()
        );

        Ok(Self {
            encoder,
            decoder,
            tokenizer,
        })
    }

    fn init_session<P: AsRef<Path>>(
        model_dir: P,
        model_name: &str,
    ) -> Result<Session, MoonshineError> {
        let providers = vec![CPUExecutionProvider::default().build()];

        let model_filename = format!("{}.onnx", model_name);
        log::info!("Loading Moonshine model from {}...", model_filename);

        let session = Session::builder()?
            .with_optimization_level(GraphOptimizationLevel::Level3)?
            .with_execution_providers(providers)?
            .with_parallel_execution(true)?
            .commit_from_file(model_dir.as_ref().join(&model_filename))?;

        // Log all inputs and outputs for debugging
        let input_names: Vec<&str> = session.inputs.iter().map(|i| i.name.as_str()).collect();
        let output_names: Vec<&str> = session.outputs.iter().map(|o| o.name.as_str()).collect();

        log::info!(
            "Moonshine '{}' loaded: inputs={:?}, outputs={:?}",
            model_filename, input_names, output_names
        );

        for input in &session.inputs {
            log::info!(
                "  Input '{}': type={:?}",
                input.name,
                input.input_type
            );
        }

        for output in &session.outputs {
            log::info!(
                "  Output '{}': type={:?}",
                output.name,
                output.output_type
            );
        }

        // Validate expected inputs based on model type
        if model_name == "encoder_model" {
            // Encoder uses positional input (first input) so any single input name is valid
            if input_names.is_empty() {
                log::warn!(
                    "⚠️ Encoder model has no inputs. This will cause transcription to fail."
                );
            } else {
                log::info!(
                    "✅ Encoder model has {} input(s): {:?} (using positional input)",
                    input_names.len(), input_names
                );
            }
        } else if model_name == "decoder_model_merged" {
            let expected_decoder_inputs = ["input_ids", "encoder_hidden_states"];
            for expected in expected_decoder_inputs {
                if !input_names.contains(&expected) {
                    log::warn!(
                        "⚠️ Decoder model missing expected input '{}'. Available inputs: {:?}. \
                        This may cause transcription to fail.",
                        expected, input_names
                    );
                }
            }
        }

        Ok(session)
    }

    fn load_tokenizer<P: AsRef<Path>>(model_dir: P) -> Result<SimpleTokenizer, MoonshineError> {
        let tokenizer_path = model_dir.as_ref().join("tokenizer.json");
        let tokenizer = SimpleTokenizer::from_file(tokenizer_path)?;

        log::info!("Loaded Moonshine tokenizer");
        Ok(tokenizer)
    }

    /// Encode audio samples to hidden states
    fn encode(&mut self, audio_samples: &[f32]) -> Result<ArrayD<f32>, MoonshineError> {
        log::info!(
            "Running Moonshine encoder with {} samples ({:.2}s at 16kHz)",
            audio_samples.len(),
            audio_samples.len() as f64 / 16000.0
        );

        // Moonshine expects audio as [batch_size, sequence_length]
        let batch_size = 1;
        let seq_len = audio_samples.len();

        // Log audio statistics for debugging
        let (min_val, max_val, mean_val) = if !audio_samples.is_empty() {
            let min = audio_samples.iter().cloned().fold(f32::INFINITY, f32::min);
            let max = audio_samples.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
            let sum: f32 = audio_samples.iter().sum();
            let mean = sum / audio_samples.len() as f32;
            (min, max, mean)
        } else {
            (0.0, 0.0, 0.0)
        };
        log::debug!(
            "Audio stats: min={:.4}, max={:.4}, mean={:.6}, shape=[{}, {}]",
            min_val, max_val, mean_val, batch_size, seq_len
        );

        // Log the encoder input name for debugging (different Moonshine exports use different names)
        if let Some(input_info) = self.encoder.inputs.first() {
            log::debug!("Encoder input name: '{}', using positional input", input_info.name);
        }

        // Create input array
        let audio_array = Array2::from_shape_vec((batch_size, seq_len), audio_samples.to_vec())?
            .into_dyn();

        // Use positional input (first input) instead of named input to support
        // different Moonshine model exports that may use different input names
        // (e.g., "args_0", "audio", "input", etc.)
        let inputs = inputs![
            TensorRef::from_array_view(audio_array.view())?,
        ];

        let outputs = self.encoder.run(inputs).map_err(|e| {
            log::error!(
                "Moonshine encoder ORT error: {:?} | Input shape: [{}, {}] | Audio range: [{:.4}, {:.4}]",
                e, batch_size, seq_len, min_val, max_val
            );
            e
        })?;

        // Get encoder output (hidden states)
        // Try different output names that Moonshine models might use
        let hidden_states = if let Some(v) = outputs.get("last_hidden_state") {
            v.try_extract_array()?.to_owned()
        } else if let Some(v) = outputs.get("hidden_states") {
            v.try_extract_array()?.to_owned()
        } else {
            // Fallback to first output
            let first_output = outputs.values().next()
                .ok_or_else(|| MoonshineError::OutputNotFound("hidden_states".to_string()))?;
            first_output.try_extract_array()?.to_owned()
        };

        log::trace!("Encoder output shape: {:?}", hidden_states.shape());

        Ok(hidden_states)
    }

    /// Decode hidden states to text tokens using the merged decoder model.
    ///
    /// The merged decoder model combines initial decoding (without cache) and
    /// cached decoding (with KV cache) into a single model. It requires:
    /// - `use_cache_branch`: Boolean to select which branch to use
    /// - `past_key_values.*`: 32 cache tensors (8 layers × 2 modules × 2 key/value)
    fn decode(&mut self, encoder_output: &ArrayD<f32>) -> Result<Vec<i64>, MoonshineError> {
        log::info!(
            "Running Moonshine decoder with encoder_output shape: {:?}",
            encoder_output.shape()
        );

        let mut tokens: Vec<i64> = vec![BOS_TOKEN_ID];
        let batch_size = 1;

        // Initialize empty past_key_values for all layers
        // Shape: [batch, num_heads, seq_len, head_dim]
        // Initial seq_len is 0 (empty cache)
        let mut past_key_values: HashMap<String, ArrayD<f32>> = HashMap::new();
        for layer in 0..DECODER_NUM_LAYERS {
            for module in ["decoder", "encoder"] {
                for kv in ["key", "value"] {
                    let name = format!("past_key_values.{}.{}.{}", layer, module, kv);
                    let empty_cache = Array4::<f32>::zeros((
                        batch_size,
                        NUM_KEY_VALUE_HEADS,
                        0, // Empty sequence initially
                        HEAD_DIM,
                    ))
                    .into_dyn();
                    past_key_values.insert(name, empty_cache);
                }
            }
        }

        log::debug!(
            "Initialized {} past_key_values tensors with shape [1, {}, 0, {}]",
            past_key_values.len(),
            NUM_KEY_VALUE_HEADS,
            HEAD_DIM
        );

        for step in 0..MAX_TOKENS {
            let use_cache_branch = step > 0;

            // For first step: use full input_ids
            // For subsequent steps: use only the last token (previous tokens are in cache)
            let input_ids_data: Vec<i64> = if use_cache_branch {
                vec![*tokens.last().unwrap()]
            } else {
                tokens.clone()
            };

            let token_seq_len = input_ids_data.len();
            let input_ids =
                Array2::from_shape_vec((batch_size, token_seq_len), input_ids_data)?.into_dyn();

            // Build inputs dynamically to handle all 35 inputs required by the merged decoder
            let step_output = self.run_decoder_with_cache(
                &input_ids,
                encoder_output,
                use_cache_branch,
                &past_key_values,
                step,
            )?;

            // Update past_key_values with new cache values
            past_key_values = step_output.new_cache;

            let logits = step_output.logits;
            log::trace!("Decoder step {} logits shape: {:?}", step, logits.shape());

            // Get vocabulary size from logits shape
            let vocab_size = if logits.shape().len() >= 3 {
                logits.shape()[2]
            } else if logits.shape().len() == 2 {
                logits.shape()[1]
            } else {
                return Err(MoonshineError::OutputNotFound(
                    "Could not determine vocab size from logits".to_string(),
                ));
            };

            // Get the logits for the last token position
            let logits_slice = logits.as_slice().ok_or_else(|| {
                MoonshineError::Shape(ndarray::ShapeError::from_kind(
                    ndarray::ErrorKind::IncompatibleShape,
                ))
            })?;
            let last_token_start = logits_slice.len() - vocab_size;
            let last_logits = &logits_slice[last_token_start..];

            // Find argmax
            let next_token = last_logits
                .iter()
                .enumerate()
                .max_by(|(_, a), (_, b)| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
                .map(|(idx, _)| idx as i64)
                .unwrap_or(EOS_TOKEN_ID);

            log::trace!("Step {}: next token = {}", step, next_token);

            // Check for EOS token
            if next_token == EOS_TOKEN_ID {
                log::debug!("EOS token reached at step {}", step);
                break;
            }

            tokens.push(next_token);
        }

        // Remove BOS token from output
        if !tokens.is_empty() && tokens[0] == BOS_TOKEN_ID {
            tokens.remove(0);
        }

        Ok(tokens)
    }

    /// Run the decoder with cache support using IoBinding.
    /// IoBinding is ideal for models with many inputs (35 in this case).
    /// Returns extracted logits and new cache values to avoid lifetime issues.
    fn run_decoder_with_cache(
        &mut self,
        input_ids: &ArrayD<i64>,
        encoder_output: &ArrayD<f32>,
        use_cache_branch: bool,
        past_key_values: &HashMap<String, ArrayD<f32>>,
        step: usize,
    ) -> Result<DecoderStepOutput, MoonshineError> {
        log::trace!(
            "Running decoder step {} with use_cache_branch={}",
            step,
            use_cache_branch
        );

        // Create owned tensors that live long enough for the IoBinding run
        let input_ids_tensor = Tensor::from_array(input_ids.clone())?;
        let encoder_tensor = Tensor::from_array(encoder_output.clone())?;
        // use_cache_branch must be rank 1 (shape [1]), not rank 0 (scalar)
        // The ONNX model expects: "Invalid rank for input: use_cache_branch Got: 0 Expected: 1"
        let use_cache_array = ndarray::Array1::from_vec(vec![use_cache_branch]);
        let use_cache_tensor = Tensor::from_array(use_cache_array)?;

        // Create all 32 past_key_values tensors (8 layers × 2 modules × 2 kv)
        let mut cache_tensors: Vec<Tensor<f32>> = Vec::with_capacity(32);
        for layer in 0..DECODER_NUM_LAYERS {
            for module in ["decoder", "encoder"] {
                for kv in ["key", "value"] {
                    let name = format!("past_key_values.{}.{}.{}", layer, module, kv);
                    let cache = past_key_values
                        .get(&name)
                        .ok_or_else(|| MoonshineError::InputNotFound(name.clone()))?;
                    cache_tensors.push(Tensor::from_array(cache.clone())?);
                }
            }
        }

        // Create IoBinding for efficient input binding
        let mut binding = self.decoder.create_binding()?;

        // Bind the main inputs
        binding.bind_input("input_ids", &input_ids_tensor)?;
        binding.bind_input("encoder_hidden_states", &encoder_tensor)?;
        binding.bind_input("use_cache_branch", &use_cache_tensor)?;

        // Bind all 32 past_key_values
        let mut cache_idx = 0;
        for layer in 0..DECODER_NUM_LAYERS {
            for module in ["decoder", "encoder"] {
                for kv in ["key", "value"] {
                    let name = format!("past_key_values.{}.{}.{}", layer, module, kv);
                    binding.bind_input(&name, &cache_tensors[cache_idx])?;
                    cache_idx += 1;
                }
            }
        }

        // Run the decoder with the binding
        let outputs = self.decoder.run_binding(&binding)?;

        // Extract logits
        let logits = if let Some(v) = outputs.get("logits") {
            v.try_extract_array::<f32>()?.to_owned()
        } else {
            // Fallback to first output
            let first_output = outputs
                .values()
                .next()
                .ok_or_else(|| MoonshineError::OutputNotFound("logits".to_string()))?;
            first_output.try_extract_array::<f32>()?.to_owned()
        };

        // Extract new cache values from present.* outputs
        let mut new_cache: HashMap<String, ArrayD<f32>> = HashMap::new();
        for layer in 0..DECODER_NUM_LAYERS {
            for module in ["decoder", "encoder"] {
                for kv in ["key", "value"] {
                    let present_name = format!("present.{}.{}.{}", layer, module, kv);
                    let cache_name = format!("past_key_values.{}.{}.{}", layer, module, kv);

                    if let Some(present) = outputs.get(&present_name) {
                        let present_array: ArrayD<f32> =
                            present.try_extract_array::<f32>()?.to_owned();
                        new_cache.insert(cache_name, present_array);
                    } else {
                        // If no new cache value, keep the old one
                        if let Some(old_cache) = past_key_values.get(&cache_name) {
                            new_cache.insert(cache_name, old_cache.clone());
                        }
                    }
                }
            }
        }

        Ok(DecoderStepOutput { logits, new_cache })
    }

    /// Decode token IDs to text
    fn tokens_to_text(&self, tokens: &[i64]) -> Result<String, MoonshineError> {
        // Convert i64 tokens to u32 for tokenizer
        let token_ids: Vec<u32> = tokens.iter().map(|&t| t as u32).collect();

        let text = self.tokenizer.decode(&token_ids, true)?;

        Ok(text.trim().to_string())
    }

    /// Transcribe audio samples to text
    pub fn transcribe(&mut self, audio_samples: Vec<f32>) -> Result<String, MoonshineError> {
        let samples_len = audio_samples.len();
        log::debug!(
            "Moonshine transcribing {} samples ({:.1}s duration)",
            samples_len,
            samples_len as f64 / 16000.0
        );

        // Encode audio to hidden states
        let encoder_output = self.encode(&audio_samples)?;

        // Decode hidden states to tokens
        let tokens = self.decode(&encoder_output)?;

        log::debug!("Decoded {} tokens", tokens.len());

        // Convert tokens to text
        let text = self.tokens_to_text(&tokens)?;

        log::debug!("Moonshine transcription: '{}'", text);

        Ok(text)
    }
}
