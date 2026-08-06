// Cloudflare Worker version of SoulClient's Discord OAuth exchange backend.
//
// Same job as backend-example/discord-oauth-server, just running on
// Cloudflare's free edge tier instead of a traditional Node server:
// - No cold-start "sleep" like a free Render/Railway web service.
// - The Client Secret lives in an encrypted Worker secret, never in code.
//
// Deploy:
//   cd backend-example/discord-oauth-worker
//   npm install
//   npm run secret:set        # paste your (freshly regenerated) Client Secret when prompted
//   npm run deploy
//
// Then copy the printed URL (https://soulclient-discord-oauth.<you>.workers.dev)
// into SoulClient -> Ajustes -> "Discord backend URL".

export interface Env {
  DISCORD_CLIENT_ID: string;
  DISCORD_CLIENT_SECRET: string;
}

const DISCORD_TOKEN_URL = "https://discord.com/api/oauth2/token";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function discordTokenRequest(env: Env, params: Record<string, string>) {
  const resp = await fetch(DISCORD_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      ...params,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Discord token endpoint returned ${resp.status}: ${text}`);
  }
  return resp.json<{ access_token: string; refresh_token: string; expires_in: number }>();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    try {
      if (url.pathname === "/exchange") {
        const { code, redirect_uri } = await request.json<{ code?: string; redirect_uri?: string }>();
        if (!code || !redirect_uri) {
          return json({ error: "Missing code or redirect_uri" }, 400);
        }
        const token = await discordTokenRequest(env, {
          grant_type: "authorization_code",
          code,
          redirect_uri,
        });
        return json(token);
      }

      if (url.pathname === "/refresh") {
        const { refresh_token } = await request.json<{ refresh_token?: string }>();
        if (!refresh_token) {
          return json({ error: "Missing refresh_token" }, 400);
        }
        const token = await discordTokenRequest(env, {
          grant_type: "refresh_token",
          refresh_token,
        });
        return json(token);
      }

      return json({ error: "Not found" }, 404);
    } catch (err) {
      console.error(err);
      return json({ error: "Discord token exchange failed" }, 502);
    }
  },
};
