import { motion } from "framer-motion";
import { Loader2, Lock, Play, Settings2, Upload } from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { InstanceConfig } from "@/types/instance";
import type { DownloadProgress } from "@/types/download";
import type { ModSyncResult } from "@/types/modvault";

interface InstanceCardProps {
  instance: InstanceConfig;
  progress?: DownloadProgress;
  canManage: boolean;
  onPlay: () => void;
  onEdit: () => void;
  onPublish?: () => void;
  syncResult?: ModSyncResult;
}

const LOADER_LABEL: Record<InstanceConfig["loader"], string> = {
  vanilla: "Vanilla",
  fabric: "Fabric",
};

export default function InstanceCard({ instance, progress, canManage, onPlay, onEdit, onPublish, syncResult }: InstanceCardProps) {
  const downloading = !!progress && progress.stage !== "done" && progress.stage !== "error";
  const newMods = syncResult ? syncResult.added + syncResult.updated : 0;
  const coverSrc = instance.coverImage
    ? /^https?:\/\//.test(instance.coverImage)
      ? instance.coverImage
      : convertFileSrc(instance.coverImage)
    : undefined;

  return (
    <motion.div
      layout
      whileHover={{ y: -2 }}
      className="group bg-bg-card border border-border rounded-xl overflow-hidden flex flex-col"
    >
      <div
        className="h-24 w-full bg-gradient-to-br from-accent/30 to-violet-600/20 bg-cover bg-center"
        style={{
          ...(coverSrc ? { backgroundImage: `url(${coverSrc})` } : {}),
          imageRendering: "auto",
        }}
      />
      <div className="p-3 flex flex-col gap-2 flex-1">
        <div>
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-semibold truncate">{instance.name}</p>
            {instance.whitelistEnabled && (
              <span
                title="Whitelist activada: solo será visible para los Discord ID permitidos al publicarla"
                className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/15 border border-amber-500/30 text-amber-400"
              >
                <Lock size={9} />
                Whitelist
              </span>
            )}
            {newMods > 0 && (
              <span
                title="El administrador publicó mods nuevos para esta instancia"
                className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 border border-emerald-500/30 text-emerald-400"
              >
                <Upload size={9} />
                {newMods} mod{newMods !== 1 ? "s" : ""} nuevo{newMods !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <p className="text-xs text-neutral-500">
            {instance.version} · {LOADER_LABEL[instance.loader]}
          </p>
        </div>

        {downloading ? (
          <div className="mt-auto">
            <div className="w-full h-1.5 bg-bg rounded-full overflow-hidden">
              <div
                className="h-full bg-accent transition-[width] duration-200"
                style={{
                  width: `${
                    progress.totalBytes > 0
                      ? Math.min(100, (progress.downloadedBytes / progress.totalBytes) * 100)
                      : 0
                  }%`,
                }}
              />
            </div>
            <p className="text-[10px] text-neutral-500 mt-1 truncate">
              {progress.stage} · {progress.fileName ?? "..."}
            </p>
          </div>
        ) : (
          <div className="mt-auto flex items-center gap-2">
            <button
              onClick={onPlay}
              className="flex-1 h-8 rounded-md bg-accent hover:bg-accent-soft text-white text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
            >
              <Play size={12} fill="currentColor" />
              Jugar
            </button>
            {canManage && (
              <>
                {onPublish && (
                  <button
                    onClick={onPublish}
                    title="Publicar en el catálogo remoto"
                    className="w-8 h-8 rounded-md bg-bg-hover text-neutral-400 hover:text-white flex items-center justify-center transition-colors"
                  >
                    <Upload size={13} />
                  </button>
                )}
                <button
                  onClick={onEdit}
                  className="w-8 h-8 rounded-md bg-bg-hover text-neutral-400 hover:text-white flex items-center justify-center transition-colors"
                >
                  <Settings2 size={13} />
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

export function InstanceCardSkeleton() {
  return (
    <div className="bg-bg-card border border-border rounded-xl overflow-hidden flex flex-col animate-pulse">
      <div className="h-24 w-full bg-bg-hover" />
      <div className="p-3 flex flex-col gap-2">
        <div className="h-3 w-2/3 bg-bg-hover rounded" />
        <div className="h-2 w-1/3 bg-bg-hover rounded" />
        <div className="h-8 w-full bg-bg-hover rounded mt-2 flex items-center justify-center">
          <Loader2 size={12} className="animate-spin text-neutral-600" />
        </div>
      </div>
    </div>
  );
}
