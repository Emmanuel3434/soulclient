import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { useDiscordStore } from "@/state/discordStore";

const DiscordIcon = () => (
  <svg width="20" height="20" viewBox="0 0 127.14 96.36" fill="currentColor">
    <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z" />
  </svg>
);

export default function Login() {
  const { status, error: discordError, login: loginDiscord } = useDiscordStore();
  const discordLoading = status === "authenticating";

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-bg relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-accent/15 via-transparent to-purple-600/15" />
      <motion.div
        className="absolute w-[500px] h-[500px] rounded-full bg-accent/15 blur-3xl"
        animate={{ x: [0, 40, 0], y: [0, -30, 0] }}
        transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
      />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="relative z-10 w-[420px] bg-bg-panel border border-border rounded-2xl shadow-2xl px-8 py-9 flex flex-col items-center text-center"
      >
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.1, type: "spring", bounce: 0.4 }}
          className="text-3xl font-extrabold tracking-wide mb-1"
        >
          <span className="text-accent-soft">Soul</span>
          <span className="text-white">Client</span>
        </motion.div>

        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent/10 border border-accent/25 text-accent-soft text-xs font-medium my-3">
          <Sparkles size={13} />
          <span>Identidad Única Vincular</span>
        </div>

        <p className="text-xs text-neutral-400 mb-7 leading-relaxed max-w-xs">
          Tu cuenta de Discord actúa como tu perfil principal de Minecraft en SoulClient, sincronizado en tiempo real con Supabase.
        </p>

        {/* Discord Main Login Button */}
        <button
          onClick={() => loginDiscord()}
          disabled={discordLoading}
          className="w-full h-12 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] active:scale-[0.99] disabled:opacity-70 text-white text-sm font-semibold flex items-center justify-center gap-3 transition-all shadow-lg shadow-[#5865F2]/25"
        >
          {discordLoading ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              Esperando autorización en el navegador...
            </>
          ) : (
            <>
              <DiscordIcon />
              Iniciar sesión con Discord
            </>
          )}
        </button>

        <div className="mt-6 pt-5 border-t border-border/70 w-full flex items-center justify-center gap-2 text-[11px] text-neutral-500">
          <ShieldCheck size={14} className="text-emerald-400 shrink-0" />
          <span>Acceso seguro • Sincronización automática</span>
        </div>

        <AnimatePresence>
          {discordError && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="w-full mt-4 flex items-start gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5 text-left"
            >
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span>{discordError}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}


