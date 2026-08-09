//! Pure client-side implementation of Microsoft -> Xbox Live -> XSTS -> Minecraft
//! authentication chain using official live.com device code flow.
//! No backend server or custom Azure AD app setup required.

use super::{Account, AccountType};
use crate::utils::{AppError, AppResult};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const MS_CLIENT_ID: &str = "853ca6f9-26ca-457a-b132-ed0afde994e1";
pub const MS_TENANT_ID: &str = "b713e46a-6871-41fd-9ea0-b4b834cacfcb";

#[derive(Debug, Clone, Deserialize)]
pub struct DeviceCodeResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Debug, Deserialize)]
struct MsTokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: i64,
}

#[derive(Debug, Deserialize)]
struct XblAuthResponse {
    #[serde(rename = "Token")]
    token: String,
    #[serde(rename = "DisplayClaims")]
    display_claims: XblDisplayClaims,
}

#[derive(Debug, Deserialize)]
struct XblDisplayClaims {
    xui: Vec<std::collections::HashMap<String, String>>,
}

#[derive(Debug, Deserialize)]
struct McAuthResponse {
    access_token: String,
}

#[derive(Debug, Deserialize)]
struct McProfileResponse {
    id: String,
    name: String,
    skins: Vec<McSkin>,
    capes: Option<Vec<McCape>>,
}

#[derive(Debug, Deserialize)]
struct McSkin {
    url: String,
}

#[derive(Debug, Deserialize)]
struct McCape {
    url: String,
}

/// Step 1: request a device code the user will enter at microsoft.com/link.
pub async fn request_device_code(client: &reqwest::Client) -> AppResult<DeviceCodeResponse> {
    let resp = client
        .post(format!(
            "https://login.microsoftonline.com/{}/oauth2/v2.0/devicecode",
            MS_TENANT_ID
        ))
        .form(&[
            ("client_id", MS_CLIENT_ID),
            ("scope", "XboxLive.signin offline_access"),
        ])
        .send()
        .await?
        .error_for_status()
        .map_err(|e| AppError::Other(format!("Device code request failed: {e}")))?;

    Ok(resp.json::<DeviceCodeResponse>().await?)
}

/// Step 2: poll until the user finishes authorizing in the browser, then
/// walk the full XBL -> XSTS -> Minecraft -> profile chain.
pub async fn poll_and_complete(
    client: &reqwest::Client,
    device_code: &str,
    interval_secs: u64,
    expires_in_secs: u64,
) -> AppResult<Account> {
    let ms_token = poll_ms_token(client, device_code, interval_secs, expires_in_secs).await?;
    let xbl_token = authenticate_xbl(client, &ms_token.access_token).await?;
    let (xsts_token, user_hash) = authenticate_xsts(client, &xbl_token).await?;
    let mc_token = authenticate_minecraft(client, &user_hash, &xsts_token).await?;
    let profile = fetch_profile(client, &mc_token).await?;

    Ok(Account {
        id: Uuid::new_v4().to_string(),
        account_type: AccountType::Premium,
        username: profile.name,
        uuid: profile.id,
        skin_url: profile.skins.first().map(|s| s.url.clone()),
        cape_url: profile.capes.and_then(|c| c.into_iter().next()).map(|c| c.url),
        access_token: Some(mc_token),
        refresh_token: ms_token.refresh_token,
        expires_at: Some(Utc::now().timestamp_millis() + ms_token.expires_in * 1000),
        added_at: Utc::now().timestamp_millis(),
    })
}

async fn poll_ms_token(
    client: &reqwest::Client,
    device_code: &str,
    interval_secs: u64,
    expires_in_secs: u64,
) -> AppResult<MsTokenResponse> {
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(expires_in_secs);
    let interval = interval_secs.max(2);

    loop {
        if tokio::time::Instant::now() >= deadline {
            return Err(AppError::Other("Device code expired".into()));
        }

        tokio::time::sleep(std::time::Duration::from_secs(interval)).await;

        let resp = client
            .post(format!(
                "https://login.microsoftonline.com/{}/oauth2/v2.0/token",
                MS_TENANT_ID
            ))
            .form(&[
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
                ("client_id", MS_CLIENT_ID),
                ("device_code", device_code),
            ])
            .send()
            .await?;

        if resp.status().is_success() {
            return Ok(resp.json::<MsTokenResponse>().await?);
        }

        let body: serde_json::Value = resp.json().await.unwrap_or_default();
        let error = body.get("error").and_then(|v| v.as_str()).unwrap_or("");
        if error != "authorization_pending" && error != "slow_down" {
            return Err(AppError::Other(format!("Microsoft login failed: {error}")));
        }
    }
}

/// Refreshes an existing Premium account's Minecraft access token using its refresh token.
pub async fn refresh_microsoft_account(
    client: &reqwest::Client,
    account: &Account,
) -> AppResult<Account> {
    let refresh_token = account
        .refresh_token
        .as_deref()
        .ok_or_else(|| AppError::Other("No refresh token available".into()))?;

    let resp = client
        .post(format!(
            "https://login.microsoftonline.com/{}/oauth2/v2.0/token",
            MS_TENANT_ID
        ))
        .form(&[
            ("grant_type", "refresh_token"),
            ("client_id", MS_CLIENT_ID),
            ("refresh_token", refresh_token),
            ("scope", "XboxLive.signin offline_access"),
        ])
        .send()
        .await?
        .error_for_status()
        .map_err(|e| AppError::Other(format!("Failed to refresh MS token: {e}")))?;

    let ms_token = resp.json::<MsTokenResponse>().await?;
    let xbl_token = authenticate_xbl(client, &ms_token.access_token).await?;
    let (xsts_token, user_hash) = authenticate_xsts(client, &xbl_token).await?;
    let mc_token = authenticate_minecraft(client, &user_hash, &xsts_token).await?;
    let profile = fetch_profile(client, &mc_token).await?;

    let mut updated = account.clone();
    updated.username = profile.name;
    updated.uuid = profile.id;
    updated.skin_url = profile.skins.first().map(|s| s.url.clone());
    updated.cape_url = profile.capes.and_then(|c| c.into_iter().next()).map(|c| c.url);
    updated.access_token = Some(mc_token);
    if ms_token.refresh_token.is_some() {
        updated.refresh_token = ms_token.refresh_token;
    }
    updated.expires_at = Some(Utc::now().timestamp_millis() + ms_token.expires_in * 1000);

    Ok(updated)
}

#[derive(Serialize)]
struct XblProperties<'a> {
    #[serde(rename = "AuthMethod")]
    auth_method: &'a str,
    #[serde(rename = "SiteName")]
    site_name: &'a str,
    #[serde(rename = "RpsTicket")]
    rps_ticket: String,
}

#[derive(Serialize)]
struct XblRequest<'a> {
    #[serde(rename = "Properties")]
    properties: XblProperties<'a>,
    #[serde(rename = "RelyingParty")]
    relying_party: &'a str,
    #[serde(rename = "TokenType")]
    token_type: &'a str,
}

async fn authenticate_xbl(client: &reqwest::Client, ms_access_token: &str) -> AppResult<XblAuthResponse> {
    let body = XblRequest {
        properties: XblProperties {
            auth_method: "RPS",
            site_name: "user.auth.xboxlive.com",
            rps_ticket: format!("d={ms_access_token}"),
        },
        relying_party: "http://auth.xboxlive.com",
        token_type: "JWT",
    };

    let resp = client
        .post("https://user.auth.xboxlive.com/user/authenticate")
        .json(&body)
        .send()
        .await?
        .error_for_status()
        .map_err(|e| AppError::Other(format!("XBL auth failed: {e}")))?;

    Ok(resp.json::<XblAuthResponse>().await?)
}

async fn authenticate_xsts(client: &reqwest::Client, xbl: &XblAuthResponse) -> AppResult<(String, String)> {
    #[derive(Serialize)]
    struct XstsProperties<'a> {
        #[serde(rename = "SandboxId")]
        sandbox_id: &'a str,
        #[serde(rename = "UserTokens")]
        user_tokens: Vec<&'a str>,
    }
    #[derive(Serialize)]
    struct XstsRequest<'a> {
        #[serde(rename = "Properties")]
        properties: XstsProperties<'a>,
        #[serde(rename = "RelyingParty")]
        relying_party: &'a str,
        #[serde(rename = "TokenType")]
        token_type: &'a str,
    }

    let body = XstsRequest {
        properties: XstsProperties {
            sandbox_id: "RETAIL",
            user_tokens: vec![&xbl.token],
        },
        relying_party: "rp://api.minecraftservices.com/",
        token_type: "JWT",
    };

    let resp = client
        .post("https://xsts.auth.xboxlive.com/xsts/authorize")
        .json(&body)
        .send()
        .await?;

    if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err(AppError::Other(
            "Esta cuenta de Xbox no puede usarse (menor de edad sin tutor vinculado, o no tiene un perfil de Xbox). ".into(),
        ));
    }

    let parsed = resp
        .error_for_status()
        .map_err(|e| AppError::Other(format!("XSTS auth failed: {e}")))?
        .json::<XblAuthResponse>()
        .await?;

    let user_hash = parsed
        .display_claims
        .xui
        .first()
        .and_then(|m| m.get("uhs"))
        .cloned()
        .ok_or_else(|| AppError::Other("Missing Xbox user hash".into()))?;

    Ok((parsed.token, user_hash))
}

async fn authenticate_minecraft(
    client: &reqwest::Client,
    user_hash: &str,
    xsts_token: &str,
) -> AppResult<String> {
    let resp = client
        .post("https://api.minecraftservices.com/authentication/login_with_xbox")
        .json(&serde_json::json!({
            "identityToken": format!("XBL3.0 x={user_hash};{xsts_token}")
        }))
        .send()
        .await?
        .error_for_status()
        .map_err(|e| AppError::Other(format!("Minecraft auth failed: {e}")))?;

    Ok(resp.json::<McAuthResponse>().await?.access_token)
}

async fn fetch_profile(client: &reqwest::Client, mc_access_token: &str) -> AppResult<McProfileResponse> {
    let resp = client
        .get("https://api.minecraftservices.com/minecraft/profile")
        .bearer_auth(mc_access_token)
        .send()
        .await?;

    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Err(AppError::Other(
            "Esta cuenta de Microsoft no posee Minecraft (Java Edition).".into(),
        ));
    }

    Ok(resp
        .error_for_status()
        .map_err(|e| AppError::Other(format!("Failed to fetch profile: {e}")))?
        .json::<McProfileResponse>()
        .await?)
}

