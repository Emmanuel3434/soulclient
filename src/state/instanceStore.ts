import { create } from "zustand";
import { api } from "@/lib/tauri";
import { supabase } from "@/lib/supabase";
import type { InstanceConfig, InstanceDraft, RemoteInstance } from "@/types/instance";
import type { ModSyncResult } from "@/types/modvault";

interface InstanceStoreState {
  instances: InstanceConfig[];
  loading: boolean;
  remoteInstances: RemoteInstance[];
  remoteLoading: boolean;
  realtimeActive: boolean;
  /** Mutaciones que todavía no se han enviado al backend (modo offline). */
  pendingSync: number;
  /** Resultado del último sync de mods protegidos por instancia local. */
  lastModSync: Record<string, ModSyncResult>;
  refresh: () => Promise<void>;
  refreshRemote: (accountId?: string) => Promise<void>;
  installRemote: (id: string, accountId?: string) => Promise<InstanceConfig>;
  publish: (instanceId: string, accountId: string) => Promise<void>;
  removeRemote: (id: string, accountId: string) => Promise<void>;
  create: (draft: InstanceDraft, accountId: string) => Promise<InstanceConfig>;
  update: (instance: InstanceConfig, accountId: string) => Promise<void>;
  remove: (id: string, accountId: string) => Promise<void>;
  flushSyncQueue: () => Promise<void>;
  refreshSyncStatus: () => Promise<void>;
  subscribeRealtime: () => () => void;
  syncInstanceMods: (localInstanceId: string) => Promise<void>;
  syncInstalledMods: () => Promise<void>;
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
  pendingSync: 0,
  lastModSync: {},

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
    if (instance.remoteId) {
      get().syncInstanceMods(instance.id);
    }
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
   * Pide al backend que intente vaciar la cola de sincronización
   * (instancias/mods editados sin conexión). Si la red no responde la cola
   * persiste en disco y se reintenta al reconectar (Realtime SUBSCRIBED) o
   * desde el timer de fondo del launcher.
   */
  flushSyncQueue: async () => {
    try {
      const pending = await api.flushSyncQueue();
      set({ pendingSync: pending });
    } catch (err) {
      console.warn("No se pudo sincronizar la cola (¿sin conexión?)", err);
      await get().refreshSyncStatus();
    }
  },

  refreshSyncStatus: async () => {
    try {
      const pending = await api.getSyncQueueStatus();
      set({ pendingSync: pending });
    } catch {
      // Sin backend no hay cola que consultar; mantener el valor anterior.
    }
  },

  /**
   * Subscribes to Supabase Realtime for the `instances` and `mods` tables.
   * - `instances` INSERT/UPDATE → refreshes the remote list immediately;
   *   DELETE removes the entry optimistically.
   * - `mods` changes → a player's launcher auto-syncs its encrypted ModVault
   *   for the affected local instance (the admin just pushed/edited a mod).
   * - On (re)connection (`SUBSCRIBED`) → flushes the offline sync queue.
   *
   * Returns an unsubscribe cleanup function suitable for React useEffect.
   */
  subscribeRealtime: () => {
    if (get().realtimeActive) {
      return () => {};
    }

    let unlistenSync: (() => void) | undefined;
    api.onSyncQueueChanged((pending) => set({ pendingSync: pending })).then(
      (fn) => {
        unlistenSync = fn;
      }
    );

    // El id remoto de la instancia afectada puede venir en `new` (INSERT/
    // UPDATE) o `old` (DELETE) del payload.
    const remoteInstanceIdFromPayload = (payload: any): string | undefined =>
      payload?.new?.instance_id ?? payload?.old?.instance_id ?? undefined;

    const handleModsChange = (payload: any) => {
      const remoteInstanceId = remoteInstanceIdFromPayload(payload);
      if (!remoteInstanceId) return;
      const local = get().instances.find((i) => i.remoteId === remoteInstanceId);
      if (local) {
        get().syncInstanceMods(local.id);
      }
    };

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
          // Conexión restablecida: vaciar cualquier CRUD offline pendiente.
          get().flushSyncQueue();
        }
      });

    const modsChannel = supabase
      .channel("instances-mods-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "mods" },
        handleModsChange
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "mods" },
        handleModsChange
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "mods" },
        handleModsChange
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(modsChannel);
      set({ realtimeActive: false });
      unlistenSync?.();
    };
  },

  /**
   * Sincroniza los mods protegidos de una instancia local con el backend y
   * guarda el resultado para mostrar el badge de actualización en la tarjeta.
   */
  syncInstanceMods: async (localInstanceId: string) => {
    try {
      const result = await api.syncProtectedMods(localInstanceId);
      set((s) => ({ lastModSync: { ...s.lastModSync, [localInstanceId]: result } }));
    } catch (err) {
      console.error("Failed to sync protected mods", err);
    }
  },

  /**
   * Re-sincroniza los mods protegidos de todas las instancias instaladas que
   * vienen del catálogo. Corre al abrir la pestaña de instancias, así los
   * jugadores reciben los mods que el admin subió desde el panel aunque el
   * launcher no estuviera abierto cuando se publicaron (el Realtime solo
   * cubre el momento en vivo).
   */
  syncInstalledMods: async () => {
    const localInstances = get().instances.filter((i) => i.remoteId);
    for (const inst of localInstances) {
      await get().syncInstanceMods(inst.id);
    }
  },
}));
