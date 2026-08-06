//! Discord Rich Presence ("Jugando SoulClient") integration.
//!
//! This connects over Discord's local IPC socket — it needs the Discord
//! desktop app running on the same machine, but no token, no login, and
//! no extra permissions beyond what the launcher already has. It reuses
//! the launcher's own Discord application ([`auth::discord::CLIENT_ID`]),
//! the same one used for the "sign in with Discord" gate, so the activity
//! shows up under the SoulClient app on the user's Discord profile.
//!
//! The large image (`LARGE_IMAGE_KEY`) has to be uploaded once as a Rich
//! Presence "Art Asset" for this application in the Discord Developer
//! Portal (Application → Rich Presence → Art Assets) — Discord's IPC
//! protocol only accepts asset keys already registered there, not raw
//! image bytes. Upload `src/assets/droplet-mark.png` (the transparent
//! Soul droplet mark) using exactly the key below.

use discord_rich_presence::activity::{Activity, Assets, Timestamps};
use discord_rich_presence::{DiscordIpc, DiscordIpcClient};
use std::sync::Mutex;

use crate::auth::discord::CLIENT_ID;

/// Must match the Art Asset key uploaded in the Discord Developer Portal.
const LARGE_IMAGE_KEY: &str = "soul_drop";
const LARGE_IMAGE_TEXT: &str = "SoulClient";

/// Wraps a `DiscordIpcClient` behind a mutex so it can live in `AppState`
/// and be updated from any command (launching a game, closing it, etc.).
/// Every operation swallows its own errors — Discord might not be
/// running, or the user might not have it installed at all, and none of
/// that should ever block or crash the launcher itself.
pub struct DiscordPresence {
    client: Mutex<Option<DiscordIpcClient>>,
    started_at: Mutex<i64>,
}

impl DiscordPresence {
    pub fn new() -> Self {
        Self {
            client: Mutex::new(None),
            started_at: Mutex::new(chrono::Utc::now().timestamp()),
        }
    }

    fn ensure_connected(&self) -> bool {
        let mut guard = self.client.lock().unwrap();
        if guard.is_some() {
            return true;
        }
        let Ok(mut client) = DiscordIpcClient::new(CLIENT_ID) else {
            return false;
        };
        if client.connect().is_err() {
            return false;
        }
        *guard = Some(client);
        true
    }

    /// Idle state shown at startup and whenever no instance is running.
    pub fn set_idle(&self) {
        if !self.ensure_connected() {
            return;
        }
        let started_at = *self.started_at.lock().unwrap();
        let mut guard = self.client.lock().unwrap();
        if let Some(client) = guard.as_mut() {
            let _ = client.set_activity(
                Activity::new()
                    .details("SoulClient")
                    .state("En el launcher")
                    .assets(
                        Assets::new()
                            .large_image(LARGE_IMAGE_KEY)
                            .large_text(LARGE_IMAGE_TEXT),
                    )
                    .timestamps(Timestamps::new().start(started_at)),
            );
        }
    }

    /// "Playing" state shown while an instance's Minecraft process is
    /// running, with the instance name as the detail line.
    pub fn set_playing(&self, instance_name: &str) {
        if !self.ensure_connected() {
            return;
        }
        let now = chrono::Utc::now().timestamp();
        let mut guard = self.client.lock().unwrap();
        if let Some(client) = guard.as_mut() {
            let _ = client.set_activity(
                Activity::new()
                    .details("Jugando SoulClient")
                    .state(instance_name)
                    .assets(
                        Assets::new()
                            .large_image(LARGE_IMAGE_KEY)
                            .large_text(LARGE_IMAGE_TEXT),
                    )
                    .timestamps(Timestamps::new().start(now)),
            );
        }
    }

    /// Drops the IPC connection entirely (used on logout / app close).
    pub fn shutdown(&self) {
        let mut guard = self.client.lock().unwrap();
        if let Some(mut client) = guard.take() {
            let _ = client.close();
        }
    }
}

impl Default for DiscordPresence {
    fn default() -> Self {
        Self::new()
    }
}
