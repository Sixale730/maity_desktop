//! Prompts del Maity Copiloto v3.0 (producción).
//!
//! Solo contiene el prompt V3 LITE optimizado para latencia ultra-baja.
//! Los prompts V2 y V3 completo fueron eliminados (código muerto).

/// Modelo Ollama por defecto para tips + chat.
pub const DEFAULT_MODEL: &str = "gemma3:4b";

/// Modelo secundario para detección rápida de tipo de reunión.
pub const SECONDARY_MODEL: &str = "gemma3:4b";

/// Tipos de reunión soportados por el copiloto.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
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

/// System prompt V3 LITE — ~600 tokens, optimizado para tips accionables.
pub const MAITY_COPILOTO_V3_LITE_PROMPT: &str = r#"Eres Maity, coach de comunicación en vivo. Respondes SIEMPRE en español.

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
El tip responde a: "¿Qué digo AHORA MISMO?" basándose en lo último que se habló.

TIPS BUENOS (específicos — COPIA ESTE ESTILO):
- "Pregúntale: '¿qué es lo que más te preocupa de esto?'"
- "Respóndele: 'entiendo, déjame ver qué opciones tengo para ti'"
- "Dile: '¿y si lo probamos una semana sin compromiso?'"
- "Repite lo que dijo: 'entonces lo que necesitas es...' y espera confirmación"
- "Dijiste 'no puedo'. Corrígelo: 'lo que sí puedo hacer es...'"
- "Buen uso de preguntas abiertas. Sigue profundizando así."

TIPS MALOS (PROHIBIDOS — nunca generes algo así):
- "Empatiza con el cliente" ← no dice QUÉ decir
- "Usa preguntas abiertas" ← no dice CUÁL pregunta
- "Conecta y genera rapport" ← vacío
- "Escucha activamente" ← obvio, no ayuda
- "Usa LATTE/SPIN/HEARD" ← jerga inútil en tiempo real

SI EL USUARIO DICE ESTAS FRASES, CORRÍGELO:
- "Cálmate" → Di: "Mejor di: 'entiendo tu frustración, ¿qué necesitas?'"
- "Es la política" → Di: "Mejor di: 'déjame ver qué opciones tengo'"
- "No puedo" → Di: "Mejor di: 'lo que sí puedo hacer es...'"
- Habla >2 min → "Haz pausa. Pregunta: '¿esto te hace sentido?'"

PREFIJO OBLIGATORIO en cada tip:
- Si es algo para DECIR → empieza con "Dile:" o "Respóndele:"
- Si es algo para PREGUNTAR → empieza con "Pregúntale:"
- Si es felicitación → empieza con "Bien hecho:" o "Excelente:"
- Si es corrección → empieza con "Corrección:"

TIPOS DE TIP (rota):
- recognition: felicita algo concreto ("Excelente: buena pregunta abierta. Sigue así.")
- observation: patrón ("Noto que aceleras cuando objeta. Haz pausa.")
- corrective: error + frase corregida ("Corrección: dijiste 'no puedo'. Di: 'lo que sí puedo es...'")
- introspective: pregunta reflexiva ("¿Notaste que cambió su tono cuando dijiste eso?")

FORMATO: SOLO este JSON, nada más:
{"tip":"máx 15 palabras español con frase entre comillas","tip_type":"recognition|observation|corrective|introspective","category":"discovery|objection|closing|pacing|rapport|service|negotiation|listening","subcategory":"corto","technique":"framework","priority":"critical|important|soft","confidence":0.0}

REGLAS:
- SIEMPRE español. NUNCA inglés. NUNCA mezclar idiomas.
- SIEMPRE incluir frase textual entre comillas simples (excepto recognition).
- NUNCA escribir nombres de frameworks (SPIN, LATTE, HEARD) dentro del tip.
- Sin señal clara → confidence ≤ 0.3.
- NO repetir tips previos."#;

/// Construye el user prompt v3.0 con toda la metadata.
pub fn build_user_prompt_v3(
    transcript: &str,
    meeting_type: MeetingType,
    minute: u32,
    previous_tips: &[String],
    suggested_category: Option<&str>,
    trigger_signal: Option<&str>,
) -> String {
    let previous_block = if previous_tips.is_empty() {
        String::from("(sin tips previos en esta sesión)")
    } else {
        previous_tips
            .iter()
            .enumerate()
            .map(|(i, t)| format!("{}. {}", i + 1, t))
            .collect::<Vec<_>>()
            .join("\n")
    };

    let category_hint = suggested_category
        .map(|c| format!("\nCATEGORÍA SUGERIDA POR TRIGGER: {} (usa como pista)", c))
        .unwrap_or_default();

    // Contexto de speaker: indica al LLM quién disparó el trigger
    let speaker_context = match trigger_signal {
        Some(sig) if sig.starts_with("client_") || sig.starts_with("interlocutor_") => {
            format!("\nSEÑAL DETECTADA: {} — disparada por INTERLOCUTOR. Tu tip va dirigido al USUARIO sobre cómo responder al interlocutor.", sig)
        }
        Some(sig) if sig.starts_with("user_") => {
            format!("\nSEÑAL DETECTADA: {} — disparada por USUARIO (micrófono). Tu tip debe corregir/guiar al USUARIO sobre SU propio comportamiento.", sig)
        }
        Some(sig) if sig.contains("last_speaker_interlocutor") => {
            "\nCHEQUEO PERIÓDICO. Último turno fue del INTERLOCUTOR. Analiza qué dijo el INTERLOCUTOR y sugiere al USUARIO cómo responder. NO confundas: lo que dijo el INTERLOCUTOR NO es culpa del USUARIO.".to_string()
        }
        Some(sig) if sig.contains("last_speaker_user") => {
            "\nCHEQUEO PERIÓDICO. Último turno fue del USUARIO. Evalúa cómo se comunicó el USUARIO y sugiere mejora sobre SU técnica.".to_string()
        }
        Some(sig) => {
            format!("\nSEÑAL DETECTADA: {}", sig)
        }
        None => {
            "\nCHEQUEO GENERAL. Lee la transcripción con atención: las líneas USUARIO: son del micrófono (a quien coacheas). Las líneas INTERLOCUTOR: son de la bocina (el otro). NO atribuyas al USUARIO lo que dijo el INTERLOCUTOR.".to_string()
        }
    };

    format!(
        "TIPO DE REUNIÓN: {}\nMINUTO ACTUAL: {}\n{}{}\n\n<transcripcion>\n{}\n</transcripcion>\n\n<tips_previos>\n{}\n</tips_previos>\n\nAnaliza y responde con UN JSON con el tip más relevante.",
        meeting_type.as_label(),
        minute,
        category_hint,
        speaker_context,
        transcript,
        previous_block
    )
}

/// Prompt corto para detectar el tipo de reunión con gemma3:4b.
pub const MEETING_TYPE_DETECTOR_PROMPT: &str = r#"Eres un clasificador de reuniones. Lees un fragmento de transcripción y devuelves SOLO UNA palabra con el tipo de reunión.

Opciones (responde exactamente una):
- sales        → venta, demo de producto, cotización, negociación comercial
- service      → servicio al cliente, soporte técnico, queja, reclamo
- webinar      → presentación, webinar, charla, monólogo de un speaker
- team_meeting → reunión de equipo, standup, retro, brainstorming
- auto         → no puedes determinar

RESPONDE SOLO UNA PALABRA. Sin explicaciones, sin JSON, sin markdown."#;

/// User prompt para el detector de tipo de reunión.
pub fn build_meeting_type_detector_prompt(transcript: &str) -> String {
    let preview: String = transcript.chars().take(1500).collect();
    format!(
        "Fragmento de conversación:\n\n{}\n\n¿Qué tipo de reunión es? Responde con UNA palabra.",
        preview
    )
}
