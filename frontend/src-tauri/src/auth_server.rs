use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Runtime};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

const OAUTH_CALLBACK_PORT: u16 = 17823;
const SERVER_TIMEOUT_SECS: u64 = 300; // 5 minutes

static SERVER_RUNNING: AtomicBool = AtomicBool::new(false);

/// HTML page served at GET /auth/callback.
/// JavaScript extracts tokens from the URL fragment and POSTs them back.
const CALLBACK_HTML: &str = r#"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Maity – Sign In</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
       background:#111827;color:#f9fafb;display:flex;align-items:center;
       justify-content:center;height:100vh}
  .card{text-align:center;padding:3rem;border-radius:1rem;
        background:#1f2937;max-width:420px;width:90%}
  h1{font-size:1.5rem;margin-bottom:.75rem}
  p{color:#9ca3af;margin-bottom:1rem}
  .spinner{width:40px;height:40px;margin:0 auto 1.5rem;
           border:4px solid #374151;border-top-color:#3b82f6;
           border-radius:50%;animation:spin .8s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  .success{color:#34d399}
  .error{color:#f87171}
</style>
</head>
<body>
<div class="card">
  <div class="spinner" id="spinner"></div>
  <h1 id="title">Signing you in...</h1>
  <p id="message">Please wait while we complete authentication.</p>
</div>
<script>
(function(){
  var hash = window.location.hash.substring(1);
  if(!hash){
    document.getElementById('spinner').style.display='none';
    document.getElementById('title').textContent='Sign-in failed';
    document.getElementById('title').className='error';
    document.getElementById('message').textContent='No authentication data received. Please try again from the app.';
    return;
  }
  var params = new URLSearchParams(hash);
  var accessToken = params.get('access_token');
  var refreshToken = params.get('refresh_token');
  if(!accessToken || !refreshToken){
    document.getElementById('spinner').style.display='none';
    document.getElementById('title').textContent='Sign-in failed';
    document.getElementById('title').className='error';
    document.getElementById('message').textContent='Missing authentication tokens. Please try again from the app.';
    return;
  }
  fetch('http://127.0.0.1:OAUTH_PORT/auth/tokens',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({access_token:accessToken,refresh_token:refreshToken})
  }).then(function(r){
    if(r.ok){
      document.getElementById('spinner').style.display='none';
      document.getElementById('title').textContent='Sign-in successful!';
      document.getElementById('title').className='success';
      document.getElementById('message').textContent='You can close this tab and return to Maity.';
    } else {
      throw new Error('Server returned '+r.status);
    }
  }).catch(function(e){
    document.getElementById('spinner').style.display='none';
    document.getElementById('title').textContent='Sign-in failed';
    document.getElementById('title').className='error';
    document.getElementById('message').textContent='Could not complete sign-in: '+e.message;
  });
})();
</script>
</body>
</html>"#;

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
struct AuthTokens {
    access_token: String,
    refresh_token: String,
}

#[derive(serde::Serialize, Clone, Debug)]
struct AuthCode {
    code: String,
}

/// Start the OAuth callback server. Returns the port number.
/// Idempotent: if the server is already running, returns Ok(port) immediately.
#[tauri::command]
pub async fn start_oauth_server<R: Runtime>(app: AppHandle<R>) -> Result<u16, String> {
    if SERVER_RUNNING.load(Ordering::SeqCst) {
        log::info!("[AuthServer] Server already running on port {}", OAUTH_CALLBACK_PORT);
        return Ok(OAUTH_CALLBACK_PORT);
    }

    let addr = format!("127.0.0.1:{}", OAUTH_CALLBACK_PORT);
    let listener = TcpListener::bind(&addr)
        .await
        .map_err(|e| format!("Failed to bind OAuth server on {}: {}", addr, e))?;

    SERVER_RUNNING.store(true, Ordering::SeqCst);
    log::info!("[AuthServer] Started on {}", addr);

    let app_handle = app.clone();
    tokio::spawn(async move {
        run_server(listener, app_handle).await;
    });

    Ok(OAUTH_CALLBACK_PORT)
}

async fn run_server<R: Runtime>(listener: TcpListener, app: AppHandle<R>) {
    let timeout = tokio::time::sleep(std::time::Duration::from_secs(SERVER_TIMEOUT_SECS));
    tokio::pin!(timeout);

    loop {
        tokio::select! {
            _ = &mut timeout => {
                log::info!("[AuthServer] Timeout reached, shutting down");
                break;
            }
            result = listener.accept() => {
                match result {
                    Ok((stream, _addr)) => {
                        let app_clone = app.clone();
                        let should_shutdown = handle_connection(stream, app_clone).await;
                        if should_shutdown {
                            log::info!("[AuthServer] Tokens received, shutting down");
                            break;
                        }
                    }
                    Err(e) => {
                        log::error!("[AuthServer] Accept error: {}", e);
                    }
                }
            }
        }
    }

    SERVER_RUNNING.store(false, Ordering::SeqCst);
    log::info!("[AuthServer] Server stopped");
}

/// Handle a single HTTP connection. Returns true if the server should shut down.
async fn handle_connection<R: Runtime>(
    mut stream: tokio::net::TcpStream,
    app: AppHandle<R>,
) -> bool {
    let mut buf = vec![0u8; 8192];
    let n = match stream.read(&mut buf).await {
        Ok(n) if n > 0 => n,
        _ => return false,
    };

    let request = String::from_utf8_lossy(&buf[..n]);

    // Parse the first line to get method and path
    let first_line = match request.lines().next() {
        Some(line) => line,
        None => return false,
    };
    let parts: Vec<&str> = first_line.split_whitespace().collect();
    if parts.len() < 2 {
        return false;
    }
    let method = parts[0];
    let path = parts[1];

    log::info!("[AuthServer] Connection: {} {}", method, path);

    match (method, path) {
        ("GET", p) if p.starts_with("/auth/callback") => {
            // Check for PKCE flow: ?code=... in query params
            if let Some(query_start) = p.find('?') {
                let query_string = &p[query_start + 1..];
                let params: Vec<(&str, &str)> = query_string
                    .split('&')
                    .filter_map(|pair| {
                        let mut parts = pair.splitn(2, '=');
                        Some((parts.next()?, parts.next().unwrap_or("")))
                    })
                    .collect();

                let code = params.iter().find(|(k, _)| *k == "code").map(|(_, v)| *v);

                if let Some(code_value) = code {
                    if !code_value.is_empty() {
                        log::info!("[AuthServer] PKCE code received, emitting auth-code-received event");

                        if let Err(e) = app.emit("auth-code-received", AuthCode { code: code_value.to_string() }) {
                            log::error!("[AuthServer] Failed to emit auth-code-received: {}", e);
                        }

                        // Serve success page immediately for PKCE flow
                        let success_html = r#"<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Maity – Sign In</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#111827;color:#f9fafb;display:flex;align-items:center;justify-content:center;height:100vh}.card{text-align:center;padding:3rem;border-radius:1rem;background:#1f2937;max-width:420px;width:90%}h1{font-size:1.5rem;margin-bottom:.75rem}.success{color:#34d399}p{color:#9ca3af;margin-bottom:1rem}</style>
</head><body><div class="card"><h1 class="success">Sign-in successful!</h1><p>You can close this tab and return to Maity.</p></div></body></html>"#;

                        let response = format!(
                            "HTTP/1.1 200 OK\r\n\
                             Content-Type: text/html; charset=utf-8\r\n\
                             Content-Length: {}\r\n\
                             Connection: close\r\n\
                             \r\n\
                             {}",
                            success_html.len(),
                            success_html
                        );
                        let _ = stream.write_all(response.as_bytes()).await;
                        return true; // Shut down after receiving code
                    }
                }
            }

            // Implicit flow fallback: serve HTML that reads fragment tokens
            let html = CALLBACK_HTML.replace(
                "OAUTH_PORT",
                &OAUTH_CALLBACK_PORT.to_string(),
            );
            let response = format!(
                "HTTP/1.1 200 OK\r\n\
                 Content-Type: text/html; charset=utf-8\r\n\
                 Content-Length: {}\r\n\
                 Connection: close\r\n\
                 \r\n\
                 {}",
                html.len(),
                html
            );
            let _ = stream.write_all(response.as_bytes()).await;
            false
        }
        ("POST", "/auth/tokens") => {
            // Find the body after the \r\n\r\n separator
            let request_str = request.to_string();
            let body = match request_str.find("\r\n\r\n") {
                Some(idx) => &request_str[idx + 4..],
                None => {
                    send_response(&mut stream, 400, "Missing body").await;
                    return false;
                }
            };

            let tokens: AuthTokens = match serde_json::from_str(body) {
                Ok(t) => t,
                Err(e) => {
                    log::error!("[AuthServer] Failed to parse tokens: {}", e);
                    send_response(&mut stream, 400, "Invalid JSON").await;
                    return false;
                }
            };

            log::info!("[AuthServer] Received auth tokens, emitting event");

            // Emit event to the frontend
            if let Err(e) = app.emit("auth-tokens-received", tokens.clone()) {
                log::error!("[AuthServer] Failed to emit auth-tokens-received: {}", e);
                send_response(&mut stream, 500, "Internal error").await;
                return false;
            }

            send_response(&mut stream, 200, r#"{"ok":true}"#).await;
            true // Signal to shut down
        }
        ("OPTIONS", "/auth/tokens") => {
            let response = "HTTP/1.1 204 No Content\r\n\
                            Access-Control-Allow-Origin: *\r\n\
                            Access-Control-Allow-Methods: POST, OPTIONS\r\n\
                            Access-Control-Allow-Headers: Content-Type\r\n\
                            Content-Length: 0\r\n\
                            Connection: close\r\n\
                            \r\n";
            let _ = stream.write_all(response.as_bytes()).await;
            false
        }
        _ => {
            send_response(&mut stream, 404, "Not Found").await;
            false
        }
    }
}

async fn send_response(stream: &mut tokio::net::TcpStream, status: u16, body: &str) {
    let reason = match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        404 => "Not Found",
        500 => "Internal Server Error",
        _ => "Unknown",
    };
    let response = format!(
        "HTTP/1.1 {} {}\r\n\
         Content-Type: application/json\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n\
         \r\n\
         {}",
        status,
        reason,
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes()).await;
}
