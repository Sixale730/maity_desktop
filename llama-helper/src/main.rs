use std::io::{self, BufRead, Write};
use std::num::NonZeroU32;
use std::path::PathBuf;
use std::pin::pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result};
use encoding_rs;
use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{AddBos, LlamaModel, Special};
use serde::{Deserialize, Serialize};

// ============================================================================
// Protocol Messages (JSON over stdin/stdout)
// ============================================================================

// Correlación request/respuesta estilo JSON-RPC 2.0: cada request puede traer un
// `id` que la respuesta correspondiente devuelve tal cual. Permite al cliente
// descartar respuestas de requests que abandonó por timeout SIN matar el proceso
// (antes, la única forma de sanear el pipe era reiniciar el sidecar y recargar
// ~2.4 GB de modelo — el origen del death spiral del coach, jul-2026).
// Compat: `id` es opcional en ambas direcciones; un cliente viejo no lo manda y
// un helper viejo lo ignora (serde descarta campos desconocidos por default).
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Request {
    Generate {
        prompt: String,
        max_tokens: Option<i32>,
        context_size: Option<u32>,
        model_path: Option<String>,
        // Sampling parameters
        temperature: Option<f32>,
        top_k: Option<i32>,
        top_p: Option<f32>,
        stop_tokens: Option<Vec<String>>,
        #[serde(default)]
        id: Option<u64>,
    },
    Ping {
        #[serde(default)]
        id: Option<u64>,
    },
    // Provenance del binario (ago-2026): el cliente y el smoke test del build
    // preguntan qué helper corre. Un helper anterior a 0.1.1 responde `error`
    // ("unknown variant `version`") SIN id — señal utilizable, no rompe nada.
    Version {
        #[serde(default)]
        id: Option<u64>,
    },
    // Sin `id`: la respuesta (Goodbye) no se correlaciona, y serde acepta
    // igualmente un `{"type":"shutdown","id":N}` (ignora campos desconocidos).
    Shutdown,
}

/// Versión del protocolo stdin/stdout: 1 = sin ids; 2 = correlación por `id`
/// + `version`. Súbelo solo cuando cambie la forma de los mensajes.
const PROTOCOL_VERSION: u32 = 2;

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Response {
    Response {
        text: String,
        error: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        id: Option<u64>,
    },
    Pong {
        #[serde(skip_serializing_if = "Option::is_none")]
        id: Option<u64>,
    },
    Version {
        version: &'static str,
        protocol: u32,
        #[serde(skip_serializing_if = "Option::is_none")]
        id: Option<u64>,
    },
    Goodbye,
    Error {
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        id: Option<u64>,
    },
}

// ============================================================================
// Model State Management
// ============================================================================

struct ModelState {
    backend: LlamaBackend,
    model: Option<LlamaModel>,
    model_path: Option<PathBuf>,
    context_size: u32,
    last_activity: Arc<AtomicU64>,
}

impl ModelState {
    fn new() -> Result<Self> {
        let backend = LlamaBackend::init().context("Failed to init LlamaBackend")?;
        Ok(Self {
            backend,
            model: None,
            model_path: None,
            context_size: 2048,
            last_activity: Arc::new(AtomicU64::new(Self::current_timestamp())),
        })
    }

    fn current_timestamp() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs()
    }

    fn update_activity(&self) {
        self.last_activity
            .store(Self::current_timestamp(), Ordering::SeqCst);
    }

    fn seconds_since_activity(&self) -> u64 {
        Self::current_timestamp() - self.last_activity.load(Ordering::SeqCst)
    }

    fn load_model_if_needed(&mut self, model_path: PathBuf, context_size: u32) -> Result<()> {
        // El LlamaModel es independiente del contexto: el LlamaContext se crea
        // por request en generate() usando self.context_size. Recargar el GGUF
        // entero (2.4 GB de disco→RAM, con doble residencia transitoria)
        // porque cambió n_ctx era puro desperdicio — coach (4096) y summary
        // (32768) comparten proceso cuando usan el mismo modelo.
        self.context_size = context_size;

        // Check if model is already loaded
        if let Some(ref loaded_path) = self.model_path {
            if loaded_path == &model_path {
                eprintln!("✓ Model already loaded (ctx={})", context_size);
                self.update_activity();
                return Ok(());
            }
        }

        eprintln!("📥 Loading model: {}", model_path.display());

        // Delegamos la decisión de offload a llama.cpp: pasamos 999 (más capas
        // que cualquier modelo realista) y llama.cpp internamente consulta la
        // VRAM real del driver de GPU, conoce la geometría exacta del modelo
        // (leyendo el GGUF), y ofloadea cuántas capas quepan. Si una capa no
        // cabe, la deja en CPU sin error. Patrón estándar documentado:
        //   https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md
        //   https://github.com/ggml-org/llama.cpp/discussions/7678
        // Configure model parameters with GPU offload
        let model_params = LlamaModelParams::default().with_n_gpu_layers(999);
        let model_params = pin!(model_params);

        let model = LlamaModel::load_from_file(&self.backend, model_path.clone(), &model_params)
            .with_context(|| format!("unable to load model at {:?}", model_path))?;

        self.model = Some(model);
        self.model_path = Some(model_path);
        self.context_size = context_size;
        self.update_activity();

        eprintln!("✅ Model loaded successfully");
        Ok(())
    }

    fn generate(
        &mut self,
        prompt: String,
        max_tokens: i32,
        temperature: f32,
        top_k: i32,
        top_p: f32,
        stop_tokens: Vec<String>,
    ) -> Result<String> {
        let start_time = Instant::now();
        let model = self.model.as_ref().context("Model not loaded")?;

        // (cores/2) acotado a [1,4]: el helper convive con Parakeet (ONNX,
        // hasta 4 hilos) y la UI. El viejo (cores/2)+2 daba 4 hilos en un
        // laptop de 4 núcleos = 100% de la máquina durante cada generación.
        let threads: i32 = std::thread::available_parallelism()
            .map(|n| ((n.get() as i32) / 2).clamp(1, 4))
            .unwrap_or(2);

        // n_batch controla el compute buffer de llama.cpp (escala ~lineal con
        // n_batch × vocab, y gemma-3 tiene vocab ~262k): igualarlo a n_ctx
        // inflaba cientos de MB por generación. 512 es el default de
        // llama.cpp; el prompt se decodea por bloques de 512 más abajo.
        const N_BATCH: usize = 512;

        let ctx_params = LlamaContextParams::default()
            .with_n_ctx(Some(
                NonZeroU32::new(self.context_size).context("Invalid ctx size")?,
            ))
            .with_n_batch(N_BATCH as u32)
            .with_n_threads(threads)
            .with_n_threads_batch(threads);

        let mut ctx = model
            .new_context(&self.backend, ctx_params)
            .context("unable to create the llama_context")?;

        let tokens_list = model
            .str_to_token(&prompt, AddBos::Always)
            .with_context(|| "failed to tokenize prompt")?;

        eprintln!("📝 Tokenized prompt: {} tokens", tokens_list.len());

        if tokens_list.len() >= self.context_size as usize {
            anyhow::bail!(
                "Prompt de {} tokens excede n_ctx={} — truncar el contexto antes de llamar",
                tokens_list.len(),
                self.context_size
            );
        }

        // Decode del prompt por bloques de N_BATCH; solo el último token del
        // prompt pide logits (is_last), que es donde muestrea la generación.
        let mut batch = LlamaBatch::new(N_BATCH, 1);
        let last_index = tokens_list.len() - 1;
        let mut fed = 0usize;
        while fed < tokens_list.len() {
            batch.clear();
            let end = (fed + N_BATCH).min(tokens_list.len());
            for j in fed..end {
                let is_last = j == last_index;
                batch
                    .add(tokens_list[j], j as i32, &[0], is_last)
                    .context("Failed to add token to batch")?;
            }
            ctx.decode(&mut batch).context("llama_decode() failed")?;
            fed = end;
        }
        let prompt_time = start_time.elapsed();

        let n_prompt_tokens = tokens_list.len() as i32;
        let mut n_cur = n_prompt_tokens;
        let mut decoder = encoding_rs::UTF_8.new_decoder();
        let mut output = String::new();

        eprintln!("🔄 Starting generation (max_tokens: {})", max_tokens);

        loop {
            // Check if we've generated enough tokens
            if (n_cur - n_prompt_tokens) >= max_tokens {
                eprintln!("✓ Reached max_tokens limit");
                break;
            }

            use llama_cpp_2::sampling::LlamaSampler;

            let sampler = if temperature <= 0.0 {
                // Greedy sampling for temp <= 0
                LlamaSampler::chain_simple([LlamaSampler::greedy()])
            } else {
                // Random sampling with temperature/top_k/top_p
                let seed = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u32;

                LlamaSampler::chain_simple([
                    LlamaSampler::top_k(top_k),
                    LlamaSampler::top_p(top_p, 1),
                    LlamaSampler::temp(temperature),
                    LlamaSampler::dist(seed),
                ])
            };

            let mut sampler = pin!(sampler);
            let token = sampler.as_mut().sample(&ctx, batch.n_tokens() - 1);
            sampler.as_mut().accept(token);

            if model.is_eog_token(token) {
                eprintln!(
                    "✓ End-of-generation token reached (generated {} chars)",
                    output.len()
                );
                break;
            }

            let output_bytes = model
                .token_to_bytes(token, Special::Tokenize)
                .context("Failed to convert token to bytes")?;

            let mut token_text = String::with_capacity(32);
            let _ = decoder.decode_to_string(&output_bytes, &mut token_text, false);
            output.push_str(&token_text);

            // Check for model-specific stop tokens
            let mut should_stop = false;
            for stop_token in &stop_tokens {
                if output.contains(stop_token) {
                    eprintln!(
                        "✓ Stop token '{}' detected (generated {} chars)",
                        stop_token,
                        output.len()
                    );
                    // Remove the stop token from output
                    output = output.replace(stop_token, "").trim_end().to_string();
                    should_stop = true;
                    break;
                }
            }
            if should_stop {
                break;
            }

            batch.clear();
            batch
                .add(token, n_cur, &[0], true)
                .context("Failed to add generated token to batch")?;
            n_cur += 1;
            ctx.decode(&mut batch).context("failed to eval")?;
        }

        // Generation statistics
        let total_time = start_time.elapsed();
        let gen_time = total_time.saturating_sub(prompt_time);
        let output_tokens = (n_cur - n_prompt_tokens) as u64;
        let prompt_tokens = n_prompt_tokens as u64;

        let tokens_per_sec = if gen_time.as_secs_f64() > 0.0 {
            output_tokens as f64 / gen_time.as_secs_f64()
        } else {
            0.0
        };

        eprintln!("📊 Generation Statistics:");
        eprintln!("   • Prompt tokens: {}", prompt_tokens);
        eprintln!("   • Output tokens: {}", output_tokens);
        eprintln!("   • Prompt processing: {:.2}s", prompt_time.as_secs_f64());
        eprintln!("   • Generation time: {:.2}s", gen_time.as_secs_f64());
        eprintln!("   • Total time: {:.2}s", total_time.as_secs_f64());
        eprintln!("   • Speed: {:.2} tokens/sec", tokens_per_sec);

        self.update_activity();
        Ok(output)
    }
}

// ============================================================================
// Main Loop with Keep-Alive Protocol
// ============================================================================

fn send_response(response: &Response) -> Result<()> {
    let json = serde_json::to_string(response)?;
    println!("{}", json);
    io::stdout().flush()?;
    Ok(())
}

fn main() -> Result<()> {
    // Get idle timeout from environment variable (default 5 minutes)
    let idle_timeout_secs = std::env::var("LLAMA_IDLE_TIMEOUT")
        .ok()
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(300); // 5 minutes default

    eprintln!(
        "🦙 llama-helper starting (idle timeout: {}s)",
        idle_timeout_secs
    );

    let mut state = ModelState::new()?;

    let stdin = io::stdin();
    let mut stdin_lock = stdin.lock();
    let mut buffer = String::new();

    loop {
        // Check idle timeout
        if state.seconds_since_activity() > idle_timeout_secs {
            eprintln!("💤 Idle timeout reached, shutting down");
            send_response(&Response::Goodbye)?;
            break;
        }

        // Read line from stdin
        buffer.clear();
        match stdin_lock.read_line(&mut buffer) {
            Ok(0) => {
                // EOF reached
                eprintln!("📪 EOF received, shutting down");
                break;
            }
            Ok(_) => {
                // Tolerar un BOM UTF-8 inicial: Windows PowerShell 5.1 lo antepone
                // al pipear a un exe nativo con $OutputEncoding UTF-8 (lo vio el
                // smoke test del build); sin esto serde falla en "line 1 column 1".
                let line = buffer.trim().trim_start_matches('\u{feff}');
                if line.is_empty() {
                    continue;
                }

                // Parse request
                match serde_json::from_str::<Request>(line) {
                    Ok(Request::Generate {
                        prompt,
                        max_tokens,
                        context_size,
                        model_path,
                        temperature,
                        top_k,
                        top_p,
                        stop_tokens,
                        id,
                    }) => {
                        let max_tokens = max_tokens.unwrap_or(512);
                        let context_size = context_size.unwrap_or(2048);

                        // Sampling parameters with sensible defaults
                        let temperature = temperature.unwrap_or(1.0);
                        let top_k = top_k.unwrap_or(64);
                        let top_p = top_p.unwrap_or(0.95);
                        let stop_tokens = stop_tokens.unwrap_or_else(Vec::new);

                        // Load model if path provided
                        if let Some(path_str) = model_path {
                            let path = PathBuf::from(path_str);
                            if let Err(e) = state.load_model_if_needed(path, context_size) {
                                send_response(&Response::Response {
                                    text: String::new(),
                                    error: Some(format!("Failed to load model: {}", e)),
                                    id,
                                })?;
                                continue;
                            }
                        }

                        // Generate response with sampling parameters
                        match state.generate(
                            prompt,
                            max_tokens,
                            temperature,
                            top_k,
                            top_p,
                            stop_tokens,
                        ) {
                            Ok(text) => {
                                send_response(&Response::Response { text, error: None, id })?;
                            }
                            Err(e) => {
                                send_response(&Response::Response {
                                    text: String::new(),
                                    error: Some(format!("Generation failed: {}", e)),
                                    id,
                                })?;
                            }
                        }
                    }
                    Ok(Request::Ping { id }) => {
                        state.update_activity();
                        send_response(&Response::Pong { id })?;
                    }
                    Ok(Request::Version { id }) => {
                        state.update_activity();
                        send_response(&Response::Version {
                            version: env!("CARGO_PKG_VERSION"),
                            protocol: PROTOCOL_VERSION,
                            id,
                        })?;
                    }
                    Ok(Request::Shutdown) => {
                        eprintln!("🛑 Shutdown requested");
                        send_response(&Response::Goodbye)?;
                        break;
                    }
                    Err(e) => {
                        eprintln!("❌ Failed to parse request: {}", e);
                        send_response(&Response::Error {
                            message: format!("Invalid request: {}", e),
                            id: None,
                        })?;
                    }
                }
            }
            Err(e) => {
                eprintln!("❌ Error reading stdin: {}", e);
                break;
            }
        }
    }

    eprintln!("👋 llama-helper exiting");
    Ok(())
}
