// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod admin;
mod auth;
mod commands;
mod downloader;
mod instances;
mod modvault;
mod news;
mod presence;
mod remote;
mod settings;
mod skins;
mod updater;
mod utils;

use commands::AppState;
use tauri::Manager;

fn main() {
    tracing_subscriber::fmt::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .manage(AppState::new())
        .setup(|app| {
            // Connect to Discord Rich Presence in the background so a
            // closed/missing Discord client never delays or blocks startup.
            let presence = app.state::<AppState>().discord_presence.clone();
            std::thread::spawn(move || presence.set_idle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Accounts
            commands::accounts::list_accounts,
            commands::accounts::get_active_account,
            commands::accounts::add_offline_account,
            commands::accounts::remove_account,
            commands::accounts::set_active_account,
            commands::accounts::begin_microsoft_login,
            commands::accounts::poll_microsoft_login,
            commands::accounts::upload_skin,
            // Discord (launcher login gate)
            commands::discord::get_discord_session,
            commands::discord::begin_discord_login,
            commands::discord::poll_discord_login,
            commands::discord::logout_discord,
            // Admin user management (worker + D1 backend)
            commands::admin::list_users,
            commands::admin::set_user_blocked,
            commands::admin::delete_user,
            // Instances
            commands::instances::list_instances,
            commands::instances::create_instance,
            commands::instances::update_instance,
            commands::instances::delete_instance,
            commands::instances::ensure_version_installed,
            commands::instances::launch_instance,
            // Mod Vault (Protected Mods & Admin Management)
            commands::modvault::list_all_protected_mods,
            commands::modvault::list_protected_mods,
            commands::modvault::add_protected_mod,
            commands::modvault::update_protected_mod,
            commands::modvault::remove_protected_mod,
            // Remote instances (worker + R2 catalog)
            commands::instances::list_remote_instances,
            commands::instances::install_remote_instance,
            commands::instances::publish_instance,
            commands::instances::delete_remote_instance,
            // Versions
            commands::versions::fetch_version_manifest,
            commands::versions::fetch_fabric_loaders,
            // Settings
            commands::settings::get_settings,
            commands::settings::save_settings,
            commands::settings::reset_settings,
            commands::settings::clear_cache,
            commands::settings::open_launcher_folder,
            commands::settings::check_for_updates,
        ])
        .run(tauri::generate_context!())
        .expect("error while running SoulClient");
}

