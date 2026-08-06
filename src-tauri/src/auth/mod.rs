pub mod discord;
pub mod microsoft;
pub mod offline;

use crate::utils::paths::AppPaths;
use crate::utils::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::sync::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AccountType {
    Premium,
    Offline,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    #[serde(rename = "type")]
    pub account_type: AccountType,
    pub username: String,
    pub uuid: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skin_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cape_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub access_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refresh_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<i64>,
    pub added_at: i64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct AccountsFile {
    accounts: Vec<Account>,
    active_account_id: Option<String>,
}

/// Usernames granted launcher-admin rights (create/edit/delete instances,
/// manage the protected mods vault, manage registered users). Extend this
/// list (or load it from a remote config) as the team grows.
const ADMIN_USERNAMES: &[&str] = &["Emanueel"];

/// Whether an account should be treated as a launcher administrator, able
/// to create/edit/delete instances. Computed on every read rather than
/// persisted, so updating `ADMIN_USERNAMES` takes effect immediately for
/// everyone without needing to touch `accounts.json`.
///
/// NOTE: this only compares the username (no Microsoft/Premium check yet —
/// that requires an Azure app registration that isn't set up). The actual
/// protection against someone else just typing "Emanueel" into "Agregar
/// cuenta" lives in the username-uniqueness check against the launcher's
/// shared Supabase registry (see `supabase.ts::isMinecraftUsernameTaken`,
/// enforced in `Accounts.tsx` and in the Discord auto-provisioning flow):
/// once that name is claimed there by one real person, nobody else can
/// register a matching offline account through the normal UI. Once a real
/// Microsoft/Azure login is wired up, tighten this back to also require
/// `AccountType::Premium` so it's enforced locally too, not just via the
/// shared registry.
pub fn is_admin_account(account: &Account) -> bool {
    ADMIN_USERNAMES
        .iter()
        .any(|admin| admin.eq_ignore_ascii_case(&account.username))
}

/// `Account` plus the derived `isAdmin` flag — this is the shape actually
/// sent to the frontend so it never has to duplicate the admin-list logic.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountView {
    #[serde(flatten)]
    pub account: Account,
    pub is_admin: bool,
}

impl From<Account> for AccountView {
    fn from(account: Account) -> Self {
        let is_admin = is_admin_account(&account);
        Self { account, is_admin }
    }
}

/// In-memory account registry backed by `accounts.json`. Access/refresh
/// tokens for premium accounts live here too; for a production build these
/// should be moved into the OS keychain (e.g. via the `keyring` crate)
/// instead of a plain JSON file.
pub struct AccountStore {
    inner: RwLock<AccountsFile>,
}

impl AccountStore {
    pub fn load() -> Self {
        let path = AppPaths::accounts_file();
        let data = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        Self {
            inner: RwLock::new(data),
        }
    }

    fn persist(&self, data: &AccountsFile) -> AppResult<()> {
        let json = serde_json::to_string_pretty(data)?;
        std::fs::write(AppPaths::accounts_file(), json).map_err(AppError::from)
    }

    pub fn list(&self) -> Vec<Account> {
        self.inner.read().unwrap().accounts.clone()
    }

    pub fn list_view(&self) -> Vec<AccountView> {
        self.list().into_iter().map(AccountView::from).collect()
    }

    pub fn active(&self) -> Option<Account> {
        let data = self.inner.read().unwrap();
        let id = data.active_account_id.as_ref()?;
        data.accounts.iter().find(|a| &a.id == id).cloned()
    }

    pub fn active_view(&self) -> Option<AccountView> {
        self.active().map(AccountView::from)
    }

    pub fn get(&self, id: &str) -> Option<Account> {
        self.inner.read().unwrap().accounts.iter().find(|a| a.id == id).cloned()
    }

    pub fn add(&self, account: Account) -> AppResult<()> {
        let mut data = self.inner.write().unwrap();
        data.accounts.push(account);
        if data.active_account_id.is_none() {
            data.active_account_id = data.accounts.last().map(|a| a.id.clone());
        }
        self.persist(&data)
    }

    pub fn remove(&self, id: &str) -> AppResult<()> {
        let mut data = self.inner.write().unwrap();
        data.accounts.retain(|a| a.id != id);
        if data.active_account_id.as_deref() == Some(id) {
            data.active_account_id = None;
        }
        self.persist(&data)
    }

    pub fn set_active(&self, id: &str) -> AppResult<()> {
        let mut data = self.inner.write().unwrap();
        if !data.accounts.iter().any(|a| a.id == id) {
            return Err(AppError::from("Account not found"));
        }
        data.active_account_id = Some(id.to_string());
        self.persist(&data)
    }

    /// Overwrites a single account in place (used after a skin upload or a
    /// premium profile refresh) and returns the updated `AccountView`.
    pub fn update(&self, account: Account) -> AppResult<AccountView> {
        let mut data = self.inner.write().unwrap();
        let existing = data
            .accounts
            .iter_mut()
            .find(|a| a.id == account.id)
            .ok_or_else(|| AppError::from("Account not found"))?;
        *existing = account.clone();
        self.persist(&data)?;
        Ok(AccountView::from(account))
    }
}

/// Validates a Minecraft (offline) username: 3-16 chars, letters/digits/underscore.
pub fn validate_username(name: &str) -> bool {
    let len_ok = (3..=16).contains(&name.len());
    let chars_ok = name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
    len_ok && chars_ok
}

/// Persists the launcher's own Discord login session to disk so the user
/// isn't asked to re-authenticate every time they open SoulClient.
///
/// NOTE: for a production release this should move into the OS keychain
/// (the `keyring` crate) instead of a plain JSON file, same caveat as
/// `AccountStore`'s Microsoft tokens.
pub struct DiscordSessionStore {
    inner: RwLock<Option<discord::DiscordSession>>,
}

impl DiscordSessionStore {
    pub fn load() -> Self {
        let session = std::fs::read_to_string(AppPaths::discord_session_file())
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok());
        Self {
            inner: RwLock::new(session),
        }
    }

    pub fn get(&self) -> Option<discord::DiscordSession> {
        self.inner.read().unwrap().clone()
    }

    pub fn save(&self, session: discord::DiscordSession) -> AppResult<()> {
        let json = serde_json::to_string_pretty(&session)?;
        std::fs::write(AppPaths::discord_session_file(), json).map_err(AppError::from)?;
        *self.inner.write().unwrap() = Some(session);
        Ok(())
    }

    pub fn clear(&self) -> AppResult<()> {
        let path = AppPaths::discord_session_file();
        if path.exists() {
            std::fs::remove_file(path).map_err(AppError::from)?;
        }
        *self.inner.write().unwrap() = None;
        Ok(())
    }
}
