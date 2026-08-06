//! Skin management: lets a user pick a local PNG and apply it as their
//! Minecraft skin. Premium accounts get a **real** upload to Mojang's
//! profile API (so the skin shows up in-game for everyone); No Premium
//! accounts have no server to upload to, so the chosen PNG is embedded as
//! a data URI directly on the account record — good enough to drive the
//! 3D preview and any offline-mode use inside SoulClient itself.

use crate::auth::{Account, AccountType};
use crate::utils::{AppError, AppResult};
use base64::Engine;

const PNG_MAGIC: [u8; 8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

fn validate_png(bytes: &[u8]) -> AppResult<()> {
    if bytes.len() < 8 || bytes[0..8] != PNG_MAGIC {
        return Err(AppError::Other("El archivo seleccionado no es un PNG válido".into()));
    }
    // Minecraft skins are square-ish textures; the classic 64x64 (or 64x32
    // legacy) layout is enforced game-side, so we only sanity-check the
    // file signature here rather than re-implementing a PNG decoder.
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum SkinVariant {
    Classic,
    Slim,
}

impl SkinVariant {
    pub fn as_str(&self) -> &'static str {
        match self {
            SkinVariant::Classic => "classic",
            SkinVariant::Slim => "slim",
        }
    }
}

#[derive(Debug, serde::Deserialize)]
struct McProfileResponse {
    skins: Vec<McSkinEntry>,
    capes: Option<Vec<McCapeEntry>>,
}

#[derive(Debug, serde::Deserialize)]
struct McSkinEntry {
    url: String,
    state: String,
}

#[derive(Debug, serde::Deserialize)]
struct McCapeEntry {
    url: String,
    state: String,
}

/// Applies `png_bytes` as the given account's skin, mutating and returning
/// the updated `Account` (caller is responsible for persisting it via
/// `AccountStore::update`).
pub async fn apply_skin(
    client: &reqwest::Client,
    mut account: Account,
    png_bytes: Vec<u8>,
    variant: SkinVariant,
) -> AppResult<Account> {
    validate_png(&png_bytes)?;

    match account.account_type {
        AccountType::Premium => {
            let token = account
                .access_token
                .clone()
                .ok_or_else(|| AppError::Other("Esta cuenta premium no tiene un token válido; vuelve a iniciar sesión.".into()))?;

            let part = reqwest::multipart::Part::bytes(png_bytes)
                .file_name("skin.png")
                .mime_str("image/png")
                .map_err(|e| AppError::Other(e.to_string()))?;
            let form = reqwest::multipart::Form::new()
                .text("variant", variant.as_str())
                .part("file", part);

            client
                .post("https://api.minecraftservices.com/minecraft/profile/skins")
                .bearer_auth(&token)
                .multipart(form)
                .send()
                .await?
                .error_for_status()
                .map_err(|e| AppError::Other(format!("Mojang rechazó la skin: {e}")))?;

            // Re-fetch the profile so we pick up the freshly-processed
            // texture URL (Mojang re-encodes/validates the upload).
            let profile: McProfileResponse = client
                .get("https://api.minecraftservices.com/minecraft/profile")
                .bearer_auth(&token)
                .send()
                .await?
                .error_for_status()
                .map_err(|e| AppError::Other(format!("No se pudo refrescar el perfil: {e}")))?
                .json()
                .await?;

            account.skin_url = profile
                .skins
                .iter()
                .find(|s| s.state == "ACTIVE")
                .map(|s| s.url.clone());
            account.cape_url = profile
                .capes
                .unwrap_or_default()
                .iter()
                .find(|c| c.state == "ACTIVE")
                .map(|c| c.url.clone());
        }
        AccountType::Offline => {
            // No server to upload to — embed the PNG directly so the 3D
            // preview (and any future offline-mode texture pack) updates
            // instantly without needing network access.
            let encoded = base64::engine::general_purpose::STANDARD.encode(&png_bytes);
            account.skin_url = Some(format!("data:image/png;base64,{encoded}"));
        }
    }

    Ok(account)
}
