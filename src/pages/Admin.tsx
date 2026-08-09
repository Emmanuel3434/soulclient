import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield,
  Plus,
  Trash2,
  Edit3,
  RefreshCw,
  CheckCircle2,
  FileCheck,
  HardDrive,
  PackageCheck,
  AlertCircle,
  ToggleLeft,
  ToggleRight,
  UploadCloud,
  X,
  Sliders,
  Bell,
  Newspaper,
  Send,
} from "lucide-react";
import { api } from "@/lib/tauri";
import { useAccountStore } from "@/state/accountStore";
import { useInstanceStore } from "@/state/instanceStore";
import { useDiscordStore } from "@/state/discordStore";
import { supabase, getSupabaseNews, type SupabaseNewsItem } from "@/lib/supabase";
import type { VaultModEntry } from "@/types/modvault";

export default function Admin() {
  const { activeAccount } = useAccountStore();
  const { instances, refresh: refreshInstances } = useInstanceStore();
  const { session, userProfile } = useDiscordStore();
  const isAdmin =
    !!activeAccount?.isAdmin ||
    activeAccount?.username?.toLowerCase() === "emanueel" ||
    session?.username?.toLowerCase() === "emanueel" ||
    session?.globalName?.toLowerCase() === "emanueel";

  const [activeTab, setActiveTab] = useState<"mods" | "news">("mods");

  const [mods, setMods] = useState<VaultModEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Modal State for Adding/Editing Mod
  const [showModal, setShowModal] = useState(false);
  const [editingMod, setEditingMod] = useState<VaultModEntry | null>(null);
  const [formFilePath, setFormFilePath] = useState("");
  const [formName, setFormName] = useState("");
  const [formVersion, setFormVersion] = useState("1.0.0");
  const [formInstanceId, setFormInstanceId] = useState("*");
  const [formIsMandatory, setFormIsMandatory] = useState(true);

  // News state
  const [newsList, setNewsList] = useState<SupabaseNewsItem[]>([]);
  const [loadingNews, setLoadingNews] = useState(false);
  const [showNewsModal, setShowNewsModal] = useState(false);
  const [newsTitle, setNewsTitle] = useState("");
  const [newsBody, setNewsBody] = useState("");
  const [newsTag, setNewsTag] = useState("Actualización");
  const [newsEmoji, setNewsEmoji] = useState("📢");

  const fetchMods = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.listAllProtectedMods();
      setMods(data);
    } catch (err: any) {
      setError(err?.toString() || "Error al cargar los mods del vault.");
    } finally {
      setLoading(false);
    }
  };

  const fetchNews = async () => {
    setLoadingNews(true);
    try {
      const data = await getSupabaseNews();
      setNewsList(data);
    } catch (err: any) {
      console.error("Error fetching news", err);
    } finally {
      setLoadingNews(false);
    }
  };

  useEffect(() => {
    fetchMods();
    fetchNews();
    refreshInstances();
  }, []);

  const handleCreateNews = async () => {
    if (!newsTitle.trim()) {
      setError("Ingresa un título para la notificación.");
      return;
    }
    try {
      const { error: err } = await supabase.from("news").insert({
        title: newsTitle.trim(),
        body: newsBody.trim() || null,
        tag: newsTag.trim() || "Notificación",
        emoji: newsEmoji.trim() || "📢",
        published_at: new Date().toISOString(),
      });

      if (err) throw err;

      setSuccessMsg("Notificación publicada con éxito en el launcher.");
      setShowNewsModal(false);
      setNewsTitle("");
      setNewsBody("");
      fetchNews();
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      setError(err?.message || "No se pudo publicar la notificación.");
    }
  };

  const handleDeleteNews = async (id: string) => {
    if (!confirm("¿Eliminar esta notificación?")) return;
    try {
      const { error: err } = await supabase.from("news").delete().eq("id", id);
      if (err) throw err;
      setSuccessMsg("Notificación eliminada.");
      fetchNews();
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      setError(err?.message || "Error al eliminar la notificación.");
    }
  };

  const handlePickFile = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Minecraft Mod", extensions: ["jar"] }],
      });
      if (selected && typeof selected === "string") {
        setFormFilePath(selected);
        if (!formName) {
          const fileName = selected.split(/[/\\]/).pop() || "";
          setFormName(fileName.replace(/\.jar$/i, ""));
        }
      }
    } catch (err) {
      console.error("Error seleccionando archivo", err);
    }
  };

  const handleOpenAdd = () => {
    setEditingMod(null);
    setFormFilePath("");
    setFormName("");
    setFormVersion("1.0.0");
    setFormInstanceId("*");
    setFormIsMandatory(true);
    setShowModal(true);
  };

  const handleOpenEdit = (mod: VaultModEntry) => {
    setEditingMod(mod);
    setFormFilePath("");
    setFormName(mod.name);
    setFormVersion(mod.version);
    setFormInstanceId(mod.instanceId);
    setFormIsMandatory(mod.isMandatory);
    setShowModal(true);
  };

  const handleSaveMod = async () => {
    if (!activeAccount) {
      setError("Debes seleccionar una cuenta activa con permisos de administrador.");
      return;
    }

    try {
      if (editingMod) {
        // Update existing mod
        await api.updateProtectedMod(
          editingMod.id,
          formFilePath || undefined,
          formVersion,
          formIsMandatory,
          activeAccount.id
        );
        setSuccessMsg(`Mod "${formName}" actualizado correctamente.`);
      } else {
        // Add new mod
        if (!formFilePath) {
          setError("Selecciona un archivo .jar para subir.");
          return;
        }
        await api.addProtectedMod(
          formInstanceId,
          formFilePath,
          formName,
          formVersion,
          formIsMandatory,
          activeAccount.id
        );
        setSuccessMsg(`Mod "${formName}" añadido con éxito al vault protegido.`);
      }
      setShowModal(false);
      fetchMods();
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      setError(err?.toString() || "No se pudo guardar el mod.");
    }
  };

  const handleDeleteMod = async (mod: VaultModEntry) => {
    if (!activeAccount) return;
    if (!confirm(`¿Eliminar el mod protegido "${mod.name}"?`)) return;

    try {
      await api.removeProtectedMod(mod.id, activeAccount.id);
      setSuccessMsg(`Mod "${mod.name}" eliminado correctamente.`);
      fetchMods();
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      setError(err?.toString() || "Error al eliminar el mod.");
    }
  };

  const handleToggleMandatory = async (mod: VaultModEntry) => {
    if (!activeAccount) return;
    try {
      await api.updateProtectedMod(
        mod.id,
        undefined,
        mod.version,
        !mod.isMandatory,
        activeAccount.id
      );
      fetchMods();
    } catch (err: any) {
      setError(err?.toString() || "Error al actualizar la obligatoriedad.");
    }
  };

  const handleSyncAll = async () => {
    setSyncing(true);
    try {
      await fetchMods();
      setSuccessMsg("Sincronización completada. Todos los launchers de los usuarios recibirán estos mods automáticamente.");
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      setError("Error durante la sincronización.");
    } finally {
      setSyncing(false);
    }
  };

  const formatSize = (bytes: number) => {
    return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  };

  const mandatoryCount = mods.filter((m: VaultModEntry) => m.isMandatory).length;
  const optionalCount = mods.length - mandatoryCount;

  if (!isAdmin) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-bg p-6 text-center">
        <div className="p-4 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 mb-4">
          <Shield size={36} />
        </div>
        <h2 className="text-xl font-bold text-white mb-2">Acceso Denegado</h2>
        <p className="text-xs text-neutral-400 max-w-sm">
          No tienes permisos suficientes para acceder a las funciones administrativas de SoulClient.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-bg p-6 overflow-y-auto">
      {/* Header section */}
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-border/60">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-accent/15 border border-accent/30 text-accent-soft">
              <Shield size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-white tracking-wide">
                  Panel de Administración
                </h1>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 border border-amber-500/30 text-amber-400 uppercase tracking-wider">
                  Admin: {session?.username || userProfile?.username || "Verificado"}
                </span>
              </div>
              <p className="text-xs text-neutral-400">
                Gestión centralizada de mods protegidos, notificaciones y sincronización en tiempo real con Supabase
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex bg-bg-panel border border-border rounded-lg p-1">
            <button
              onClick={() => setActiveTab("mods")}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition ${
                activeTab === "mods"
                  ? "bg-accent text-white"
                  : "text-neutral-400 hover:text-white"
              }`}
            >
              <PackageCheck size={14} />
              Mods Vault
            </button>
            <button
              onClick={() => setActiveTab("news")}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition ${
                activeTab === "news"
                  ? "bg-accent text-white"
                  : "text-neutral-400 hover:text-white"
              }`}
            >
              <Bell size={14} />
              Notificaciones ({newsList.length})
            </button>
          </div>

          {activeTab === "mods" ? (
            <>
              <button
                onClick={handleSyncAll}
                disabled={syncing}
                className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-bg-panel border border-border text-neutral-300 hover:text-white hover:border-neutral-700 transition text-xs font-medium"
              >
                <RefreshCw size={14} className={syncing ? "animate-spin text-accent-soft" : ""} />
                Sincronizar Launcher
              </button>
              <button
                onClick={handleOpenAdd}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-accent to-accent-soft text-white hover:opacity-95 transition text-xs font-semibold shadow-lg shadow-accent/20"
              >
                <Plus size={16} />
                Subir Nuevo Mod
              </button>
            </>
          ) : (
            <button
              onClick={() => setShowNewsModal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-accent to-accent-soft text-white hover:opacity-95 transition text-xs font-semibold shadow-lg shadow-accent/20"
            >
              <Send size={15} />
              Crear Notificación
            </button>
          )}
        </div>
      </div>

      {/* Notifications */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mb-4 p-3 rounded-lg bg-red-500/15 border border-red-500/30 text-red-400 text-xs flex items-center justify-between"
          >
            <div className="flex items-center gap-2">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
            <button onClick={() => setError(null)}>
              <X size={14} />
            </button>
          </motion.div>
        )}
        {successMsg && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mb-4 p-3 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs flex items-center gap-2"
          >
            <CheckCircle2 size={16} />
            <span>{successMsg}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Overview Stat Cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="p-4 rounded-xl bg-bg-panel border border-border flex items-center gap-4">
          <div className="p-3 rounded-lg bg-blue-500/10 text-blue-400">
            <PackageCheck size={20} />
          </div>
          <div>
            <div className="text-xl font-bold text-white">{mods.length}</div>
            <div className="text-xs text-neutral-400">Total Mods Protegidos</div>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-bg-panel border border-border flex items-center gap-4">
          <div className="p-3 rounded-lg bg-emerald-500/10 text-emerald-400">
            <FileCheck size={20} />
          </div>
          <div>
            <div className="text-xl font-bold text-white">{mandatoryCount}</div>
            <div className="text-xs text-neutral-400">Mods Obligatorios</div>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-bg-panel border border-border flex items-center gap-4">
          <div className="p-3 rounded-lg bg-amber-500/10 text-amber-400">
            <Sliders size={20} />
          </div>
          <div>
            <div className="text-xl font-bold text-white">{optionalCount}</div>
            <div className="text-xs text-neutral-400">Mods Opcionales</div>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-bg-panel border border-border flex items-center gap-4">
          <div className="p-3 rounded-lg bg-purple-500/10 text-purple-400">
            <HardDrive size={20} />
          </div>
          <div>
            <div className="text-xl font-bold text-white">AES-256</div>
            <div className="text-xs text-neutral-400">Cifrado de Bóveda</div>
          </div>
        </div>
      </div>

      {/* Mods or News Table / Grid */}
      <div className="flex-1 rounded-xl bg-bg-panel border border-border p-4 flex flex-col">
        {activeTab === "mods" ? (
          <>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-neutral-200 uppercase tracking-wider">
                Catálogo de Mods Administrados
              </h2>
              <span className="text-xs text-neutral-500">
                {mods.length} {mods.length === 1 ? "mod registrado" : "mods registrados"}
              </span>
            </div>

            {loading ? (
              <div className="flex-1 flex items-center justify-center">
                <RefreshCw size={24} className="animate-spin text-accent-soft" />
              </div>
            ) : mods.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center py-12 text-center">
                <Shield size={40} className="text-neutral-600 mb-3" />
                <p className="text-sm text-neutral-400 font-medium">No hay mods subidos en el vault.</p>
                <p className="text-xs text-neutral-500 mt-1 max-w-sm">
                  Sube tus mods personalizados para distribuirlos de forma segura a todos los jugadores.
                </p>
                <button
                  onClick={handleOpenAdd}
                  className="mt-4 px-4 py-2 rounded-lg bg-accent/20 border border-accent/40 text-accent-soft hover:bg-accent/30 text-xs font-semibold transition"
                >
                  + Añadir Primer Mod
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {mods.map((mod) => (
                  <motion.div
                    key={mod.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex items-center justify-between p-3.5 rounded-lg bg-bg border border-border/80 hover:border-neutral-700 transition"
                  >
                    <div className="flex items-center gap-3.5">
                      <div className="p-2.5 rounded-lg bg-accent/10 border border-accent/20 text-accent-soft shrink-0">
                        <Shield size={18} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-white">{mod.name}</span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-neutral-800 text-neutral-400 border border-neutral-700">
                            v{mod.version}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                              mod.isMandatory
                                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                                : "bg-amber-500/10 text-amber-400 border-amber-500/30"
                            }`}
                          >
                            {mod.isMandatory ? "Obligatorio" : "Opcional"}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-neutral-500 mt-1 font-mono">
                          <span>{mod.originalName}</span>
                          <span>•</span>
                          <span>{formatSize(mod.sizeBytes)}</span>
                          <span>•</span>
                          <span>Instancia: {mod.instanceId === "*" ? "Global" : mod.instanceId}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleToggleMandatory(mod)}
                        title={mod.isMandatory ? "Cambiar a Opcional" : "Cambiar a Obligatorio"}
                        className="p-1.5 rounded-lg bg-neutral-800/80 border border-neutral-700/60 text-neutral-300 hover:text-white transition"
                      >
                        {mod.isMandatory ? (
                          <ToggleRight size={18} className="text-emerald-400" />
                        ) : (
                          <ToggleLeft size={18} className="text-neutral-500" />
                        )}
                      </button>
                      <button
                        onClick={() => handleOpenEdit(mod)}
                        title="Editar detalles / actualizar archivo"
                        className="p-1.5 rounded-lg bg-neutral-800/80 border border-neutral-700/60 text-neutral-300 hover:text-white transition"
                      >
                        <Edit3 size={16} />
                      </button>
                      <button
                        onClick={() => handleDeleteMod(mod)}
                        title="Eliminar Mod"
                        className="p-1.5 rounded-lg bg-neutral-800/80 border border-neutral-700/60 text-red-400 hover:bg-red-500/20 transition"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-neutral-200 uppercase tracking-wider">
                NotificacionesEnviadas a los Launchers
              </h2>
              <span className="text-xs text-neutral-500">
                {newsList.length} {newsList.length === 1 ? "notificación" : "notificaciones"}
              </span>
            </div>

            {loadingNews ? (
              <div className="flex-1 flex items-center justify-center">
                <RefreshCw size={24} className="animate-spin text-accent-soft" />
              </div>
            ) : newsList.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center py-12 text-center">
                <Bell size={40} className="text-neutral-600 mb-3" />
                <p className="text-sm text-neutral-400 font-medium">No hay notificaciones creadas.</p>
                <p className="text-xs text-neutral-500 mt-1 max-w-sm">
                  Crea y envía notificaciones que aparecerán inmediatamente en el launcher de los usuarios.
                </p>
                <button
                  onClick={() => setShowNewsModal(true)}
                  className="mt-4 px-4 py-2 rounded-lg bg-accent/20 border border-accent/40 text-accent-soft hover:bg-accent/30 text-xs font-semibold transition"
                >
                  + Enviar Notificación
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {newsList.map((item) => (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex items-center justify-between p-3.5 rounded-lg bg-bg border border-border/80 hover:border-neutral-700 transition"
                  >
                    <div className="flex items-center gap-3.5">
                      <div className="p-2.5 rounded-lg bg-accent/10 border border-accent/20 text-accent-soft shrink-0 text-lg">
                        {item.emoji || "📢"}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-white">{item.title}</span>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-accent/15 border border-accent/30 text-accent-soft">
                            {item.tag}
                          </span>
                        </div>
                        {item.body && (
                          <p className="text-xs text-neutral-400 mt-1 max-w-xl truncate">
                            {item.body}
                          </p>
                        )}
                        <p className="text-[10px] text-neutral-500 mt-1 font-mono">
                          Publicado: {new Date(item.published_at).toLocaleString()}
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={() => handleDeleteNews(item.id)}
                      title="Eliminar Notificación"
                      className="p-1.5 rounded-lg bg-neutral-800/80 border border-neutral-700/60 text-red-400 hover:bg-red-500/20 transition"
                    >
                      <Trash2 size={16} />
                    </button>
                  </motion.div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Modal Dialog for Upload / Edit Mod */}
      <AnimatePresence>
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-md bg-bg-panel border border-border rounded-xl p-5 shadow-2xl space-y-4"
            >
              <div className="flex items-center justify-between border-b border-border/60 pb-3">
                <h3 className="text-base font-bold text-white">
                  {editingMod ? "Editar Mod Protegido" : "Subir Nuevo Mod al Vault"}
                </h3>
                <button
                  onClick={() => setShowModal(false)}
                  className="text-neutral-400 hover:text-white transition"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-3.5 text-xs">
                {/* File picker */}
                <div>
                  <label className="block text-neutral-400 font-medium mb-1">
                    Archivo Mod (.jar) {editingMod && "(Opcional si solo editas metadata)"}
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      readOnly
                      placeholder="Selecciona un archivo .jar..."
                      value={formFilePath}
                      className="flex-1 bg-bg border border-border rounded-lg px-3 py-2 text-neutral-200 font-mono text-xs focus:outline-none"
                    />
                    <button
                      onClick={handlePickFile}
                      className="px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-neutral-200 hover:text-white flex items-center gap-1.5 transition"
                    >
                      <UploadCloud size={14} />
                      Buscar
                    </button>
                  </div>
                </div>

                {/* Mod Name */}
                <div>
                  <label className="block text-neutral-400 font-medium mb-1">Nombre del Mod</label>
                  <input
                    type="text"
                    placeholder="Ej: Custom Cosmetics Mod"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-white focus:border-accent-soft focus:outline-none"
                  />
                </div>

                {/* Mod Version & Instance */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-neutral-400 font-medium mb-1">Versión</label>
                    <input
                      type="text"
                      placeholder="1.0.0"
                      value={formVersion}
                      onChange={(e) => setFormVersion(e.target.value)}
                      className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-white focus:border-accent-soft focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-neutral-400 font-medium mb-1">Asignar Instancia</label>
                    <select
                      value={formInstanceId}
                      onChange={(e) => setFormInstanceId(e.target.value)}
                      className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-white focus:border-accent-soft focus:outline-none"
                    >
                      <option value="*">Global (Todas)</option>
                      {instances.map((inst) => (
                        <option key={inst.id} value={inst.id}>
                          {inst.name} ({inst.version})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Is Mandatory toggle */}
                <div className="flex items-center justify-between p-3 rounded-lg bg-bg border border-border">
                  <div>
                    <div className="font-semibold text-white">Mod Obligatorio</div>
                    <div className="text-[11px] text-neutral-400">
                      Se cargará automáticamente a todos los jugadores al iniciar.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFormIsMandatory(!formIsMandatory)}
                    className="text-white"
                  >
                    {formIsMandatory ? (
                      <ToggleRight size={26} className="text-emerald-400" />
                    ) : (
                      <ToggleLeft size={26} className="text-neutral-500" />
                    )}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-border/60 pt-3">
                <button
                  onClick={() => setShowModal(false)}
                  className="px-3.5 py-1.5 rounded-lg border border-border text-neutral-300 hover:text-white text-xs"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSaveMod}
                  className="px-4 py-1.5 rounded-lg bg-accent text-white hover:bg-accent/90 font-medium text-xs shadow-md shadow-accent/20"
                >
                  Guardar Mod
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal Dialog for Creating Notification */}
      <AnimatePresence>
        {showNewsModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-md bg-bg-panel border border-border rounded-xl p-5 shadow-2xl space-y-4"
            >
              <div className="flex items-center justify-between border-b border-border/60 pb-3">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Bell size={18} className="text-accent-soft" />
                  Crear Notificación para el Launcher
                </h3>
                <button
                  onClick={() => setShowNewsModal(false)}
                  className="text-neutral-400 hover:text-white transition"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-3.5 text-xs">
                <div className="grid grid-cols-4 gap-3">
                  <div className="col-span-1">
                    <label className="block text-neutral-400 font-medium mb-1">Emoji</label>
                    <input
                      type="text"
                      value={newsEmoji}
                      onChange={(e) => setNewsEmoji(e.target.value)}
                      className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-center text-white text-sm focus:border-accent-soft focus:outline-none"
                    />
                  </div>

                  <div className="col-span-3">
                    <label className="block text-neutral-400 font-medium mb-1">Etiqueta / Tag</label>
                    <input
                      type="text"
                      placeholder="Actualización, Evento, Mantenimiento..."
                      value={newsTag}
                      onChange={(e) => setNewsTag(e.target.value)}
                      className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-white focus:border-accent-soft focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-neutral-400 font-medium mb-1">Título de la Notificación *</label>
                  <input
                    type="text"
                    placeholder="Ej: ¡Servidor actualizado a Fabric 1.20.1!"
                    value={newsTitle}
                    onChange={(e) => setNewsTitle(e.target.value)}
                    className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-white font-semibold focus:border-accent-soft focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-neutral-400 font-medium mb-1">Contenido / Mensaje</label>
                  <textarea
                    rows={4}
                    placeholder="Escribe los detalles o novedades que verán todos los usuarios en su pantalla de inicio..."
                    value={newsBody}
                    onChange={(e) => setNewsBody(e.target.value)}
                    className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-white focus:border-accent-soft focus:outline-none resize-none leading-relaxed"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-border/60 pt-3">
                <button
                  onClick={() => setShowNewsModal(false)}
                  className="px-3.5 py-1.5 rounded-lg border border-border text-neutral-300 hover:text-white text-xs"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleCreateNews}
                  className="px-4 py-1.5 rounded-lg bg-accent text-white hover:bg-accent/90 font-medium text-xs shadow-md shadow-accent/20 flex items-center gap-1.5"
                >
                  <Send size={14} />
                  Publicar Ahora
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
