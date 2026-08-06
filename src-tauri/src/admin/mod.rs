//! Admin user-management API client.
//!
//! Mirrors the pattern already used by `remote::mod` for the instance
//! catalog: the launcher never holds a database of registered users
//! itself (accounts are per-machine), so "view all registered users"
//! necessarily talks to the same backend worker used for Discord login,
//! extended with a small `/admin/users` surface backed by D1. See
//! `backend-example/discord-oauth-worker` for the reference server side.
//!
//! Every request here is admin-gated twice: once client-side by
//! `commands::admin::require_admin` (checked against the local
//! `ADMIN_USERNAMES` allowlist), and again server-side by the worker
//! itself via the `X-Admin-Token` header, since a modified frontend could
//! otherwise call these commands directly.

use crate::settings::LauncherSettings;
use crate::utils::{AppError, AppResult};
use reqwest::Client;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisteredUser {
    pub id: String,
    pub username: String,
    pub global_name: String,
    pub avatar_url: String,
    pub registered_at: i64,
    pub last_login_at: i64,
    pub blocked: bool,
}

fn api_base(settings: &LauncherSettings) -> AppResult<String> {
    let raw = settings.discord_token_exchange_url.trim();
    if raw.is_empty() {
        return Err(AppError::from(
            "No hay una URL de backend configurada. Configúrala en Ajustes.",
        ));
    }
    let url = reqwest::Url::parse(raw).map_err(|_| AppError::from("La URL del backend no es válida."))?;
    Ok(url.origin().ascii_serialization())
}

fn admin_token(settings: &LauncherSettings) -> AppResult<String> {
    let token = settings.admin_token.trim().to_string();
    if token.is_empty() {
        return Err(AppError::from(
            "Configura el token de administrador en Ajustes (solo administradores).",
        ));
    }
    Ok(token)
}

pub async fn list_users(
    client: &Client,
    settings: &LauncherSettings,
    query: Option<&str>,
) -> AppResult<Vec<RegisteredUser>> {
    let base = api_base(settings)?;
    let token = admin_token(settings)?;

    let mut req = client.get(format!("{base}/admin/users")).header("X-Admin-Token", token);
    if let Some(q) = query {
        if !q.trim().is_empty() {
            req = req.query(&[("q", q)]);
        }
    }

    let resp = req
        .send()
        .await?
        .error_for_status()
        .map_err(|e| AppError::Other(format!("El backend rechazó la solicitud: {e}")))?;
    Ok(resp.json().await?)
}

pub async fn set_blocked(
    client: &Client,
    settings: &LauncherSettings,
    user_id: &str,
    blocked: bool,
) -> AppResult<()> {
    let base = api_base(settings)?;
    let token = admin_token(settings)?;

    client
        .post(format!("{base}/admin/users/{user_id}/block"))
        .header("X-Admin-Token", token)
        .json(&serde_json::json!({ "blocked": blocked }))
        .send()
        .await?
        .error_for_status()
        .map_err(|e| AppError::Other(format!("No se pudo actualizar el usuario: {e}")))?;
    Ok(())
}

pub async fn delete_user(client: &Client, settings: &LauncherSettings, user_id: &str) -> AppResult<()> {
    let base = api_base(settings)?;
    let token = admin_token(settings)?;

    client
        .delete(format!("{base}/admin/users/{user_id}"))
        .header("X-Admin-Token", token)
        .send()
        .await?
        .error_for_status()
        .map_err(|e| AppError::Other(format!("No se pudo eliminar el usuario: {e}")))?;
    Ok(())
}
