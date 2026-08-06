export type LoaderType = "vanilla" | "fabric";

export interface InstanceConfig {
  id: string;
  name: string;
  version: string;
  loader: LoaderType;
  loaderVersion?: string;
  directory: string;
  coverImage?: string;
  ramMb: number;
  jvmArgs: string;
  customJavaPath?: string;
  fullscreen: boolean;
  resolutionWidth: number;
  resolutionHeight: number;
  createdAt: number;
  lastPlayedAt?: number;
  totalPlayMs: number;
  /** When true, only the Discord IDs in `allowedDiscordIds` (plus admins) can see this instance once published. */
  whitelistEnabled: boolean;
  allowedDiscordIds: string[];
}

export interface InstanceDraft
  extends Omit<InstanceConfig, "id" | "createdAt" | "totalPlayMs" | "lastPlayedAt"> {}

export interface RemoteInstance {
  id: string;
  name: string;
  version: string;
  loader: LoaderType;
  loaderVersion?: string;
  description?: string;
  sizeBytes: number;
  sha256: string;
  downloads: number;
  publishedAt: number;
  updatedAt: number;
  whitelistEnabled: boolean;
  allowedDiscordIds: string[];
}
