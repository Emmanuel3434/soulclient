import { motion } from "framer-motion";
import { Home, LayoutGrid, Settings, Shirt, User, Users, Shield } from "lucide-react";
import { useAccountStore } from "@/state/accountStore";
import { useDiscordStore } from "@/state/discordStore";
import appIcon from "@/assets/app-icon.png";

export type Route = "home" | "instances" | "skin" | "admin" | "settings" | "profile" | "accounts";

interface SidebarProps {
  route: Route;
  onNavigate: (route: Route) => void;
}

const NAV_ITEMS: { id: Route; icon: typeof Home; label: string }[] = [
  { id: "home", icon: Home, label: "Inicio" },
  { id: "instances", icon: LayoutGrid, label: "Instancias" },
  { id: "skin", icon: Shirt, label: "Skin" },
  { id: "admin", icon: Shield, label: "Administración" },
  { id: "settings", icon: Settings, label: "Configuración" },
];

/** Left rail navigation, mirrors the reference design's icon-only sidebar. */
export default function Sidebar({ route, onNavigate }: SidebarProps) {
  const { activeAccount } = useAccountStore();
  const { session } = useDiscordStore();
  const isAdmin =
    !!activeAccount?.isAdmin ||
    activeAccount?.username?.toLowerCase() === "emanueel" ||
    session?.username?.toLowerCase() === "emanueel" ||
    session?.globalName?.toLowerCase() === "emanueel";

  // Filtrar la navegación para que los usuarios normales NO vean la opción de administración
  const visibleNavItems = NAV_ITEMS.filter((item) => {
    if (item.id === "admin") {
      return isAdmin;
    }
    return true;
  });

  return (
    <div className="w-[60px] shrink-0 h-full bg-bg-panel border-r border-border flex flex-col items-center py-3 gap-2">
      <img
        src={appIcon}
        alt="Soul Launcher"
        className="w-8 h-8 rounded-md mb-3 select-none"
        draggable={false}
      />

      {visibleNavItems.map((item) => {
        const active = route === item.id;
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            title={item.label}
            onClick={() => onNavigate(item.id)}
            className="relative w-10 h-10 flex items-center justify-center rounded-lg group"
          >
            {active && (
              <motion.div
                layoutId="sidebar-active"
                className="absolute inset-0 bg-white/8 border border-white/15 rounded-lg"
                transition={{ type: "spring", duration: 0.4 }}
              />
            )}
            <Icon
              size={19}
              className={
                active
                  ? "relative text-white"
                  : "relative text-neutral-600 group-hover:text-neutral-300 transition-colors"
              }
            />
          </button>
        );
      })}

      <div className="flex-1" />

      <button
        title="Perfil"
        onClick={() => onNavigate("profile")}
        className="relative w-10 h-10 flex items-center justify-center rounded-lg group"
      >
        {route === "profile" && (
          <motion.div
            layoutId="sidebar-active"
            className="absolute inset-0 bg-accent/15 border border-accent/40 rounded-lg"
          />
        )}
        <User
          size={19}
          className={
            route === "profile"
              ? "relative text-accent-soft"
              : "relative text-neutral-500 group-hover:text-neutral-200 transition-colors"
          }
        />
      </button>
      <button
        title="Cuentas"
        onClick={() => onNavigate("accounts")}
        className="relative w-10 h-10 flex items-center justify-center rounded-lg group"
      >
        <Users
          size={19}
          className={
            route === "accounts"
              ? "text-accent-soft"
              : "text-neutral-500 group-hover:text-neutral-200 transition-colors"
          }
        />
      </button>
    </div>
  );
}


