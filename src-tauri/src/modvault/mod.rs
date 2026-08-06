//! Protected mod storage and vault management.
//!
//! Admins can manage "protected" mods. Unlike a mod placed directly in the
//! instance's `mods/` folder, these:
//!
//! 1. Never exist as plain files a player can browse to, copy, or share —
//!    they're stored AES-256-GCM encrypted under the launcher's own data
//!    directory (`vault/`), completely separate from any instance folder.
//! 2. Are decrypted only into a throwaway, hidden runtime folder right before
//!    the game process starts, and that folder is wiped again as soon as the
//!    game exits (and pre-emptively wiped at launcher boot).
//! 3. Are loaded transparently via Fabric Loader's own `-Dfabric.addMods`
//!    mechanism, which lets Fabric pull mods from an arbitrary folder
//!    without that folder being the instance's `mods/` directory.

use crate::utils::paths::AppPaths;
use crate::utils::{AppError, AppResult};
use aes_gcm::aead::{generic_array::GenericArray, Aead, KeyInit};
use aes_gcm::Aes256Gcm;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::Write;
use std::path::PathBuf;
use std::sync::RwLock;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultModEntry {
    pub id: String,
    pub instance_id: String,
    pub name: String,
    pub version: String,
    pub original_name: String,
    pub size_bytes: u64,
    pub is_mandatory: bool,
    pub added_at: i64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct VaultManifest {
    mods: Vec<VaultModEntry>,
}

pub struct ModVault {
    inner: RwLock<VaultManifest>,
}

fn derive_key() -> [u8; 32] {
    let machine = machine_uid::get().unwrap_or_else(|_| "soulclient-fallback-machine".to_string());
    let mut hasher = Sha256::new();
    hasher.update(b"soulclient-modvault-v2::");
    hasher.update(machine.as_bytes());
    let digest = hasher.finalize();
    let mut key = [0u8; 32];
    key.copy_from_slice(&digest);
    key
}

fn hide_directory(path: &std::path::Path) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: `attrib` is a console-subsystem exe, so without
        // this flag Windows pops up a brand-new terminal window for it every
        // time a session with protected mods launches.
        let _ = std::process::Command::new("attrib")
            .arg("+H")
            .arg("+S")
            .arg(path)
            .creation_flags(0x0800_0000)
            .output();
    }
}

impl ModVault {
    pub fn load() -> Self {
        let data = std::fs::read_to_string(AppPaths::vault_manifest_file())
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        Self {
            inner: RwLock::new(data),
        }
    }

    fn persist(&self, data: &VaultManifest) -> AppResult<()> {
        let json = serde_json::to_string_pretty(data)?;
        std::fs::write(AppPaths::vault_manifest_file(), json).map_err(AppError::from)
    }

    pub fn list_all(&self) -> Vec<VaultModEntry> {
        self.inner.read().unwrap().mods.clone()
    }

    pub fn list(&self, instance_id: &str) -> Vec<VaultModEntry> {
        self.inner
            .read()
            .unwrap()
            .mods
            .iter()
            .filter(|m| m.instance_id == instance_id || m.instance_id == "*" || m.instance_id.is_empty())
            .cloned()
            .collect()
    }

    pub fn add(
        &self,
        instance_id: &str,
        source: &std::path::Path,
        custom_name: Option<String>,
        custom_version: Option<String>,
        is_mandatory: bool,
    ) -> AppResult<VaultModEntry> {
        if !source.is_file() {
            return Err(AppError::from("El archivo del mod no existe."));
        }
        let original_name = source
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("mod.jar")
            .to_string();
        if !original_name.to_lowercase().ends_with(".jar") {
            return Err(AppError::from("Solo se aceptan archivos .jar."));
        }

        let name = custom_name.unwrap_or_else(|| {
            original_name.trim_end_matches(".jar").trim_end_matches(".JAR").to_string()
        });
        let version = custom_version.unwrap_or_else(|| "1.0.0".to_string());

        let plaintext = std::fs::read(source).map_err(AppError::from)?;

        let key = derive_key();
        let cipher = Aes256Gcm::new(GenericArray::from_slice(&key));
        let mut nonce_bytes = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut nonce_bytes);
        let nonce = GenericArray::from_slice(&nonce_bytes);
        let ciphertext = cipher
            .encrypt(nonce, plaintext.as_ref())
            .map_err(|_| AppError::from("No se pudo cifrar el mod."))?;

        let id = Uuid::new_v4().to_string();
        let dest = AppPaths::vault_dir().join(format!("{id}.enc"));
        let mut file = std::fs::File::create(&dest).map_err(AppError::from)?;
        file.write_all(&nonce_bytes).map_err(AppError::from)?;
        file.write_all(&ciphertext).map_err(AppError::from)?;

        let entry = VaultModEntry {
            id,
            instance_id: instance_id.to_string(),
            name,
            version,
            original_name,
            size_bytes: plaintext.len() as u64,
            is_mandatory,
            added_at: chrono::Utc::now().timestamp_millis(),
        };

        let mut data = self.inner.write().unwrap();
        data.mods.push(entry.clone());
        self.persist(&data)?;
        Ok(entry)
    }

    pub fn update(
        &self,
        mod_id: &str,
        source: Option<&std::path::Path>,
        version: Option<String>,
        is_mandatory: Option<bool>,
    ) -> AppResult<VaultModEntry> {
        let mut data = self.inner.write().unwrap();
        let pos = data
            .mods
            .iter()
            .position(|m| m.id == mod_id)
            .ok_or_else(|| AppError::from("Mod no encontrado en la bóveda."))?;

        if let Some(src) = source {
            if !src.is_file() {
                return Err(AppError::from("El nuevo archivo del mod no existe."));
            }
            let plaintext = std::fs::read(src).map_err(AppError::from)?;
            let key = derive_key();
            let cipher = Aes256Gcm::new(GenericArray::from_slice(&key));
            let mut nonce_bytes = [0u8; 12];
            rand::thread_rng().fill_bytes(&mut nonce_bytes);
            let nonce = GenericArray::from_slice(&nonce_bytes);
            let ciphertext = cipher
                .encrypt(nonce, plaintext.as_ref())
                .map_err(|_| AppError::from("No se pudo cifrar el mod."))?;

            let dest = AppPaths::vault_dir().join(format!("{mod_id}.enc"));
            let mut file = std::fs::File::create(&dest).map_err(AppError::from)?;
            file.write_all(&nonce_bytes).map_err(AppError::from)?;
            file.write_all(&ciphertext).map_err(AppError::from)?;

            data.mods[pos].size_bytes = plaintext.len() as u64;
            if let Some(orig) = src.file_name().and_then(|n| n.to_str()) {
                data.mods[pos].original_name = orig.to_string();
            }
        }

        if let Some(v) = version {
            data.mods[pos].version = v;
        }

        if let Some(m) = is_mandatory {
            data.mods[pos].is_mandatory = m;
        }

        let updated = data.mods[pos].clone();
        self.persist(&data)?;
        Ok(updated)
    }

    pub fn remove(&self, mod_id: &str) -> AppResult<()> {
        let mut data = self.inner.write().unwrap();
        if let Some(pos) = data.mods.iter().position(|m| m.id == mod_id) {
            let _ = std::fs::remove_file(AppPaths::vault_dir().join(format!("{mod_id}.enc")));
            data.mods.remove(pos);
        }
        self.persist(&data)
    }

    /// Decrypts protected mods for `instance_id` into an isolated, hidden runtime folder.
    pub fn stage_for_launch(&self, instance_id: &str) -> AppResult<Option<PathBuf>> {
        let entries = self.list(instance_id);
        if entries.is_empty() {
            return Ok(None);
        }

        let runtime_dir = AppPaths::runtime_mods_dir(instance_id);
        let _ = std::fs::remove_dir_all(&runtime_dir);
        std::fs::create_dir_all(&runtime_dir).map_err(AppError::from)?;
        hide_directory(&runtime_dir);

        let key = derive_key();
        let cipher = Aes256Gcm::new(GenericArray::from_slice(&key));

        for entry in entries {
            let path = AppPaths::vault_dir().join(format!("{}.enc", entry.id));
            let raw = match std::fs::read(&path) {
                Ok(r) => r,
                Err(_) => continue,
            };
            if raw.len() < 12 {
                continue;
            }
            let (nonce_bytes, ciphertext) = raw.split_at(12);
            let nonce = GenericArray::from_slice(nonce_bytes);
            let plaintext = match cipher.decrypt(nonce, ciphertext) {
                Ok(p) => p,
                Err(_) => continue,
            };

            let dest_file = runtime_dir.join(&entry.original_name);
            std::fs::write(&dest_file, plaintext).map_err(AppError::from)?;
        }

        Ok(Some(runtime_dir))
    }

    pub fn cleanup_runtime(instance_id: &str) {
        let _ = std::fs::remove_dir_all(AppPaths::runtime_mods_dir(instance_id));
    }
}

