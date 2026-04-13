//! Detectores de señales sin LLM para disparo inteligente del coach.
//!
//! Estos detectores corren en microsegundos (regex + keyword matching).
//! El frontend los usa para decidir cuándo disparar `coach_suggest` en lugar
//! de un timer fijo cada 20s. Reduce tips genéricos de 180/hora a ~20/hora
//! estratégicos y justo-a-tiempo.
//!
//! También expuestos como comandos Tauri para que el frontend pueda usarlos
//! sin duplicar la lógica en JS.

use serde::{Deserialize, Serialize};

/// Categorías de señales detectables.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TriggerCategory {
    Objection,
    Closing,
    Pacing,
    Rapport,
    Service,
    Discovery,
    Negotiation,
    Persuasion,
}

impl TriggerCategory {
    pub fn as_str(&self) -> &'static str {
        match self {
            TriggerCategory::Objection => "objection",
            TriggerCategory::Closing => "closing",
            TriggerCategory::Pacing => "pacing",
            TriggerCategory::Rapport => "rapport",
            TriggerCategory::Service => "service",
            TriggerCategory::Discovery => "discovery",
            TriggerCategory::Negotiation => "negotiation",
            TriggerCategory::Persuasion => "persuasion",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerSignal {
    pub category: TriggerCategory,
    /// "critical" | "important" | "soft"
    pub priority: String,
    /// Nombre de la señal detectada (ej: "price_mention", "buying_signal")
    pub signal: String,
    /// Snippet del texto que disparó la señal (max 100 chars)
    pub snippet: String,
}

/// Normaliza texto para matching: minúsculas + strip accents + sin puntuación.
/// Garantiza que "déjame" y "dejame" matchen igual.
fn normalize(text: &str) -> String {
    text.to_lowercase()
        .chars()
        .map(strip_accent)
        .filter(|c| c.is_alphabetic() || c.is_whitespace() || *c == '¿' || *c == '?')
        .collect()
}

fn strip_accent(c: char) -> char {
    match c {
        'á' | 'à' | 'ä' | 'â' => 'a',
        'é' | 'è' | 'ë' | 'ê' => 'e',
        'í' | 'ì' | 'ï' | 'î' => 'i',
        'ó' | 'ò' | 'ö' | 'ô' => 'o',
        'ú' | 'ù' | 'ü' | 'û' => 'u',
        'ñ' => 'n',
        _ => c,
    }
}

fn contains_any(haystack: &str, needles: &[&str]) -> bool {
    needles.iter().any(|n| haystack.contains(n))
}

/// Detecta menciones de precio / costo.
pub fn detect_price_mention(text: &str) -> bool {
    let t = normalize(text);
    contains_any(
        &t,
        &[
            "precio",
            "cuesta",
            "costo",
            "presupuesto",
            "caro",
            "cara",
            "inversion",
            "pagar",
            "cobra",
            "cobran",
            "tarifa",
            "cotizacion",
            "descuento",
            "dolar",
            "peso",
            "euro",
            "barato",
            "barata",
            "economico",
            "economica",
        ],
    )
}

/// Detecta objeciones típicas.
pub fn detect_objection(text: &str) -> bool {
    let t = normalize(text);
    contains_any(
        &t,
        &[
            " caro",
            " cara",
            "carisimo",
            "carisima",
            "no es el momento",
            "dejame pensar",
            "dejame pensarlo",
            "tengo que pensar",
            "lo voy a pensar",
            "te aviso",
            "despues te digo",
            "no tenemos presupuesto",
            "ya tenemos",
            "ya usamos",
            "la competencia",
            "otro proveedor",
            "no estoy seguro",
            "no lo necesitamos",
            "no es prioridad",
        ],
    )
}

/// Detecta señales de compra.
pub fn detect_buying_signal(text: &str) -> bool {
    let t = normalize(text);
    contains_any(
        &t,
        &[
            "cuando empezamos",
            "cuando arrancamos",
            "cuando iniciamos",
            "cuanto tarda",
            "como implementamos",
            "como seria la implementacion",
            "cuando podemos",
            "que sigue",
            "proximo paso",
            "mi equipo lo usaria",
            "mi jefe",
            "le muestro a",
            "le voy a mostrar",
            "donde firmamos",
            "como se paga",
            "forma de pago",
            "plan de pago",
            "empezar la implementacion",
            "podriamos empezar",
            "podemos empezar",
            "podemos arrancar",
            "cuando empiezan",
            "cuando empezamos",
            "cuando comenzamos",
            "como contratamos",
            "como adquirimos",
        ],
    )
}

/// Detecta frustración / emoción negativa fuerte.
pub fn detect_frustration(text: &str) -> bool {
    let t = normalize(text);
    // Intensificadores + absolutos negativos + amenazas
    contains_any(
        &t,
        &[
            "extremadamente",
            "absolutamente",
            "increible que",
            "nunca funciona",
            "siempre pasa",
            "nadie me ayuda",
            "cancelar",
            "supervisor",
            "gerente",
            "demanda",
            "queja",
            "reclamo",
            "terrible",
            "pesimo",
            "inaceptable",
            "indignante",
            "harto",
            "harta",
            "perdida de tiempo",
        ],
    )
}

/// Detecta duda / hesitación.
pub fn detect_hesitation(text: &str) -> bool {
    let t = normalize(text);
    contains_any(
        &t,
        &[
            "tal vez",
            "quizas",
            "podria ser",
            "no lo se",
            "no se",
            "deberia",
            "podria",
            "lo reviso con",
            "lo consulto con",
            "me pongo a pensar",
        ],
    )
}

/// Detecta lenguaje posesivo (señal de cierre emocional).
pub fn detect_possessive_language(text: &str) -> bool {
    let t = normalize(text);
    contains_any(
        &t,
        &[
            "nuestra plataforma",
            "nuestro equipo",
            "nuestros clientes",
            "cuando implementemos",
            "cuando lo usemos",
            "nuestra solucion",
            "nuestra cuenta",
        ],
    )
}

/// Detecta pregunta del interlocutor (contiene ¿ o ?).
pub fn detect_question(text: &str) -> bool {
    text.contains('¿') || text.contains('?')
}

/// Detecta monólogo del usuario: más de `threshold_sec` segundos de habla continua sin turnos del otro lado.
pub fn detect_monologue(user_continuous_sec: u32) -> bool {
    user_continuous_sec > 120
}

/// Detecta satisfacción / emoción positiva del interlocutor.
pub fn detect_satisfaction(text: &str) -> bool {
    let t = normalize(text);
    contains_any(
        &t,
        &[
            "excelente",
            "perfecto",
            "me encanta",
            "impresionante",
            "impresionado",
            "impresionada",
            "genial",
            "increible",
            "fantastico",
            "fantastica",
            "maravilloso",
            "maravillosa",
            "muy bien",
            "buenisimo",
            "me gusta mucho",
            "estoy contento",
            "estoy contenta",
            "satisfecho",
            "satisfecha",
            "justo lo que necesitaba",
            "justo lo que buscaba",
        ],
    )
}

/// Detecta entusiasmo del interlocutor (exclamaciones + palabras positivas).
pub fn detect_enthusiasm(text: &str) -> bool {
    let t = normalize(text);
    let has_exclamation = text.contains('!') || text.contains('¡');
    let has_energy_word = contains_any(
        &t,
        &[
            "vamos",
            "super",
            "wow",
            "increible",
            "definitivamente",
            "sin duda",
            "por supuesto",
            "claro que si",
            "me encanta",
            "love it",
            "amazing",
            "awesome",
            "great",
            "si si",
        ],
    );
    (has_exclamation && has_energy_word) || contains_any(&t, &["definitivamente si", "por supuesto que si", "claro que si"])
}

/// Detecta talk ratio alto: usuario habla >60% del tiempo.
pub fn detect_high_talk_ratio(ratio: f32) -> bool {
    ratio > 0.60
}

/// Detecta talk ratio bajo (usuario no participa).
pub fn detect_low_talk_ratio(ratio: f32) -> bool {
    ratio < 0.25
}

/// Analiza un turno de transcripción y devuelve todas las señales detectadas,
/// ordenadas por prioridad (critical primero).
///
/// `is_interlocutor` = true si el texto vino del interlocutor (otro speaker).
pub fn analyze_turn(text: &str, is_interlocutor: bool) -> Vec<TriggerSignal> {
    let mut signals = Vec::new();
    let snippet: String = text.chars().take(100).collect();

    // Señales del INTERLOCUTOR (prioridad alta porque son oportunidades de ventana)
    if is_interlocutor {
        if detect_frustration(text) {
            signals.push(TriggerSignal {
                category: TriggerCategory::Service,
                priority: "critical".into(),
                signal: "frustration_detected".into(),
                snippet: snippet.clone(),
            });
        }
        if detect_buying_signal(text) {
            signals.push(TriggerSignal {
                category: TriggerCategory::Closing,
                priority: "critical".into(),
                signal: "buying_signal".into(),
                snippet: snippet.clone(),
            });
        }
        if detect_objection(text) {
            signals.push(TriggerSignal {
                category: TriggerCategory::Objection,
                priority: "critical".into(),
                signal: "objection_detected".into(),
                snippet: snippet.clone(),
            });
        }
        if detect_possessive_language(text) {
            signals.push(TriggerSignal {
                category: TriggerCategory::Closing,
                priority: "important".into(),
                signal: "possessive_language".into(),
                snippet: snippet.clone(),
            });
        }
        if detect_price_mention(text) && !detect_objection(text) {
            signals.push(TriggerSignal {
                category: TriggerCategory::Negotiation,
                priority: "important".into(),
                signal: "price_discussion".into(),
                snippet: snippet.clone(),
            });
        }
        if detect_question(text) {
            signals.push(TriggerSignal {
                category: TriggerCategory::Rapport,
                priority: "soft".into(),
                signal: "interlocutor_asking".into(),
                snippet: snippet.clone(),
            });
        }
        if detect_hesitation(text) {
            signals.push(TriggerSignal {
                category: TriggerCategory::Persuasion,
                priority: "important".into(),
                signal: "hesitation".into(),
                snippet: snippet.clone(),
            });
        }
        if detect_satisfaction(text) {
            signals.push(TriggerSignal {
                category: TriggerCategory::Closing,
                priority: "important".into(),
                signal: "satisfaction_detected".into(),
                snippet: snippet.clone(),
            });
        }
        if detect_enthusiasm(text) {
            signals.push(TriggerSignal {
                category: TriggerCategory::Closing,
                priority: "important".into(),
                signal: "enthusiasm_detected".into(),
                snippet,
            });
        }
    }

    // Ordenar por prioridad
    signals.sort_by_key(|s| match s.priority.as_str() {
        "critical" => 0,
        "important" => 1,
        _ => 2,
    });

    signals
}

/// Comando Tauri: analiza un texto y devuelve las señales detectadas.
#[tauri::command]
pub fn coach_analyze_trigger(text: String, is_interlocutor: bool) -> Vec<TriggerSignal> {
    analyze_turn(&text, is_interlocutor)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_price() {
        assert!(detect_price_mention("el precio es alto"));
        assert!(detect_price_mention("es muy caro"));
        assert!(detect_price_mention("no tengo presupuesto"));
        assert!(!detect_price_mention("me encanta el producto"));
    }

    #[test]
    fn test_detect_objection() {
        assert!(detect_objection("es caro para nosotros"));
        assert!(detect_objection("déjame pensarlo"));
        assert!(detect_objection("ya tenemos otro proveedor"));
        assert!(!detect_objection("cuéntame más"));
    }

    #[test]
    fn test_detect_buying_signal() {
        assert!(detect_buying_signal("¿cuándo empezamos?"));
        assert!(detect_buying_signal("cómo implementamos esto"));
        assert!(detect_buying_signal("le voy a mostrar a mi jefe"));
        assert!(!detect_buying_signal("no me interesa"));
    }

    #[test]
    fn test_detect_frustration() {
        assert!(detect_frustration("esto es absolutamente inaceptable"));
        assert!(detect_frustration("quiero hablar con un supervisor"));
        assert!(detect_frustration("nunca funciona nada"));
        assert!(!detect_frustration("todo bien hasta ahora"));
    }

    #[test]
    fn test_detect_possessive() {
        assert!(detect_possessive_language("cuando implementemos esto"));
        assert!(detect_possessive_language("nuestra plataforma sería genial"));
        assert!(!detect_possessive_language("su plataforma es interesante"));
    }

    #[test]
    fn test_detect_question() {
        assert!(detect_question("¿qué piensas?"));
        assert!(detect_question("pero por qué?"));
        assert!(!detect_question("no me interesa."));
    }

    #[test]
    fn test_detect_monologue() {
        assert!(detect_monologue(150));
        assert!(!detect_monologue(60));
    }

    #[test]
    fn test_detect_talk_ratio() {
        assert!(detect_high_talk_ratio(0.75));
        assert!(!detect_high_talk_ratio(0.50));
        assert!(detect_low_talk_ratio(0.15));
        assert!(!detect_low_talk_ratio(0.40));
    }

    #[test]
    fn test_analyze_turn_buying_signal_from_interlocutor() {
        let signals = analyze_turn("cuándo arrancamos con esto", true);
        assert!(signals.iter().any(|s| s.category == TriggerCategory::Closing));
    }

    #[test]
    fn test_analyze_turn_objection_critical() {
        let signals = analyze_turn("es muy caro para nosotros", true);
        let first = signals.first().unwrap();
        assert_eq!(first.priority, "critical");
        assert_eq!(first.category, TriggerCategory::Objection);
    }

    #[test]
    fn test_analyze_turn_frustration() {
        let signals = analyze_turn("esto es absolutamente terrible, quiero un supervisor", true);
        assert_eq!(signals.first().unwrap().category, TriggerCategory::Service);
    }

    #[test]
    fn test_analyze_turn_empty() {
        assert!(analyze_turn("hola", true).is_empty());
    }

    #[test]
    fn test_analyze_turn_sorted_by_priority() {
        // frustration (critical) + question (soft) en el mismo texto
        let signals = analyze_turn("¿por qué nunca funciona esto? quiero un supervisor", true);
        assert_eq!(signals.first().unwrap().priority, "critical");
    }

    #[test]
    fn test_detect_satisfaction() {
        assert!(detect_satisfaction("esto es excelente, me encanta"));
        assert!(detect_satisfaction("perfecto, justo lo que necesitaba"));
        assert!(detect_satisfaction("estoy impresionado con los resultados"));
        assert!(!detect_satisfaction("está bien, nada especial"));
    }

    #[test]
    fn test_detect_enthusiasm() {
        assert!(detect_enthusiasm("¡Definitivamente sí!"));
        assert!(detect_enthusiasm("¡Me encanta, vamos!"));
        assert!(!detect_enthusiasm("sí, está bien")); // no exclamation
        assert!(!detect_enthusiasm("ok")); // no energy word
    }

    #[test]
    fn test_analyze_turn_satisfaction_signal() {
        let signals = analyze_turn("excelente, me encanta esta propuesta", true);
        assert!(signals.iter().any(|s| s.signal == "satisfaction_detected"));
    }
}
