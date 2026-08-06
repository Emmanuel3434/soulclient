pub mod assets;
pub mod fabric;
pub mod java;
pub mod launch;
pub mod libraries;
pub mod manifest;

use serde::{Deserialize, Serialize};
use tauri::Emitter;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub instance_id: String,
    pub stage: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub speed_bps: u64,
    pub eta_seconds: u64,
    pub log: String,
}

/// Emits a `download://progress` event the frontend subscribes to via
/// `api.onDownloadProgress`. Kept as a free function so every download
/// stage (manifest/client/libraries/assets/java/fabric) can report through
/// the same channel without passing the AppHandle everywhere manually.
pub fn emit_progress(app: &tauri::AppHandle, progress: DownloadProgress) {
    let _ = app.emit("download://progress", progress);
}

#[derive(Debug, Clone, Deserialize)]
pub struct DownloadArtifact {
    pub url: String,
    pub path: std::path::PathBuf,
    pub sha1: Option<String>,
    pub size: u64,
}
