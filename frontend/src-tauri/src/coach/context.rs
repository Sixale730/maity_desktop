//! Construcción de contexto para el coach leyendo directamente de SQLite.
//!
//! Lee la tabla `transcripts` con orden cronológico, etiquetando cada turno
//! con USUARIO (mic) o INTERLOCUTOR (sistema).

use sqlx::SqlitePool;

#[derive(Debug, Clone, Copy)]
pub enum ContextMode {
    /// Solo los últimos N chars (rolling window). Para tips en vivo.
    Recent { max_chars: usize },
    /// Toda la conversación. Para chat o evaluación post-reunión.
    Full,
}

#[derive(Debug, Clone)]
pub struct CoachContext {
    pub formatted: String,
    pub turn_count: usize,
    pub char_count: usize,
    pub user_turns: usize,
    pub interlocutor_turns: usize,
}

impl CoachContext {
    pub fn empty() -> Self {
        Self {
            formatted: String::new(),
            turn_count: 0,
            char_count: 0,
            user_turns: 0,
            interlocutor_turns: 0,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.formatted.trim().is_empty()
    }
}

#[derive(sqlx::FromRow)]
struct TranscriptRow {
    transcript: String,
    speaker: Option<String>,
}

/// Construye el contexto del coach a partir del meeting_id, leyendo desde SQLite.
pub async fn build_context(
    pool: &SqlitePool,
    meeting_id: &str,
    mode: ContextMode,
) -> Result<CoachContext, String> {
    let rows = sqlx::query_as::<_, TranscriptRow>(
        "SELECT transcript, speaker FROM transcripts
         WHERE meeting_id = ?
         ORDER BY audio_start_time ASC
         LIMIT 1000",
    )
    .bind(meeting_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Error leyendo transcripts: {}", e))?;

    if rows.is_empty() {
        return Ok(CoachContext::empty());
    }

    let mut all_lines: Vec<String> = Vec::with_capacity(rows.len());
    let mut user_count = 0usize;
    let mut interlocutor_count = 0usize;

    for row in &rows {
        let speaker_label = match row.speaker.as_deref() {
            Some("user") => {
                user_count += 1;
                "USUARIO"
            }
            Some("interlocutor") => {
                interlocutor_count += 1;
                "INTERLOCUTOR"
            }
            _ => "VOZ",
        };
        let text = row.transcript.trim();
        if text.is_empty() {
            continue;
        }
        all_lines.push(format!("{}: {}", speaker_label, text));
    }

    let total_turns = all_lines.len();

    let formatted = match mode {
        ContextMode::Full => all_lines.join("\n"),
        ContextMode::Recent { max_chars } => {
            let mut buffer: Vec<String> = Vec::new();
            let mut total_chars = 0usize;
            for line in all_lines.iter().rev() {
                let line_len = line.len() + 1;
                if total_chars + line_len > max_chars && !buffer.is_empty() {
                    break;
                }
                buffer.push(line.clone());
                total_chars += line_len;
            }
            buffer.reverse();
            buffer.join("\n")
        }
    };

    Ok(CoachContext {
        char_count: formatted.len(),
        formatted,
        turn_count: total_turns,
        user_turns: user_count,
        interlocutor_turns: interlocutor_count,
    })
}
