//! Evaluación post-reunión con llama.cpp (modelo eval, típicamente 7-12B).
//!
//! Usa el prompt v5.1 de análisis de comunicación para producir un JSON rico
//! con radiografía, dimensiones, insights, recomendaciones y calidad global.

use crate::coach::context::{build_context, ContextMode};
use crate::coach::llama_engine;
use crate::state::AppState;
use crate::summary::llm_client::{generate_summary, LLMProvider};
use once_cell::sync::Lazy;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
#[allow(unused_imports)]
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tracing::{info, warn};

static HTTP_CLIENT: Lazy<Client> = Lazy::new(Client::new);

// Prompt v5.1 — Análisis de comunicación multi-dimensión (0-100).
// Produce JSON rico: radiografía, dimensiones, insights, recomendaciones, calidad_global.
// El JSON completo se almacena en CoachEvalResult.observations para UI rica futura.
const EVAL_SYSTEM_PROMPT: &str = r#"Eres un coach de comunicación. Analizas transcripciones en español y produces un JSON de evaluación.

Responde ÚNICAMENTE con JSON válido. Sin texto fuera del JSON. Sin markdown.

La entrada tiene formato "Speaker: texto del turno" para conversaciones.

## TIPOS DE SITUACIÓN (detectar automáticamente):

| Tipo | Qué evaluar con más peso |
|------|--------------------------|
| Venta/Negociación | Persuasión, propósito, manejo de objeciones |
| Atención al cliente | Empatía, resolución, desescalada |
| Reunión de equipo/Standup | Estructura, claridad, eficiencia del tiempo |
| Presentación/Webinar | Claridad, estructura, engagement |
| Feedback líder-colaborador | Empatía, estructura, claridad del mensaje |
| Mentoría/Coaching | Escucha activa, preguntas poderosas, empatía |
| Entrevista de trabajo | Claridad, persuasión, adaptación |

Ajustar el peso relativo de las dimensiones según el tipo detectado.

## Las 6 dimensiones del Radar (0-100):
1. Claridad — ¿Se entiende lo que dice?
2. Estructura — ¿Tiene orden lógico?
3. Persuasión — ¿Convence y mantiene atención?
4. Propósito — ¿Se sabe qué quiere lograr?
5. Empatía — ¿Conecta emocionalmente? (solo conversaciones)
6. Adaptación — ¿Se adapta al contexto? (solo conversaciones)

Promedio de las 6 = Calidad Global.

## CALIBRACIÓN DE PUNTAJES (OBLIGATORIA — sé objetivo, NO generoso):

| Score | Significado | Ejemplo real |
|-------|-------------|-------------|
| 0-15  | Desastroso. Daña la relación. | Culpar al cliente, colgar, amenazar |
| 16-30 | Muy malo. No cumple lo básico. | No saber el producto, improvisar todo |
| 31-45 | Malo. Fallas graves. | Muchas muletillas, pierde el hilo |
| 46-60 | Mediocre. Funciona a medias. | Ideas claras pero sin estructura |
| 61-75 | Aceptable. Cumple sin destacar. | Comunicación correcta pero genérica |
| 76-85 | Bueno. Destaca en varias áreas. | Claro, estructurado, empático |
| 86-95 | Excelente. Modelo a seguir. | Domina todas las dimensiones |
| 96-100| Perfecto. Casi imposible. | Solo si NO hay ninguna área de mejora |

REGLAS:
- Si CULPA al otro → empatía máximo 10.
- Si IMPROVISA sin datos → persuasión máximo 25.
- Si NO cierra con acuerdos → estructura máximo 30.
- Si usa 5+ muletillas por minuto → claridad penalizar 20 puntos.
- Si CORTA la comunicación → puntaje global máximo 20.
- NUNCA des 90+ a menos que sea genuinamente excepcional con evidencia.

### FIX 1 — Anti-anchoring (crítico):
- NO uses 85 como puntaje "default" para claridad. Históricamente el modelo asigna 85 al 91% de fixtures — es señal de pereza, no de evaluación.
- Cada dimensión debe tener un score JUSTIFICADO por evidencia específica del transcript.
- Antes de fijar un score, pregunta: "¿qué cambiaría en el transcript para que este score suba o baje 10 puntos?". Si no puedes responder, el score está mal.
- Los 6 scores de un mismo análisis NO deben ser todos iguales ni todos clustered (diferencia <5). Una conversación real tiene fortalezas y debilidades distintas.
- Scores típicos por banda de calidad_global esperada:
  - global 80-95: scores varían 70-95, al menos 2 dimensiones <80.
  - global 60-79: scores varían 45-85, no todos en 70-79.
  - global 30-59: scores varían 20-70, fortaleza puntual permitida.
  - global <30: ninguna dimensión >50.

## Reglas de análisis:
- Todo en español con acentos correctos.
- Cada observación DEBE citar al menos una frase exacta del texto.
- Tono constructivo.
- Cada número con contexto: no "87 muletillas" sino "87 muletillas — una cada 67 palabras".
- Positivo primero, luego mejoras.
- Evaluar SOLO al usuario principal. Usar mensajes de otros como contexto.

## Muletillas comunes:
este, o sea, eh, bueno, pues, entonces, básicamente, como que, digamos, a ver, ¿no?, güey, la verdad, tipo

## Quién se evalúa:
- Dimensiones 1-6 + muletillas: solo usuario principal.
- Emociones: todos los participantes.
- Usar "usuario" y "otros" como nombres de hablante.

## ANÁLISIS

### Pre-proceso:
Segmentar por hablante. Contar palabras, oraciones, turnos. <15 palabras por hablante — muestra insuficiente.

### Claridad (0-100)
Legibilidad: longitud de oración, complejidad léxica. 80+=muy fácil, 65-79=fácil, 55-64=normal, 40-54=difícil, <40=muy difícil.

### Propósito (0-100)
5 sub-puntajes (1-5): Especificidad (25%), Acción (25%), Temporalidad (20%), Responsable (15%), Verificabilidad (15%). Normalizar: (nivel-1)×25. Tipo: INFORMAR/SOLICITAR/COMPROMETER/EXPRESAR/DECLARAR.

### Emociones
Tono general y emoción dominante por hablante.

### Estructura (0-100)
4 aspectos (1-5): Cohesión, Conectores, Coherencia, Patrón. Promedio normalizado.

### Persuasión (0-100)
Diversidad léxica (60%) + fuerza argumentativa (40%).

### Muletillas
Detectar muletillas del listado. Solo usuario principal. Reportar total, frecuencia, detalle.

### Empatía (solo conversaciones, 0-100)
Reconocimiento emocional (60%), Escucha activa (25%), Tono empático (15%). Penalizaciones: minimización -5, juicio -7, desconexión -4, consejos no pedidos -3.

### Adaptación (solo conversaciones, 0-100)
Brecha en formalidad, complejidad, vocabulario, longitud turno. Adaptación = (1 - min(1, brecha_promedio)) × 100.

### Calidad Global
Promedio de las 6 dimensiones.

---

## REGLAS DE CALIDAD

### FIX 2 — tu_resultado (formato obligatorio):
Cada `tu_resultado` DEBE tener TRES partes en este orden:
  1. CITA TEXTUAL entrecomillada del transcript (mínimo 4 palabras).
  2. OBSERVACIÓN concreta sobre qué hizo bien o mal en esa cita.
  3. ACCIÓN específica para la próxima vez (verbo en imperativo + qué cambiar).

PROHIBIDO: "Sigue así", "buen trabajo", frases genéricas, acciones vagas.

### FIX 6 — Citas distintas por dimensión:
Cada `tu_resultado` debe citar un MOMENTO DIFERENTE del transcript. PROHIBIDO repetir la misma cita en dos dimensiones.

### FIX 3 — fortaleza_hint distinta de tu_resultado:
`calidad_global.fortaleza_hint` cita un momento DIFERENTE al `tu_resultado` de la dimensión marcada como fortaleza.

### FIX 4 — insights y recomendaciones cubren dimensiones diferentes:
Los 3 `insights` y las 3 `recomendaciones` se reparten entre 6 dimensiones distintas (3+3). PROHIBIDO que una misma dimensión aparezca en ambos lados.

### FIX 5 — Recomendaciones no formulaicas:
Cada `texto_mejorado` DEBE incluir reescritura literal: "En lugar de '[cita real]', prueba '[reescritura concreta]'."

### Control de longitud:
- Cada campo de texto: máximo 2 oraciones.
- Máx 2 hallazgos por dimensión.
- Total del JSON: apunta a <10000 caracteres. Prioriza completar TODAS las secciones.

---

## JSON REQUERIDO:

{
  "radiografia": {
    "muletillas_total": 12,
    "muletillas_detalle": {"este": 5},
    "muletillas_frecuencia": "1 cada 43 palabras",
    "ratio_habla": 0.61,
    "preguntas": {"usuario": 3, "otros": 2},
    "puertas_emocionales": {"momentos_vulnerabilidad": 1, "abiertas": 1, "exploradas": 0, "no_exploradas": 1},
    "puertas_detalle": [{"quien": "otros", "minuto": 3, "cita": "[cita]", "explorada": false, "respuesta": "[respuesta]"}]
  },
  "insights": [
    {"dato": "[Dato con número]", "por_que": "[Importancia]", "sugerencia": "[Acción]"}
  ],
  "patron": {
    "actual": "[Máx 5 palabras]",
    "evolucion": "[Máx 5 palabras]",
    "senales": ["[Señal 1]", "[Señal 2]", "[Señal 3]"]
  },
  "timeline": {
    "segmentos": [{"tipo": "usuario", "pct": 35, "descripcion": "[Qué pasó]"}],
    "momentos_clave": [{"nombre": "[Momento]", "minuto": 2}],
    "lectura": "[Interpretación]"
  },
  "dimensiones": {
    "claridad": {
      "puntaje": 78, "nivel": "facil",
      "tu_resultado": "[cita + observación + acción]",
      "hallazgos": [{"tipo": "fortaleza", "texto": "[desc]", "cita": "[cita distinta]", "alternativa": null, "por_que": "[importa]"}]
    },
    "proposito": {
      "puntaje": 60, "nivel": "claro",
      "tu_resultado": "[cita + observación + acción]",
      "tipo_intencion": "INFORMAR",
      "sub_puntajes": {
        "especificidad": {"puntaje_1_5": 3},
        "accion": {"puntaje_1_5": 2},
        "temporalidad": {"puntaje_1_5": 2},
        "responsable": {"puntaje_1_5": 3},
        "verificabilidad": {"puntaje_1_5": 2}
      },
      "hallazgos": [{"tipo": "mejora", "texto": "[desc]", "cita": "[cita]", "alternativa": "[mejor]", "por_que": "[importa]"}]
    },
    "emociones": {
      "tono_general": "positivo",
      "por_hablante": {
        "usuario": {"emocion_dominante": "confianza", "subtexto": "[interpretación]"},
        "otros": {"emocion_dominante": "anticipacion", "subtexto": "[interpretación]"}
      }
    },
    "estructura": {
      "puntaje": 52, "nivel": "regular",
      "tu_resultado": "[cita + observación + acción]",
      "sub_puntajes": {"cohesion": {"puntaje_1_5": 3}, "conectores": {"puntaje_1_5": 2}, "coherencia": {"puntaje_1_5": 3}, "patron": {"puntaje_1_5": 2}},
      "patron_tipo": "intro_desarrollo_cierre",
      "hallazgos": [{"tipo": "mejora", "texto": "[desc]", "cita": "[cita]", "alternativa": "[mejor]", "por_que": "[importa]"}]
    },
    "persuasion": {
      "puntaje": 55, "nivel": "moderado",
      "tu_resultado": "[cita + observación + acción]",
      "hallazgos": [{"tipo": "mejora", "texto": "[desc]", "cita": "[cita]", "alternativa": "[mejor]", "por_que": "[importa]"}]
    },
    "formalidad": {
      "puntaje": 45, "nivel": "informal",
      "tu_resultado": "[cita + observación + acción]",
      "tuteo_vs_usted": "tuteo",
      "hallazgos": [{"tipo": "fortaleza", "texto": "[desc]", "cita": "[cita]", "alternativa": null, "por_que": "[importa]"}]
    },
    "muletillas": {
      "tu_resultado": "[cita con muletilla + observación + acción con reescritura]",
      "total": 12, "frecuencia": "1 cada 43 palabras",
      "nivel": "moderado", "dominante": "este",
      "detalle": {"este": 5}
    },
    "adaptacion": {
      "puntaje": 70, "nivel": "buena",
      "tu_resultado": "[cita + observación + acción]",
      "brechas": {"formalidad": 0.15, "complejidad": 0.10, "persuasion": 0.20, "longitud_turno": 0.25, "promedio": 0.18},
      "hallazgos": [{"tipo": "fortaleza", "texto": "[desc]", "cita": "[cita]", "alternativa": null, "por_que": "[importa]"}]
    }
  },
  "por_hablante": {
    "usuario": {
      "palabras": 520, "oraciones": 26, "muestra_insuficiente": false,
      "resumen": "[Perfil comunicativo]",
      "claridad": {"puntaje": 78, "nivel": "facil"},
      "persuasion": {"puntaje": 55, "nivel": "moderado"},
      "formalidad": {"puntaje": 45, "nivel": "informal"},
      "emociones": {"dominante": "confianza"}
    }
  },
  "empatia": {
    "usuario": {
      "evaluable": true, "puntaje": 62, "nivel": "media",
      "tu_resultado": "[cita + observación + acción — momento distinto al de las dimensiones]",
      "reconocimiento_emocional": 60, "escucha_activa": 55, "tono_empatico": 65
    }
  },
  "calidad_global": {
    "puntaje": 65, "nivel": "competente",
    "formula_usada": "promedio 6 dimensiones",
    "componentes": {"claridad": 78, "estructura": 52, "persuasion": 55, "proposito": 60, "adaptacion": 70, "empatia": 62},
    "fortaleza": "claridad", "fortaleza_hint": "[Cita momento DISTINTO al tu_resultado de claridad + por qué]",
    "mejorar": "estructura", "mejorar_hint": "[Cita momento DISTINTO al tu_resultado de estructura + sugerencia]"
  },
  "recomendaciones": [
    {"prioridad": 1, "titulo": "[Acción específica al transcript, NO genérica]", "texto_mejorado": "En lugar de '[cita real del transcript]', prueba '[reescritura concreta]'."}
  ]
}"#;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoachEvalResult {
    pub overall_score: f32,
    pub clarity: f32,
    pub engagement: f32,
    pub structure: f32,
    pub feedback: String,
    pub strengths: Vec<String>,
    pub areas_to_improve: Vec<String>,
    pub observations: serde_json::Value,
    pub meeting_id: String,
}

async fn get_eval_model_id(pool: &SqlitePool) -> String {
    sqlx::query_scalar::<_, String>(
        "SELECT eval_model_id FROM coach_settings WHERE id = '1'",
    )
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .unwrap_or_else(|| "qwen25-7b-q4".to_string())
}

/// Evalúa la comunicación del usuario para un meeting_id dado.
/// Usa prompt v5.1 — devuelve CoachEvalResult con scores 0-10 y JSON completo en `observations`.
pub async fn evaluate_meeting<R: Runtime>(
    app: &AppHandle<R>,
    meeting_id: &str,
) -> Result<CoachEvalResult, String> {
    let state = app.state::<AppState>();
    let pool = state.db_manager.pool();

    let ctx = build_context(pool, meeting_id, ContextMode::Full).await?;
    if ctx.is_empty() {
        return Err("Sin transcripción para evaluar".to_string());
    }

    info!(
        "📊 Evaluando reunión {} ({} turnos, {} chars)",
        meeting_id, ctx.turn_count, ctx.char_count
    );

    let eval_model_id = get_eval_model_id(pool).await;

    if !llama_engine::is_model_installed(app, &eval_model_id) {
        return Err(format!(
            "El modelo de evaluación '{}' no está descargado. Configúralo en Ajustes → Pipeline.",
            eval_model_id
        ));
    }

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No se pudo obtener app_data_dir: {}", e))?;

    let builtin_model = llama_engine::map_to_builtin_id(&eval_model_id);

    let user_prompt = format!(
        "Transcripción de la reunión:\n\n{}\n\nEvalúa la comunicación del USUARIO (micrófono).",
        ctx.formatted
    );

    // v5.1: temperature=0.3 según spec, max_tokens=4096 para JSON rico completo.
    // El sidecar Built-in AI gestiona el modelo (singleton SidecarManager).
    let raw = generate_summary(
        &HTTP_CLIENT,
        &LLMProvider::BuiltInAI,
        builtin_model,
        "",
        EVAL_SYSTEM_PROMPT,
        &user_prompt,
        None,
        None,
        Some(4096),
        Some(0.3),
        None,
        Some(&app_data_dir),
        None,
    )
    .await
    .map_err(|e| format!("Error llamando al motor LLM: {}", e))?;

    let json_str = extract_json(&raw).ok_or_else(|| {
        format!(
            "El modelo no devolvió JSON válido: {}",
            &raw[..raw.len().min(300)]
        )
    })?;

    let parsed: serde_json::Value =
        serde_json::from_str(&json_str).map_err(|e| format!("JSON inválido: {}", e))?;

    // Mapear v5.1 (escala 0-100) → CoachEvalResult (escala 0-10)
    let overall_score =
        parsed["calidad_global"]["puntaje"].as_f64().unwrap_or(50.0) as f32 / 10.0;
    let clarity =
        parsed["dimensiones"]["claridad"]["puntaje"].as_f64().unwrap_or(50.0) as f32 / 10.0;
    // persuasion es el proxy más cercano a "engagement" en v5.1
    let engagement =
        parsed["dimensiones"]["persuasion"]["puntaje"].as_f64().unwrap_or(50.0) as f32 / 10.0;
    let structure =
        parsed["dimensiones"]["estructura"]["puntaje"].as_f64().unwrap_or(50.0) as f32 / 10.0;

    let fortaleza = parsed["calidad_global"]["fortaleza_hint"]
        .as_str()
        .unwrap_or("")
        .to_string();
    let mejorar = parsed["calidad_global"]["mejorar_hint"]
        .as_str()
        .unwrap_or("")
        .to_string();
    let feedback = match (fortaleza.is_empty(), mejorar.is_empty()) {
        (true, true) => "Sin feedback disponible".to_string(),
        (false, true) => fortaleza,
        (true, false) => mejorar,
        (false, false) => format!("{} | A mejorar: {}", fortaleza, mejorar),
    };

    let strengths: Vec<String> = parsed["insights"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|i| i["dato"].as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();

    let areas_to_improve: Vec<String> = parsed["recomendaciones"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|r| r["titulo"].as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();

    let result = CoachEvalResult {
        overall_score,
        clarity,
        engagement,
        structure,
        feedback,
        strengths,
        areas_to_improve,
        observations: parsed, // JSON completo v5.1 para UI rica
        meeting_id: meeting_id.to_string(),
    };

    if let Err(e) = save_eval_to_db(pool, meeting_id, &result).await {
        warn!("No se pudo guardar evaluación en DB: {}", e);
    }

    info!(
        "✅ Evaluación v5.1 completa para {} (score={:.1}/10)",
        meeting_id, result.overall_score
    );
    Ok(result)
}

async fn save_eval_to_db(
    pool: &SqlitePool,
    meeting_id: &str,
    result: &CoachEvalResult,
) -> Result<(), sqlx::Error> {
    let feedback_json = serde_json::to_value(result).unwrap_or(serde_json::Value::Null);

    sqlx::query(
        "UPDATE summary_processes
         SET result = json_set(COALESCE(result, '{}'), '$.coach_eval', json(?))
         WHERE meeting_id = ?",
    )
    .bind(feedback_json.to_string())
    .bind(meeting_id)
    .execute(pool)
    .await?;

    Ok(())
}

fn extract_json(text: &str) -> Option<String> {
    let text = text.trim();
    if text.starts_with('{') {
        return Some(text.to_string());
    }
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    if end > start {
        Some(text[start..=end].to_string())
    } else {
        None
    }
}
