import { useEffect } from "react";
import SkinViewer from "@/components/skin/SkinViewer";
import Card from "@/components/common/Card";
import { useAccountStore } from "@/state/accountStore";

export default function Profile() {
  const { activeAccount, refresh } = useAccountStore();

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <h1 className="text-2xl font-bold">Perfil</h1>
      <p className="text-neutral-500 mt-1">Tu identidad dentro de SoulClient</p>

      {!activeAccount ? (
        <p className="text-sm text-neutral-500 mt-8">
          No hay ninguna cuenta activa. Ve a la sección de Cuentas para agregar una.
        </p>
      ) : (
        <div className="grid grid-cols-[280px_1fr] gap-6 mt-6">
          <Card className="flex flex-col items-center justify-center py-6">
            <SkinViewer skinUrl={activeAccount.skinUrl} capeUrl={activeAccount.capeUrl} />
          </Card>

          <div className="flex flex-col gap-4">
            <Card>
              <p className="text-xs text-neutral-500">Nombre</p>
              <p className="text-lg font-semibold">{activeAccount.username}</p>
            </Card>
            <Card>
              <p className="text-xs text-neutral-500">Tipo de cuenta</p>
              <p className="text-sm font-medium">
                {activeAccount.type === "premium" ? "Premium" : "No Premium"}
              </p>
            </Card>
            <Card>
              <p className="text-xs text-neutral-500">UUID</p>
              <p className="text-sm font-mono break-all">{activeAccount.uuid}</p>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
