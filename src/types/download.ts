export interface DownloadProgress {
  instanceId: string;
  stage: "manifest" | "client" | "libraries" | "assets" | "java" | "fabric" | "done" | "error";
  fileName?: string;
  downloadedBytes: number;
  totalBytes: number;
  speedBps: number;
  etaSeconds: number;
  log: string;
}
