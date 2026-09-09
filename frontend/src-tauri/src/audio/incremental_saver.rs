use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;
use anyhow::{Result, anyhow};
use log::{info, warn, error};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use tokio::time::{timeout_at, Instant};
use super::encode::encode_single_audio;
use super::recording_state::AudioChunk;
use serde::{Serialize, Deserialize};

use super::ffmpeg::find_ffmpeg_path;

/// Tope para que `finalize()` deje de esperar al encode en vuelo. Cubre las DOS
/// esperas (el flush del último tramo y la barrera previa al merge) con una sola
/// fecha límite: antes el flush esperaba el permiso SIN timeout y sólo el
/// spin-wait posterior tenía los 300 s, así que un ffmpeg colgado congelaba
/// `finalize()` antes de llegar siquiera ahí.
const FINALIZE_ENCODE_TIMEOUT: Duration = Duration::from_secs(300);

/// Umbral de "audio.mp4 sospechosamente chico" para `FinalizeReport::is_anomalous`.
/// La firma real del campo (Fase 0 del modo lote): carpetas de jornada con
/// 8 KB de audio por HORA — un merge "exitoso" que no contiene casi nada.
/// 100 KB con ≥4 checkpoints (≥2 min de grabación a 64 kbps ≈ ~1 MB esperado)
/// es un orden de magnitud por debajo de lo posible con voz o silencio.
const ANOMALOUS_MERGED_MIN_BYTES: u64 = 100 * 1024;
/// Mínimo de checkpoints para aplicar el umbral de tamaño: una grabación de
/// <2 min legítimamente puede pesar poco.
const ANOMALOUS_MIN_CHECKPOINTS: u32 = 4;

/// Reporte de integridad del cierre de una grabación incremental. Lo produce
/// `finalize()` y lo emite el caller con `AppHandle` (el saver no tiene) como
/// telemetría `audio.checkpoint_integrity` — SOLO cuando `is_anomalous()`:
/// antes de esto, un checkpoint perdido era un `warn!` local invisible
/// (`docs/AUDITORIA_RECURSOS_2026-09-02.md` § Mediciones, carpetas de 8 KB/h).
/// En el modo lote el audio pasa a ser la única fuente de verdad, así que un
/// fallo silencioso aquí dejaría de costar 30 s de transcript y pasaría a
/// costar la grabación entera.
#[derive(Debug, Clone, Serialize)]
pub struct FinalizeReport {
    /// Checkpoints que el saver despachó a encode durante la grabación.
    pub checkpoint_count: u32,
    /// Archivos ausentes al mergear (encodes que fallaron o no aterrizaron).
    pub missing: u32,
    /// Encodes que reportaron error (puede solaparse con `missing`).
    pub encode_errors: u32,
    /// Bytes del `audio.mp4` final.
    pub merged_bytes: u64,
    /// Duración estimada del audio mergeado: (checkpoints presentes) × 30 s.
    /// Estimación (el último checkpoint suele ser < 30 s); sirve para el
    /// análisis de bytes/segundo, no como duración autoritativa.
    pub merged_duration_est_secs: u32,
}

impl FinalizeReport {
    /// ¿El cierre amerita telemetría? Pura, con tests. Cualquier checkpoint
    /// perdido o con error es anómalo; y un merge "exitoso" pero minúsculo
    /// (la firma de las carpetas de 8 KB/h) también, aunque nada haya
    /// reportado error.
    pub fn is_anomalous(&self) -> bool {
        self.missing > 0
            || self.encode_errors > 0
            || (self.checkpoint_count >= ANOMALOUS_MIN_CHECKPOINTS
                && self.merged_bytes < ANOMALOUS_MERGED_MIN_BYTES)
    }
}

/// Incremental audio saver that writes checkpoints every 30 seconds
/// to minimize memory usage and enable crash recovery
pub struct IncrementalAudioSaver {
    /// Buffer contiguo de muestras interleaved (f32), preasignado con
    /// `with_capacity`. Antes era un `Vec<AudioData>` de ~300 sub-buffers
    /// sueltos que había que concatenar en un SEGUNDO Vec de 2.88M elementos
    /// justo antes de cada encode (pico de ~23MB extra por checkpoint, más
    /// el buffer viejo re-creciendo de 0 cada 30s tras el `mem::take`). Ahora
    /// los chunks se escriben aquí directo con `extend_from_slice` y viajan
    /// a ffmpeg sin una copia intermedia.
    checkpoint_buffer: Vec<f32>,
    checkpoint_interval_samples: usize,  // 30s at 48kHz = 1,440,000 samples (per channel)
    checkpoint_count: u32,
    encode_errors: Arc<AtomicU32>,
    /// Acota a 1 el número de encodes de checkpoint en vuelo a la vez. Sin
    /// esto, un encode lento (máquina cargada) dejaba que los checkpoints se
    /// apilaran sin tope en el pool blocking de tokio (512 hilos), cada uno
    /// con su propio proceso ffmpeg y sus ~23MB de buffer. Es POR SAVER, no
    /// un `OnceLock` global: solo hay un saver vivo a la vez y así los tests
    /// no comparten estado entre sí.
    ///
    /// Es también la ÚNICA señal de "hay un encode en vuelo": cada encode
    /// retiene el permiso hasta que su closure termina, así que `finalize()`
    /// espera el permiso en vez de sondear un contador aparte (#18).
    encode_slots: Arc<Semaphore>,
    /// Momento en que el flush quedo diferido por falta de permiso, o `None`
    /// si no lo esta. Es un LATCH para el log, no estado funcional: sin el,
    /// los ~10 `add_chunk` por segundo convierten un encode lento en una
    /// tormenta de avisos identicos (el mismo patron que costo 965 eventos
    /// en 8h en el piloto Dingler).
    deferred_since: Option<std::time::Instant>,
    checkpoints_dir: PathBuf,
    meeting_folder: PathBuf,
    sample_rate: u32,
    channels: u16,  // 1 = mono, 2 = stereo (L=mic, R=system)
}

impl IncrementalAudioSaver {
    /// Create a new incremental saver
    ///
    /// # Arguments
    /// * `meeting_folder` - Path to the meeting folder (contains .checkpoints/)
    /// * `sample_rate` - Sample rate of audio (typically 48000)
    /// * `channels` - Number of audio channels (1=mono, 2=stereo L=mic R=system)
    pub fn new(meeting_folder: PathBuf, sample_rate: u32, channels: u16) -> Result<Self> {
        let checkpoints_dir = meeting_folder.join(".checkpoints");

        // Verify checkpoints directory exists
        if !checkpoints_dir.exists() {
            return Err(anyhow!("Checkpoints directory does not exist: {}", checkpoints_dir.display()));
        }

        info!("IncrementalAudioSaver: {} channels, {}Hz, 30s checkpoints", channels, sample_rate);

        // 30 seconds worth of samples (accounting for channels)
        // For stereo: 48000 * 30 * 2 = 2,880,000 interleaved samples
        let checkpoint_interval_samples = sample_rate as usize * 30 * channels as usize;

        Ok(Self {
            checkpoint_buffer: Vec::with_capacity(checkpoint_interval_samples),
            checkpoint_interval_samples,
            checkpoint_count: 0,
            encode_errors: Arc::new(AtomicU32::new(0)),
            encode_slots: Arc::new(Semaphore::new(1)),
            deferred_since: None,
            checkpoints_dir,
            meeting_folder,
            sample_rate,
            channels,
        })
    }

    /// Add an audio chunk to the buffer
    /// Automatically saves a checkpoint when buffer reaches 30 seconds
    pub fn add_chunk(&mut self, chunk: AudioChunk) -> Result<()> {
        self.checkpoint_buffer.extend_from_slice(&chunk.data);

        // Save checkpoint when buffer reaches threshold (30 seconds)
        if self.checkpoint_buffer.len() >= self.checkpoint_interval_samples {
            self.spawn_checkpoint_encode();
        }

        Ok(())
    }

    /// Saca el buffer acumulado y lo reemplaza por uno vacío ya preasignado
    /// (`with_capacity`), para que no tenga que re-crecer de 0 muestras en
    /// el siguiente ciclo de 30s. Separado del encode en sí para poder
    /// probar la preasignación sin disparar un encode real (que exige
    /// ffmpeg instalado).
    fn take_buffer_for_checkpoint(&mut self) -> Vec<f32> {
        std::mem::replace(
            &mut self.checkpoint_buffer,
            Vec::with_capacity(self.checkpoint_interval_samples),
        )
    }

    /// Lanza el encode en el pool blocking de tokio con el buffer ya tomado
    /// y el permiso del semáforo ya en mano. El FFmpeg encode toma 1-4s en
    /// máquinas cargadas; correrlo inline bloquearía un worker de tokio (y el
    /// AsyncMutex del saver) ese tiempo cada 30s. El permiso vive DENTRO del
    /// closure y se suelta al terminar por cualquier camino (también al
    /// desenrollar un panic: `spawn_blocking` lo captura y suelta los locales),
    /// así que "permiso libre" ⇔ "ningún encode en vuelo" — es lo que
    /// `finalize()` espera antes de mergear.
    fn dispatch_checkpoint_encode(&mut self, buf: Vec<f32>, permit: OwnedSemaphorePermit) {
        let checkpoint_path = self.checkpoints_dir
            .join(format!("audio_chunk_{:03}.mp4", self.checkpoint_count));
        self.checkpoint_count += 1;
        let checkpoint_number = self.checkpoint_count;

        let sample_rate = self.sample_rate;
        let channels = self.channels;
        let errors = self.encode_errors.clone();

        tokio::task::spawn_blocking(move || {
            // Retenido hasta el final del closure: libera el slot para el
            // siguiente checkpoint y destraba la barrera de `finalize()`.
            let _permit = permit;

            match encode_single_audio(
                bytemuck::cast_slice(&buf),
                sample_rate,
                channels,
                &checkpoint_path,
            ) {
                Ok(()) => {
                    let duration_seconds =
                        buf.len() as f32 / (sample_rate as f32 * channels as f32);
                    info!("Saved checkpoint {}: {:.2}s of audio ({} samples)",
                          checkpoint_number, duration_seconds, buf.len());
                }
                Err(e) => {
                    errors.fetch_add(1, Ordering::SeqCst);
                    error!("Failed to encode checkpoint {}: {}", checkpoint_number, e);
                }
            }
        });
    }

    /// Camino normal, llamado desde `add_chunk` (sync). Intenta tomar el
    /// permiso SIN esperar: si ya hay un encode en vuelo, NO se lleva el
    /// buffer — sigue acumulando y se reintenta en el siguiente chunk
    /// (~100ms después). El checkpoint sale más largo de 30s, pero no se
    /// pierde audio, y la memoria queda acotada a ~2 buffers (uno
    /// encodeando + uno llenándose) en vez de crecer sin tope si la máquina
    /// va lenta y los encodes se acumulan.
    fn spawn_checkpoint_encode(&mut self) {
        if self.checkpoint_buffer.is_empty() {
            warn!("Attempted to save empty checkpoint, skipping");
            return;
        }

        let permit = match self.encode_slots.clone().try_acquire_owned() {
            Ok(permit) => permit,
            Err(_) => {
                // Latch: `add_chunk` entra aquí ~10 veces por segundo mientras
                // el buffer siga por encima del umbral, asi que sin esto un
                // encode que se pase de los 30s escupiria 10 warns/segundo al
                // log rotativo. Se avisa UNA vez al entrar en estado diferido.
                if self.deferred_since.is_none() {
                    self.deferred_since = Some(std::time::Instant::now());
                    warn!(
                        "Encode de checkpoint anterior sigue en vuelo; difiriendo flush ({} samples acumulados)",
                        self.checkpoint_buffer.len()
                    );
                }
                return;
            }
        };

        // Salimos del estado diferido: un solo aviso con cuanto duro, para poder
        // medir en el log si la maquina se esta quedando corta de CPU.
        if let Some(since) = self.deferred_since.take() {
            warn!(
                "Flush de checkpoint reanudado tras {:.1}s diferido ({} samples acumulados)",
                since.elapsed().as_secs_f32(),
                self.checkpoint_buffer.len()
            );
        }

        let buf = self.take_buffer_for_checkpoint();
        self.dispatch_checkpoint_encode(buf, permit);
    }

    /// Espera el único permiso del semáforo hasta `deadline`. Tenerlo en mano
    /// demuestra que el encode anterior terminó (su closure lo retenía).
    async fn acquire_encode_slot(&self, deadline: Instant, what: &str) -> Result<OwnedSemaphorePermit> {
        match timeout_at(deadline, self.encode_slots.clone().acquire_owned()).await {
            Ok(Ok(permit)) => Ok(permit),
            // Solo ocurre si el semáforo se cerrara explícitamente (nunca lo hacemos).
            Ok(Err(_)) => Err(anyhow!("encode_slots semaphore closed unexpectedly during finalize")),
            Err(_) => Err(anyhow!(
                "Timed out waiting for the in-flight checkpoint encode to finish ({what})"
            )),
        }
    }

    /// Versión forzada para `finalize()`: espera (await) el permiso en vez
    /// de solo intentarlo. Sin este flush forzado, el último checkpoint de
    /// la grabación podría quedar diferido para siempre si el encode
    /// anterior seguía en vuelo justo cuando la grabación terminó. La espera
    /// está acotada por `deadline` (antes no lo estaba: ver
    /// `FINALIZE_ENCODE_TIMEOUT`).
    async fn flush_checkpoint(&mut self, deadline: Instant) -> Result<()> {
        if self.checkpoint_buffer.is_empty() {
            return Ok(());
        }

        let permit = self.acquire_encode_slot(deadline, "before the final flush").await?;
        let buf = self.take_buffer_for_checkpoint();
        self.dispatch_checkpoint_encode(buf, permit);
        Ok(())
    }

    /// Finalize the recording: save final checkpoint, merge all checkpoints, cleanup
    ///
    /// Returns the path to the final merged audio.mp4 file plus the integrity
    /// report (F0a del modo lote): el caller decide si emite telemetría.
    pub async fn finalize(&mut self) -> Result<(PathBuf, FinalizeReport)> {
        info!("Finalizing incremental recording...");

        // Una sola fecha límite para las dos esperas de abajo.
        let deadline = Instant::now() + FINALIZE_ENCODE_TIMEOUT;

        // Save final buffer if not empty (flush forzado: espera el permiso en vez
        // de solo intentarlo, para no perder el último tramo de audio).
        if !self.checkpoint_buffer.is_empty() {
            info!("Saving final checkpoint with remaining {} samples", self.checkpoint_buffer.len());
            self.flush_checkpoint(deadline).await?;
        }

        // Barrera: los archivos del encode en vuelo deben existir antes del
        // merge. Sostener el único permiso ⇔ ningún encode en vuelo, porque
        // cada encode lo retiene hasta que su closure termina y aquí tenemos
        // `&mut self` (ningún `add_chunk` puede colarse). Sustituye al spin-wait
        // de 50 ms sobre un contador aparte (#18). Se suelta enseguida: sólo
        // sirve como prueba de que el encode anterior terminó.
        let barrier = self.acquire_encode_slot(deadline, "before the merge").await?;
        drop(barrier);
        let failed = self.encode_errors.load(Ordering::SeqCst);
        if failed > 0 {
            warn!("{} checkpoint(s) failed to encode; merge will skip their files", failed);
        }

        if self.checkpoint_count == 0 {
            return Err(anyhow!("No audio checkpoints to merge - recording may have failed"));
        }

        // Merge all checkpoints using FFmpeg concat
        let final_audio_path = self.meeting_folder.join("audio.mp4");
        let missing = self.merge_checkpoints(&final_audio_path).await?;

        // Clean up checkpoints directory
        info!("Cleaning up {} checkpoint files", self.checkpoint_count);
        if let Err(e) = std::fs::remove_dir_all(&self.checkpoints_dir) {
            warn!("Failed to clean up checkpoints directory: {}", e);
            // Non-fatal - user can manually delete
        }

        let merged_bytes = std::fs::metadata(&final_audio_path)
            .map(|m| m.len())
            .unwrap_or(0);
        let report = FinalizeReport {
            checkpoint_count: self.checkpoint_count,
            missing,
            encode_errors: failed,
            merged_bytes,
            merged_duration_est_secs: self.checkpoint_count.saturating_sub(missing) * 30,
        };

        info!(
            "Finalized recording: {} ({} bytes, {} checkpoints, {} missing, {} encode errors)",
            final_audio_path.display(),
            report.merged_bytes,
            report.checkpoint_count,
            report.missing,
            report.encode_errors
        );

        Ok((final_audio_path, report))
    }

    /// Merge all checkpoint files into final audio.mp4 using FFmpeg concat
    /// Uses concat demuxer for fast merging without re-encoding.
    /// Devuelve cuántos checkpoints faltaban en disco (para el `FinalizeReport`).
    async fn merge_checkpoints(&self, output: &PathBuf) -> Result<u32> {
        info!("Merging {} checkpoints into final audio file...", self.checkpoint_count);

        // Create concat list file for FFmpeg
        let list_file = self.checkpoints_dir.join("concat_list.txt");
        let mut list_content = String::new();

        let mut missing = 0u32;
        for i in 0..self.checkpoint_count {
            let checkpoint_path = self.checkpoints_dir
                .join(format!("audio_chunk_{:03}.mp4", i));

            // A failed background encode leaves a gap; losing 30s beats
            // failing the whole recording, so skip with a warning.
            if !checkpoint_path.exists() {
                warn!("Checkpoint file missing (encode failed?), skipping: {}", checkpoint_path.display());
                missing += 1;
                continue;
            }

            // Use absolute path for FFmpeg (required for safe mode)
            let abs_path = checkpoint_path.canonicalize()?;
            list_content.push_str(&format!("file '{}'\n", abs_path.display()));
        }

        if missing == self.checkpoint_count {
            return Err(anyhow!("All {} checkpoint files are missing", missing));
        }

        std::fs::write(&list_file, list_content)?;

        let ffmpeg_path = find_ffmpeg_path()
            .ok_or_else(|| anyhow!("FFmpeg not found. Please install FFmpeg to finalize recordings."))?;
        info!("Using FFmpeg at: {:?}", ffmpeg_path);

        // Concat demuxer con copy codec (sin re-encodear), sin bloquear el worker.
        if let Err(e) = run_ffmpeg_concat(ffmpeg_path, &list_file, output).await {
            error!("FFmpeg merge failed: {}", e);
            return Err(e);
        }

        info!("Successfully merged {} checkpoints → {}",
              self.checkpoint_count, output.display());

        Ok(missing)
    }

    /// Get the meeting folder path
    pub fn get_meeting_folder(&self) -> &PathBuf {
        &self.meeting_folder
    }

    /// Get current checkpoint count
    pub fn get_checkpoint_count(&self) -> u32 {
        self.checkpoint_count
    }
}

/// Argumentos EXACTOS del concat final (`merge_checkpoints`) y de la
/// recuperación post-crash (`recover_audio_from_checkpoints`). Función PURA con
/// golden test, por la misma razón que `encode::encode_args`: es la única forma
/// de blindar los flags sin necesitar ffmpeg en el test.
///
/// `-c copy` exige AudioSpecificConfig compatible entre checkpoints (AAC-LC /
/// 48 kHz / estéreo, que garantiza `encode_args`); el bitrate no forma parte.
/// `-nostdin` va con el `Stdio::null()` de `run_ffmpeg_concat`: el `output()`
/// de `tokio::process`, a diferencia del de `std`, NO anula stdin, y ffmpeg lo
/// lee en modo interactivo si lo hereda.
pub(crate) fn concat_args(list_file: &str, output: &str) -> Vec<String> {
    [
        // No imprimir la cabecera de versión/config
        "-hide_banner",
        // Solo errores reales, no el spam de progreso por defecto
        "-loglevel",
        "error",
        // Sin la línea de stats que ffmpeg reescribe en stderr
        "-nostats",
        // No leer stdin (ver arriba)
        "-nostdin",
        // Demuxer concat con rutas absolutas (safe mode off)
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        list_file,
        // Copy codec: sin re-encodear
        "-c",
        "copy",
        // Sobrescribir la salida si existe
        "-y",
        output,
    ]
    .into_iter()
    .map(str::to_string)
    .collect()
}

/// Corre el concat de ffmpeg SIN bloquear un worker de tokio (#18 de la
/// auditoría de recursos). Antes `std::process::Command::output()` dentro de
/// una `async fn` bloqueaba el worker Y el AsyncMutex del saver durante todo el
/// concat en cada rotación de jornada. `tokio::process` drena stdout y stderr en
/// paralelo (sin el deadlock de pipes de #08) y `kill_on_drop` termina al hijo
/// si el futuro se cancela a mitad (tokio no tiene reaper de huérfanos en
/// Windows). Verifica además que el archivo de salida exista.
async fn run_ffmpeg_concat(ffmpeg_path: PathBuf, list_file: &Path, output: &Path) -> Result<()> {
    let list_str = list_file
        .to_str()
        .ok_or_else(|| anyhow!("List file path contains invalid UTF-8: {:?}", list_file))?;
    let output_str = output
        .to_str()
        .ok_or_else(|| anyhow!("Output path contains invalid UTF-8: {:?}", output))?;

    let mut command = tokio::process::Command::new(ffmpeg_path);
    command
        .args(concat_args(list_str, output_str))
        .stdin(Stdio::null())
        .kill_on_drop(true);

    // Hide console window on Windows to prevent CMD popup during finalization
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let ffmpeg_output = command
        .output()
        .await
        .map_err(|e| anyhow!("Failed to run FFmpeg: {}", e))?;

    if !ffmpeg_output.status.success() {
        let stderr = String::from_utf8_lossy(&ffmpeg_output.stderr);
        return Err(anyhow!("FFmpeg concat failed: {}", stderr.trim()));
    }

    if !output.exists() {
        return Err(anyhow!("Merged audio file was not created: {}", output.display()));
    }

    Ok(())
}

/// Audio recovery status for transcript recovery feature
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioRecoveryStatus {
    pub status: String, // "success" | "partial" | "failed" | "none"
    pub chunk_count: u32,
    pub estimated_duration_seconds: f64,
    pub audio_file_path: Option<String>,
    pub message: String,
}

/// Recover audio from checkpoint files
/// This is called by the transcript recovery system to merge audio chunks after a crash
#[tauri::command]
pub async fn recover_audio_from_checkpoints(
    meeting_folder: String,
    _sample_rate: u32
) -> Result<AudioRecoveryStatus, String> {
    info!("Starting audio recovery for folder: {}", meeting_folder);

    let folder_path = PathBuf::from(&meeting_folder);
    let checkpoints_dir = folder_path.join(".checkpoints");

    // Check if checkpoints directory exists
    if !checkpoints_dir.exists() {
        info!("No checkpoints directory found at: {}", checkpoints_dir.display());
        return Ok(AudioRecoveryStatus {
            status: "none".to_string(),
            chunk_count: 0,
            estimated_duration_seconds: 0.0,
            audio_file_path: None,
            message: "No audio checkpoints found".to_string(),
        });
    }

    // Scan for checkpoint files
    let mut checkpoint_files: Vec<_> = std::fs::read_dir(&checkpoints_dir)
        .map_err(|e| format!("Failed to read checkpoints directory: {}", e))?
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            entry.path().extension().and_then(|s| s.to_str()) == Some("mp4")
        })
        .collect();

    if checkpoint_files.is_empty() {
        info!("No checkpoint files found in: {}", checkpoints_dir.display());
        return Ok(AudioRecoveryStatus {
            status: "none".to_string(),
            chunk_count: 0,
            estimated_duration_seconds: 0.0,
            audio_file_path: None,
            message: "No audio checkpoint files found".to_string(),
        });
    }

    // Sort by filename (audio_chunk_000.mp4, audio_chunk_001.mp4, etc.)
    checkpoint_files.sort_by_key(|entry| entry.path());

    let chunk_count = checkpoint_files.len() as u32;
    let estimated_duration = (chunk_count as f64) * 30.0; // 30 seconds per chunk

    info!("Found {} checkpoint files, estimated duration: {:.2}s", chunk_count, estimated_duration);

    // Create FFmpeg concat file
    let concat_file_path = checkpoints_dir.join("concat_list.txt");
    let mut concat_content = String::new();

    for entry in &checkpoint_files {
        let path = entry.path().canonicalize()
            .map_err(|e| format!("Failed to canonicalize path: {}", e))?;
        concat_content.push_str(&format!("file '{}'\n", path.display()));
    }

    std::fs::write(&concat_file_path, concat_content)
        .map_err(|e| format!("Failed to write concat file: {}", e))?;

    // Run FFmpeg to merge chunks
    let output_path = folder_path.join("audio.mp4");
    let output_path_str = output_path.to_str()
        .ok_or("Invalid output path")?
        .to_string();

    let ffmpeg_path = find_ffmpeg_path()
        .ok_or_else(|| "FFmpeg not found. Please install FFmpeg to recover audio.".to_string())?;
    info!("Using FFmpeg at: {:?}", ffmpeg_path);

    // Mismo runner asíncrono que el merge normal (#18). Un fallo de ffmpeg se
    // reporta como `status: "failed"`, NUNCA como Err del comando: el diálogo de
    // recuperación distingue "no había checkpoints" de "ffmpeg falló".
    match run_ffmpeg_concat(ffmpeg_path, &concat_file_path, &output_path).await {
        Ok(()) => {
            // Clean up concat file
            let _ = std::fs::remove_file(concat_file_path);

            info!("Successfully recovered audio: {}", output_path_str);

            Ok(AudioRecoveryStatus {
                status: "success".to_string(),
                chunk_count,
                estimated_duration_seconds: estimated_duration,
                audio_file_path: Some(output_path_str),
                message: format!("Successfully recovered {} audio chunks", chunk_count),
            })
        }
        Err(e) => {
            error!("FFmpeg recovery failed: {}", e);
            Ok(AudioRecoveryStatus {
                status: "failed".to_string(),
                chunk_count,
                estimated_duration_seconds: estimated_duration,
                audio_file_path: None,
                message: format!("FFmpeg failed: {}", e),
            })
        }
    }
}

/// Clean up checkpoint files after successful recording or recovery
/// This command is called by the frontend after successful save to clean up checkpoint files
#[tauri::command]
pub async fn cleanup_checkpoints(meeting_folder: String) -> Result<(), String> {
    info!("Cleaning up checkpoints for folder: {}", meeting_folder);

    let folder_path = PathBuf::from(&meeting_folder);
    let checkpoints_dir = folder_path.join(".checkpoints");

    if checkpoints_dir.exists() {
        std::fs::remove_dir_all(&checkpoints_dir)
            .map_err(|e| format!("Failed to remove checkpoints directory: {}", e))?;
        info!("Successfully cleaned up checkpoints directory");
    } else {
        info!("No checkpoints directory to clean up");
    }

    Ok(())
}

/// Check if a meeting folder has audio checkpoint files
/// Returns true if .checkpoints/ directory exists and contains .mp4 files
#[tauri::command]
pub async fn has_audio_checkpoints(meeting_folder: String) -> Result<bool, String> {
    let folder_path = PathBuf::from(&meeting_folder);
    let checkpoints_dir = folder_path.join(".checkpoints");

    // Check if checkpoints directory exists
    if !checkpoints_dir.exists() {
        return Ok(false);
    }

    // Scan for .mp4 checkpoint files
    let has_mp4_files = std::fs::read_dir(&checkpoints_dir)
        .map_err(|e| format!("Failed to read checkpoints directory: {}", e))?
        .filter_map(|entry| entry.ok())
        .any(|entry| {
            entry.path().extension().and_then(|s| s.to_str()) == Some("mp4")
        });

    Ok(has_mp4_files)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use super::super::recording_state::DeviceType;

    #[tokio::test]
    #[ignore] // Requiere ffmpeg real EN EL PATH. Que macOS y Windows lo bundleen
              // (#77, #32) NO ayuda aquí: el binario de test vive en
              // target/debug/deps/ y el externalBin en target/debug/, así que la
              // rama "junto al exe" de find_ffmpeg_path no lo ve. Sin ffmpeg en
              // PATH se caería en handle_ffmpeg_installation() → descarga real, y
              // tokio bloquea el Drop del runtime del test hasta que termine el
              // spawn_blocking: se colgaría en vez de fallar rápido. Correr a mano
              // con `cargo test -p maity-desktop -- --ignored` en una máquina con
              // ffmpeg instalado.
    async fn test_checkpoint_creation() {
        // Create temp meeting folder
        let temp_dir = tempdir().unwrap();
        let meeting_folder = temp_dir.path().join("Test_Meeting");
        std::fs::create_dir_all(&meeting_folder).unwrap();
        std::fs::create_dir_all(meeting_folder.join(".checkpoints")).unwrap();

        let mut saver = IncrementalAudioSaver::new(
            meeting_folder.clone(),
            48000,
            2  // stereo (L=mic, R=system)
        ).unwrap();

        // Add 60 seconds worth of audio (debería producir 2 checkpoints en total).
        // Pipeline emits interleaved stereo chunks, so 0.5s @ 48kHz stereo = 48000 samples
        // (not 24000, which would be 0.5s mono).
        //
        // Con el semáforo de 1 permiso, el SEGUNDO cruce del umbral de 30s puede
        // encontrar el primer encode todavía en vuelo y quedar diferido — por
        // eso ya NO afirmamos el conteo aquí a mitad de grabación (como hacía
        // esta prueba antes), sino después de finalize(), que fuerza el flush
        // del remanente y garantiza que ambos checkpoints se hayan lanzado.
        for i in 0..120u64 {  // 120 chunks of 0.5s each
            let chunk = AudioChunk {
                data: vec![0.5f32; 48000],  // 0.5s stereo interleaved @ 48kHz
                sample_rate: 48000,
                timestamp: i as f64 * 0.5,
                chunk_id: i,
                device_type: DeviceType::Mixed,
                ended_by_silence: true,
            };
            saver.add_chunk(chunk).unwrap();
        }

        // Finalize and verify merge
        let (final_path, report) = saver.finalize().await.unwrap();
        assert!(final_path.exists());
        assert_eq!(report.missing, 0);
        assert!(!report.is_anomalous());

        // Verify checkpoints directory deleted
        assert!(!meeting_folder.join(".checkpoints").exists());

        // Verify 2 checkpoints were produced across the whole recording (checked
        // AFTER finalize, not mid-recording — ver comentario arriba).
        assert_eq!(saver.checkpoint_count, 2);
    }

    /// Prueba el cambio central del issue sin necesitar ffmpeg instalado: si el
    /// slot de encode está ocupado, `add_chunk` NO debe tirar audio ni avanzar
    /// `checkpoint_count` — debe seguir acumulando y reintentar más tarde.
    ///
    /// Deliberadamente NO llama a `flush_checkpoint()`/`spawn_checkpoint_encode()`
    /// con el permiso libre: hacerlo despacharía un `spawn_blocking` real hacia
    /// `encode_single_audio` → `find_ffmpeg_path()`. Bajo `cargo test` eso NO se
    /// resuelve con el ffmpeg bundleado (el binario de test corre desde
    /// `target/debug/deps/` y el externalBin está en `target/debug/`), así que en
    /// una máquina sin ffmpeg en PATH acabaría en una descarga real — y como tokio
    /// bloquea el `Drop` del runtime del test hasta que ese `spawn_blocking`
    /// termine, el test se colgaría esperando red. Es el mismo riesgo por el que
    /// `test_checkpoint_creation` de arriba quedó `#[ignore]`. En vez de eso, esta
    /// prueba verifica la contabilidad del semáforo directamente (que el permiso se
    /// libera al soltar el guard sostenido a mano).
    #[tokio::test]
    async fn test_checkpoint_defers_without_dropping_audio_when_encode_busy() {
        let temp_dir = tempdir().unwrap();
        let meeting_folder = temp_dir.path().join("Busy_Test");
        std::fs::create_dir_all(&meeting_folder).unwrap();
        std::fs::create_dir_all(meeting_folder.join(".checkpoints")).unwrap();

        let mut saver = IncrementalAudioSaver::new(
            meeting_folder.clone(),
            48000,
            2, // stereo (L=mic, R=system)
        ).unwrap();

        // Simula un encode en vuelo tomando el único permiso a mano.
        let held_permit = saver.encode_slots.clone().try_acquire_owned()
            .expect("el semáforo debe nacer con 1 permiso libre");

        // Alimenta 60s de audio (2x el intervalo de checkpoint de 30s), cruzando
        // el umbral dos veces mientras el permiso sigue ocupado.
        let mut total_samples_pushed: usize = 0;
        for i in 0..120u64 {
            let chunk = AudioChunk {
                data: vec![0.5f32; 48000], // 0.5s stereo interleaved @ 48kHz
                sample_rate: 48000,
                timestamp: i as f64 * 0.5,
                chunk_id: i,
                device_type: DeviceType::Mixed,
                ended_by_silence: true,
            };
            total_samples_pushed += chunk.data.len();
            saver.add_chunk(chunk).unwrap();
        }

        // (a) Ningún checkpoint pudo despacharse: el slot seguía ocupado.
        assert_eq!(saver.checkpoint_count, 0);

        // (b) El audio no se perdió: el buffer acumuló TODO lo empujado, más
        // allá del umbral de un solo checkpoint.
        assert_eq!(saver.checkpoint_buffer.len(), total_samples_pushed);
        assert!(saver.checkpoint_buffer.len() > saver.checkpoint_interval_samples);

        // Soltar el permiso sostenido a mano debe devolverlo al semáforo: un
        // nuevo try_acquire debe volver a tener éxito (no hay fuga de permisos).
        drop(held_permit);
        let fresh_permit = saver.encode_slots.clone().try_acquire_owned();
        assert!(fresh_permit.is_ok(), "el permiso debe quedar disponible de nuevo tras soltar el anterior");
        drop(fresh_permit);
    }

    /// El buffer de reemplazo tras un flush debe nacer YA preasignado
    /// (`with_capacity`), no vacío-y-creciendo-de-0: si no, cada checkpoint de
    /// 30s re-crece el Vec desde cero en vez de reusar la capacidad reservada.
    /// Usa `take_buffer_for_checkpoint()` directo (sin pasar por el encode real)
    /// para no depender de ffmpeg — ver comentario del test anterior.
    #[tokio::test]
    async fn test_checkpoint_buffer_replacement_is_preallocated() {
        let temp_dir = tempdir().unwrap();
        let meeting_folder = temp_dir.path().join("Prealloc_Test");
        std::fs::create_dir_all(&meeting_folder).unwrap();
        std::fs::create_dir_all(meeting_folder.join(".checkpoints")).unwrap();

        let mut saver = IncrementalAudioSaver::new(
            meeting_folder.clone(),
            48000,
            2, // stereo (L=mic, R=system)
        ).unwrap();

        // El buffer inicial ya nace preasignado.
        assert!(saver.checkpoint_buffer.capacity() >= saver.checkpoint_interval_samples);

        // Llenarlo con algo de audio para que el "flush" tenga contenido real que mover.
        let chunk = AudioChunk {
            data: vec![0.5f32; 48000],
            sample_rate: 48000,
            timestamp: 0.0,
            chunk_id: 0,
            device_type: DeviceType::Mixed,
            ended_by_silence: true,
        };
        saver.add_chunk(chunk).unwrap();
        assert!(!saver.checkpoint_buffer.is_empty());

        let taken = saver.take_buffer_for_checkpoint();
        assert_eq!(taken.len(), 48000);

        // El buffer que queda en el saver (el reemplazo) debe seguir preasignado.
        assert!(saver.checkpoint_buffer.is_empty());
        assert!(saver.checkpoint_buffer.capacity() >= saver.checkpoint_interval_samples);
    }

    #[tokio::test]
    async fn test_empty_recording() {
        let temp_dir = tempdir().unwrap();
        let meeting_folder = temp_dir.path().join("Empty_Test");
        std::fs::create_dir_all(&meeting_folder).unwrap();
        std::fs::create_dir_all(meeting_folder.join(".checkpoints")).unwrap();

        let mut saver = IncrementalAudioSaver::new(
            meeting_folder.clone(),
            48000,
            2  // stereo (L=mic, R=system)
        ).unwrap();

        // Try to finalize without adding any chunks
        let result = saver.finalize().await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("No audio checkpoints"));
    }

    /// #18: la barrera previa al merge espera el permiso del semáforo con
    /// timeout, no un contador con spin-wait. Con el permiso ocupado (un encode
    /// "colgado"), `finalize()` debe rendirse con "Timed out" en vez de esperar
    /// para siempre. Tiempo pausado: tokio auto-avanza los 300 s del deadline en
    /// cuanto no queda trabajo listo, así que el test tarda milisegundos.
    #[tokio::test(start_paused = true)]
    async fn test_finalize_expira_si_el_encode_en_vuelo_no_termina() {
        let temp_dir = tempdir().unwrap();
        let meeting_folder = temp_dir.path().join("Hung_Encode_Test");
        std::fs::create_dir_all(&meeting_folder).unwrap();
        std::fs::create_dir_all(meeting_folder.join(".checkpoints")).unwrap();

        let mut saver = IncrementalAudioSaver::new(meeting_folder.clone(), 48000, 2).unwrap();

        // Simula un encode que nunca termina: el permiso queda en manos del test.
        let _held = saver.encode_slots.clone().try_acquire_owned()
            .expect("el semáforo debe nacer con 1 permiso libre");

        let err = saver.finalize().await.expect_err("con el slot ocupado finalize debe expirar");
        assert!(err.to_string().contains("Timed out"), "error inesperado: {err}");
        assert!(err.to_string().contains("before the merge"), "debe expirar en la barrera: {err}");
    }

    /// El flush del último tramo también está acotado por el MISMO deadline.
    /// Antes esperaba el permiso sin timeout: un ffmpeg colgado congelaba
    /// `finalize()` antes de llegar al spin-wait que sí tenía los 300 s. El
    /// chunk empujado queda por debajo del umbral de 30 s, así que `add_chunk`
    /// no intenta despachar nada y el buffer llega lleno a `finalize()`.
    #[tokio::test(start_paused = true)]
    async fn test_flush_final_expira_con_el_mismo_deadline() {
        let temp_dir = tempdir().unwrap();
        let meeting_folder = temp_dir.path().join("Hung_Flush_Test");
        std::fs::create_dir_all(&meeting_folder).unwrap();
        std::fs::create_dir_all(meeting_folder.join(".checkpoints")).unwrap();

        let mut saver = IncrementalAudioSaver::new(meeting_folder.clone(), 48000, 2).unwrap();
        saver.add_chunk(AudioChunk {
            data: vec![0.5f32; 48000],
            sample_rate: 48000,
            timestamp: 0.0,
            chunk_id: 0,
            device_type: DeviceType::Mixed,
            ended_by_silence: true,
        }).unwrap();
        assert!(!saver.checkpoint_buffer.is_empty());

        let _held = saver.encode_slots.clone().try_acquire_owned().unwrap();

        let err = saver.finalize().await.expect_err("el flush final debe expirar");
        assert!(err.to_string().contains("Timed out"), "error inesperado: {err}");
        assert!(err.to_string().contains("before the final flush"), "debe expirar en el flush: {err}");
        // El audio no se tiró: sigue en el buffer para quien quiera rescatarlo.
        assert_eq!(saver.checkpoint_buffer.len(), 48000);
    }

    /// F0a del modo lote: la política de "¿esto amerita telemetría?" es pura.
    /// Cualquier checkpoint perdido o con error es anómalo; y el merge
    /// minúsculo (firma de las carpetas de 8 KB/h) también, pero solo con
    /// suficientes checkpoints para que el tamaño sea imposible.
    #[test]
    fn finalize_report_is_anomalous_tabla() {
        let base = FinalizeReport {
            checkpoint_count: 10,
            missing: 0,
            encode_errors: 0,
            merged_bytes: 5_000_000,
            merged_duration_est_secs: 300,
        };
        let casos = [
            ("cierre sano", FinalizeReport { ..base.clone() }, false),
            ("un checkpoint perdido", FinalizeReport { missing: 1, ..base.clone() }, true),
            ("un encode con error", FinalizeReport { encode_errors: 1, ..base.clone() }, true),
            (
                "merge de 8 KB con una hora de checkpoints",
                FinalizeReport { merged_bytes: 8 * 1024, ..base.clone() },
                true,
            ),
            (
                "grabación corta y chica: legítima",
                FinalizeReport {
                    checkpoint_count: 2,
                    merged_bytes: 8 * 1024,
                    merged_duration_est_secs: 60,
                    ..base.clone()
                },
                false,
            ),
        ];
        for (nombre, report, esperado) in casos {
            assert_eq!(report.is_anomalous(), esperado, "{}", nombre);
        }
    }

    /// Golden master de los flags del concat (mismo molde que
    /// `encode::encode_args_orden_completo_es_estable`): cualquier flag añadido,
    /// quitado o reordenado tiene que ser una decisión consciente. `-nostdin`
    /// es el que acompaña al `Stdio::null()` de `run_ffmpeg_concat`.
    #[test]
    fn concat_args_orden_completo_es_estable() {
        let args = concat_args("C:\\m\\.checkpoints\\concat_list.txt", "C:\\m\\audio.mp4");
        let esperado: Vec<String> = vec![
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostats",
            "-nostdin",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            "C:\\m\\.checkpoints\\concat_list.txt",
            "-c",
            "copy",
            "-y",
            "C:\\m\\audio.mp4",
        ]
        .into_iter()
        .map(str::to_string)
        .collect();

        assert_eq!(args, esperado);
    }
}
