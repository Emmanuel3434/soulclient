use directories::ProjectDirs;
use std::path::PathBuf;

/// Resolves every well-known directory the launcher writes to. Centralizing
/// this means we never scatter `format!("{home}/.soulclient/...")` calls
/// across modules.
pub struct AppPaths;

impl AppPaths {
    fn project_dirs() -> ProjectDirs {
        ProjectDirs::from("com", "soulclient", "SoulClient")
            .expect("failed to resolve platform config directory")
    }

    /// Root folder for everything the launcher owns (accounts, settings, logs).
    pub fn launcher_root() -> PathBuf {
        let dir = Self::project_dirs().data_dir().to_path_buf();
        std::fs::create_dir_all(&dir).ok();
        dir
    }

    /// Default Minecraft installation root (versions, libraries, assets),
    /// overridable per-instance and globally via settings.
    pub fn minecraft_root() -> PathBuf {
        let dir = Self::launcher_root().join("minecraft");
        std::fs::create_dir_all(&dir).ok();
        dir
    }

    pub fn instances_dir() -> PathBuf {
        let dir = Self::launcher_root().join("instances");
        std::fs::create_dir_all(&dir).ok();
        dir
    }

    pub fn instance_dir(instance_id: &str) -> PathBuf {
        let dir = Self::instances_dir().join(instance_id);
        std::fs::create_dir_all(&dir).ok();
        dir
    }

    pub fn versions_dir() -> PathBuf {
        let dir = Self::minecraft_root().join("versions");
        std::fs::create_dir_all(&dir).ok();
        dir
    }

    pub fn libraries_dir() -> PathBuf {
        let dir = Self::minecraft_root().join("libraries");
        std::fs::create_dir_all(&dir).ok();
        dir
    }

    pub fn assets_dir() -> PathBuf {
        let dir = Self::minecraft_root().join("assets");
        std::fs::create_dir_all(&dir).ok();
        dir
    }

    pub fn java_dir() -> PathBuf {
        let dir = Self::launcher_root().join("java");
        std::fs::create_dir_all(&dir).ok();
        dir
    }

    pub fn cache_dir() -> PathBuf {
        let dir = Self::launcher_root().join("cache");
        std::fs::create_dir_all(&dir).ok();
        dir
    }

    /// Where instance cover images are copied to once picked, so the
    /// launcher owns a stable copy instead of depending on a user-chosen
    /// file that could later move, be renamed, or be deleted.
    pub fn covers_dir() -> PathBuf {
        let dir = Self::launcher_root().join("covers");
        std::fs::create_dir_all(&dir).ok();
        dir
    }

    /// Encrypted, admin-only mod storage. Files here never sit inside an
    /// instance's own `mods` folder; they're decrypted into a temporary
    /// runtime folder only for the duration of a play session (see
    /// `modvault`).
    pub fn vault_dir() -> PathBuf {
        let dir = Self::launcher_root().join("vault");
        std::fs::create_dir_all(&dir).ok();
        dir
    }

    pub fn vault_manifest_file() -> PathBuf {
        Self::vault_dir().join("manifest.json")
    }

    /// Scratch folder where vault mods are decrypted right before launch
    /// and wiped right after. Kept outside any instance directory so it
    /// never shows up when a player browses their instance's files.
    pub fn runtime_mods_dir(instance_id: &str) -> PathBuf {
        let dir = Self::launcher_root().join(".runtime").join(instance_id).join("mods");
        dir
    }

    /// Where platform-specific natives (LWJGL/GLFW/OpenAL `.dll`/`.so`/`.dylib`
    /// files) get unpacked from their `natives-<os>.jar` before launch. Java
    /// needs these as loose files on disk (`-Djava.library.path`), not
    /// sitting inside a jar, or the game fails to create a window at all.
    pub fn natives_dir(version_id: &str) -> PathBuf {
        let dir = Self::minecraft_root().join("natives").join(version_id);
        std::fs::create_dir_all(&dir).ok();
        dir
    }

    pub fn accounts_file() -> PathBuf {
        Self::launcher_root().join("accounts.json")
    }

    pub fn discord_session_file() -> PathBuf {
        Self::launcher_root().join("discord_session.json")
    }

    pub fn instances_file() -> PathBuf {
        Self::launcher_root().join("instances.json")
    }

    /// Persisted offline-first sync queue: local CRUD ops (instance/mod
    /// upserts and deletes) that still need to be flushed to the backend.
    /// Survives restarts so nothing is lost while offline.
    pub fn sync_queue_file() -> PathBuf {
        Self::launcher_root().join("sync_queue.json")
    }

    pub fn settings_file() -> PathBuf {
        Self::launcher_root().join("settings.json")
    }
}
