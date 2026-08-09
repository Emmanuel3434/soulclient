// Remote instance catalog backed by the Cloudflare worker + R2.
//
// Admins package a locally-built instance (its own folder plus the
// version/libraries/assets it needs) into a zip and upload it to R2 through
// presigned multipart URLs — only small JSON touches the worker, so zips of
// several hundred MB upload fine. Users then list and install these with a
// single click, skipping the slow Mojang CDN round trips.
use crate::downloader::{emit_progress, DownloadProgress};
use crate::instances::{InstanceConfig, InstanceStore, LoaderType};
use crate::settings::LauncherSettings;
use crate::utils::paths::AppPaths;
use crate::utils::{AppError, AppResult};
use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use uuid::Uuid;

/// Size of each uploaded part (must be >= 5 MB for R2 multipart).
const REMOTE_PART_SIZE: u64 = 64 * 1024 * 1024;

fn deserialize_bool_from_anything<'de, D>(deserializer: D) -> Result<bool, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de;
    struct BoolOrIntVisitor;
    impl<'de> de::Visitor<'de> for BoolOrIntVisitor {
        type Value = bool;
        fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
            formatter.write_str("a boolean, integer (0 or 1), or string (\"0\" or \"1\")")
        }
        fn visit_bool<E>(self, v: bool) -> Result<bool, E> { Ok(v) }
        fn visit_i64<E>(self, v: i64) -> Result<bool, E> { Ok(v != 0) }
        fn visit_u64<E>(self, v: u64) -> Result<bool, E> { Ok(v != 0) }
        fn visit_str<E: de::Error>(self, v: &str) -> Result<bool, E> {
            match v.trim() {
                "true" | "1" | "t" => Ok(true),
                "false" | "0" | "f" => Ok(false),
                _ => Ok(false),
            }
        }
    }
    deserializer.deserialize_any(BoolOrIntVisitor)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInstance {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(alias = "modloader")]
    pub loader: String,
    #[serde(default, alias = "modloader_version")]
    pub loader_version: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub size_bytes: u64,
    #[serde(default)]
    pub sha256: String,
    #[serde(default)]
    pub downloads: u64,
    #[serde(default)]
    pub published_at: i64,
    #[serde(default)]
    pub updated_at: i64,
    #[serde(default, deserialize_with = "deserialize_bool_from_anything")]
    pub whitelist_enabled: bool,
    #[serde(default)]
    pub allowed_discord_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UploadInit {
    id: String,
    upload_id: String,
}

#[derive(Debug, Deserialize)]
struct PartUrl {
    url: String,
}

/// The instance API lives on the same worker as the Discord backend, so the
/// base URL is derived from `discord_token_exchange_url` (no new setting).
fn api_base(settings: &LauncherSettings) -> AppResult<String> {
    let raw = settings.discord_token_exchange_url.trim();
    if raw.is_empty() {
        return Err(AppError::from(
            "No hay una URL de backend configurada. Configúrala en Ajustes.",
        ));
    }
    let url = reqwest::Url::parse(raw)
        .map_err(|_| AppError::from("La URL del backend no es válida."))?;
    Ok(url.origin().ascii_serialization())
}

fn publish_token(settings: &LauncherSettings) -> AppResult<String> {
    let token = settings.publish_token.trim().to_string();
    if token.is_empty() {
        return Err(AppError::from(
            "Configura el token de publicación en Ajustes (solo administradores).",
        ));
    }
    Ok(token)
}

fn sha256_file(path: &Path) -> AppResult<String> {
    use std::io::Read;
    let mut hasher = Sha256::new();
    let mut file = std::fs::File::open(path)?;
    let mut buf = [0u8; 1024 * 1024];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

fn loader_str(loader: &LoaderType) -> &'static str {
    match loader {
        LoaderType::Vanilla => "vanilla",
        LoaderType::Fabric => "fabric",
    }
}

fn collect_files(root: &Path, prefix: &str, out: &mut Vec<(String, PathBuf)>) -> AppResult<()> {
    if !root.exists() {
        return Ok(());
    }
    for entry in std::fs::read_dir(root)? {
        let entry = entry?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let rel = if prefix.is_empty() {
            name.clone()
        } else {
            format!("{prefix}/{name}")
        };
        if path.is_dir() {
            collect_files(&path, &rel, out)?;
        } else {
            out.push((rel, path));
        }
    }
    Ok(())
}

/// Builds the portable zip for an instance: `instance/...` (mods, config,
/// etc.), `minecraft/versions/<ver>/...`, `minecraft/libraries/...` and
/// `minecraft/assets/...`. Extraction simply overlays these onto the shared
/// Minecraft root, skipping files that already exist.
fn build_zip(instance: &InstanceConfig, out: &Path, mut on_file: impl FnMut(String, u64, u64)) -> AppResult<()> {
    let file = std::fs::File::create(out)?;
    let mut zip = zip::ZipWriter::new(file);
    let opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    let mut entries: Vec<(String, PathBuf)> = Vec::new();
    collect_files(&AppPaths::instance_dir(&instance.id), "instance", &mut entries)?;
    collect_files(
        &AppPaths::versions_dir().join(&instance.version),
        &format!("minecraft/versions/{}", instance.version),
        &mut entries,
    )?;
    if instance.version_cache_key() != instance.version {
        collect_files(
            &AppPaths::versions_dir().join(instance.version_cache_key()),
            &format!("minecraft/versions/{}", instance.version_cache_key()),
            &mut entries,
        )?;
    }
    collect_files(&AppPaths::libraries_dir(), "minecraft/libraries", &mut entries)?;
    collect_files(&AppPaths::assets_dir(), "minecraft/assets", &mut entries)?;

    let total: u64 = entries
        .iter()
        .filter_map(|(_, p)| std::fs::metadata(p).ok())
        .map(|m| m.len())
        .sum();

    let mut done: u64 = 0;
    for (rel, path) in entries {
        let len = std::fs::metadata(&path)?.len();
        zip.start_file(&rel, opts).map_err(AppError::from)?;
        let mut source = std::fs::File::open(&path)?;
        std::io::copy(&mut source, &mut zip).map_err(AppError::from)?;
        done += len;
        on_file(rel, done, total);
    }
    let file = zip.finish().map_err(AppError::from)?;
    file.sync_all()?;
    Ok(())
}

/// Extracts a published zip: `minecraft/**` goes to the shared root,
/// `instance/**` goes to the new instance's folder. Entries already present
/// with the same size are skipped so repeated libraries/assets don't rewrite.
fn extract_zip(zip_path: &Path, new_instance_id: &str, mut on_file: impl FnMut(String, u64, u64)) -> AppResult<()> {
    let file = std::fs::File::open(zip_path)?;
    let mut archive = zip::ZipArchive::new(file).map_err(AppError::from)?;
    let instance_dir = AppPaths::instance_dir(new_instance_id);

    let mut total: u64 = 0;
    for i in 0..archive.len() {
        let entry = archive.by_index(i).map_err(AppError::from)?;
        let Some(rel) = entry.enclosed_name().map(|p| p.to_path_buf()) else {
            continue;
        };
        if rel.strip_prefix("minecraft").is_ok() || rel.strip_prefix("instance").is_ok() {
            total += entry.size();
        }
    }

    let mut done: u64 = 0;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(AppError::from)?;
        let Some(rel) = entry.enclosed_name().map(|p| p.to_path_buf()) else {
            continue;
        };
        let size = entry.size();
        let (target_root, inner) = if let Ok(p) = rel.strip_prefix("minecraft") {
            (AppPaths::minecraft_root(), p.to_path_buf())
        } else if let Ok(p) = rel.strip_prefix("instance") {
            (instance_dir.clone(), p.to_path_buf())
        } else {
            continue;
        };
        let target = target_root.join(inner);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)?;
        }
        if size > 0 {
            if let Ok(meta) = std::fs::metadata(&target) {
                if meta.len() == size {
                    done += size;
                    on_file(rel.display().to_string(), done, total);
                    continue;
                }
            }
        }
        let mut out = std::fs::File::create(&target)?;
        std::io::copy(&mut entry, &mut out)?;
        done += size;
        on_file(rel.display().to_string(), done, total);
    }
    Ok(())
}

/// Shared authorization check for both listing and installing: is this
/// viewer allowed to see/install `inst` given its whitelist settings? When
/// `whitelist_enabled` is false the instance is public — no Discord ID,
/// no extra config, visible to everyone automatically.
pub fn is_visible_to(inst: &RemoteInstance, viewer_discord_id: Option<&str>, viewer_is_admin: bool) -> bool {
    if !inst.whitelist_enabled || viewer_is_admin {
        return true;
    }
    match viewer_discord_id {
        Some(id) => inst.allowed_discord_ids.iter().any(|allowed| allowed == id),
        None => false,
    }
}

/// Lists published instances, hiding whitelisted ones from anyone who
/// isn't on their `allowed_discord_ids` list (launcher admins always see
/// everything, so they can manage instances they can't personally play).
///
/// NOTE: this filtering happens client-side because the reference worker
/// bundled in this repo (`backend-example/discord-oauth-worker`) doesn't
/// implement the `/instances` catalog at all — the real one lives outside
/// this project. That means a modified/patched client could still request
/// the unfiltered list directly from the worker. For real privacy (not
/// just hiding it in the normal UI), the production worker's `/instances`
/// endpoint needs to do this same `whitelistEnabled`/`allowedDiscordIds`
/// check itself before returning results.
pub async fn list(
    client: &Client,
    settings: &LauncherSettings,
    viewer_discord_id: Option<&str>,
    viewer_is_admin: bool,
) -> AppResult<Vec<RemoteInstance>> {
    let mut all: Vec<RemoteInstance> = Vec::new();

    // 1. Intentar el endpoint {base}/instances o {base}/api.php?action=rows&table=instances
    if let Ok(base) = api_base(settings) {
        if let Ok(resp) = client.get(format!("{base}/instances")).send().await {
            if resp.status().is_success() {
                if let Ok(instances) = resp.json::<Vec<RemoteInstance>>().await {
                    all = instances;
                }
            }
        }

        if all.is_empty() {
            if let Ok(resp) = client.get(format!("{base}/api.php?action=rows&table=instances")).send().await {
                if resp.status().is_success() {
                    #[derive(Deserialize)]
                    struct ApiResponse {
                        rows: Vec<RemoteInstance>,
                    }
                    if let Ok(data) = resp.json::<ApiResponse>().await {
                        all = data.rows;
                    }
                }
            }
        }
    }

    // 2. Si la lista sigue vacía, consultar la API REST de Supabase directamente
    if all.is_empty() {
        let supabase_url = "https://tryqwbidrcmdhkyllxti.supabase.co/rest/v1/instances?select=*";
        let supabase_key = "sb_publishable_f-pNX3Wp-nBVXV2T7oJbHA_BGBCIdC7";
        if let Ok(resp) = client
            .get(supabase_url)
            .header("apikey", supabase_key)
            .send()
            .await
        {
            if resp.status().is_success() {
                if let Ok(instances) = resp.json::<Vec<RemoteInstance>>().await {
                    all = instances;
                }
            }
        }
    }

    let visible = all
        .into_iter()
        .filter(|inst| is_visible_to(inst, viewer_discord_id, viewer_is_admin))
        .collect();
    Ok(visible)
}

pub async fn get(client: &Client, settings: &LauncherSettings, id: &str) -> AppResult<RemoteInstance> {
    let all = list(client, settings, None, true).await?;
    all.into_iter()
        .find(|inst| inst.id == id)
        .ok_or_else(|| AppError::from(format!("Instancia remota no encontrada: {id}")))
}

pub async fn publish(
    client: &Client,
    settings: &LauncherSettings,
    instance_id: &str,
    app: &tauri::AppHandle,
    instances: &InstanceStore,
) -> AppResult<RemoteInstance> {
    let base = api_base(settings)?;
    let token = publish_token(settings)?;
    let instance = instances
        .get(instance_id)
        .ok_or_else(|| AppError::from("Instance not found"))?;

    let emit = |stage: &str, file: Option<String>, done: u64, total: u64, log: String| {
        emit_progress(
            app,
            DownloadProgress {
                instance_id: format!("publish:{}", instance.id),
                stage: stage.to_string(),
                file_name: file,
                downloaded_bytes: done,
                total_bytes: total,
                speed_bps: 0,
                eta_seconds: 0,
                log,
            },
        );
    };

    emit("publish", None, 0, 0, "Empaquetando instancia...".into());
    let zip_path = AppPaths::cache_dir().join(format!("publish_{}.zip", instance.id));
    std::fs::create_dir_all(AppPaths::cache_dir()).ok();
    build_zip(&instance, &zip_path, |file, done, total| {
        emit("publish", Some(file.clone()), done, total, format!("Empaquetando {file}"));
    })?;

    let size = std::fs::metadata(&zip_path)?.len();
    let sha = sha256_file(&zip_path)?;

    let init: UploadInit = client
        .post(format!("{base}/instances/upload/init"))
        .bearer_auth(&token)
        .json(&serde_json::json!({ "id": instance.id }))
        .send()
        .await?
        .error_for_status()
        .map_err(|e| AppError::from(format!("No se pudo iniciar la subida: {e}")))?
        .json()
        .await?;

    let mut file = tokio::fs::File::open(&zip_path).await?;
    let mut parts: Vec<serde_json::Value> = Vec::new();
    let mut done: u64 = 0;
    let mut part_number: u32 = 1;
    loop {
        let mut buf = vec![0u8; REMOTE_PART_SIZE as usize];
        let n = file.read(&mut buf).await?;
        if n == 0 {
            break;
        }
        buf.truncate(n);

        let signed: PartUrl = client
            .post(format!("{base}/instances/upload/part"))
            .bearer_auth(&token)
            .json(&serde_json::json!({
                "id": instance.id,
                "uploadId": init.upload_id,
                "partNumber": part_number
            }))
            .send()
            .await?
            .error_for_status()
            .map_err(|e| AppError::from(format!("No se pudo firmar la parte {part_number}: {e}")))?
            .json()
            .await?;

        let upload_resp = client
            .put(&signed.url)
            .body(buf)
            .send()
            .await?
            .error_for_status()
            .map_err(|e| AppError::from(format!("Fallo al subir la parte {part_number}: {e}")))?;

        let etag = upload_resp
            .headers()
            .get("etag")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();

        parts.push(serde_json::json!({ "partNumber": part_number, "etag": etag }));
        done += n as u64;
        let pct = if size > 0 { done * 100 / size } else { 0 };
        emit("publish", None, done, size, format!("Subiendo... {pct}%"));
        part_number += 1;
    }

    let result: RemoteInstance = client
        .post(format!("{base}/instances/upload/complete"))
        .bearer_auth(&token)
        .json(&serde_json::json!({
            "id": instance.id,
            "uploadId": init.upload_id,
            "parts": parts,
            "size": size,
            "name": instance.name,
            "version": instance.version,
            "loader": loader_str(&instance.loader),
            "loaderVersion": instance.loader_version,
            "sha256": sha,
            "whitelistEnabled": instance.whitelist_enabled,
            "allowedDiscordIds": instance.allowed_discord_ids
        }))
        .send()
        .await?
        .error_for_status()
        .map_err(|e| AppError::from(format!("No se pudo completar la publicación: {e}")))?
        .json()
        .await?;

    let _ = std::fs::remove_file(&zip_path);
    emit("publish", None, size, size, "Instancia publicada.".into());
    Ok(result)
}

pub async fn install(
    client: &Client,
    settings: &LauncherSettings,
    remote_id: &str,
    app: &tauri::AppHandle,
    instances: &InstanceStore,
) -> AppResult<InstanceConfig> {
    let base = api_base(settings)?;
    let meta = get(client, settings, remote_id).await?;
    let new_id = Uuid::new_v4().to_string();
    let zip_path = AppPaths::cache_dir().join(format!("remote_{remote_id}.zip"));
    std::fs::create_dir_all(AppPaths::cache_dir()).ok();

    let emit = |stage: &str, file: Option<String>, done: u64, total: u64, log: String| {
        emit_progress(
            app,
            DownloadProgress {
                instance_id: format!("remote:{remote_id}"),
                stage: stage.to_string(),
                file_name: file,
                downloaded_bytes: done,
                total_bytes: total,
                speed_bps: 0,
                eta_seconds: 0,
                log,
            },
        );
    };

    emit("download", None, 0, 0, format!("Descargando {}...", meta.name));
    let resp = client
        .get(format!("{base}/instances/{remote_id}/download"))
        .send()
        .await?
        .error_for_status()
        .map_err(|e| AppError::from(format!("Error al descargar la instancia: {e}")))?;
    let total = resp.content_length().unwrap_or(0);

    let mut stream = resp.bytes_stream();
    let mut out = tokio::fs::File::create(&zip_path).await?;
    let mut done: u64 = 0;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        out.write_all(&chunk).await?;
        done += chunk.len() as u64;
        let pct = if total > 0 { done * 100 / total } else { 0 };
        emit("download", None, done, total, format!("Descargando... {pct}%"));
    }
    out.flush().await?;

    // Verificación SHA-256: solo ejecutar si el servidor proporcionó un hash
    // (las instancias obtenidas directamente de Supabase no tienen columna sha256,
    // por lo que el campo llega vacío — omitir la verificación en ese caso).
    if !meta.sha256.is_empty() {
        let actual = sha256_file(&zip_path)?;
        if !meta.sha256.eq_ignore_ascii_case(&actual) {
            let _ = std::fs::remove_file(&zip_path);
            tracing::error!(
                "SHA-256 mismatch for instance {remote_id}: expected={} got={}",
                meta.sha256,
                actual
            );
            return Err(AppError::from(
                "La descarga no pasó la verificación SHA-256. Inténtalo de nuevo.",
            ));
        }
        tracing::info!("SHA-256 verified OK for instance {remote_id}");
    } else {
        tracing::warn!(
            "Instancia {remote_id} no tiene SHA-256 registrado — verificación de integridad omitida."
        );
    }

    emit("extract", None, 0, 0, "Extrayendo instancia...".into());
    extract_zip(&zip_path, &new_id, |file, done, total| {
        emit("extract", Some(file), done, total, "Extrayendo instancia...".into());
    })?;
    let _ = std::fs::remove_file(&zip_path);

    let loader = match meta.loader.as_str() {
        "fabric" => LoaderType::Fabric,
        _ => LoaderType::Vanilla,
    };

    let config = InstanceConfig {
        id: new_id.clone(),
        name: meta.name.clone(),
        version: meta.version.clone(),
        loader,
        loader_version: meta.loader_version.clone(),
        directory: AppPaths::instance_dir(&new_id).to_string_lossy().to_string(),
        cover_image: None,
        ram_mb: 4096,
        jvm_args: String::new(),
        custom_java_path: None,
        fullscreen: false,
        resolution_width: 854,
        resolution_height: 480,
        created_at: chrono::Utc::now().timestamp_millis(),
        last_played_at: None,
        total_play_ms: 0,
        whitelist_enabled: meta.whitelist_enabled,
        allowed_discord_ids: meta.allowed_discord_ids.clone(),
    };
    instances.insert(config.clone())?;
    Ok(config)
}

pub async fn delete(client: &Client, settings: &LauncherSettings, remote_id: &str) -> AppResult<()> {
    let base = api_base(settings)?;
    let token = publish_token(settings)?;
    client
        .delete(format!("{base}/instances/{remote_id}"))
        .bearer_auth(&token)
        .send()
        .await?
        .error_for_status()
        .map_err(|e| AppError::from(format!("Error al eliminar la instancia: {e}")))?;
    Ok(())
}
