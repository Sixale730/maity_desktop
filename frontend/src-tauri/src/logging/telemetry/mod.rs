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
//! - `status`: dominio cerrado de la columna `status` (`TelemetryStatus`),
//!   espejo del CHECK de `docs/platform-logs-status.sql`. El RPC traga la
//!   violación del CHECK y responde 200, así que un literal libre se perdía
//!   en silencio (sep-2026: `stt.*`, `audio.*`, `incident.*` con 0 filas).
//! - `lifecycle`: marcador de ciclo de vida del PROCESO (`lifecycle.json`),
//!   `app.start`/`app.exit`/`app.resumed` (#83, desde 0.2.62). No confundir con
//!   `app.open`/`app.close`, que emite el webview.
//! - `auth`: `auth.logout` desde `logout_cleanup` (outbox + `flush_row` con el
//!   token de quien sale) y, desde S4, `auth.session_lost` (#83).
//!
//! Regla de oro (aprendida del puente `rust_error_bridge`, que desde sep-2026
//! también la cumple): la telemetría nativa NO emite al webview para que otro
//! la suba — WebView2 suspende el JS con la ventana oculta y los eventos se
//! pierden. Outbox + drenadora nativa.

pub mod auth;
pub mod catalog;
pub mod context;
pub mod drain;
pub mod emit;
pub mod lifecycle;
pub mod panics;
pub mod recording_session;
pub mod status;
