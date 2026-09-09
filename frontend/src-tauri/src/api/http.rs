//! Cliente HTTP compartido para las llamadas de API (Supabase REST/RPC/Auth/
//! Storage, `www.maity.cloud/api/*`, backend local).
//!
//! Hasta sep-2026 cada request construía su propio `reqwest::Client` (#20 de
//! la auditoría de recursos): con `rustls-tls-native-roots`, cada `build()`
//! enumera y parsea el root store de Windows (100-300 certificados) y estrena
//! un pool vacío → 5-30 ms de CPU, ~1 MB transitorio y un handshake TLS
//! completo por request. Un cierre de segmento construía al menos cuatro
//! (refresh de sesión, save_conversation, save_transcript_segments, finalize)
//! más uno por tick del drain de telemetría.
//!
//! Reglas:
//! - `HTTP` lleva un timeout TOTAL de 30 s por request (`DEFAULT_TIMEOUT`).
//!   Un request que necesite más lo pide con `RequestBuilder::timeout`, que
//!   sobreescribe el del cliente SOLO para ese request: `finalize` usa 300 s
//!   porque la nube corre dos LLM síncronos dentro del request y cobra la
//!   cuota antes de responder; `regenerate_minutes` usa 180 s.
//! - NO es para descargas de modelos ni para generación LLM: esas rutas
//!   conservan su propio cliente (perfil de 1 h + `tcp_nodelay` para los
//!   `.onnx`/`.gguf`; sin timeout para Ollama/Gemma). La lista de excepciones
//!   vive en el test `solo_los_sitios_permitidos_construyen_un_client`, que
//!   falla si aparece una construcción nueva fuera de ella.
//! - reqwest cierra las conexiones ociosas del pool a los 90 s
//!   (`pool_idle_timeout` por defecto), así que sostener el cliente vivo no
//!   retiene sockets entre jornadas.

use once_cell::sync::Lazy;
use std::sync::Once;
use std::time::Duration;

/// Timeout total (conexión + respuesta + body) por request del cliente
/// compartido.
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);

/// Fija `ring` como proveedor criptográfico de rustls para TODO el proceso.
/// Idempotente: la segunda llamada no hace nada.
///
/// Es OBLIGATORIO, no defensivo: con `rustls-no-provider` (nuestro reqwest 0.13
/// y sentry ≥0.47) reqwest NO cae al proveedor que resulte de las features del
/// árbol — `Client::build()` hace panic si nadie llamó `install_default()`
/// (verificado con reqwest 0.13.5, `async_impl/client.rs`; así falló el test
/// `el_cliente_compartido_se_construye` al subir de 0.12). tokio-tungstenite y
/// el updater comparten la misma pila rustls 0.23 y se benefician igual.
///
/// Se llama desde `main.rs` antes de `init_sentry()` (sentry construye su
/// transporte en `init`) y desde el `Lazy` de [`HTTP`], que es la primera
/// construcción de cliente en tests y en cualquier binario que use la lib sin
/// pasar por `main`. Los demás sitios de `ALLOWED` (descargas de modelos,
/// Ollama, OpenRouter) sólo corren tras `run()`, o sea después de `main`.
///
/// Por qué `ring` y no `aws-lc-rs`: ring ya está en el árbol (lo exige
/// `tauri-plugin-updater`), aws-lc-rs compila C con cmake/NASM y sería un
/// SEGUNDO proveedor. `install_default` sólo falla si ya había uno instalado,
/// y entonces ese es el que manda.
pub fn install_crypto_provider() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        if rustls::crypto::ring::default_provider().install_default().is_err() {
            log::warn!("rustls: ya había un CryptoProvider instalado; se conserva el existente");
        }
    });
}

/// Cliente HTTP compartido. `reqwest::Client` es un `Arc` por dentro: usarlo
/// desde varias tareas a la vez es lo esperado, no hace falta clonarlo.
pub static HTTP: Lazy<reqwest::Client> = Lazy::new(|| {
    install_crypto_provider();
    reqwest::Client::builder()
        .timeout(DEFAULT_TIMEOUT)
        .build()
        .expect("reqwest::Client: no se pudo inicializar el backend TLS")
});

#[cfg(test)]
mod tests {
    use std::collections::HashSet;
    use std::path::{Path, PathBuf};

    /// Archivos que SÍ pueden construir su propio `reqwest::Client`, y por qué.
    /// Todo lo demás debe usar `crate::api::HTTP`. Si agregas una entrada,
    /// escribe la razón: el punto del test es que la excepción sea deliberada.
    const ALLOWED: &[(&str, &str)] = &[
        ("api/http.rs", "el propio cliente compartido"),
        ("coach/commands.rs", "chat del coach: LLM sin timeout"),
        ("coach/setup.rs", "descarga GGUF con Range, sin timeout"),
        ("summary/service.rs", "resumen local: LLM de minutos, sin timeout"),
        ("summary/summary_engine/model_manager.rs", "descarga GGUF, perfil 1 h + tcp_nodelay"),
        ("parakeet_engine/parakeet_engine.rs", "descarga ONNX, perfil 1 h + tcp_nodelay"),
        ("moonshine_engine/moonshine_engine.rs", "descarga ONNX, perfil 1 h + tcp_nodelay"),
        ("canary_engine/canary_engine.rs", "descarga ONNX, perfil 1 h + tcp_nodelay"),
        ("whisper_engine/whisper_engine.rs", "descarga ggml, sin timeout"),
        ("ollama/ollama.rs", "localhost, timeouts por request (3 s / 600 s / 30 s)"),
        ("ollama/metadata.rs", "localhost, timeout por request de 5 s"),
        ("openrouter/openrouter.rs", "reqwest::blocking, no comparte runtime"),
    ];

    fn rs_files(dir: &Path, out: &mut Vec<PathBuf>) {
        for entry in std::fs::read_dir(dir).expect("read_dir") {
            let path = entry.expect("entry").path();
            if path.is_dir() {
                rs_files(&path, out);
            } else if path.extension().is_some_and(|e| e == "rs") {
                out.push(path);
            }
        }
    }

    /// `Client::new` / `Client::builder` no precedidos por un carácter de
    /// identificador: cubre `reqwest::Client::new()`, el `Client::new()` con
    /// `use reqwest::Client` y `Lazy::new(Client::new)`, sin tropezar con un
    /// hipotético `FooClient::new()`.
    fn constructs_client(src: &str) -> bool {
        ["Client::new", "Client::builder"].iter().any(|needle| {
            src.match_indices(needle).any(|(i, _)| {
                let prev = src[..i].chars().next_back();
                !prev.is_some_and(|c| c.is_alphanumeric() || c == '_')
            })
        })
    }

    #[test]
    fn solo_los_sitios_permitidos_construyen_un_client() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut files = Vec::new();
        rs_files(&root, &mut files);

        let mut offenders = Vec::new();
        let mut seen_allowed: HashSet<String> = HashSet::new();
        for path in &files {
            let rel = path
                .strip_prefix(&root)
                .expect("bajo src/")
                .to_string_lossy()
                .replace('\\', "/");
            let src = std::fs::read_to_string(path).expect("leer .rs");
            if !constructs_client(&src) {
                continue;
            }
            if ALLOWED.iter().any(|(f, _)| *f == rel) {
                seen_allowed.insert(rel);
            } else {
                offenders.push(rel);
            }
        }

        assert!(
            offenders.is_empty(),
            "estos archivos construyen un reqwest::Client propio; usa `crate::api::HTTP` \
             (o agrégalos a ALLOWED con su razón): {:?}",
            offenders
        );

        let stale: Vec<&str> = ALLOWED
            .iter()
            .map(|(f, _)| *f)
            .filter(|f| !seen_allowed.contains(*f))
            .collect();
        assert!(
            stale.is_empty(),
            "entradas de ALLOWED que ya no construyen un Client (quítalas): {:?}",
            stale
        );
    }

    #[test]
    fn el_cliente_compartido_se_construye() {
        let _client: &reqwest::Client = &super::HTTP;
    }
}
