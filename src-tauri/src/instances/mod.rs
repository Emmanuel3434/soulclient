use crate::utils::paths::AppPaths;
use crate::utils::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::sync::RwLock;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum LoaderType {
    Vanilla,
    Fabric,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceConfig {
    pub id: String,
    pub name: String,
    pub version: String,
    pub loader: LoaderType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub loader_version: Option<String>,
    pub directory: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_image: Option<String>,
    pub ram_mb: u32,
    pub jvm_args: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_java_path: Option<String>,
    pub fullscreen: bool,
    pub resolution_width: u32,
    pub resolution_height: u32,
    pub created_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_played_at: Option<i64>,
    pub total_play_ms: i64,
    /// When true, this instance is hidden from every user that isn't in
    /// `allowed_discord_ids` (or a launcher admin) once published to the
    /// remote catalog. See `remote::list` for the enforcement.
    #[serde(default)]
    pub whitelist_enabled: bool,
    /// Discord user IDs allowed to see/install this instance while
    /// `whitelist_enabled` is true. Ignored otherwise.
    #[serde(default)]
    pub allowed_discord_ids: Vec<String>,
    /// Catalog/remote id this local instance was installed from (if any).
    /// Used to sync that instance's protected mods from the panel.
    #[serde(default)]
    pub remote_id: Option<String>,
}

impl InstanceConfig {
    /// Cache key for the resolved (and, for Fabric, loader-merged) version
    /// JSON on disk. Vanilla instances share the plain MC version folder;
    /// Fabric instances get their own `{version}-fabric-{loader_version}`
    /// folder.
    ///
    /// BUG FIX: previously both `ensure_version_installed` and
    /// `launch_instance` used the bare `instance.version` (e.g. "1.20.1")
    /// for this cache path, with no mention of the loader at all. Two
    /// instances that target the same Minecraft version — one Vanilla, one
    /// Fabric (or two Fabric instances pinned to different loader
    /// versions) — silently overwrote *each other's* cached
    /// `{version}.json` on disk, since it's a single shared file per MC
    /// version. Whichever instance's "Play" ran `ensure_version_installed`
    /// last "won" for every instance sharing that version, which is
    /// exactly the kind of thing that makes a Fabric instance intermittently
    /// launch as vanilla (mainClass/libraries silently reverted) with no
    /// mods loaded. Keying the cache by loader + loader version as well
    /// makes that collision structurally impossible.
    pub fn version_cache_key(&self) -> String {
        match self.loader {
            LoaderType::Vanilla => self.version.clone(),
            LoaderType::Fabric => format!(
                "{}-fabric-{}",
                self.version,
                self.loader_version.as_deref().unwrap_or("latest")
            ),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceDraft {
    pub name: String,
    pub version: String,
    pub loader: LoaderType,
    pub loader_version: Option<String>,
    pub directory: String,
    pub cover_image: Option<String>,
    pub ram_mb: u32,
    pub jvm_args: String,
    pub custom_java_path: Option<String>,
    pub fullscreen: bool,
    pub resolution_width: u32,
    pub resolution_height: u32,
    #[serde(default)]
    pub whitelist_enabled: bool,
    #[serde(default)]
    pub allowed_discord_ids: Vec<String>,
}

/// JSON-file-backed CRUD store for instances, analogous to `AccountStore`.
pub struct InstanceStore {
    inner: RwLock<Vec<InstanceConfig>>,
}

impl InstanceStore {
    pub fn load() -> Self {
        let data = std::fs::read_to_string(AppPaths::instances_file())
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        Self {
            inner: RwLock::new(data),
        }
    }

    fn persist(&self, data: &[InstanceConfig]) -> AppResult<()> {
        let json = serde_json::to_string_pretty(data)?;
        std::fs::write(AppPaths::instances_file(), json).map_err(AppError::from)
    }

    pub fn list(&self) -> Vec<InstanceConfig> {
        self.inner.read().unwrap().clone()
    }

    pub fn get(&self, id: &str) -> Option<InstanceConfig> {
        self.inner.read().unwrap().iter().find(|i| i.id == id).cloned()
    }

    /// Persists an already-built instance config (used when installing a
    /// prebuilt instance downloaded from the remote catalog, where the id
    /// and directory were decided ahead of extraction).
    pub fn insert(&self, instance: InstanceConfig) -> AppResult<InstanceConfig> {
        let mut data = self.inner.write().unwrap();
        data.push(instance.clone());
        self.persist(&data)?;
        Ok(instance)
    }

    pub fn create(&self, draft: InstanceDraft) -> AppResult<InstanceConfig> {
        self.create_with_id(Uuid::new_v4().to_string(), draft)
    }

    /// Same as `create`, but lets the caller decide the id ahead of time
    /// (used so a cover image can be adopted into `covers/<id>.<ext>`
    /// before the record is persisted).
    pub fn create_with_id(&self, id: String, draft: InstanceDraft) -> AppResult<InstanceConfig> {
        let directory = if draft.directory.trim().is_empty() {
            AppPaths::instance_dir(&id).to_string_lossy().to_string()
        } else {
            draft.directory
        };

        let instance = InstanceConfig {
            id,
            name: draft.name,
            version: draft.version,
            loader: draft.loader,
            loader_version: draft.loader_version,
            directory,
            cover_image: draft.cover_image,
            ram_mb: draft.ram_mb,
            jvm_args: draft.jvm_args,
            custom_java_path: draft.custom_java_path,
            fullscreen: draft.fullscreen,
            resolution_width: draft.resolution_width,
            resolution_height: draft.resolution_height,
            created_at: chrono::Utc::now().timestamp_millis(),
            last_played_at: None,
            total_play_ms: 0,
            whitelist_enabled: draft.whitelist_enabled,
            allowed_discord_ids: draft.allowed_discord_ids,
        };

        let mut data = self.inner.write().unwrap();
        data.push(instance.clone());
        self.persist(&data)?;
        Ok(instance)
    }

    pub fn update(&self, instance: InstanceConfig) -> AppResult<InstanceConfig> {
        let mut data = self.inner.write().unwrap();
        if let Some(existing) = data.iter_mut().find(|i| i.id == instance.id) {
            *existing = instance.clone();
        } else {
            return Err(AppError::from("Instance not found"));
        }
        self.persist(&data)?;
        Ok(instance)
    }

    pub fn delete(&self, id: &str) -> AppResult<()> {
        let mut data = self.inner.write().unwrap();
        data.retain(|i| i.id != id);
        self.persist(&data)
    }

    pub fn mark_played(&self, id: &str) -> AppResult<()> {
        let mut data = self.inner.write().unwrap();
        if let Some(instance) = data.iter_mut().find(|i| i.id == id) {
            instance.last_played_at = Some(chrono::Utc::now().timestamp_millis());
        }
        self.persist(&data)
    }
}
