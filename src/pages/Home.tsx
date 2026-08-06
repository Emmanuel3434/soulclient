import { useState } from "react";
import { Clock, Monitor, Newspaper } from "lucide-react";
import Card from "@/components/common/Card";
import { open } from "@tauri-apps/plugin-shell";

interface HomeStats {
  playTimeMs: number;
  launcherTimeMs: number;
}

function formatDuration(ms: number) {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

/**
 * "Inicio" — landing screen with quick stats and news.
 * The community feed section was intentionally removed for now; it will
 * ship in a future update once the community/guilds backend exists.
 */
export default function Home() {
  const [stats] = useState<HomeStats>({ playTimeMs: 0, launcherTimeMs: 0 });

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <h1 className="text-2xl font-bold">Inicio</h1>
      <p className="text-neutral-500 mt-1">Bienvenido de vuelta</p>

      <div className="grid grid-cols-2 gap-4 mt-6 max-w-xl">
        <Card className="flex items-center gap-3">
          <Clock size={18} className="text-accent-soft" />
          <div>
            <p className="text-sm font-semibold">{formatDuration(stats.playTimeMs)}</p>
            <p className="text-xs text-neutral-500">Tiempo de juego</p>
          </div>
        </Card>
        <Card className="flex items-center gap-3">
          <Monitor size={18} className="text-accent-soft" />
          <div>
            <p className="text-sm font-semibold">{formatDuration(stats.launcherTimeMs)}</p>
            <p className="text-xs text-neutral-500">Tiempo en launcher</p>
          </div>
        </Card>
      </div>

      <div className="mt-8">
        <h2 className="text-sm font-bold mb-3">Explora Noticias</h2>
        <div className="h-40 flex flex-col items-center justify-center gap-2 text-neutral-600 border border-dashed border-border rounded-xl">
          <Newspaper size={22} />
          <p className="text-sm">No hay noticias aún</p>
        </div>
      </div>

      <div className="mt-8 flex gap-3">
        <button
          onClick={() => open("https://discord.gg/7f4JjrHn9r")}
          className="px-4 h-9 rounded-lg bg-[#5865F2]/15 text-[#8ea1ff] text-xs font-medium hover:bg-[#5865F2]/25 transition-colors"
        >
          Discord
        </button>
        <button
          onClick={() => open("https://example.com")}
          className="px-4 h-9 rounded-lg bg-bg-card border border-border text-xs font-medium hover:bg-bg-hover transition-colors"
        >
          Página web
        </button>
        <button
          onClick={() => open("https://example.com/support")}
          className="px-4 h-9 rounded-lg bg-bg-card border border-border text-xs font-medium hover:bg-bg-hover transition-colors"
        >
          Soporte
        </button>
      </div>
    </div>
  );
}
