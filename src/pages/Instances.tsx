import { useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { Plus, ShieldAlert, CloudDownload, Trash2, Lock } from "lucide-react";
import { useInstanceStore } from "@/state/instanceStore";
import { useAccountStore } from "@/state/accountStore";
import { useDownloadStore } from "@/state/downloadStore";
import InstanceCard, { InstanceCardSkeleton } from "@/components/instances/InstanceCard";
import InstanceModal from "@/components/instances/InstanceModal";
import LaunchScreen from "@/components/instances/LaunchScreen";
import Button from "@/components/common/Button";
import { api } from "@/lib/tauri";
import type { InstanceConfig, InstanceDraft, RemoteInstance } from "@/types/instance";

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export default function Instances() {
  const {
    instances,
    loading,
    refresh,
    create,
    update,
    remoteInstances,
    remoteLoading,
    refreshRemote,
    installRemote,
    publish,
    removeRemote,
  } = useInstanceStore();
  const { activeAccount } = useAccountStore();
  const { progress, setProgress } = useDownloadStore();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<InstanceConfig | undefined>(undefined);
  const [launchingInstance, setLaunchingInstance] = useState<InstanceConfig | null>(null);

  // Igual que en App.tsx/Sidebar.tsx: `isAdmin` viene del backend (cuenta
  // Premium + lista de admins), que es lo mismo que ya exige cada comando
  // sensible en Rust — no del rol de Discord/Supabase.
  const isAdmin = !!activeAccount?.isAdmin;

  useEffect(() => {
    refresh();
    refreshRemote(activeAccount?.id);
    const unlisten = api.onDownloadProgress(setProgress);
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [activeAccount?.id]);

  const handleCreate = async (draft: InstanceDraft) => {
    if (!activeAccount) return;
    await create(draft, activeAccount.id);
  };

  const handleEdit = async (draft: InstanceDraft) => {
    if (!editing || !activeAccount) return;
    await update({ ...editing, ...draft }, activeAccount.id);
  };

  // Abre la pantalla de lanzamiento
  const handlePlay = (instance: InstanceConfig) => {
    if (!activeAccount) {
      alert("Selecciona o crea una cuenta antes de jugar.");
      return;
    }
    setLaunchingInstance(instance);
  };

  // Esta función es la que realmente llama al backend
  const doLaunch = async (instance: InstanceConfig) => {
    await api.ensureVersionInstalled(instance.id);
    await api.launchInstance(instance.id, activeAccount!.id);
  };

  const handlePublish = async (instance: InstanceConfig) => {
    if (!activeAccount) return;
    try {
      await publish(instance.id, activeAccount.id);
    } catch (err) {
      console.error("Failed to publish instance", err);
      alert(String(err));
    }
  };

  const handleInstallRemote = async (remote: RemoteInstance) => {
    try {
      await installRemote(remote.id, activeAccount?.id);
      await refresh();
    } catch (err) {
      console.error("Failed to install remote instance", err);
      alert(String(err));
    }
  };

  const handleRemoveRemote = async (remote: RemoteInstance) => {
    if (!activeAccount) return;
    if (!confirm(`¿Eliminar "${remote.name}" del catálogo?`)) return;
    try {
      await removeRemote(remote.id, activeAccount.id);
    } catch (err) {
      console.error("Failed to delete remote instance", err);
      alert(String(err));
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Instancias</h1>
          <p className="text-neutral-500 mt-1">
            {isAdmin
              ? "Gestiona tus instalaciones de Minecraft"
              : "Instala y juega las instancias disponibles"}
          </p>
        </div>
        {isAdmin && (
          <Button
            onClick={() => {
              setEditing(undefined);
              setModalOpen(true);
            }}
            className="flex items-center gap-1.5"
          >
            <Plus size={15} />
            Nueva instancia
          </Button>
        )}
      </div>

      {!isAdmin && (
        <div className="flex items-center gap-2 text-xs text-neutral-500 bg-bg-card border border-border rounded-lg px-3 py-2 mt-4">
          <ShieldAlert size={14} />
          Solo los administradores pueden crear, editar, eliminar o publicar instancias.
        </div>
      )}

      {/* Remote catalog */}
      <div className="mt-6">
        <div className="flex items-center gap-2">
          <CloudDownload size={16} className="text-neutral-400" />
          <h2 className="text-sm font-semibold text-neutral-300">Instalables desde el servidor</h2>
          <span className="text-xs text-neutral-500">({remoteInstances.length})</span>
        </div>

        <div className="grid grid-cols-4 gap-4 mt-3">
          {remoteLoading && remoteInstances.length === 0 &&
            Array.from({ length: 4 }).map((_, i) => <InstanceCardSkeleton key={i} />)}

          {remoteInstances.map((remote) => {
            const p = progress[`remote:${remote.id}`];
            const busy = !!p && p.stage !== "done" && p.stage !== "error";
            const installed = instances.some((i) => i.name === remote.name && i.version === remote.version);
            return (
              <div
                key={remote.id}
                className="bg-bg-card border border-border rounded-xl overflow-hidden flex flex-col"
              >
                <div className="h-24 w-full bg-gradient-to-br from-green-600/30 to-emerald-600/20 bg-cover bg-center" />
                <div className="p-3 flex flex-col gap-2 flex-1">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-semibold truncate">{remote.name}</p>
                      {isAdmin && remote.whitelistEnabled && (
                        <span
                          title={`Solo visible para: ${remote.allowedDiscordIds.join(", ") || "nadie"}`}
                          className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/15 border border-amber-500/30 text-amber-400"
                        >
                          <Lock size={9} />
                          Whitelist
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-neutral-500">
                      {remote.version} · {remote.loader === "fabric" ? "Fabric" : "Vanilla"} ·{" "}
                      {formatBytes(remote.sizeBytes)} · {remote.downloads} descargas
                    </p>
                  </div>

                  {busy ? (
                    <div className="mt-auto">
                      <div className="w-full h-1.5 bg-bg rounded-full overflow-hidden">
                        <div
                          className="h-full bg-green-500 transition-[width] duration-200"
                          style={{
                            width:
                              p.totalBytes > 0
                                ? Math.min(100, (p.downloadedBytes / p.totalBytes) * 100)
                                : 0,
                          }}
                        />
                      </div>
                      <p className="text-[10px] text-neutral-500 mt-1 truncate">{p.log}</p>
                    </div>
                  ) : (
                    <div className="mt-auto flex items-center gap-2">
                      <button
                        onClick={() => handleInstallRemote(remote)}
                        disabled={installed}
                        className="flex-1 h-8 rounded-md bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
                      >
                        <CloudDownload size={12} />
                        {installed ? "Instalada" : "Instalar"}
                      </button>
                      {isAdmin && (
                        <button
                          onClick={() => handleRemoveRemote(remote)}
                          title="Eliminar del catálogo"
                          className="w-8 h-8 rounded-md bg-bg-hover text-neutral-400 hover:text-red-400 flex items-center justify-center transition-colors"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {!remoteLoading && remoteInstances.length === 0 && (
            <p className="col-span-4 text-xs text-neutral-600 mt-2">
              Aún no hay instancias publicadas en el servidor.
            </p>
          )}
        </div>
      </div>

      {/* Local instances */}
      <div className="flex items-center gap-2 mt-8">
        <h2 className="text-sm font-semibold text-neutral-300">Mis instancias</h2>
      </div>

      <div className="grid grid-cols-4 gap-4 mt-3">
        {loading &&
          instances.length === 0 &&
          Array.from({ length: 4 }).map((_, i) => <InstanceCardSkeleton key={i} />)}

        {instances.map((instance) => (
          <InstanceCard
            key={instance.id}
            instance={instance}
            progress={progress[instance.id]}
            canManage={isAdmin}
            onPlay={() => handlePlay(instance)}
            onEdit={() => {
              setEditing(instance);
              setModalOpen(true);
            }}
            onPublish={isAdmin ? () => handlePublish(instance) : undefined}
          />
        ))}
      </div>

      {!loading && instances.length === 0 && (
        <div className="mt-8 flex flex-col items-center gap-2 text-neutral-600">
          <p className="text-sm">Aún no hay instancias creadas</p>
        </div>
      )}

      {isAdmin && (
        <InstanceModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          onSubmit={editing ? handleEdit : handleCreate}
          initial={editing}
        />
      )}

      {/* Pantalla de lanzamiento */}
      <AnimatePresence>
        {launchingInstance && (
          <LaunchScreen
            instance={launchingInstance}
            onClose={() => setLaunchingInstance(null)}
            onLaunch={() => doLaunch(launchingInstance)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
