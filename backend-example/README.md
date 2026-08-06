# Backend de intercambio OAuth2 de Discord

SoulClient (el launcher de escritorio) **nunca** contiene el Client Secret
de Discord. En su lugar:

1. El launcher abre el navegador del usuario en la pantalla de consentimiento
   de Discord y captura el `code` de autorización con un pequeño servidor
   local (`127.0.0.1:47850`).
2. El launcher envía ese `code` a este backend.
3. Este backend —que sí tiene el `DISCORD_CLIENT_SECRET`, guardado de forma
   segura (nunca en el código)— hace el intercambio real con Discord y
   devuelve sólo los tokens al launcher.

Hay dos implementaciones equivalentes, elige una:

| | `discord-oauth-server/` | `discord-oauth-worker/` |
|---|---|---|
| Runtime | Node.js (Express) | Cloudflare Workers (edge) |
| Dónde correrlo | Render, Railway, Fly.io, un VPS | Cloudflare (gratis) |
| Cold start | Sí, en el free tier de la mayoría de PaaS | No |
| Recomendado para | Correrlo local o en tu propio servidor | Producción, siempre activo, gratis |

## Registrar el Redirect URI en Discord (aplica a ambas opciones)

En https://discord.com/developers/applications, en la app con Client ID
`1492641149494755370`, agrega este Redirect URI exacto:

```
http://127.0.0.1:47850/callback
```

Esto es requerido porque el launcher escucha en ese puerto local
específico para capturar la respuesta de Discord.

Luego, en SoulClient → **Configuración → "Discord backend URL"**, pega la
URL pública del backend que hayas desplegado (con cualquiera de las dos
opciones — ambas exponen los mismos endpoints `/exchange` y `/refresh`).
