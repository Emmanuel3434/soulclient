export interface DiscordSession {
  id: string;
  username: string;
  globalName: string;
  avatarUrl: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}
