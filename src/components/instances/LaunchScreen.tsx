import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Cpu, MemoryStick, Terminal, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import type { InstanceConfig } from "@/types/instance";

interface LaunchScreenProps {
  instance: InstanceConfig;
  onClose: () => void;
  onLaunch: () => Promise<void>;
}

type Phase = "ready" | "launching" | "running" | "error";

interface LogLine {
  id: number;
  text: string;
  type: "info" | "ok" | "error";
}

export default function LaunchScreen({ instance, onClose, onLaunch }: LaunchScreenProps) {
  const [phase, setPhase] = useState<Phase>("ready");
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [error, setError] = useState<string | null>(null);

  const addLog = (text: string, type: LogLine["type"] = "info") => {
    setLogs((prev) => [...prev, { id: Date.now() + Math.random(), text, type }]);
  };

  const handleStart = async () => {
    setPhase("launching");
    setLogs([]);
    setError(null);

    addLog("Verificando instalación de Minecraft...");
    await delay(400);
    addLog("Instalación encontrada ✓", "ok");
    await delay(200);
    addLog(`Iniciando instancia "${instance.name}" (${instance.version})...`);

    try {
      await onLaunch();
      await delay(300);
      addLog("Minecraft lanzado exitosamente ✓", "ok");
      setPhase("running");
    } catch (err: any) {
      const msg = typeof err === "string" ? err : err?.message || "Error desconocido al lanzar.";
      addLog(`Error: ${msg}`, "error");
      setError(msg);
      setPhase("error");
    }
  };

  // Auto-start on mount
  useEffect(() => {
    handleStart();
  }, []);

  const loaderLabel = instance.loader === "fabric" ? "Fabric" : "Vanilla";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
    >
      <motion.div
        initial={{ scale: 0.94, opacity: 0, y: 12 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.96, opacity: 0, y: 8 }}
        transition={{ type: "spring", duration: 0.4, bounce: 0.2 }}
        className="w-[500px] bg-[#111111] border border-[#242424] rounded-2xl shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#242424]">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#1f1f1f] to-[#2a2a2a] border border-[#303030] flex items-center justify-center"
              style={
                instance.coverImage
                  ? { backgroundImage: `url(${instance.coverImage})`, backgroundSize: "cover" }
                  : undefined
              }
            >
              {!instance.coverImage && (
                <span className="text-sm font-bold text-neutral-400">
                  {instance.name.charAt(0).toUpperCase()}
                </span>
              )}
            </div>
            <div>
              <p className="text-sm font-semibold text-white">{instance.name}</p>
              <p className="text-xs text-neutral-500">
                {instance.version} · {loaderLabel}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={phase === "launching"}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-neutral-500 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <X size={14} />
          </button>
        </div>

        {/* Status banner */}
        <div className="px-5 py-3 border-b border-[#1a1a1a] bg-[#0e0e0e]">
          <div className="flex items-center gap-2.5">
            {phase === "ready" && <Cpu size={15} className="text-neutral-500" />}
            {phase === "launching" && <Loader2 size={15} className="text-neutral-300 animate-spin" />}
            {phase === "running" && <CheckCircle2 size={15} className="text-green-400" />}
            {phase === "error" && <AlertCircle size={15} className="text-red-400" />}

            <span className="text-xs font-medium text-neutral-200">
              {phase === "ready" && "Listo para iniciar"}
              {phase === "launching" && "Lanzando Minecraft..."}
              {phase === "running" && "Minecraft en ejecución"}
              {phase === "error" && "Error al lanzar"}
            </span>

            {phase === "launching" && (
              <div className="ml-auto flex items-center gap-1">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    className="w-1 h-1 rounded-full bg-neutral-500"
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
                  />
                ))}
              </div>
            )}
          </div>

          {phase === "launching" && (
            <motion.div
              className="mt-2 h-0.5 bg-[#1f1f1f] rounded-full overflow-hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <motion.div
                className="h-full bg-gradient-to-r from-neutral-600 via-white/80 to-neutral-600 rounded-full"
                animate={{ x: ["-100%", "200%"] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
              />
            </motion.div>
          )}
        </div>

        {/* Log terminal */}
        <div className="px-4 py-3">
          <div className="flex items-center gap-1.5 mb-2">
            <Terminal size={11} className="text-neutral-600" />
            <span className="text-[10px] text-neutral-600 uppercase tracking-widest font-semibold">Log de inicio</span>
          </div>
          <div className="bg-[#0a0a0a] border border-[#1f1f1f] rounded-lg p-3 h-36 overflow-y-auto font-mono text-[11px] space-y-0.5">
            <AnimatePresence initial={false}>
              {logs.map((line) => (
                <motion.div
                  key={line.id}
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.15 }}
                  className={
                    line.type === "ok"
                      ? "text-green-400"
                      : line.type === "error"
                      ? "text-red-400"
                      : "text-neutral-500"
                  }
                >
                  <span className="text-neutral-700 mr-2 select-none">›</span>
                  {line.text}
                </motion.div>
              ))}
              {logs.length === 0 && (
                <span className="text-neutral-700">Esperando inicio...</span>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Info chips */}
        <div className="px-4 pb-4 flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#1a1a1a] border border-[#252525] text-[11px] text-neutral-400">
            <MemoryStick size={11} />
          <span>{instance.ramMb ?? 4096} MB RAM</span>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#1a1a1a] border border-[#252525] text-[11px] text-neutral-400">
            <Cpu size={11} />
            <span>{loaderLabel}</span>
          </div>
          {phase === "running" && (
            <div className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-500/10 border border-green-500/25 text-[11px] text-green-400 animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
              En juego
            </div>
          )}
        </div>

        {/* Footer actions */}
        {(phase === "running" || phase === "error") && (
          <div className="px-4 pb-4 border-t border-[#1a1a1a] pt-3 flex justify-between gap-2">
            {phase === "error" && (
              <button
                onClick={handleStart}
                className="flex-1 h-8 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-neutral-300 transition-colors"
              >
                Reintentar
              </button>
            )}
            <button
              onClick={onClose}
              className="flex-1 h-8 rounded-lg bg-[#1a1a1a] hover:bg-[#222222] border border-[#2a2a2a] text-xs font-medium text-neutral-400 transition-colors"
            >
              {phase === "running" ? "Cerrar (juego en curso)" : "Cerrar"}
            </button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
