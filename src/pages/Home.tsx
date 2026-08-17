import { useEffect, useState } from "react";
import { Clock, Monitor, Newspaper, Bell, RefreshCw } from "lucide-react";
import Card from "@/components/common/Card";
import { open } from "@tauri-apps/plugin-shell";
import { getSupabaseNews, subscribeNewsRealtime, type SupabaseNewsItem } from "@/lib/supabase";
import soul2Banner from "@/assets/soul2-banner.png";

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

export default function Home() {
  const [stats] = useState<HomeStats>({ playTimeMs: 0, launcherTimeMs: 0 });
  const [news, setNews] = useState<SupabaseNewsItem[]>([]);
  const [loadingNews, setLoadingNews] = useState(true);

  const fetchNews = async () => {
    setLoadingNews(true);
    const data = await getSupabaseNews();
    setNews(data);
    setLoadingNews(false);
  };

  useEffect(() => {
    fetchNews();
    const unsubscribe = subscribeNewsRealtime(() => {
      fetchNews();
    });
    return () => {
      unsubscribe();
    };
  }, []);

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="relative w-full h-40 rounded-xl overflow-hidden mb-6">
        <img
          src={soul2Banner}
          alt="SoulClient Banner"
          className="w-full h-full object-cover"
          draggable={false}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-bg/80 to-transparent" />
        <div className="absolute bottom-4 left-5">
          <h1 className="text-2xl font-bold text-white drop-shadow-lg">Inicio</h1>
          <p className="text-neutral-300 text-sm mt-0.5">Bienvenido de vuelta</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mt-2 max-w-xl">
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
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Bell size={16} className="text-accent-soft" />
            <h2 className="text-sm font-bold text-white">Notificaciones y Novedades</h2>
          </div>
          {loadingNews && <RefreshCw size={14} className="animate-spin text-neutral-500" />}
        </div>

        {loadingNews && news.length === 0 ? (
          <div className="h-32 flex items-center justify-center border border-border rounded-xl bg-bg-card">
            <RefreshCw size={20} className="animate-spin text-accent-soft" />
          </div>
        ) : news.length === 0 ? (
          <div className="h-36 flex flex-col items-center justify-center gap-2 text-neutral-600 border border-dashed border-border rounded-xl bg-bg-card/50">
            <Newspaper size={22} />
            <p className="text-sm font-medium">No hay notificaciones aún</p>
            <p className="text-xs text-neutral-500">Las notificaciones enviadas desde el panel de administración aparecerán aquí al instante.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {news.map((item) => (
              <div
                key={item.id}
                className="bg-bg-card border border-border hover:border-neutral-700 transition rounded-xl p-4 flex flex-col justify-between space-y-2"
              >
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-base">{item.emoji || "📰"}</span>
                      <h3 className="text-sm font-bold text-white leading-snug">{item.title}</h3>
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-accent/15 border border-accent/30 text-accent-soft shrink-0">
                      {item.tag || "Notificación"}
                    </span>
                  </div>
                  {item.body && (
                    <p className="text-xs text-neutral-300 leading-relaxed whitespace-pre-wrap">
                      {item.body}
                    </p>
                  )}
                </div>
                <div className="pt-2 border-t border-border/40 flex items-center justify-between text-[10px] text-neutral-500 font-mono">
                  <span>
                    {new Date(item.published_at).toLocaleDateString(undefined, {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <span className="text-accent-soft font-semibold">SoulClient News</span>
                </div>
              </div>
            ))}
          </div>
        )}
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

