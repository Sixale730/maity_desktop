use crate::parakeet_engine::manifest::{self, FileSpec};
use crate::parakeet_engine::model::ParakeetModel;
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::fs;
use tokio::io::{AsyncWriteExt, BufWriter};
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use tokio::time::timeout;

/// Quantization type for Parakeet models
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum QuantizationType {
    FP32,   // Full precision
    Int8,   // 8-bit integer quantization (faster)
}

impl Default for QuantizationType {
    fn default() -> Self {
        QuantizationType::Int8 // Default to int8 for best performance
    }
}

/// Model status for Parakeet models
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ModelStatus {
    Available,
    Missing,
    Downloading { progress: u8 },
    Error(String),
    Corrupted { file_size: u64, expected_min_size: u64 },
}

/// Detailed download progress info (MB-based with speed)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadProgress {
    /// Bytes downloaded so far
    pub downloaded_bytes: u64,
    /// Total file size in bytes
    pub total_bytes: u64,
    /// Downloaded in MB (for display)
    pub downloaded_mb: f64,
    /// Total size in MB (for display)
    pub total_mb: f64,
    /// Download speed in MB/s
    pub speed_mbps: f64,
    /// Percentage complete (0-100)
    pub percent: u8,
}

impl DownloadProgress {
    pub fn new(downloaded: u64, total: u64, speed_mbps: f64) -> Self {
        let percent = if total > 0 {
            ((downloaded as f64 / total as f64) * 100.0).min(100.0) as u8
        } else {
            0
        };
        Self {
            downloaded_bytes: downloaded,
            total_bytes: total,
            downloaded_mb: downloaded as f64 / (1024.0 * 1024.0),
            total_mb: total as f64 / (1024.0 * 1024.0),
            speed_mbps,
            percent,
        }
    }
}

/// Information about a Parakeet model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub name: String,
    pub path: PathBuf,
    pub size_mb: u32,
    pub quantization: QuantizationType,
    pub speed: String,     // Performance description
    pub status: ModelStatus,
    pub description: String,
}

#[derive(Debug)]
pub enum ParakeetEngineError {
    ModelNotLoaded,
    ModelNotFound(String),
    TranscriptionFailed(String),
    DownloadFailed(String),
    IoError(std::io::Error),
    Other(String),
}

impl std::fmt::Display for ParakeetEngineError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ParakeetEngineError::ModelNotLoaded => write!(f, "No Parakeet model loaded"),
            ParakeetEngineError::ModelNotFound(name) => write!(f, "Model '{}' not found", name),
            ParakeetEngineError::TranscriptionFailed(err) => write!(f, "Transcription failed: {}", err),
            ParakeetEngineError::DownloadFailed(err) => write!(f, "Download failed: {}", err),
            ParakeetEngineError::IoError(err) => write!(f, "IO error: {}", err),
            ParakeetEngineError::Other(err) => write!(f, "Error: {}", err),
        }
    }
}

impl std::error::Error for ParakeetEngineError {}

impl From<std::io::Error> for ParakeetEngineError {
    fn from(err: std::io::Error) -> Self {
        ParakeetEngineError::IoError(err)
    }
}

/// Cuántas inferencias entre recycles de la sesión ONNX.
///
/// La defensa principal contra bloat de memoria nativa es la config en
/// `model.rs` (with_arena_allocator(false) + with_memory_pattern(false));
/// con esa fix, en condiciones normales NO debería hacer falta reciclar.
///
/// Este threshold es la red de seguridad pasiva por si el bloat reaparece
/// en sesiones muy largas. Calibrado a partir de uso real (sesión de 10 min
/// generó 448 inferencias):
///   1 inferencia ≈ 1.34 s
///   2700 inferencias ≈ 60 min de uso continuo
///
/// Filosofía: en reuniones típicas (5-30 min) NO dispara → cero overhead.
/// En sesiones largas (1 h+) dispara 1 vez en background, transparente para
/// el worker. Microsoft documenta (issues #5176, #11118) que reciclar
/// sesiones agresivamente puede empeorar la memoria, no mejorarla, por eso
/// preferimos un threshold alto.
const PARAKEET_RECYCLE_EVERY: u64 = 2700;

/// Tiempo mínimo entre recycles consecutivos (anti-storm).
///
/// Con threshold=2700 esta guarda casi nunca activa, pero protege contra un
/// edge case donde un bug inflara el contador rápido (ej. doble incremento
/// por race) y disparara dos reciclajes encadenados que cargarían 670 MB de
/// disco innecesariamente. 5 min da margen cómodo para que un bug así
/// aparezca en logs antes de que se encadenen reciclajes.
const PARAKEET_RECYCLE_MIN_GAP_SECS: u64 = 300;

pub struct ParakeetEngine {
    models_dir: PathBuf,
    current_model: Arc<RwLock<Option<ParakeetModel>>>,
    current_model_name: Arc<RwLock<Option<String>>>,
    pub(crate) available_models: Arc<RwLock<HashMap<String, ModelInfo>>>,
    cancel_download_flag: Arc<RwLock<Option<String>>>, // Model name being cancelled
    // Active downloads tracking to prevent concurrent downloads
    pub(crate) active_downloads: Arc<RwLock<HashSet<String>>>, // Set of models currently being downloaded
    /// Lifecycle de la sesión ONNX. Cuenta inferencias y dispara recycle en
    /// background cuando se cruza el threshold. Reemplaza el counter inline
    /// del UX-012 viejo, que bloqueaba el worker durante el reload.
    lifecycle: Arc<crate::audio::transcription::onnx_lifecycle::OnnxSessionLifecycle>,
}

impl ParakeetEngine {
    /// Create a new Parakeet engine with optional custom models directory
    pub fn new_with_models_dir(models_dir: Option<PathBuf>) -> Result<Self> {
        let models_dir = if let Some(dir) = models_dir {
            dir.join("parakeet") // Parakeet models in subdirectory
        } else {
            // Fallback to default location
            let current_dir = std::env::current_dir()
                .map_err(|e| anyhow!("Failed to get current directory: {}", e))?;

            if cfg!(debug_assertions) {
                // Development mode
                current_dir.join("models").join("parakeet")
            } else {
                // Production mode
                dirs::data_dir()
                    .or_else(|| dirs::home_dir())
                    .ok_or_else(|| anyhow!("Could not find system data directory"))?
                    .join("Maity")
                    .join("models")
                    .join("parakeet")
            }
        };

        log::info!("ParakeetEngine using models directory: {}", models_dir.display());

        // Create directory if it doesn't exist
        if !models_dir.exists() {
            std::fs::create_dir_all(&models_dir)?;
        }

        Ok(Self {
            models_dir,
            current_model: Arc::new(RwLock::new(None)),
            current_model_name: Arc::new(RwLock::new(None)),
            available_models: Arc::new(RwLock::new(HashMap::new())),
            cancel_download_flag: Arc::new(RwLock::new(None)),
            // Initialize active downloads tracking
            active_downloads: Arc::new(RwLock::new(HashSet::new())),
            lifecycle: Arc::new(
                crate::audio::transcription::onnx_lifecycle::OnnxSessionLifecycle::new(
                    "parakeet",
                    PARAKEET_RECYCLE_EVERY,
                    std::time::Duration::from_secs(PARAKEET_RECYCLE_MIN_GAP_SECS),
                ),
            ),
        })
    }

    /// Discover available Parakeet models
    pub async fn discover_models(&self) -> Result<Vec<ModelInfo>> {
        let models_dir = &self.models_dir;
        let mut models = Vec::new();

        // Parakeet model configurations
        // Model name format: parakeet-tdt-0.6b-v{version}-{quantization}
        // Sizes match actual download sizes (encoder + decoder + preprocessor + vocab)
        let model_configs = [
            ("parakeet-tdt-0.6b-v3-int8", 670, QuantizationType::Int8, "Ultra Fast (v3)", "Real time on M4 Max, latest version with int8 quantization"),
            ("parakeet-tdt-0.6b-v2-int8", 661, QuantizationType::Int8, "Fast (v2)", "Previous version with int8 quantization, good balance of speed and accuracy"),
        ];

        // Get active downloads to override status
        let active_downloads = self.active_downloads.read().await;

        for (name, size_mb, quantization, speed, description) in model_configs {
            let model_path = models_dir.join(name);

            // Check if model is currently downloading
            let status = if active_downloads.contains(name) {
                // If downloading, preserve that status regardless of file system
                // We don't know the exact progress here without more state, but 0 is safe fallback
                // The progress events will update the UI
                ModelStatus::Downloading { progress: 0 }
            } else if model_path.exists() {
                // Check for required ONNX files
                let required_files = match quantization {
                    QuantizationType::Int8 => vec![
                        "encoder-model.int8.onnx",
                        "decoder_joint-model.int8.onnx",
                        "nemo128.onnx",
                        "vocab.txt",
                    ],
                    QuantizationType::FP32 => vec![
                        "encoder-model.onnx",
                        "decoder_joint-model.onnx",
                        "nemo128.onnx",
                        "vocab.txt",
                    ],
                };

                let all_files_exist = required_files.iter().all(|file| {
                    model_path.join(file).exists()
                });

                if all_files_exist {
                    // Validate model by checking file sizes
                    match self.validate_model_directory(&model_path).await {
                        Ok(_) => ModelStatus::Available,
                        Err(_) => {
                            log::warn!("Model directory {} appears corrupted", name);
                            // Calculate total size of existing files
                            let mut total_size = 0u64;
                            for file in required_files {
                                if let Ok(metadata) = std::fs::metadata(model_path.join(file)) {
                                    total_size += metadata.len();
                                }
                            }
                            ModelStatus::Corrupted {
                                file_size: total_size,
                                expected_min_size: (size_mb as u64) * 1024 * 1024,
                            }
                        }
                    }
                } else {
                    ModelStatus::Missing
                }
            } else {
                ModelStatus::Missing
            };

            let model_info = ModelInfo {
                name: name.to_string(),
                path: model_path,
                size_mb: size_mb as u32,
                quantization: quantization.clone(),
                speed: speed.to_string(),
                status,
                description: description.to_string(),
            };

            models.push(model_info);
        }

        // Update internal cache
        let mut available_models = self.available_models.write().await;
        available_models.clear();
        for model in &models {
            available_models.insert(model.name.clone(), model.clone());
        }

        Ok(models)
    }

    /// Validate model directory by checking if all required files exist AND have valid sizes.
    ///
    /// Para int8 (los únicos modelos del registry) el tamaño se compara EXACTO contra el
    /// manifiesto pinneado: el umbral histórico del ~90% dejaba pasar un encoder truncado
    /// al 99%, que crasheaba después al cargar el ONNX — el peor modo de fallo. Un
    /// mismatch aquí se reporta como `Corrupted` (lo decide el caller), que el frontend
    /// ya sabe borrar y re-descargar.
    ///
    /// NO se re-hashea aquí: esto corre en cada listado de modelos y hashear 652 MB por
    /// listado es inaceptable. El hash se verifica en el flujo de descarga.
    async fn validate_model_directory(&self, model_dir: &PathBuf) -> Result<()> {
        // Check if vocab.txt exists and is readable
        let vocab_path = model_dir.join("vocab.txt");
        if !vocab_path.exists() {
            return Err(anyhow!("vocab.txt not found"));
        }

        // Determine which files to check based on what exists
        let is_int8 = model_dir.join("encoder-model.int8.onnx").exists();
        let is_fp32 = model_dir.join("encoder-model.onnx").exists();

        if !is_int8 && !is_fp32 {
            return Err(anyhow!("No ONNX model files found"));
        }

        // Check preprocessor
        if !model_dir.join("nemo128.onnx").exists() {
            return Err(anyhow!("Preprocessor (nemo128.onnx) not found"));
        }

        if is_int8 {
            // El nombre del directorio ES el nombre del modelo (registry)
            let model_name = model_dir
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default();
            let model_manifest = manifest::manifest_for(model_name);

            for spec in model_manifest.files {
                let file_path = model_dir.join(spec.name);
                if !file_path.exists() {
                    return Err(anyhow!("{} not found", spec.name));
                }

                let metadata = std::fs::metadata(&file_path)
                    .map_err(|e| anyhow!("Failed to read {} metadata: {}", spec.name, e))?;
                let actual_size = metadata.len();
                if actual_size != spec.size {
                    return Err(anyhow!(
                        "{} size mismatch: {} bytes on disk, manifest expects exactly {} bytes",
                        spec.name,
                        actual_size,
                        spec.size
                    ));
                }
            }

            return Ok(());
        }

        // FP32: no está en el registry (solo instalaciones manuales de dev) → sin
        // manifiesto; se conservan los umbrales mínimos históricos.
        let expected_sizes: Vec<(&str, u64)> = vec![
            ("encoder-model.onnx", 2_200_000_000),        // ~2.44 GB, min 2.2 GB
            ("decoder_joint-model.onnx", 65_000_000),     // ~72 MB, min 65 MB
            ("nemo128.onnx", 100_000),                    // ~140 KB, min 100 KB
            ("vocab.txt", 5_000),                         // ~94 KB, min 5 KB
        ];

        // Validate each file exists AND has sufficient size
        for (filename, min_size) in expected_sizes {
            let file_path = model_dir.join(filename);
            if !file_path.exists() {
                return Err(anyhow!("{} not found", filename));
            }

            match std::fs::metadata(&file_path) {
                Ok(metadata) => {
                    let actual_size = metadata.len();
                    if actual_size < min_size {
                        return Err(anyhow!(
                            "{} is incomplete: {} bytes (expected at least {} bytes)",
                            filename,
                            actual_size,
                            min_size
                        ));
                    }
                }
                Err(e) => {
                    return Err(anyhow!("Failed to read {} metadata: {}", filename, e));
                }
            }
        }

        Ok(())
    }

    /// Borra TODOS los archivos del directorio si la validacion falla.
    ///
    /// Ya no se llama desde `download_model_detailed_inner`: alli rompia el resume
    /// (ver el comentario en esa funcion). Se conserva por si hace falta una limpieza
    /// explicita en el futuro.
    #[allow(dead_code)]
    async fn clean_incomplete_model_directory(&self, model_dir: &PathBuf) -> Result<()> {
        if !model_dir.exists() {
            return Ok(()); // Nothing to clean
        }

        // Validate the directory
        match self.validate_model_directory(model_dir).await {
            Ok(_) => {
                log::info!("Model directory is valid, no cleanup needed");
                return Ok(());
            }
            Err(validation_error) => {
                log::warn!(
                    "Model directory exists but is invalid: {}. Cleaning up...",
                    validation_error
                );

                // List and remove all files in the directory
                let mut entries = fs::read_dir(model_dir).await
                    .map_err(|e| anyhow!("Failed to read model directory: {}", e))?;

                let mut removed_count = 0;
                while let Some(entry) = entries.next_entry().await
                    .map_err(|e| anyhow!("Failed to read directory entry: {}", e))?
                {
                    let path = entry.path();
                    if path.is_file() {
                        match fs::remove_file(&path).await {
                            Ok(_) => {
                                log::info!("Removed incomplete file: {:?}", path.file_name());
                                removed_count += 1;
                            }
                            Err(e) => {
                                log::warn!("Failed to remove file {:?}: {}", path, e);
                            }
                        }
                    }
                }

                log::info!("Cleaned {} incomplete files from model directory", removed_count);
                Ok(())
            }
        }
    }

    /// Load a Parakeet model
    pub async fn load_model(&self, model_name: &str) -> Result<()> {
        let models = self.available_models.read().await;
        let model_info = models
            .get(model_name)
            .ok_or_else(|| anyhow!("Model {} not found", model_name))?;

        match model_info.status {
            ModelStatus::Available => {
                // Check if this model is already loaded
                if let Some(current_model) = self.current_model_name.read().await.as_ref() {
                    if current_model == model_name {
                        log::info!("Parakeet model {} is already loaded, skipping reload", model_name);
                        return Ok(());
                    }

                    // Unload current model before loading new one
                    log::info!("Unloading current Parakeet model '{}' before loading '{}'", current_model, model_name);
                    self.unload_model().await;
                }

                log::info!("Loading Parakeet model: {}", model_name);

                // Load model based on quantization type
                let quantized = model_info.quantization == QuantizationType::Int8;
                let model = ParakeetModel::new(&model_info.path, quantized)
                    .map_err(|e| anyhow!("Failed to load Parakeet model {}: {}", model_name, e))?;

                // Update current model and model name
                *self.current_model.write().await = Some(model);
                *self.current_model_name.write().await = Some(model_name.to_string());

                log::info!(
                    "Successfully loaded Parakeet model: {} ({})",
                    model_name,
                    if quantized { "Int8 quantized" } else { "FP32" }
                );
                Ok(())
            }
            ModelStatus::Missing => {
                Err(anyhow!("Parakeet model {} is not downloaded", model_name))
            }
            ModelStatus::Downloading { .. } => {
                Err(anyhow!("Parakeet model {} is currently downloading", model_name))
            }
            ModelStatus::Error(ref err) => {
                Err(anyhow!("Parakeet model {} has error: {}", model_name, err))
            }
            ModelStatus::Corrupted { .. } => {
                Err(anyhow!("Parakeet model {} is corrupted and cannot be loaded", model_name))
            }
        }
    }

    /// Unload the current model
    pub async fn unload_model(&self) -> bool {
        let mut model_guard = self.current_model.write().await;
        let unloaded = model_guard.take().is_some();
        if unloaded {
            log::info!("Parakeet model unloaded");
        }

        let mut model_name_guard = self.current_model_name.write().await;
        model_name_guard.take();

        unloaded
    }

    /// Get the currently loaded model name
    pub async fn get_current_model(&self) -> Option<String> {
        self.current_model_name.read().await.clone()
    }

    /// Check if a model is loaded
    pub async fn is_model_loaded(&self) -> bool {
        self.current_model.read().await.is_some()
    }

    /// Transcribe audio samples using the loaded Parakeet model.
    ///
    /// Hot path limpio: toma el lock SOLO durante la inferencia (~0.5s en CPU),
    /// libera, y al final dispara `lifecycle.maybe_recycle()` que evalúa si toca
    /// reciclar la sesión y, si sí, lanza el reload en `tokio::spawn` SIN bloquear.
    ///
    /// La fix principal del bloat de memoria nativa es la config en `model.rs`
    /// (with_arena_allocator(false) + with_memory_pattern(false)). El reciclaje
    /// es red de seguridad: si el bloat reaparece en sesiones de muchas horas,
    /// el helper limpia la sesión sin pausar al worker.
    pub async fn transcribe_audio(&self, audio_data: Vec<f32>) -> Result<String> {
        // FAST PATH: take lock, infer, release. NO recycle here.
        let result_text = {
            let mut model_guard = self.current_model.write().await;
            let model = model_guard
                .as_mut()
                .ok_or_else(|| anyhow!("No Parakeet model loaded. Please load a model first."))?;

            let duration_seconds = audio_data.len() as f64 / 16000.0; // 16kHz
            log::debug!(
                "Parakeet transcribing {} samples ({:.1}s duration)",
                audio_data.len(),
                duration_seconds
            );

            let result = model
                .transcribe_samples(audio_data)
                .map_err(|e| anyhow!("Parakeet transcription failed: {}", e))?;

            log::debug!("Parakeet transcription result: '{}'", result.text);
            result.text
        };

        // Note inference + decide si toca recycle (en background, no bloquea).
        self.lifecycle.note_inference();

        // Snapshot de Arc clones para el cierre del background recycle. NO toma
        // ningún lock — solo clona los Arc.
        let current_model = self.current_model.clone();
        let current_model_name = self.current_model_name.clone();
        let available_models = self.available_models.clone();

        self.lifecycle.maybe_recycle(move || {
            Self::recycle_reload(current_model, current_model_name, available_models)
        });

        Ok(result_text)
    }

    /// Fuerza un reload de la sesión ONNX AHORA (breaker de errores del worker:
    /// N fallos de inferencia consecutivos sugieren sesión corrupta). Devuelve
    /// `true` si el reload se disparó (false = bloqueado por anti-storm).
    pub fn force_recycle(&self) -> bool {
        let current_model = self.current_model.clone();
        let current_model_name = self.current_model_name.clone();
        let available_models = self.available_models.clone();
        self.lifecycle.recycle_now(move || {
            Self::recycle_reload(current_model, current_model_name, available_models)
        })
    }

    /// Reload de sesión compartido por el recycle periódico y el error-triggered:
    /// carga el modelo a variable LOCAL y hace swap atómico solo si el usuario no
    /// cambió de modelo durante la carga. Si falla, la sesión previa queda intacta.
    async fn recycle_reload(
        current_model: Arc<RwLock<Option<ParakeetModel>>>,
        current_model_name: Arc<RwLock<Option<String>>>,
        available_models: Arc<RwLock<HashMap<String, ModelInfo>>>,
    ) -> Result<()> {
        // Snapshot del nombre del modelo ANTES del reload lento. Si el usuario
        // cambia de modelo durante el reload, el swap se aborta.
        let model_name = match current_model_name.read().await.clone() {
            Some(n) => n,
            None => return Ok(()), // user descargó modelo; nada que reciclar
        };

        // Lookup info del modelo (path + quantization) sin tomar locks de model.
        let model_info = {
            let guard = available_models.read().await;
            guard.get(&model_name).cloned()
        };
        let model_info = match model_info {
            Some(mi) => mi,
            None => {
                return Err(anyhow!(
                    "Recycle aborted: model {} no longer in available_models",
                    model_name
                ));
            }
        };
        let quantized = matches!(model_info.quantization, QuantizationType::Int8);

        // Durante el reload coexisten sesión vieja + nueva (pico ~2x del
        // modelo): dejar evidencia de memoria antes de pagar el pico.
        crate::logging::mem_sampler::snapshot_now("onnx-recycle");

        // SLOW: cargar ParakeetModel en variable LOCAL. Sin lock de current_model.
        // Si esto falla, el modelo viejo queda intacto.
        let new_model = ParakeetModel::new(&model_info.path, quantized)
            .map_err(|e| anyhow!("Recycle reload failed for {}: {}", model_name, e))?;

        // ATOMIC SWAP: re-leer current_model_name. Si el usuario cambió de
        // modelo durante el reload, abortar (descartar new_model).
        let name_guard = current_model_name.read().await;
        if name_guard.as_deref() != Some(&model_name) {
            log::info!(
                "Parakeet recycle aborted: model changed during reload \
                 (was {}, now {:?})",
                model_name,
                *name_guard
            );
            return Ok(());
        }
        drop(name_guard);

        // Swap: reemplazar current_model con el nuevo. El viejo Drop libera
        // su memoria nativa.
        let mut model_guard = current_model.write().await;
        *model_guard = Some(new_model);
        drop(model_guard);

        Ok(())
    }

    /// Get the models directory path
    pub async fn get_models_directory(&self) -> PathBuf {
        self.models_dir.clone()
    }

    /// Delete a corrupted model
    pub async fn delete_model(&self, model_name: &str) -> Result<String> {
        log::info!("Attempting to delete Parakeet model: {}", model_name);

        // Get model info to find the directory path
        let model_info = {
            let models = self.available_models.read().await;
            models.get(model_name).cloned()
        };

        let model_info = model_info.ok_or_else(|| anyhow!("Parakeet model '{}' not found", model_name))?;

        log::info!("Parakeet model '{}' has status: {:?}", model_name, model_info.status);

        // Allow deletion of corrupted or available models
        match &model_info.status {
            ModelStatus::Corrupted { .. } | ModelStatus::Available => {
                // Delete the entire model directory
                if model_info.path.exists() {
                    fs::remove_dir_all(&model_info.path).await
                        .map_err(|e| anyhow!("Failed to delete directory '{}': {}", model_info.path.display(), e))?;
                    log::info!("Successfully deleted Parakeet model directory: {}", model_info.path.display());
                } else {
                    log::warn!("Directory '{}' does not exist, nothing to delete", model_info.path.display());
                }

                // Update model status to Missing
                {
                    let mut models = self.available_models.write().await;
                    if let Some(model) = models.get_mut(model_name) {
                        model.status = ModelStatus::Missing;
                    }
                }

                Ok(format!("Successfully deleted Parakeet model '{}'", model_name))
            }
            _ => {
                Err(anyhow!(
                    "Can only delete corrupted or available Parakeet models. Model '{}' has status: {:?}",
                    model_name,
                    model_info.status
                ))
            }
        }
    }

    /// Download a Parakeet model from HuggingFace (backward-compatible wrapper)
    pub async fn download_model(
        &self,
        model_name: &str,
        progress_callback: Option<Box<dyn Fn(u8) + Send + Sync>>,
    ) -> Result<()> {
        // Wrap simple callback to use detailed version.
        // `+ Sync` en toda la cadena: los helpers de descarga toman el callback por
        // referencia a través de un await, y `&T: Send` exige `T: Sync`.
        let detailed_callback: Option<Box<dyn Fn(DownloadProgress) + Send + Sync>> =
            progress_callback.map(|cb| {
                Box::new(move |p: DownloadProgress| cb(p.percent)) as Box<dyn Fn(DownloadProgress) + Send + Sync>
            });
        self.download_model_detailed(model_name, detailed_callback).await
    }

    /// Download a Parakeet model with detailed progress (MB/speed/resume support)
    ///
    /// Reserva la bandera de `active_downloads` de forma ATOMICA y garantiza que se
    /// limpie en TODOS los caminos de salida (incluidos los `?` a media funcion).
    /// El cuerpo real vive en `download_model_detailed_inner`.
    pub async fn download_model_detailed(
        &self,
        model_name: &str,
        progress_callback: Option<Box<dyn Fn(DownloadProgress) + Send + Sync>>,
    ) -> Result<()> {
        // Check+insert ATOMICO en una sola adquisicion del write lock. Antes el check
        // (read lock) y el insert (write lock) eran adquisiciones distintas: dos
        // invocaciones concurrentes del mismo modelo veian ambas `contains == false` y
        // terminaban escribiendo el mismo .onnx a la vez. `HashSet::insert` devuelve
        // false si la clave ya estaba, asi que sirve de check y reserva a la vez.
        {
            let mut active = self.active_downloads.write().await;
            if !active.insert(model_name.to_string()) {
                log::warn!("Download already in progress for Parakeet model: {}", model_name);
                return Err(anyhow!("Download already in progress for model: {}", model_name));
            }
        }

        let result = self
            .download_model_detailed_inner(model_name, progress_callback)
            .await;

        // Limpieza garantizada. Habia 4 salidas `Err` que no limpiaban la bandera
        // (build del cliente HTTP, `send()` por archivo, retry del 416, apertura del
        // archivo). El modelo quedaba reportando `Downloading { progress: 0 }` para
        // siempre, sin eventos de progreso y sin forma de reintentar.
        {
            let mut active = self.active_downloads.write().await;
            active.remove(model_name);
        }

        result
    }

    async fn download_model_detailed_inner(
        &self,
        model_name: &str,
        progress_callback: Option<Box<dyn Fn(DownloadProgress) + Send + Sync>>,
    ) -> Result<()> {
        log::info!("Starting download for Parakeet model: {}", model_name);

        // Clear any previous cancellation flag for this model
        {
            let mut cancel_flag = self.cancel_download_flag.write().await;
            *cancel_flag = None;
        }

        // Get model info
        let model_info = {
            let models = self.available_models.read().await;
            match models.get(model_name).cloned() {
                Some(info) => info,
                None => {
                    return Err(anyhow!("Model {} not found", model_name));
                }
            }
        };

        // Update model status to downloading
        {
            let mut models = self.available_models.write().await;
            if let Some(model) = models.get_mut(model_name) {
                model.status = ModelStatus::Downloading { progress: 0 };
            }
        }

        // Manifiesto pinneado: URL a commit fijo (no `resolve/main`, que es ref
        // móvil), tamaños EXACTOS y SHA-256 por archivo. Solo los modelos int8 del
        // registry son descargables; FP32 no tiene manifiesto ni entra al registry.
        if model_info.quantization != QuantizationType::Int8 {
            self.set_model_status(model_name, ModelStatus::Missing).await;
            return Err(anyhow!(
                "Only int8 Parakeet models are downloadable (got {:?})",
                model_info.quantization
            ));
        }
        let model_manifest = manifest::manifest_for(model_name);
        let base_url = model_manifest.base_url;

        // Create model directory
        let model_dir = &model_info.path;
        if !model_dir.exists() {
            if let Err(e) = fs::create_dir_all(model_dir).await {
                return Err(anyhow!("Failed to create model directory: {}", e));
            }
        }

        // NO se limpia el directorio aqui. `clean_incomplete_model_directory` corria
        // ANTES de calcular `existing_size`, y como `validate_model_directory` revisa
        // `vocab.txt` primero pero `vocab.txt` se descarga ULTIMO, cualquier corte
        // durante el encoder (652 de 670 MB, el 97% del payload) fallaba la validacion
        // y borraba TODO el directorio. Eso dejaba el `Range: bytes=N-` de mas abajo
        // como codigo inalcanzable: cada reintento volvia a bajar desde cero.
        //
        // El loop por archivo ya cubre los tres casos sin necesidad del borrado:
        // completo -> skip (tolerancia del 1%); parcial -> Range + append;
        // 416 -> borra ESE archivo y lo baja fresco.

        // Optimized HTTP client for large file downloads
        let client = reqwest::Client::builder()
            .tcp_nodelay(true)              // Disable Nagle's algorithm for better streaming
            .pool_max_idle_per_host(1)      // Keep connection alive
            .timeout(Duration::from_secs(3600))  // 1 hour timeout for large files
            .connect_timeout(Duration::from_secs(30))
            .build()
            .map_err(|e| anyhow!("Failed to create HTTP client: {}", e))?;

        let total_files = model_manifest.files.len();

        // Total exacto del payload, del manifiesto (antes eran aproximaciones)
        let total_size_bytes: u64 = model_manifest.files.iter().map(|f| f.size).sum();

        // Check for existing downloads (complete or partial) to calculate resume offset
        let mut already_downloaded: u64 = 0;
        for spec in model_manifest.files {
            let file_path = model_dir.join(spec.name);
            if file_path.exists() {
                if let Ok(metadata) = fs::metadata(&file_path).await {
                    // Count all existing bytes (complete files capped at expected size,
                    // partial as-is) so progress starts from where we left off
                    already_downloaded += metadata.len().min(spec.size);
                }
            }
        }

        let mut progress = ProgressState::new(total_size_bytes, already_downloaded);

        log::info!(
            "Starting weighted download for {} files, total size: {:.2} MB (already downloaded: {:.2} MB)",
            total_files,
            total_size_bytes as f64 / 1_048_576.0,
            already_downloaded as f64 / 1_048_576.0
        );

        // Cada archivo baja con reintentos (backoff + jitter) y se verifica por
        // SHA-256 al terminar — el encoder es el 97% del payload, no tiene sentido
        // esperar al final del lote para descubrir que llegó corrupto.
        for (index, spec) in model_manifest.files.iter().enumerate() {
            self.download_file_with_retries(
                &client,
                model_name,
                base_url,
                model_dir,
                spec,
                index,
                total_files,
                &mut progress,
                &progress_callback,
            )
            .await?;
        }

        // Report 100% progress with final speed
        let final_progress =
            DownloadProgress::new(total_size_bytes, total_size_bytes, progress.final_speed());
        if let Some(ref callback) = progress_callback {
            callback(final_progress);
        }

        // Update model status to available
        {
            let mut models = self.available_models.write().await;
            if let Some(model) = models.get_mut(model_name) {
                model.status = ModelStatus::Available;
                model.path = model_dir.clone();
            }
        }

        // Clear cancellation flag on successful completion
        {
            let mut cancel_flag = self.cancel_download_flag.write().await;
            if cancel_flag.as_ref() == Some(&model_name.to_string()) {
                *cancel_flag = None;
            }
        }

        log::info!("Download completed for Parakeet model: {}", model_name);
        Ok(())
    }

    /// Actualiza el status de un modelo en el cache (helper para los caminos de error).
    async fn set_model_status(&self, model_name: &str, status: ModelStatus) {
        let mut models = self.available_models.write().await;
        if let Some(model) = models.get_mut(model_name) {
            model.status = status;
        }
    }

    /// Verifica el SHA-256 de un archivo contra el manifiesto, en un hilo blocking
    /// (el encoder son 652 MB; hashearlo toma segundos). Error de I/O al leer ⇒ `Permanent`.
    async fn checksum_matches(
        &self,
        file_path: &PathBuf,
        spec: &FileSpec,
    ) -> std::result::Result<bool, FileDownloadError> {
        log::info!("Verifying SHA-256 for {}", spec.name);
        let path = file_path.clone();
        let expected = spec.sha256;
        let name = spec.name;
        tokio::task::spawn_blocking(move || manifest::verify_file_sha256(&path, expected))
            .await
            .map_err(|e| {
                FileDownloadError::Permanent(anyhow!("Hash task failed for {}: {}", name, e))
            })?
            .map_err(|e| {
                FileDownloadError::Permanent(anyhow!("Failed to read {} for hashing: {}", name, e))
            })
    }

    /// Envuelve `download_one_file` con reintentos: backoff exponencial con jitter
    /// para errores transitorios de red y checksum corrupto (que baja fresco).
    /// `Cancelled` y `Permanent` no se reintentan. El parcial NO se borra entre
    /// intentos: el `Range: bytes=N-` reanuda desde donde quedó.
    #[allow(clippy::too_many_arguments)]
    async fn download_file_with_retries(
        &self,
        client: &reqwest::Client,
        model_name: &str,
        base_url: &str,
        model_dir: &PathBuf,
        spec: &FileSpec,
        index: usize,
        total_files: usize,
        progress: &mut ProgressState,
        progress_callback: &Option<Box<dyn Fn(DownloadProgress) + Send + Sync>>,
    ) -> Result<()> {
        const MAX_ATTEMPTS: u32 = 4;
        let mut attempt: u32 = 1;

        loop {
            let result = self
                .download_one_file(
                    client,
                    model_name,
                    base_url,
                    model_dir,
                    spec,
                    index,
                    total_files,
                    progress,
                    progress_callback,
                )
                .await;

            match result {
                Ok(()) => return Ok(()),
                Err(FileDownloadError::Cancelled) => {
                    // El status lo deja `cancel_download` (pone Missing); aquí solo salir
                    return Err(anyhow!("Download cancelled by user"));
                }
                Err(FileDownloadError::Permanent(e)) => {
                    self.set_model_status(model_name, ModelStatus::Missing).await;
                    return Err(e);
                }
                Err(retryable) if attempt < MAX_ATTEMPTS => {
                    let delay = manifest::backoff_delay(attempt);
                    log::warn!(
                        "Attempt {}/{} failed for {}: {}. Retrying in {:.1}s",
                        attempt,
                        MAX_ATTEMPTS,
                        spec.name,
                        retryable,
                        delay.as_secs_f64()
                    );
                    tokio::time::sleep(delay).await;

                    // Cancelación durante la espera: no arrancar otro intento
                    let cancelled = {
                        let cancel_flag = self.cancel_download_flag.read().await;
                        cancel_flag.as_deref() == Some(model_name)
                    };
                    if cancelled {
                        return Err(anyhow!("Download cancelled by user"));
                    }
                    attempt += 1;
                }
                Err(FileDownloadError::Transient(e)) => {
                    self.set_model_status(model_name, ModelStatus::Missing).await;
                    return Err(anyhow!("{} (after {} attempts)", e, MAX_ATTEMPTS));
                }
                Err(FileDownloadError::Corrupt { size, err }) => {
                    // Checksum corrupto persistente ⇒ `Corrupted`, NO `Missing`: es el
                    // estado que el frontend ya sabe borrar y re-descargar.
                    self.set_model_status(
                        model_name,
                        ModelStatus::Corrupted {
                            file_size: size,
                            expected_min_size: spec.size,
                        },
                    )
                    .await;
                    return Err(anyhow!("{} (after {} attempts)", err, MAX_ATTEMPTS));
                }
            }
        }
    }

    /// Descarga UN archivo del manifiesto (con resume vía Range) y verifica su
    /// SHA-256 al terminar. No toca `ModelStatus` en los caminos de error: eso lo
    /// decide `download_file_with_retries` según los intentos restantes.
    #[allow(clippy::too_many_arguments)]
    async fn download_one_file(
        &self,
        client: &reqwest::Client,
        model_name: &str,
        base_url: &str,
        model_dir: &PathBuf,
        spec: &FileSpec,
        index: usize,
        total_files: usize,
        progress: &mut ProgressState,
        progress_callback: &Option<Box<dyn Fn(DownloadProgress) + Send + Sync>>,
    ) -> std::result::Result<(), FileDownloadError> {
        let file_url = format!("{}/{}", base_url, spec.name);
        let file_path = model_dir.join(spec.name);

        // Tamaño existente: se relee en cada intento (el resume parte de aquí)
        let mut existing_size: u64 = if file_path.exists() {
            fs::metadata(&file_path).await.map(|m| m.len()).unwrap_or(0)
        } else {
            0
        };

        // Archivo aparentemente completo: el tamaño ya no basta — verificar hash
        if existing_size >= spec.size {
            if self.checksum_matches(&file_path, spec).await? {
                log::info!(
                    "Skipping complete file: {} ({:.2} MB, checksum OK)",
                    spec.name,
                    existing_size as f64 / 1_048_576.0
                );
                return Ok(());
            }
            log::warn!(
                "Existing file {} fails checksum ({} bytes). Deleting and downloading fresh.",
                spec.name,
                existing_size
            );
            fs::remove_file(&file_path).await.map_err(|e| {
                FileDownloadError::Permanent(anyhow!(
                    "Failed to delete corrupt file {}: {}",
                    spec.name,
                    e
                ))
            })?;
            progress.discard_bytes(existing_size);
            existing_size = 0;
        }

        log::info!(
            "Downloading file {}/{}: {} (resuming from {} bytes)",
            index + 1,
            total_files,
            spec.name,
            existing_size
        );

        // Build request with optional Range header for resume
        let mut request = client.get(&file_url);
        if existing_size > 0 {
            request = request.header("Range", format!("bytes={}-", existing_size));
            log::info!("Resuming download from byte {}", existing_size);
        }

        let mut response = request.send().await.map_err(|e| {
            FileDownloadError::Transient(anyhow!(
                "Failed to start download for {}: {}",
                spec.name,
                e
            ))
        })?;

        // Handle response status
        let (file_total_size, resuming) = if response.status()
            == reqwest::StatusCode::PARTIAL_CONTENT
        {
            // Server supports resume, get remaining size
            let remaining = response.content_length().unwrap_or(0);
            log::info!("Server supports resume, remaining: {} bytes", remaining);
            (existing_size + remaining, true)
        } else if response.status().is_success() {
            // Fresh download or server doesn't support resume
            if existing_size > 0 {
                log::warn!(
                    "Server doesn't support resume for {}, starting fresh download",
                    spec.name
                );
                // El archivo se trunca (create): los bytes parciales contados sobran
                progress.discard_bytes(existing_size);
            }
            (response.content_length().unwrap_or(0), false)
        } else if response.status() == reqwest::StatusCode::RANGE_NOT_SATISFIABLE {
            // 416 con el parcial por debajo del tamaño exacto: borrar y bajar fresco
            log::warn!(
                "Server returned 416 for {} ({}/{} bytes). Deleting and retrying fresh.",
                spec.name,
                existing_size,
                spec.size
            );
            fs::remove_file(&file_path).await.map_err(|e| {
                FileDownloadError::Permanent(anyhow!(
                    "Failed to delete incomplete file {}: {}",
                    spec.name,
                    e
                ))
            })?;
            progress.discard_bytes(existing_size);
            existing_size = 0;

            response = client.get(&file_url).send().await.map_err(|e| {
                FileDownloadError::Transient(anyhow!("Retry failed for {}: {}", spec.name, e))
            })?;

            if !response.status().is_success() {
                return Err(classify_http_status(spec.name, response.status()));
            }

            (response.content_length().unwrap_or(0), false)
        } else {
            return Err(classify_http_status(spec.name, response.status()));
        };

        // Open file for writing (append if resuming, create new if not)
        let file = if resuming {
            fs::OpenOptions::new()
                .append(true)
                .open(&file_path)
                .await
                .map_err(|e| {
                    FileDownloadError::Permanent(anyhow!(
                        "Failed to open file for resume {}: {}",
                        spec.name,
                        e
                    ))
                })?
        } else {
            fs::File::create(&file_path).await.map_err(|e| {
                FileDownloadError::Permanent(anyhow!("Failed to create file {}: {}", spec.name, e))
            })?
        };

        // Use buffered writer for better I/O performance (8MB buffer)
        let mut writer = BufWriter::with_capacity(8 * 1024 * 1024, file);

        // Stream download
        use futures_util::StreamExt;
        let mut stream = response.bytes_stream();
        let mut file_downloaded = if resuming { existing_size } else { 0u64 };

        loop {
            // Check for cancellation before processing chunk
            {
                let cancel_flag = self.cancel_download_flag.read().await;
                if cancel_flag.as_deref() == Some(model_name) {
                    log::info!("Download cancelled for {}", model_name);
                    // Flush and keep partial file for resume on next attempt
                    let _ = writer.flush().await;
                    return Err(FileDownloadError::Cancelled);
                }
            }

            // Add per-chunk timeout (30 seconds) to detect stalled connections
            let next_result = timeout(Duration::from_secs(30), stream.next()).await;

            let chunk = match next_result {
                // Timeout - no data received for 30 seconds
                Err(_) => {
                    log::warn!(
                        "Download timeout for {}: no data received for 30 seconds",
                        model_name
                    );
                    let _ = writer.flush().await;
                    return Err(FileDownloadError::Transient(anyhow!(
                        "Download timeout - No data received for 30 seconds"
                    )));
                }
                // Stream ended
                Ok(None) => break,
                Ok(Some(Ok(c))) => c,
                // Detect error type for better user feedback
                Ok(Some(Err(e))) => {
                    log::error!("Download error for {}: {:?}", model_name, e);
                    let _ = writer.flush().await;

                    let error_msg = if e.is_timeout() {
                        "Connection timeout - Check your internet"
                    } else if e.is_connect() {
                        "Connection failed - Check your internet"
                    } else if e.is_body() {
                        "Stream interrupted - Network unstable"
                    } else {
                        "Download error"
                    };

                    return Err(FileDownloadError::Transient(anyhow!("{}: {}", error_msg, e)));
                }
            };

            if let Err(e) = writer.write_all(&chunk).await {
                return Err(FileDownloadError::Permanent(anyhow!(
                    "Failed to write chunk to file: {}",
                    e
                )));
            }

            let chunk_len = chunk.len() as u64;
            file_downloaded += chunk_len;
            progress.note_chunk(chunk_len);

            if let Some((report, overall)) =
                progress.report_if_due(index, total_files, file_downloaded, file_total_size)
            {
                if let Some(callback) = progress_callback {
                    callback(report);
                }
                self.set_model_status(model_name, ModelStatus::Downloading { progress: overall })
                    .await;
            }
        }

        // Flush the buffered writer
        writer.flush().await.map_err(|e| {
            FileDownloadError::Permanent(anyhow!("Failed to flush file {}: {}", spec.name, e))
        })?;
        drop(writer);

        // Integridad real al terminar el archivo — el tamaño no es integridad
        let disk_len = fs::metadata(&file_path).await.map(|m| m.len()).unwrap_or(0);
        if !self.checksum_matches(&file_path, spec).await? {
            log::warn!(
                "Checksum mismatch for {} ({} bytes on disk, expected {} / sha256 {}). Deleting.",
                spec.name,
                disk_len,
                spec.size,
                spec.sha256
            );
            let _ = fs::remove_file(&file_path).await;
            progress.discard_bytes(disk_len);
            return Err(FileDownloadError::Corrupt {
                size: disk_len,
                err: anyhow!(
                    "Checksum mismatch for {} - file corrupted in transit",
                    spec.name
                ),
            });
        }

        log::info!(
            "Completed download: {} ({:.2} MB, checksum OK, overall progress: {:.1}%)",
            spec.name,
            file_downloaded as f64 / 1_048_576.0,
            progress.overall_percent_f64()
        );

        Ok(())
    }

    /// Cancel an ongoing model download
    pub async fn cancel_download(&self, model_name: &str) -> Result<()> {
        log::info!("Cancelling download for Parakeet model: {}", model_name);

        // Set cancellation flag to interrupt the download loop
        {
            let mut cancel_flag = self.cancel_download_flag.write().await;
            *cancel_flag = Some(model_name.to_string());
        }

        // NO se toca `active_downloads` aqui: la bandera es propiedad exclusiva de
        // `download_model_detailed`, que la limpia al salir su tarea. Borrarla desde
        // fuera dejaria pasar una descarga nueva mientras la vieja todavia se
        // desenrolla y sigue escribiendo el .onnx (dos writers sobre el mismo archivo).

        // Update model status to Missing (so it can be retried)
        {
            let mut models = self.available_models.write().await;
            if let Some(model) = models.get_mut(model_name) {
                model.status = ModelStatus::Missing;
            }
        }

        // Clean up partially downloaded files
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await; // Brief delay to let download loop exit

        let model_path = self.models_dir.join(model_name);
        if model_path.exists() {
            if let Err(e) = fs::remove_dir_all(&model_path).await {
                log::warn!("Failed to clean up cancelled download directory: {}", e);
            } else {
                log::info!("Cleaned up cancelled download directory: {}", model_path.display());
            }
        }

        Ok(())
    }
}

/// Contadores de progreso compartidos entre los archivos de una misma descarga.
/// Antes eran 5 variables sueltas dentro de `download_model_detailed_inner`.
struct ProgressState {
    total_size_bytes: u64,
    total_downloaded: u64,
    already_downloaded: u64,
    bytes_since_last_report: u64,
    last_report_time: Instant,
    last_reported_progress: u8,
    download_start_time: Instant,
}

impl ProgressState {
    fn new(total_size_bytes: u64, already_downloaded: u64) -> Self {
        Self {
            total_size_bytes,
            total_downloaded: already_downloaded,
            already_downloaded,
            bytes_since_last_report: 0,
            last_report_time: Instant::now(),
            last_reported_progress: 0,
            download_start_time: Instant::now(),
        }
    }

    fn note_chunk(&mut self, len: u64) {
        self.total_downloaded += len;
        self.bytes_since_last_report += len;
    }

    /// Bytes de un parcial descartado (416, server sin resume, checksum corrupto):
    /// se restan para que el % no cuente bytes que van a volver a bajarse.
    fn discard_bytes(&mut self, len: u64) {
        self.total_downloaded = self.total_downloaded.saturating_sub(len);
    }

    fn overall_percent_f64(&self) -> f64 {
        if self.total_size_bytes > 0 {
            (self.total_downloaded as f64 / self.total_size_bytes as f64) * 100.0
        } else {
            0.0
        }
    }

    /// Report every 1% progress change OR every 500ms for smooth UI updates.
    /// Devuelve el `DownloadProgress` para el callback y el % (0-99) para el status.
    fn report_if_due(
        &mut self,
        index: usize,
        total_files: usize,
        file_downloaded: u64,
        file_total_size: u64,
    ) -> Option<(DownloadProgress, u8)> {
        // Calculate weighted overall progress based on total bytes downloaded
        let overall_progress = if self.total_size_bytes > 0 {
            ((self.total_downloaded as f64 / self.total_size_bytes as f64) * 100.0).min(99.0) as u8
        } else {
            // Fallback to per-file progress if total size unknown
            ((index as f64 + (file_downloaded as f64 / file_total_size.max(1) as f64))
                / total_files as f64
                * 100.0) as u8
        };

        let elapsed_since_report = self.last_report_time.elapsed();
        let progress_changed = overall_progress > self.last_reported_progress;
        let time_threshold = elapsed_since_report >= Duration::from_millis(500);
        let is_complete = file_downloaded >= file_total_size;

        if !(progress_changed || time_threshold || is_complete) {
            return None;
        }

        // Calculate download speed
        let speed_mbps = if elapsed_since_report.as_secs_f64() >= 0.1 {
            (self.bytes_since_last_report as f64 / (1024.0 * 1024.0))
                / elapsed_since_report.as_secs_f64()
        } else {
            // Fallback to overall average speed
            self.final_speed()
        };

        self.last_reported_progress = overall_progress;
        self.last_report_time = Instant::now();
        self.bytes_since_last_report = 0;

        Some((
            DownloadProgress::new(self.total_downloaded, self.total_size_bytes, speed_mbps),
            overall_progress,
        ))
    }

    /// Velocidad promedio de la corrida (solo bytes bajados en ESTA sesión).
    fn final_speed(&self) -> f64 {
        let total_elapsed = self.download_start_time.elapsed().as_secs_f64();
        if total_elapsed > 0.0 {
            (self.total_downloaded.saturating_sub(self.already_downloaded) as f64
                / (1024.0 * 1024.0))
                / total_elapsed
        } else {
            0.0
        }
    }
}

/// Clasificación de los errores de descarga por archivo. Quién decide el
/// `ModelStatus` final es `download_file_with_retries`, según los intentos
/// restantes — por eso las variantes no tocan estado.
enum FileDownloadError {
    /// Cancelado por el usuario: nunca se reintenta; el status lo pone `cancel_download`.
    Cancelled,
    /// Error transitorio de red: reintentable; agotados los intentos ⇒ `Missing`.
    Transient(anyhow::Error),
    /// Checksum corrupto: reintentable (baja fresco); agotado ⇒ `Corrupted`.
    Corrupt { size: u64, err: anyhow::Error },
    /// No reintentable (HTTP 4xx, disco): ⇒ `Missing` inmediato.
    Permanent(anyhow::Error),
}

impl std::fmt::Display for FileDownloadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FileDownloadError::Cancelled => write!(f, "cancelled by user"),
            FileDownloadError::Transient(e) => write!(f, "{}", e),
            FileDownloadError::Corrupt { err, .. } => write!(f, "{}", err),
            FileDownloadError::Permanent(e) => write!(f, "{}", e),
        }
    }
}

/// 5xx y 429 son transitorios (el server puede recuperarse); el resto (404/403…)
/// es permanente — reintentar un 404 solo retrasa el error accionable.
fn classify_http_status(name: &str, status: reqwest::StatusCode) -> FileDownloadError {
    let err = anyhow!("Download failed for {} with status: {}", name, status);
    if status.is_server_error() || status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        FileDownloadError::Transient(err)
    } else {
        FileDownloadError::Permanent(err)
    }
}
