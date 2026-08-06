import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import TitleBar from "@/components/layout/TitleBar";
import Sidebar, { type Route } from "@/components/layout/Sidebar";
import Home from "@/pages/Home";
import Instances from "@/pages/Instances";
import Skin from "@/pages/Skin";
import Admin from "@/pages/Admin";
import Settings from "@/pages/Settings";
import Profile from "@/pages/Profile";
import Accounts from "@/pages/Accounts";
import Login from "@/pages/Login";
import { useAccountStore } from "@/state/accountStore";
import { useDiscordStore } from "@/state/discordStore";

const PAGES: Record<Route, React.ComponentType> = {
  home: Home,
  instances: Instances,
  skin: Skin,
  admin: Admin,
  settings: Settings,
  profile: Profile,
  accounts: Accounts,
};

export default function App() {
  const [route, setRoute] = useState<Route>("home");
  const { activeAccount, refresh } = useAccountStore();
  const { status, session, restore, logout } = useDiscordStore();
  const isAdmin =
    !!activeAccount?.isAdmin ||
    activeAccount?.username?.toLowerCase() === "emanueel" ||
    session?.username?.toLowerCase() === "emanueel" ||
    session?.globalName?.toLowerCase() === "emanueel";

  useEffect(() => {
    restore();
    refresh();
  }, []);

  useEffect(() => {
    if (status === "authenticated") refresh();
  }, [status]);

  useEffect(() => {
    if (route === "admin" && !isAdmin) {
      setRoute("home");
    }
  }, [route, isAdmin]);

  if (status === "checking") {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-bg">
        <motion.div
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1.6, repeat: Infinity }}
          className="flex flex-col items-center gap-3"
        >
          <div className="text-xl font-bold tracking-widest">
            <span className="text-white">Soul</span>
            <span className="text-neutral-400">Client</span>
          </div>
          <div className="w-24 h-0.5 bg-gradient-to-r from-transparent via-neutral-500 to-transparent rounded-full" />
        </motion.div>
      </div>
    );
  }

  const isAuthenticated = status === "authenticated" || !!activeAccount;

  if (!isAuthenticated) {
    return <Login />;
  }

  const handleLogout = async () => {
    if (session) await logout();
    if (activeAccount) useAccountStore.setState({ activeAccount: null });
  };

  const EffectivePage = route === "admin" && !isAdmin ? Home : PAGES[route];

  return (
    <div className="h-screen w-screen flex flex-col bg-bg text-neutral-200 overflow-hidden">
      <TitleBar discordUser={session} activeAccount={activeAccount} onLogout={handleLogout} />
      <div className="flex flex-1 min-h-0">
        <Sidebar route={route} onNavigate={setRoute} />
        <div className="flex-1 flex min-w-0">
          <AnimatePresence mode="wait">
            <motion.div
              key={route}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              transition={{ duration: 0.12 }}
              className="flex flex-1 min-w-0"
            >
              <EffectivePage />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
