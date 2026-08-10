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

/// Syncs the protected mods published for an installed instance into the
/// local ModVault (encrypted, mandatory). Any logged-in user may run this —
/// it pulls the same public mod list the instance was installed from, so a
/// player's launcher stays up to date with the mods the admin pushed from
/// the panel. `local_instance_id` must be an installed instance; its
/// `remote_id` tells the backend which mods to fetch.
#[tauri::command]
pub async fn sync_protected_mods(
    local_instance_id: String,
    state: State<'_, AppState>,
) -> AppResult<u64> {
    let instance = state
        .instances
        .get(&local_instance_id)
        .ok_or_else(|| AppError::from("Instancia no encontrada."))?;
    let remote_id = instance.remote_id.as_deref().ok_or_else(|| {
        AppError::from("Esta instancia no se instaló desde el catálogo (sin mods remotos).")
    })?;

    crate::remote::sync_mods(
        &state.http_client,
        &state.settings.get(),
        &local_instance_id,
        remote_id,
        &state.mod_vault,
        |_file, _done, _total| {},
    )
    .await
}

/// Admin-only: syncs every installed instance that came from the catalog.
/// Used by the "Sincronizar Launcher" button to push mods to all local
/// instances in one go.
#[tauri::command]
pub async fn sync_all_protected_mods(
    account_id: String,
    state: State<'_, AppState>,
) -> AppResult<usize> {
    require_admin(&state, &account_id)?;
    let instances = state.instances.list();
    let settings = state.settings.get();
    let remote_instances =
        crate::remote::list(&state.http_client, &settings, None, true).await?;
    let mut synced = 0usize;
    for mut inst in instances {
        if inst.remote_id.is_none() {
            if let Some(m) = remote_instances
                .iter()
                .find(|r| r.name.eq_ignore_ascii_case(&inst.name))
            {
                inst.remote_id = Some(m.id.clone());
                let _ = state.instances.update(inst.clone());
            }
        }
        let Some(remote_id) = inst.remote_id.clone() else {
            continue;
        };
        match crate::remote::sync_mods(
            &state.http_client,
            &settings,
            &inst.id,
            &remote_id,
            &state.mod_vault,
            |_file, _done, _total| {},
        )
        .await
        {
            Ok(_) => synced += 1,
            Err(e) => tracing::warn!(
                "sync_all: no se pudo sincronizar mods de {} ({}): {e}",
                inst.name,
                inst.id
            ),
        }
    }
    Ok(synced)
}

