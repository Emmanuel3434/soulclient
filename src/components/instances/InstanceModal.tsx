import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import Modal from "@/components/common/Modal";
import Button from "@/components/common/Button";
import { api } from "@/lib/tauri";
import type { InstanceConfig, InstanceDraft, LoaderType } from "@/types/instance";
import type { MinecraftVersion } from "@/types/version";

interface InstanceModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (draft: InstanceDraft) => Promise<void>;
  initial?: InstanceConfig;
}

const EMPTY_DRAFT: InstanceDraft = {
  name: "",
  version: "",
  loader: "vanilla",
  loaderVersion: undefined,
  directory: "",
  coverImage: undefined,
  ramMb: 4096,
  jvmArgs: "",
  customJavaPath: undefined,
  fullscreen: false,
  resolutionWidth: 1280,
  resolutionHeight: 720,
  whitelistEnabled: false,
  allowedDiscordIds: [],
};

export default function InstanceModal({ open, onClose, onSubmit, initial }: InstanceModalProps) {
  const [draft, setDraft] = useState<InstanceDraft>(EMPTY_DRAFT);
  const [versions, setVersions] = useState<MinecraftVersion[]>([]);
  const [fabricVersions, setFabricVersions] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(initial ? { ...initial } : EMPTY_DRAFT);
    api.fetchVersionManifest().then(setVersions).catch(console.error);
  }, [open, initial]);

  useEffect(() => {
    if (draft.loader === "fabric" && draft.version) {
      api.fetchFabricLoaders(draft.version).then(setFabricVersions).catch(console.error);
    }
  }, [draft.loader, draft.version]);

  const set = <K extends keyof InstanceDraft>(key: K, value: InstanceDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const pickDirectory = async () => {
    const dir = await openDialog({ directory: true, multiple: false });
    if (typeof dir === "string") set("directory", dir);
  };

  const pickCover = async () => {
    const file = await openDialog({
      multiple: false,
      filters: [{ name: "Imagen", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    if (typeof file === "string") set("coverImage", file);
  };

  const handleSubmit = async () => {
    if (!draft.name.trim() || !draft.version) return;
    setSaving(true);
    try {
      await onSubmit(draft);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={initial ? "Editar instancia" : "Nueva instancia"} wide>
      <div className="flex flex-col gap-4">
        <Field label="Nombre">
          <input
            value={draft.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Mi instancia"
            className="input"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Versión de Minecraft">
            <select
              value={draft.version}
              onChange={(e) => set("version", e.target.value)}
              className="input"
            >
              <option value="">Selecciona...</option>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.id}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Loader">
            <select
              value={draft.loader}
              onChange={(e) => set("loader", e.target.value as LoaderType)}
              className="input"
            >
              <option value="vanilla">Vanilla</option>
              <option value="fabric">Fabric</option>
            </select>
          </Field>
        </div>

        {draft.loader === "fabric" && (
          <Field label="Versión de Fabric Loader">
            <select
              value={draft.loaderVersion ?? ""}
              onChange={(e) => set("loaderVersion", e.target.value)}
              className="input"
            >
              <option value="">Más reciente</option>
              {fabricVersions.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Directorio">
            <button onClick={pickDirectory} className="input text-left truncate">
              {draft.directory || "Elegir carpeta..."}
            </button>
          </Field>
          <Field label="Imagen de portada">
            <button onClick={pickCover} className="input text-left truncate flex items-center gap-2">
              {draft.coverImage && (
                <img
                  src={convertFileSrc(draft.coverImage)}
                  alt=""
                  className="w-5 h-5 rounded object-cover shrink-0"
                />
              )}
              <span className="truncate">{draft.coverImage ? "Imagen seleccionada" : "Elegir imagen..."}</span>
            </button>
          </Field>
        </div>

        <Field label={`RAM asignada: ${draft.ramMb} MB`}>
          <input
            type="range"
            min={1024}
            max={16384}
            step={512}
            value={draft.ramMb}
            onChange={(e) => set("ramMb", Number(e.target.value))}
            className="w-full accent-blue-500"
          />
        </Field>

        <Field label="Argumentos JVM personalizados">
          <input
            value={draft.jvmArgs}
            onChange={(e) => set("jvmArgs", e.target.value)}
            placeholder="-XX:+UseG1GC ..."
            className="input"
          />
        </Field>

        <Field label="Ruta de Java personalizada (opcional)">
          <input
            value={draft.customJavaPath ?? ""}
            onChange={(e) => set("customJavaPath", e.target.value)}
            placeholder="Usar Java del sistema / auto-detectado"
            className="input"
          />
        </Field>

        <div className="grid grid-cols-3 gap-3 items-end">
          <Field label="Ancho">
            <input
              type="number"
              value={draft.resolutionWidth}
              onChange={(e) => set("resolutionWidth", Number(e.target.value))}
              className="input"
              disabled={draft.fullscreen}
            />
          </Field>
          <Field label="Alto">
            <input
              type="number"
              value={draft.resolutionHeight}
              onChange={(e) => set("resolutionHeight", Number(e.target.value))}
              className="input"
              disabled={draft.fullscreen}
            />
          </Field>
          <label className="flex items-center gap-2 h-9 text-sm text-neutral-300">
            <input
              type="checkbox"
              checked={draft.fullscreen}
              onChange={(e) => set("fullscreen", e.target.checked)}
              className="accent-blue-500"
            />
            Pantalla completa
          </label>
        </div>

        <div className="flex flex-col gap-3 p-3 rounded-lg bg-bg border border-border">
          <div>
            <span className="font-semibold text-white text-sm block">Visibilidad de la Instancia</span>
            <span className="text-[11px] text-neutral-500">
              Define si esta instancia aparecerá automáticamente para todos los jugadores al publicarse.
            </span>
          </div>

          <div className="flex items-center gap-4 text-xs">
            <label className="flex items-center gap-2 cursor-pointer text-neutral-200">
              <input
                type="radio"
                name="visibility"
                checked={!draft.whitelistEnabled}
                onChange={() => set("whitelistEnabled", false)}
                className="accent-blue-500"
              />
              <span><strong>Pública:</strong> Visible e instalable automáticamente por todos los usuarios</span>
            </label>
          </div>

          <div className="flex items-center gap-4 text-xs">
            <label className="flex items-center gap-2 cursor-pointer text-neutral-200">
              <input
                type="radio"
                name="visibility"
                checked={draft.whitelistEnabled}
                onChange={() => set("whitelistEnabled", true)}
                className="accent-blue-500"
              />
              <span><strong>Privada:</strong> Únicamente visible para administradores y Discord IDs autorizados</span>
            </label>
          </div>

          {draft.whitelistEnabled && (
            <Field label="Discord IDs permitidos (uno por línea, opcional para otros administradores)">
              <textarea
                value={draft.allowedDiscordIds.join("\n")}
                onChange={(e) =>
                  set(
                    "allowedDiscordIds",
                    e.target.value
                      .split(/[\n,]/)
                      .map((id) => id.trim())
                      .filter((id, i, arr) => id.length > 0 && arr.indexOf(id) === i)
                  )
                }
                placeholder={"123456789012345678\n987654321098765432"}
                rows={3}
                className="input font-mono text-xs resize-y"
              />
            </Field>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={saving || !draft.name || !draft.version}>
            {saving ? "Guardando..." : initial ? "Guardar cambios" : "Crear instancia"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-xs text-neutral-400">
      {label}
      {children}
    </label>
  );
}
