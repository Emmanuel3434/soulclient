// Cloudflare Worker – SoulClient backend
// ============================================================================
// Includes:
//   - Discord OAuth exchange (/exchange, /refresh)
//   - Supabase code redemption (/redeem)
//   - Remote instance catalog backed by R2 + Supabase:
//       GET    /instances                        -> list catalog
//       GET    /api.php?action=rows&table=instances -> same list ({rows:[...]})
//       POST   /instances/upload/init            -> start multipart upload
//       POST   /instances/upload/part            -> { url } to upload one part
//       PUT    /instances/:id/upload/:uploadId/part/:n -> upload one part (etag)
//       POST   /instances/upload/complete        -> finish upload, write sha256
//       GET    /instances/:id/download           -> serve the ZIP (verifiable by SHA-256)
//       DELETE /instances/:id                    -> remove instance
//
// Object layout in R2 (bucket bound as `INSTANCES`):
//   instances/{id}.zip  -> the portable instance ZIP
//   instances/{id}.json -> catalog metadata (sizeBytes, sha256, downloads, ...)
//
// The ZIP's SHA-256 is computed on the server during publish and stored in the
// metadata + the Supabase `instances` row. The launcher computes the hash of
// EXACTLY the ZIP it downloads and compares — mismatch => the file is rejected.
//
// Secrets (set once via Wrangler CLI, never committed):
//   wrangler secret put DISCORD_CLIENT_SECRET
//   wrangler secret put SUPABASE_SECRET_KEY
//   wrangler secret put PUBLISH_TOKEN
//
// Public vars live in wrangler.toml [vars]:
//   DISCORD_CLIENT_ID, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY
//
// Deploy:
//   cd backend-example/discord-oauth-worker
//   npm install
//   npm run secret:set      (DISCORD_CLIENT_SECRET)
//   wrangler secret put SUPABASE_SECRET_KEY
//   wrangler secret put PUBLISH_TOKEN
//   npm run deploy
//
// Make sure the R2 bucket `soulclient-instances` exists:
//   wrangler r2 bucket create soulclient-instances
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
  // Publish/delete token, checked against the launcher's Bearer token
  PUBLISH_TOKEN: string; // set via: wrangler secret put PUBLISH_TOKEN
  // R2 bucket holding the instance ZIPs + metadata
  INSTANCES: R2Bucket;
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
// R2 catalog helpers
// ────────────────────────────────────────────────────────────────────────────

const ZIP_PREFIX = "instances/";

function zipKey(id: string): string {
  return `${ZIP_PREFIX}${id}.zip`;
}

function metaKey(id: string): string {
  return `${ZIP_PREFIX}${id}.json`;
}

async function readMeta(bucket: R2Bucket, id: string): Promise<InstanceMeta | null> {
  const obj = await bucket.get(metaKey(id));
  if (!obj) return null;
  try {
    return (await obj.json()) as InstanceMeta;
  } catch {
    return null;
  }
}

async function writeMeta(bucket: R2Bucket, meta: InstanceMeta): Promise<void> {
  await bucket.put(metaKey(meta.id), JSON.stringify(meta), {
    httpMetadata: { contentType: "application/json" },
  });
}

/** Maps a Supabase `instances` row + R2 metadata into the launcher's RemoteInstance shape. */
function toRemote(row: Record<string, unknown>, meta: InstanceMeta | null): InstanceMeta {
  return {
    id: String(row.id ?? meta?.id ?? ""),
    name: String(row.name ?? meta?.name ?? ""),
    version: String(row.version ?? meta?.version ?? ""),
    loader: String(row.modloader ?? meta?.loader ?? "vanilla"),
    loaderVersion: (row.modloader_version ?? meta?.loaderVersion) as string | undefined,
    description: (row.description ?? meta?.description ?? null) as string | undefined,
    sizeBytes: meta?.sizeBytes ?? 0,
    sha256: meta?.sha256 ?? String(row.sha256 ?? ""),
    downloads: meta?.downloads ?? 0,
    publishedAt: meta?.publishedAt ?? (Date.parse(String(row.created_at ?? "")) || 0),
    updatedAt: meta?.updatedAt ?? (Date.parse(String(row.created_at ?? "")) || 0),
    whitelistEnabled: meta?.whitelistEnabled ?? Boolean(row.whitelist_enabled ?? false),
    allowedDiscordIds: meta?.allowedDiscordIds ?? [],
  };
}

async function listInstances(env: Env): Promise<InstanceMeta[]> {
  const { data, error } = await supabaseSelect(
    env,
    "instances",
    "select=*&order=created_at.desc"
  );
  if (error) return [];
  const rows = data as Record<string, unknown>[];
  const out: InstanceMeta[] = [];
  for (const row of rows) {
    const id = String(row.id ?? "");
    if (!id) continue;
    const meta = await readMeta(env.INSTANCES, id);
    out.push(toRemote(row, meta));
  }
  return out;
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
  try {
    const upload = await env.INSTANCES.createMultipartUpload(zipKey(id));
    return json({ id, uploadId: upload.uploadId });
  } catch (err) {
    console.error("createMultipartUpload failed", err);
    return json({ error: "No se pudo iniciar la subida" }, 500);
  }
}

async function handlePartUrl(
  request: Request,
  env: Env,
  body: { id?: string; uploadId?: string; partNumber?: number }
): Promise<Response> {
  const { id, uploadId, partNumber } = body;
  if (!id || !uploadId || !partNumber) return json({ error: "Missing id/uploadId/partNumber" }, 400);
  const origin = new URL(request.url).origin;
  const url = `${origin}/instances/${id}/upload/${uploadId}/part/${partNumber}`;
  return json({ url });
}

async function handlePartPut(
  request: Request,
  env: Env,
  id: string,
  uploadId: string,
  partNumberStr: string
): Promise<Response> {
  const partNumber = Number(partNumberStr);
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) {
    return json({ error: "Invalid partNumber" }, 400);
  }
  if (!request.body) return json({ error: "Missing body" }, 400);
  try {
    const part = await env.INSTANCES
      .resumeMultipartUpload(zipKey(id), uploadId)
      .uploadPart(partNumber, request.body);
    return new Response(JSON.stringify({ partNumber, etag: part.etag }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        Etag: part.etag,
        ...corsHeaders,
      },
    });
  } catch (err) {
    console.error("uploadMultipartPart failed", err);
    return json({ error: "No se pudo subir la parte" }, 500);
  }
}

async function handleCompleteUpload(
  env: Env,
  body: {
    id?: string;
    uploadId?: string;
    parts?: { partNumber?: number; etag?: string }[];
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
  const { id, uploadId, parts, size } = body;
  if (!id || !uploadId || !Array.isArray(parts) || parts.length === 0) {
    return json({ error: "Missing id/uploadId/parts" }, 400);
  }
  try {
    const uploadedParts = parts.map((p) => ({
      partNumber: Number(p.partNumber),
      etag: String(p.etag),
    }));
    await env.INSTANCES.resumeMultipartUpload(zipKey(id), uploadId).complete(uploadedParts);

    const now = Date.now();
    const existing: Partial<InstanceMeta> = (await readMeta(env.INSTANCES, id)) ?? {};
    const meta: InstanceMeta = {
      id,
      name: body.name ?? existing.name ?? "",
      version: body.version ?? existing.version ?? "",
      loader: body.loader ?? existing.loader ?? "vanilla",
      loaderVersion: body.loaderVersion ?? existing.loaderVersion,
      description: body.description ?? existing.description,
      sizeBytes: size ?? existing.sizeBytes ?? 0,
      sha256: body.sha256 ?? existing.sha256 ?? "",
      downloads: existing.downloads ?? 0,
      publishedAt: existing.publishedAt ?? now,
      updatedAt: now,
      whitelistEnabled: body.whitelistEnabled ?? existing.whitelistEnabled ?? false,
      allowedDiscordIds: body.allowedDiscordIds ?? existing.allowedDiscordIds ?? [],
    };
    await writeMeta(env.INSTANCES, meta);

    // Keep the Supabase row in sync so the launcher's direct-Supabase fallback
    // also lists it, including the sha256 for integrity verification.
    await supabaseUpsert(
      env,
      "instances",
      {
        id,
        name: meta.name,
        version: meta.version,
        modloader: meta.loader,
        modloader_version: meta.loaderVersion ?? null,
        description: meta.description ?? null,
        whitelist_enabled: meta.whitelistEnabled,
        sha256: meta.sha256,
      },
      "id"
    );

    return json(meta);
  } catch (err) {
    console.error("completeMultipartUpload failed", err);
    return json({ error: "No se pudo completar la publicación" }, 500);
  }
}

async function handleDownload(env: Env, id: string): Promise<Response> {
  const obj = await env.INSTANCES.get(zipKey(id));
  if (!obj) return notFound("Instancia no encontrada o sin archivo publicado");

  // Best-effort download counter
  try {
    const meta = await readMeta(env.INSTANCES, id);
    if (meta) {
      meta.downloads = (meta.downloads ?? 0) + 1;
      meta.updatedAt = Date.now();
      await writeMeta(env.INSTANCES, meta);
    }
  } catch (err) {
    console.error("Failed to bump downloads", err);
  }

  const headers = new Headers(corsHeaders);
  headers.set("Content-Type", "application/zip");
  headers.set("Content-Disposition", `attachment; filename="${id}.zip"`);
  headers.set("Content-Length", String(obj.size));
  if (obj.etag) headers.set("ETag", obj.etag);
  return new Response(obj.body, { headers });
}

async function handleDelete(env: Env, id: string): Promise<Response> {
  await env.INSTANCES.delete(zipKey(id));
  await env.INSTANCES.delete(metaKey(id));
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

    // ── Catalog: part upload (the launcher PUTs to the URL returned by
    //    POST /instances/upload/part). No auth: the uploadId acts as a
    //    capability token, and publishing still requires the Bearer token. ────

    const partMatch = path.match(
      /^\/instances\/([^/]+)\/upload\/([^/]+)\/part\/([0-9]+)$/
    );
    if (request.method === "PUT" && partMatch) {
      return handlePartPut(request, env, partMatch[1], partMatch[2], partMatch[3]);
    }

    // ── Catalog: upload management (publish token required) ─────────────────

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

    if (request.method === "POST" && path === "/instances/upload/part") {
      if (!authorized) return unauthorized();
      try {
        const body = await request.json<{ id?: string; uploadId?: string; partNumber?: number }>();
        return handlePartUrl(request, env, body);
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
