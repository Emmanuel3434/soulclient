use super::AppState;
use crate::auth::discord::{self, DiscordSession};
use crate::utils::AppResult;
use chrono::Utc;
use tauri::State;

/// Returns the current Discord session if one is stored.
#[tauri::command]
pub async fn get_discord_session(state: State<'_, AppState>) -> AppResult<Option<DiscordSession>> {
    let Some(session) = state.discord_session.get() else {
        return Ok(None);
    };

    let expires_soon = session.expires_at - Utc::now().timestamp_millis() < 60_000;
    if !expires_soon {
        return Ok(Some(session));
    }

    // Verify token validity directly against Discord API
    match discord::fetch_discord_user(&state.http_client, &session.access_token).await {
        Ok((id, username, global_name, avatar_url)) => {
            let updated = DiscordSession {
                id,
                username,
                global_name,
                avatar_url,
                ..session
            };
            state.discord_session.save(updated.clone())?;
            Ok(Some(updated))
        }
        Err(_) => {
            let _ = state.discord_session.clear();
            Ok(None)
        }
    }
}

/// Opens the user's browser to Discord's consent screen and starts the
/// local loopback listener in the background.
#[tauri::command]
pub fn begin_discord_login(state: State<'_, AppState>) -> AppResult<String> {
    let csrf_state = discord::new_state_token();
    let url = discord::authorize_url(&csrf_state);

    let receiver = discord::spawn_loopback_listener(csrf_state);
    *state.discord_flow.receiver.lock().unwrap() = Some(receiver);

    let _ = open::that(&url);
    Ok(url)
}

/// Waits for the loopback server to receive Discord's redirect with access token,
/// fetches the user's profile directly from Discord, and persists the session.
#[tauri::command]
pub async fn poll_discord_login(state: State<'_, AppState>) -> AppResult<DiscordSession> {
    let receiver = state
        .discord_flow
        .receiver
        .lock()
        .unwrap()
        .take()
        .ok_or("No hay un inicio de sesión de Discord en curso")?;

    let auth_res = receiver
        .await
        .map_err(|_| "El proceso de login se canceló inesperadamente")??;

    let (id, username, global_name, avatar_url) =
        discord::fetch_discord_user(&state.http_client, &auth_res.access_token).await?;

    let session = DiscordSession {
        id,
        username,
        global_name,
        avatar_url,
        access_token: auth_res.access_token,
        refresh_token: String::new(),
        expires_at: Utc::now().timestamp_millis() + auth_res.expires_in * 1000,
    };

    state.discord_session.save(session.clone())?;
    Ok(session)
}

#[tauri::command]
pub fn logout_discord(state: State<'_, AppState>) -> AppResult<()> {
    state.discord_session.clear()
}

