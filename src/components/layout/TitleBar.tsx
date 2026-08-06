import { useState } from "react";
import { LogOut, Minus, User, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { DiscordSession } from "@/types/discord";
import type { Account } from "@/types/account";

const appWindow = typeof window !== "undefined" ? getCurrentWindow() : null;

interface TitleBarProps {
  discordUser?: DiscordSession | null;
  activeAccount?: Account | null;
  onLogout?: () => void;
}

/** Custom frameless title bar with the SoulClient wordmark, the active user
 * (Discord or Minecraft profile), and window controls. */
export default function TitleBar({ discordUser, activeAccount, onLogout }: TitleBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  const userDisplayName = discordUser?.globalName || activeAccount?.username;
  const userSubName = discordUser ? `@${discordUser.username}` : activeAccount?.type === "premium" ? "Premium" : "No Premium";

  return (
    <div
      data-tauri-drag-region
      className="h-9 flex items-center justify-between px-3 bg-bg border-b border-border shrink-0"
    >
      <div data-tauri-drag-region className="flex items-center gap-2 text-sm font-semibold tracking-wide">
        <span className="text-accent-soft">Soul</span>
        <span className="text-white">Client</span>
      </div>

      <div className="flex items-center gap-3">
        {userDisplayName && (
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="flex items-center gap-2 pl-1 pr-2 h-7 rounded-full hover:bg-bg-hover transition-colors"
            >
              <div className="relative flex items-center justify-center">
                {discordUser?.avatarUrl ? (
                  <img
                    src={discordUser.avatarUrl}
                    alt={discordUser.username}
                    className="w-5 h-5 rounded-full"
                  />
                ) : (
                  <div className="w-5 h-5 rounded-full bg-neutral-700 text-neutral-300 flex items-center justify-center">
                    <User size={12} />
                  </div>
                )}
                <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-green-500 border border-bg" />
              </div>
              <span className="text-xs font-medium text-neutral-300">{userDisplayName}</span>
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-8 w-44 bg-bg-panel border border-border rounded-lg shadow-xl overflow-hidden z-50">
                <div className="px-3 py-2 border-b border-border">
                  <p className="text-xs font-medium truncate">{userDisplayName}</p>
                  <p className="text-[10px] text-neutral-500 truncate">{userSubName}</p>
                  <p className="text-[10px] text-green-500 mt-0.5">Sesión activa</p>
                </div>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    onLogout?.();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-bg-hover transition-colors"
                >
                  <LogOut size={12} />
                  Cerrar sesión
                </button>
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-1">
          <button
            onClick={() => appWindow?.minimize()}
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-bg-hover text-neutral-400 hover:text-white transition-colors"
          >
            <Minus size={14} />
          </button>
          <button
            onClick={() => appWindow?.close()}
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-red-600 text-neutral-400 hover:text-white transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
