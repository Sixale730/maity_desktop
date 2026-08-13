// cloud_sync/executors.rs
//
// Ejecutores NATIVOS de los jobs de `sync_queue`. Hasta ahora las dos escrituras
// a PostgREST (`omi_conversations`, `omi_transcript_segments`) sólo existían en
// JS (supabase-js, `conversations.service.ts`), así que el consumidor headless
// de Rust no podía correr con la ventana escondida en el tray.
//
// ESPEJO DE CONTRATO — el shape del body está copiado 1:1 de
// `frontend/src/features/conversations/services/conversations.service.ts`
// (`saveConversationToSupabase` ~L1081 y `saveTranscriptSegments` ~L1117).
// Si allá cambia una key, acá cae la fila corrupta en Supabase sin error
// visible; el golden test de este módulo fija el shape para que el drift falle
// ruidosamente en `cargo test`.
//
// Notas de PostgREST que NO son opcionales:
//  - `Content-Profile: maity` — las tablas viven en el schema `maity`, no en
//    `public`. Sin este header el POST va a `public.omi_conversations` y da 404.
//  - `apikey` + `Authorization: Bearer` — el anon key identifica al proyecto y
//    el JWT al usuario (RLS). Faltando cualquiera de los dos: 401.
//  - `Prefer: resolution=merge-duplicates` + `?on_conflict=idempotency_key` es
//    el UPSERT que hace supabase-js con `{ onConflict: 'idempotency_key' }`.
//
// Este módulo NO consume la cola (eso es el loop del commit 4): sólo ejecuta lo
// que se le pide y devuelve errores con los prefijos que el consumidor clasifica.

use log::{error, info, warn};
use serde_json::{Map, Value};
use tauri::{AppHandle, Manager, Runtime};

use super::session::{get_valid_token, CloudSyncState, ERR_NO_SESSION};

/// Cuántos caracteres del cuerpo de error se conservan en el mensaje. Suficiente
/// para ver el `message`/`code` de PostgREST sin inflar `sync_queue.last_error`.
const BODY_SNIPPET_CHARS: usize = 200;

fn snippet(body: &str) -> String {
    body.chars().take(BODY_SNIPPET_CHARS).collect()
}

// ============================================================================
// CLASIFICACIÓN DE ERRORES
// ============================================================================

/// HTTP → prefijo de error. Los mismos prefijos que usa `api/finalize.rs`, que
/// es lo que el consumidor mira para decidir entre reintentar, diferir o marcar
/// el job como permanentemente fallido.
///
/// - `auth:` (401/403) → refrescar sesión / diferir, nunca quemar intentos.
/// - `not_found:` (404) → permanente (schema o fila que no existe).
/// - `validation:` (400/422) → permanente (payload malformado; reintentar no ayuda).
/// - `server:` (5xx) → transitorio.
/// - `unknown:HTTP {status}` → resto (429 incluido: transitorio por defecto).
pub fn classify_http_error(status: reqwest::StatusCode, body: &str, ctx: &str) -> String {
    let detail = snippet(body);
    match status.as_u16() {
        401 | 403 => format!("auth:Sesión rechazada por Supabase en {} ({})", ctx, detail),
        404 => format!("not_found:Recurso no encontrado en {} ({})", ctx, detail),
        400 | 422 => format!("validation:Payload rechazado en {} ({})", ctx, detail),
        s if (500..600).contains(&s) => {
            format!("server:Error del servidor en {} (HTTP {}: {})", ctx, s, detail)
        }
        s => format!("unknown:HTTP {} en {} ({})", s, ctx, detail),
    }
}

/// Errores de transporte (DNS, TLS, timeout, sin red) → siempre `network:`, que
/// el consumidor trata como transitorio con backoff.
fn classify_network_error(e: &reqwest::Error, ctx: &str) -> String {
    format!("network:Error de conexión en {} ({})", ctx, e)
}

// ============================================================================
// CONSTRUCCIÓN DE BODIES (pura, testeable sin HTTP)
// ============================================================================

fn as_object(payload_json: &str, ctx: &str) -> Result<Map<String, Value>, String> {
    let parsed: Value = serde_json::from_str(payload_json)
        .map_err(|e| format!("validation:Payload de {} ilegible ({})", ctx, e))?;
    match parsed {
        Value::Object(map) => Ok(map),
        other => Err(format!(
            "validation:Payload de {} no es un objeto JSON (fue {})",
            ctx,
            kind_of(&other)
        )),
    }
}

fn kind_of(v: &Value) -> &'static str {
    match v {
        Value::Null => "null",
        Value::Bool(_) => "bool",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

/// Campo presente o `null` — espeja el `?? null` del objeto `row` en TS: la key
/// SIEMPRE viaja, aunque valga null (PostgREST distingue "ausente" de "null" al
/// hacer merge del upsert).
fn passthrough(map: &Map<String, Value>, key: &str) -> Value {
    map.get(key).cloned().unwrap_or(Value::Null)
}

/// Body del upsert a `omi_conversations`.
///
/// Espejo exacto del objeto `row` de `saveConversationToSupabase`:
/// 9 keys fijas + `idempotency_key` SÓLO si el payload la trae (en TS es un
/// spread condicional, `...(data.idempotency_key ? {...} : {})`). La diferencia
/// importa: sin key el POST es un INSERT plano, con key es UPSERT sobre su
/// UNIQUE.
pub fn build_conversation_body(payload_json: &str) -> Result<Value, String> {
    let map = as_object(payload_json, "save_conversation")?;

    // `user_id` es el único campo sin default: sin él la fila no pasa RLS y no
    // hay reintento que lo arregle → error permanente de validación.
    let user_id = map
        .get("user_id")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "validation:Payload de save_conversation sin user_id".to_string())?;

    let mut row = Map::new();
    row.insert("user_id".into(), Value::String(user_id.to_string()));
    row.insert("title".into(), passthrough(&map, "title"));
    row.insert("started_at".into(), passthrough(&map, "started_at"));
    row.insert("finished_at".into(), passthrough(&map, "finished_at"));
    row.insert("transcript_text".into(), passthrough(&map, "transcript_text"));
    // `source` es el único con default no-null en TS (`?? 'maity_desktop'`).
    row.insert(
        "source".into(),
        match map.get("source") {
            Some(Value::String(s)) if !s.is_empty() => Value::String(s.clone()),
            _ => Value::String("maity_desktop".to_string()),
        },
    );
    row.insert("language".into(), passthrough(&map, "language"));
    row.insert("words_count".into(), passthrough(&map, "words_count"));
    row.insert("duration_seconds".into(), passthrough(&map, "duration_seconds"));

    if let Some(key) = map
        .get("idempotency_key")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
    {
        row.insert("idempotency_key".into(), Value::String(key.to_string()));
    }

    Ok(Value::Object(row))
}

/// Filas del INSERT a `omi_transcript_segments`.
///
/// El payload del job NO trae `conversation_id` (cuando se encoló, la
/// conversación todavía no existía en la nube): lo inyecta el consumidor con el
/// id que devolvió el job padre `save_conversation`, exactamente como hace
/// `executeSaveTranscriptSegments` en `cloudSyncWorker.ts` leyendo el
/// `result_data` de la dependencia. `user_id` sí viene del payload.
pub fn build_segment_rows(conversation_id: &str, payload_json: &str) -> Result<Value, String> {
    if conversation_id.is_empty() {
        return Err(
            "validation:save_transcript_segments sin conversation_id de la dependencia".to_string(),
        );
    }

    let map = as_object(payload_json, "save_transcript_segments")?;

    let user_id = map
        .get("user_id")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "validation:Payload de save_transcript_segments sin user_id".to_string())?;

    let segments = map
        .get("segments")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            "validation:Payload de save_transcript_segments sin arreglo `segments`".to_string()
        })?;

    let mut rows = Vec::with_capacity(segments.len());
    for (i, seg) in segments.iter().enumerate() {
        let seg = seg.as_object().ok_or_else(|| {
            format!(
                "validation:El segmento {} de save_transcript_segments no es un objeto",
                i
            )
        })?;

        let mut row = Map::new();
        row.insert("conversation_id".into(), Value::String(conversation_id.to_string()));
        row.insert("user_id".into(), Value::String(user_id.to_string()));
        row.insert("segment_index".into(), passthrough(seg, "segment_index"));
        row.insert("text".into(), passthrough(seg, "text"));
        row.insert("speaker".into(), passthrough(seg, "speaker"));
        row.insert("speaker_id".into(), passthrough(seg, "speaker_id"));
        row.insert("is_user".into(), passthrough(seg, "is_user"));
        row.insert("start_time".into(), passthrough(seg, "start_time"));
        row.insert("end_time".into(), passthrough(seg, "end_time"));
        rows.push(Value::Object(row));
    }

    Ok(Value::Array(rows))
}

/// `id` de la conversación desde la respuesta `return=representation`.
/// PostgREST devuelve un arreglo de filas; supabase-js lo colapsa con
/// `.single()`. Tolera también un objeto suelto por si el `Accept` cambia.
pub fn extract_conversation_id(body: &Value) -> Result<String, String> {
    let row = match body {
        Value::Array(rows) => rows.first().ok_or_else(|| {
            "server:save_conversation devolvió una representación vacía".to_string()
        })?,
        other => other,
    };

    row.get("id")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .ok_or_else(|| "server:save_conversation devolvió una fila sin `id`".to_string())
}

// ============================================================================
// EJECUTORES (HTTP)
// ============================================================================

/// Snapshot de la sesión + token válido (refrescándolo si toca). El refresh lo
/// serializa `get_valid_token`; acá NUNCA se toca el refresh_token a mano.
async fn auth_context<R: Runtime>(app: &AppHandle<R>) -> Result<(String, String, String), String> {
    let session = {
        let state = app.state::<CloudSyncState>();
        state.snapshot().await
    }
    .ok_or_else(|| ERR_NO_SESSION.to_string())?;

    let token = get_valid_token(app).await?;
    Ok((
        session.supabase_url.trim_end_matches('/').to_string(),
        session.anon_key,
        token,
    ))
}

/// Job `save_conversation`: UPSERT en `maity.omi_conversations`.
/// Devuelve el `conversation_id` que el job hijo (segmentos) necesita.
pub async fn execute_save_conversation<R: Runtime>(
    app: &AppHandle<R>,
    payload_json: &str,
) -> Result<String, String> {
    let body = build_conversation_body(payload_json)?;
    let has_idempotency_key = body.get("idempotency_key").is_some();

    let (base_url, anon_key, token) = auth_context(app).await?;

    // Con idempotency_key → UPSERT (un reintento colapsa sobre la fila original
    // y devuelve su id). Sin ella → INSERT plano, igual que la rama `insert()`
    // del TS.
    let (url, prefer) = if has_idempotency_key {
        (
            format!(
                "{}/rest/v1/omi_conversations?on_conflict=idempotency_key&select=id",
                base_url
            ),
            "resolution=merge-duplicates,return=representation",
        )
    } else {
        (
            format!("{}/rest/v1/omi_conversations?select=id", base_url),
            "return=representation",
        )
    };

    let response = reqwest::Client::new()
        .post(&url)
        .header("apikey", anon_key.as_str())
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "application/json")
        .header("Content-Profile", "maity")
        .header("Prefer", prefer)
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            warn!("cloud_sync: red caída en save_conversation: {}", e);
            classify_network_error(&e, "save_conversation")
        })?;

    let status = response.status();
    let text = response.text().await.unwrap_or_default();

    if !status.is_success() {
        let err = classify_http_error(status, &text, "save_conversation");
        error!("cloud_sync: save_conversation falló ({}): {}", status, err);
        return Err(err);
    }

    let parsed: Value = serde_json::from_str(&text).map_err(|e| {
        error!("cloud_sync: representación ilegible de save_conversation: {}", e);
        format!(
            "server:Respuesta de save_conversation inválida ({}: {})",
            e,
            snippet(&text)
        )
    })?;

    let conversation_id = extract_conversation_id(&parsed)?;
    info!("cloud_sync: save_conversation ok → {}", conversation_id);
    Ok(conversation_id)
}

/// Job `save_transcript_segments`: INSERT en bloque en
/// `maity.omi_transcript_segments`. `Prefer: return=minimal` porque no
/// necesitamos las filas de vuelta (espejo del `.insert(rows)` sin `.select()`).
///
/// `conversation_id` lo pasa el consumidor desde el `result_data` del job padre.
pub async fn execute_save_transcript_segments<R: Runtime>(
    app: &AppHandle<R>,
    conversation_id: &str,
    payload_json: &str,
) -> Result<(), String> {
    let rows = build_segment_rows(conversation_id, payload_json)?;

    // Espeja el early-return `if (segments.length === 0) return;` del TS: sin
    // filas, PostgREST devolvería 400 por body vacío.
    let count = rows.as_array().map(|r| r.len()).unwrap_or(0);
    if count == 0 {
        info!(
            "cloud_sync: save_transcript_segments sin segmentos para {} (no-op)",
            conversation_id
        );
        return Ok(());
    }

    let (base_url, anon_key, token) = auth_context(app).await?;
    let url = format!("{}/rest/v1/omi_transcript_segments", base_url);

    let response = reqwest::Client::new()
        .post(&url)
        .header("apikey", anon_key.as_str())
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "application/json")
        .header("Content-Profile", "maity")
        .header("Prefer", "return=minimal")
        .json(&rows)
        .send()
        .await
        .map_err(|e| {
            warn!("cloud_sync: red caída en save_transcript_segments: {}", e);
            classify_network_error(&e, "save_transcript_segments")
        })?;

    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        let err = classify_http_error(status, &text, "save_transcript_segments");
        error!(
            "cloud_sync: save_transcript_segments falló ({}): {}",
            status, err
        );
        return Err(err);
    }

    info!(
        "cloud_sync: save_transcript_segments ok ({} segmentos → {})",
        count, conversation_id
    );
    Ok(())
}

// ============================================================================
// TESTS — golden del shape (sin red)
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    /// Payload de `save_conversation` tal cual lo produce `enqueue_cloud_sync_jobs`
    /// (`scheduled_recording/service.rs`) y `useRecordingStop.ts`. Mismo fixture
    /// que el golden test del productor.
    fn conversation_payload() -> String {
        serde_json::json!({
            "user_id": "user-test",
            "title": "Segmento de prueba",
            "started_at": "2026-01-01T00:00:00+00:00",
            "finished_at": "2026-01-01T00:00:08+00:00",
            "transcript_text": "Usuario: hola mundo\nInterlocutor: que tal",
            "source": "maity_desktop",
            "language": "es",
            "words_count": 4,
            "duration_seconds": 8,
            "idempotency_key": "idem-abc",
        })
        .to_string()
    }

    fn segments_payload() -> String {
        serde_json::json!({
            "user_id": "user-test",
            "segments": [
                {
                    "segment_index": 1,
                    "text": "hola mundo",
                    "speaker": "user",
                    "speaker_id": 0,
                    "is_user": true,
                    "start_time": 1.0,
                    "end_time": 3.0,
                },
                {
                    "segment_index": 2,
                    "text": "que tal",
                    "speaker": "interlocutor",
                    "speaker_id": 1,
                    "is_user": false,
                    "start_time": 5.0,
                    "end_time": 7.5,
                }
            ],
        })
        .to_string()
    }

    fn keys(v: &Value) -> std::collections::BTreeSet<String> {
        v.as_object().expect("objeto JSON").keys().cloned().collect()
    }

    fn expected_keys(list: &[&str]) -> std::collections::BTreeSet<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn conversation_body_espeja_el_row_de_supabase_js() {
        let body = build_conversation_body(&conversation_payload()).expect("body");

        // Las 10 keys exactas del objeto `row` de saveConversationToSupabase.
        assert_eq!(
            keys(&body),
            expected_keys(&[
                "user_id",
                "title",
                "started_at",
                "finished_at",
                "transcript_text",
                "source",
                "language",
                "words_count",
                "duration_seconds",
                "idempotency_key",
            ]),
            "el body del upsert debe espejar conversations.service.ts 1:1"
        );

        assert_eq!(body["user_id"], "user-test");
        assert_eq!(body["title"], "Segmento de prueba");
        assert_eq!(body["source"], "maity_desktop");
        assert_eq!(body["language"], "es");
        assert_eq!(body["words_count"], 4);
        assert_eq!(body["duration_seconds"], 8);
        assert_eq!(body["idempotency_key"], "idem-abc");
        assert_eq!(
            body["transcript_text"],
            "Usuario: hola mundo\nInterlocutor: que tal"
        );
    }

    #[test]
    fn conversation_body_sin_idempotency_key_omite_la_key() {
        // El TS usa spread condicional: sin key, la propiedad NO viaja (y el
        // POST deja de ser upsert). Un `null` acá rompería el INSERT plano.
        let payload = serde_json::json!({
            "user_id": "user-test",
            "title": null,
            "started_at": "2026-01-01T00:00:00Z",
            "finished_at": "2026-01-01T00:00:08Z",
            "transcript_text": "",
            "language": null,
            "words_count": null,
            "duration_seconds": null,
        })
        .to_string();

        let body = build_conversation_body(&payload).expect("body");
        assert_eq!(
            keys(&body),
            expected_keys(&[
                "user_id",
                "title",
                "started_at",
                "finished_at",
                "transcript_text",
                "source",
                "language",
                "words_count",
                "duration_seconds",
            ])
        );
        assert!(body.get("idempotency_key").is_none());
        // Los opcionales viajan como null explícito (igual que el `?? null`).
        assert!(body["title"].is_null());
        assert!(body["words_count"].is_null());
        // `source` es el único con default no-null.
        assert_eq!(body["source"], "maity_desktop");
    }

    #[test]
    fn conversation_body_sin_user_id_es_validation() {
        let err = build_conversation_body(r#"{"title":"x"}"#).unwrap_err();
        assert!(err.starts_with("validation:"), "fue: {}", err);
    }

    #[test]
    fn payload_ilegible_es_validation() {
        let err = build_conversation_body("no-json").unwrap_err();
        assert!(err.starts_with("validation:"), "fue: {}", err);
        let err = build_segment_rows("conv-1", "[1,2,3]").unwrap_err();
        assert!(err.starts_with("validation:"), "fue: {}", err);
    }

    #[test]
    fn segment_rows_espejan_el_map_de_supabase_js() {
        let rows = build_segment_rows("conv-1", &segments_payload()).expect("rows");
        let rows = rows.as_array().expect("arreglo de filas");
        assert_eq!(rows.len(), 2);

        assert_eq!(
            keys(&rows[0]),
            expected_keys(&[
                "conversation_id",
                "user_id",
                "segment_index",
                "text",
                "speaker",
                "speaker_id",
                "is_user",
                "start_time",
                "end_time",
            ]),
            "cada fila de segmento debe espejar conversations.service.ts 1:1"
        );

        // conversation_id NO viene del payload: lo inyecta la dependencia.
        assert_eq!(rows[0]["conversation_id"], "conv-1");
        assert_eq!(rows[1]["conversation_id"], "conv-1");
        assert_eq!(rows[0]["user_id"], "user-test");
        assert_eq!(rows[0]["segment_index"], 1);
        assert_eq!(rows[0]["text"], "hola mundo");
        assert_eq!(rows[0]["speaker"], "user");
        assert_eq!(rows[0]["speaker_id"], 0);
        assert_eq!(rows[0]["is_user"], true);
        assert_eq!(rows[0]["start_time"], 1.0);
        assert_eq!(rows[0]["end_time"], 3.0);
        assert_eq!(rows[1]["speaker"], "interlocutor");
        assert_eq!(rows[1]["is_user"], false);
    }

    #[test]
    fn segment_rows_exigen_conversation_id() {
        let err = build_segment_rows("", &segments_payload()).unwrap_err();
        assert!(err.starts_with("validation:"), "fue: {}", err);
    }

    #[test]
    fn segment_rows_vacios_producen_arreglo_vacio() {
        let payload = serde_json::json!({ "user_id": "u", "segments": [] }).to_string();
        let rows = build_segment_rows("conv-1", &payload).expect("rows");
        assert_eq!(rows.as_array().unwrap().len(), 0);
    }

    #[test]
    fn extrae_id_de_la_representacion() {
        let arr = serde_json::json!([{ "id": "conv-9" }]);
        assert_eq!(extract_conversation_id(&arr).unwrap(), "conv-9");
        // Objeto suelto (defensa por si cambia el Accept).
        let obj = serde_json::json!({ "id": "conv-9" });
        assert_eq!(extract_conversation_id(&obj).unwrap(), "conv-9");
        // Vacío o sin id → server: (transitorio, no corrompe la cadena).
        assert!(extract_conversation_id(&serde_json::json!([]))
            .unwrap_err()
            .starts_with("server:"));
        assert!(extract_conversation_id(&serde_json::json!([{}]))
            .unwrap_err()
            .starts_with("server:"));
    }

    #[test]
    fn clasificacion_http_usa_los_prefijos_del_codebase() {
        use reqwest::StatusCode;
        let ctx = "save_conversation";
        assert!(classify_http_error(StatusCode::UNAUTHORIZED, "", ctx).starts_with("auth:"));
        assert!(classify_http_error(StatusCode::FORBIDDEN, "", ctx).starts_with("auth:"));
        assert!(classify_http_error(StatusCode::NOT_FOUND, "", ctx).starts_with("not_found:"));
        assert!(classify_http_error(StatusCode::BAD_REQUEST, "", ctx).starts_with("validation:"));
        assert!(classify_http_error(StatusCode::UNPROCESSABLE_ENTITY, "", ctx)
            .starts_with("validation:"));
        assert!(
            classify_http_error(StatusCode::INTERNAL_SERVER_ERROR, "", ctx).starts_with("server:")
        );
        assert!(classify_http_error(StatusCode::BAD_GATEWAY, "", ctx).starts_with("server:"));
        assert!(classify_http_error(StatusCode::TOO_MANY_REQUESTS, "", ctx).starts_with("unknown:"));
    }

    #[test]
    fn el_cuerpo_del_error_se_trunca() {
        let long_body = "x".repeat(5_000);
        let msg = classify_http_error(reqwest::StatusCode::BAD_REQUEST, &long_body, "ctx");
        assert!(
            msg.len() < 400,
            "last_error no debe inflarse con el body completo (len={})",
            msg.len()
        );
        assert!(msg.contains(&"x".repeat(BODY_SNIPPET_CHARS)));
    }
}
