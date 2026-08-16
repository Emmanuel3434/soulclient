import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Account } from "@/types/account";
import type { InstanceConfig, InstanceDraft, RemoteInstance } from "@/types/instance";
import type { LauncherSettings } from "@/types/settings";
import type { MinecraftVersion } from "@/types/version";
import type { DownloadProgress } from "@/types/download";
import type { DiscordSession } from "@/types/discord";
import type { VaultModEntry } from "@/types/modvault";

/**
 * Thin wrapper around every Tauri command exposed by the Rust backend.
 * Keeping this in one place means the React layer never talks to `invoke`
 * directly, which makes the IPC surface easy to audit and mock in tests.
 */
export const api = {
  // ---------- Accounts ----------
  listAccounts: () => invoke<Account[]>("list_accounts"),
  addOfflineAccount: (username: string) =>
    invoke<Account>("add_offline_account", { username }),
  removeAccount: (id: string) => invoke<void>("remove_account", { id }),
  setActiveAccount: (id: string) => invoke<void>("set_active_account", { id }),
  getActiveAccount: () => invoke<Account | null>("get_active_account"),
  beginMicrosoftLogin: () => invoke<string>("begin_microsoft_login"),
  pollMicrosoftLogin: () => invoke<Account | null>("poll_microsoft_login"),
  uploadSkin: (accountId: string, filePath: string, slim: boolean) =>
    invoke<Account>("upload_skin", { accountId, filePath, slim }),

  // ---------- Instances ----------
  listInstances: () => invoke<InstanceConfig[]>("list_instances"),
  createInstance: (draft: InstanceDraft, accountId: string) =>
    invoke<InstanceConfig>("create_instance", { draft, accountId }),
  updateInstance: (instance: InstanceConfig, accountId: string) =>
    invoke<InstanceConfig>("update_instance", { instance, accountId }),
  deleteInstance: (id: string, accountId: string) =>
    invoke<void>("delete_instance", { id, accountId }),
  launchInstance: (id: string, accountId: string) =>
    invoke<void>("launch_instance", { id, accountId }),

  // ---------- Mod Vault & Admin Management ----------
  listAllProtectedMods: () => invoke<VaultModEntry[]>("list_all_protected_mods"),
  listProtectedMods: (instanceId: string) =>
    invoke<VaultModEntry[]>("list_protected_mods", { instanceId }),
  addProtectedMod: (
    instanceId: string,
    sourcePath: string,
    customName?: string,
    customVersion?: string,
    isMandatory?: boolean,
    accountId?: string
  ) =>
    invoke<VaultModEntry>("add_protected_mod", {
      instanceId,
      sourcePath,
      customName,
      customVersion,
      isMandatory,
      accountId,
    }),
  updateProtectedMod: (
    modId: string,
    sourcePath?: string,
    version?: string,
    isMandatory?: boolean,
    accountId?: string
  ) =>
    invoke<VaultModEntry>("update_protected_mod", {
      modId,
      sourcePath,
      version,
      isMandatory,
      accountId,
    }),
  removeProtectedMod: (modId: string, accountId?: string) =>
    invoke<void>("remove_protected_mod", { modId, accountId }),
  syncProtectedMods: (localInstanceId: string) =>
    invoke<number>("sync_protected_mods", { localInstanceId }),
  syncAllProtectedMods: (accountId?: string) =>
    invoke<number>("sync_all_protected_mods", { accountId }),

  // ---------- Versions / downloads ----------
  fetchVersionManifest: () => invoke<MinecraftVersion[]>("fetch_version_manifest"),
  fetchFabricLoaders: (mcVersion: string) =>
    invoke<string[]>("fetch_fabric_loaders", { mcVersion }),
  ensureVersionInstalled: (instanceId: string) =>
    invoke<void>("ensure_version_installed", { instanceId }),

  // ---------- Remote instances (worker + R2 catalog) ----------
  listRemoteInstances: (accountId?: string) =>
    invoke<RemoteInstance[]>("list_remote_instances", { accountId }),
  installRemoteInstance: (id: string, accountId?: string) =>
    invoke<InstanceConfig>("install_remote_instance", { id, accountId }),
  publishInstance: (instanceId: string, accountId: string) =>
    invoke<RemoteInstance>("publish_instance", { instanceId, accountId }),
  deleteRemoteInstance: (id: string, accountId: string) =>
    invoke<void>("delete_remote_instance", { id, accountId }),

  // ---------- Settings ----------
  getSettings: () => invoke<LauncherSettings>("get_settings"),
  saveSettings: (settings: LauncherSettings) =>
    invoke<void>("save_settings", { settings }),
  clearCache: () => invoke<void>("clear_cache"),
  resetSettings: () => invoke<LauncherSettings>("reset_settings"),
  openLauncherFolder: () => invoke<void>("open_launcher_folder"),

  // ---------- Updater ----------
  checkForUpdates: () => invoke<{ available: boolean; version?: string }>("check_for_updates"),

  // ---------- Discord (launcher login gate) ----------
  getDiscordSession: () => invoke<DiscordSession | null>("get_discord_session"),
  beginDiscordLogin: () => invoke<string>("begin_discord_login"),
  pollDiscordLogin: () => invoke<DiscordSession>("poll_discord_login"),
  logoutDiscord: () => invoke<void>("logout_discord"),

  // ---------- Events ----------
  onDownloadProgress: (cb: (p: DownloadProgress) => void): Promise<UnlistenFn> =>
    listen<DownloadProgress>("download://progress", (e) => cb(e.payload)),

  // ---------- Offline-first sync queue ----------
  flushSyncQueue: () => invoke<number>("flush_sync_queue"),
  getSyncQueueStatus: () => invoke<number>("get_sync_queue_status"),
  onSyncQueueChanged: (cb: (pending: number) => void): Promise<UnlistenFn> =>
    listen<{ pending: number }>("sync://queue", (e) => cb(e.payload.pending)),
};

