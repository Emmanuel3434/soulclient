export interface DownloadProgress {
  instanceId: string;
  stage: "manifest" | "client" | "libraries" | "assets" | "java" | "fabric" | "download" | "verify" | "extract" | "done" | "error";
  fileName?: string;
  downloadedBytes: number;
  totalBytes: number;
  speedBps: number;
  etaSeconds: number;
  log: string;
}
