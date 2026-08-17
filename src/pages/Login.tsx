import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle, Loader2, ShieldCheck, Sparkles, User } from "lucide-react";
import { useDiscordStore } from "@/state/discordStore";
import { useAccountStore } from "@/state/accountStore";
import { isMinecraftUsernameTaken } from "@/lib/supabase";
import soulfotoLogo from "@/assets/soulfoto-banner.png";

const DiscordIcon = () => (
  <svg width="18" height="18" viewBox="0 0 127.14 96.36" fill="currentColor">
    <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z" />
  </svg>
);

export default function Login() {
  const { status, error: discordError, login: loginDiscord } = useDiscordStore();
  const { addOffline } = useAccountStore();
  const discordLoading = status === "authenticating";

  // No-Premium inline form
  const [showOffline, setShowOffline] = useState(false);
  const [username, setUsername] = useState("");
  const [offlineError, setOfflineError] = useState<string | null>(null);
  const [offlineLoading, setOfflineLoading] = useState(false);

  const validName = /^[A-Za-z0-9_]{3,16}$/;

  const handleOfflinePlay = async () => {
    if (!validName.test(username)) {
      setOfflineError("El nombre debe tener 3-16 caracteres (letras, números, guion bajo).");
      return;
    }
    setOfflineLoading(true);
    setOfflineError(null);
    try {
      const taken = await isMinecraftUsernameTaken(username);
      if (taken) {
        setOfflineError("Ese nombre ya está registrado por otro usuario del launcher.");
        return;
      }
      await addOffline(username);
      // App.tsx detectará activeAccount y mostrará la app automáticamente
    } catch (err) {
      setOfflineError("No se pudo crear la cuenta. Intenta nuevamente.");
    } finally {
      setOfflineLoading(false);
    }
  };

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
          className="mb-1"
        >
          <img
            src={soulfotoLogo}
            alt="SoulClient"
            className="h-16 w-auto object-contain mx-auto"
            draggable={false}
          />
        </motion.div>

        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent/10 border border-accent/25 text-accent-soft text-xs font-medium my-3">
          <Sparkles size={13} />
          <span>Identidad Única Vinculada</span>
        </div>

        <p className="text-xs text-neutral-400 mb-7 leading-relaxed max-w-xs">
          Inicia sesión con Discord para sincronizar tu perfil, o entra directamente con un nombre de usuario.
        </p>

        {/* Discord Login */}
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

        {/* Divider */}
        <div className="w-full flex items-center gap-3 my-4">
          <div className="flex-1 h-px bg-border/60" />
          <span className="text-[11px] text-neutral-600">o</span>
          <div className="flex-1 h-px bg-border/60" />
        </div>

        {/* No-Premium Section */}
        <AnimatePresence mode="wait">
          {!showOffline ? (
            <motion.button
              key="toggle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowOffline(true)}
              className="w-full h-11 rounded-xl bg-bg-card border border-border hover:border-neutral-500 text-neutral-300 hover:text-white text-sm font-medium flex items-center justify-center gap-2.5 transition-all"
            >
              <User size={16} />
              Jugar sin cuenta (No Premium)
            </motion.button>
          ) : (
            <motion.div
              key="form"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="w-full flex flex-col gap-2"
            >
              <input
                value={username}
                onChange={(e) => { setUsername(e.target.value); setOfflineError(null); }}
                onKeyDown={(e) => e.key === "Enter" && handleOfflinePlay()}
                placeholder="Nombre de usuario (3-16 chars)"
                className="input w-full text-sm"
                maxLength={16}
                autoFocus
              />
              {offlineError && (
                <p className="text-[11px] text-red-400 text-left">{offlineError}</p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={handleOfflinePlay}
                  disabled={offlineLoading || username.length < 3}
                  className="flex-1 h-10 rounded-lg bg-accent hover:bg-accent/80 disabled:opacity-50 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-all"
                >
                  {offlineLoading ? <Loader2 size={14} className="animate-spin" /> : null}
                  {offlineLoading ? "Entrando..." : "Entrar"}
                </button>
                <button
                  onClick={() => { setShowOffline(false); setOfflineError(null); setUsername(""); }}
                  className="w-10 h-10 rounded-lg bg-bg-card border border-border hover:border-neutral-500 text-neutral-400 hover:text-white flex items-center justify-center transition-all text-xs"
                >
                  ✕
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-5 pt-4 border-t border-border/70 w-full flex items-center justify-center gap-2 text-[11px] text-neutral-500">
          <ShieldCheck size={14} className="text-emerald-400 shrink-0" />
          <span>Acceso seguro • Sincronización automática</span>
        </div>

        <AnimatePresence>
          {discordError && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="w-full mt-3 flex items-start gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5 text-left"
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
