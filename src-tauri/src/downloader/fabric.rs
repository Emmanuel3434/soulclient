use crate::utils::{AppError, AppResult};
use serde::Deserialize;

const FABRIC_META: &str = "https://meta.fabricmc.net/v2";

#[derive(Debug, Deserialize)]
pub struct FabricLoaderEntry {
    pub loader: FabricLoaderInfo,
}

#[derive(Debug, Deserialize)]
pub struct FabricLoaderInfo {
    pub version: String,
    pub stable: bool,
}

/// Lists available Fabric Loader versions compatible with a given
/// Minecraft version, used by the instance modal's loader dropdown.
pub async fn fetch_loader_versions(client: &reqwest::Client, mc_version: &str) -> AppResult<Vec<String>> {
    let url = format!("{FABRIC_META}/versions/loader/{mc_version}");
    let resp = client
        .get(&url)
        .send()
        .await?
        .error_for_status()
        .map_err(|e| AppError::Other(format!("Failed to fetch Fabric loaders: {e}")))?;

    let entries: Vec<FabricLoaderEntry> = resp.json().await?;
    Ok(entries.into_iter().map(|e| e.loader.version).collect())
}

/// Fetches the Fabric "launcher meta" JSON for a given (mc_version, loader
/// version) pair. This document has the same shape as a vanilla version
/// JSON (mainClass, libraries, arguments) and can be merged on top of the
/// vanilla one to produce the effective launch spec, which is what real
/// Fabric-aware launchers do.
pub async fn fetch_launcher_meta(
    client: &reqwest::Client,
    mc_version: &str,
    loader_version: &str,
) -> AppResult<serde_json::Value> {
    let url = format!("{FABRIC_META}/versions/loader/{mc_version}/{loader_version}/profile/json");
    let resp = client
        .get(&url)
        .send()
        .await?
        .error_for_status()
        .map_err(|e| AppError::Other(format!("Failed to fetch Fabric profile: {e}")))?;
    Ok(resp.json().await?)
}
