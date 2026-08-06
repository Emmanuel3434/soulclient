import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Check, Loader2, Plus, ShieldCheck, Trash2, User } from "lucide-react";
import { useAccountStore } from "@/state/accountStore";
import Button from "@/components/common/Button";
import Modal from "@/components/common/Modal";
import { api } from "@/lib/tauri";
import { isMinecraftUsernameTaken } from "@/lib/supabase";

export default function Accounts() {
  const { accounts, activeAccount, refresh, addOffline, remove, setActive } = useAccountStore();
  const [offlineModal, setOfflineModal] = useState(false);
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checkingName, setCheckingName] = useState(false);
  const [msLoading, setMsLoading] = useState(false);
  const [msCode, setMsCode] = useState<string | null>(null);

  useEffect(() => {
    refresh();
  }, []);

  const validName = /^[A-Za-z0-9_]{3,16}$/;

  const handleAddOffline = async () => {
    if (!validName.test(username)) {
      setError("El nombre debe tener 3-16 caracteres (letras, números, guion bajo).");
      return;
    }
    if (accounts.some((a) => a.username.toLowerCase() === username.toLowerCase())) {
      setError("Ya existe una cuenta con ese nombre.");
      return;
    }
    setCheckingName(true);
    setError(null);
    try {
      // Nombre libre en este equipo, pero puede que ya lo tenga registrado
      // otra persona del launcher (por ejemplo, un administrador) — se
      // comprueba contra el registro compartido antes de permitir crearlo.
      if (await isMinecraftUsernameTaken(username)) {
        setError("Ese nombre ya está registrado por otro usuario del launcher.");
        return;
      }
    } finally {
      setCheckingName(false);
    }
    await addOffline(username);
    setUsername("");
    setError(null);
    setOfflineModal(false);
  };

  const handleMicrosoftLogin = async () => {
    setMsLoading(true);
    setMsCode(null);
    try {
      // begin_microsoft_login returns the user_code + verification URL and
      // opens the browser; poll_microsoft_login resolves once the device
      // code flow completes (or throws on timeout/denial).
      const code = await api.beginMicrosoftLogin();
      setMsCode(code);
      const account = await api.pollMicrosoftLogin();
      if (account) await refresh();
    } catch (err) {
      console.error("Microsoft login failed", err);
      setError(
        "No se pudo iniciar sesión con Microsoft. Verifica que configuraste el Client ID de Azure en el backend."
      );
    } finally {
      setMsLoading(false);
      setMsCode(null);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <h1 className="text-2xl font-bold">Cuentas</h1>
      <p className="text-neutral-500 mt-1">Administra tus cuentas Premium y No Premium</p>

      <div className="flex gap-3 mt-6">
        <Button onClick={handleMicrosoftLogin} disabled={msLoading} className="flex items-center gap-2">
          {msLoading ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
          {msLoading ? msCode ?? "Conectando..." : "Iniciar sesión con Microsoft"}
        </Button>
        <Button variant="secondary" onClick={() => setOfflineModal(true)} className="flex items-center gap-2">
          <Plus size={14} />
          Agregar cuenta No Premium
        </Button>
      </div>

      {error && <p className="text-xs text-red-400 mt-3">{error}</p>}

      <div className="grid grid-cols-3 gap-4 mt-8">
        {accounts.map((account) => {
          const active = activeAccount?.id === account.id;
          return (
            <motion.div
              key={account.id}
              layout
              className={`bg-bg-card border rounded-xl p-4 flex items-center gap-3 ${
                active ? "border-accent" : "border-border"
              }`}
            >
              <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-accent to-purple-500 flex items-center justify-center">
                <User size={18} className="text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-semibold truncate">{account.username}</p>
                  {account.isAdmin && (
                    <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-accent/20 text-accent-soft">
                      Admin
                    </span>
                  )}
                </div>
                <p className="text-xs text-neutral-500">
                  {account.type === "premium" ? "Premium" : "No Premium"}
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                {active ? (
                  <span className="w-7 h-7 flex items-center justify-center rounded-md bg-accent/20 text-accent-soft">
                    <Check size={13} />
                  </span>
                ) : (
                  <button
                    onClick={() => setActive(account.id)}
                    className="w-7 h-7 flex items-center justify-center rounded-md bg-bg-hover text-neutral-400 hover:text-white transition-colors text-[10px] font-medium"
                  >
                    Usar
                  </button>
                )}
                <button
                  onClick={() => remove(account.id)}
                  className="w-7 h-7 flex items-center justify-center rounded-md bg-bg-hover text-neutral-400 hover:text-red-400 transition-colors"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </motion.div>
          );
        })}
      </div>

      <Modal open={offlineModal} title="Agregar cuenta No Premium" onClose={() => setOfflineModal(false)}>
        <div className="flex flex-col gap-3">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Nombre de usuario"
            className="input"
            maxLength={16}
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
          <Button onClick={handleAddOffline} disabled={checkingName}>
            {checkingName ? "Comprobando disponibilidad..." : "Agregar cuenta"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
