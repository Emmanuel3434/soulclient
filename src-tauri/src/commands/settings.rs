use super::AppState;
use crate::settings::LauncherSettings;
use crate::utils::paths::AppPaths;
use crate::utils::AppResult;
use tauri::State;

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> LauncherSettings {
    state.settings.get()
}

#[tauri::command]
pub fn save_settings(settings: LauncherSettings, state: State<'_, AppState>) -> AppResult<()> {
    state.settings.save(settings)
}

#[tauri::command]
pub fn reset_settings(state: State<'_, AppState>) -> AppResult<LauncherSettings> {
    state.settings.reset()
}

#[tauri::command]
pub fn clear_cache() -> AppResult<()> {
    let cache = AppPaths::cache_dir();
    if cache.exists() {
        std::fs::remove_dir_all(&cache).map_err(crate::utils::AppError::from)?;
    }
    std::fs::create_dir_all(&cache).map_err(crate::utils::AppError::from)?;
    Ok(())
}

#[tauri::command]
pub fn open_launcher_folder() -> AppResult<()> {
    let root = AppPaths::launcher_root();
    open::that(root).map_err(|e| crate::utils::AppError::Other(e.to_string()))
}

#[tauri::command]
pub async fn check_for_updates() -> crate::updater::UpdateCheckResult {
    crate::updater::check_for_updates().await
}
