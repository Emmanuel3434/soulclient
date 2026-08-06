export type AccountType = "premium" | "offline";

export interface Account {
  id: string;
  type: AccountType;
  username: string;
  uuid: string;
  skinUrl?: string;
  capeUrl?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  addedAt: number;
  /** Computed server-side against the launcher's admin allowlist. */
  isAdmin: boolean;
}

export interface AccountsState {
  accounts: Account[];
  activeAccountId: string | null;
}
