// cloud_sync/session.rs
//
// Estado de sesión Supabase en Rust + refresh propio.
//
// Reglas de este módulo:
//  - `user_id` es el **maity.users.id** (schema `maity`), NO el `auth.users.id`.
//    Es el mismo id que se siembra con `set_current_user` y con el que están
//    escritos los jobs de `sync_queue` (ver memoria del repo: usar `user.id`
//    contra el schema `maity` es un bug silencioso).
//  - `CloudSyncState` se `manage`a POR SEPARADO de `AppState`: `AppState` se
//    re-`manage`a en `database/commands.rs` y la sesión se perdería.
//  - Locks: `tokio::sync` con `.await`, nunca `.unwrap()` sobre el guard.

use std::sync::Arc;

use log::{debug, error, info, warn};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::sync::{Mutex, Notify, RwLock};

use crate::events;

/// Margen antes de la expiración real a partir del cual ya refrescamos. Con 2
/// minutos, un job que empieza justo en el borde no se queda sin token a mitad
/// del POST (el finalize puede tardar minutos, pero valida el JWT al entrar).
pub const REFRESH_MARGIN_SECS: i64 = 120;

/// Vida asumida de un access_token cuando la respuesta no trae ni `expires_at`
/// ni `expires_in` (Supabase manda ambos; esto es defensa).
const DEFAULT_TOKEN_TTL_SECS: i64 = 3600;

/// No hay sesión sembrada (nunca hubo login, o se hizo logout). El consumidor
/// debe DIFERIR el job, no quemarle intentos.
pub const ERR_NO_SESSION: &str = "auth:no_session";
/// El refresh_token ya no sirve (`invalid_grant`). La sesión quedó limpia.
pub const ERR_SESSION_EXPIRED: &str = "auth:session_expired";

// ============================================================================
// TIPOS
// ============================================================================

/// Copia de la sesión Supabase que Rust necesita para hablar con PostgREST y
/// con el endpoint de finalize sin depender del webview.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudSession {
    pub supabase_url: String,
    pub anon_key: String,
    pub access_token: String,
    pub refresh_token: String,
    /// Expiración del access_token en epoch **segundos** (no ms).
    pub expires_at: i64,
    /// `maity.users.id` — NO el `auth.users.id`.
    pub user_id: String,
}

/// Estado manejado por Tauri (`app.manage`) con la sesión y el despertador del
/// loop consumidor (commit 4).
pub struct CloudSyncState {
    pub session: Arc<RwLock<Option<CloudSession>>>,
    /// Lo dispara `cloud_sync_nudge` / la siembra de sesión para que el loop no
    /// espere el tick de 5 s cuando acaba de encolarse algo.
    pub notify: Arc<Notify>,
    /// Serializa los refresh: si dos tareas ven el token vencido a la vez, la
    /// segunda espera y reusa el par nuevo en vez de quemar el refresh_token
    /// (que rota en cada uso) con una segunda llamada.
    refresh_lock: Arc<Mutex<()>>,
}

impl CloudSyncState {
    pub fn new() -> Self {
        Self {
            session: Arc::new(RwLock::new(None)),
            notify: Arc::new(Notify::new()),
            refresh_lock: Arc::new(Mutex::new(())),
        }
    }

    /// Reemplaza la sesión completa (siembra desde el frontend).
    pub async fn set_session(&self, session: CloudSession) {
        let mut guard = self.session.write().await;
        *guard = Some(session);
    }

    /// Borra la sesión (logout). El consumidor pasa a diferir jobs.
    pub async fn clear_session(&self) {
        let mut guard = self.session.write().await;
        *guard = None;
    }

    /// `maity.users.id` de la sesión viva, si hay.
    pub async fn user_id(&self) -> Option<String> {
        self.session.read().await.as_ref().map(|s| s.user_id.clone())
    }

    /// Snapshot de la sesión (para leer url/anon key sin tocar el lock dos veces).
    pub async fn snapshot(&self) -> Option<CloudSession> {
        self.session.read().await.clone()
    }
}

impl Default for CloudSyncState {
    fn default() -> Self {
        Self::new()
    }
}

/// Respuesta de `POST /auth/v1/token?grant_type=refresh_token`.
#[derive(Debug, Deserialize)]
struct RefreshResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: String,
    /// Segundos de vida del nuevo access_token.
    #[serde(default)]
    expires_in: Option<i64>,
    /// Epoch absoluto; Supabase lo manda, pero no está garantizado por spec.
    #[serde(default)]
    expires_at: Option<i64>,
}

// ============================================================================
// LÓGICA PURA (testeable sin HTTP)
// ============================================================================

/// Qué hacer con el access_token que tenemos en mano.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenAction {
    /// Queda margen de sobra: se usa tal cual.
    Reuse,
    /// Vencido o a punto de vencer: hay que refrescar antes de usarlo.
    Refresh,
}

/// Decisión de refresh. Aislada de `AppHandle`/HTTP a propósito para poder
/// testear el borde sin reloj real ni red.
pub fn decide_token_action(expires_at: i64, now: i64) -> TokenAction {
    if expires_at - now > REFRESH_MARGIN_SECS {
        TokenAction::Reuse
    } else {
        TokenAction::Refresh
    }
}

/// Expiración efectiva del par nuevo: preferimos el `expires_at` absoluto de la
/// respuesta; si no viene, lo derivamos del `expires_in` relativo.
pub fn resolve_expires_at(expires_at: Option<i64>, expires_in: Option<i64>, now: i64) -> i64 {
    match expires_at {
        Some(at) if at > 0 => at,
        _ => now + expires_in.unwrap_or(DEFAULT_TOKEN_TTL_SECS),
    }
}

fn now_epoch() -> i64 {
    chrono::Utc::now().timestamp()
}

// ============================================================================
// API PÚBLICA
// ============================================================================

/// Devuelve un access_token utilizable, refrescándolo si hace falta.
///
/// Errores con prefijo estable para que el consumidor los clasifique:
/// `auth:no_session`, `auth:session_expired`, `network:…`, `server:…`.
pub async fn get_valid_token<R: Runtime>(app: &AppHandle<R>) -> Result<String, String> {
    let (session_arc, refresh_lock) = {
        let state = app.state::<CloudSyncState>();
        (state.session.clone(), state.refresh_lock.clone())
    };

    // Camino rápido: token con margen suficiente, sin tomar el lock de refresh.
    {
        let guard = session_arc.read().await;
        let current = guard.as_ref().ok_or_else(|| ERR_NO_SESSION.to_string())?;
        if decide_token_action(current.expires_at, now_epoch()) == TokenAction::Reuse {
            return Ok(current.access_token.clone());
        }
    }

    // Serializado: el segundo llamador espera aquí y sale por el doble chequeo
    // con el token que refrescó el primero.
    let _refresh_guard = refresh_lock.lock().await;

    let snapshot = {
        let guard = session_arc.read().await;
        let current = guard.as_ref().ok_or_else(|| ERR_NO_SESSION.to_string())?;
        if decide_token_action(current.expires_at, now_epoch()) == TokenAction::Reuse {
            debug!("cloud_sync: refresh ya hecho por otra tarea, reusando token");
            return Ok(current.access_token.clone());
        }
        current.clone()
    };

    refresh(app, &session_arc, &snapshot).await
}

/// Refresca contra Supabase y persiste el par nuevo. Asume el `refresh_lock`
/// tomado por el llamador.
async fn refresh<R: Runtime>(
    app: &AppHandle<R>,
    session_arc: &Arc<RwLock<Option<CloudSession>>>,
    current: &CloudSession,
) -> Result<String, String> {
    let endpoint = format!(
        "{}/auth/v1/token?grant_type=refresh_token",
        current.supabase_url.trim_end_matches('/')
    );
    info!("cloud_sync: refrescando sesión Supabase (headless)");

    let response = reqwest::Client::new()
        .post(&endpoint)
        .header("apikey", current.anon_key.as_str())
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({ "refresh_token": current.refresh_token }))
        .send()
        .await
        .map_err(|e| {
            warn!("cloud_sync: error de red al refrescar la sesión: {}", e);
            format!("network:Error de red al refrescar la sesión ({})", e)
        })?;

    let status = response.status();

    // 400/401 = `invalid_grant`: el refresh_token ya se usó o fue revocado. No
    // hay reintento posible; se limpia y se avisa al frontend.
    if status == reqwest::StatusCode::BAD_REQUEST || status == reqwest::StatusCode::UNAUTHORIZED {
        let body = response.text().await.unwrap_or_default();
        warn!(
            "cloud_sync: refresh rechazado ({}): {}",
            status,
            body.chars().take(200).collect::<String>()
        );
        {
            let mut guard = session_arc.write().await;
            *guard = None;
        }
        if let Err(e) = app.emit(events::CLOUD_SESSION_EXPIRED, serde_json::json!({})) {
            warn!("cloud_sync: no se pudo emitir cloud-session-expired: {}", e);
        }
        return Err(ERR_SESSION_EXPIRED.to_string());
    }

    // Cualquier otro fallo es transitorio: NO se limpia la sesión.
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        error!(
            "cloud_sync: refresh falló con {}: {}",
            status,
            body.chars().take(200).collect::<String>()
        );
        return Err(format!("server:Refresh de sesión falló (HTTP {})", status));
    }

    let parsed: RefreshResponse = response.json().await.map_err(|e| {
        error!("cloud_sync: respuesta de refresh ilegible: {}", e);
        format!("server:Respuesta de refresh inválida: {}", e)
    })?;

    let expires_at = resolve_expires_at(parsed.expires_at, parsed.expires_in, now_epoch());
    let access_token = parsed.access_token;
    let refresh_token = if parsed.refresh_token.is_empty() {
        current.refresh_token.clone()
    } else {
        parsed.refresh_token
    };

    {
        let mut guard = session_arc.write().await;
        match guard.as_mut() {
            Some(stored) => {
                stored.access_token = access_token.clone();
                stored.refresh_token = refresh_token.clone();
                stored.expires_at = expires_at;
            }
            // Hubo logout mientras la petición estaba en vuelo: no resucitar.
            None => {
                warn!("cloud_sync: sesión limpiada durante el refresh; se descarta el par nuevo");
                return Err(ERR_NO_SESSION.to_string());
            }
        }
    }

    // Propagar a supabase-js: su refresh_token quedó rotado y sin este evento
    // el cliente JS haría `invalid_grant` en su próximo refresh.
    if let Err(e) = app.emit(
        events::CLOUD_SESSION_REFRESHED,
        serde_json::json!({
            "accessToken": access_token,
            "refreshToken": refresh_token,
            "expiresAt": expires_at,
        }),
    ) {
        warn!("cloud_sync: no se pudo emitir cloud-session-refreshed: {}", e);
    }

    info!("cloud_sync: sesión refrescada (expira en {}s)", expires_at - now_epoch());
    Ok(access_token)
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_760_000_000;

    #[test]
    fn reusa_token_con_margen_de_sobra() {
        // Media hora de vida por delante: ni tocar el refresh_token.
        assert_eq!(
            decide_token_action(NOW + 1800, NOW),
            TokenAction::Reuse
        );
    }

    #[test]
    fn refresca_dentro_del_margen_y_en_el_borde() {
        // Justo fuera del margen → todavía se reusa.
        assert_eq!(
            decide_token_action(NOW + REFRESH_MARGIN_SECS + 1, NOW),
            TokenAction::Reuse
        );
        // Exactamente en el margen → ya se refresca (el predicado es `>`).
        assert_eq!(
            decide_token_action(NOW + REFRESH_MARGIN_SECS, NOW),
            TokenAction::Refresh
        );
        assert_eq!(decide_token_action(NOW + 30, NOW), TokenAction::Refresh);
    }

    #[test]
    fn refresca_token_ya_vencido() {
        assert_eq!(decide_token_action(NOW - 1, NOW), TokenAction::Refresh);
        // Sesión vieja de una jornada larga con la ventana oculta.
        assert_eq!(decide_token_action(NOW - 7200, NOW), TokenAction::Refresh);
    }

    #[test]
    fn expires_at_absoluto_gana_sobre_expires_in() {
        assert_eq!(
            resolve_expires_at(Some(NOW + 900), Some(3600), NOW),
            NOW + 900
        );
    }

    #[test]
    fn expires_at_se_deriva_de_expires_in_y_del_default() {
        assert_eq!(resolve_expires_at(None, Some(3600), NOW), NOW + 3600);
        // Sin ninguno de los dos campos: TTL por defecto, nunca 0 (un 0 haría
        // que get_valid_token refrescara en bucle).
        assert_eq!(
            resolve_expires_at(None, None, NOW),
            NOW + DEFAULT_TOKEN_TTL_SECS
        );
        // `expires_at: 0` se trata como ausente.
        assert_eq!(resolve_expires_at(Some(0), Some(600), NOW), NOW + 600);
    }
}
