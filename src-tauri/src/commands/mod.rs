pub mod accounts;
pub mod admin;
pub mod discord;
pub mod instances;
pub mod modvault;
pub mod settings;
pub mod versions;

use crate::auth::{discord::DiscordLoginFlow, AccountStore, DiscordSessionStore};
use crate::instances::InstanceStore;
use crate::modvault::ModVault;
use crate::presence::DiscordPresence;
use crate::settings::SettingsStore;
use std::sync::{Arc, Mutex};

/// Shared application state, injected into every command via `tauri::State`.
/// `http_client` is a single reusable `reqwest::Client` (connection pooling)
/// and `ms_device_flow` holds the in-progress Microsoft device code between
/// the `begin_microsoft_login` / `poll_microsoft_login` calls. `discord_session`
/// and `discord_flow` mirror that same pattern for the launcher's own
/// Discord login gate.
pub struct AppState {
    pub accounts: AccountStore,
    pub instances: InstanceStore,
    pub settings: SettingsStore,
    pub mod_vault: ModVault,
    pub http_client: reqwest::Client,
    pub ms_device_flow: Mutex<Option<crate::auth::microsoft::DeviceCodeResponse>>,
    pub discord_session: DiscordSessionStore,
    pub discord_flow: DiscordLoginFlow,
    /// Discord Rich Presence connection ("Jugando SoulClient"). `Arc`
    /// because it needs to be cloned into the background thread that
    /// waits for a launched Minecraft process to exit.
    pub discord_presence: Arc<DiscordPresence>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            accounts: AccountStore::load(),
            instances: InstanceStore::load(),
            settings: SettingsStore::load(),
            mod_vault: ModVault::load(),
            http_client: reqwest::Client::builder()
                .user_agent("SoulClient/0.1.0")
                .build()
                .expect("failed to build http client"),
            ms_device_flow: Mutex::new(None),
            discord_session: DiscordSessionStore::load(),
            discord_flow: DiscordLoginFlow::default(),
            discord_presence: Arc::new(DiscordPresence::new()),
        }
    }
}
