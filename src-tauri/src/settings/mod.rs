use crate::utils::paths::AppPaths;
use crate::utils::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::sync::RwLock;

/// Detecta la RAM total del sistema en MB.
/// Soporta Windows, Linux y macOS. Retorna 4096 MB como fallback.
pub fn get_available_ram_mb() -> u32 {
    #[cfg(target_os = "windows")]
    {
        #[repr(C)]
        #[allow(non_snake_case)]
        struct MEMORYSTATUSEX {
            dwLength: u32,
            dwMemoryLoad: u32,
            ullTotalPhys: u64,
            ullAvailPhys: u64,
            ullTotalPageFile: u64,
            ullAvailPageFile: u64,
            ullTotalVirtual: u64,
            ullAvailVirtual: u64,
            ullAvailExtendedVirtual: u64,
        }
        #[link(name = "kernel32")]
        extern "system" {
            fn GlobalMemoryStatusEx(lpBuffer: *mut MEMORYSTATUSEX) -> i32;
        }
        let mut s = MEMORYSTATUSEX {
            dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
            dwMemoryLoad: 0, ullTotalPhys: 0, ullAvailPhys: 0,
            ullTotalPageFile: 0, ullAvailPageFile: 0,
            ullTotalVirtual: 0, ullAvailVirtual: 0, ullAvailExtendedVirtual: 0,
        };
        unsafe {
            if GlobalMemoryStatusEx(&mut s) != 0 {
                // Usar RAM disponible (no total) con un techo de 16 GB
                let available_mb = (s.ullAvailPhys / (1024 * 1024)) as u32;
                return available_mb.min(16384);
            }
        }
    }
    #[cfg(target_os = "linux")]
    {
        if let Ok(meminfo) = std::fs::read_to_string("/proc/meminfo") {
            for line in meminfo.lines() {
                if line.starts_with("MemTotal:") {
                    if let Some(kb) = line.split_whitespace().nth(1).and_then(|s| s.parse::<u32>().ok()) {
                        return (kb / 1024).min(16384);
                    }
                }
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        if let Ok(out) = Command::new("sysctl").args(["-n", "hw.memsize"]).output() {
            if let Ok(s) = std::str::from_utf8(&out.stdout) {
                if let Ok(bytes) = s.trim().parse::<u64>() {
                    return ((bytes / (1024 * 1024)) as u32).min(16384);
                }
            }
        }
    }
    4096
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LauncherSettings {
    pub max_ram_mb: u32,
    /// RAM del sistema detectable — se rellena al arrancar el launcher
    /// y se envía al frontend para que el slider muestre límites reales.
    #[serde(default)]
    pub system_ram_mb: u32,
    pub minecraft_path: String,
    pub java_path: String,
    pub theme: String,
    pub language: String,
    pub interface_fps: u32,
    pub auto_update: bool,
    /// Admin-only token used to publish/delete instances on the remote
    /// catalog (sent as a Bearer token to the backend worker).
    #[serde(default)]
    pub publish_token: String,
    /// Admin-only token for administrative endpoints.
    #[serde(default)]
    pub admin_token: String,
    /// Base URL of the backend worker (Discord token exchange). The admin
    /// user-management API and the remote instance catalog derive their
    /// origin from this value, so a single setting serves all of them.
    #[serde(default)]
    pub discord_token_exchange_url: String,
}

impl Default for LauncherSettings {
    fn default() -> Self {
        // Calcular RAM óptima: 75% de la RAM disponible, techo de 8 GB
        let system_ram = get_available_ram_mb();
        let optimal_ram = ((system_ram as f64 * 0.75) as u32).min(8192).max(2048);
        Self {
            max_ram_mb: optimal_ram,
            system_ram_mb: system_ram,
            minecraft_path: String::new(),
            java_path: String::new(),
            theme: "dark".to_string(),
            language: "es".to_string(),
            interface_fps: 60,
            auto_update: true,
            publish_token: String::new(),
            admin_token: String::new(),
            discord_token_exchange_url: "http://102.129.137.65:25623".to_string(),
        }
    }
}

/// Thread-safe in-memory settings cache backed by a JSON file on disk.
/// Every command that touches settings goes through this store rather than
/// reading/writing the file directly, avoiding races between concurrent
/// invokes from the frontend.
pub struct SettingsStore {
    inner: RwLock<LauncherSettings>,
}

impl SettingsStore {
    pub fn load() -> Self {
        let path = AppPaths::settings_file();
        let mut settings: LauncherSettings = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        // Siempre refrescar la RAM del sistema al arrancar — el hardware puede
        // haber cambiado entre sesiones y no queremos mostrar valores stale.
        settings.system_ram_mb = get_available_ram_mb();
        if settings.discord_token_exchange_url.trim().is_empty() {
            settings.discord_token_exchange_url = "http://102.129.137.65:25623".to_string();
        }
        Self {
            inner: RwLock::new(settings),
        }
    }

    pub fn get(&self) -> LauncherSettings {
        self.inner.read().unwrap().clone()
    }

    pub fn save(&self, settings: LauncherSettings) -> AppResult<()> {
        let path = AppPaths::settings_file();
        let json = serde_json::to_string_pretty(&settings)?;
        std::fs::write(path, json).map_err(AppError::from)?;
        *self.inner.write().unwrap() = settings;
        Ok(())
    }

    pub fn reset(&self) -> AppResult<LauncherSettings> {
        let defaults = LauncherSettings::default();
        self.save(defaults.clone())?;
        Ok(defaults)
    }
}
