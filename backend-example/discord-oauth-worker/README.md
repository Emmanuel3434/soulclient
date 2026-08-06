# Backend de Discord — versión Cloudflare Workers

Misma función que `discord-oauth-server` (el intercambio de código por token
que necesita el Client Secret), pero corriendo en el edge de Cloudflare:
gratis, sin "dormirse" como los planes free de Render/Railway, y sin
servidor que mantener.

## 1. Cuenta e instalación

```bash
cd backend-example/discord-oauth-worker
npm install
npx wrangler login   # abre el navegador para autenticar con tu cuenta Cloudflare (gratis)
```

## 2. Regenera el Client Secret

Si en algún momento pegaste o compartiste tu Client Secret anterior,
regénéralo primero en
https://discord.com/developers/applications → tu app → OAuth2 → "Reset Secret".

## 3. Guarda el secret de forma segura (nunca en el código)

```bash
npm run secret:set
```

Te va a pedir el valor — pégalo ahí, se guarda cifrado del lado de
Cloudflare, no queda en ningún archivo del repo.

## 4. Registra el Redirect URI en Discord

En la misma pantalla de OAuth2 en el Developer Portal, agrega:

```
http://127.0.0.1:47850/callback
```

## 5. Despliega

```bash
npm run deploy
```

Esto imprime una URL pública como:

```
https://soulclient-discord-oauth.tu-usuario.workers.dev
```

## 6. Configura SoulClient

Abre SoulClient → **Configuración** → **"Discord backend URL"** → pega esa
URL → Guardar cambios. Prueba "Iniciar sesión con Discord" — ya no debería
haber cold-start ni mensajes de "no hay backend configurado".

## Desarrollo local (opcional)

```bash
npm run dev
```

Levanta el Worker en `http://localhost:8787` con hot-reload, útil para
probar cambios antes de desplegar.
