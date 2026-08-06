import { create } from "zustand";
import type { DownloadProgress } from "@/types/download";

interface DownloadStoreState {
  /** keyed by instanceId */
  progress: Record<string, DownloadProgress>;
  logs: string[];
  setProgress: (p: DownloadProgress) => void;
  clear: (instanceId: string) => void;
}

export const useDownloadStore = create<DownloadStoreState>((set) => ({
  progress: {},
  logs: [],

  setProgress: (p: DownloadProgress) =>
    set((s) => ({
      progress: { ...s.progress, [p.instanceId]: p },
      logs: p.log ? [...s.logs.slice(-199), p.log] : s.logs,
    })),

  clear: (instanceId: string) =>
    set((s) => {
      const next = { ...s.progress };
      delete next[instanceId];
      return { progress: next };
    }),
}));
