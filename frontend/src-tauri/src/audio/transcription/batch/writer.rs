// audio/transcription/batch/writer.rs
//
// Convierte los resultados del lote al MISMO `transcripts.json` que escribe el
// saver de streaming. La serialización vive en UNA función compartida
// (`recording_saver::write_transcripts_atomic`) para que el shape que consume
// `finalize_segment_native` no pueda divergir entre pipelines.

use std::path::Path;

use crate::audio::recording_saver::TranscriptSegment;

/// Confianza por defecto para segmentos sin score — el MISMO valor que usa el
/// worker de streaming para Parakeet (`confidence_opt.unwrap_or(0.85)`).
const DEFAULT_CONFIDENCE: f32 = 0.85;

/// Resultado crudo de un chunk transcrito, antes de ordenar y numerar.
#[derive(Debug)]
pub(crate) struct BatchSegmentDraft {
    pub text: String,
    pub start_secs: f64,
    pub duration_secs: f64,
    /// "user" | "interlocutor" (strings exactos del worker de streaming).
    pub source_type: &'static str,
}

/// `[MM:SS]` desde el inicio de la grabación, como el `display_time` del
/// streaming (que usa el timestamp del chunk).
fn display_time(start_secs: f64) -> String {
    let total = start_secs.max(0.0) as u64;
    format!("[{:02}:{:02}]", total / 60, total % 60)
}

/// Ordena por tiempo de inicio (intercalando canales) y asigna `sequence_id`
/// monotónico — el sync cloud lo usa como `segment_index`.
pub(crate) fn build_segments(mut drafts: Vec<BatchSegmentDraft>) -> Vec<TranscriptSegment> {
    drafts.sort_by(|a, b| {
        a.start_secs
            .partial_cmp(&b.start_secs)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.source_type.cmp(b.source_type))
    });
    drafts
        .into_iter()
        .enumerate()
        .map(|(i, d)| {
            let sequence_id = i as u64;
            TranscriptSegment {
                id: format!("seg_{}", sequence_id),
                text: d.text,
                audio_start_time: d.start_secs,
                audio_end_time: d.start_secs + d.duration_secs,
                duration: d.duration_secs,
                display_time: display_time(d.start_secs),
                confidence: DEFAULT_CONFIDENCE,
                sequence_id,
                source_type: Some(d.source_type.to_string()),
            }
        })
        .collect()
}

/// Escribe los segmentos al `filename` dado dentro de la carpeta de grabación
/// (atómico: tmp + rename), con la serialización compartida del saver.
pub(crate) fn write_transcripts(
    folder: &Path,
    filename: &str,
    segments: &[TranscriptSegment],
) -> Result<usize, String> {
    crate::audio::recording_saver::write_transcripts_atomic(folder, filename, segments)
        .map_err(|e| format!("No se pudo escribir {}: {}", filename, e))?;
    Ok(segments.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ordena_intercalando_canales_y_numera() {
        let drafts = vec![
            BatchSegmentDraft {
                text: "respuesta".into(),
                start_secs: 30.0,
                duration_secs: 10.0,
                source_type: "interlocutor",
            },
            BatchSegmentDraft {
                text: "hola".into(),
                start_secs: 2.5,
                duration_secs: 12.0,
                source_type: "user",
            },
            BatchSegmentDraft {
                text: "sigo yo".into(),
                start_secs: 15.0,
                duration_secs: 8.0,
                source_type: "user",
            },
        ];
        let segments = build_segments(drafts);
        assert_eq!(segments.len(), 3);
        assert_eq!(segments[0].text, "hola");
        assert_eq!(segments[1].text, "sigo yo");
        assert_eq!(segments[2].text, "respuesta");
        for (i, s) in segments.iter().enumerate() {
            assert_eq!(s.sequence_id, i as u64);
            assert_eq!(s.id, format!("seg_{}", i));
        }
        assert_eq!(segments[0].display_time, "[00:02]");
        assert_eq!(segments[2].display_time, "[00:30]");
        assert!((segments[1].audio_end_time - 23.0).abs() < 1e-9);
        assert_eq!(segments[0].source_type.as_deref(), Some("user"));
    }

    /// El shape en disco es el contrato de `finalize_segment_native`
    /// (`RawTranscriptSegment` en scheduled_recording/service.rs): todos los
    /// campos presentes y `total_segments` consistente.
    #[test]
    fn shape_en_disco_compatible_con_finalize() {
        let dir = std::env::temp_dir().join(format!("maity_batch_writer_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let segments = build_segments(vec![BatchSegmentDraft {
            text: "hola mundo".into(),
            start_secs: 1.0,
            duration_secs: 3.0,
            source_type: "user",
        }]);
        write_transcripts(&dir, "transcripts.batch.json", &segments).unwrap();

        let raw = std::fs::read_to_string(dir.join("transcripts.batch.json")).unwrap();
        let json: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(json["total_segments"], 1);
        let seg = &json["segments"][0];
        for field in [
            "id",
            "text",
            "audio_start_time",
            "audio_end_time",
            "duration",
            "display_time",
            "sequence_id",
            "source_type",
        ] {
            assert!(!seg[field].is_null(), "falta el campo {}", field);
        }
        std::fs::remove_dir_all(&dir).ok();
    }
}
