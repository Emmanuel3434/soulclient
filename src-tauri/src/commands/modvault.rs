use super::AppState;
use crate::auth::is_admin_account;
use crate::modvault::VaultModEntry;
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
            "Solo los administradores pueden gestionar mods protegidos.",
        ))
    }
}

#[tauri::command]
pub fn list_all_protected_mods(state: State<'_, AppState>) -> Vec<VaultModEntry> {
    state.mod_vault.list_all()
}

#[tauri::command]
pub fn list_protected_mods(
    instance_id: String,
    state: State<'_, AppState>,
) -> Vec<VaultModEntry> {
    state.mod_vault.list(&instance_id)
}

#[tauri::command]
pub fn add_protected_mod(
    instance_id: String,
    source_path: String,
    custom_name: Option<String>,
    custom_version: Option<String>,
    is_mandatory: Option<bool>,
    account_id: String,
    state: State<'_, AppState>,
) -> AppResult<VaultModEntry> {
    require_admin(&state, &account_id)?;
    state.mod_vault.add(
        &instance_id,
        std::path::Path::new(&source_path),
        custom_name,
        custom_version,
        is_mandatory.unwrap_or(true),
    )
}

#[tauri::command]
pub fn update_protected_mod(
    mod_id: String,
    source_path: Option<String>,
    version: Option<String>,
    is_mandatory: Option<bool>,
    account_id: String,
    state: State<'_, AppState>,
) -> AppResult<VaultModEntry> {
    require_admin(&state, &account_id)?;
    let src = source_path.as_ref().map(std::path::Path::new);
    state
        .mod_vault
        .update(&mod_id, src, version, is_mandatory)
}

#[tauri::command]
pub fn remove_protected_mod(
    mod_id: String,
    account_id: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    require_admin(&state, &account_id)?;
    state.mod_vault.remove(&mod_id)
}

