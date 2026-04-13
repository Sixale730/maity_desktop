//! Stress tests: 5 escenarios de conversación inyectados al trigger detector.
//! Valida detección de señales, prioridades y cobertura del coach.

#[cfg(test)]
mod tests {
    use crate::coach::trigger::*;
    use crate::coach::meeting_type::heuristic_detect;
    use crate::coach::prompt::MeetingType;

    struct Turn {
        text: &'static str,
        is_interlocutor: bool,
        expected_signals: &'static [&'static str],
        expected_priority: Option<&'static str>,
    }

    fn run_scenario(name: &str, turns: &[Turn]) -> (usize, usize, usize) {
        let mut detected = 0;
        let mut missed = 0;
        let mut false_neg = 0;

        for (i, turn) in turns.iter().enumerate() {
            let signals = analyze_turn(turn.text, turn.is_interlocutor);
            let signal_names: Vec<&str> = signals.iter().map(|s| s.signal.as_str()).collect();

            for expected in turn.expected_signals {
                if signal_names.iter().any(|s| s.contains(expected)) {
                    detected += 1;
                } else {
                    missed += 1;
                    false_neg += 1;
                    eprintln!("[{}] Turn {}: MISSED signal '{}' in: \"{}\"",
                        name, i, expected, turn.text);
                }
            }

            if let Some(prio) = turn.expected_priority {
                if let Some(top) = signals.first() {
                    assert_eq!(top.priority, prio,
                        "[{}] Turn {}: expected priority '{}' got '{}'",
                        name, i, prio, top.priority);
                }
            }
        }

        eprintln!("[{}] Results: {}/{} signals detected, {} false negatives",
            name, detected, detected + missed, false_neg);
        (detected, missed, false_neg)
    }

    // ─────────────────────────────────────────────
    // ESCENARIO 1: VENTA (15 turnos)
    // ─────────────────────────────────────────────
    #[test]
    fn stress_test_sales_call() {
        let turns = vec![
            Turn { text: "Cuéntame sobre los desafíos de tu equipo", is_interlocutor: false, expected_signals: &[], expected_priority: None },
            Turn { text: "Nos cuesta mucho, el proceso manual es muy caro", is_interlocutor: true, expected_signals: &["objection"], expected_priority: Some("critical") },
            Turn { text: "¿Cómo impacta eso en tu día a día?", is_interlocutor: false, expected_signals: &[], expected_priority: None },
            Turn { text: "Perdemos 8 horas semanales en reportes manuales", is_interlocutor: true, expected_signals: &[], expected_priority: None },
            Turn { text: "Déjame mostrarte nuestra solución", is_interlocutor: false, expected_signals: &[], expected_priority: None },
            Turn { text: "Interesante, ¿cuánto cuesta la licencia?", is_interlocutor: true, expected_signals: &["price"], expected_priority: None },
            Turn { text: "Son 500 dólares mensuales", is_interlocutor: false, expected_signals: &[], expected_priority: None },
            Turn { text: "Es caro para nuestro presupuesto, déjame pensarlo", is_interlocutor: true, expected_signals: &["objection"], expected_priority: Some("critical") },
            Turn { text: "Entiendo tu preocupación, si el precio no fuera tema ¿es la solución?", is_interlocutor: false, expected_signals: &[], expected_priority: None },
            Turn { text: "Sí definitivamente, me encanta la funcionalidad", is_interlocutor: true, expected_signals: &["satisfaction"], expected_priority: None },
            Turn { text: "¿Y si empezamos con un plan piloto de 3 meses?", is_interlocutor: false, expected_signals: &[], expected_priority: None },
            Turn { text: "¿Cuándo podríamos empezar la implementación?", is_interlocutor: true, expected_signals: &["buying_signal"], expected_priority: None },
            Turn { text: "Podemos arrancar la próxima semana", is_interlocutor: false, expected_signals: &[], expected_priority: None },
            Turn { text: "Cuando implementemos esto con nuestro equipo va a ser increíble", is_interlocutor: true, expected_signals: &["possessive"], expected_priority: None },
            Turn { text: "Perfecto, te mando el contrato hoy", is_interlocutor: false, expected_signals: &[], expected_priority: None },
        ];

        let (detected, missed, _) = run_scenario("VENTA", &turns);
        assert!(missed == 0, "Sales scenario: {} signals missed", missed);
        assert!(detected >= 4, "Sales scenario: need >=4 signals, got {}", detected);
    }

    // ─────────────────────────────────────────────
    // ESCENARIO 2: SERVICIO AL CLIENTE (12 turnos)
    // ─────────────────────────────────────────────
    #[test]
    fn stress_test_customer_service() {
        let turns = vec![
            Turn { text: "Hola, tengo un problema con mi cuenta", is_interlocutor: true, expected_signals: &[], expected_priority: None },
            Turn { text: "Claro, ¿cuál es el problema?", is_interlocutor: false, expected_signals: &[], expected_priority: None },
            Turn { text: "Llevo 3 días sin poder acceder, esto es absolutamente inaceptable", is_interlocutor: true, expected_signals: &["frustration"], expected_priority: Some("critical") },
            Turn { text: "Lamento mucho la situación, déjame ver", is_interlocutor: false, expected_signals: &[], expected_priority: None },
            Turn { text: "Quiero hablar con un supervisor, nadie me ayuda", is_interlocutor: true, expected_signals: &["frustration"], expected_priority: Some("critical") },
            Turn { text: "Yo me encargo personalmente de esto", is_interlocutor: false, expected_signals: &[], expected_priority: None },
            Turn { text: "¿Cuánto tiempo va a tardar? Ya estoy harto de esperar", is_interlocutor: true, expected_signals: &["frustration"], expected_priority: Some("critical") },
            Turn { text: "Lo resuelvo en los próximos 10 minutos, ya encontré el problema", is_interlocutor: false, expected_signals: &[], expected_priority: None },
            Turn { text: "¿De verdad?", is_interlocutor: true, expected_signals: &[], expected_priority: None },
            Turn { text: "Listo, ya tienes acceso, verifica por favor", is_interlocutor: false, expected_signals: &[], expected_priority: None },
            Turn { text: "Excelente, ya funciona, perfecto", is_interlocutor: true, expected_signals: &["satisfaction"], expected_priority: None },
            Turn { text: "Me alegro, ¿algo más en que pueda ayudarte?", is_interlocutor: false, expected_signals: &[], expected_priority: None },
        ];

        let (detected, missed, _) = run_scenario("SERVICIO", &turns);
        assert!(missed == 0, "Service scenario: {} signals missed", missed);
        assert!(detected >= 4, "Service scenario: need >=4 signals, got {}", detected);
    }

    // ─────────────────────────────────────────────
    // ESCENARIO 3: JUNTA DE EQUIPO (10 turnos)
    // ─────────────────────────────────────────────
    #[test]
    fn stress_test_team_meeting() {
        let turns = vec![
            Turn { text: "Buenos días equipo, vamos con el standup", is_interlocutor: false, expected_signals: &[], expected_priority: None },
            Turn { text: "En el sprint voy bien, sin bloqueadores", is_interlocutor: true, expected_signals: &[], expected_priority: None },
            Turn { text: "¿Cómo vas con el proyecto de migración?", is_interlocutor: false, expected_signals: &[], expected_priority: None },
            Turn { text: "Tengo un bloqueo, la API está caída y no se quizás cuándo la arreglen", is_interlocutor: true, expected_signals: &["hesitation"], expected_priority: None },
            Turn { text: "¿Qué necesitas para desbloquear?", is_interlocutor: false, expected_signals: &[], expected_priority: None },
            Turn { text: "Tal vez si alguien del backend me ayuda podría avanzar", is_interlocutor: true, expected_signals: &["hesitation"], expected_priority: None },
            Turn { text: "Ok yo tomo eso, ahora decidamos: ¿opción A o B?", is_interlocutor: false, expected_signals: &[], expected_priority: None },
            Turn { text: "Definitivamente la opción A, es más simple", is_interlocutor: true, expected_signals: &[], expected_priority: None },
            Turn { text: "Perfecto, ¿algo más antes de cerrar?", is_interlocutor: false, expected_signals: &[], expected_priority: None },
            Turn { text: "No, todo bien, gracias", is_interlocutor: true, expected_signals: &[], expected_priority: None },
        ];

        let (detected, _, _) = run_scenario("EQUIPO", &turns);
        assert!(detected >= 2, "Team scenario: need >=2 signals, got {}", detected);
    }

    // ─────────────────────────────────────────────
    // ESCENARIO 4: NEGOCIACIÓN (12 turnos)
    // ─────────────────────────────────────────────
    #[test]
    fn stress_test_negotiation() {
        let turns = vec![
            Turn { text: "Nuestra propuesta es 100 mil dólares por el proyecto", is_interlocutor: false, expected_signals: &[], expected_priority: None },
            Turn { text: "El precio es alto, nuestro presupuesto es mucho menor", is_interlocutor: true, expected_signals: &["price"], expected_priority: Some("important") },
            Turn { text: "¿Cuál sería un rango aceptable para ustedes?", is_interlocutor: false, expected_signals: &[], expected_priority: None },
            Turn { text: "No sé, tal vez la mitad, déjame pensarlo", is_interlocutor: true, expected_signals: &["hesitation"], expected_priority: None },
            Turn { text: "Puedo ajustar a 80 mil si cerramos antes de fin de mes", is_interlocutor: false, expected_signals: &[], expected_priority: None },
            Turn { text: "Ya tenemos otro proveedor que nos cotizó menos", is_interlocutor: true, expected_signals: &["objection"], expected_priority: Some("critical") },
            Turn { text: "¿Qué incluye esa otra cotización?", is_interlocutor: false, expected_signals: &[], expected_priority: None },
            Turn { text: "Menos funcionalidades, pero es más barato", is_interlocutor: true, expected_signals: &["price"], expected_priority: None },
            Turn { text: "Con nosotros obtienes soporte 24/7 y capacitación", is_interlocutor: false, expected_signals: &[], expected_priority: None },
            Turn { text: "¿Cómo sería el plan de pago?", is_interlocutor: true, expected_signals: &["buying_signal"], expected_priority: None },
            Turn { text: "Podemos hacer 3 pagos mensuales", is_interlocutor: false, expected_signals: &[], expected_priority: None },
            Turn { text: "Cuando implementemos esto con nuestro equipo será genial", is_interlocutor: true, expected_signals: &["possessive"], expected_priority: None },
        ];

        let (detected, missed, _) = run_scenario("NEGOCIACIÓN", &turns);
        assert!(missed == 0, "Negotiation scenario: {} signals missed", missed);
        assert!(detected >= 5, "Negotiation scenario: need >=5 signals, got {}", detected);
    }

    // ─────────────────────────────────────────────
    // ESCENARIO 5: WEBINAR Q&A (8 turnos)
    // ─────────────────────────────────────────────
    #[test]
    fn stress_test_webinar() {
        let turns = vec![
            Turn { text: "Bienvenidos al webinar de inteligencia artificial", is_interlocutor: false, expected_signals: &[], expected_priority: None },
            Turn { text: "¿Pueden explicar más sobre la integración?", is_interlocutor: true, expected_signals: &["interlocutor_asking"], expected_priority: None },
            Turn { text: "Claro, la integración se hace vía API REST", is_interlocutor: false, expected_signals: &[], expected_priority: None },
            Turn { text: "Impresionante, me encanta la arquitectura", is_interlocutor: true, expected_signals: &["satisfaction"], expected_priority: None },
            Turn { text: "¿Cuánto cuesta la versión enterprise?", is_interlocutor: true, expected_signals: &["price"], expected_priority: None },
            Turn { text: "La versión enterprise parte desde 2000 al mes", is_interlocutor: false, expected_signals: &[], expected_priority: None },
            Turn { text: "¿Cuándo podemos empezar un trial?", is_interlocutor: true, expected_signals: &["buying_signal"], expected_priority: None },
            Turn { text: "Pueden iniciar hoy mismo con nuestro plan gratuito", is_interlocutor: false, expected_signals: &[], expected_priority: None },
        ];

        let (detected, missed, _) = run_scenario("WEBINAR", &turns);
        assert!(missed == 0, "Webinar scenario: {} signals missed", missed);
        assert!(detected >= 3, "Webinar scenario: need >=3 signals, got {}", detected);
    }

    // ─────────────────────────────────────────────
    // MEETING TYPE DETECTION
    // ─────────────────────────────────────────────
    #[test]
    fn stress_test_meeting_type_detection() {
        // heuristic needs 2+ keywords per category to classify
        assert_eq!(
            heuristic_detect("Cuánto cuesta la licencia, queremos hacer una demo del producto y ver el precio"),
            Some(MeetingType::Sales)
        );
        assert_eq!(
            heuristic_detect("Tengo un problema con mi cuenta, quiero soporte técnico y hablar con un supervisor"),
            Some(MeetingType::Service)
        );
        assert_eq!(
            heuristic_detect("Buenos días equipo, vamos con el standup del sprint y revisemos los bloqueadores del proyecto"),
            Some(MeetingType::TeamMeeting)
        );
    }

    // ─────────────────────────────────────────────
    // EDGE CASES: Code-switching, números, regional
    // ─────────────────────────────────────────────
    #[test]
    fn test_code_switching() {
        assert!(detect_objection("es muy caro, we don't have budget"));
        assert!(detect_price_mention("cuesta fifteen thousand dólares"));
    }

    #[test]
    fn test_numbers_in_price() {
        assert!(detect_price_mention("el presupuesto es de 15 millones"));
        assert!(detect_price_mention("cuesta $5000 USD"));
        assert!(detect_price_mention("la tarifa es de 200 euros al mes"));
    }

    #[test]
    fn test_soft_frustration() {
        assert!(detect_frustration("estoy harta de que nadie responda"));
        assert!(detect_frustration("esto es terrible, ya llevo días así"));
    }

    #[test]
    fn test_soft_satisfaction() {
        assert!(detect_satisfaction("muy bien, me gusta mucho cómo quedó"));
        assert!(detect_satisfaction("fantástico, justo lo que buscaba"));
    }
}
