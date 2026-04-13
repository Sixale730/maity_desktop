//! Construcción de contexto para el copiloto IA leyendo directamente de SQLite.
//!
//! El frontend pasaba una "rolling window" de 2000 chars del transcript en
//! memoria. Eso pierde contexto en reuniones largas (>5 min) y NO segrega
//! por speaker. Aquí leemos directamente de la tabla `transcripts` con
//! orden cronológico, etiquetando cada turno con USUARIO/INTERLOCUTOR.
//!
//! Ver: docs/COACH_FEATURE.md (Fase A+B de la asamblea 2026-04-11).

use crate::database::repositories::meeting::MeetingsRepository;
use sqlx::SqlitePool;

/// Modo de armado del contexto para el coach.
#[derive(Debug, Clone, Copy)]
pub enum ContextMode {
    /// Solo los últimos N chars de la conversación (rolling window). Útil
    /// para tips en vivo donde lo que importa es lo más reciente.
    Recent { max_chars: usize },
    /// Toda la conversación de la reunión. Útil para chat o evaluación.
    Full,
}

/// Resultado del armado de contexto.
#[derive(Debug, Clone)]
pub struct CoachContext {
    /// Texto formateado con speakers etiquetados, listo para inyectar en el prompt.
    pub formatted: String,
    /// Número de turnos (segmentos) incluidos.
    pub turn_count: usize,
    /// Caracteres totales del contexto formateado.
    pub char_count: usize,
    /// Cuántos turnos pertenecen al usuario.
    pub user_turns: usize,
    /// Cuántos turnos pertenecen al interlocutor.
    pub interlocutor_turns: usize,
}

impl CoachContext {
    /// Contexto vacío (sin transcripts disponibles).
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
        self.char_count == 0 && self.formatted.trim().is_empty()
    }
}

/// Construye el contexto del coach a partir del meeting_id, leyendo desde SQLite.
///
/// Garantías:
/// - Orden cronológico (ascendente por `audio_start_time`).
/// - Speaker etiquetado: `USUARIO:` (mic) o `INTERLOCUTOR:` (sistema).
/// - Si `mode == Recent`, devuelve solo la cola del transcript hasta `max_chars`.
/// - No falla si la tabla está vacía: devuelve `CoachContext::empty()`.
pub async fn build_context(
    pool: &SqlitePool,
    meeting_id: &str,
    mode: ContextMode,
) -> Result<CoachContext, String> {
    // Obtener TODOS los transcripts de la reunión (cap razonable: 1000 segmentos)
    let (transcripts, _total) = MeetingsRepository::get_meeting_transcripts_paginated(
        pool,
        meeting_id,
        1000,
        0,
    )
    .await
    .map_err(|e| format!("Error leyendo transcripts: {}", e))?;

    if transcripts.is_empty() {
        return Ok(CoachContext::empty());
    }

    // Armar todas las líneas con speaker etiquetado
    let mut all_lines: Vec<String> = Vec::with_capacity(transcripts.len());
    let mut user_count = 0usize;
    let mut interlocutor_count = 0usize;

    for t in &transcripts {
        let speaker_label = match t.speaker.as_deref() {
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
        let text = t.transcript.trim();
        if text.is_empty() {
            continue;
        }
        all_lines.push(format!("{}: {}", speaker_label, text));
    }

    let total_turns = all_lines.len();

    // Aplicar el modo de ventana
    let formatted = match mode {
        ContextMode::Full => all_lines.join("\n"),
        ContextMode::Recent { max_chars } => {
            // Tomar líneas del final hasta llenar max_chars
            let mut buffer: Vec<String> = Vec::new();
            let mut total_chars = 0usize;
            for line in all_lines.iter().rev() {
                let line_len = line.len() + 1; // +1 por '\n'
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_context() {
        let ctx = CoachContext::empty();
        assert!(ctx.is_empty());
        assert_eq!(ctx.turn_count, 0);
        assert_eq!(ctx.char_count, 0);
    }
}
