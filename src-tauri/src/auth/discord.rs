//! Discord OAuth2 login for the launcher's own "who's using SoulClient"
//! gate (standalone client-side, zero backend required).

use crate::utils::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::Duration;
use uuid::Uuid;

pub const CLIENT_ID: &str = "1492641149494755370";
const REDIRECT_PORT: u16 = 47850;
const SCOPE: &str = "identify";

fn redirect_uri() -> String {
    format!("http://127.0.0.1:{REDIRECT_PORT}/callback")
}

pub fn authorize_url(state: &str) -> String {
    format!(
        "https://discord.com/api/oauth2/authorize?client_id={}&redirect_uri={}&response_type=token&scope={}&state={}&prompt=consent",
        CLIENT_ID,
        urlencoding::encode(&redirect_uri()),
        urlencoding::encode(SCOPE),
        urlencoding::encode(state),
    )
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscordSession {
    pub id: String,
    pub username: String,
    /// Discord's modern "display name"; falls back to `username` for
    /// accounts that never set one.
    pub global_name: String,
    pub avatar_url: String,
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: i64,
}

#[derive(Debug, Clone)]
pub struct AuthTokenResult {
    pub access_token: String,
    pub expires_in: i64,
}

/// Holds the in-flight login attempt between `begin_discord_login` (which
/// opens the browser and starts listening) and `poll_discord_login` (which
/// waits for the loopback server to receive the token).
#[derive(Default)]
pub struct DiscordLoginFlow {
    pub receiver: Mutex<Option<tokio::sync::oneshot::Receiver<AppResult<AuthTokenResult>>>>,
}

/// Starts the loopback server on a background thread, waiting up to two
/// minutes for Discord to redirect back.
pub fn spawn_loopback_listener(expected_state: String) -> tokio::sync::oneshot::Receiver<AppResult<AuthTokenResult>> {
    let (tx, rx) = tokio::sync::oneshot::channel();

    std::thread::spawn(move || {
        let result = (|| -> AppResult<AuthTokenResult> {
            let server = tiny_http::Server::http(format!("127.0.0.1:{REDIRECT_PORT}"))
                .map_err(|e| AppError::Other(format!("No se pudo abrir el puerto de login local: {e}")))?;

            let start_time = std::time::Instant::now();
            let timeout = Duration::from_secs(120);

            loop {
                let remaining = match timeout.checked_sub(start_time.elapsed()) {
                    Some(rem) => rem,
                    None => return Err(AppError::Other("Tiempo de espera agotado esperando el login de Discord".into())),
                };

                let request = server
                    .recv_timeout(remaining)
                    .map_err(|e| AppError::Other(e.to_string()))?
                    .ok_or_else(|| AppError::Other("Tiempo de espera agotado esperando el login de Discord".into()))?;

                let url = request.url().to_string();

                if url.starts_with("/callback") {
                    let html = r#"<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>SoulClient Auth</title></head>
<body style="font-family:sans-serif;background:#0a0a0d;color:#e5e5ea;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
  <div style="text-align:center;max-width:400px;padding:24px;border-radius:12px;background:#141419;border:1px solid #262630">
    <h2 style="margin-top:0;color:#38bdf8">Conectando con SoulClient</h2>
    <p style="color:#94a3b8;font-size:14px">Procesando inicio de sesión de Discord...</p>
  </div>
  <script>
    const hash = window.location.hash.substring(1);
    const query = window.location.search.substring(1);
    const params = new URLSearchParams(hash || query);
    const token = params.get('access_token');
    const state = params.get('state');
    const expiresIn = params.get('expires_in') || '604800';
    const err = params.get('error');

    if (err) {
      document.body.innerHTML = '<div style="text-align:center;color:#f87171"><h2>Acceso Denegado</h2><p>' + err + '</p></div>';
    } else if (token) {
      fetch('/token_callback?access_token=' + encodeURIComponent(token) + '&state=' + encodeURIComponent(state || '') + '&expires_in=' + encodeURIComponent(expiresIn))
        .then(() => {
          document.body.innerHTML = '<div style="text-align:center;max-width:400px;padding:24px;border-radius:12px;background:#141419;border:1px solid #262630"><h2 style="color:#4ade80;margin-top:0">¡Inicio de sesión exitoso!</h2><p style="color:#94a3b8">Puedes cerrar esta pestaña y volver al launcher.</p></div>';
        })
        .catch(e => {
          document.body.innerHTML = '<div style="text-align:center;color:#f87171"><h2>Error</h2><p>' + e + '</p></div>';
        });
    } else {
      document.body.innerHTML = '<div style="text-align:center;color:#f87171"><h2>Error</h2><p>No se recibió respuesta de inicio de sesión.</p></div>';
    }
  </script>
</body>
</html>"#;
                    let response = tiny_http::Response::from_string(html).with_header(
                        tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..]).unwrap(),
                    );
                    let _ = request.respond(response);
                    continue;
                }

                if url.starts_with("/token_callback") {
                    let query = url.split_once('?').map(|(_, q)| q).unwrap_or("");
                    let params: std::collections::HashMap<String, String> = query
                        .split('&')
                        .filter_map(|pair| pair.split_once('='))
                        .map(|(k, v)| (k.to_string(), urlencoding::decode(v).unwrap_or_default().to_string()))
                        .collect();

                    let response = tiny_http::Response::from_string("OK");
                    let _ = request.respond(response);

                    if let Some(err) = params.get("error") {
                        return Err(AppError::Other(format!("Discord denegó el acceso: {err}")));
                    }

                    let token = params
                        .get("access_token")
                        .cloned()
                        .ok_or_else(|| AppError::Other("Falta el token de acceso de Discord".into()))?;

                    let returned_state = params.get("state").cloned().unwrap_or_default();
                    if !returned_state.is_empty() && returned_state != expected_state {
                        return Err(AppError::Other("El parámetro state no coincide (posible CSRF)".into()));
                    }

                    let expires_in: i64 = params.get("expires_in").and_then(|s| s.parse().ok()).unwrap_or(604800);

                    return Ok(AuthTokenResult {
                        access_token: token,
                        expires_in,
                    });
                }
            }
        })();

        let _ = tx.send(result);
    });

    rx
}

pub fn new_state_token() -> String {
    Uuid::new_v4().to_string()
}

#[derive(Debug, Deserialize)]
struct DiscordUser {
    id: String,
    username: String,
    global_name: Option<String>,
    avatar: Option<String>,
    discriminator: String,
}

pub async fn fetch_discord_user(
    client: &reqwest::Client,
    access_token: &str,
) -> AppResult<(String, String, String, String)> {
    let user: DiscordUser = client
        .get("https://discord.com/api/users/@me")
        .bearer_auth(access_token)
        .send()
        .await?
        .error_for_status()
        .map_err(|e| AppError::Other(format!("No se pudo obtener el perfil de Discord: {e}")))?
        .json()
        .await?;

    let avatar_url = match &user.avatar {
        Some(hash) => format!("https://cdn.discordapp.com/avatars/{}/{}.png?size=128", user.id, hash),
        None => {
            let index: u64 = user.discriminator.parse().unwrap_or(0) % 5;
            format!("https://cdn.discordapp.com/embed/avatars/{index}.png")
        }
    };

    let global_name = user.global_name.unwrap_or_else(|| user.username.clone());
    Ok((user.id, user.username, global_name, avatar_url))
}

