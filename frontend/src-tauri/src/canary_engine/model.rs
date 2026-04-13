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
    #[error("ORT error: {0}")]
    Ort(#[from] ort::Error),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("ndarray shape error: {0}")]
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
    token_to_id: HashMap<String, i64>,
    id_to_token: HashMap<i64, String>,
    eos_token_id: i64,
    // Full Canary prompt (9 tokens)
    transcribe_prompt: Vec<i64>,
    source_lang_ids: HashMap<String, i64>,
    source_lang_pos: usize,
    target_lang_pos: usize,
    // Decoder KV-cache metadata
    decoder_mems_shape: Vec<i64>,
    // ONNX metadata (auto-detected at init)
    transpose_mel_input: bool,
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

        let (vocab, token_to_id, id_to_token) = Self::load_vocab(&model_dir)?;

        // Find EOS token
        let eos_token_id = *token_to_id
            .get("<|endoftext|>")
            .ok_or_else(|| CanaryError::TokenNotFound("<|endoftext|>".to_string()))?;

        // Build language token map
        let mut source_lang_ids = HashMap::new();
        for lang in &["es", "en", "de", "fr"] {
            let token = format!("<|{lang}|>");
            if let Some(&id) = token_to_id.get(&token) {
                source_lang_ids.insert(lang.to_string(), id);
            }
        }

        // Find all special tokens for the 9-token prompt (graceful fallback if missing)
        let find_token = |name: &str| -> i64 {
            match token_to_id.get(name) {
                Some(&id) => id,
                None => {
                    log::warn!(
                        "Canary special token '{}' not found in vocab, using 0 as fallback",
                        name
                    );
                    0
                }
            }
        };

        let startofcontext_id = find_token("<|startofcontext|>");
        let startoftranscript_id = find_token("<|startoftranscript|>");
        let emo_undefined_id = find_token("<|emo:undefined|>");
        let en_id = source_lang_ids
            .get("en")
            .copied()
            .unwrap_or_else(|| find_token("<|en|>"));
        let pnc_id = find_token("<|pnc|>");
        let noitn_id = find_token("<|noitn|>");
        let notimestamp_id = find_token("<|notimestamp|>");
        let nodiarize_id = find_token("<|nodiarize|>");

        // Build full 9-token prompt:
        // [startofcontext, startoftranscript, emo:undefined, source_lang, target_lang, pnc, noitn, notimestamp, nodiarize]
        let source_lang_pos = 3;
        let target_lang_pos = 4;
        let transcribe_prompt = vec![
            startofcontext_id,    // 0
            startoftranscript_id, // 1
            emo_undefined_id,     // 2
            en_id,                // 3 - source_lang (default: en)
            en_id,                // 4 - target_lang (default: en)
            pnc_id,               // 5
            noitn_id,             // 6
            notimestamp_id,       // 7
            nodiarize_id,         // 8
        ];

        log::info!("Canary prompt tokens (9): {:?}", transcribe_prompt);

        // Extract decoder_mems shape from decoder ONNX inputs
        // Reference: decoder_mems_shape = [x if x > 0 else 0 for x in decoder.get_inputs()[-1].shape]
        let decoder_mems_shape = decoder
            .inputs
            .iter()
            .find(|i| i.name == "decoder_mems")
            .and_then(|i| i.input_type.tensor_shape())
            .map(|shape| {
                shape
                    .iter()
                    .map(|&d| if d > 0 { d } else { 0 })
                    .collect::<Vec<i64>>()
            })
            .unwrap_or_else(|| {
                // Fallback: try last decoder input
                let fallback = decoder
                    .inputs
                    .last()
                    .and_then(|i| i.input_type.tensor_shape())
                    .map(|shape| {
                        shape
                            .iter()
                            .map(|&d| if d > 0 { d } else { 0 })
                            .collect::<Vec<i64>>()
                    })
                    .unwrap_or_else(|| vec![0, 0, 0, 0]);
                log::warn!(
                    "Could not find 'decoder_mems' input by name, using last input shape: {:?}",
                    fallback
                );
                fallback
            });

        log::info!(
            "decoder_mems shape from ONNX: {:?} (0 = dynamic dim)",
            decoder_mems_shape
        );

        // Auto-detect transpose
        let transpose_mel_input = Self::detect_transpose_needed(&encoder);

        log::info!(
            "Canary ONNX metadata: transpose_mel={}",
            transpose_mel_input
        );

        log::info!(
            "Loaded Canary vocabulary with {} tokens, eos={}, langs={:?}",
            vocab.len(),
            eos_token_id,
            source_lang_ids.keys().collect::<Vec<_>>()
        );

        Ok(Self {
            encoder,
            decoder,
            vocab,
            token_to_id,
            id_to_token,
            eos_token_id,
            transcribe_prompt,
            source_lang_ids,
            source_lang_pos,
            target_lang_pos,
            decoder_mems_shape,
            transpose_mel_input,
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

    /// Detect if encoder expects [batch, mel, time] or [batch, time, mel]
    /// by checking which axis has the fixed dimension 128 (mel bins).
    fn detect_transpose_needed(encoder: &Session) -> bool {
        // Find the audio signal input (float tensor, not the length input)
        let audio_input = encoder
            .inputs
            .iter()
            .find(|i| i.name == "audio_signal" || i.name == "input" || i.name == "audio")
            .or_else(|| encoder.inputs.first());

        if let Some(input) = audio_input {
            if let Some(shape) = input.input_type.tensor_shape() {
                log::info!(
                    "Canary encoder input '{}' shape: {:?}",
                    input.name,
                    shape
                );
                if shape.len() >= 3 {
                    let dim1 = shape[1];
                    let dim2 = shape[2];

                    if dim1 == 128 {
                        // Shape is [batch, 128, time] → encoder expects [batch, mel, time]
                        // Preprocessor outputs [batch, time, mel] → NEEDS transpose
                        log::info!(
                            "Canary encoder expects [batch, mel, time] → transpose needed"
                        );
                        return true;
                    } else if dim2 == 128 {
                        // Shape is [batch, time, 128] → encoder expects [batch, time, mel]
                        // Preprocessor outputs [batch, time, mel] → NO transpose
                        log::info!(
                            "Canary encoder expects [batch, time, mel] → no transpose needed"
                        );
                        return false;
                    }
                    // Both dynamic: default to no transpose (Parakeet convention)
                    log::warn!(
                        "Canary encoder dims all dynamic ({:?}), defaulting to no transpose",
                        shape
                    );
                }
            }
        }

        // Default: no transpose (matches Parakeet convention)
        log::warn!("Could not detect Canary encoder layout, defaulting to no transpose");
        false
    }

    fn load_vocab<P: AsRef<Path>>(
        model_dir: P,
    ) -> Result<(Vec<String>, HashMap<String, i64>, HashMap<i64, String>), CanaryError> {
        let vocab_path = model_dir.as_ref().join("vocab.txt");
        let content = fs::read_to_string(&vocab_path)?;

        let mut vocab = Vec::new();
        let mut token_to_id = HashMap::new();

        for (idx, line) in content.lines().enumerate() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            // vocab.txt format: "token id" (e.g., "<|endoftext|> 3") or just "token"
            let (token, id) = if let Some(last_space) = trimmed.rfind(' ') {
                let potential_token = &trimmed[..last_space];
                let potential_id = &trimmed[last_space + 1..];
                if let Ok(parsed_id) = potential_id.parse::<i64>() {
                    (potential_token.to_string(), parsed_id)
                } else {
                    (trimmed.to_string(), idx as i64)
                }
            } else {
                (trimmed.to_string(), idx as i64)
            };

            token_to_id.insert(token.clone(), id);
            vocab.push(token);
        }

        // Build reverse lookup: id → token (for decoding)
        let id_to_token: HashMap<i64, String> = token_to_id
            .iter()
            .map(|(token, &id)| (id, token.clone()))
            .collect();

        log::info!(
            "Loaded vocab from {:?}: {} tokens, {} unique ids",
            vocab_path.file_name().unwrap_or_default(),
            vocab.len(),
            id_to_token.len()
        );

        Ok((vocab, token_to_id, id_to_token))
    }

    /// Encode audio features using the encoder.
    /// Input: mel spectrogram [1, n_frames, n_mel]
    /// Output: (encoder_embeddings, encoder_mask) — both outputs needed by decoder
    pub fn encode(
        &mut self,
        mel_features: &Array3<f32>,
    ) -> Result<(ndarray::ArrayD<f32>, ndarray::ArrayD<i64>), CanaryError> {
        let n_frames = mel_features.shape()[1];

        let mel_dyn = if self.transpose_mel_input {
            // Encoder expects [batch, mel, time]
            log::debug!(
                "Transposing mel [1, {}, 128] → [1, 128, {}]",
                n_frames,
                n_frames
            );
            let transposed = mel_features.view().permuted_axes([0, 2, 1]);
            transposed.as_standard_layout().into_owned().into_dyn()
        } else {
            // Encoder expects [batch, time, mel] (Parakeet convention)
            log::debug!("Sending mel as-is [1, {}, 128]", n_frames);
            mel_features.clone().into_dyn()
        };

        let audio_length = Array1::from_vec(vec![n_frames as i64]).into_dyn();

        log::debug!(
            "Canary encoder input: shape={:?}, length={}",
            mel_dyn.shape(),
            n_frames
        );

        // Collect output names before running (avoids borrow conflict with run())
        let output_names: Vec<String> = self
            .encoder
            .outputs
            .iter()
            .map(|o| o.name.clone())
            .collect();
        log::debug!("Canary encoder output names: {:?}", output_names);

        if output_names.len() < 2 {
            return Err(CanaryError::OutputNotFound(format!(
                "Expected 2 encoder outputs (embeddings + mask), got {} (names: {:?})",
                output_names.len(),
                output_names
            )));
        }

        let inputs = inputs![
            "audio_signal" => TensorRef::from_array_view(mel_dyn.view())?,
            "length" => TensorRef::from_array_view(audio_length.view())?,
        ];

        let outputs = self.encoder.run(inputs)?;

        // First output: encoder_embeddings (float32)
        let embeddings = outputs
            .get(&output_names[0])
            .ok_or_else(|| {
                CanaryError::OutputNotFound(format!(
                    "encoder embeddings '{}' (available: {:?})",
                    output_names[0],
                    outputs.keys().collect::<Vec<_>>()
                ))
            })?
            .try_extract_array::<f32>()?
            .to_owned();

        // Second output: encoder_mask (try f32, fallback to i64 conversion)
        let mask_value = outputs.get(&output_names[1]).ok_or_else(|| {
            CanaryError::OutputNotFound(format!(
                "encoder mask '{}' (available: {:?})",
                output_names[1],
                outputs.keys().collect::<Vec<_>>()
            ))
        })?;

        let mask = match mask_value.try_extract_array::<i64>() {
            Ok(arr) => arr.to_owned(),
            Err(_) => {
                log::debug!("encoder_mask is not i64, trying f32 conversion");
                mask_value
                    .try_extract_array::<f32>()?
                    .mapv(|x| x as i64)
            }
        };

        log::debug!(
            "Canary encoder: embeddings shape={:?}, mask shape={:?}",
            embeddings.shape(),
            mask.shape()
        );

        Ok((embeddings, mask))
    }

    /// Autoregressive decoder step with correct 4-input signature.
    /// Inputs: input_ids, encoder_embeddings, encoder_mask, decoder_mems (KV-cache)
    /// Outputs: (logits, new_decoder_hidden_states)
    fn decoder_step(
        &mut self,
        input_ids: &ndarray::ArrayD<i64>,
        encoder_embeddings: &ndarray::ArrayD<f32>,
        encoder_mask: &ndarray::ArrayD<i64>,
        decoder_mems: &ndarray::ArrayD<f32>,
    ) -> Result<(ndarray::ArrayD<f32>, ndarray::ArrayD<f32>), CanaryError> {
        log::trace!(
            "Canary decoder step: input_ids={:?}, enc={:?}, mask={:?}, mems={:?}",
            input_ids.shape(),
            encoder_embeddings.shape(),
            encoder_mask.shape(),
            decoder_mems.shape()
        );

        // Collect output names before running (avoids borrow conflict with run())
        let decoder_output_names: Vec<String> = self
            .decoder
            .outputs
            .iter()
            .map(|o| o.name.clone())
            .collect();

        let inputs = inputs![
            "input_ids" => TensorRef::from_array_view(input_ids.view())?,
            "encoder_embeddings" => TensorRef::from_array_view(encoder_embeddings.view())?,
            "encoder_mask" => TensorRef::from_array_view(encoder_mask.view())?,
            "decoder_mems" => TensorRef::from_array_view(decoder_mems.view())?,
        ];

        let outputs = self.decoder.run(inputs)?;

        if decoder_output_names.len() < 2 {
            return Err(CanaryError::OutputNotFound(format!(
                "Expected 2 decoder outputs (logits + hidden_states), got {} (names: {:?})",
                decoder_output_names.len(),
                decoder_output_names
            )));
        }

        // First output: logits [batch, seq_len, vocab_size]
        let logits = outputs
            .get(&decoder_output_names[0])
            .ok_or_else(|| {
                CanaryError::OutputNotFound(format!(
                    "decoder logits '{}' (available: {:?})",
                    decoder_output_names[0],
                    outputs.keys().collect::<Vec<_>>()
                ))
            })?
            .try_extract_array::<f32>()?
            .to_owned();

        // Second output: decoder_hidden_states (updated KV-cache for next step)
        let new_mems = outputs
            .get(&decoder_output_names[1])
            .ok_or_else(|| {
                CanaryError::OutputNotFound(format!(
                    "decoder hidden_states '{}' (available: {:?})",
                    decoder_output_names[1],
                    outputs.keys().collect::<Vec<_>>()
                ))
            })?
            .try_extract_array::<f32>()?
            .to_owned();

        Ok((logits, new_mems))
    }

    /// Greedy autoregressive decoding with KV-cache.
    /// First step sends full prompt; subsequent steps send only the last token.
    pub fn greedy_decode(
        &mut self,
        encoder_embeddings: &ndarray::ArrayD<f32>,
        encoder_mask: &ndarray::ArrayD<i64>,
        language: Option<&str>,
        max_tokens: usize,
    ) -> Result<String, CanaryError> {
        // Build prompt with language override
        let mut prompt = self.transcribe_prompt.clone();
        if let Some(lang) = language {
            if let Some(&lang_id) = self.source_lang_ids.get(lang) {
                prompt[self.source_lang_pos] = lang_id; // source lang
                prompt[self.target_lang_pos] = lang_id; // target lang = same
            }
        }

        let prefix_len = prompt.len();
        let mut batch_tokens: Vec<i64> = prompt;

        // Initialize empty decoder_mems (KV-cache starts empty)
        // Shape from ONNX metadata, with 0 for dynamic dims
        let mems_shape: Vec<usize> = self
            .decoder_mems_shape
            .iter()
            .map(|&d| d as usize)
            .collect();
        let mut decoder_mems = ndarray::ArrayD::<f32>::zeros(ndarray::IxDyn(&mems_shape));

        log::debug!(
            "Canary decode: prompt_len={}, initial_mems_shape={:?}",
            prefix_len,
            mems_shape
        );

        for step in 0..max_tokens {
            // First step: send full prompt (mems is empty). After: send only last token.
            let input_ids = if decoder_mems.shape().get(2).copied().unwrap_or(0) == 0 {
                // First step: full prompt
                Array2::from_shape_vec((1, batch_tokens.len()), batch_tokens.clone())?.into_dyn()
            } else {
                // Subsequent steps: only last token (KV cache has history)
                let last = *batch_tokens.last().unwrap_or(&self.eos_token_id);
                Array2::from_shape_vec((1, 1), vec![last])?.into_dyn()
            };

            let (logits, new_mems) = self.decoder_step(
                &input_ids,
                encoder_embeddings,
                encoder_mask,
                &decoder_mems,
            )?;
            decoder_mems = new_mems;

            // Greedy: argmax of last token position
            let logits_shape = logits.shape();
            let vocab_size = *logits_shape.last().unwrap_or(&0);
            let last_pos = logits_shape.get(1).copied().unwrap_or(1) - 1;

            let next_token = (0..vocab_size)
                .max_by(|&a, &b| {
                    let va = logits
                        .get(IxDyn(&[0, last_pos, a]))
                        .copied()
                        .unwrap_or(f32::NEG_INFINITY);
                    let vb = logits
                        .get(IxDyn(&[0, last_pos, b]))
                        .copied()
                        .unwrap_or(f32::NEG_INFINITY);
                    va.partial_cmp(&vb).unwrap_or(std::cmp::Ordering::Equal)
                })
                .map(|idx| idx as i64)
                .unwrap_or(self.eos_token_id);

            if next_token == self.eos_token_id {
                log::debug!(
                    "Canary EOS at step {} (total tokens: {})",
                    step,
                    batch_tokens.len()
                );
                break;
            }

            batch_tokens.push(next_token);
        }

        // Decode tokens to text (skip prompt, use id_to_token for correct lookup)
        let output_tokens = &batch_tokens[prefix_len..];
        let text: String = output_tokens
            .iter()
            .filter_map(|&id| {
                self.id_to_token.get(&id).and_then(|token| {
                    // Skip special tokens in output
                    if token.starts_with("<|") && token.ends_with("|>") {
                        None
                    } else {
                        Some(token.replace('\u{2581}', " "))
                    }
                })
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

        // 2. Encode (returns both embeddings and mask)
        let (encoder_embeddings, encoder_mask) = self.encode(&mel)?;
        log::debug!(
            "Canary encoder output: embeddings={:?}, mask={:?}",
            encoder_embeddings.shape(),
            encoder_mask.shape()
        );

        // 3. Greedy decode with KV-cache
        let text = self.greedy_decode(&encoder_embeddings, &encoder_mask, language, 256)?;
        log::debug!("Canary transcription: '{}'", text);

        Ok(text)
    }
}
