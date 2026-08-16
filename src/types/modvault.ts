export interface VaultModEntry {
  id: string;
  instanceId: string;
  name: string;
  version: string;
  originalName: string;
  sizeBytes: number;
  isMandatory: boolean;
  addedAt: number;
}

export interface ModSyncResult {
  totalBytes: number;
  added: number;
  updated: number;
  pruned: number;
}
