import { useState } from "react";
import { ChevronRight, MessageSquare, Search, UserPlus, Users } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { Account } from "@/types/account";

interface FriendsPanelProps {
  account: Account | null;
}

type Tab = "friends" | "chat" | "add";

/** Right-hand collapsible panel mirroring the reference screenshot's friends list. */
export default function FriendsPanel({ account }: FriendsPanelProps) {
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<Tab>("friends");
  const [search, setSearch] = useState("");

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-8 shrink-0 h-full bg-bg-panel border-l border-border flex items-start justify-center pt-3 text-neutral-500 hover:text-white transition-colors"
      >
        <Users size={16} />
      </button>
    );
  }

  return (
    <div className="w-[250px] shrink-0 h-full bg-bg-panel border-l border-border flex flex-col">
      <div className="flex items-center justify-between px-3 py-3 border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <div className="relative shrink-0">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-accent to-purple-500 flex items-center justify-center text-xs font-bold">
              {account ? account.username.slice(0, 1).toUpperCase() : "?"}
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-500 border-2 border-bg-panel" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">
              {account?.username ?? "Sin cuenta"}
            </p>
            <p className="text-[11px] text-green-500">En línea</p>
          </div>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="text-neutral-500 hover:text-white transition-colors"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="flex items-center gap-1 px-2 pt-2">
        {(
          [
            { id: "friends", icon: Users },
            { id: "chat", icon: MessageSquare },
            { id: "add", icon: UserPlus },
          ] as { id: Tab; icon: typeof Users }[]
        ).map(({ id, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 h-8 flex items-center justify-center rounded-md transition-colors ${
              tab === id ? "bg-bg-hover text-accent-soft" : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            <Icon size={15} />
          </button>
        ))}
      </div>

      <div className="px-2 pt-2">
        <div className="flex items-center gap-2 bg-bg-card border border-border rounded-md px-2 h-8">
          <Search size={13} className="text-neutral-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar"
            className="bg-transparent outline-none text-xs w-full placeholder:text-neutral-600"
          />
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center text-xs text-neutral-600 px-4 text-center">
        <AnimatePresence mode="wait">
          <motion.span
            key={tab}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {tab === "friends" && "Cargando amigos..."}
            {tab === "chat" && "No hay conversaciones"}
            {tab === "add" && "Agrega amigos por su nombre de usuario"}
          </motion.span>
        </AnimatePresence>
      </div>
    </div>
  );
}
