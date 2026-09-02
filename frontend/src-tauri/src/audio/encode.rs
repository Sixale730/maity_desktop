use super::ffmpeg::find_ffmpeg_path; // Correct path to encode module
use super::AudioDevice;
use std::io::{Read, Write};
use std::sync::Arc;
use std::{
    path::PathBuf,
    process::{Command, Stdio},
};
use tracing::{debug, error};

pub struct AudioInput {
    pub data: Arc<Vec<f32>>,
    pub sample_rate: u32,
    pub channels: u16,
    pub device: Arc<AudioDevice>,
}

pub fn encode_single_audio(
    data: &[u8],
    sample_rate: u32,
    channels: u16,
    output_path: &PathBuf,
) -> anyhow::Result<()> {
    debug!("Starting FFmpeg process for {} bytes of audio data", data.len());

    if data.is_empty() {
        return Err(anyhow::anyhow!("No audio data provided for encoding"));
    }

    let ffmpeg_path = find_ffmpeg_path().ok_or_else(|| {
        anyhow::anyhow!("FFmpeg not found. Please install FFmpeg to save recordings.")
    })?;

    debug!("Using FFmpeg at: {:?}", ffmpeg_path);

    let mut command = Command::new(ffmpeg_path);
    command
        .args([
            "-hide_banner", // No imprimir la cabecera de versión/config en cada checkpoint
            "-loglevel",
            "error", // Solo errores reales, no el spam de progreso por defecto
            "-nostats", // Sin la línea de stats que ffmpeg reescribe en stderr
            "-f",
            "f32le",
            "-ar",
            &sample_rate.to_string(),
            "-ac",
            &channels.to_string(),
            "-i",
            "pipe:0",
            "-c:a",
            "aac",
            "-b:a",
            "192k", // Increased from 64k for better audio quality (especially for speech)
            "-profile:a",
            "aac_low", // Use AAC-LC profile for better compatibility
            "-threads",
            "1", // Un AAC de 30s no necesita más; así no compite por CPU con Parakeet en equipos de gama baja
            "-movflags",
            "+faststart", // Optimize for web streaming
            "-f",
            "mp4",
            output_path.to_str().ok_or_else(|| anyhow::anyhow!("Output path contains invalid UTF-8: {:?}", output_path))?,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Hide console window on Windows to prevent CMD popup during recording
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    debug!("FFmpeg command: {:?}", command);

    #[allow(clippy::zombie_processes)]
    let mut ffmpeg = command.spawn().map_err(|e| anyhow::anyhow!("Failed to spawn FFmpeg process: {}", e))?;
    debug!("FFmpeg process spawned");
    let mut stdin = ffmpeg.stdin.take().ok_or_else(|| anyhow::anyhow!("Failed to open FFmpeg stdin pipe"))?;
    let mut stderr_pipe = ffmpeg.stderr.take().ok_or_else(|| anyhow::anyhow!("Failed to open FFmpeg stderr pipe"))?;

    // Drena stderr en un hilo aparte, EN PARALELO con el write_all de stdin de
    // abajo. El pipe de stderr en Windows tiene un buffer de ~64KB: si ffmpeg
    // llegara a llenarlo antes de que termináramos de escribir stdin, nuestro
    // write_all se quedaría bloqueado esperando que ffmpeg lea más stdin, y
    // ffmpeg se quedaría bloqueado esperando que nosotros vaciemos stderr —
    // deadlock. Los flags de -loglevel error/-nostats/-hide_banner ya lo hacen
    // improbable (stderr debería quedar vacío en el caso feliz), pero no
    // imposible, así que se drena de todas formas.
    let stderr_reader = std::thread::spawn(move || {
        let mut buf = String::new();
        let _ = stderr_pipe.read_to_string(&mut buf);
        buf
    });

    stdin.write_all(data)?;

    debug!("Dropping stdin");
    drop(stdin);
    debug!("Waiting for FFmpeg process to exit");
    let status = ffmpeg.wait().map_err(|e| anyhow::anyhow!("Failed to wait for FFmpeg process: {}", e))?;
    let stderr = stderr_reader.join().unwrap_or_default();

    // El proceso ya salió, así que stdout (si algo escribió) ya tiene EOF:
    // leerlo aquí no puede bloquear. ffmpeg no debería escribir nada aquí
    // (el audio va al archivo de salida, no a pipe:1), es solo para debug.
    let mut stdout = String::new();
    if let Some(mut stdout_pipe) = ffmpeg.stdout.take() {
        let _ = stdout_pipe.read_to_string(&mut stdout);
    }

    debug!("FFmpeg process exited with status: {}", status);
    debug!("FFmpeg stdout: {}", stdout);
    debug!("FFmpeg stderr: {}", stderr);

    if !status.success() {
        error!("FFmpeg process failed with status: {}", status);
        error!("FFmpeg stderr: {}", stderr);
        return Err(anyhow::anyhow!(
            "FFmpeg process failed with status: {}",
            status
        ));
    }

    Ok(())
}
