use super::AppState;
use crate::downloader::{fabric, manifest};
use crate::utils::AppResult;
use serde::Serialize;
use tauri::State;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MinecraftVersionDto {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub url: String,
    pub release_time: String,
}

#[tauri::command]
pub async fn fetch_version_manifest(state: State<'_, AppState>) -> AppResult<Vec<MinecraftVersionDto>> {
    let versions = manifest::fetch_version_manifest(&state.http_client).await?;
    Ok(versions
        .into_iter()
        .map(|v| MinecraftVersionDto {
            id: v.id,
            kind: v.kind,
            url: v.url,
            release_time: v.release_time,
        })
        .collect())
}

#[tauri::command]
pub async fn fetch_fabric_loaders(mc_version: String, state: State<'_, AppState>) -> AppResult<Vec<String>> {
    fabric::fetch_loader_versions(&state.http_client, &mc_version).await
}
