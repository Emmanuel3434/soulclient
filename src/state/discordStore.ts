import { create } from "zustand";
import { api } from "@/lib/tauri";
import type { DiscordSession } from "@/types/discord";
import { syncDiscordUser, type SupabaseUserProfile } from "@/lib/supabase";
import { useAccountStore } from "@/state/accountStore";

export type DiscordAuthStatus = "checking" | "loggedOut" | "authenticating" | "authenticated" | "error";

interface DiscordStoreState {
  status: DiscordAuthStatus;
  session: DiscordSession | null;
  userRole: "admin" | "user";
  userProfile: SupabaseUserProfile | null;
  error: string | null;
  /** Called once on app boot: silently restores a remembered session. */
  restore: () => Promise<void>;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useDiscordStore = create<DiscordStoreState>((set) => ({
  status: "checking",
  session: null,
  userRole: "user",
  userProfile: null,
  error: null,

  restore: async () => {
    set({ status: "checking", error: null });
    try {
      const session = await api.getDiscordSession();
      if (session) {
        const profile = await syncDiscordUser(session);
        set({
          session,
          userProfile: profile,
          userRole: profile.role,
          status: "authenticated",
        });

        // Asegurar que la cuenta de Minecraft local correspondiente esté creada y activa
        try {
          await useAccountStore.getState().addOffline(profile.minecraftUsername);
        } catch (err) {
          // Si ya existe, simplemente se refresca la lista
          await useAccountStore.getState().refresh();
        }
      } else {
        set({ status: "loggedOut", session: null, userProfile: null, userRole: "user" });
      }
    } catch (err) {
      console.error("Failed to restore Discord session", err);
      set({ status: "loggedOut", session: null, userProfile: null, userRole: "user" });
    }
  },

  login: async () => {
    set({ status: "authenticating", error: null });
    try {
      await api.beginDiscordLogin();
      const session = await api.pollDiscordLogin();
      
      const profile = await syncDiscordUser(session);
      
      set({
        session,
        userProfile: profile,
        userRole: profile.role,
        status: "authenticated",
      });

      // Crear / activar la cuenta de Minecraft asociada
      try {
        await useAccountStore.getState().addOffline(profile.minecraftUsername);
      } catch (err) {
        await useAccountStore.getState().refresh();
      }
    } catch (err) {
      console.error("Discord login failed", err);
      set({
        status: "error",
        error: typeof err === "string" ? err : "No se pudo iniciar sesión con Discord.",
      });
    }
  },

  logout: async () => {
    await api.logoutDiscord();
    set({ session: null, userProfile: null, userRole: "user", status: "loggedOut" });
  },
}));

