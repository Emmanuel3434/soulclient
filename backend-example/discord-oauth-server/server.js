// Minimal reference backend for SoulClient's Discord login.
//
// This is the ONLY place the Discord Client Secret should ever live. The
// desktop launcher never sees it: it opens the browser to Discord's
// consent screen, captures the resulting `code` on a local loopback
// server, then POSTs that code here. This server does the actual
// code-for-token exchange (which requires the secret) and hands back just
// the tokens.
//
// Deploy this anywhere that can hold environment variables securely
// (Fly.io, Render, a small VPS, a Cloudflare Worker rewritten in JS, ...).
// Then set its public URL in SoulClient -> Ajustes -> "Discord backend URL".
//
// Required environment variables:
//   DISCORD_CLIENT_ID     - same Client ID configured in the launcher
//   DISCORD_CLIENT_SECRET - from the Discord Developer Portal (SECRET, never commit this)
//   PORT                  - defaults to 8787

import express from "express";

const app = express();
app.use(express.json());

const CLIENT_ID = process.env.DISCORD_CLIENT_ID || "1492641149494755370";
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const PORT = process.env.PORT || 8787;

if (!CLIENT_SECRET) {
  console.error(
    "Missing DISCORD_CLIENT_SECRET env var. Get it from https://discord.com/developers/applications"
  );
  process.exit(1);
}

async function discordTokenRequest(params) {
  const resp = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Discord token endpoint returned ${resp.status}: ${text}`);
  }
  return resp.json();
}

// POST /exchange { code, redirect_uri } -> { access_token, refresh_token, expires_in }
app.post("/exchange", async (req, res) => {
  const { code, redirect_uri } = req.body;
  if (!code || !redirect_uri) {
    return res.status(400).json({ error: "Missing code or redirect_uri" });
  }
  try {
    const token = await discordTokenRequest({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri,
    });
    res.json({
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expires_in: token.expires_in,
    });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "Failed to exchange code" });
  }
});

// POST /refresh { refresh_token } -> { access_token, refresh_token, expires_in }
app.post("/refresh", async (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token) {
    return res.status(400).json({ error: "Missing refresh_token" });
  }
  try {
    const token = await discordTokenRequest({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token,
    });
    res.json({
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expires_in: token.expires_in,
    });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "Failed to refresh token" });
  }
});

app.listen(PORT, () => {
  console.log(`SoulClient Discord OAuth backend listening on :${PORT}`);
});
