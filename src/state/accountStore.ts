import { create } from "zustand";
import { api } from "@/lib/tauri";
import type { Account } from "@/types/account";

interface AccountStoreState {
  accounts: Account[];
  activeAccount: Account | null;
  loading: boolean;
  refresh: () => Promise<void>;
  addOffline: (username: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setActive: (id: string) => Promise<void>;
  uploadSkin: (filePath: string, slim: boolean) => Promise<void>;
}

export const useAccountStore = create<AccountStoreState>((set, get) => ({
  accounts: [],
  activeAccount: null,
  loading: false,

  refresh: async () => {
    set({ loading: true });
    try {
      const [accounts, active] = await Promise.all([
        api.listAccounts(),
        api.getActiveAccount(),
      ]);
      set({ accounts, activeAccount: active, loading: false });
    } catch (err) {
      console.error("Failed to refresh accounts", err);
      set({ loading: false });
    }
  },

  addOffline: async (username: string) => {
    const account = await api.addOfflineAccount(username);
    set((s) => ({ accounts: [...s.accounts, account] }));
    await get().setActive(account.id);
  },

  remove: async (id: string) => {
    await api.removeAccount(id);
    set((s) => ({ accounts: s.accounts.filter((a) => a.id !== id) }));
    if (get().activeAccount?.id === id) {
      set({ activeAccount: null });
    }
  },

  setActive: async (id: string) => {
    await api.setActiveAccount(id);
    const account = get().accounts.find((a) => a.id === id) ?? null;
    set({ activeAccount: account });
  },

  uploadSkin: async (filePath: string, slim: boolean) => {
    const active = get().activeAccount;
    if (!active) throw new Error("No hay una cuenta activa");
    const updated = await api.uploadSkin(active.id, filePath, slim);
    set((s) => ({
      accounts: s.accounts.map((a) => (a.id === updated.id ? updated : a)),
      activeAccount: s.activeAccount?.id === updated.id ? updated : s.activeAccount,
    }));
  },
}));
