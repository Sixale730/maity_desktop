// cloud_sync/mod.rs
//
// Sesión Supabase viva en Rust. El consumidor de `sync_queue` va a correr
// headless (task tokio) porque WebView2 suspende el JS de la ventana oculta en
// el tray, así que Rust necesita su propia copia del par de tokens y su propio
// refresh — no puede depender de que supabase-js esté despierto.
//
// El frontend SIEMBRA la sesión (`cloud_sync_set_session`) y consume el evento
// `cloud-session-refreshed` para mantener a supabase-js en el par nuevo: el
// refresh_token de Supabase ROTA, así que si Rust refresca y no propaga, el
// siguiente refresh del cliente JS daría `invalid_grant` → logout espontáneo.
//
// `executors.rs` tiene las escrituras a PostgREST (espejo del supabase-js de
// `conversations.service.ts`) y `worker.rs` el loop que las orquesta: desde
// jul-2026 Rust es el ÚNICO ejecutor de `sync_queue`. El worker JS quedó
// reducido a un puente de eventos + stuck-watcher + `waitForJobResult`.

pub mod commands;
pub mod executors;
pub mod session;
pub mod worker;

pub use executors::{execute_save_conversation, execute_save_transcript_segments};
pub use session::{
    get_valid_token, CloudSession, CloudSyncState, ERR_NO_SESSION, ERR_SESSION_EXPIRED,
};
