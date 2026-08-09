//! Pure client-side implementation of Microsoft -> Xbox Live -> XSTS -> Minecraft
//! authentication chain using official live.com device code flow.
//! No backend server or custom Azure AD app setup required.

use super::{Account, AccountType};
use crate::utils::{AppError, AppResult};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Client ID de la Azure App Registration del proyecto.
/// Requiere configuración correcta en portal Azure (ver README).
pub const MS_CLIENT_ID: &str = "853ca6f9-26ca-457a-b132-ed0afde994e1";
pub const MS_TENANT_ID: &str = "consumers";

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
    let url = format!(
        "https://login.microsoftonline.com/{}/oauth2/v2.0/devicecode",
        MS_TENANT_ID
    );
    tracing::info!("[MS Auth] Paso 1 - Solicitando device code. URL: {url}");
    tracing::info!("[MS Auth] Client ID: {MS_CLIENT_ID}, Tenant: {MS_TENANT_ID}");

    let resp = client
        .post(&url)
        .form(&[
            ("client_id", MS_CLIENT_ID),
            ("scope", "XboxLive.signin offline_access"),
        ])
        .send()
        .await?;

    let status = resp.status();
    tracing::info!("[MS Auth] Paso 1 - Respuesta HTTP: {status}");

    if !status.is_success() {
        let body: serde_json::Value = resp.json().await.unwrap_or_default();
        let error = body.get("error").and_then(|v| v.as_str()).unwrap_or("unknown");
        let error_desc = body.get("error_description").and_then(|v| v.as_str()).unwrap_or("");
        tracing::error!("[MS Auth] Paso 1 FALLÓ: error={error}, desc={error_desc}");
        return Err(AppError::Other(format!(
            "Error al solicitar device code: {error} — {error_desc}\n\nVerifica que el Client ID esté registrado en Azure con soporte para cuentas personales Microsoft."
        )));
    }

    let dc = resp.json::<DeviceCodeResponse>().await?;
    tracing::info!("[MS Auth] Paso 1 OK - user_code generado");
    Ok(dc)
}

/// Step 2: poll until the user finishes authorizing in the browser, then
/// walk the full XBL -> XSTS -> Minecraft -> profile chain.
pub async fn poll_and_complete(
    client: &reqwest::Client,
    device_code: &str,
    interval_secs: u64,
    expires_in_secs: u64,
) -> AppResult<Account> {
    tracing::info!("[MS Auth] Paso 2 - Iniciando polling de token MS...");
    let ms_token = poll_ms_token(client, device_code, interval_secs, expires_in_secs).await?;
    tracing::info!("[MS Auth] Paso 2 OK - Token MS obtenido. expires_in={}s", ms_token.expires_in);

    tracing::info!("[MS Auth] Paso 3 - Autenticando con Xbox Live (XBL)...");
    let xbl_token = authenticate_xbl(client, &ms_token.access_token).await?;
    tracing::info!("[MS Auth] Paso 3 OK - XBL token obtenido");

    tracing::info!("[MS Auth] Paso 4 - Obteniendo XSTS token...");
    let (xsts_token, user_hash) = authenticate_xsts(client, &xbl_token).await?;
    tracing::info!("[MS Auth] Paso 4 OK - XSTS obtenido, user_hash presente: {}", !user_hash.is_empty());

    tracing::info!("[MS Auth] Paso 5 - Autenticando con Minecraft...");
    let mc_token = authenticate_minecraft(client, &user_hash, &xsts_token).await?;
    tracing::info!("[MS Auth] Paso 5 OK - Minecraft access token obtenido");

    tracing::info!("[MS Auth] Paso 6 - Obteniendo perfil de Minecraft...");
    let profile = fetch_profile(client, &mc_token).await?;
    tracing::info!("[MS Auth] Paso 6 OK - Perfil: username={}", profile.name);

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
    let url = format!(
        "https://login.microsoftonline.com/{}/oauth2/v2.0/token",
        MS_TENANT_ID
    );

    loop {
        if tokio::time::Instant::now() >= deadline {
            return Err(AppError::Other(
                "El código de device code expiró. Inicia el proceso de nuevo.".into(),
            ));
        }

        tokio::time::sleep(std::time::Duration::from_secs(interval)).await;

        let resp = client
            .post(&url)
            .form(&[
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
                ("client_id", MS_CLIENT_ID),
                ("device_code", device_code),
            ])
            .send()
            .await?;

        let status = resp.status();
        let body: serde_json::Value = resp.json().await.unwrap_or_default();
        let error = body.get("error").and_then(|v| v.as_str()).unwrap_or("");

        if status.is_success() {
            return Ok(serde_json::from_value(body).map_err(|e| {
                AppError::Other(format!("No se pudo parsear el token MS: {e}"))
            })?);
        }

        match error {
            "authorization_pending" => {
                tracing::debug!("[MS Auth] Esperando autorización del usuario...");
            }
            "slow_down" => {
                tracing::debug!("[MS Auth] Se solicitó reducir velocidad de polling");
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            }
            other => {
                let error_desc = body
                    .get("error_description")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                tracing::error!(
                    "[MS Auth] Paso 2 FALLÓ: HTTP {status}, error={other}, desc={error_desc}"
                );
                return Err(AppError::Other(format!(
                    "Login de Microsoft falló: {other}\n{error_desc}"
                )));
            }
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

    tracing::info!("[MS Auth] Refrescando token para cuenta: {}", account.username);

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
        .await?;

    let status = resp.status();
    tracing::info!("[MS Auth] Refresh token response: HTTP {status}");

    if !status.is_success() {
        let body: serde_json::Value = resp.json().await.unwrap_or_default();
        let error = body
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
        let desc = body
            .get("error_description")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        tracing::error!("[MS Auth] Refresh FALLÓ: {error} — {desc}");
        return Err(AppError::Other(format!(
            "No se pudo renovar el token: {error}"
        )));
    }

    let ms_token = resp.json::<MsTokenResponse>().await?;
    let xbl_token = authenticate_xbl(client, &ms_token.access_token).await?;
    let (xsts_token, user_hash) = authenticate_xsts(client, &xbl_token).await?;
    let mc_token = authenticate_minecraft(client, &user_hash, &xsts_token).await?;
    let profile = fetch_profile(client, &mc_token).await?;

    let mut updated = account.clone();
    updated.username = profile.name;
    updated.uuid = profile.id;
    updated.skin_url = profile.skins.first().map(|s| s.url.clone());
    updated.cape_url = profile
        .capes
        .and_then(|c| c.into_iter().next())
        .map(|c| c.url);
    updated.access_token = Some(mc_token);
    if ms_token.refresh_token.is_some() {
        updated.refresh_token = ms_token.refresh_token;
    }
    updated.expires_at = Some(Utc::now().timestamp_millis() + ms_token.expires_in * 1000);

    tracing::info!("[MS Auth] Token refrescado OK para: {}", updated.username);
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

async fn authenticate_xbl(
    client: &reqwest::Client,
    ms_access_token: &str,
) -> AppResult<XblAuthResponse> {
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
        .await?;

    let status = resp.status();
    tracing::info!("[MS Auth] XBL authenticate response: HTTP {status}");

    if !status.is_success() {
        let body_text = resp.text().await.unwrap_or_default();
        let preview = &body_text[..body_text.len().min(200)];
        tracing::error!("[MS Auth] Paso 3 XBL FALLÓ: HTTP {status}. Body: {preview}");
        return Err(AppError::Other(format!(
            "Error al autenticar con Xbox Live (XBL): HTTP {status}. Verifica que el token de Microsoft sea válido."
        )));
    }

    resp.json::<XblAuthResponse>()
        .await
        .map_err(|e| AppError::Other(format!("No se pudo parsear respuesta XBL: {e}")))
}

async fn authenticate_xsts(
    client: &reqwest::Client,
    xbl: &XblAuthResponse,
) -> AppResult<(String, String)> {
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

    let status = resp.status();
    tracing::info!("[MS Auth] XSTS authorize response: HTTP {status}");

    if status == reqwest::StatusCode::UNAUTHORIZED {
        // Extraer el código de error Xbox (XErr) para dar un mensaje claro
        let body_val: serde_json::Value = resp.json().await.unwrap_or_default();
        let xerr = body_val.get("XErr").and_then(|v| v.as_u64()).unwrap_or(0);
        tracing::error!("[MS Auth] Paso 4 XSTS FALLÓ con 401. XErr={xerr}");
        let msg = match xerr {
            2148916233 => {
                "Esta cuenta de Microsoft no tiene una cuenta de Xbox Live vinculada. Ve a xbox.com y crea un perfil de Xbox."
            }
            2148916235 => "Xbox Live no está disponible en tu país/región.",
            2148916236 | 2148916237 => {
                "La cuenta necesita verificación de mayoría de edad en Xbox."
            }
            2148916238 => {
                "Esta es una cuenta de menor de edad sin supervisión parental. El tutor debe iniciar sesión primero."
            }
            _ => {
                "Esta cuenta de Xbox no puede usarse (menor de edad sin tutor vinculado, o no tiene un perfil de Xbox)."
            }
        };
        return Err(AppError::Other(msg.into()));
    }

    if !status.is_success() {
        let body_text = resp.text().await.unwrap_or_default();
        let preview = &body_text[..body_text.len().min(300)];
        tracing::error!("[MS Auth] Paso 4 XSTS FALLÓ: HTTP {status}. Body: {preview}");
        return Err(AppError::Other(format!("Error XSTS: HTTP {status}")));
    }

    let parsed = resp
        .json::<XblAuthResponse>()
        .await
        .map_err(|e| AppError::Other(format!("No se pudo parsear respuesta XSTS: {e}")))?;

    let user_hash = parsed
        .display_claims
        .xui
        .first()
        .and_then(|m| m.get("uhs"))
        .cloned()
        .ok_or_else(|| {
            AppError::Other(
                "Falta el user hash de Xbox (uhs). Respuesta XSTS inesperada.".into(),
            )
        })?;

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
        .await?;

    let status = resp.status();
    tracing::info!("[MS Auth] Minecraft login_with_xbox response: HTTP {status}");

    if !status.is_success() {
        let body_text = resp.text().await.unwrap_or_default();
        let preview = &body_text[..body_text.len().min(300)];
        tracing::error!("[MS Auth] Paso 5 Minecraft auth FALLÓ: HTTP {status}. Body: {preview}");
        return Err(AppError::Other(format!(
            "Error al autenticar con Minecraft (HTTP {status}). Verifica que la cuenta tenga Xbox Live válido y Minecraft Java Edition."
        )));
    }

    Ok(resp
        .json::<McAuthResponse>()
        .await
        .map_err(|e| AppError::Other(format!("No se pudo parsear respuesta Minecraft auth: {e}")))?
        .access_token)
}

async fn fetch_profile(
    client: &reqwest::Client,
    mc_access_token: &str,
) -> AppResult<McProfileResponse> {
    let resp = client
        .get("https://api.minecraftservices.com/minecraft/profile")
        .bearer_auth(mc_access_token)
        .send()
        .await?;

    let status = resp.status();
    tracing::info!("[MS Auth] Minecraft profile response: HTTP {status}");

    if status == reqwest::StatusCode::NOT_FOUND {
        tracing::error!("[MS Auth] Paso 6 FALLÓ: 404 — La cuenta no tiene Minecraft Java Edition");
        return Err(AppError::Other(
            "Esta cuenta de Microsoft no posee Minecraft (Java Edition). Compra el juego en minecraft.net.".into(),
        ));
    }

    if !status.is_success() {
        let body_text = resp.text().await.unwrap_or_default();
        let preview = &body_text[..body_text.len().min(300)];
        tracing::error!("[MS Auth] Paso 6 Perfil FALLÓ: HTTP {status}. Body: {preview}");
        return Err(AppError::Other(format!(
            "Error al obtener perfil de Minecraft: HTTP {status}"
        )));
    }

    resp.json::<McProfileResponse>()
        .await
        .map_err(|e| AppError::Other(format!("No se pudo parsear perfil: {e}")))
}
