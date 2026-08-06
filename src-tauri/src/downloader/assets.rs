use super::libraries::PendingFile;
use crate::utils::paths::AppPaths;
use crate::utils::{AppError, AppResult};

const RESOURCES_BASE: &str = "https://resources.download.minecraft.net";

/// Downloads the asset index JSON referenced by the version manifest
/// (`assetIndex.url`) and resolves every object it lists into a
/// `PendingFile` pointing at Mojang's CDN-style `resources/xx/xxxxxxx...`
/// layout, mirrored locally under `assets/objects`.
pub async fn resolve_assets(
    client: &reqwest::Client,
    version_json: &serde_json::Value,
) -> AppResult<Vec<PendingFile>> {
    let asset_index = version_json
        .get("assetIndex")
        .ok_or_else(|| AppError::Other("Version JSON missing assetIndex".into()))?;

    let index_url = asset_index
        .get("url")
        .and_then(|u| u.as_str())
        .ok_or_else(|| AppError::Other("Missing assetIndex url".into()))?;
    let index_id = asset_index
        .get("id")
        .and_then(|u| u.as_str())
        .unwrap_or("legacy");

    let index_json: serde_json::Value = client
        .get(index_url)
        .send()
        .await?
        .error_for_status()
        .map_err(|e| AppError::Other(format!("Failed to fetch asset index: {e}")))?
        .json()
        .await?;

    // Cache the index itself so `--assetIndex` points at a real local file.
    let indexes_dir = AppPaths::assets_dir().join("indexes");
    std::fs::create_dir_all(&indexes_dir).map_err(AppError::from)?;
    std::fs::write(
        indexes_dir.join(format!("{index_id}.json")),
        serde_json::to_vec_pretty(&index_json)?,
    )
    .map_err(AppError::from)?;

    let objects_dir = AppPaths::assets_dir().join("objects");
    let mut files = Vec::new();

    if let Some(objects) = index_json.get("objects").and_then(|o| o.as_object()) {
        for (_name, meta) in objects {
            let hash = meta
                .get("hash")
                .and_then(|h| h.as_str())
                .unwrap_or_default()
                .to_string();
            if hash.is_empty() {
                continue;
            }
            let size = meta.get("size").and_then(|s| s.as_u64()).unwrap_or(0);
            let prefix = &hash[0..2];

            files.push(PendingFile {
                url: format!("{RESOURCES_BASE}/{prefix}/{hash}"),
                dest: objects_dir.join(prefix).join(&hash),
                sha1: Some(hash),
                size,
            });
        }
    }

    Ok(files)
}
