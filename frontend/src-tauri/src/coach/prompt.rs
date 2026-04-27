//! Prompts del coach v3.0 optimizados para modelos locales (Qwen 2.5 via llama-server).

pub const DEFAULT_TIPS_MODEL: &str = "qwen25-3b-q4";
pub const DEFAULT_EVAL_MODEL: &str = "qwen25-7b-q4";
pub const DEFAULT_CHAT_MODEL: &str = "qwen25-3b-q4";

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MeetingType {
    Sales,
    Service,
    Webinar,
    TeamMeeting,
    Auto,
}

impl MeetingType {
    pub fn as_label(&self) -> &'static str {
        match self {
            MeetingType::Sales => "VENTA (discovery + cierre + objeciones)",
            MeetingType::Service => "SERVICIO AL CLIENTE (empatía + resolución)",
            MeetingType::Webinar => "WEBINAR / PRESENTACIÓN (pacing + engagement)",
            MeetingType::TeamMeeting => "REUNIÓN DE EQUIPO (facilitación + decisiones)",
            MeetingType::Auto => "REUNIÓN GENERAL",
        }
    }

    pub fn from_str_loose(s: &str) -> Self {
        match s.trim().to_lowercase().as_str() {
            "sales" | "venta" | "ventas" => MeetingType::Sales,
            "service" | "servicio" => MeetingType::Service,
            "webinar" | "presentacion" | "presentación" => MeetingType::Webinar,
            "team" | "team_meeting" | "equipo" | "junta" => MeetingType::TeamMeeting,
            _ => MeetingType::Auto,
        }
    }
}

pub const COACH_SYSTEM_PROMPT: &str = r#"Eres Maity, coach de comunicación en vivo. Respondes SIEMPRE en español.

QUIÉN ES QUIÉN (CRÍTICO):
- Líneas "USUARIO:" = persona del micrófono. Es A QUIEN COACHEAS.
- Líneas "INTERLOCUTOR:" = persona de la bocina (cliente/audiencia). NO lo coacheas.
- TODOS tus tips son para el USUARIO. El interlocutor NO ve tus tips.

TU TRABAJO:
Leer la transcripción y dar UNA frase concreta que el usuario pueda DECIR AHORA MISMO.
- Si el INTERLOCUTOR dijo algo → dile al usuario QUÉ CONTESTARLE (frase exacta).
- Si el USUARIO dijo algo mejorable → dale la frase CORREGIDA que debería usar.
- NUNCA digas "el usuario está frustrado" por algo que dijo el INTERLOCUTOR.

REGLA #1 (LA MÁS IMPORTANTE):
Cada tip DEBE incluir entre comillas simples la FRASE EXACTA que el usuario debe decir.

TIPS BUENOS:
- "Pregúntale: '¿qué es lo que más te preocupa de esto?'"
- "Respóndele: 'entiendo, déjame ver qué opciones tengo para ti'"
- "Dile: '¿y si lo probamos una semana sin compromiso?'"

TIPS MALOS (PROHIBIDOS):
- "Empatiza con el cliente" ← no dice QUÉ decir
- "Usa preguntas abiertas" ← no dice CUÁL pregunta

PREFIJO OBLIGATORIO:
- Algo para DECIR → "Dile:" o "Respóndele:"
- Algo para PREGUNTAR → "Pregúntale:"
- Felicitación → "Bien hecho:" o "Excelente:"
- Corrección → "Corrección:"

FORMATO: SOLO este JSON, nada más:
{"tip":"máx 15 palabras español con frase entre comillas","tip_type":"recognition|observation|corrective|introspective","category":"discovery|objection|closing|pacing|rapport|service|negotiation|listening","subcategory":"corto","technique":"framework","priority":"critical|important|soft","confidence":0.0}

REGLAS:
- SIEMPRE español. NUNCA inglés.
- SIEMPRE incluir frase textual entre comillas simples (excepto recognition).
- Sin señal clara → confidence ≤ 0.3.
- NO repetir tips previos."#;

pub fn build_user_prompt(
    transcript: &str,
    meeting_type: MeetingType,
    minute: u32,
    previous_tips: &[String],
    trigger_signal: Option<&str>,
) -> String {
    let previous_block = if previous_tips.is_empty() {
        "(sin tips previos en esta sesión)".to_string()
    } else {
        previous_tips
            .iter()
            .enumerate()
            .map(|(i, t)| format!("{}. {}", i + 1, t))
            .collect::<Vec<_>>()
            .join("\n")
    };

    let speaker_context = match trigger_signal {
        Some(sig) if sig.starts_with("client_") || sig.starts_with("interlocutor_") => {
            format!("\nSEÑAL: {} — del INTERLOCUTOR. Sugiere al USUARIO cómo responder.", sig)
        }
        Some(sig) if sig.starts_with("user_") => {
            format!("\nSEÑAL: {} — del USUARIO. Corrige/guía su comportamiento.", sig)
        }
        Some(sig) => format!("\nSEÑAL: {}", sig),
        None => "\nCHEQUEO GENERAL. USUARIO: = micrófono. INTERLOCUTOR: = bocina.".to_string(),
    };

    format!(
        "TIPO: {}\nMINUTO: {}{}\n\n<transcripcion>\n{}\n</transcripcion>\n\n<tips_previos>\n{}\n</tips_previos>\n\nResponde con UN JSON.",
        meeting_type.as_label(),
        minute,
        speaker_context,
        transcript,
        previous_block
    )
}

pub const MEETING_TYPE_DETECTOR_PROMPT: &str =
    "Clasifica la reunión. Responde SOLO una palabra: sales | service | webinar | team_meeting | auto";

pub fn build_meeting_type_prompt(transcript: &str) -> String {
    let preview: String = transcript.chars().take(1500).collect();
    format!("Fragmento:\n\n{}\n\n¿Qué tipo de reunión? Una palabra.", preview)
}
