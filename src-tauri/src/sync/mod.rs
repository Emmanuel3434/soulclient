//! Offline-first synchronization queue.
//!
//! Every mutating action the launcher performs (create/edit/delete instance,
//! add/update/remove protected mod) writes to the local stores first and then
//! enqueues a [`SyncOp`]. A persisted queue (`sync_queue.json`) holds those
//! ops until connectivity allows them to be flushed to the backend
//! (`{base}/api.php?action=sync_*`, which forwards to Supabase with the
//! publish token). Flushing happens:
//!
//! 1. Immediately after the mutation command (so edits appear in the catalog
//!    in real time).
//! 2. From a background task every 30 s while the launcher runs.
//! 3. When the frontend notices Supabase Realtime reconnecting (`flush_sync_queue`).
//!
//! Because the queue is persisted to disk, ops started while offline survive
//! restarts and are reconciled later, in order. The local stores are the
//! source of truth while disconnected; the queue is what brings the backend
//! up to date afterwards.

use crate::commands::AppState;
use crate::instances::{InstanceConfig, LoaderType};
use crate::settings::LauncherSettings;
use crate::utils::paths::AppPaths;
use crate::utils::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::RwLock;
use tauri::AppHandle;

/// A single queued mutation. Serialized with a `type` tag so the queue file
/// round-trips across restarts.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SyncOp {
    /// Upsert the full instance metadata into the catalog (name/version/
    /// loader/whitelist/cover). Idempotent: re-running it is safe.
    UpsertInstance { instance: InstanceConfig },
    /// Remove the instance row from the catalog (no-op if never published).
    DeleteInstance { id: String },
    /// Upload the mod's jar to Storage and upsert its `mods` row. `mod_id`
    /// is the local vault entry id; `remote_id` is the backend row id to
    /// upsert under (the vault id for locally-added mods, or the panel's id
    /// for mods originally synced from the panel — that way editing a
    /// panel-synced mod updates its existing row instead of creating a new
    /// one).
    UpsertMod {
        instance_id: String,
        mod_id: String,
        remote_id: String,
    },
    /// Delete the mod row from the backend.
    DeleteMod { id: String },
}

impl SyncOp {
    /// Whether a mod/instance bound to this id should be pushed to the
    /// backend at all. Global ("*") mods and empty ids are launcher-local.
    pub fn is_instance_bound(id: &str) -> bool {
        !id.is_empty() && id != "*"
    }
}

/// JSON-file-backed persisted queue of pending [`SyncOp`]s.
pub struct SyncQueue {
    inner: RwLock<Vec<SyncOp>>,
}

impl SyncQueue {
    pub fn load() -> Self {
        let data = std::fs::read_to_string(AppPaths::sync_queue_file())
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        Self {
            inner: RwLock::new(data),
        }
    }

    fn persist(&self, ops: &[SyncOp]) -> AppResult<()> {
        let json = serde_json::to_string_pretty(ops)?;
        std::fs::write(AppPaths::sync_queue_file(), json).map_err(AppError::from)
    }

    pub fn enqueue(&self, op: SyncOp) -> AppResult<()> {
        let mut data = self.inner.write().unwrap();
        data.push(op);
        self.persist(&data)
    }

    pub fn pending(&self) -> Vec<SyncOp> {
        self.inner.read().unwrap().clone()
    }

    pub fn pending_count(&self) -> usize {
        self.inner.read().unwrap().len()
    }

    /// Replaces the whole queue with the ops that still failed (keeps their
    /// relative order) and persists it.
    pub fn replace(&self, ops: Vec<SyncOp>) -> AppResult<()> {
        *self.inner.write().unwrap() = ops.clone();
        self.persist(&ops)
    }
}

/// Adds an op to the queue. Never fails hard: if persisting fails we log and
/// continue (the local change is already applied; a restart just loses the
/// pending push).
pub fn enqueue(state: &AppState, op: SyncOp) -> AppResult<()> {
    state.sync_queue.enqueue(op)
}

/// Tries to flush every queued op to the backend. Successful ops are removed;
/// failed ones stay queued (in order) for the next attempt. Never returns an
/// error for individual network failures — those are expected while offline.
/// Returns the number of ops still pending after the attempt.
pub async fn flush(state: &AppState, app: Option<&AppHandle>) -> AppResult<usize> {
    let pending = state.sync_queue.pending();
    if pending.is_empty() {
        return Ok(0);
    }

    let settings = state.settings.get();
    let mut remaining: Vec<SyncOp> = Vec::new();
    for op in &pending {
        if let Err(e) = flush_op(state, &settings, op).await {
            tracing::warn!("sync: op quedó en cola ({e}): {:?}", op);
            remaining.push(op.clone());
        }
    }

    state.sync_queue.replace(remaining)?;
    emit_queue_state(app, &state.sync_queue);
    Ok(state.sync_queue.pending_count())
}

async fn flush_op(
    state: &AppState,
    settings: &LauncherSettings,
    op: &SyncOp,
) -> AppResult<()> {
    let client = &state.http_client;
    let base = crate::remote::api_base(settings)?;
    let token = crate::remote::publish_token(settings)?;

    match op {
        SyncOp::UpsertInstance { instance } => {
            let mut body = serde_json::json!({
                "id": instance.id,
                "name": instance.name,
                "version": instance.version,
                "loader": loader_str(&instance.loader),
                "loaderVersion": instance.loader_version,
                "whitelistEnabled": instance.whitelist_enabled,
                "allowedDiscordIds": instance.allowed_discord_ids,
                "createdAt": instance.created_at,
            });
            if let Some(url) = resolve_cover(client, &base, &instance.id, instance.cover_image.as_deref()).await? {
                body["coverImage"] = serde_json::json!(url);
            }
            client
                .post(format!("{base}/api.php?action=sync_upsert_instance"))
                .bearer_auth(&token)
                .json(&body)
                .send()
                .await?
                .error_for_status()?;
            Ok(())
        }

        SyncOp::DeleteInstance { id } => {
            client
                .delete(format!("{base}/api.php?action=sync_delete_instance&id={id}"))
                .bearer_auth(&token)
                .send()
                .await?
                .error_for_status()?;
            Ok(())
        }

        SyncOp::UpsertMod { instance_id, mod_id, remote_id } => {
            let entry = state
                .mod_vault
                .get(mod_id)
                .ok_or_else(|| AppError::from("Mod no encontrado en la bóveda."))?;
            let plaintext = state
                .mod_vault
                .read_plaintext(mod_id)?
                .ok_or_else(|| AppError::from("Archivo del mod ausente en la bóveda."))?;
            let sha = sha1_bytes(&plaintext);

            // Stage the plaintext jar in the cache dir just long enough to
            // upload it, then delete it again.
            let tmp = AppPaths::cache_dir().join(format!("sync_{mod_id}.jar"));
            std::fs::create_dir_all(AppPaths::cache_dir())?;
            std::fs::write(&tmp, &plaintext)?;

            let safe = sanitize_file_name(&entry.original_name);
            let sign_url = format!(
                "{base}/api.php?action=sign_mod_upload&instance_id={instance_id}&file={safe}"
            );
            let signed: serde_json::Value = client
                .get(&sign_url)
                .send()
                .await?
                .error_for_status()?
                .json()
                .await?;
            let upload_url = signed
                .get("signedUrl")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::from("Respuesta de firma de subida inválida."))?
                .to_string();
            let public_url = signed
                .get("publicUrl")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            put_file(client, &upload_url, &tmp, "application/octet-stream").await?;
            let _ = std::fs::remove_file(&tmp);

            client
                .post(format!("{base}/api.php?action=sync_upsert_mod"))
                .bearer_auth(&token)
                .json(&serde_json::json!({
                    "id": remote_id,
                    "instanceId": instance_id,
                    "fileName": entry.original_name,
                    "storagePath": format!("mods/{instance_id}/{safe}"),
                    "sha1": sha,
                    "sizeBytes": plaintext.len(),
                    "downloadUrl": public_url,
                    "source": "custom",
                    "isMandatory": entry.is_mandatory,
                }))
                .send()
                .await?
                .error_for_status()?;

            state.mod_vault.stamp_remote(mod_id, remote_id, &sha)?;
            Ok(())
        }

        SyncOp::DeleteMod { id } => {
            client
                .delete(format!("{base}/api.php?action=sync_delete_mod&id={id}"))
                .bearer_auth(&token)
                .send()
                .await?
                .error_for_status()?;
            Ok(())
        }
    }
}

fn loader_str(loader: &LoaderType) -> &'static str {
    match loader {
        LoaderType::Vanilla => "vanilla",
        LoaderType::Fabric => "fabric",
    }
}

fn sanitize_file_name(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

fn sha1_bytes(data: &[u8]) -> String {
    use sha1::Digest;
    let mut hasher = sha1::Sha1::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
}

async fn put_file(
    client: &reqwest::Client,
    url: &str,
    path: &Path,
    content_type: &str,
) -> AppResult<()> {
    let bytes = std::fs::read(path)?;
    client
        .put(url)
        .header("x-upsert", "true")
        .header(reqwest::header::CONTENT_TYPE, content_type)
        .body(bytes)
        .send()
        .await?
        .error_for_status()?;
    Ok(())
}

/// Resolves the cover for the catalog `logo_path` column:
/// - None / missing file → None (leave the column untouched).
/// - Already a URL → passthrough.
/// - Local file → signed upload to Storage, returns the public URL.
async fn resolve_cover(
    client: &reqwest::Client,
    base: &str,
    instance_id: &str,
    cover: Option<&str>,
) -> AppResult<Option<String>> {
    let Some(cover) = cover else { return Ok(None) };
    if cover.starts_with("http://") || cover.starts_with("https://") {
        return Ok(Some(cover.to_string()));
    }
    let path = Path::new(cover);
    if !path.is_file() {
        return Ok(None);
    }
    let fname = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("cover.png");
    let safe = sanitize_file_name(fname);
    let sign_url = format!(
        "{base}/api.php?action=sign_cover_upload&instance_id={instance_id}&file={safe}"
    );
    let signed: serde_json::Value = client
        .get(&sign_url)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let upload_url = signed
        .get("signedUrl")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::from("Respuesta de firma de subida inválida."))?
        .to_string();
    put_file(client, &upload_url, path, "image/png").await?;
    Ok(signed
        .get("publicUrl")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string()))
}

/// Emits `sync://queue` so the UI can show a "pending sync" indicator.
fn emit_queue_state(app: Option<&AppHandle>, queue: &SyncQueue) {
    if let Some(app) = app {
        use tauri::Emitter;
        let _ = app.emit(
            "sync://queue",
            serde_json::json!({ "pending": queue.pending_count() }),
        );
    }
}
