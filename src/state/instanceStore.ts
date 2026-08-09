import { create } from "zustand";
import { api } from "@/lib/tauri";
import { supabase } from "@/lib/supabase";
import type { InstanceConfig, InstanceDraft, RemoteInstance } from "@/types/instance";

interface InstanceStoreState {
  instances: InstanceConfig[];
  loading: boolean;
  remoteInstances: RemoteInstance[];
  remoteLoading: boolean;
  realtimeActive: boolean;
  refresh: () => Promise<void>;
  refreshRemote: (accountId?: string) => Promise<void>;
  installRemote: (id: string, accountId?: string) => Promise<InstanceConfig>;
  publish: (instanceId: string, accountId: string) => Promise<void>;
  removeRemote: (id: string, accountId: string) => Promise<void>;
  create: (draft: InstanceDraft, accountId: string) => Promise<InstanceConfig>;
  update: (instance: InstanceConfig, accountId: string) => Promise<void>;
  remove: (id: string, accountId: string) => Promise<void>;
  subscribeRealtime: () => () => void;
}

/**
 * Mutating actions (create/update/remove) all require an `accountId` that
 * the Rust backend re-validates against the admin allowlist — the frontend
 * hides these controls for non-admins too, but the real enforcement lives
 * server-side so a modified UI can't bypass it.
 */
export const useInstanceStore = create<InstanceStoreState>((set, get) => ({
  instances: [],
  loading: false,
  remoteInstances: [],
  remoteLoading: false,
  realtimeActive: false,

  refresh: async () => {
    set({ loading: true });
    try {
      const instances = await api.listInstances();
      set({ instances, loading: false });
    } catch (err) {
      console.error("Failed to refresh instances", err);
      set({ loading: false });
    }
  },

  refreshRemote: async (accountId?: string) => {
    set({ remoteLoading: true });
    try {
      const remoteInstances = await api.listRemoteInstances(accountId);
      set({ remoteInstances, remoteLoading: false });
    } catch (err) {
      console.error("Failed to refresh remote instances", err);
      set({ remoteInstances: [], remoteLoading: false });
    }
  },

  installRemote: async (id: string, accountId?: string) => {
    const instance = await api.installRemoteInstance(id, accountId);
    set((s) => ({ instances: [...s.instances, instance] }));
    return instance;
  },

  publish: async (instanceId: string, accountId: string) => {
    await api.publishInstance(instanceId, accountId);
    const remoteInstances = await api.listRemoteInstances(accountId);
    set({ remoteInstances });
  },

  removeRemote: async (id: string, accountId: string) => {
    await api.deleteRemoteInstance(id, accountId);
    set((s) => ({ remoteInstances: s.remoteInstances.filter((r) => r.id !== id) }));
  },

  create: async (draft: InstanceDraft, accountId: string) => {
    const instance = await api.createInstance(draft, accountId);
    set((s) => ({ instances: [...s.instances, instance] }));
    return instance;
  },

  update: async (instance: InstanceConfig, accountId: string) => {
    const updated = await api.updateInstance(instance, accountId);
    set((s) => ({
      instances: s.instances.map((i) => (i.id === updated.id ? updated : i)),
    }));
  },

  remove: async (id: string, accountId: string) => {
    await api.deleteInstance(id, accountId);
    set((s) => ({ instances: s.instances.filter((i) => i.id !== id) }));
  },

  /**
   * Subscribes to Supabase Realtime for the `instances` table.
   * - INSERT  → refreshes the remote instance list immediately so new
   *             published instances appear without a manual reload.
   * - UPDATE  → refreshes remote list in case metadata changes.
   * - DELETE  → removes the entry from the remote list optimistically.
   *
   * Returns an unsubscribe cleanup function suitable for React useEffect.
   *
   * Usage in a component:
   *   useEffect(() => useInstanceStore.getState().subscribeRealtime(), []);
   */
  subscribeRealtime: () => {
    if (get().realtimeActive) {
      return () => {};
    }

    const channel = supabase
      .channel("instances-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "instances" },
        (_payload) => {
          // A new instance was published — refresh remote list
          get().refreshRemote();
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "instances" },
        (_payload) => {
          get().refreshRemote();
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "instances" },
        (payload) => {
          const deletedId = (payload.old as { id?: string })?.id;
          if (deletedId) {
            set((s) => ({
              remoteInstances: s.remoteInstances.filter((r) => r.id !== deletedId),
            }));
          }
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          set({ realtimeActive: true });
        }
      });

    return () => {
      supabase.removeChannel(channel);
      set({ realtimeActive: false });
    };
  },
}));
