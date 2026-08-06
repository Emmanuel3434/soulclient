export interface LauncherSettings {
  maxRamMb: number;
  minecraftPath: string;
  javaPath: string;
  theme: "dark";
  language: "es" | "en";
  interfaceFps: number;
  autoUpdate: boolean;
  publishToken: string;
  adminToken: string;
  discordTokenExchangeUrl: string;
}

export const DEFAULT_SETTINGS: LauncherSettings = {
  maxRamMb: 4096,
  minecraftPath: "",
  javaPath: "",
  theme: "dark",
  language: "es",
  interfaceFps: 60,
  autoUpdate: true,
  publishToken: "",
  adminToken: "",
  discordTokenExchangeUrl: "",
};

