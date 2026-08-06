use super::AppState;
use crate::admin::RegisteredUser;
use crate::auth::is_admin_account;
use crate::utils::{AppError, AppResult};
use tauri::State;

fn require_admin(state: &State<'_, AppState>, account_id: &str) -> AppResult<()> {
    let account = state
        .accounts
        .get(account_id)
        .ok_or_else(|| AppError::from("Cuenta no encontrada"))?;
    if is_admin_account(&account) {
        Ok(())
    } else {
        Err(AppError::from(
            "Solo los administradores pueden gestionar usuarios.",
        ))
    }
}

#[tauri::command]
pub async fn list_users(
    account_id: String,
    query: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<Vec<RegisteredUser>> {
    require_admin(&state, &account_id)?;
    crate::admin::list_users(&state.http_client, &state.settings.get(), query.as_deref()).await
}

#[tauri::command]
pub async fn set_user_blocked(
    user_id: String,
    blocked: bool,
    account_id: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    require_admin(&state, &account_id)?;
    crate::admin::set_blocked(&state.http_client, &state.settings.get(), &user_id, blocked).await
}

#[tauri::command]
pub async fn delete_user(
    user_id: String,
    account_id: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    require_admin(&state, &account_id)?;
    crate::admin::delete_user(&state.http_client, &state.settings.get(), &user_id).await
}
