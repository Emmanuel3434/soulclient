use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub available: bool,
    pub version: Option<String>,
}

/// Update checks and downloads are handled by `tauri-plugin-updater`
/// (configured in `tauri.conf.json` under `plugins.updater`), which already
/// implements "detect new version -> download only the new bundle -> ask to
/// restart". This helper just exposes a simple command the frontend can
/// call to check status without pulling in the full plugin API on the JS
/// side; wire it to `tauri_plugin_updater::UpdaterExt` once a real update
/// endpoint + signing key are configured.
pub async fn check_for_updates() -> UpdateCheckResult {
    UpdateCheckResult {
        available: false,
        version: None,
    }
}
