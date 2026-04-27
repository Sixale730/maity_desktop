//! Detectores de señales conversacionales sin LLM.
//!
//! Corren en microsegundos (regex + keyword matching).
//! Reducen tips genéricos de ~180/hora a ~20/hora estratégicos.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SignalCategory {
    Objection,
    Closing,
    Pacing,
    Rapport,
    Service,
    Discovery,
    Negotiation,
    Persuasion,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SignalPriority {
    Critical,
    Important,
    Soft,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationSignal {
    pub signal_id: String,
    pub category: SignalCategory,
    pub priority: SignalPriority,
    pub source: String, // "user" | "interlocutor"
    pub description: String,
}

/// Contexto multi-turno para análisis que requieren historia
#[derive(Debug, Clone, Default)]
pub struct TurnContext {
    pub last_speaker: Option<String>,
    pub consecutive_user_turns: u32,
    pub total_turns: u32,
}

// ─── Detectores básicos ──────────────────────────────────────────────────────

pub fn detect_price_mention(text: &str) -> bool {
    let lower = text.to_lowercase();
    ["precio", "costo", "cuánto cuesta", "cuanto cuesta", "tarifa",
     "inversión", "inversion", "presupuesto", "pago", "mensualidad",
     "price", "cost", "how much"]
        .iter()
        .any(|kw| lower.contains(kw))
}

pub fn detect_objection(text: &str) -> bool {
    let lower = text.to_lowercase();
    ["muy caro", "es caro", "no tengo presupuesto", "no puedo pagar",
     "necesito pensarlo", "no estoy seguro", "no sé si", "déjame consultarlo",
     "dejame consultarlo", "tengo dudas", "no me convence"]
        .iter()
        .any(|kw| lower.contains(kw))
}

pub fn detect_buying_signal(text: &str) -> bool {
    let lower = text.to_lowercase();
    ["me interesa", "quiero empezar", "cómo lo contrato", "como lo contrato",
     "cuándo pueden", "cuando pueden", "me gustaría", "me gustaria",
     "procedemos", "vamos con eso", "lo tomo", "lo quiero"]
        .iter()
        .any(|kw| lower.contains(kw))
}

pub fn detect_frustration(text: &str) -> bool {
    let lower = text.to_lowercase();
    ["no funciona", "estoy frustrado", "no entiendo", "sigo sin",
     "ya intenté", "ya intente", "llevo esperando", "nadie me ayuda",
     "es un desastre", "pésimo", "pesimo", "horrible"]
        .iter()
        .any(|kw| lower.contains(kw))
}

pub fn detect_hesitation(text: &str) -> bool {
    let lower = text.to_lowercase();
    ["no sé", "no se", "tal vez", "quizás", "quizas", "puede ser",
     "lo pensaré", "lo pensare", "tendría que ver", "tendria que ver"]
        .iter()
        .any(|kw| lower.contains(kw))
}

pub fn detect_possessive_language(text: &str) -> bool {
    let lower = text.to_lowercase();
    ["mi empresa", "mi equipo", "nuestro proceso", "nosotros necesitamos",
     "en mi caso", "para nosotros", "nuestra situación", "nuestra situacion"]
        .iter()
        .any(|kw| lower.contains(kw))
}

// ─── Detectores de comunicación personal (V3.1) ──────────────────────────────

/// Detecta muletillas verbales del usuario
pub fn detect_filler_words(text: &str) -> bool {
    let lower = text.to_lowercase();
    let words: Vec<&str> = lower.split_whitespace().collect();
    let fillers = ["este", "eh", "mm", "mmm", "o sea", "digamos", "básicamente",
                   "basicalmente", "literalmente", "de hecho", "la verdad"];
    let count = words.iter()
        .filter(|w| fillers.iter().any(|f| w.contains(f)))
        .count();
    count >= 3
}

/// Detecta habla atropellada (oraciones sin pausas naturales)
pub fn detect_rapid_speech_pattern(text: &str) -> bool {
    let words: Vec<&str> = text.split_whitespace().collect();
    // Si tiene más de 60 palabras sin comas ni puntos, probablemente habla atropellada
    let has_pause = text.contains(',') || text.contains('.') || text.contains(';');
    words.len() > 60 && !has_pause
}

/// Detecta sequía de preguntas (el usuario no está haciendo preguntas)
pub fn detect_question_drought(text: &str, session_duration_sec: u32) -> bool {
    let has_question = text.contains('?') ||
        ["qué", "cómo", "cuándo", "dónde", "por qué", "cuál"]
            .iter()
            .any(|q| text.to_lowercase().contains(q));
    !has_question && session_duration_sec > 180
}

/// Detecta espiral negativa (usuario usa mucho lenguaje negativo)
pub fn detect_negative_spiral(text: &str) -> bool {
    let lower = text.to_lowercase();
    let negatives = ["no puedo", "no es posible", "no tenemos", "no hay",
                     "imposible", "nunca", "jamás", "jamas", "difícil", "dificil"];
    let count = negatives.iter().filter(|n| lower.contains(*n)).count();
    count >= 2
}

/// Detecta brecha de empatía (respuesta muy fría/técnica a emoción del interlocutor)
pub fn detect_empathy_gap(user_text: &str, interlocutor_text: &str) -> bool {
    let interlocutor_emotional = detect_frustration(interlocutor_text);
    if !interlocutor_emotional {
        return false;
    }
    let user_lower = user_text.to_lowercase();
    let empathetic = ["entiendo", "comprendo", "imagino", "debe ser difícil",
                      "tiene sentido", "lo escucho", "te escucho"]
        .iter()
        .any(|e| user_lower.contains(e));
    !empathetic
}

// ─── Análisis de turno ────────────────────────────────────────────────────────

pub fn analyze_turn(
    text: &str,
    speaker: &str,
    session_duration_sec: u32,
) -> Vec<ConversationSignal> {
    let mut signals = Vec::new();

    if speaker == "interlocutor" {
        if detect_objection(text) {
            signals.push(ConversationSignal {
                signal_id: "client_objection".to_string(),
                category: SignalCategory::Objection,
                priority: SignalPriority::Critical,
                source: "interlocutor".to_string(),
                description: "Objeción detectada del cliente".to_string(),
            });
        }
        if detect_buying_signal(text) {
            signals.push(ConversationSignal {
                signal_id: "client_buying_signal".to_string(),
                category: SignalCategory::Closing,
                priority: SignalPriority::Critical,
                source: "interlocutor".to_string(),
                description: "Señal de compra detectada".to_string(),
            });
        }
        if detect_frustration(text) {
            signals.push(ConversationSignal {
                signal_id: "client_frustration".to_string(),
                category: SignalCategory::Rapport,
                priority: SignalPriority::Critical,
                source: "interlocutor".to_string(),
                description: "Frustración detectada en el cliente".to_string(),
            });
        }
        if detect_price_mention(text) {
            signals.push(ConversationSignal {
                signal_id: "client_price_mention".to_string(),
                category: SignalCategory::Negotiation,
                priority: SignalPriority::Important,
                source: "interlocutor".to_string(),
                description: "Mención de precio o costo".to_string(),
            });
        }
        if detect_possessive_language(text) {
            signals.push(ConversationSignal {
                signal_id: "client_possessive".to_string(),
                category: SignalCategory::Discovery,
                priority: SignalPriority::Soft,
                source: "interlocutor".to_string(),
                description: "Lenguaje posesivo — cliente habla de su contexto".to_string(),
            });
        }
    }

    if speaker == "user" {
        if detect_negative_spiral(text) {
            signals.push(ConversationSignal {
                signal_id: "user_negative_spiral".to_string(),
                category: SignalCategory::Pacing,
                priority: SignalPriority::Important,
                source: "user".to_string(),
                description: "Espiral negativa — demasiado lenguaje negativo".to_string(),
            });
        }
        if detect_filler_words(text) {
            signals.push(ConversationSignal {
                signal_id: "user_filler_words".to_string(),
                category: SignalCategory::Pacing,
                priority: SignalPriority::Soft,
                source: "user".to_string(),
                description: "Muletillas verbales detectadas".to_string(),
            });
        }
        if detect_rapid_speech_pattern(text) {
            signals.push(ConversationSignal {
                signal_id: "user_rapid_speech".to_string(),
                category: SignalCategory::Pacing,
                priority: SignalPriority::Important,
                source: "user".to_string(),
                description: "Habla atropellada — sin pausas naturales".to_string(),
            });
        }
        if detect_question_drought(text, session_duration_sec) {
            signals.push(ConversationSignal {
                signal_id: "user_question_drought".to_string(),
                category: SignalCategory::Discovery,
                priority: SignalPriority::Important,
                source: "user".to_string(),
                description: "Sin preguntas — sequía de discovery".to_string(),
            });
        }
    }

    // Ordenar por prioridad: Critical > Important > Soft
    signals.sort_by(|a, b| {
        let priority_val = |p: &SignalPriority| match p {
            SignalPriority::Critical => 0,
            SignalPriority::Important => 1,
            SignalPriority::Soft => 2,
        };
        priority_val(&a.priority).cmp(&priority_val(&b.priority))
    });

    signals
}

pub fn analyze_turn_with_context(
    text: &str,
    speaker: &str,
    session_duration_sec: u32,
    ctx: &TurnContext,
    last_interlocutor_text: Option<&str>,
) -> Vec<ConversationSignal> {
    let mut signals = analyze_turn(text, speaker, session_duration_sec);

    // Detectar brecha de empatía usando contexto multi-turno
    if speaker == "user" {
        if let Some(interlocutor_text) = last_interlocutor_text {
            if detect_empathy_gap(text, interlocutor_text) {
                signals.insert(0, ConversationSignal {
                    signal_id: "user_empathy_gap".to_string(),
                    category: SignalCategory::Rapport,
                    priority: SignalPriority::Important,
                    source: "user".to_string(),
                    description: "Brecha de empatía — respuesta fría a emoción del cliente".to_string(),
                });
            }
        }
    }

    // Añadir contexto de speaker para el LLM
    let last_speaker_signal = if speaker == "user" {
        "last_speaker_user"
    } else {
        "last_speaker_interlocutor"
    };
    signals.push(ConversationSignal {
        signal_id: last_speaker_signal.to_string(),
        category: SignalCategory::Pacing,
        priority: SignalPriority::Soft,
        source: speaker.to_string(),
        description: format!("Último turno: {}", speaker),
    });

    signals
}

#[tauri::command]
pub fn coach_analyze_trigger(
    text: String,
    speaker: String,
    session_duration_sec: u32,
) -> Vec<ConversationSignal> {
    analyze_turn(&text, &speaker, session_duration_sec)
}
