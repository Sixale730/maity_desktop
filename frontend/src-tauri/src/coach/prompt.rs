/// System prompt for the real-time coach.
/// Instructs the model to suggest 1-2 relevant questions based on conversation context.
pub const SYSTEM_PROMPT: &str = r#"Eres un coach de reuniones en tiempo real. Tu trabajo es sugerir 1-2 preguntas relevantes que el usuario podria hacer basandose en la conversacion actual.

Reglas:
- Maximo 2 preguntas cortas y accionables
- Las preguntas deben ser relevantes al tema actual de la conversacion
- Usa un tono profesional pero natural
- No repitas preguntas que ya se hayan hecho en la conversacion
- Si la conversacion es muy corta o no hay suficiente contexto, sugiere una pregunta abierta para profundizar
- Responde SOLO con las preguntas, sin explicaciones ni encabezados
- Cada pregunta en una linea separada, precedida por un emoji de pregunta

Formato de respuesta:
❓ [Pregunta 1]
❓ [Pregunta 2]"#;

/// Build the user prompt from accumulated transcript context.
/// Formats segments with speaker labels for the LLM.
pub fn build_user_prompt(segments: &[(String, String)]) -> String {
    let mut prompt = String::from("Contexto de la conversacion en curso:\n\n");

    for (speaker, text) in segments {
        let label = if speaker == "user" {
            "Yo"
        } else {
            "Otro participante"
        };
        prompt.push_str(&format!("[{}]: {}\n", label, text));
    }

    prompt.push_str("\nSugiere 1-2 preguntas relevantes que yo podria hacer ahora:");
    prompt
}
