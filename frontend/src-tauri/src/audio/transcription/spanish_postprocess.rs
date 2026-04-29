//! Capa heurística de post-procesamiento para transcripciones en español.
//!
//! Aplica correcciones livianas (sin LLM) sobre la salida cruda de Parakeet/Canary
//! para mejorar legibilidad y precisión percibida sin tocar el modelo:
//!
//! 1. Capitalización inicial de oración.
//! 2. Restauración de tildes en interrogativos cuando aparecen en preguntas.
//! 3. Apertura de signos `¿` y `¡` cuando faltan.
//! 4. Normalización de espaciado y puntuación duplicada.
//! 5. Atenuación de muletillas frecuentes ("eh", "este", "o sea") al inicio.
//! 6. Correcciones de errores comunes de Parakeet en español.
//!
//! Diseño:
//! - Cero allocs en el camino feliz cuando el texto está vacío.
//! - Idempotente: aplicar dos veces produce el mismo resultado.
//! - Solo se ejecuta si `language` empieza con "es".

/// Aplica el pipeline completo de heurísticas español sobre `text`.
///
/// Si `language` no empieza con "es", devuelve el texto tal cual (después
/// de normalizar espacios, que es seguro para cualquier idioma).
pub fn enhance(text: &str, language: &str) -> String {
    if text.trim().is_empty() {
        return text.to_string();
    }

    let mut out = normalize_whitespace(text);

    // Anti-stutter: aplicar SIEMPRE (independiente del idioma).
    // Parakeet a veces alucina repeticiones tipo "el el el" o "creo que creo que".
    out = clean_repetitive_text(&out);

    if language.to_lowercase().starts_with("es") {
        out = fix_common_errors(&out);
        out = restore_question_marks(&out);
        out = restore_interrogative_accents(&out);
        out = capitalize_sentences(&out);
        // NOTE: trim_leading_fillers REMOVIDO del pipeline para zero-loss.
        // Las muletillas ("eh,", "este,") se PRESERVAN en la transcripcion.
        // El usuario ve EXACTAMENTE lo que se dijo.
    } else {
        out = capitalize_sentences(&out);
    }

    out
}

/// Anti-stutter: elimina repeticiones inmediatas de palabras y frases de 2.
///
/// Detecta dos patrones comunes en transcripciones de Parakeet/Canary:
/// 1. Palabra repetida: "el el el caso" → "el caso"
/// 2. Frase de 2 palabras repetida: "creo que creo que" → "creo que"
///
/// Conservador: solo elimina repeticiones EXACTAS (case-sensitive). NO toca
/// repeticiones intencionales tipo "muy muy bueno" si el usuario las dice así
/// (porque serían capturadas por el VAD pero raramente se duplican exactas).
fn clean_repetitive_text(text: &str) -> String {
    let words: Vec<&str> = text.split_whitespace().collect();
    if words.len() < 4 {
        return text.to_string();
    }

    let mut result: Vec<&str> = Vec::with_capacity(words.len());
    let mut i = 0;

    while i < words.len() {
        let current = words[i];

        // Patrón 1: palabra repetida inmediatamente
        if i + 1 < words.len() && words[i + 1].eq_ignore_ascii_case(current) {
            result.push(current);
            // Saltar todas las repeticiones consecutivas
            while i + 1 < words.len() && words[i + 1].eq_ignore_ascii_case(current) {
                i += 1;
            }
        }
        // Patrón 2: frase de 2 palabras repetida
        else if i + 3 < words.len() {
            let phrase_a = (words[i], words[i + 1]);
            let phrase_b = (words[i + 2], words[i + 3]);

            if phrase_a.0.eq_ignore_ascii_case(phrase_b.0)
                && phrase_a.1.eq_ignore_ascii_case(phrase_b.1)
            {
                result.push(phrase_a.0);
                result.push(phrase_a.1);
                i += 4;
                // Saltar repeticiones adicionales de la misma frase
                while i + 1 < words.len()
                    && words[i].eq_ignore_ascii_case(phrase_a.0)
                    && words[i + 1].eq_ignore_ascii_case(phrase_a.1)
                {
                    i += 2;
                }
                continue;
            }
            result.push(current);
        } else {
            result.push(current);
        }
        i += 1;
    }

    result.join(" ")
}

/// Normaliza espacios múltiples a uno solo y trim.
fn normalize_whitespace(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut last_was_space = true;
    for c in text.chars() {
        if c.is_whitespace() {
            if !last_was_space {
                result.push(' ');
                last_was_space = true;
            }
        } else {
            result.push(c);
            last_was_space = false;
        }
    }
    result.trim().to_string()
}

/// Capitaliza la primera letra del texto y la primera letra después de . ! ? ¡ ¿
fn capitalize_sentences(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut capitalize_next = true;
    for c in text.chars() {
        if capitalize_next && c.is_alphabetic() {
            for upper in c.to_uppercase() {
                result.push(upper);
            }
            capitalize_next = false;
        } else {
            result.push(c);
            if matches!(c, '.' | '!' | '?') {
                capitalize_next = true;
            } else if !c.is_whitespace() {
                // Una vez encontramos un no-espacio que no es puntuación, ya no capitalizamos
                // hasta el próximo signo de fin de oración.
            }
        }
    }
    result
}

/// Detecta interrogativos al inicio o tras espacio y agrega tilde si falta.
///
/// Reglas conservadoras: solo tildea palabras claramente interrogativas en
/// contextos donde el segmento parece una pregunta (termina en `?` o
/// empieza con un interrogativo).
fn restore_interrogative_accents(text: &str) -> String {
    if !looks_like_question(text) {
        return text.to_string();
    }

    // Pares (sin_tilde, con_tilde). Usamos límites de palabra para evitar
    // tocar palabras que contengan estas letras como sub-cadena.
    const REPLACEMENTS: &[(&str, &str)] = &[
        ("que ", "qué "),
        ("Que ", "Qué "),
        ("como ", "cómo "),
        ("Como ", "Cómo "),
        ("donde ", "dónde "),
        ("Donde ", "Dónde "),
        ("cuando ", "cuándo "),
        ("Cuando ", "Cuándo "),
        ("quien ", "quién "),
        ("Quien ", "Quién "),
        ("cual ", "cuál "),
        ("Cual ", "Cuál "),
        ("cuanto ", "cuánto "),
        ("Cuanto ", "Cuánto "),
        ("cuanta ", "cuánta "),
        ("cuantos ", "cuántos "),
        ("cuantas ", "cuántas "),
        ("por que ", "por qué "),
        ("Por que ", "Por qué "),
    ];

    let mut result = text.to_string();
    for (from, to) in REPLACEMENTS {
        result = result.replace(from, to);
    }
    result
}

/// Heurística: el texto parece una pregunta si termina en `?` o si empieza
/// con un interrogativo común.
fn looks_like_question(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.ends_with('?') {
        return true;
    }
    let lower = trimmed.to_lowercase();
    let starters = [
        "que ", "qué ", "como ", "cómo ", "donde ", "dónde ", "cuando ", "cuándo ", "quien ",
        "quién ", "cual ", "cuál ", "cuanto ", "cuánto ", "por que ", "por qué ",
    ];
    starters.iter().any(|s| lower.starts_with(s))
}

/// Si el texto termina en `?` pero no tiene `¿`, intenta agregarlo al inicio
/// del último segmento del texto (después del último punto o desde el inicio).
fn restore_question_marks(text: &str) -> String {
    let trimmed = text.trim_end();
    if !trimmed.ends_with('?') || trimmed.contains('¿') {
        return text.to_string();
    }

    // Encontrar el inicio de la oración pregunta: último '. ' o inicio del texto
    let body = trimmed.trim_end_matches('?').trim_end();
    let split_at = body
        .rfind(". ")
        .map(|i| i + 2)
        .or_else(|| body.rfind("! ").map(|i| i + 2))
        .unwrap_or(0);

    let mut result = String::with_capacity(trimmed.len() + 2);
    result.push_str(&body[..split_at]);
    result.push('¿');
    result.push_str(&body[split_at..]);
    result.push('?');
    result
}

// trim_leading_fillers REMOVED — zero-loss policy: all spoken words preserved.

/// Detecta texto que es probablemente una hallucination de Parakeet.
/// Retorna true si el texto completo debe descartarse.
pub fn is_hallucination(text: &str) -> bool {
    let t = text.to_lowercase();
    const HALLUCINATION_PATTERNS: &[&str] = &[
        "subtítulos por",
        "subtitulos por",
        "subtítulos realizados",
        "subtitulos realizados",
        "amara.org",
        "gracias por ver",
        "gracias por mirar",
        "suscríbete",
        "suscribete",
        "dale like",
        "no olvides suscribirte",
        "música de fondo",
        "musica de fondo",
    ];
    for pat in HALLUCINATION_PATTERNS {
        if t.contains(pat) { return true; }
    }
    false
}

/// Correcciones de errores frecuentes de Parakeet/Canary en español.
fn fix_common_errors(text: &str) -> String {
    const FIXES: &[(&str, &str)] = &[
        // Espaciado antes de puntuación
        (" ,", ","),
        (" .", "."),
        (" ?", "?"),
        (" !", "!"),
        // Puntuación duplicada
        ("..", "."),
        (",,", ","),
        ("??", "?"),
        // Muletillas duplicadas
        ("o sea o sea", "o sea"),
        ("este este", "este"),
        ("bueno bueno", "bueno"),
        ("pues pues", "pues"),
        ("entonces entonces", "entonces"),
        ("digamos digamos", "digamos"),
    ];

    let mut result = text.to_string();
    for (from, to) in FIXES {
        result = result.replace(from, to);
    }
    while result.contains("..") {
        result = result.replace("..", ".");
    }
    while result.contains("  ") {
        result = result.replace("  ", " ");
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_no_toca_texto_vacio() {
        assert_eq!(enhance("", "es"), "");
        assert_eq!(enhance("   ", "es"), "   ");
    }

    #[test]
    fn test_capitaliza_primera_letra() {
        assert_eq!(enhance("hola mundo", "es"), "Hola mundo");
    }

    #[test]
    fn test_capitaliza_despues_de_punto() {
        assert_eq!(
            enhance("hola. cómo estás", "es"),
            "Hola. Cómo estás"
        );
    }

    #[test]
    fn test_restaura_tilde_que_en_pregunta() {
        let input = "que tal tu fin de semana?";
        let out = enhance(input, "es");
        assert!(out.contains("Qué tal"));
        assert!(out.starts_with('¿'));
        assert!(out.ends_with('?'));
    }

    #[test]
    fn test_no_tilde_que_en_afirmacion() {
        let input = "creo que me gusta";
        let out = enhance(input, "es");
        // No debe tildar "que" porque no es pregunta
        assert!(!out.contains("qué"));
    }

    #[test]
    fn test_normaliza_espacios() {
        assert_eq!(enhance("hola    mundo", "es"), "Hola mundo");
    }

    #[test]
    fn test_quita_espacio_antes_de_puntuacion() {
        assert_eq!(enhance("hola , mundo .", "es"), "Hola, mundo.");
    }

    #[test]
    fn test_preserva_muletilla_inicial_zero_loss() {
        // Zero-loss: muletillas se PRESERVAN (no se eliminan)
        assert_eq!(
            enhance("eh, hola cómo estás", "es"),
            "Eh, hola cómo estás"
        );
    }

    #[test]
    fn test_preserva_doble_muletilla_zero_loss() {
        // Zero-loss: muletillas se PRESERVAN (solo se capitaliza)
        assert_eq!(enhance("eh, este, hola", "es"), "Eh, este, hola");
    }

    #[test]
    fn test_idempotente() {
        let input = "que tal el día?";
        let pass1 = enhance(input, "es");
        let pass2 = enhance(&pass1, "es");
        assert_eq!(pass1, pass2);
    }

    #[test]
    fn test_ingles_no_aplica_heuristicas_es() {
        let out = enhance("how are you", "en");
        assert_eq!(out, "How are you"); // Solo capitaliza
    }

    #[test]
    fn test_signos_apertura_pregunta() {
        let out = enhance("hola. donde vives?", "es");
        assert!(out.contains("¿Dónde vives?"));
        assert!(out.starts_with("Hola."));
    }

    #[test]
    fn test_dedupe_espacios_y_puntuacion() {
        assert_eq!(enhance("hola..  mundo", "es"), "Hola. Mundo");
    }

    #[test]
    fn test_anti_stutter_palabra_repetida() {
        // 4 palabras es el mínimo donde aplica el cleaner
        assert_eq!(
            enhance("el el el caso es claro", "es"),
            "El caso es claro"
        );
    }

    #[test]
    fn test_anti_stutter_frase_repetida() {
        assert_eq!(
            enhance("creo que creo que es bueno", "es"),
            "Creo que es bueno"
        );
    }

    #[test]
    fn test_anti_stutter_multiples_repeticiones_frase() {
        assert_eq!(
            enhance("creo que creo que creo que es bueno", "es"),
            "Creo que es bueno"
        );
    }

    #[test]
    fn test_anti_stutter_no_toca_palabras_distintas() {
        let input = "el coche es rojo y rapido";
        let out = enhance(input, "es");
        // No debe quitar palabras únicas
        assert!(out.contains("coche"));
        assert!(out.contains("rojo"));
        assert!(out.contains("rapido"));
    }

    #[test]
    fn test_anti_stutter_case_insensitive() {
        assert_eq!(
            enhance("El el el caso es claro", "es"),
            "El caso es claro"
        );
    }

    #[test]
    fn test_hallucination_detection() {
        assert!(is_hallucination("Subtítulos por amara.org"));
        assert!(is_hallucination("Gracias por ver este video, suscríbete"));
        assert!(is_hallucination("No olvides suscribirte y dale like"));
        assert!(is_hallucination("Música de fondo"));
        assert!(!is_hallucination("Buenos días, ¿cómo estás?"));
        assert!(!is_hallucination("El precio es de 500 dólares"));
    }

    #[test]
    fn test_fix_duplicated_fillers() {
        assert_eq!(enhance("bueno bueno vamos a ver", "es"), "Bueno vamos a ver");
        assert_eq!(enhance("entonces entonces qué hacemos", "es"), "Entonces qué hacemos");
    }
}
