import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useSettingsStore } from "@/state/settingsStore";
import { useAccountStore } from "@/state/accountStore";
import Card from "@/components/common/Card";
import Button from "@/components/common/Button";
import { api } from "@/lib/tauri";

export default function Settings() {
  const { settings, refresh, save, reset } = useSettingsStore();
  const { activeAccount } = useAccountStore();
  // Igual que en el resto del launcher: `isAdmin` viene del backend (cuenta
  // Premium + lista de admins), no del rol de Discord/Supabase.
  const isAdmin = !!activeAccount?.isAdmin;
  const [local, setLocal] = useState(settings);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => setLocal(settings), [settings]);

  const set = <K extends keyof typeof local>(key: K, value: (typeof local)[K]) =>
    setLocal((s) => ({ ...s, [key]: value }));

  const handleSave = async () => {
    await save(local);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const pickPath = async (key: "minecraftPath" | "javaPath", directory: boolean) => {
    const result = await openDialog({ directory, multiple: false });
    if (typeof result === "string") set(key, result);
  };

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <h1 className="text-2xl font-bold">Configuración</h1>
      <p className="text-neutral-500 mt-1">Ajusta el comportamiento del launcher</p>

      <div className="flex flex-col gap-4 mt-6 max-w-xl">
        <Card>
          <p className="text-xs text-neutral-400 mb-2">RAM máxima: {local.maxRamMb} MB</p>
          <input
            type="range"
            min={1024}
            max={32768}
            step={512}
            value={local.maxRamMb}
            onChange={(e) => set("maxRamMb", Number(e.target.value))}
            className="w-full accent-blue-500"
          />
        </Card>

        <Card className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">Ruta de Minecraft</p>
            <p className="text-xs text-neutral-500 truncate">{local.minecraftPath || "Predeterminada"}</p>
          </div>
          <Button variant="secondary" onClick={() => pickPath("minecraftPath", true)}>
            Elegir
          </Button>
        </Card>

        <Card className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">Ruta de Java</p>
            <p className="text-xs text-neutral-500 truncate">{local.javaPath || "Auto-detectada"}</p>
          </div>
          <Button variant="secondary" onClick={() => pickPath("javaPath", false)}>
            Elegir
          </Button>
        </Card>

        <Card className="flex items-center justify-between">
          <p className="text-sm font-medium">Idioma</p>
          <select
            value={local.language}
            onChange={(e) => set("language", e.target.value as "es" | "en")}
            className="input w-32"
          >
            <option value="es">Español</option>
            <option value="en">English</option>
          </select>
        </Card>

        <Card>
          <p className="text-xs text-neutral-400 mb-2">FPS de la interfaz: {local.interfaceFps}</p>
          <input
            type="range"
            min={30}
            max={144}
            step={1}
            value={local.interfaceFps}
            onChange={(e) => set("interfaceFps", Number(e.target.value))}
            className="w-full accent-blue-500"
          />
        </Card>

        <Card className="flex items-center justify-between">
          <p className="text-sm font-medium">Actualizaciones automáticas</p>
          <input
            type="checkbox"
            checked={local.autoUpdate}
            onChange={(e) => set("autoUpdate", e.target.checked)}
            className="accent-blue-500 w-4 h-4"
          />
        </Card>

        {isAdmin && (
          <Card>
            <p className="text-sm font-medium mb-1">Token de publicación (solo administradores)</p>
            <p className="text-xs text-neutral-500 mb-2">
              Token con el que se suben y eliminan instancias del catálogo remoto. Déjalo
              vacío para los usuarios normales.
            </p>
            <input
              value={local.publishToken}
              onChange={(e) => set("publishToken", e.target.value)}
              placeholder="pega tu token aquí"
              className="input"
            />
          </Card>
        )}


        <div className="flex items-center gap-3 mt-2">
          <Button onClick={handleSave}>{saved ? "Guardado ✓" : "Guardar cambios"}</Button>
          <Button variant="secondary" onClick={() => api.clearCache()}>
            Limpiar caché
          </Button>
          <Button variant="secondary" onClick={() => api.openLauncherFolder()}>
            Abrir carpeta del launcher
          </Button>
          <Button variant="danger" onClick={reset}>
            Reiniciar configuración
          </Button>
        </div>
      </div>
    </div>
  );
}
