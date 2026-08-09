// Cloudflare Worker – SoulClient backend
// ============================================================================
// Includes:
//   - Discord OAuth exchange (/exchange, /refresh)
//   - Supabase code redemption (/redeem)
//   - Remote instance catalog backed by Supabase Storage + the `instances` table:
//       GET    /instances                        -> list catalog
//       GET    /api.php?action=rows&table=instances -> same list ({rows:[...]})
//       POST   /instances/upload/init            -> { url } signed upload URL
//       PUT    <signed upload URL>               -> the launcher streams the ZIP
//       POST   /instances/upload/complete        -> store metadata + sha256
//       GET    /instances/:id/download           -> 302 to the ZIP (verifiable by SHA-256)
//       DELETE /instances/:id                    -> remove instance
//
// Storage layout in the public Supabase bucket `instances`:
//   {id}.zip  -> the portable instance ZIP (uploaded through a signed URL)
//
// The ZIP's SHA-256 is computed by the launcher during publish and stored in
// the Supabase `instances` row. The launcher computes the hash of EXACTLY the
// ZIP it downloads and compares — mismatch => the file is rejected.
//
// Secrets (set once via Wrangler CLI, never committed):
//   wrangler secret put DISCORD_CLIENT_SECRET
//   wrangler secret put SUPABASE_SECRET_KEY
//   wrangler secret put PUBLISH_TOKEN
//
// Public vars live in wrangler.toml [vars]:
//   DISCORD_CLIENT_ID, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_BUCKET
//
// Deploy:
//   cd backend-example/discord-oauth-worker
//   npm install
//   wrangler secret put DISCORD_CLIENT_SECRET
//   wrangler secret put SUPABASE_SECRET_KEY
//   wrangler secret put PUBLISH_TOKEN
//   npm run deploy
//
// Make sure the Supabase bucket `instances` exists and is public (create it
// from the Dashboard, or with the service-role key via the Storage API).
// ============================================================================

/// <reference types="@cloudflare/workers-types" />

export interface Env {
  // Discord OAuth
  DISCORD_CLIENT_ID: string;
  DISCORD_CLIENT_SECRET: string;
  // Supabase
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  SUPABASE_SECRET_KEY: string; // set via: wrangler secret put SUPABASE_SECRET_KEY
  SUPABASE_BUCKET: string; // public bucket holding the instance ZIPs
  // Publish/delete token, checked against the launcher's Bearer token
  PUBLISH_TOKEN: string; // set via: wrangler secret put PUBLISH_TOKEN
}

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

interface InstanceMeta {
  id: string;
  name: string;
  version: string;
  loader: string;
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

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

const DISCORD_TOKEN_URL = "https://discord.com/api/oauth2/token";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
      ...extraHeaders,
    },
  });
}

function ok(): Response {
  return json({ success: true });
}

function notFound(msg = "Not found"): Response {
  return json({ error: msg }, 404);
}

function unauthorized(): Response {
  return json({ error: "No autorizado" }, 401);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ────────────────────────────────────────────────────────────────────────────
// Supabase helpers (service-role key, bypasses RLS)
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

async function supabaseUpsert(
  env: Env,
  table: string,
  record: Record<string, unknown>,
  onConflict: string
): Promise<{ error: string | null }> {
  const url = `${env.SUPABASE_URL}/rest/v1/${table}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      ...supabaseHeaders(env),
      Prefer: `resolution=merge-duplicates,return=minimal`,
    },
    body: JSON.stringify([record]),
  });
  if (!resp.ok) {
    const text = await resp.text();
    return { error: `Supabase UPSERT ${table} failed (${resp.status}): ${text}` };
  }
  return { error: null };
}

async function supabaseDelete(
  env: Env,
  table: string,
  query: string
): Promise<{ error: string | null }> {
  const url = `${env.SUPABASE_URL}/rest/v1/${table}?${query}`;
  const resp = await fetch(url, {
    method: "DELETE",
    headers: supabaseHeaders(env),
  });
  if (!resp.ok) {
    const text = await resp.text();
    return { error: `Supabase DELETE ${table} failed (${resp.status}): ${text}` };
  }
  return { error: null };
}

// ────────────────────────────────────────────────────────────────────────────
// Supabase Storage helpers
// ────────────────────────────────────────────────────────────────────────────

/** Creates a signed upload URL for `{id}.zip` (valid 2h). The launcher PUTs the
 *  file body directly to it (with `x-upsert: true` so re-publishing works). */
async function createSignedUploadUrl(env: Env, id: string): Promise<string | null> {
  const url = `${env.SUPABASE_URL}/storage/v1/object/upload/sign/${env.SUPABASE_BUCKET}/${encodeURIComponent(id)}.zip`;
  const resp = await fetch(url, {
    method: "POST",
    headers: supabaseHeaders(env),
    body: JSON.stringify({ expiresIn: 7200 }),
  });
  if (!resp.ok) {
    console.error("createSignedUploadUrl failed", resp.status, await resp.text());
    return null;
  }
  const data = (await resp.json()) as {
    signedUrl?: string;
    signedURL?: string;
    url?: string;
    error?: string;
  };
  return data.signedUrl ?? data.signedURL ?? data.url ?? null;
}

async function objectExists(env: Env, id: string): Promise<boolean> {
  const url = `${env.SUPABASE_URL}/storage/v1/object/${env.SUPABASE_BUCKET}/${encodeURIComponent(id)}.zip`;
  const headers: Record<string, string> = {
    apikey: env.SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
  };
  const resp = await fetch(url, { method: "HEAD", headers });
  return resp.ok;
}

async function deleteObject(env: Env, id: string): Promise<void> {
  const url = `${env.SUPABASE_URL}/storage/v1/object/${env.SUPABASE_BUCKET}/${encodeURIComponent(id)}.zip`;
  const resp = await fetch(url, { method: "DELETE", headers: supabaseHeaders(env) });
  if (!resp.ok) console.error("deleteObject failed", resp.status, await resp.text());
}

/** Best-effort downloads counter: read the current value and PATCH +1. */
async function bumpDownloads(env: Env, id: string): Promise<void> {
  try {
    const { data, error } = await supabaseSelect(
      env,
      "instances",
      `select=downloads&id=eq.${encodeURIComponent(id)}&limit=1`
    );
    if (error || data.length === 0) return;
    const current = Number((data[0] as Record<string, unknown>)?.downloads ?? 0);
    const resp = await fetch(
      `${env.SUPABASE_URL}/rest/v1/instances?id=eq.${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: supabaseHeaders(env),
        body: JSON.stringify({ downloads: current + 1 }),
      }
    );
    if (!resp.ok) console.error("bumpDownloads failed", resp.status, await resp.text());
  } catch (err) {
    console.error("bumpDownloads error", err);
  }
}

function tsToMs(v: unknown, fallback: number): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Date.parse(v);
    return Number.isNaN(n) ? fallback : n;
  }
  return fallback;
}

/** Maps a Supabase `instances` row into the launcher's RemoteInstance shape. */
function toRemote(row: Record<string, unknown>): InstanceMeta {
  const now = Date.now();
  return {
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    version: String(row.version ?? ""),
    loader: String(row.modloader ?? "vanilla"),
    loaderVersion: (row.modloader_version ?? null) as string | undefined,
    description: (row.description ?? null) as string | undefined,
    sizeBytes: Number(row.size_bytes ?? 0),
    sha256: String(row.sha256 ?? ""),
    downloads: Number(row.downloads ?? 0),
    publishedAt: tsToMs(row.published_at, tsToMs(row.created_at, now)),
    updatedAt: tsToMs(row.updated_at, tsToMs(row.created_at, now)),
    whitelistEnabled: Boolean(row.whitelist_enabled ?? false),
    allowedDiscordIds: Array.isArray(row.allowed_discord_ids)
      ? (row.allowed_discord_ids as unknown[]).map(String)
      : [],
  };
}

async function listInstances(env: Env): Promise<InstanceMeta[]> {
  const { data, error } = await supabaseSelect(
    env,
    "instances",
    "select=*&order=created_at.desc"
  );
  if (error) return [];
  return (data as Record<string, unknown>[]).map(toRemote);
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
// Catalog handlers
// ────────────────────────────────────────────────────────────────────────────

async function handleInitUpload(env: Env, body: { id?: string }): Promise<Response> {
  const id = body.id;
  if (!id) return json({ error: "Missing id" }, 400);
  const url = await createSignedUploadUrl(env, id);
  if (!url) return json({ error: "No se pudo iniciar la subida" }, 500);
  return json({ id, url });
}

async function handleCompleteUpload(
  env: Env,
  body: {
    id?: string;
    size?: number;
    name?: string;
    version?: string;
    loader?: string;
    loaderVersion?: string;
    description?: string;
    sha256?: string;
    whitelistEnabled?: boolean;
    allowedDiscordIds?: string[];
  }
): Promise<Response> {
  const { id } = body;
  if (!id) return json({ error: "Missing id" }, 400);
  try {
    const now = new Date().toISOString();
    const { data } = await supabaseSelect(
      env,
      "instances",
      `select=*&id=eq.${encodeURIComponent(id)}&limit=1`
    );
    const prev = (data[0] as Record<string, unknown>) ?? {};

    const row: Record<string, unknown> = {
      id,
      name: body.name ?? prev.name ?? "",
      version: body.version ?? prev.version ?? "",
      modloader: body.loader ?? prev.modloader ?? "vanilla",
      modloader_version: body.loaderVersion ?? prev.modloader_version ?? null,
      description: body.description ?? prev.description ?? null,
      whitelist_enabled:
        body.whitelistEnabled ?? Boolean(prev.whitelist_enabled ?? false),
      allowed_discord_ids:
        body.allowedDiscordIds ??
        (Array.isArray(prev.allowed_discord_ids) ? prev.allowed_discord_ids : []),
      size_bytes: body.size ?? Number(prev.size_bytes ?? 0),
      sha256: body.sha256 ?? prev.sha256 ?? "",
      updated_at: now,
      published_at: prev.published_at ?? now,
    };

    const { error } = await supabaseUpsert(env, "instances", row, "id");
    if (error) return json({ error: "No se pudo completar la publicación" }, 500);
    return json(toRemote(row));
  } catch (err) {
    console.error("complete publish failed", err);
    return json({ error: "No se pudo completar la publicación" }, 500);
  }
}

async function handleDownload(env: Env, id: string): Promise<Response> {
  if (!(await objectExists(env, id))) {
    return notFound("Instancia no encontrada o sin archivo publicado");
  }
  await bumpDownloads(env, id);
  const publicUrl = `${env.SUPABASE_URL}/storage/v1/object/public/${env.SUPABASE_BUCKET}/${encodeURIComponent(id)}.zip`;
  return new Response(null, {
    status: 302,
    headers: {
      ...corsHeaders,
      Location: publicUrl,
      "Content-Disposition": `attachment; filename="${id}.zip"`,
    },
  });
}

async function handleDelete(env: Env, id: string): Promise<Response> {
  await deleteObject(env, id);
  const { error } = await supabaseDelete(env, "instances", `id=eq.${id}`);
  if (error) console.error("Supabase delete failed", error);
  return ok();
}

// ────────────────────────────────────────────────────────────────────────────
// Main Worker
// ────────────────────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // ── Discord OAuth ────────────────────────────────────────────────────────

    if (request.method === "POST" && path === "/exchange") {
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

    if (request.method === "POST" && path === "/refresh") {
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

    if (request.method === "POST" && path === "/redeem") {
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

    // ── Catalog: list ────────────────────────────────────────────────────────

    const isList =
      (request.method === "GET" && path === "/instances") ||
      (request.method === "GET" &&
        path === "/api.php" &&
        url.searchParams.get("action") === "rows" &&
        url.searchParams.get("table") === "instances");

    if (isList) {
      const instances = await listInstances(env);
      if (path === "/api.php") return json({ rows: instances });
      return json(instances);
    }

    // ── Catalog: download ────────────────────────────────────────────────────

    const downloadMatch = path.match(/^\/instances\/([^/]+)\/download$/);
    if (request.method === "GET" && downloadMatch) {
      return handleDownload(env, decodeURIComponent(downloadMatch[1]));
    }

    // ── Catalog: upload management (publish token required) ─────────────────
    // The launcher calls /init to get a signed upload URL, PUTs the ZIP body
    // straight to that URL (x-upsert), then calls /complete with the metadata.
    // No part endpoints: Supabase Storage signed upload URLs accept the whole
    // file body in one PUT (up to a few hundred MB).

    const auth = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const authorized = auth.length > 0 && env.PUBLISH_TOKEN && timingSafeEqual(auth, env.PUBLISH_TOKEN);

    if (request.method === "POST" && path === "/instances/upload/init") {
      if (!authorized) return unauthorized();
      try {
        const body = await request.json<{ id?: string }>();
        return handleInitUpload(env, body);
      } catch {
        return json({ error: "Invalid JSON body" }, 400);
      }
    }

    if (request.method === "POST" && path === "/instances/upload/complete") {
      if (!authorized) return unauthorized();
      try {
        const body = await request.json();
        return handleCompleteUpload(env, body as Parameters<typeof handleCompleteUpload>[1]);
      } catch {
        return json({ error: "Invalid JSON body" }, 400);
      }
    }

    const instanceMatch = path.match(/^\/instances\/([^/]+)$/);
    if (request.method === "DELETE" && instanceMatch) {
      if (!authorized) return unauthorized();
      return handleDelete(env, decodeURIComponent(instanceMatch[1]));
    }

    // ── Health check ────────────────────────────────────────────────────────

    if (request.method === "GET" && path === "/") {
      return json({ status: "ok", service: "SoulClient Worker" });
    }

    return json({ error: "Not found" }, 404);
  },
};
