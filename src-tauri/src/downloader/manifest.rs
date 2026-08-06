use crate::utils::{AppError, AppResult};
use serde::{Deserialize, Serialize};

const MANIFEST_URL: &str = "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawVersionEntry {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub url: String,
    #[serde(rename = "releaseTime")]
    pub release_time: String,
}

#[derive(Debug, Deserialize)]
struct RawManifest {
    versions: Vec<RawVersionEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MinecraftVersion {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub url: String,
    pub release_time: String,
}

/// Maps Mojang's manifest "type" field (`release`, `snapshot`, `old_beta`,
/// `old_alpha`) 1:1 onto our own enum on the TS side, so no translation is
/// needed here beyond the wire format.
fn normalize_kind(kind: &str) -> String {
    match kind {
        "release" | "snapshot" | "old_beta" | "old_alpha" => kind.to_string(),
        other => other.to_string(),
    }
}

/// Fetches and caches the full Mojang version manifest (release, snapshot,
/// old_beta, old_alpha). Called both by the "Biblioteca de versiones" page
/// and by the instance creation modal's version dropdown.
pub async fn fetch_version_manifest(client: &reqwest::Client) -> AppResult<Vec<MinecraftVersion>> {
    let resp = client
        .get(MANIFEST_URL)
        .send()
        .await?
        .error_for_status()
        .map_err(|e| AppError::Other(format!("Failed to fetch version manifest: {e}")))?;

    let raw: RawManifest = resp.json().await?;

    Ok(raw
        .versions
        .into_iter()
        .map(|v| MinecraftVersion {
            id: v.id,
            kind: normalize_kind(&v.kind),
            url: v.url,
            release_time: v.release_time,
        })
        .collect())
}

/// Full per-version metadata document (client jar url/sha1, libraries,
/// asset index, main class, launch arguments...). This is what
/// `RawVersionEntry.url` points to.
pub async fn fetch_version_detail(
    client: &reqwest::Client,
    version_url: &str,
) -> AppResult<serde_json::Value> {
    let resp = client
        .get(version_url)
        .send()
        .await?
        .error_for_status()
        .map_err(|e| AppError::Other(format!("Failed to fetch version detail: {e}")))?;
    Ok(resp.json().await?)
}
