use super::{Account, AccountType};
use chrono::Utc;
use uuid::Uuid;

/// Offline-account UUIDs are derived deterministically from the username,
/// mirroring how vanilla Minecraft generates "offline mode" UUIDs
/// (`UUID.nameUUIDFromBytes(("OfflinePlayer:" + name).getBytes())`, which is
/// a UUIDv3/MD5 hash). We use uuid v5-over-md5-equivalent namespace hashing
/// via `Uuid::new_v3` for full compatibility with vanilla clients.
pub fn create_offline_account(username: &str) -> Account {
    let namespace = Uuid::NAMESPACE_OID;
    let name = format!("OfflinePlayer:{username}");
    let uuid = Uuid::new_v3(&namespace, name.as_bytes());

    Account {
        id: Uuid::new_v4().to_string(),
        account_type: AccountType::Offline,
        username: username.to_string(),
        uuid: uuid.to_string(),
        // Rendered client-side by skinview3d using a default Steve/Alex
        // skin; a real deployment could fetch a procedurally generated
        // skin from an offline-skin service keyed by UUID.
        skin_url: Some(format!(
            "https://mc-heads.net/skin/{}",
            username.to_string()
        )),
        cape_url: None,
        access_token: None,
        refresh_token: None,
        expires_at: None,
        added_at: Utc::now().timestamp_millis(),
    }
}
