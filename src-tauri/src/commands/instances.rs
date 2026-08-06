use super::AppState;
use crate::auth::is_admin_account;
use crate::downloader::{self, assets, fabric, launch, libraries, manifest, DownloadProgress};
use crate::instances::{InstanceConfig, InstanceDraft};
use crate::utils::paths::AppPaths;
use crate::utils::{AppError, AppResult};
use tauri::{AppHandle, State};

/// Re-checks admin status server-side rather than trusting the UI, since a
/// modified/compromised frontend could otherwise call these commands
/// directly. Only Premium accounts on the `ADMIN_USERNAMES` allowlist may
/// create, edit, or delete instances; everyone else can still list/install/
/// launch them.
fn require_admin(state: &State<'_, AppState>, account_id: &str) -> AppResult<()> {
    let account = state
        .accounts
        .get(account_id)
        .ok_or_else(|| AppError::from("Cuenta no encontrada"))?;
    if is_admin_account(&account) {
        Ok(())
    } else {
        Err(AppError::from(
            "Solo los administradores pueden gestionar instancias.",
        ))
    }
}

#[tauri::command]
pub fn list_instances(state: State<'_, AppState>) -> Vec<InstanceConfig> {
    state.instances.list()
}

/// If `cover_image` points at a file outside the launcher's own `covers/`
/// folder (i.e. the user just picked it from the OS file dialog), copies it
/// in and rewrites the field to the new stable path. Keeps the launcher
/// from depending on a file the user could later move, rename, or delete,
/// and gives the frontend one predictable place to resolve covers from.
fn adopt_cover_image(instance_id: &str, cover_image: Option<String>) -> AppResult<Option<String>> {
    let Some(source) = cover_image else { return Ok(None) };
    let source_path = std::path::Path::new(&source);

    if source_path.starts_with(AppPaths::covers_dir()) {
        // Already an adopted cover (e.g. unchanged on edit); keep as-is.
        return Ok(Some(source));
    }

    if !source_path.is_file() {
        return Err(AppError::from("La imagen de portada seleccionada no existe."));
    }

    let ext = source_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png");
    let dest = AppPaths::covers_dir().join(format!("{instance_id}.{ext}"));

    // Remove any previous cover for this instance under a different
    // extension before copying the new one in.
    if let Ok(entries) = std::fs::read_dir(AppPaths::covers_dir()) {
        for entry in entries.flatten() {
            if entry
                .path()
                .file_stem()
                .and_then(|s| s.to_str())
                .map(|s| s == instance_id)
                .unwrap_or(false)
            {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }

    std::fs::copy(source_path, &dest).map_err(AppError::from)?;
    Ok(Some(dest.to_string_lossy().to_string()))
}

#[tauri::command]
pub fn create_instance(
    mut draft: InstanceDraft,
    account_id: String,
    state: State<'_, AppState>,
) -> AppResult<InstanceConfig> {
    require_admin(&state, &account_id)?;
    // The instance id is generated inside `InstanceStore::create`, so we
    // adopt the cover using a fresh id first and hand the already-placed
    // path down; `create` sees a `covers_dir`-relative path and leaves it
    // untouched.
    let id = uuid::Uuid::new_v4().to_string();
    draft.cover_image = adopt_cover_image(&id, draft.cover_image)?;
    state.instances.create_with_id(id, draft)
}

#[tauri::command]
pub fn update_instance(
    mut instance: InstanceConfig,
    account_id: String,
    state: State<'_, AppState>,
) -> AppResult<InstanceConfig> {
    require_admin(&state, &account_id)?;
    instance.cover_image = adopt_cover_image(&instance.id, instance.cover_image)?;
    state.instances.update(instance)
}

#[tauri::command]
pub fn delete_instance(id: String, account_id: String, state: State<'_, AppState>) -> AppResult<()> {
    require_admin(&state, &account_id)?;
    state.instances.delete(&id)
}

/// Downloads everything required for an instance's Minecraft version
/// (client jar, libraries, assets, and Fabric loader if configured) if not
/// already present, emitting `download://progress` events throughout.
#[tauri::command]
pub async fn ensure_version_installed(
    instance_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let instance = state
        .instances
        .get(&instance_id)
        .ok_or_else(|| AppError::from("Instance not found"))?;

    let emit = |stage: &str, file: Option<String>, downloaded: u64, total: u64, log: String| {
        downloader::emit_progress(
            &app,
            DownloadProgress {
                instance_id: instance_id.clone(),
                stage: stage.to_string(),
                file_name: file,
                downloaded_bytes: downloaded,
                total_bytes: total,
                speed_bps: 0,
                eta_seconds: 0,
                log,
            },
        );
    };

    emit("manifest", None, 0, 0, format!("Resolviendo versión {}...", instance.version));
    let versions = manifest::fetch_version_manifest(&state.http_client).await?;
    let entry = versions
        .iter()
        .find(|v| v.id == instance.version)
        .ok_or_else(|| AppError::from("Versión no encontrada en el manifiesto"))?;

    let mut version_json = manifest::fetch_version_detail(&state.http_client, &entry.url).await?;

    // Merge Fabric's launcher meta on top of the vanilla version JSON when
    // the instance uses the Fabric loader (mainClass + extra libraries).
    // `instance` is re-bound to the (possibly loader_version-pinned)
    // updated record so everything below — and `launch_instance` later —
    // agrees on the exact same `version_cache_key()`.
    let mut instance = instance;
    if instance.loader == crate::instances::LoaderType::Fabric {
        emit("fabric", None, 0, 0, "Resolviendo Fabric Loader...".into());
        let loader_version = match &instance.loader_version {
            Some(v) if !v.is_empty() => v.clone(),
            _ => fabric::fetch_loader_versions(&state.http_client, &instance.version)
                .await?
                .into_iter()
                .next()
                .ok_or_else(|| AppError::from("No hay versiones de Fabric disponibles"))?,
        };

        // Pin the resolved loader version onto the instance so it doesn't
        // silently drift to a newer "latest" on a later launch, and so the
        // cache key below stays identical between this call and the one
        // `launch_instance` computes right after.
        if instance.loader_version.as_deref() != Some(loader_version.as_str()) {
            instance.loader_version = Some(loader_version.clone());
            instance = state.instances.update(instance)?;
        }

        let fabric_meta = fabric::fetch_launcher_meta(&state.http_client, &instance.version, &loader_version).await?;

        // BUG FIX: this used to silently fall back to the vanilla
        // mainClass/libraries whenever Fabric's profile JSON didn't have
        // the expected shape (e.g. a `.get()` returning `None` was just
        // ignored), which is exactly how an instance configured for
        // Fabric would quietly end up launching as plain vanilla with no
        // mods loaded. Now a malformed/unexpected Fabric profile is a
        // hard error instead of a silent vanilla fallback.
        let fabric_main_class = fabric_meta
            .get("mainClass")
            .and_then(|m| m.as_str())
            .ok_or_else(|| AppError::from("El perfil de Fabric Loader no incluye mainClass; no se puede iniciar con Fabric."))?;
        version_json["mainClass"] = serde_json::Value::String(fabric_main_class.to_string());

        let fabric_libraries = fabric_meta
            .get("libraries")
            .and_then(|l| l.as_array())
            .ok_or_else(|| AppError::from("El perfil de Fabric Loader no incluye librerías; no se puede iniciar con Fabric."))?;
        let base = version_json
            .get_mut("libraries")
            .and_then(|l| l.as_array_mut())
            .ok_or_else(|| AppError::from("El version JSON base no tiene un array de librerías."))?;
        base.extend(fabric_libraries.iter().cloned());
    }

    let client_jar = libraries::resolve_client_jar(&version_json, &instance.version)?;
    let lib_files = libraries::resolve_libraries(&version_json);

    emit("client", None, 0, 0, "Descargando cliente de Minecraft...".into());
    libraries::download_files(&state.http_client, vec![client_jar], |name, d, t| {
        emit("client", Some(name.to_string()), d, t, format!("{name}"));
    })
    .await?;

    emit("libraries", None, 0, 0, format!("Descargando {} librerías...", lib_files.len()));
    libraries::download_files(&state.http_client, lib_files, |name, d, t| {
        emit("libraries", Some(name.to_string()), d, t, format!("{name}"));
    })
    .await?;

    emit("assets", None, 0, 0, "Resolviendo assets...".into());
    let asset_files = assets::resolve_assets(&state.http_client, &version_json).await?;
    emit("assets", None, 0, 0, format!("Descargando {} assets...", asset_files.len()));
    libraries::download_files(&state.http_client, asset_files, |name, d, t| {
        emit("assets", Some(name.to_string()), d, t, format!("{name}"));
    })
    .await?;

    // Cache the fully-resolved (and possibly Fabric-merged) version JSON
    // next to the client jar so `launch_instance` doesn't have to redo the
    // manifest/Fabric-meta round trip on every play. Keyed by
    // `version_cache_key()` (not the bare MC version) — see that method's
    // doc comment for why.
    let version_cache_key = instance.version_cache_key();
    let version_dir = AppPaths::versions_dir().join(&version_cache_key);
    std::fs::create_dir_all(&version_dir).map_err(AppError::from)?;
    std::fs::write(
        version_dir.join(format!("{version_cache_key}.json")),
        serde_json::to_vec_pretty(&version_json)?,
    )
    .map_err(AppError::from)?;

    emit("done", None, 0, 0, "Instalación completa.".into());
    Ok(())
}

// ---------- Remote catalog (worker + R2) ----------

/// `account_id` is optional (the remote catalog is browsable before
/// picking a Minecraft account) but, when present, lets a launcher admin
/// see whitelisted instances they'd otherwise be filtered out of. The
/// Discord identity used for the whitelist check itself always comes from
/// the launcher's own Discord login session, not from `account_id`.
#[tauri::command]
pub async fn list_remote_instances(
    account_id: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<Vec<crate::remote::RemoteInstance>> {
    let viewer_is_admin = account_id
        .as_deref()
        .and_then(|id| state.accounts.get(id))
        .map(|account| is_admin_account(&account))
        .unwrap_or(false);
    let viewer_discord_id = state.discord_session.get().map(|s| s.id);

    crate::remote::list(
        &state.http_client,
        &state.settings.get(),
        viewer_discord_id.as_deref(),
        viewer_is_admin,
    )
    .await
}

/// Any logged-in user can install a published instance with one click —
/// as long as it's actually visible to them. `account_id` is optional (same
/// reasoning as `list_remote_instances`) and only matters for the admin
/// bypass.
///
/// BUG FIX: this used to install unconditionally, so a whitelisted
/// instance was only hidden by `list_remote_instances` in the normal UI —
/// anyone who learned its id (e.g. from an earlier "Instalar" click, a
/// screenshot, guessing) could still call this command directly and
/// download it. The same `is_visible_to` check used for listing is now
/// enforced here too, so "acceder" is actually gated, not just "ver".
#[tauri::command]
pub async fn install_remote_instance(
    id: String,
    account_id: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<InstanceConfig> {
    let viewer_is_admin = account_id
        .as_deref()
        .and_then(|aid| state.accounts.get(aid))
        .map(|account| is_admin_account(&account))
        .unwrap_or(false);
    let viewer_discord_id = state.discord_session.get().map(|s| s.id);

    let settings = state.settings.get();
    let meta = crate::remote::get(&state.http_client, &settings, &id).await?;
    if !crate::remote::is_visible_to(&meta, viewer_discord_id.as_deref(), viewer_is_admin) {
        return Err(AppError::from(
            "Esta instancia tiene la whitelist activada y tu cuenta de Discord no está autorizada.",
        ));
    }

    crate::remote::install(&state.http_client, &settings, &id, &app, &state.instances).await
}

/// Admin-only: packages a local instance (its folder + version/libraries/
/// assets) and publishes it to the catalog.
#[tauri::command]
pub async fn publish_instance(
    instance_id: String,
    account_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<crate::remote::RemoteInstance> {
    require_admin(&state, &account_id)?;
    crate::remote::publish(&state.http_client, &state.settings.get(), &instance_id, &app, &state.instances).await
}

/// Admin-only: removes a published instance from the catalog.
#[tauri::command]
pub async fn delete_remote_instance(
    id: String,
    account_id: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    require_admin(&state, &account_id)?;
    crate::remote::delete(&state.http_client, &state.settings.get(), &id).await
}

#[tauri::command]
pub async fn launch_instance(
    app_handle: tauri::AppHandle,
    id: String,
    account_id: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let instance = state.instances.get(&id).ok_or_else(|| AppError::from("Instance not found"))?;

    // Ensure instance directory and its mods subfolder exist
    let instance_dir = std::path::Path::new(&instance.directory);
    let mods_dir = instance_dir.join("mods");
    std::fs::create_dir_all(&mods_dir).ok();

    let mut account = state
        .accounts
        .list()
        .into_iter()
        .find(|a| a.id == account_id)
        .ok_or_else(|| AppError::from("Account not found"))?;

    if account.account_type == crate::auth::AccountType::Premium && account.refresh_token.is_some() {
        let is_expired = account
            .expires_at
            .map(|exp| chrono::Utc::now().timestamp_millis() + 60_000 >= exp)
            .unwrap_or(true);
        if is_expired || account.access_token.is_none() {
            if let Ok(refreshed) = crate::auth::microsoft::refresh_microsoft_account(&state.http_client, &account).await {
                let _ = state.accounts.update(refreshed.clone());
                account = refreshed;
            }
        }
    }

    let settings = state.settings.get();
    let java_bin = crate::downloader::java::resolve_java(
        instance.custom_java_path.as_deref(),
        &settings.java_path,
    )
    .ok_or_else(|| AppError::from("No se encontró una instalación de Java. Configúrala en Ajustes."))?;

    let version_json_path = AppPaths::versions_dir()
        .join(instance.version_cache_key())
        .join(format!("{}.json", instance.version_cache_key()));
    if !version_json_path.exists() {
        ensure_version_installed(instance.id.clone(), app_handle.clone(), state.clone()).await?;
    }
    let version_json: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(&version_json_path).map_err(AppError::from)?,
    )?;

    let protected_mods_dir = state.mod_vault.stage_for_launch(&id)?;

    launch::launch(
        &java_bin,
        &version_json,
        &instance.version,
        &instance,
        &account,
        protected_mods_dir.as_deref(),
        Some(state.discord_presence.clone()),
    )?;
    state.instances.mark_played(&id)?;
    Ok(())
}
