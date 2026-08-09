// Cloudflare Worker – SoulClient backend
// Includes: Discord OAuth exchange, Supabase DB calls (redeem_code, etc.)
//
// Secrets – set once via Wrangler CLI (never committed):
//   wrangler secret put DISCORD_CLIENT_SECRET
//   wrangler secret put SUPABASE_SECRET_KEY
//
// Public vars live in wrangler.toml [vars]:
//   DISCORD_CLIENT_ID, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY
//
// Deploy:
//   cd backend-example/discord-oauth-worker && npm install && npm run deploy

/// <reference types="@cloudflare/workers-types" />

export interface Env {
  // Discord OAuth
  DISCORD_CLIENT_ID: string;
  DISCORD_CLIENT_SECRET: string;
  // Supabase
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  SUPABASE_SECRET_KEY: string; // set via: wrangler secret put SUPABASE_SECRET_KEY
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

const DISCORD_TOKEN_URL = "https://discord.com/api/oauth2/token";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Supabase helper – lightweight REST client (no SDK needed in Workers)
// Uses the service-role key so it bypasses RLS for server-side operations.
// ────────────────────────────────────────────────────────────────────────────

function supabaseHeaders(env: Env) {
  return {
    "Content-Type": "application/json",
    apikey: env.SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
  };
}

async function supabaseRpc(
  env: Env,
  functionName: string,
  params: Record<string, unknown>
): Promise<{ data: unknown; error: string | null }> {
  const url = `${env.SUPABASE_URL}/rest/v1/rpc/${functionName}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: supabaseHeaders(env),
    body: JSON.stringify(params),
  });
  if (!resp.ok) {
    const text = await resp.text();
    return { data: null, error: `Supabase RPC ${functionName} failed (${resp.status}): ${text}` };
  }
  const data = await resp.json();
  return { data, error: null };
}

async function supabaseSelect(
  env: Env,
  table: string,
  query: string
): Promise<{ data: unknown[]; error: string | null }> {
  const url = `${env.SUPABASE_URL}/rest/v1/${table}?${query}`;
  const resp = await fetch(url, {
    method: "GET",
    headers: { ...supabaseHeaders(env), Accept: "application/json" },
  });
  if (!resp.ok) {
    const text = await resp.text();
    return { data: [], error: `Supabase SELECT ${table} failed (${resp.status}): ${text}` };
  }
  const data = (await resp.json()) as unknown[];
  return { data, error: null };
}

async function supabaseInsert(
  env: Env,
  table: string,
  record: Record<string, unknown>
): Promise<{ data: unknown; error: string | null }> {
  const url = `${env.SUPABASE_URL}/rest/v1/${table}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      ...supabaseHeaders(env),
      Prefer: "return=representation",
    },
    body: JSON.stringify(record),
  });
  if (!resp.ok) {
    const text = await resp.text();
    return { data: null, error: `Supabase INSERT ${table} failed (${resp.status}): ${text}` };
  }
  const data = await resp.json();
  return { data, error: null };
}

// ────────────────────────────────────────────────────────────────────────────
// Discord OAuth helpers
// ────────────────────────────────────────────────────────────────────────────

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

// ────────────────────────────────────────────────────────────────────────────
// Main Worker
// ────────────────────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);

    // ── Discord OAuth ────────────────────────────────────────────────────────

    if (request.method === "POST" && url.pathname === "/exchange") {
      try {
        const { code, redirect_uri } = await request.json<{ code?: string; redirect_uri?: string }>();
        if (!code || !redirect_uri) return json({ error: "Missing code or redirect_uri" }, 400);
        const token = await discordTokenRequest(env, {
          grant_type: "authorization_code",
          code,
          redirect_uri,
        });
        return json(token);
      } catch (err) {
        console.error(err);
        return json({ error: "Discord token exchange failed" }, 502);
      }
    }

    if (request.method === "POST" && url.pathname === "/refresh") {
      try {
        const { refresh_token } = await request.json<{ refresh_token?: string }>();
        if (!refresh_token) return json({ error: "Missing refresh_token" }, 400);
        const token = await discordTokenRequest(env, {
          grant_type: "refresh_token",
          refresh_token,
        });
        return json(token);
      } catch (err) {
        console.error(err);
        return json({ error: "Discord token refresh failed" }, 502);
      }
    }

    // ── Supabase: redeem a code ──────────────────────────────────────────────
    // POST /redeem
    // Body: { code: string, discord_id?: string }
    // Calls the Supabase RPC function `redeem_code(p_code, p_discord_id)`.

    if (request.method === "POST" && url.pathname === "/redeem") {
      try {
        const { code, discord_id } = await request.json<{ code?: string; discord_id?: string }>();
        if (!code) return json({ error: "Missing code" }, 400);

        const { data, error } = await supabaseRpc(env, "redeem_code", {
          p_code: code,
          p_discord_id: discord_id ?? null,
        });
        if (error) return json({ error }, 422);
        return json({ success: true, result: data });
      } catch (err) {
        console.error(err);
        return json({ error: "Code redemption failed" }, 502);
      }
    }

    // ── Supabase: list public instances ──────────────────────────────────────
    // GET /instances
    // Returns all rows from the `instances` table where visibility = 'public'.

    if (request.method === "GET" && url.pathname === "/instances") {
      const { data, error } = await supabaseSelect(
        env,
        "instances",
        "visibility=eq.public&order=created_at.desc"
      );
      if (error) return json({ error }, 502);
      return json(data);
    }

    // ── Health check ────────────────────────────────────────────────────────
    if (request.method === "GET" && url.pathname === "/") {
      return json({ status: "ok", service: "SoulClient Worker" });
    }

    return json({ error: "Not found" }, 404);
  },
};
