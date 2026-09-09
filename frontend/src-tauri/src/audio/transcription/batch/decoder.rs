// audio/transcription/batch/decoder.rs
//
// Decodifica UN canal del audio.mp4 estéreo (L=mic/user, R=sistema/interlocutor)
// a PCM f32 mono 16 kHz con un solo proceso ffmpeg: decode + split de canal +
// resample 48k→16k en un paso. La lectura es por ventanas (~60 s) para que un
// segmento de 90 min nunca viva entero en RAM: el consumidor (energy gate)
// procesa y suelta cada ventana.
//
// Molde de proceso: `run_ffmpeg_concat` (incremental_saver.rs) — `-nostdin` +
// stdin nulo, `kill_on_drop` (tokio no tiene reaper de huérfanos en Windows),
// `CREATE_NO_WINDOW`, y stderr drenado EN PARALELO a stdout (sin el drenado
// concurrente, ffmpeg se bloquea al llenar el pipe de stderr y el read de
// stdout espera para siempre: el deadlock de pipes de #08).

use std::path::{Path, PathBuf};
use std::process::Stdio;

use log::warn;
use tokio::io::AsyncReadExt;

/// Frecuencia de muestreo del PCM decodificado. Parakeet espera 16 kHz.
pub(crate) const SAMPLE_RATE: u32 = 16_000;

/// Tamaño de la ventana de lectura, en segundos. 60 s de f32 mono a 16 kHz son
/// ~3.8 MB: suficiente para amortizar syscalls sin retener el segmento entero.
const WINDOW_SECS: usize = 60;
const WINDOW_BYTES: usize = WINDOW_SECS * SAMPLE_RATE as usize * 4;

/// Canal del stereo entrelazado de la grabación. La convención es fija en todo
/// el pipeline: L = micrófono ("user"), R = sistema ("interlocutor").
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BatchChannel {
    Left,
    Right,
}

impl BatchChannel {
    /// Expresión del filtro `pan` que extrae este canal a mono. Se usa `pan` y
    /// no `-map_channel` (deprecado y retirado en ffmpeg 7+).
    fn pan_expr(self) -> &'static str {
        match self {
            BatchChannel::Left => "pan=mono|c0=c0",
            BatchChannel::Right => "pan=mono|c0=c1",
        }
    }

    /// `source_type` del transcript para este canal — strings EXACTOS del
    /// worker de streaming (worker.rs: Microphone→"user", System→"interlocutor").
    pub(crate) fn source_type(self) -> &'static str {
        match self {
            BatchChannel::Left => "user",
            BatchChannel::Right => "interlocutor",
        }
    }
}

/// Argumentos EXACTOS del decode por canal. Función PURA con golden test, por
/// la misma razón que `concat_args`/`encode_args`: blinda los flags sin
/// necesitar ffmpeg en el test.
pub(crate) fn decode_args(input: &str, channel: BatchChannel) -> Vec<String> {
    [
        // Sin cabecera de versión/config
        "-hide_banner",
        // Solo errores reales
        "-loglevel",
        "error",
        // Sin la línea de stats que ffmpeg reescribe en stderr
        "-nostats",
        // No leer stdin (va con el Stdio::null() del spawn)
        "-nostdin",
        "-i",
        input,
        // Extraer el canal a mono (ver pan_expr)
        "-af",
        channel.pan_expr(),
        // PCM f32 little-endian crudo por stdout
        "-f",
        "f32le",
        // Resample a 16 kHz (Parakeet)
        "-ar",
        "16000",
        "-ac",
        "1",
        "-",
    ]
    .into_iter()
    .map(str::to_string)
    .collect()
}

/// Decoder de un canal: proceso ffmpeg vivo del que se leen ventanas de PCM.
pub(crate) struct ChannelDecoder {
    child: tokio::process::Child,
    stdout: tokio::process::ChildStdout,
    stderr_task: tokio::task::JoinHandle<String>,
    /// Bytes sobrantes (<4) entre ventanas: un f32 puede quedar partido.
    remainder: Vec<u8>,
    eof: bool,
}

impl ChannelDecoder {
    pub(crate) async fn spawn(
        ffmpeg_path: PathBuf,
        input: &Path,
        channel: BatchChannel,
    ) -> Result<Self, String> {
        let input_str = input
            .to_str()
            .ok_or_else(|| format!("Ruta de audio con UTF-8 inválido: {:?}", input))?;

        let mut command = tokio::process::Command::new(ffmpeg_path);
        command
            .args(decode_args(input_str, channel))
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        #[cfg(target_os = "windows")]
        {
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            command.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = command
            .spawn()
            .map_err(|e| format!("No se pudo lanzar ffmpeg para el decode por lote: {}", e))?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "ffmpeg sin stdout pipe".to_string())?;
        let mut stderr = child
            .stderr
            .take()
            .ok_or_else(|| "ffmpeg sin stderr pipe".to_string())?;

        // Drenar stderr en paralelo: sin esto ffmpeg se bloquea si acumula
        // suficientes warnings y el read de stdout no avanza jamás.
        let stderr_task = tokio::spawn(async move {
            let mut buf = String::new();
            if let Err(e) = stderr.read_to_string(&mut buf).await {
                warn!("[batch-decode] error drenando stderr de ffmpeg: {}", e);
            }
            buf
        });

        Ok(Self {
            child,
            stdout,
            stderr_task,
            remainder: Vec::new(),
            eof: false,
        })
    }

    /// Lee la siguiente ventana de hasta `WINDOW_SECS` segundos. `None` = EOF.
    pub(crate) async fn next_window(&mut self) -> Result<Option<Vec<f32>>, String> {
        if self.eof && self.remainder.len() < 4 {
            return Ok(None);
        }

        let mut bytes = std::mem::take(&mut self.remainder);
        bytes.reserve(WINDOW_BYTES.saturating_sub(bytes.len()));
        let mut read_buf = [0u8; 64 * 1024];

        while bytes.len() < WINDOW_BYTES && !self.eof {
            match self.stdout.read(&mut read_buf).await {
                Ok(0) => self.eof = true,
                Ok(n) => bytes.extend_from_slice(&read_buf[..n]),
                Err(e) => return Err(format!("Error leyendo PCM de ffmpeg: {}", e)),
            }
        }

        let usable = bytes.len() - (bytes.len() % 4);
        self.remainder = bytes.split_off(usable);

        if bytes.is_empty() {
            return Ok(None);
        }

        let samples: Vec<f32> = bytes
            .chunks_exact(4)
            .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
            .collect();
        Ok(Some(samples))
    }

    /// Espera al proceso y verifica su exit code; con fallo devuelve el stderr.
    pub(crate) async fn finish(mut self) -> Result<(), String> {
        drop(self.stdout);
        let status = self
            .child
            .wait()
            .await
            .map_err(|e| format!("Error esperando a ffmpeg: {}", e))?;
        let stderr = self.stderr_task.await.unwrap_or_default();
        if !status.success() {
            return Err(format!(
                "ffmpeg decode terminó con {}: {}",
                status,
                stderr.trim()
            ));
        }
        if !stderr.trim().is_empty() {
            warn!("[batch-decode] ffmpeg stderr (exit ok): {}", stderr.trim());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Golden test: los flags del decode por canal no se cambian sin querer.
    /// `pan` en vez de `-map_channel` (retirado en ffmpeg 7+); f32le crudo a
    /// 16 kHz mono por stdout; `-nostdin` acompaña al Stdio::null() del spawn.
    #[test]
    fn decode_args_golden() {
        let left = decode_args("C:\\audio\\audio.mp4", BatchChannel::Left);
        assert_eq!(
            left,
            vec![
                "-hide_banner",
                "-loglevel",
                "error",
                "-nostats",
                "-nostdin",
                "-i",
                "C:\\audio\\audio.mp4",
                "-af",
                "pan=mono|c0=c0",
                "-f",
                "f32le",
                "-ar",
                "16000",
                "-ac",
                "1",
                "-",
            ]
        );
        let right = decode_args("/tmp/audio.mp4", BatchChannel::Right);
        assert!(right.contains(&"pan=mono|c0=c1".to_string()));
    }

    /// La convención de canales es un contrato: L=mic="user", R=sistema=
    /// "interlocutor" (strings exactos del worker de streaming).
    #[test]
    fn source_type_por_canal() {
        assert_eq!(BatchChannel::Left.source_type(), "user");
        assert_eq!(BatchChannel::Right.source_type(), "interlocutor");
    }
}
