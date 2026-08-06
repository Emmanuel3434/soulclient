import { create } from "zustand";
import { api } from "@/lib/tauri";
import { DEFAULT_SETTINGS, type LauncherSettings } from "@/types/settings";

interface SettingsStoreState {
  settings: LauncherSettings;
  loading: boolean;
  refresh: () => Promise<void>;
  save: (settings: LauncherSettings) => Promise<void>;
  reset: () => Promise<void>;
}

export const useSettingsStore = create<SettingsStoreState>((set) => ({
  settings: DEFAULT_SETTINGS,
  loading: false,

  refresh: async () => {
    set({ loading: true });
    try {
      const settings = await api.getSettings();
      set({ settings, loading: false });
    } catch (err) {
      console.error("Failed to load settings", err);
      set({ loading: false });
    }
  },

  save: async (settings: LauncherSettings) => {
    await api.saveSettings(settings);
    set({ settings });
  },

  reset: async () => {
    const settings = await api.resetSettings();
    set({ settings });
  },
}));
