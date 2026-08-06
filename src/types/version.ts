export type VersionKind = "release" | "snapshot" | "old_beta" | "old_alpha";

export interface MinecraftVersion {
  id: string;
  type: VersionKind;
  url: string;
  releaseTime: string;
}

export interface FabricLoaderVersion {
  loader: string;
  stable: boolean;
}
