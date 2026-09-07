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

/// Argumentos EXACTOS con los que se encodea cada checkpoint de 30 s a AAC-LC.
///
/// Función PURA (no toca disco, procesos ni entorno) por una razón concreta: es
/// la ÚNICA forma de blindar estos flags con un test. `encode_single_audio`
/// llama a `find_ffmpeg_path()`, que bajo `cargo test` no ve el externalBin (el
/// test corre desde `target/debug/deps/`) y en una máquina sin ffmpeg en PATH
/// intentaría DESCARGARLO, colgando el test — es exactamente el motivo del
/// `#[ignore]` de `incremental_saver::tests::test_checkpoint_creation`. Antes de
/// esta extracción, `encode.rs` no tenía un solo `#[cfg(test)]`.
///
/// **Bitrate 64k (sep-2026).** Estaba en `192k` con el comentario heredado
/// "Increased from 64k for better audio quality (especially for speech)". Ese
/// comentario NO tiene commit ni razonamiento detrás: `git log -S "192k"` y
/// `git log -S "64k"` sobre este archivo devuelven un único commit, el squash
/// inicial `dbc1bc7`, o sea que la subida viene heredada del upstream
/// (screenpipe/meetily). No hay consumidor de esa calidad: la transcripción
/// consume el `f32` crudo del pipeline (nunca el mp4) y el análisis es sólo
/// texto. 64k baja el costo en disco de ~86 MB/h a ~28.8 MB/h.
///
/// Ojo con el orden: `-ar`/`-ac` van ANTES de `-i`, así que describen el INPUT
/// crudo `f32le`; la salida no lleva `-ar`/`-ac` y hereda 48 kHz estéreo — es
/// lo que conserva la atribución de hablante por canal L/R. NO añadir `-ar` de
/// salida "de paso".
pub(crate) fn encode_args(sample_rate: u32, channels: u16, output_path: &str) -> Vec<String> {
    vec![
        // No imprimir la cabecera de versión/config en cada checkpoint
        "-hide_banner".to_string(),
        // Solo errores reales, no el spam de progreso por defecto
        "-loglevel".to_string(),
        "error".to_string(),
        // Sin la línea de stats que ffmpeg reescribe en stderr
        "-nostats".to_string(),
        "-f".to_string(),
        "f32le".to_string(),
        "-ar".to_string(),
        sample_rate.to_string(),
        "-ac".to_string(),
        channels.to_string(),
        "-i".to_string(),
        "pipe:0".to_string(),
        "-c:a".to_string(),
        "aac".to_string(),
        "-b:a".to_string(),
        "64k".to_string(),
        // AAC-LC: el AudioSpecificConfig resultante es idéntico entre versiones
        // del binario, que es lo que permite que `merge_checkpoints` haga
        // `concat -c copy` sin re-encodear.
        "-profile:a".to_string(),
        "aac_low".to_string(),
        // Un AAC de 30 s no necesita más; así no compite por CPU con Parakeet
        // en equipos de gama baja.
        "-threads".to_string(),
        "1".to_string(),
        "-movflags".to_string(),
        "+faststart".to_string(),
        "-f".to_string(),
        "mp4".to_string(),
        output_path.to_string(),
    ]
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

    let output = output_path
        .to_str()
        .ok_or_else(|| anyhow::anyhow!("Output path contains invalid UTF-8: {:?}", output_path))?;

    let mut command = Command::new(ffmpeg_path);
    command
        .args(encode_args(sample_rate, channels, output))
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

#[cfg(test)]
mod tests {
    use super::encode_args;

    /// El bitrate es el único lever de tamaño presente en el encode y no lo
    /// cubría ningún test. Si alguien vuelve a subirlo "por calidad", esto falla.
    #[test]
    fn encode_args_fija_bitrate_64k_y_perfil_aac_low() {
        let args = encode_args(48_000, 2, "audio_chunk_000.mp4");

        let b = args
            .iter()
            .position(|a| a.as_str() == "-b:a")
            .expect("falta el flag -b:a");
        assert_eq!(
            args[b + 1].as_str(),
            "64k",
            "el bitrate del checkpoint debe seguir en 64k (ver CLAUDE.md § Rendimiento de Audio)"
        );

        let p = args
            .iter()
            .position(|a| a.as_str() == "-profile:a")
            .expect("falta el flag -profile:a");
        assert_eq!(
            args[p + 1].as_str(),
            "aac_low",
            "AAC-LC es lo que hace compatible el `concat -c copy` de merge_checkpoints"
        );
    }

    /// `-ar`/`-ac` describen el INPUT crudo f32le: si migraran detrás de `-i`
    /// pasarían a ser parámetros de SALIDA y el mp4 dejaría de ser 48 kHz
    /// estéreo, rompiendo la atribución de hablante por canal L/R.
    #[test]
    fn encode_args_describe_el_input_crudo_antes_de_i() {
        let args = encode_args(48_000, 2, "salida.mp4");

        let ar = args.iter().position(|a| a.as_str() == "-ar").unwrap();
        let ac = args.iter().position(|a| a.as_str() == "-ac").unwrap();
        let i = args.iter().position(|a| a.as_str() == "-i").unwrap();

        assert!(ar < i, "-ar debe ir antes de -i (describe el input)");
        assert!(ac < i, "-ac debe ir antes de -i (describe el input)");
        assert_eq!(args[ar + 1].as_str(), "48000");
        assert_eq!(args[ac + 1].as_str(), "2");
        assert_eq!(args[i + 1].as_str(), "pipe:0");
        assert_eq!(
            args.last().unwrap().as_str(),
            "salida.mp4",
            "el output SIEMPRE va al final"
        );
    }

    /// Golden master del vector completo: cualquier flag añadido, quitado o
    /// reordenado tiene que ser una decisión consciente.
    #[test]
    fn encode_args_orden_completo_es_estable() {
        let args = encode_args(16_000, 1, "x.mp4");
        let esperado: Vec<String> = vec![
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostats",
            "-f",
            "f32le",
            "-ar",
            "16000",
            "-ac",
            "1",
            "-i",
            "pipe:0",
            "-c:a",
            "aac",
            "-b:a",
            "64k",
            "-profile:a",
            "aac_low",
            "-threads",
            "1",
            "-movflags",
            "+faststart",
            "-f",
            "mp4",
            "x.mp4",
        ]
        .into_iter()
        .map(str::to_string)
        .collect();

        assert_eq!(args, esperado);
    }
}
