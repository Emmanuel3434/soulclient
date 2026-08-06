import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { AlertCircle, Loader2, Upload } from "lucide-react";
import { motion } from "framer-motion";
import SkinViewer from "@/components/skin/SkinViewer";
import Card from "@/components/common/Card";
import Button from "@/components/common/Button";
import { useAccountStore } from "@/state/accountStore";

/**
 * Replaces the old "Biblioteca de versiones" tab. The version manifest is
 * still fetched internally by the instance creation modal — it just no
 * longer needs its own top-level page — while this screen becomes the
 * player's skin manager: view current skin, pick a new PNG from disk, and
 * see the 3D preview update the instant the upload finishes.
 */
export default function Skin() {
  const { activeAccount, uploadSkin } = useAccountStore();
  const [variant, setVariant] = useState<"classic" | "slim">("classic");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justUpdated, setJustUpdated] = useState(false);

  const handlePickFile = async () => {
    setError(null);
    try {
      const path = await openDialog({
        multiple: false,
        filters: [{ name: "Imagen de skin", extensions: ["png"] }],
      });
      if (typeof path !== "string") return;

      setUploading(true);
      await uploadSkin(path, variant === "slim");
      setJustUpdated(true);
      setTimeout(() => setJustUpdated(false), 1800);
    } catch (err) {
      console.error("Failed to upload skin", err);
      setError(
        typeof err === "string"
          ? err
          : "No se pudo aplicar la skin. Verifica que el archivo sea un PNG válido."
      );
    } finally {
      setUploading(false);
    }
  };

  if (!activeAccount) {
    return (
      <div className="flex-1 overflow-y-auto p-8">
        <h1 className="text-2xl font-bold">Skin</h1>
        <p className="text-neutral-500 mt-1">
          No hay ninguna cuenta activa. Ve a la sección de Cuentas para agregar una.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <h1 className="text-2xl font-bold">Skin</h1>
      <p className="text-neutral-500 mt-1">
        Administra la apariencia de {activeAccount.username} en el juego
      </p>

      <div className="grid grid-cols-[300px_1fr] gap-6 mt-6">
        <Card className="flex flex-col items-center justify-center py-6 relative">
          <SkinViewer skinUrl={activeAccount.skinUrl} capeUrl={activeAccount.capeUrl} />
          {justUpdated && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="absolute bottom-3 bg-accent/20 border border-accent/40 text-accent-soft text-xs px-3 py-1 rounded-full"
            >
              Skin actualizada ✓
            </motion.div>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <p className="text-sm font-semibold mb-1">Cambiar skin</p>
            <p className="text-xs text-neutral-500 mb-4">
              {activeAccount.type === "premium"
                ? "Se subirá directamente a tu perfil de Minecraft (Mojang) y se verá para todos."
                : "Como cuenta No Premium, la skin sólo se aplica dentro de SoulClient (no hay un servidor de perfiles al que subirla)."}
            </p>

            <div className="flex items-center gap-2 mb-4">
              <button
                onClick={() => setVariant("classic")}
                className={`px-3 h-8 rounded-md text-xs font-medium border transition-colors ${
                  variant === "classic"
                    ? "bg-accent/15 border-accent/40 text-accent-soft"
                    : "bg-bg-card border-border text-neutral-400"
                }`}
              >
                Clásica (4px brazo)
              </button>
              <button
                onClick={() => setVariant("slim")}
                className={`px-3 h-8 rounded-md text-xs font-medium border transition-colors ${
                  variant === "slim"
                    ? "bg-accent/15 border-accent/40 text-accent-soft"
                    : "bg-bg-card border-border text-neutral-400"
                }`}
              >
                Slim (3px brazo)
              </button>
            </div>

            <Button onClick={handlePickFile} disabled={uploading} className="flex items-center gap-2">
              {uploading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Upload size={14} />
              )}
              {uploading ? "Subiendo skin..." : "Seleccionar imagen PNG"}
            </Button>

            {error && (
              <div className="flex items-start gap-2 text-xs text-red-400 mt-3">
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </Card>

          <Card>
            <p className="text-xs text-neutral-500">Cuenta</p>
            <p className="text-sm font-medium">{activeAccount.username}</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
