//! Detector de tipo de reunión.
//!
//! Analiza los primeros ~90 segundos de transcripción y clasifica el tipo:
//! sales, service, webinar, team_meeting, auto.
//!
//! Estrategia dual:
//! 1. Heurística rápida con keywords (sin LLM, <1ms)
//! 2. Si heurística es incierta, llama a gemma3:4b para clasificación (1-3s)
//!
//! Cachea el resultado por `meeting_id` en memoria para evitar re-detección.

use crate::coach::prompt::{
    build_meeting_type_detector_prompt, MeetingType, MEETING_TYPE_DETECTOR_PROMPT, SECONDARY_MODEL,
};
use crate::summary::llm_client::{generate_summary, LLMProvider};
use reqwest::Client;
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

/// Cache de detecciones por meeting_id (evita llamar LLM 2 veces para la misma reunión).
static DETECTION_CACHE: LazyLock<Mutex<HashMap<String, MeetingType>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Heurística rápida: cuenta keywords y devuelve la categoría con más matches.
/// Devuelve `None` si no hay señal clara (2+ keywords en una categoría).
pub fn heuristic_detect(text: &str) -> Option<MeetingType> {
    let t = text.to_lowercase();

    let mut scores: HashMap<MeetingType, u32> = HashMap::new();

    // Sales keywords
    let sales_kw = [
        "precio",
        "cotizacion",
        "cotización",
        "cliente",
        "producto",
        "demo",
        "propuesta",
        "descuento",
        "cerrar",
        "comprar",
        "venta",
        "vender",
        "oferta",
        "contrato",
        "factura",
        "plan",
        "suscripcion",
        "suscripción",
    ];
    for kw in &sales_kw {
        if t.contains(kw) {
            *scores.entry(MeetingType::Sales).or_insert(0) += 1;
        }
    }

    // Service keywords
    let service_kw = [
        "queja",
        "reclamo",
        "problema",
        "error",
        "no funciona",
        "ayuda",
        "soporte",
        "ticket",
        "supervisor",
        "cancelar",
        "reembolso",
        "devolucion",
        "devolución",
        "molesto",
        "frustrado",
        "urgente",
    ];
    for kw in &service_kw {
        if t.contains(kw) {
            *scores.entry(MeetingType::Service).or_insert(0) += 1;
        }
    }

    // Webinar keywords
    let webinar_kw = [
        "bienvenidos",
        "presentacion",
        "presentación",
        "webinar",
        "el dia de hoy vamos",
        "les voy a mostrar",
        "les voy a explicar",
        "muchas gracias por conectarse",
        "este webinar",
        "grabacion",
        "grabación",
    ];
    for kw in &webinar_kw {
        if t.contains(kw) {
            *scores.entry(MeetingType::Webinar).or_insert(0) += 1;
        }
    }

    // Team meeting keywords
    let team_kw = [
        "equipo",
        "standup",
        "retro",
        "sprint",
        "kanban",
        "jira",
        "ticket",
        "deploy",
        "review",
        "daily",
        "syncup",
        "sync",
        "actualizacion",
        "actualización de avance",
        "bloqueo",
        "impedimento",
    ];
    for kw in &team_kw {
        if t.contains(kw) {
            *scores.entry(MeetingType::TeamMeeting).or_insert(0) += 1;
        }
    }

    // Devolver la categoría con más matches si supera umbral (2+)
    let (best_type, best_score) = scores.into_iter().max_by_key(|(_, score)| *score)?;
    if best_score >= 2 {
        Some(best_type)
    } else {
        None
    }
}

/// Parsea la respuesta del LLM (debe ser UNA palabra).
fn parse_llm_response(raw: &str) -> MeetingType {
    MeetingType::from_str_loose(raw)
}

/// Detecta el tipo de reunión usando heurística + LLM fallback.
///
/// # Argumentos
/// * `transcript` - Fragmento de transcripción (idealmente primeros 60-90s)
/// * `meeting_id` - Opcional: si se provee, cachea el resultado
///
/// # Returns
/// El tipo detectado, o `MeetingType::Auto` si no se pudo determinar.
pub async fn detect_meeting_type(
    transcript: &str,
    meeting_id: Option<&str>,
) -> MeetingType {
    // 1. Cache lookup
    if let Some(mid) = meeting_id {
        if let Ok(cache) = DETECTION_CACHE.lock() {
            if let Some(cached) = cache.get(mid) {
                log::debug!("[meeting_type] cache hit for {}: {:?}", mid, cached);
                return *cached;
            }
        }
    }

    // 2. Heurística rápida
    if let Some(mt) = heuristic_detect(transcript) {
        log::info!("[meeting_type] heurística detectó: {:?}", mt);
        if let Some(mid) = meeting_id {
            if let Ok(mut cache) = DETECTION_CACHE.lock() {
                cache.insert(mid.to_string(), mt);
            }
        }
        return mt;
    }

    // 3. LLM fallback con gemma3:4b (rápido)
    if transcript.trim().len() < 100 {
        log::debug!("[meeting_type] transcript muy corto, defaulteando a Auto");
        return MeetingType::Auto;
    }

    let client = match Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
    {
        Ok(c) => c,
        Err(_) => return MeetingType::Auto,
    };

    let user_prompt = build_meeting_type_detector_prompt(transcript);

    let start = std::time::Instant::now();
    let result = generate_summary(
        &client,
        &LLMProvider::Ollama,
        SECONDARY_MODEL,
        "",
        MEETING_TYPE_DETECTOR_PROMPT,
        &user_prompt,
        None,
        None,
        Some(10), // solo una palabra
        Some(0.1), // determinístico
        Some(1.0),
        None,
        None,
    )
    .await;

    match result {
        Ok(raw) => {
            let mt = parse_llm_response(&raw);
            log::info!(
                "[meeting_type] LLM ({:?}) detectó: {:?} en {:?}",
                SECONDARY_MODEL,
                mt,
                start.elapsed()
            );
            if let Some(mid) = meeting_id {
                if let Ok(mut cache) = DETECTION_CACHE.lock() {
                    cache.insert(mid.to_string(), mt);
                }
            }
            mt
        }
        Err(e) => {
            log::warn!("[meeting_type] LLM falló: {}, defaulteando a Auto", e);
            MeetingType::Auto
        }
    }
}

/// Comando Tauri: detectar tipo de reunión.
#[tauri::command]
pub async fn coach_detect_meeting_type(
    transcript: String,
    meeting_id: Option<String>,
) -> Result<String, String> {
    let mt = detect_meeting_type(&transcript, meeting_id.as_deref()).await;
    Ok(match mt {
        MeetingType::Sales => "sales".to_string(),
        MeetingType::Service => "service".to_string(),
        MeetingType::Webinar => "webinar".to_string(),
        MeetingType::TeamMeeting => "team_meeting".to_string(),
        MeetingType::Auto => "auto".to_string(),
    })
}

/// Comando Tauri: limpiar cache (útil al iniciar nueva grabación).
#[tauri::command]
pub fn coach_clear_meeting_type_cache() -> Result<(), String> {
    let mut cache = DETECTION_CACHE
        .lock()
        .map_err(|e| format!("Mutex envenenado: {}", e))?;
    cache.clear();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_heuristic_sales() {
        let text = "Hola, te quería mostrar nuestra propuesta. El precio es competitivo y la demo muestra todo el producto.";
        assert_eq!(heuristic_detect(text), Some(MeetingType::Sales));
    }

    #[test]
    fn test_heuristic_service() {
        let text = "Tengo un problema con mi cuenta, no funciona y ya pedí ayuda al soporte pero nada.";
        assert_eq!(heuristic_detect(text), Some(MeetingType::Service));
    }

    #[test]
    fn test_heuristic_webinar() {
        let text = "Bienvenidos al webinar de hoy. Les voy a mostrar la presentación completa.";
        assert_eq!(heuristic_detect(text), Some(MeetingType::Webinar));
    }

    #[test]
    fn test_heuristic_team_meeting() {
        let text = "Buenos días equipo, vamos al daily. ¿Cuáles son sus bloqueos? Actualicen sus tickets en jira.";
        assert_eq!(heuristic_detect(text), Some(MeetingType::TeamMeeting));
    }

    #[test]
    fn test_heuristic_unclear() {
        let text = "Hola cómo estás, qué buen día.";
        assert_eq!(heuristic_detect(text), None);
    }

    #[test]
    fn test_parse_llm_response() {
        assert_eq!(parse_llm_response("sales"), MeetingType::Sales);
        assert_eq!(parse_llm_response("SALES"), MeetingType::Sales);
        assert_eq!(parse_llm_response("venta"), MeetingType::Sales);
        assert_eq!(parse_llm_response("service"), MeetingType::Service);
        assert_eq!(parse_llm_response("webinar"), MeetingType::Webinar);
        assert_eq!(parse_llm_response("team_meeting"), MeetingType::TeamMeeting);
        assert_eq!(parse_llm_response("equipo"), MeetingType::TeamMeeting);
        assert_eq!(parse_llm_response("unknown"), MeetingType::Auto);
    }
}
