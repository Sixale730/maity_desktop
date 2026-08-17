//! Contrato de telemetría nativo (ciclo fail-closed, bloque G).
//!
//! Fuente única de la identidad de los eventos que terminan en
//! `maity.platform_logs`:
//!
//! - `context`: `install_id` persistente (UUID v4 en `telemetry.json`),
//!   `session_id` de PROCESO (uno por arranque, compartido por todas las
//!   ventanas) y `app_version` de `package_info()` — jamás `'unknown'`.
//! - `emit`: escritura al outbox durable (`recording_logs`) con el envelope
//!   `ctx` inyectado. Cero red en el camino caliente; la red es asunto de la
//!   drenadora (`drain`), que es la ÚNICA que postea el outbox a Supabase.
//!
//! Regla de oro (aprendida del puente `rust_error_bridge`): la telemetría
//! nativa NO emite al webview para que otro la suba — WebView2 suspende el JS
//! con la ventana oculta y los eventos se pierden. Outbox + drenadora nativa.

pub mod catalog;
pub mod context;
pub mod drain;
pub mod emit;
pub mod recording_session;
