use super::AppState;
use crate::auth::{offline, validate_username, Account, AccountView};
use crate::skins::{self, SkinVariant};
use crate::utils::AppResult;
use tauri::State;

#[tauri::command]
pub fn list_accounts(state: State<'_, AppState>) -> Vec<AccountView> {
    state.accounts.list_view()
}

#[tauri::command]
pub fn get_active_account(state: State<'_, AppState>) -> Option<AccountView> {
    state.accounts.active_view()
}

#[tauri::command]
pub fn add_offline_account(username: String, state: State<'_, AppState>) -> AppResult<AccountView> {
    if !validate_username(&username) {
        return Err("Nombre inválido: usa 3-16 caracteres (letras, números, guion bajo).".into());
    }

    let existing = state
        .accounts
        .list()
        .into_iter()
        .find(|a| a.username.eq_ignore_ascii_case(&username));

    if let Some(account) = existing {
        if account.account_type == crate::auth::AccountType::Premium {
            return Err("Este nombre de usuario está registrado por una cuenta Premium y no se puede usar en modo No Premium.".into());
        }
        state.accounts.set_active(&account.id)?;
        return Ok(AccountView::from(account));
    }

    let account = offline::create_offline_account(&username);
    state.accounts.add(account.clone())?;
    state.accounts.set_active(&account.id)?;
    Ok(AccountView::from(account))
}

#[tauri::command]
pub fn remove_account(id: String, state: State<'_, AppState>) -> AppResult<()> {
    state.accounts.remove(&id)
}

#[tauri::command]
pub fn set_active_account(id: String, state: State<'_, AppState>) -> AppResult<()> {
    state.accounts.set_active(&id)
}

/// Kicks off the Microsoft device-code flow: requests a code from
/// Microsoft, stashes it in shared state, and returns the human-readable
/// `user_code` (e.g. "ABCD-EFGH") for the frontend to display while it
/// opens https://microsoft.com/link in the system browser.
#[tauri::command]
pub async fn begin_microsoft_login(state: State<'_, AppState>) -> AppResult<String> {
    let device_code = crate::auth::microsoft::request_device_code(&state.http_client).await?;
    let user_code = device_code.user_code.clone();
    let verification_uri = device_code.verification_uri.clone();
    *state.ms_device_flow.lock().unwrap() = Some(device_code);

    // Open the verification page in the user's default browser so they can
    // enter the code shown in the UI. Falls back silently if unsupported.
    let _ = open::that(verification_uri);

    Ok(user_code)
}

/// Polls Microsoft until the user finishes authorizing in the browser, then
/// runs the full XBL/XSTS/Minecraft chain and persists the resulting
/// premium account.
#[tauri::command]
pub async fn poll_microsoft_login(state: State<'_, AppState>) -> AppResult<Option<AccountView>> {
    let device_code = state
        .ms_device_flow
        .lock()
        .unwrap()
        .clone()
        .ok_or("No hay un inicio de sesión de Microsoft en curso")?;

    let account = crate::auth::microsoft::poll_and_complete(
        &state.http_client,
        &device_code.device_code,
        device_code.interval,
        device_code.expires_in,
    )
    .await?;

    state.accounts.add(account.clone())?;
    state.accounts.set_active(&account.id)?;
    *state.ms_device_flow.lock().unwrap() = None;

    Ok(Some(AccountView::from(account)))
}

/// Reads a PNG the user picked via the file dialog and applies it as the
/// given account's skin — a real Mojang upload for Premium accounts, or a
/// locally-embedded texture for No Premium ones. Returns the updated
/// account so the frontend can refresh the 3D preview immediately.
#[tauri::command]
pub async fn upload_skin(
    account_id: String,
    file_path: String,
    slim: bool,
    state: State<'_, AppState>,
) -> AppResult<AccountView> {
    let account: Account = state
        .accounts
        .get(&account_id)
        .ok_or("Cuenta no encontrada")?;

    let bytes = std::fs::read(&file_path).map_err(crate::utils::AppError::from)?;
    let variant = if slim { SkinVariant::Slim } else { SkinVariant::Classic };

    let updated = skins::apply_skin(&state.http_client, account, bytes, variant).await?;
    state.accounts.update(updated)
}
