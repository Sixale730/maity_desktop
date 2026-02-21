use crate::canary_engine::model::CanaryModel;
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::fs;
use tokio::io::{AsyncWriteExt, BufWriter};
use tokio::sync::RwLock;
use tokio::time::timeout;

/// Model status for Canary models
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ModelStatus {
    Available,
    Missing,
    Downloading { progress: u8 },
    Error(String),
    Corrupted {
        file_size: u64,
        expected_min_size: u64,
    },
}

/// Detailed download progress info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadProgress {
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub downloaded_mb: f64,
    pub total_mb: f64,
    pub speed_mbps: f64,
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

/// Information about a Canary model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub name: String,
    pub path: PathBuf,
    pub size_mb: u32,
    pub status: ModelStatus,
    pub description: String,
}

#[derive(Debug)]
pub enum CanaryEngineError {
    ModelNotLoaded,
    ModelNotFound(String),
    TranscriptionFailed(String),
    DownloadFailed(String),
    IoError(std::io::Error),
    Other(String),
}

impl std::fmt::Display for CanaryEngineError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CanaryEngineError::ModelNotLoaded => write!(f, "No Canary model loaded"),
            CanaryEngineError::ModelNotFound(name) => write!(f, "Model '{}' not found", name),
            CanaryEngineError::TranscriptionFailed(err) => {
                write!(f, "Transcription failed: {}", err)
            }
            CanaryEngineError::DownloadFailed(err) => write!(f, "Download failed: {}", err),
            CanaryEngineError::IoError(err) => write!(f, "IO error: {}", err),
            CanaryEngineError::Other(err) => write!(f, "Error: {}", err),
        }
    }
}

impl std::error::Error for CanaryEngineError {}

impl From<std::io::Error> for CanaryEngineError {
    fn from(err: std::io::Error) -> Self {
        CanaryEngineError::IoError(err)
    }
}

pub struct CanaryEngine {
    models_dir: PathBuf,
    current_model: Arc<RwLock<Option<CanaryModel>>>,
    current_model_name: Arc<RwLock<Option<String>>>,
    pub(crate) available_models: Arc<RwLock<HashMap<String, ModelInfo>>>,
    cancel_download_flag: Arc<RwLock<Option<String>>>,
    pub(crate) active_downloads: Arc<RwLock<HashSet<String>>>,
}

impl CanaryEngine {
    pub fn new_with_models_dir(models_dir: Option<PathBuf>) -> Result<Self> {
        let models_dir = if let Some(dir) = models_dir {
            dir.join("canary")
        } else {
            let current_dir = std::env::current_dir()
                .map_err(|e| anyhow!("Failed to get current directory: {}", e))?;

            if cfg!(debug_assertions) {
                current_dir.join("models").join("canary")
            } else {
                dirs::data_dir()
                    .or_else(|| dirs::home_dir())
                    .ok_or_else(|| anyhow!("Could not find system data directory"))?
                    .join("Maity")
                    .join("models")
                    .join("canary")
            }
        };

        log::info!(
            "CanaryEngine using models directory: {}",
            models_dir.display()
        );

        if !models_dir.exists() {
            std::fs::create_dir_all(&models_dir)?;
        }

        Ok(Self {
            models_dir,
            current_model: Arc::new(RwLock::new(None)),
            current_model_name: Arc::new(RwLock::new(None)),
            available_models: Arc::new(RwLock::new(HashMap::new())),
            cancel_download_flag: Arc::new(RwLock::new(None)),
            active_downloads: Arc::new(RwLock::new(HashSet::new())),
        })
    }

    /// Discover available Canary models
    pub async fn discover_models(&self) -> Result<Vec<ModelInfo>> {
        let models_dir = &self.models_dir;
        let mut models = Vec::new();

        // Canary model configuration
        let model_configs = [(
            "canary-1b-flash-int8",
            939u32,
            "Canary 1B Flash Int8 — Best Spanish accuracy (2.69% WER), encoder-decoder architecture",
        )];

        let active_downloads = self.active_downloads.read().await;

        for (name, size_mb, description) in model_configs {
            let model_path = models_dir.join(name);

            let status = if active_downloads.contains(name) {
                ModelStatus::Downloading { progress: 0 }
            } else if model_path.exists() {
                let required_files = vec![
                    "encoder-model.int8.onnx",
                    "decoder-model.int8.onnx",
                    "vocab.txt",
                ];

                let all_files_exist = required_files.iter().all(|file| model_path.join(file).exists());

                if all_files_exist {
                    match self.validate_model_directory(&model_path).await {
                        Ok(_) => ModelStatus::Available,
                        Err(_) => {
                            log::warn!("Canary model directory {} appears corrupted", name);
                            let mut total_size = 0u64;
                            for file in &required_files {
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

            models.push(ModelInfo {
                name: name.to_string(),
                path: model_path,
                size_mb,
                status,
                description: description.to_string(),
            });
        }

        // Update cache
        let mut available_models = self.available_models.write().await;
        available_models.clear();
        for model in &models {
            available_models.insert(model.name.clone(), model.clone());
        }

        Ok(models)
    }

    async fn validate_model_directory(&self, model_dir: &PathBuf) -> Result<()> {
        let expected_sizes: Vec<(&str, u64)> = vec![
            ("encoder-model.int8.onnx", 750_000_000), // ~859 MB, min 750 MB
            ("decoder-model.int8.onnx", 60_000_000),   // ~79.5 MB, min 60 MB
            ("vocab.txt", 10_000),                     // ~53.6 KB, min 10 KB
        ];

        for (filename, min_size) in expected_sizes {
            let file_path = model_dir.join(filename);
            if !file_path.exists() {
                return Err(anyhow!("{} not found", filename));
            }

            match std::fs::metadata(&file_path) {
                Ok(metadata) => {
                    if metadata.len() < min_size {
                        return Err(anyhow!(
                            "{} is incomplete: {} bytes (expected at least {} bytes)",
                            filename,
                            metadata.len(),
                            min_size
                        ));
                    }
                }
                Err(e) => return Err(anyhow!("Failed to read {} metadata: {}", filename, e)),
            }
        }

        Ok(())
    }

    async fn clean_incomplete_model_directory(&self, model_dir: &PathBuf) -> Result<()> {
        if !model_dir.exists() {
            return Ok(());
        }

        match self.validate_model_directory(model_dir).await {
            Ok(_) => {
                log::info!("Canary model directory is valid, no cleanup needed");
                Ok(())
            }
            Err(validation_error) => {
                log::warn!(
                    "Canary model directory invalid: {}. Cleaning up...",
                    validation_error
                );

                let mut entries = fs::read_dir(model_dir).await?;
                let mut removed_count = 0;
                while let Some(entry) = entries.next_entry().await? {
                    let path = entry.path();
                    if path.is_file() {
                        if let Ok(()) = fs::remove_file(&path).await {
                            log::info!("Removed: {:?}", path.file_name());
                            removed_count += 1;
                        }
                    }
                }
                log::info!("Cleaned {} incomplete Canary files", removed_count);
                Ok(())
            }
        }
    }

    pub async fn load_model(&self, model_name: &str) -> Result<()> {
        let models = self.available_models.read().await;
        let model_info = models
            .get(model_name)
            .ok_or_else(|| anyhow!("Canary model {} not found", model_name))?;

        match model_info.status {
            ModelStatus::Available => {
                if let Some(current_model) = self.current_model_name.read().await.as_ref() {
                    if current_model == model_name {
                        log::info!("Canary model {} already loaded", model_name);
                        return Ok(());
                    }
                    log::info!("Unloading current Canary model before loading '{}'", model_name);
                    self.unload_model().await;
                }

                log::info!("Loading Canary model: {}", model_name);

                let model = CanaryModel::new(&model_info.path, true)
                    .map_err(|e| anyhow!("Failed to load Canary model {}: {}", model_name, e))?;

                *self.current_model.write().await = Some(model);
                *self.current_model_name.write().await = Some(model_name.to_string());

                log::info!("Successfully loaded Canary model: {}", model_name);
                Ok(())
            }
            ModelStatus::Missing => Err(anyhow!("Canary model {} is not downloaded", model_name)),
            ModelStatus::Downloading { .. } => {
                Err(anyhow!("Canary model {} is currently downloading", model_name))
            }
            ModelStatus::Error(ref err) => {
                Err(anyhow!("Canary model {} has error: {}", model_name, err))
            }
            ModelStatus::Corrupted { .. } => {
                Err(anyhow!("Canary model {} is corrupted", model_name))
            }
        }
    }

    pub async fn unload_model(&self) -> bool {
        let mut model_guard = self.current_model.write().await;
        let unloaded = model_guard.take().is_some();
        if unloaded {
            log::info!("Canary model unloaded");
        }
        let mut model_name_guard = self.current_model_name.write().await;
        model_name_guard.take();
        unloaded
    }

    pub async fn get_current_model(&self) -> Option<String> {
        self.current_model_name.read().await.clone()
    }

    pub async fn is_model_loaded(&self) -> bool {
        self.current_model.read().await.is_some()
    }

    /// Transcribe audio with optional language hint
    pub async fn transcribe_audio(&self, audio_data: Vec<f32>) -> Result<String> {
        self.transcribe_audio_with_lang(audio_data, None).await
    }

    /// Transcribe audio with language specification
    pub async fn transcribe_audio_with_lang(
        &self,
        audio_data: Vec<f32>,
        language: Option<String>,
    ) -> Result<String> {
        let mut model_guard = self.current_model.write().await;
        let model = model_guard
            .as_mut()
            .ok_or_else(|| anyhow!("No Canary model loaded"))?;

        let duration_seconds = audio_data.len() as f64 / 16000.0;
        log::debug!(
            "Canary transcribing {} samples ({:.1}s)",
            audio_data.len(),
            duration_seconds
        );

        let lang_ref = language.as_deref();
        let result = model
            .transcribe_samples(audio_data, lang_ref)
            .map_err(|e| anyhow!("Canary transcription failed: {}", e))?;

        log::debug!("Canary transcription result: '{}'", result);
        Ok(result)
    }

    pub async fn get_models_directory(&self) -> PathBuf {
        self.models_dir.clone()
    }

    pub async fn delete_model(&self, model_name: &str) -> Result<String> {
        log::info!("Attempting to delete Canary model: {}", model_name);

        let model_info = {
            let models = self.available_models.read().await;
            models.get(model_name).cloned()
        };

        let model_info =
            model_info.ok_or_else(|| anyhow!("Canary model '{}' not found", model_name))?;

        match &model_info.status {
            ModelStatus::Corrupted { .. } | ModelStatus::Available => {
                if model_info.path.exists() {
                    fs::remove_dir_all(&model_info.path).await.map_err(|e| {
                        anyhow!(
                            "Failed to delete '{}': {}",
                            model_info.path.display(),
                            e
                        )
                    })?;
                    log::info!("Deleted Canary model directory: {}", model_info.path.display());
                }

                {
                    let mut models = self.available_models.write().await;
                    if let Some(model) = models.get_mut(model_name) {
                        model.status = ModelStatus::Missing;
                    }
                }

                Ok(format!("Deleted Canary model '{}'", model_name))
            }
            _ => Err(anyhow!(
                "Can only delete corrupted or available models. Status: {:?}",
                model_info.status
            )),
        }
    }

    /// Download Canary model from HuggingFace with detailed progress
    pub async fn download_model_detailed(
        &self,
        model_name: &str,
        progress_callback: Option<Box<dyn Fn(DownloadProgress) + Send>>,
    ) -> Result<()> {
        log::info!("Starting download for Canary model: {}", model_name);

        // Check for concurrent download
        {
            let active = self.active_downloads.read().await;
            if active.contains(model_name) {
                return Err(anyhow!("Download already in progress for: {}", model_name));
            }
        }

        // Add to active downloads
        {
            let mut active = self.active_downloads.write().await;
            active.insert(model_name.to_string());
        }

        // Clear cancel flag
        {
            let mut cancel_flag = self.cancel_download_flag.write().await;
            *cancel_flag = None;
        }

        let model_info = {
            let models = self.available_models.read().await;
            match models.get(model_name).cloned() {
                Some(info) => info,
                None => {
                    let mut active = self.active_downloads.write().await;
                    active.remove(model_name);
                    return Err(anyhow!("Model {} not found", model_name));
                }
            }
        };

        // Update status
        {
            let mut models = self.available_models.write().await;
            if let Some(model) = models.get_mut(model_name) {
                model.status = ModelStatus::Downloading { progress: 0 };
            }
        }

        let base_url =
            "https://huggingface.co/istupakov/canary-1b-flash-onnx/resolve/main";

        let files_to_download = vec![
            "encoder-model.int8.onnx",
            "decoder-model.int8.onnx",
            "vocab.txt",
        ];

        let model_dir = &model_info.path;
        if !model_dir.exists() {
            if let Err(e) = fs::create_dir_all(model_dir).await {
                let mut active = self.active_downloads.write().await;
                active.remove(model_name);
                return Err(anyhow!("Failed to create model directory: {}", e));
            }
        }

        // Clean incomplete files
        if let Err(e) = self.clean_incomplete_model_directory(model_dir).await {
            log::warn!("Failed to clean incomplete Canary directory: {}", e);
        }

        let client = reqwest::Client::builder()
            .tcp_nodelay(true)
            .pool_max_idle_per_host(1)
            .timeout(Duration::from_secs(3600))
            .connect_timeout(Duration::from_secs(30))
            .build()
            .map_err(|e| anyhow!("Failed to create HTTP client: {}", e))?;

        let file_sizes: HashMap<&str, u64> = [
            ("encoder-model.int8.onnx", 859_000_000u64),
            ("decoder-model.int8.onnx", 79_500_000u64),
            ("vocab.txt", 53_600u64),
        ]
        .iter()
        .cloned()
        .collect();

        let total_size_bytes: u64 = files_to_download
            .iter()
            .filter_map(|f| file_sizes.get(*f))
            .copied()
            .sum();

        let total_files = files_to_download.len();

        // Check existing downloads for resume
        let mut already_downloaded: u64 = 0;
        for filename in &files_to_download {
            let file_path = model_dir.join(filename);
            if file_path.exists() {
                if let Ok(metadata) = fs::metadata(&file_path).await {
                    let expected = file_sizes.get(*filename).copied().unwrap_or(0);
                    already_downloaded += metadata.len().min(expected);
                }
            }
        }

        let mut total_downloaded: u64 = already_downloaded;
        let download_start_time = Instant::now();
        let mut last_report_time = Instant::now();
        let mut bytes_since_last_report: u64 = 0;
        let mut last_reported_progress: u8 = 0;

        log::info!(
            "Starting Canary download: {} files, {:.2} MB total ({:.2} MB already)",
            total_files,
            total_size_bytes as f64 / 1_048_576.0,
            already_downloaded as f64 / 1_048_576.0
        );

        for (index, filename) in files_to_download.iter().enumerate() {
            let file_url = format!("{}/{}", base_url, filename);
            let file_path = model_dir.join(filename);

            let existing_size: u64 = if file_path.exists() {
                fs::metadata(&file_path)
                    .await
                    .map(|m| m.len())
                    .unwrap_or(0)
            } else {
                0
            };

            let expected_size = file_sizes.get(*filename).copied().unwrap_or(0);
            let size_tolerance = (expected_size as f64 * 0.99) as u64;
            if existing_size >= size_tolerance && expected_size > 0 {
                log::info!("Skipping complete file: {} ({:.2} MB)", filename, existing_size as f64 / 1_048_576.0);
                continue;
            }

            log::info!(
                "Downloading {}/{}: {} (resume from {} bytes)",
                index + 1,
                total_files,
                filename,
                existing_size
            );

            let mut request = client.get(&file_url);
            if existing_size > 0 {
                request = request.header("Range", format!("bytes={}-", existing_size));
            }

            let mut response = request
                .send()
                .await
                .map_err(|e| anyhow!("Failed to start download for {}: {}", filename, e))?;

            let (_file_total_size, resuming) =
                if response.status() == reqwest::StatusCode::PARTIAL_CONTENT {
                    let remaining = response.content_length().unwrap_or(0);
                    (existing_size + remaining, true)
                } else if response.status().is_success() {
                    (response.content_length().unwrap_or(0), false)
                } else if response.status() == reqwest::StatusCode::RANGE_NOT_SATISFIABLE {
                    if existing_size >= size_tolerance && expected_size > 0 {
                        continue;
                    }
                    if let Err(e) = fs::remove_file(&file_path).await {
                        let mut active = self.active_downloads.write().await;
                        active.remove(model_name);
                        return Err(anyhow!("Failed to delete {}: {}", filename, e));
                    }
                    response = client
                        .get(&file_url)
                        .send()
                        .await
                        .map_err(|e| anyhow!("Retry failed for {}: {}", filename, e))?;
                    if !response.status().is_success() {
                        let mut active = self.active_downloads.write().await;
                        active.remove(model_name);
                        return Err(anyhow!("Retry failed with status: {}", response.status()));
                    }
                    (response.content_length().unwrap_or(0), false)
                } else {
                    let mut active = self.active_downloads.write().await;
                    active.remove(model_name);
                    return Err(anyhow!(
                        "Download failed for {} with status: {}",
                        filename,
                        response.status()
                    ));
                };

            let file = if resuming {
                fs::OpenOptions::new()
                    .append(true)
                    .open(&file_path)
                    .await
                    .map_err(|e| anyhow!("Failed to open {} for resume: {}", filename, e))?
            } else {
                fs::File::create(&file_path)
                    .await
                    .map_err(|e| anyhow!("Failed to create {}: {}", filename, e))?
            };

            let mut writer = BufWriter::with_capacity(8 * 1024 * 1024, file);

            use futures_util::StreamExt;
            let mut stream = response.bytes_stream();

            loop {
                // Check cancellation
                {
                    let cancel_flag = self.cancel_download_flag.read().await;
                    if cancel_flag.as_ref() == Some(&model_name.to_string()) {
                        let _ = writer.flush().await;
                        let mut active = self.active_downloads.write().await;
                        active.remove(model_name);
                        return Err(anyhow!("Download cancelled by user"));
                    }
                }

                let next_result = timeout(Duration::from_secs(30), stream.next()).await;

                let chunk = match next_result {
                    Err(_) => {
                        let _ = writer.flush().await;
                        let mut active = self.active_downloads.write().await;
                        active.remove(model_name);
                        let mut models = self.available_models.write().await;
                        if let Some(model) = models.get_mut(model_name) {
                            model.status = ModelStatus::Missing;
                        }
                        return Err(anyhow!("Download timeout - no data for 30s"));
                    }
                    Ok(None) => break,
                    Ok(Some(Ok(c))) => c,
                    Ok(Some(Err(e))) => {
                        let _ = writer.flush().await;
                        let mut active = self.active_downloads.write().await;
                        active.remove(model_name);
                        let mut models = self.available_models.write().await;
                        if let Some(model) = models.get_mut(model_name) {
                            model.status = ModelStatus::Missing;
                        }
                        return Err(anyhow!("Download error: {}", e));
                    }
                };

                if let Err(e) = writer.write_all(&chunk).await {
                    let mut active = self.active_downloads.write().await;
                    active.remove(model_name);
                    return Err(anyhow!("Failed to write chunk: {}", e));
                }

                let chunk_len = chunk.len() as u64;
                total_downloaded += chunk_len;
                bytes_since_last_report += chunk_len;

                let overall_progress = if total_size_bytes > 0 {
                    ((total_downloaded as f64 / total_size_bytes as f64) * 100.0).min(99.0) as u8
                } else {
                    0
                };

                let elapsed_since_report = last_report_time.elapsed();
                let should_report = overall_progress > last_reported_progress
                    || elapsed_since_report >= Duration::from_millis(500);

                if should_report {
                    let speed_mbps = if elapsed_since_report.as_secs_f64() >= 0.1 {
                        (bytes_since_last_report as f64 / (1024.0 * 1024.0))
                            / elapsed_since_report.as_secs_f64()
                    } else {
                        let total_elapsed = download_start_time.elapsed().as_secs_f64();
                        if total_elapsed > 0.0 {
                            ((total_downloaded - already_downloaded) as f64 / (1024.0 * 1024.0))
                                / total_elapsed
                        } else {
                            0.0
                        }
                    };

                    last_reported_progress = overall_progress;
                    last_report_time = Instant::now();
                    bytes_since_last_report = 0;

                    let progress = DownloadProgress::new(total_downloaded, total_size_bytes, speed_mbps);
                    if let Some(ref callback) = progress_callback {
                        callback(progress);
                    }

                    {
                        let mut models = self.available_models.write().await;
                        if let Some(model) = models.get_mut(model_name) {
                            model.status = ModelStatus::Downloading {
                                progress: overall_progress,
                            };
                        }
                    }
                }
            }

            if let Err(e) = writer.flush().await {
                let mut active = self.active_downloads.write().await;
                active.remove(model_name);
                return Err(anyhow!("Failed to flush {}: {}", filename, e));
            }

            log::info!("Completed: {} ({:.2} MB)", filename, total_downloaded as f64 / 1_048_576.0);
        }

        // Final 100% progress
        let total_elapsed = download_start_time.elapsed().as_secs_f64();
        let final_speed = if total_elapsed > 0.0 {
            ((total_downloaded - already_downloaded) as f64 / (1024.0 * 1024.0)) / total_elapsed
        } else {
            0.0
        };
        let final_progress = DownloadProgress::new(total_size_bytes, total_size_bytes, final_speed);
        if let Some(ref callback) = progress_callback {
            callback(final_progress);
        }

        // Update status to available
        {
            let mut models = self.available_models.write().await;
            if let Some(model) = models.get_mut(model_name) {
                model.status = ModelStatus::Available;
                model.path = model_dir.clone();
            }
        }

        // Remove from active downloads
        {
            let mut active = self.active_downloads.write().await;
            active.remove(model_name);
        }

        // Clear cancel flag
        {
            let mut cancel_flag = self.cancel_download_flag.write().await;
            if cancel_flag.as_ref() == Some(&model_name.to_string()) {
                *cancel_flag = None;
            }
        }

        log::info!("Download completed for Canary model: {}", model_name);
        Ok(())
    }

    pub async fn cancel_download(&self, model_name: &str) -> Result<()> {
        log::info!("Cancelling Canary download: {}", model_name);

        {
            let mut cancel_flag = self.cancel_download_flag.write().await;
            *cancel_flag = Some(model_name.to_string());
        }

        {
            let mut active = self.active_downloads.write().await;
            active.remove(model_name);
        }

        {
            let mut models = self.available_models.write().await;
            if let Some(model) = models.get_mut(model_name) {
                model.status = ModelStatus::Missing;
            }
        }

        tokio::time::sleep(Duration::from_millis(100)).await;

        let model_path = self.models_dir.join(model_name);
        if model_path.exists() {
            if let Err(e) = fs::remove_dir_all(&model_path).await {
                log::warn!("Failed to clean cancelled download: {}", e);
            }
        }

        Ok(())
    }
}
